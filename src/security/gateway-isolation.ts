// S.0.01.07 — Изоляция Шлюза
// Проверка: подключение из Шлюза к 14 направлениям (или обратно) = нарушение ядра.
// Автоматическая Информационная блокада при нарушении (I.3.9).
// Отдельные бакеты S3, отдельная БД. Триггер узурпации.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// - sourceNode / targetNode — строковые ID сервисов ('core', 'gateway', 'worker', ...).
//   Не завязаны на БД — работают для system-операций.
// - Управление режимом InfoBlockade делегируется в C.0.17.02 через dynamic import
//   (разрыв циклических зависимостей).
// - Флаг блокады дублируется в Redis для быстрых проверок (TTL 60 мин).
//
// Техдолг закрыт (v0.0.02):
//   - B14: isInfoBlockadeActive — продлевает TTL при каждой проверке,
//          чтобы активная блокада не снималась сама по истечении TTL.
//   - B15: reportViolation — advisory lock + double-checked re-check
//          при активации блокады (сериализует параллельные активации).

import {
  AppError,
  InfoBlockadeError,
} from '../core/errors.js';
import { Role } from '../core/roles.js';
import type { UUID } from '../core/types.js';
import { transaction } from '../lib/db.js';
import { newUUID } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

// -------- Типы --------

export type ServiceNode = 'core' | 'gateway' | 'worker' | 'external' | 'bridge';

export interface IsolationContext {
  sourceNode: ServiceNode;
  targetNode: ServiceNode;
  operation: string;
  actorId?: UUID | null;
  metadata?: Record<string, unknown>;
}

export interface IsolationCheckResult {
  allowed: boolean;
  reason?: string;
  whitelisted: boolean;
}

export interface ViolationResult {
  violationId: UUID;
  infoBlockadeActivated: boolean;
}

// -------- Константы --------

const GATEWAY_DIRECTION_NUMBER = 15;
const FLAG_KEY = 'gateway:info_blockade:active';
const VIOLATION_LOG_KEY = 'gateway:violations';
const FLAG_TTL_SEC = 60 * 60; // 1 час — продлевается при каждой проверке

// Whitelist: core → gateway (что Верификация / Совет Протоколов могут читать)
const ALLOWED_CORE_TO_GATEWAY: ReadonlySet<string> = new Set([
  'gateway.audit.read',
  'gateway.self_sufficiency.read',
  'gateway.council.read',
  'gateway.transaction.read',
  'gateway.asset.read',
]);

// Whitelist: gateway → core (что Шлюз может делать через прокси)
const ALLOWED_GATEWAY_TO_CORE: ReadonlySet<string> = new Set([
  'signal.create',            // Шлюз может подать сигнал (крайняя мера)
  'goods.transfer.request',   // Передача ресурсов в 14 направлений
  'notification.emergency',   // Экстренное уведомление
]);

// -------- Проверка --------

export async function checkIsolation(
  ctx: IsolationContext,
): Promise<IsolationCheckResult> {
  if (!ctx.sourceNode || !ctx.targetNode || !ctx.operation) {
    return {
      allowed: false,
      reason: 'sourceNode, targetNode, operation required',
      whitelisted: false,
    };
  }

  // Один и тот же узел → всегда разрешено.
  if (ctx.sourceNode === ctx.targetNode) {
    return { allowed: true, whitelisted: false };
  }

  // core ↔ core, worker ↔ core, bridge ↔ любой — разрешено.
  // worker — это наш собственный cron, работает с core БД.
  // bridge — специальный прокси-сервис для разрешённых операций.
  if (ctx.sourceNode === 'bridge' || ctx.targetNode === 'bridge') {
    return { allowed: true, whitelisted: false };
  }
  if (ctx.sourceNode === 'worker' || ctx.targetNode === 'worker') {
    // Worker читает core и (изолированно) gateway. Если worker → gateway,
    // это тоже нарушение (worker работает в контуре core).
    if (
      (ctx.sourceNode === 'worker' && ctx.targetNode === 'gateway') ||
      (ctx.sourceNode === 'gateway' && ctx.targetNode === 'worker')
    ) {
      return {
        allowed: false,
        reason: 'Worker не может напрямую обращаться к Шлюзу',
        whitelisted: false,
      };
    }
    return { allowed: true, whitelisted: false };
  }

  // external — только через bridge.
  if (ctx.sourceNode === 'external' || ctx.targetNode === 'external') {
    return {
      allowed: false,
      reason: 'Внешние узлы подключаются только через bridge',
      whitelisted: false,
    };
  }

  // core → gateway
  if (ctx.sourceNode === 'core' && ctx.targetNode === 'gateway') {
    if (ALLOWED_CORE_TO_GATEWAY.has(ctx.operation)) {
      return { allowed: true, whitelisted: true };
    }
    return {
      allowed: false,
      reason: `Операция ${ctx.operation} не разрешена между core и gateway`,
      whitelisted: false,
    };
  }

  // gateway → core
  if (ctx.sourceNode === 'gateway' && ctx.targetNode === 'core') {
    if (ALLOWED_GATEWAY_TO_CORE.has(ctx.operation)) {
      return { allowed: true, whitelisted: true };
    }
    return {
      allowed: false,
      reason: `Операция ${ctx.operation} не разрешена между gateway и core`,
      whitelisted: false,
    };
  }

  return {
    allowed: false,
    reason: 'Неизвестная комбинация узлов',
    whitelisted: false,
  };
}

export async function assertIsolation(ctx: IsolationContext): Promise<void> {
  const result = await checkIsolation(ctx);
  if (result.allowed) {return;}

  // Если нарушение — это уже серьёзно. Записываем и активируем блокаду.
  await reportViolation(ctx, result.reason ?? 'unknown violation');

  // Бросаем InfoBlockadeError → HTTP 451.
  throw new InfoBlockadeError(
    `Нарушение изоляции: ${result.reason ?? ctx.operation}`,
  );
}

// -------- Нарушение и блокада --------

export async function reportViolation(
  ctx: IsolationContext,
  description: string,
): Promise<ViolationResult> {
  const violationId = newUUID();

  const violation = {
    id: violationId,
    sourceNode: ctx.sourceNode,
    targetNode: ctx.targetNode,
    operation: ctx.operation,
    actorId: ctx.actorId ?? null,
    description,
    metadata: ctx.metadata ?? {},
    detectedAt: new Date().toISOString(),
  };

  // Пишем в Redis-список (retention 7 дней, максимум 1000 записей).
  try {
    await redis
      .multi()
      .lpush(VIOLATION_LOG_KEY, JSON.stringify(violation))
      .ltrim(VIOLATION_LOG_KEY, 0, 999)
      .expire(VIOLATION_LOG_KEY, 7 * 24 * 3600)
      .exec();
  } catch (e) {
    logger.warn({ err: e, violationId }, 'gateway-isolation: failed to log violation');
  }

  logger.error(
    {
      violationId,
      sourceNode: ctx.sourceNode,
      targetNode: ctx.targetNode,
      operation: ctx.operation,
      actorId: ctx.actorId,
    },
    'GATEWAY ISOLATION VIOLATION',
  );

  // Активируем InfoBlockade. Если уже активен — не дублируем.
  let infoBlockadeActivated = false;
  if (!(await isInfoBlockadeActive())) {
    try {
      // B15: advisory lock — сериализует параллельные активации.
      await transaction(async (client) => {
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          ['gateway:info_blockade:activate'],
        );
        // Ре-проверка под lock (double-checked).
        if (await isInfoBlockadeActive()) {return;}
        await activateInfoBlockade(`Нарушение изоляции: ${description}`);
        infoBlockadeActivated = true;
      });
    } catch (e) {
      logger.error({ err: e, violationId }, 'gateway-isolation: failed to activate blockade');
    }
  }

  return { violationId, infoBlockadeActivated };
}

export async function activateInfoBlockade(reason: string): Promise<{ regimeId: UUID | null }> {
  // Порядок: сначала БД (regimes), потом Redis-флаг.
  // Если флаг поставить раньше и делегирование упадёт — состояние
  // рассинхронизировано (Redis блокирует, БД — нет). UNIQUE-индекс
  // uniq_active_regime_type защищает от параллельных INSERT'ов
  // на уровне БД, так что гонки между двумя activateInfoBlockade
  // не создают дубль.
  let regimeId: UUID | null = null;
  const systemActorId = await resolveSystemActor();

  if (systemActorId) {
    try {
      const regimes = await import('../core/regimes/service.js');
      const active = await regimes.getActive();
      const existing = active.find((r) => r.type === 'info_blockade');
      if (existing) {
        regimeId = existing.id;
      } else {
        const regime = await regimes.activateService(
          {
            type: 'info_blockade',
            reason,
            context: { noGatewayData: true },
          },
          systemActorId,
        );
        regimeId = regime.id;
      }
    } catch (e) {
      // Не пробрасываем: middleware должен начать блокировать /gateway/*
      // немедленно, даже если режим в БД не создался. Это рассинхрон,
      // но безопаснее в сторону запрета.
      logger.error(
        { err: e, reason },
        'gateway-isolation: failed to delegate InfoBlockade activation, flag will be set anyway',
      );
    }
  } else {
    logger.warn(
      {},
      'gateway-isolation: no system actor available, skipping regime delegation (Redis flag still set)',
    );
  }

  // Флаг в Redis — быстрый путь для middleware A.1.99.04.
  await redis.set(
    FLAG_KEY,
    JSON.stringify({
      reason,
      activatedAt: new Date().toISOString(),
      regimeId,
    }),
    'EX',
    FLAG_TTL_SEC,
  );

  // Блокируем ключи Совета Шлюза и Гаранта (blacklist session-токенов).
  await blockGatewayKeys();

  logger.warn({ reason, regimeId }, 'gateway-isolation: InfoBlockade activated');
  return { regimeId };
}

export async function liftInfoBlockade(
  reason: string,
  requesterId: UUID,
): Promise<void> {
  // Порядок: сначала БД (regimes), потом Redis-флаг.
  // Если деактивация в БД упадёт — флаг остаётся, блокада сохраняется.
  // Обратный порядок (снять флаг → деактивировать) оставил бы активный
  // режим в БД при снятом флаге — middleware пропускал бы трафик.
  try {
    const regimes = await import('../core/regimes/service.js');
    const active = await regimes.getActive();
    const blockade = active.find((r) => r.type === 'info_blockade');
    if (blockade) {
      await regimes.deactivateService(blockade.id, reason, requesterId);
    }
  } catch (e) {
    logger.error(
      { err: e, requesterId, reason },
      'gateway-isolation: failed to delegate InfoBlockade lift; flag NOT removed',
    );
    throw e;
  }

  await redis.del(FLAG_KEY);
  await unblockGatewayKeys();
  logger.warn({ reason, requesterId }, 'gateway-isolation: InfoBlockade lifted');
}

// B14: продлеваем TTL при каждой проверке — активная блокада не снимается
// сама по истечении FLAG_TTL_SEC.
export async function isInfoBlockadeActive(): Promise<boolean> {
  try {
    const raw = await redis.get(FLAG_KEY);
    if (raw === null) {return false;}
    // B14: продлить TTL.
    await redis.expire(FLAG_KEY, FLAG_TTL_SEC);
    return true;
  } catch {
    // При недоступности Redis — fail closed (считаем блокаду активной,
    // если не можем проверить — безопаснее запретить).
    return true;
  }
}

// -------- Блокировка ключей Шлюза --------

export async function blockGatewayKeys(): Promise<{ blocked: number }> {
  try {
    const { listParticipantsWithRole } = await import('./rbac.js');
    const { revokeAllForParticipant } = await import('./jwt.js');

    const roles: readonly Role[] = [
      Role.GATEWAY_COUNCIL,
      Role.GUARANTOR,
      Role.EXTERNAL_WITNESS,
    ];
    const participantIds = new Set<UUID>();

    for (const role of roles) {
      const ids = await listParticipantsWithRole(role);
      for (const id of ids) {
        participantIds.add(id);
      }
    }

    let blocked = 0;
    for (const pid of participantIds) {
      try {
        await revokeAllForParticipant(pid);
        blocked++;
      } catch (e) {
        logger.warn({ err: e, participantId: pid }, 'failed to revoke sessions');
      }
    }

    logger.warn({ blocked }, 'gateway-isolation: gateway keys blocked');
    return { blocked };
  } catch (e) {
    logger.error({ err: e }, 'gateway-isolation: blockGatewayKeys failed');
    throw new AppError('S3_ERROR', 'Failed to block gateway keys', 500);
  }
}

// Семантика: blacklist-записи access/refresh-токенов живут до своего exp
// (TTL в Redis). Их удаление ослабило бы безопасность — оставляем.
// Пользователи Шлюза после снятия блокады перелогинятся.
// Возвращаем 0 — «нечего откатывать», для парности с blockGatewayKeys.
export async function unblockGatewayKeys(): Promise<{ unblocked: number }> {
  logger.info(
    'gateway-isolation: gateway keys unblocked (session blacklist TTL expires naturally)',
  );
  return { unblocked: 0 };
}

// -------- Сетевые политики --------

// Сетевая политика — метод-независимая. Отвечает на вопрос «разрешена ли
// сетевая связь между узлами», а не «разрешена ли конкретная операция».
// Модель соответствует K8s NetworkPolicy из I.3.10.*.
//
// Разрешено:
//   core ↔ core, core ↔ worker, worker ↔ worker  (один контур)
//   gateway ↔ gateway                             (свой контур)
//   bridge ↔ что угодно                           (мост)
// Запрещено:
//   core ↔ gateway напрямую  (только через bridge)
//   gateway ↔ worker
//   external ↔ что угодно    (только через bridge)
export async function checkNetworkPolicy(
  sourceNode: ServiceNode,
  targetNode: ServiceNode,
): Promise<boolean> {
  if (!sourceNode || !targetNode) {
    return false;
  }

  if (sourceNode === targetNode) {
    return true;
  }

  if (sourceNode === 'bridge' || targetNode === 'bridge') {
    return true;
  }

  if (sourceNode === 'external' || targetNode === 'external') {
    return false;
  }

  const isCoreLike = (n: ServiceNode): boolean => n === 'core' || n === 'worker';

  // Оба в core-контуре (core ↔ core / core ↔ worker / worker ↔ worker).
  if (isCoreLike(sourceNode) && isCoreLike(targetNode)) {
    return true;
  }

  // Всё остальное (core ↔ gateway, worker ↔ gateway, gateway ↔ core, ...) —
  // запрещено напрямую. Bridge — единственный канал.
  return false;
}

// -------- Изолированные ресурсы --------

export function getIsolatedBuckets(): string[] {
  return [
    process.env['S3_BUCKET_GATEWAY'] ?? 'charter-gateway',
  ];
}

export function getIsolatedDatabases(): string[] {
  return [process.env['GATEWAY_DB_NAME'] ?? 'charter_gateway'];
}

export function getGatewayDirectionNumber(): number {
  return GATEWAY_DIRECTION_NUMBER;
}

// -------- Аудит доступа --------

export interface GatewayAuditResult {
  attempts: number;
  violations: number;
  violationsByOperation: Record<string, number>;
  lastViolationAt: string | null;
}

export async function auditGatewayAccess(period = '24h'): Promise<GatewayAuditResult> {
  const hours = parsePeriodHours(period);
  const cutoff = Date.now() - hours * 3600 * 1000;

  let violations: Array<{
    operation: string;
    detectedAt: string;
  }> = [];

  try {
    const raw = await redis.lrange(VIOLATION_LOG_KEY, 0, 999);
    violations = raw
      .map((s) => {
        try {
          return JSON.parse(s) as { operation: string; detectedAt: string };
        } catch {
          return null;
        }
      })
      .filter(
        (v): v is { operation: string; detectedAt: string } =>
          v !== null && new Date(v.detectedAt).getTime() >= cutoff,
      );
  } catch (e) {
    logger.warn({ err: e }, 'gateway-isolation: auditGatewayAccess read failed');
  }

  const byOp: Record<string, number> = {};
  for (const v of violations) {
    byOp[v.operation] = (byOp[v.operation] ?? 0) + 1;
  }

  // TECHDEBT: `attempts` сейчас = числу зафиксированных нарушений за период.
  // Полный счётчик (успешные + отклонённые обращения) требует инкремента
  // в hot-path checkIsolation при core ↔ gateway — это нагрузка на Redis
  // на каждый запрос. Отложено до появления метрик (A.1.90.02).
  return {
    attempts: violations.length,
    violations: violations.length,
    violationsByOperation: byOp,
    lastViolationAt: violations[0]?.detectedAt ?? null,
  };
}

// -------- Системный актор --------

/**
 * Находит участника, от лица которого система выполняет автоматические операции.
 * Приоритет: FIRST_ARCHITECT → первый активный участник → null.
 * Используется только для операций, инициированных системой (не человеком).
 */
async function resolveSystemActor(): Promise<UUID | null> {
  try {
    const { queryOne } = await import('../lib/db.js');

    const arch = await queryOne<{ id: string }>(
      `SELECT id FROM participants
        WHERE is_first_architect = true AND deleted_at IS NULL
        LIMIT 1`,
    );
    if (arch) {return arch.id;}

    // Fallback для тестовых / dev-окружений без Архитектора.
    const first = await queryOne<{ id: string }>(
      `SELECT id FROM participants
        WHERE deleted_at IS NULL
        ORDER BY entered_at ASC
        LIMIT 1`,
    );
    return first?.id ?? null;
  } catch (e) {
    logger.warn({ err: e }, 'gateway-isolation: resolveSystemActor failed');
    return null;
  }
}

function parsePeriodHours(period: string): number {
  const m = /^(\d+)([hdm])$/.exec(period);
  if (!m) {return 24;}
  const nRaw = m[1];
  const unit = m[2];
  if (!nRaw || !unit) {return 24;}
  const n = parseInt(nRaw, 10);
  if (unit === 'h') {return n;}
  if (unit === 'd') {return n * 24;}
  if (unit === 'm') {return Math.max(1, Math.round(n / 60));}
  return 24;
}

// -------- Health / Debug --------

export async function getIsolationStatus(): Promise<{
  infoBlockadeActive: boolean;
  isolatedBuckets: string[];
  isolatedDatabases: string[];
  whitelistCoreToGateway: string[];
  whitelistGatewayToCore: string[];
}> {
  return {
    infoBlockadeActive: await isInfoBlockadeActive(),
    isolatedBuckets: getIsolatedBuckets(),
    isolatedDatabases: getIsolatedDatabases(),
    whitelistCoreToGateway: Array.from(ALLOWED_CORE_TO_GATEWAY),
    whitelistGatewayToCore: Array.from(ALLOWED_GATEWAY_TO_CORE),
  };
}