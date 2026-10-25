// C.0.35.02 — Сервис Админа
// Дашборд, карта мандатов, recovery-очередь, режимы, логи, system status,
// инвалидация кэшей. Мутации уровня Архитектора.
//
// ВАЖНО: почти все read-функции не требуют проверки роли — контроль доступа
// в контроллере (requireRight / assertRole). Здесь только сборка данных.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ForbiddenError } from '../errors.js';
import { FALLBACK_PERMISSIONS } from '../rights.js';
import type { UUID, ISODateTime } from '../types.js';

import type {
  AdminDashboard,
  MandatesMap,
  MandatesMapEntry,
  RecoveryQueueItem,
  SystemStatus,
} from './entity.js';

// -------- Recovery Queue (NEW) --------

export interface RecoveryQueueFilter {
  statuses?: Array<'pending' | 'approved' | 'used' | 'rejected' | 'expired'>;
  page?: number;
  perPage?: number;
}

/**
 * Очередь заявок на восстановление доступа. Публичный список для Совета/
 * Архитектора — чтобы видеть, кого и когда одобрять. Токен в ответе НЕ
 * возвращается (его нет в БД в открытом виде — только hash).
 */
export async function listRecoveryQueue(
  filter: RecoveryQueueFilter = {},
): Promise<{ data: RecoveryQueueItem[]; total: number }> {
  const statuses = filter.statuses ?? ['pending', 'approved'];
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM recovery_requests
      WHERE status = ANY($1::text[])`,
    [statuses],
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  const rows = await query<{
    id: string;
    participant_id: string;
    external_id: string;
    name: string;
    pseudonym: string | null;
    status: RecoveryQueueItem['status'];
    requested_at: Date;
    requested_ip: string | null;
    approved_by: string | null;
    approved_at: Date | null;
    token_expires_at: Date | null;
    used_at: Date | null;
    reject_reason: string | null;
  }>(
    `SELECT rr.id,
            rr.participant_id,
            p.external_id,
            p.name,
            p.pseudonym,
            rr.status,
            rr.requested_at,
            host(rr.requested_ip) AS requested_ip,
            rr.approved_by,
            rr.approved_at,
            rr.token_expires_at,
            rr.used_at,
            rr.reject_reason
       FROM recovery_requests rr
       JOIN participants p ON p.id = rr.participant_id
      WHERE rr.status = ANY($1::text[])
      ORDER BY rr.requested_at DESC
      LIMIT $2 OFFSET $3`,
    [statuses, perPage, offset],
  );

  const data: RecoveryQueueItem[] = rows.map((r) => ({
    requestId: r.id,
    participantId: r.participant_id,
    externalId: r.external_id,
    name: r.name,
    pseudonym: r.pseudonym,
    status: r.status,
    requestedAt: r.requested_at.toISOString(),
    requestedIp: r.requested_ip,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
    tokenExpiresAt: r.token_expires_at ? r.token_expires_at.toISOString() : null,
    usedAt: r.used_at ? r.used_at.toISOString() : null,
    rejectReason: r.reject_reason,
  }));

  return { data, total };
}

// -------- Dashboard --------

export async function getDashboard(_requesterId: UUID): Promise<AdminDashboard> {
  const [pRow, dRow, mRow, sRow, rRow, recRow] = await Promise.all([
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM participants WHERE deleted_at IS NULL`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM directions WHERE status <> 'abolished'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM mandates WHERE status = 'active' AND expires_at > now()`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM signals WHERE status IN ('new','run','connect','plan')`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM regimes WHERE status = 'active'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM recovery_requests WHERE status IN ('pending','approved')`),
  ]);

  return {
    participantsTotal: parseInt(pRow?.c ?? '0', 10),
    directionsTotal:   parseInt(dRow?.c ?? '0', 10),
    activeMandates:    parseInt(mRow?.c ?? '0', 10),
    openSignals:       parseInt(sRow?.c ?? '0', 10),
    activeRegimes:     parseInt(rRow?.c ?? '0', 10),
    recoveryPending:   parseInt(recRow?.c ?? '0', 10),
    updatedAt: new Date().toISOString(),
  };
}

// -------- Mandates Map --------

export async function getMandatesMap(_requesterId: UUID): Promise<MandatesMap> {
  const rows = await query<{
    direction_id: string | null;
    holder_id: string;
    function: string;
    expires_at: Date;
  }>(
    `SELECT direction_id, holder_id, function, expires_at
       FROM mandates
      WHERE status = 'active' AND expires_at > now()`,
  );

  // Архитектор считается держателем FIRST_ARCHITECT-мандата (если есть).
  const architectRow = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE is_first_architect = true AND deleted_at IS NULL LIMIT 1`,
  );
  const architectId = architectRow?.id ?? null;

  const directions: MandatesMapEntry[] = [];
  const heldByArchitect: string[] = [];
  const delegated: Array<{ function: string; holderId: UUID; validTo: ISODateTime }> = [];

  for (const r of rows) {
    if (architectId && r.holder_id === architectId) {
      heldByArchitect.push(r.function);
      continue;
    }
    if (r.direction_id) {
      directions.push({
        directionId: r.direction_id,
        holderId: r.holder_id,
        function: r.function,
        expiresAt: r.expires_at.toISOString(),
      });
    } else {
      delegated.push({
        function: r.function,
        holderId: r.holder_id,
        validTo: r.expires_at.toISOString(),
      });
    }
  }

  return {
    directions,
    heldByArchitect,
    delegated,
    updatedAt: new Date().toISOString(),
  };
}

// -------- Regimes (обёртка над C.0.17.02) --------

export async function listRegimes(_requesterId: UUID) {
  const regimes = await import('../regimes/service.js');
  return regimes.list();
}

export async function exportLogs(
  filter: AdminLogFilter,
  format: 'csv' | 'json',
  _requesterId: UUID,
) {
  const audit = await import('../../security/audit-log.js');
  return audit.exportEntries(
    {
      ...(filter.actorId !== undefined ? { actorId: filter.actorId } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
    },
    format,
  );
}

// -------- System status --------

export async function getSystemStatus(): Promise<SystemStatus> {
  const [db, cache] = await Promise.allSettled([
    import('../../lib/db.js').then((m) => m.healthCheck()),
    import('../../lib/redis.js').then((m) => m.healthCheck()),
  ]);

  const dbOk = db.status === 'fulfilled' && db.value.primary;
  const redisOk = cache.status === 'fulfilled' && cache.value;
  const version = (await import('../../api/system/version.js')).version;

  return {
    healthy: dbOk && redisOk,
    services: {
      db: dbOk ? 'ok' : 'fail',
      redis: redisOk ? 'ok' : 'fail',
    },
    uptimeSec: Math.round(process.uptime()),
    version,
  };
}

// -------- Cache invalidation --------

// Префиксы кэшей, которые разрешено инвалидировать одним вызовом.
// Специально НЕ включаем session:*, blacklist:*, idempotency:* — они
// содержат auth-состояние, сброс сломает активные сессии.
const ALLOWED_CACHE_PREFIXES: readonly string[] = [
  'roles:',
  'rights:matrix:',
  'regime:context:',
  'directions:all',
  'participant:v2:',
  'cell-tree:',
  'constructor:panel:',
  'ui:',
];

export async function invalidateAllCaches(requesterId: UUID): Promise<{ invalidated: number }> {
  let total = 0;
  for (const prefix of ALLOWED_CACHE_PREFIXES) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        total += keys.length;
      }
    } while (cursor !== '0');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'admin.invalidate_caches',
    entityType: 'system',
    entityId: newUUID(),
    newValue: { invalidated: total, prefixes: ALLOWED_CACHE_PREFIXES.length },
  });

  logger.info({ requesterId, invalidated: total }, 'admin: caches invalidated');
  return { invalidated: total };
}

// -------- Can delegate (заглушка — детальная логика в C.0.05.02) --------

export async function canDelegate(requesterId: UUID, _functionName: string): Promise<boolean> {
  // Право делегировать — только у Архитектора (I.1.10).
  const row = await queryOne<{ is_first_architect: boolean }>(
    `SELECT is_first_architect FROM participants
      WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [requesterId],
  );
  if (!row) { throw new NotFoundError('Участник', requesterId); }
  return row.is_first_architect === true;
}

/**
 * Делегирование функции от Архитектора другому участнику.
 * Обёртка над C.0.05.02.createMandateService с админ-специфичными проверками:
 *
 *   - holderId ≠ requesterId: через admin.delegate нельзя выдать мандат
 *     самому Архитектору — для этого есть обычный POST /mandates. Разделение
 *     нужно, чтобы UI однозначно понимал намерение пользователя.
 *
 *   - canDelegate(requesterId): проверка, что requester — Архитектор
 *     (дублирует requireArchitect из контроллера; сервис защищается сам).
 *
 * Все остальные проверки (конфликты ролей, срок, cooldown) выполняет
 * createMandateService — см. C.0.05.02.
 */
export async function delegate(
  input: {
    function: string;
    holderId: UUID;
    directionId?: UUID;
    expiresAt: ISODateTime;
    conditions?: Record<string, unknown>;
    scope?: Record<string, unknown>;
  },
  requesterId: UUID,
): Promise<{
  id: UUID;
  function: string;
  holderId: UUID;
  directionId: UUID | null;
  grantedAt: ISODateTime;
  expiresAt: ISODateTime;
  status: string;
}> {
  // 1. Архитектор не делегирует сам себе через admin.delegate.
  if (input.holderId === requesterId) {
    throw new ConflictError(
      'admin.delegate не создаёт мандат самому Архитектору — используйте POST /mandates',
    );
  }

  // 2. Проверка, что requester — Архитектор.
  const allowed = await canDelegate(requesterId, input.function);
  if (!allowed) {
    throw new ForbiddenError('Делегирование доступно только Архитектору');
  }

  // 3. Делегировать в C.0.05.02.
  const mandates = await import('../mandates/service.js');
  const mandate = await mandates.createMandateService(
    {
      function: input.function,
      holderId: input.holderId,
      ...(input.directionId ? { directionId: input.directionId } : {}),
      expiresAt: input.expiresAt,
      ...(input.conditions ? { conditions: input.conditions } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
    },
    requesterId,
  );

  return {
    id: mandate.id,
    function: mandate.function,
    holderId: mandate.holderId,
    directionId: mandate.directionId,
    grantedAt: mandate.grantedAt,
    expiresAt: mandate.expiresAt,
    status: mandate.status,
  };
}

/**
 * Ротация мандата. Обёртка над C.0.05.02.rotateMandateService.
 * Проверка, что requester — Архитектор, выполняется в контроллере
 * (requireArchitect). Дополнительно проверяем, что он не пытается
 * ротировать мандат на самого себя — это бессмысленная операция.
 *
 * NB: ROTATE-семантика — «передать функцию преемнику». Исходный holder
 * получает cooldown согласно политике роли (I.4.1.8). Мандат НЕ удаляется,
 * а помечается status='expired'; создаётся новый мандат на successorId.
 */
export async function rotate(
  input: { mandateId: UUID; successorId: UUID },
  requesterId: UUID,
): Promise<{ old: unknown; next: unknown }> {
  // 1. Получить мандат, чтобы проверить, что он существует и активен.
  const mandate = await queryOne<{ holder_id: string; status: string }>(
    `SELECT holder_id, status FROM mandates WHERE id = $1`,
    [input.mandateId],
  );
  if (!mandate) {
    throw new NotFoundError('Мандат', input.mandateId);
  }
  if (mandate.status !== 'active') {
    throw new ConflictError(`Мандат в статусе '${mandate.status}' — ротация невозможна`);
  }

  // 2. Запрет ротации на самого держателя.
  if (mandate.holder_id === input.successorId) {
    throw new ConflictError('Преемник не может совпадать с текущим держателем');
  }

  // 3. Делегировать в C.0.05.02.
  const mandates = await import('../mandates/service.js');
  const result = await mandates.rotateMandateService(
    input.mandateId,
    input.successorId,
    requesterId,
  );

  return result;
}

// -------- Seed (админский) --------
//
// Идемпотентная «добивка» справочников до дефолтного состояния.
// Источники:
//   - directions / roles / interview_questions — из D.2.01.07 (007_seeds.sql)
//   - widgets / containers — из D.2.01.17 / D.2.01.18
//   - rights_matrix — материализация FALLBACK_PERMISSIONS (C.0.01.06) в БД
//
// Все запросы идемпотентны через ON CONFLICT DO NOTHING. Повторный вызов
// возвращает нули (кроме rights_matrix, где для новых ролей могут появиться
// новые записи).

export type SeedTemplate =
  | 'directions'
  | 'roles'
  | 'interview_questions'
  | 'widgets'
  | 'containers'
  | 'rights_matrix'
  | 'all';

export interface SeedResult {
  templates: Record<SeedTemplate, number>;
  totalInserted: number;
}

// С D.2.01.20 на roles и interview_questions появились UNIQUE-индексы
// (uniq_roles_direction_name, uniq_interview_questions_cat_q_ver), поэтому
// ON CONFLICT DO NOTHING работает — seed стал полностью идемпотентным.
const ALL_TEMPLATES: readonly SeedTemplate[] = [
  'directions',
  'roles',
  'interview_questions',
  'widgets',
  'containers',
  'rights_matrix',
];

export async function seedTemplates(
  templates: SeedTemplate[],
  requesterId: UUID,
): Promise<SeedResult> {
  const selected = templates.length === 0 || templates.includes('all')
    ? [...ALL_TEMPLATES]
    : templates.filter((t) => t !== 'all');

  const result: Record<SeedTemplate, number> = {
    directions: 0,
    roles: 0,
    interview_questions: 0,
    widgets: 0,
    containers: 0,
    rights_matrix: 0,
    all: 0,
  };

  for (const tpl of selected) {
    if (tpl === 'all') {continue;}
    result[tpl] = await seedOne(tpl);
  }
  // Панели (D.2.01.34) создаются миграцией, но на чистой базе библиотека
  // виджетов ещё пуста — панели остаются без виджетов. Добиваем их здесь,
  // после widgets, чтобы установка «с нуля» давала рабочие панели.
  if (selected.includes('widgets')) {
    await seedPanels();
  }
  result.all = ALL_TEMPLATES.reduce((s, t) => s + result[t], 0);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'admin.seed',
    entityType: 'system',
    entityId: newUUID(),
    newValue: { templates: selected, inserted: result },
  });

  logger.info({ requesterId, selected, inserted: result }, 'admin: seed complete');
  return { templates: result, totalInserted: result.all };
}

async function seedOne(tpl: SeedTemplate): Promise<number> {
  switch (tpl) {
    case 'directions':          return seedDirections();
    case 'roles':               return seedRoles();
    case 'interview_questions': return seedInterviewQuestions();
    case 'widgets':             return seedWidgets();
    case 'containers':          return seedContainers();
    case 'rights_matrix':       return seedRightsMatrix();
    default:                    return 0;
  }
}

async function seedDirections(): Promise<number> {
  const rows = await query<{ x: number }>(`
    INSERT INTO directions (number, name, type, status, zone_exclusive, zone_shared, zone_adjacent)
    VALUES
      (1,  'Жизнеобеспечение',                 'permanent', 'active', '["производство","логистика","склад"]'::jsonb, '["стандарты","модификаторы"]'::jsonb, '["энергия","транспорт"]'::jsonb),
      (2,  'Здравие',                           'permanent', 'active', '["медицина","реабилитация","фарма"]'::jsonb, '["психоэкология","стандарты"]'::jsonb, '["здоровье","возраст"]'::jsonb),
      (3,  'Энергия и Среда',                   'permanent', 'active', '["энергия","экология","климат"]'::jsonb, '["производство","транспорт"]'::jsonb, '["жизнеобеспечение"]'::jsonb),
      (4,  'Трансляция Контекста',              'permanent', 'active', '["перевод","документы","смыслы"]'::jsonb, '["архив","семантика"]'::jsonb, '["образование","ноология"]'::jsonb),
      (5,  'Когнитивная Логистика',             'permanent', 'active', '["маршрутизация","префильтрация","связь"]'::jsonb, '["сигналы"]'::jsonb, '["ноология","трансляция"]'::jsonb),
      (6,  'Ноология',                          'permanent', 'active', '["смыслы","семантика","каталог"]'::jsonb, '["образование","перевод"]'::jsonb, '["когнитивная логистика"]'::jsonb),
      (7,  'Инженерия Обнуления',               'permanent', 'active', '["ликвидация","утилизация","архив"]'::jsonb, '["верификация"]'::jsonb, '["жизнеобеспечение"]'::jsonb),
      (8,  'Балансировка',                      'permanent', 'active', '["метрики","аномалии","нормативы"]'::jsonb, '["верификация"]'::jsonb, '["все"]'::jsonb),
      (9,  'Кибернетика и Протокол',            'permanent', 'active', '["алгоритмы","инфраструктура","безопасность"]'::jsonb, '["верификация"]'::jsonb, '["инженерия"]'::jsonb),
      (10, 'Искусство и Резонанс',              'permanent', 'active', '["культура","творчество","резонанс"]'::jsonb, '["психоэкология","образование"]'::jsonb, '["трансляция"]'::jsonb),
      (11, 'Социальная Инкубация',              'permanent', 'active', '["онбординг","наставничество","ячейки"]'::jsonb, '["психоэкология","образование"]'::jsonb, '["правозащита"]'::jsonb),
      (12, 'Психоэкология',                     'permanent', 'active', '["гигиена смыслов","наблюдатели","кризисы"]'::jsonb, '["здравие","справедливость"]'::jsonb, '["социнкубация"]'::jsonb),
      (13, 'Верификация и Надёжность',          'permanent', 'active', '["аудит","перепроверка","целостность"]'::jsonb, '[]'::jsonb, '["все"]'::jsonb),
      (14, 'Знание и Образование',              'permanent', 'active', '["курсы","маршруты","ПТТ","кванты"]'::jsonb, '["ноология"]'::jsonb, '["трансляция"]'::jsonb),
      (15, 'Внешний шлюз',                      'temporary', 'active', '["внешние сделки","дипломатия"]'::jsonb, '[]'::jsonb, '[]'::jsonb),
      (16, 'Сетевая экосистема',                'temporary', 'active', '["инфраструктура","сети"]'::jsonb, '[]'::jsonb, '["кибернетика"]'::jsonb),
      (17, 'Правозащита и Восстановление',      'permanent', 'active', '["заявления","расследования","санкции"]'::jsonb, '["психоэкология"]'::jsonb, '["справедливость"]'::jsonb)
    ON CONFLICT (number) DO NOTHING
    RETURNING 1 AS x
  `);
  return rows.length;
}


async function getFirstArchitectId(): Promise<UUID | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM participants
      WHERE is_first_architect = true AND deleted_at IS NULL
      LIMIT 1`,
  );
  return row?.id ?? null;
}

async function seedRoles(): Promise<number> {
  // Базовые роли × все активные направления + ASSOCIATED.
  // UNIQUE (direction_id, name) — D.2.01.20, поэтому ON CONFLICT DO NOTHING
  // реально работает.
  //
  // Раньше здесь стояло «number BETWEEN 1 AND 14»: направления 15 (Внешний
  // шлюз), 16 (Сетевая экосистема) и 17 (Правозащита) оставались без ролей,
  // и участник такого направления не мог получить ни ASSOCIATED, ни OTC.
  //
  // ASSOCIATED — статусная роль, в схеме D.2.01.07 не была. Добавлена здесь,
  // чтобы bootstrap-participant (I.9.02.03) находил существующую запись,
  // а не создавал её ad-hoc.
  const rows = await query<{ x: number }>(`
    INSERT INTO roles (direction_id, name, type, max_term_days, max_terms, cooldown_days, conflicts_with)
    SELECT d.id, r.name, r.type::role_type_enum, r.max_term_days, r.max_terms, r.cooldown_days, r.conflicts_with::jsonb
    FROM directions d
    CROSS JOIN (VALUES
      ('COUNCIL_MEMBER', 'temporary', 180,  2,    180,  '["LIAISON","OPERATOR","GATEWAY_COUNCIL"]'),
      ('OTC',            'temporary', 180,  1,    180,  '["COUNCIL_MEMBER","OPERATOR"]'),
      ('LIAISON',        'temporary', 365,  2,    365,  '["COUNCIL_MEMBER","OTC","OPERATOR"]'),
      ('VERIFIER',       'temporary', 365,  2,    365,  '[]'),
      ('BALANCER',       'temporary', 365,  2,    365,  '["OPERATOR"]'),
      ('KEEPER',         'permanent', NULL, NULL, NULL, '["OPERATOR"]'),
      ('PSY',            'permanent', NULL, NULL, NULL, '[]'),
      ('OBLIVION',       'permanent', NULL, NULL, NULL, '[]'),
      ('ASSOCIATED',     'permanent', 1095, NULL, NULL, '[]')
    ) AS r(name, type, max_term_days, max_terms, cooldown_days, conflicts_with)
    WHERE d.status = 'active'
    ON CONFLICT (direction_id, name) DO NOTHING
    RETURNING 1 AS x
  `);
  return rows.length;
}

async function seedInterviewQuestions(): Promise<number> {
  const rows = await query<{ x: number }>(`
    INSERT INTO interview_questions (category, question, version, active)
    VALUES
      ('мотивация',              'Почему вы хотите присоединиться к Хартии?',                        1, true),
      ('мотивация',              'Что для вас означает «служение цивилизации»?',                    1, true),
      ('работа с неопределённостью', 'Опишите случай, когда вы действовали в условиях полной неясности.', 1, true),
      ('работа с неопределённостью', 'Как вы принимаете решения, когда данных недостаточно?',       1, true),
      ('доминирование',          'Как вы реагируете, когда вашу идею отвергают?',                   1, true),
      ('доминирование',          'Готовы ли вы отказаться от своей позиции в пользу консенсуса?',   1, true),
      ('эмпатия',                'Как вы понимаете, что человек рядом нуждается в помощи?',         1, true),
      ('эмпатия',                'Приведите пример, когда вы помогли кому-то без выгоды для себя.', 1, true),
      ('рефлексия',              'Что вы делаете, когда понимаете, что ошиблись?',                  1, true),
      ('рефлексия',              'Как вы относитесь к критике в свой адрес?',                       1, true),
      ('наставничество',         'Случалось ли вам обучать кого-то? Как вы это делали?',            1, true),
      ('технические навыки',     'Опишите ваш самый сложный технический проект.',                   1, true),
      ('технические навыки',     'Как вы относитесь к работе с legacy-кодом?',                      1, true),
      ('предпочтения по направлению', 'Какое из 14 направлений вам ближе и почему?',                1, true)
    ON CONFLICT (category, question, version) DO NOTHING
    RETURNING 1 AS x
  `);
  return rows.length;
}

async function seedWidgets(): Promise<number> {
  const arch = await getFirstArchitectId();
  if (!arch) {
    throw new ConflictError(
      'Нельзя сидить виджеты без Архитектора — сначала bootstrap',
    );
  }

  // Идемпотентно по каждой паре (type, entity): на чистой базе вставляем всё,
  // на существующей — только недостающее (например, добавленные позже
  // my_tasks / otc_queue / total_flow из D.2.01.35).
  const rows = await query<{ x: number }>(
    `INSERT INTO widgets (type, entity, config, default_rights, created_by)
     SELECT v.type, v.entity, v.config::jsonb, '{}'::jsonb, $1
       FROM (VALUES
         ('metric',   'flows',       '{"label":"Основной баланс","value":0}'),
         ('progress', 'capsule',     '{"label":"Капсула","max":180,"value":0}'),
         ('circular', 'regimes',     '{"label":"Активный режим","max":100,"value":0}'),
         ('table',    'tasks',       '{"columns":[{"key":"externalId","title":"ID"},{"key":"description","title":"Описание"},{"key":"priority","title":"Приоритет"},{"key":"status","title":"Статус"}]}'),
         ('table',    'my_tasks',    '{"columns":[{"key":"externalId","title":"ID"},{"key":"description","title":"Описание"},{"key":"status","title":"Статус"},{"key":"deadline","title":"Срок"}]}'),
         ('table',    'otc_queue',   '{"columns":[{"key":"externalId","title":"ID"},{"key":"description","title":"Описание"},{"key":"submittedAt","title":"Сдан"}]}'),
         ('list',     'signals',     '{"titleKey":"externalId","emptyText":"Нет открытых сигналов"}'),
         ('card',     'passport',    '{"fields":[{"key":"externalId","title":"ID"},{"key":"name","title":"Имя"},{"key":"directionId","title":"Направление"}]}'),
         ('chart',    'balance',     '{"chartType":"line","xKey":"date","series":[{"key":"value","label":"Значение"}]}'),
         ('metric',   'total_flow',  '{"label":"Поток всего","value":0}'),
         ('map',      'communities', '{"zoom":4}'),
         ('timeline', 'archive',     '{}'),
         ('tree',     'cells',       '{}')
       ) AS v(type, entity, config)
      WHERE NOT EXISTS (
        SELECT 1 FROM widgets w WHERE w.type = v.type AND w.entity = v.entity
      )
     RETURNING 1 AS x`,
    [arch],
  );
  return rows.length;
}

// -------- Панели на чистой установке --------
//
// Миграция D.2.01.34 создаёт панели, но на чистой базе библиотека виджетов к
// этому моменту ещё пуста (017 пропускается без Архитектора). В результате
// панели существуют, но пусты. Добиваем их после seedWidgets.

interface PanelSpec {
  type: string;
  entity: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
}

const DIRECTION_SPECS: PanelSpec[] = [
  { type: 'table', entity: 'tasks', x: 0, y: 0, w: 8, h: 4, title: 'Задачи направления' },
  { type: 'list', entity: 'signals', x: 8, y: 0, w: 4, h: 4, title: 'Сигналы' },
  { type: 'metric', entity: 'flows', x: 0, y: 4, w: 4, h: 3, title: 'Потоки' },
  { type: 'tree', entity: 'cells', x: 4, y: 4, w: 4, h: 3, title: 'Ячейки' },
  { type: 'timeline', entity: 'archive', x: 8, y: 4, w: 4, h: 3, title: 'Архив' },
];

const ROLE_PROFILES: Record<string, PanelSpec[]> = {
  executor: [
    { type: 'card', entity: 'passport', x: 0, y: 0, w: 4, h: 3, title: 'Мой паспорт' },
    { type: 'table', entity: 'my_tasks', x: 4, y: 0, w: 8, h: 4, title: 'Мои задачи' },
    { type: 'progress', entity: 'capsule', x: 0, y: 3, w: 4, h: 3, title: 'Капсула Потока' },
    { type: 'list', entity: 'signals', x: 4, y: 4, w: 8, h: 3, title: 'Сигналы направления' },
  ],
  reviewer: [
    { type: 'table', entity: 'otc_queue', x: 0, y: 0, w: 8, h: 4, title: 'Очередь на проверку' },
    { type: 'list', entity: 'signals', x: 8, y: 0, w: 4, h: 4, title: 'Сигналы' },
    { type: 'timeline', entity: 'archive', x: 0, y: 4, w: 6, h: 3, title: 'Архив' },
    { type: 'metric', entity: 'flows', x: 6, y: 4, w: 6, h: 3, title: 'Потоки' },
  ],
  analyst: [
    { type: 'chart', entity: 'balance', x: 0, y: 0, w: 6, h: 4, title: 'Баланс' },
    { type: 'metric', entity: 'flows', x: 6, y: 0, w: 6, h: 4, title: 'Потоки' },
    { type: 'list', entity: 'signals', x: 0, y: 4, w: 12, h: 3, title: 'Сигналы' },
  ],
  curator: [
    { type: 'table', entity: 'tasks', x: 0, y: 0, w: 8, h: 4, title: 'Задачи направления' },
    { type: 'chart', entity: 'balance', x: 8, y: 0, w: 4, h: 4, title: 'Баланс направления' },
    { type: 'list', entity: 'signals', x: 0, y: 4, w: 6, h: 3, title: 'Сигналы' },
    { type: 'map', entity: 'communities', x: 6, y: 4, w: 6, h: 3, title: 'Общины' },
  ],
  architect: [
    { type: 'table', entity: 'tasks', x: 0, y: 0, w: 8, h: 4, title: 'Все задачи' },
    { type: 'list', entity: 'signals', x: 8, y: 0, w: 4, h: 4, title: 'Сигналы' },
    { type: 'chart', entity: 'balance', x: 0, y: 4, w: 4, h: 3, title: 'Мой Поток' },
    { type: 'metric', entity: 'flows', x: 4, y: 4, w: 4, h: 3, title: 'Потоки' },
    { type: 'tree', entity: 'cells', x: 8, y: 4, w: 4, h: 3, title: 'Ячейки' },
    { type: 'map', entity: 'communities', x: 0, y: 7, w: 6, h: 3, title: 'Общины' },
    { type: 'timeline', entity: 'archive', x: 6, y: 7, w: 6, h: 3, title: 'Архив' },
  ],
};

const ROLE_PROFILE_OF: Record<string, keyof typeof ROLE_PROFILES> = {
  ASSOCIATED: 'executor',
  OPERATOR: 'executor',
  NOOLOG: 'executor',
  LIAISON: 'executor',
  OTC: 'reviewer',
  VERIFIER: 'reviewer',
  KEEPER: 'reviewer',
  BALANCER: 'analyst',
  AGGREGATOR: 'analyst',
  PROTOCOL_COUNCIL: 'analyst',
  PSY: 'analyst',
  COUNCIL_MEMBER: 'curator',
  FIRST_ARCHITECT: 'architect',
};

const CRISIS_SPECS: PanelSpec[] = [
  { type: 'circular', entity: 'regimes', x: 0, y: 0, w: 6, h: 4, title: 'Режимы' },
  { type: 'list', entity: 'signals', x: 6, y: 0, w: 6, h: 4, title: 'Сигналы' },
];

async function seedPanels(): Promise<number> {
  const arch = await getFirstArchitectId();
  if (!arch) {return 0;}

  // 1. Панели направлений. Миграция 034 пропускается, если Архитектора ещё
  //    нет, — на чистой базе панелей не будет вовсе.
  const dirs = await query<{ id: string; number: number; name: string }>(
    `SELECT d.id, d.number, d.name
       FROM directions d
      WHERE NOT EXISTS (
        SELECT 1 FROM panels p
         WHERE p.direction_id = d.id AND p.role_id IS NULL AND p.context = 'normal'
      )
      ORDER BY d.number`,
  );
  for (const d of dirs) {
    await query(
      `INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
       VALUES ($1, NULL, $2, 'normal', 1, true, $3)`,
      [`Направление ${d.number}: ${d.name}`, d.id, arch],
    );
  }

  // 2. Панели ролей — по одной на функцию (привязка к любой строке роли).
  for (const roleName of Object.keys(ROLE_PROFILE_OF)) {
    const exists = await queryOne<{ x: number }>(
      `SELECT 1 AS x FROM panels p JOIN roles r ON r.id = p.role_id
        WHERE r.name = $1 AND p.context = 'normal' AND p.direction_id IS NULL
        LIMIT 1`,
      [roleName],
    );
    if (exists) {continue;}
    const role = await queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = $1 ORDER BY direction_id LIMIT 1`,
      [roleName],
    );
    if (!role) {continue;}
    await query(
      `INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
       VALUES ($1, $2, NULL, 'normal', 1, true, $3)`,
      [`Роль: ${roleName}`, role.id, arch],
    );
  }

  // 3. Кризисные панели.
  for (const roleName of ['FIRST_ARCHITECT', 'COUNCIL_MEMBER']) {
    const exists = await queryOne<{ x: number }>(
      `SELECT 1 AS x FROM panels p JOIN roles r ON r.id = p.role_id
        WHERE r.name = $1 AND p.context = 'crisis' LIMIT 1`,
      [roleName],
    );
    if (exists) {continue;}
    const role = await queryOne<{ id: string }>(
      `SELECT id FROM roles WHERE name = $1 ORDER BY direction_id LIMIT 1`,
      [roleName],
    );
    if (!role) {continue;}
    await query(
      `INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
       VALUES ($1, $2, NULL, 'crisis', 1, true, $3)`,
      [`Кризис: ${roleName}`, role.id, arch],
    );
  }

  // 4. Виджеты в панели, где их нет.
  const empty = await query<{
    id: string;
    context: string;
    role_id: string | null;
    direction_id: string | null;
  }>(
    `SELECT p.id, p.context::text AS context, p.role_id, p.direction_id
       FROM panels p
      WHERE NOT EXISTS (SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id)`,
  );

  const widgetRows = await query<{ id: string; type: string; entity: string }>(
    `SELECT id, type, entity FROM widgets`,
  );
  const widgetId = new Map<string, string>();
  for (const w of widgetRows) {widgetId.set(`${w.type}/${w.entity}`, w.id);}

  let inserted = 0;
  for (const panel of empty) {
    let specs: PanelSpec[] = [];
    if (panel.context === 'crisis') {
      specs = CRISIS_SPECS;
    } else if (panel.role_id) {
      const role = await queryOne<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`, [panel.role_id],
      );
      const profile = role ? ROLE_PROFILE_OF[role.name] : undefined;
      if (profile) {specs = ROLE_PROFILES[profile] ?? [];}
    } else if (panel.direction_id) {
      specs = DIRECTION_SPECS;
    }

    for (const spec of specs) {
      const wid = widgetId.get(`${spec.type}/${spec.entity}`);
      if (!wid) {continue;}
      await query(
        `INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
         VALUES ($1, $2,
                 jsonb_build_object('x', $3::int, 'y', $4::int),
                 jsonb_build_object('w', $5::int, 'h', $6::int),
                 $7::jsonb)`,
        [
          panel.id, wid, spec.x, spec.y, spec.w, spec.h,
          JSON.stringify(spec.title ? { title: spec.title } : {}),
        ],
      );
      inserted += 1;
    }
  }
  return inserted;
}

async function seedContainers(): Promise<number> {
  const arch = await getFirstArchitectId();
  if (!arch) {return 0;}

  const exists = await queryOne<{ x: number }>(
    `SELECT 1 AS x FROM widgets
      WHERE type = 'container' AND entity = 'layout'
      LIMIT 1`,
  );
  if (exists) {return 0;}

  const rows = await query<{ x: number }>(
    `INSERT INTO widgets (type, entity, config, default_rights, created_by)
     VALUES ('container', 'layout', '{"title":"Контейнер"}'::jsonb, '{}'::jsonb, $1)
     RETURNING 1 AS x`,
    [arch],
  );
  return rows.length;
}

/**
 * Материализация FALLBACK_PERMISSIONS в rights_matrix.
 *
 * Для каждой роли × ресурса × действия — INSERT для всех role_id с этим
 * name (в БД одна и та же роль существует для каждого из 14 направлений).
 * Ресурсы вида '*' (wildcard для FIRST_ARCHITECT) вставляются как есть —
 * C.0.01.06.checkInMatrix ищет universal через rolePerms.get('*').
 *
 * Идемпотентно: ON CONFLICT DO NOTHING по UNIQUE(role_id, resource, action,
 * scope, version).
 *
 * TECHDEBT: выполняется O(roles × resources × actions) отдельных запросов.
 * Для seed-операции (запускается вручную) — приемлемо. При необходимости
 * ускорить — батчить через UNNEST.
 */
async function seedRightsMatrix(): Promise<number> {
  let total = 0;
  for (const [role, resources] of Object.entries(FALLBACK_PERMISSIONS)) {
    if (!resources) {continue;}
    for (const [resource, actions] of Object.entries(resources)) {
      if (!actions || actions.length === 0) {continue;}
      for (const action of actions) {
        const rows = await query<{ x: number }>(
          `INSERT INTO rights_matrix (role_id, resource, action, scope, version)
           SELECT r.id, $2, $3::right_action_enum, 'all'::right_scope_enum, 1
           FROM roles r
           WHERE r.name = $1
           ON CONFLICT (role_id, resource, action, scope, version) DO NOTHING
           RETURNING 1 AS x`,
          [role, resource, action],
        );
        total += rows.length;
      }
    }
  }
  return total;
}

// -------- Admin: участники --------

export interface AdminParticipantFilter {
  directionId?: UUID;
  status?: string;
  search?: string;      // по name / external_id / pseudonym
  page?: number;
  perPage?: number;
}

export interface AdminParticipantRow {
  id: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: string;
  profileRisk: string;
  directionId: UUID | null;
  directionNumber: number | null;
  directionName: string | null;
  mentorId: UUID | null;
  cellId: UUID | null;
  enteredAt: ISODateTime;
  welcomePackGiven: boolean;
  isFirstArchitect: boolean;
}

export async function listParticipantsAdmin(
  filter: AdminParticipantFilter,
): Promise<{ data: AdminParticipantRow[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.directionId) {
    params.push(filter.directionId);
    conditions.push(`p.direction_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    const idx = params.length;
    conditions.push(`(
      p.name ILIKE $${idx} OR
      p.external_id ILIKE $${idx} OR
      p.pseudonym ILIKE $${idx}
    )`);
  }

  const where = conditions.join(' AND ');

  const countRow = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM participants p WHERE ${where}`,
    params,
  );
  const total = parseInt(countRow?.c ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<{
    id: string; external_id: string; name: string; pseudonym: string | null;
    status: string; profile_risk: string;
    direction_id: string | null; direction_number: number | null; direction_name: string | null;
    mentor_id: string | null; cell_id: string | null;
    entered_at: Date; welcome_pack_given: boolean; is_first_architect: boolean;
  }>(
    `SELECT p.id, p.external_id, p.name, p.pseudonym, p.status, p.profile_risk,
            p.direction_id, d.number AS direction_number, d.name AS direction_name,
            p.mentor_id, p.cell_id, p.entered_at, p.welcome_pack_given,
            p.is_first_architect
       FROM participants p
       LEFT JOIN directions d ON d.id = p.direction_id
      WHERE ${where}
      ORDER BY p.entered_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const data: AdminParticipantRow[] = rows.map((r) => ({
    id: r.id,
    externalId: r.external_id,
    name: r.name,
    pseudonym: r.pseudonym,
    status: r.status,
    profileRisk: r.profile_risk,
    directionId: r.direction_id,
    directionNumber: r.direction_number,
    directionName: r.direction_name,
    mentorId: r.mentor_id,
    cellId: r.cell_id,
    enteredAt: r.entered_at.toISOString(),
    welcomePackGiven: r.welcome_pack_given,
    isFirstArchitect: r.is_first_architect,
  }));

  return { data, total };
}

export async function getParticipantAdmin(id: UUID): Promise<AdminParticipantRow> {
  const r = await queryOne<{
    id: string; external_id: string; name: string; pseudonym: string | null;
    status: string; profile_risk: string;
    direction_id: string | null; direction_number: number | null; direction_name: string | null;
    mentor_id: string | null; cell_id: string | null;
    entered_at: Date; welcome_pack_given: boolean; is_first_architect: boolean;
  }>(
    `SELECT p.id, p.external_id, p.name, p.pseudonym, p.status, p.profile_risk,
            p.direction_id, d.number AS direction_number, d.name AS direction_name,
            p.mentor_id, p.cell_id, p.entered_at, p.welcome_pack_given,
            p.is_first_architect
       FROM participants p
       LEFT JOIN directions d ON d.id = p.direction_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id],
  );
  if (!r) {throw new NotFoundError('Участник', id);}
  return {
    id: r.id,
    externalId: r.external_id,
    name: r.name,
    pseudonym: r.pseudonym,
    status: r.status,
    profileRisk: r.profile_risk,
    directionId: r.direction_id,
    directionNumber: r.direction_number,
    directionName: r.direction_name,
    mentorId: r.mentor_id,
    cellId: r.cell_id,
    enteredAt: r.entered_at.toISOString(),
    welcomePackGiven: r.welcome_pack_given,
    isFirstArchitect: r.is_first_architect,
  };
}

export interface AdminUpdateParticipantInput {
  name?: string;
  pseudonym?: string | null;
  status?: string;
  directionId?: UUID;
  mentorId?: UUID | null;
}

const VALID_STATUSES = new Set([
  'compatible', 'conditionally_compatible', 'associated', 'full',
  'paused', 'outside_trust_network', 'master', 'integrator',
  'pioneer', 'excluded',
]);

export async function updateParticipantAdmin(
  id: UUID,
  input: AdminUpdateParticipantInput,
  requesterId: UUID,
): Promise<AdminParticipantRow> {
  const before = await getParticipantAdmin(id);

  // Архитектора нельзя менять через admin-панель: это его собственная
  // учётная запись, изменяется через /me/profile.
  if (before.isFirstArchitect) {
    throw new ConflictError(
      'Первого Архитектора нельзя изменять через admin-панель — используйте /me',
    );
  }

  if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
    throw new ConflictError(`Недопустимый статус: ${input.status}`);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    if (!input.name.trim()) {
      throw new ConflictError('Имя не может быть пустым');
    }
    params.push(input.name.trim());
    sets.push(`name = $${params.length}`);
  }
  if (input.pseudonym !== undefined) {
    params.push(input.pseudonym);
    sets.push(`pseudonym = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  if (input.directionId !== undefined) {
    params.push(input.directionId);
    sets.push(`direction_id = $${params.length}`);
  }
  if (input.mentorId !== undefined) {
    params.push(input.mentorId);
    sets.push(`mentor_id = $${params.length}`);
  }

  if (sets.length === 0) {
    return before;
  }

  params.push(id);
  await query(
    `UPDATE participants SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${params.length}`,
    params,
  );

  // Инвалидировать кэш participant и RBAC (на случай смены статуса)
  await redis.del(`participant:v2:${id}`);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'admin.participants.update',
    entityType: 'participant',
    entityId: id,
    oldValue: {
      name: before.name,
      pseudonym: before.pseudonym,
      status: before.status,
      directionId: before.directionId,
      mentorId: before.mentorId,
    },
    newValue: input as Record<string, unknown>,
  });

  return getParticipantAdmin(id);
}

// -------- Admin: мандаты (список с резолвом имён) --------

export interface AdminMandateFilter {
  function?: string;
  directionId?: UUID;
  holderId?: UUID;
  status?: 'active' | 'expired' | 'revoked';
  page?: number;
  perPage?: number;
}

export interface AdminMandateRow {
  id: UUID;
  function: string;
  holderId: UUID;
  holderName: string;
  holderExternalId: string;
  directionId: UUID | null;
  directionNumber: number | null;
  directionName: string | null;
  grantedBy: UUID;
  grantedByName: string | null;
  grantedAt: ISODateTime;
  expiresAt: ISODateTime;
  status: 'active' | 'expired' | 'revoked';
  conditions: Record<string, unknown>;
  scope: Record<string, unknown>;
  daysLeft: number | null;
}

export async function listMandatesAdmin(
  filter: AdminMandateFilter,
): Promise<{ data: AdminMandateRow[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.function) {
    params.push(filter.function);
    conditions.push(`m.function = $${params.length}`);
  }
  if (filter.directionId) {
    params.push(filter.directionId);
    conditions.push(`m.direction_id = $${params.length}`);
  }
  if (filter.holderId) {
    params.push(filter.holderId);
    conditions.push(`m.holder_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`m.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM mandates m ${where}`,
    params,
  );
  const total = parseInt(countRow?.c ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<{
    id: string; function: string;
    holder_id: string; holder_name: string; holder_external_id: string;
    direction_id: string | null; direction_number: number | null; direction_name: string | null;
    granted_by: string; granted_by_name: string | null;
    granted_at: Date; expires_at: Date;
    status: 'active' | 'expired' | 'revoked';
    conditions: Record<string, unknown> | null;
    scope: Record<string, unknown> | null;
  }>(
    `SELECT m.id, m.function,
            m.holder_id, p.name AS holder_name, p.external_id AS holder_external_id,
            m.direction_id, d.number AS direction_number, d.name AS direction_name,
            m.granted_by, gp.name AS granted_by_name,
            m.granted_at, m.expires_at, m.status, m.conditions, m.scope
       FROM mandates m
       JOIN participants p ON p.id = m.holder_id
       LEFT JOIN participants gp ON gp.id = m.granted_by
       LEFT JOIN directions d ON d.id = m.direction_id
       ${where}
      ORDER BY
        CASE m.status WHEN 'active' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END,
        m.expires_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const now = Date.now();
  const data: AdminMandateRow[] = rows.map((r) => ({
    id: r.id,
    function: r.function,
    holderId: r.holder_id,
    holderName: r.holder_name,
    holderExternalId: r.holder_external_id,
    directionId: r.direction_id,
    directionNumber: r.direction_number,
    directionName: r.direction_name,
    grantedBy: r.granted_by,
    grantedByName: r.granted_by_name,
    grantedAt: r.granted_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    status: r.status,
    conditions: r.conditions ?? {},
    scope: r.scope ?? {},
    daysLeft: r.status === 'active'
      ? Math.ceil((r.expires_at.getTime() - now) / 86_400_000)
      : null,
  }));

  return { data, total };
}

// -------- Admin: логи с резолвом имён --------
//
// В отличие от S.0.01.05.listEntries (сырые UUID) — JOIN'ит participants
// для actor и, если entity — участник, для entity. Остальные сущности
// (mandate, regime, recovery_request) резолвятся на фронте или отдаются
// как UUID + ссылка на карточку.

export interface AdminLogFilter {
  actorId?: UUID | null;
  entityType?: string;
  entityId?: UUID;
  page?: number;
  perPage?: number;
}

export interface AdminLogRow {
  id: UUID;
  createdAt: ISODateTime;
  actorId: UUID | null;
  actorType: 'participant' | 'ai' | 'system';
  actorName: string | null;
  actorExternalId: string | null;
  action: string;
  entityType: string;
  entityId: UUID;
  entityName: string | null;
  entityExternalId: string | null;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
}

const LOG_WINDOW_HOURS = 24;
const LOG_MAX_PER_PAGE = 200;

export async function listLogsRich(
  filter: AdminLogFilter,
  _requesterId: UUID,
): Promise<{ data: AdminLogRow[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(LOG_MAX_PER_PAGE, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Обязательный предикат по времени (партиционирование audit_log).
  const from = new Date(Date.now() - LOG_WINDOW_HOURS * 3600 * 1000).toISOString();
  params.push(from);
  conditions.push(`al.created_at >= $${params.length}`);

  if (filter.actorId !== undefined) {
    if (filter.actorId === null) {
      conditions.push(`al.actor_id IS NULL`);
    } else {
      params.push(filter.actorId);
      conditions.push(`al.actor_id = $${params.length}`);
    }
  }
  if (filter.entityType) {
    params.push(filter.entityType);
    conditions.push(`al.entity_type = $${params.length}`);
  }
  if (filter.entityId) {
    params.push(filter.entityId);
    conditions.push(`al.entity_id = $${params.length}`);
  }

  const where = conditions.join(' AND ');

  const countRow = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM audit_log al WHERE ${where}`,
    params,
  );
  const total = parseInt(countRow?.c ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<{
    id: string; created_at: Date;
    actor_id: string | null; actor_type: 'participant' | 'ai' | 'system';
    actor_name: string | null; actor_external_id: string | null;
    action: string; entity_type: string; entity_id: string;
    entity_name: string | null; entity_external_id: string | null;
    reason: string | null; ip: string | null; request_id: string | null;
  }>(
    `SELECT al.id, al.created_at,
            al.actor_id, al.actor_type,
            p.name AS actor_name, p.external_id AS actor_external_id,
            al.action, al.entity_type, al.entity_id,
            ep.name AS entity_name, ep.external_id AS entity_external_id,
            al.reason, host(al.ip) AS ip, al.request_id
       FROM audit_log al
       LEFT JOIN participants p  ON p.id  = al.actor_id
       LEFT JOIN participants ep ON al.entity_type = 'participant' AND ep.id = al.entity_id
      WHERE ${where}
      ORDER BY al.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const data: AdminLogRow[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    actorId: r.actor_id,
    actorType: r.actor_type,
    actorName: r.actor_name,
    actorExternalId: r.actor_external_id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityName: r.entity_name,
    entityExternalId: r.entity_external_id,
    reason: r.reason,
    ip: r.ip,
    requestId: r.request_id,
  }));

  return { data, total };
}