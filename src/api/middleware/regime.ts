// A.1.99.04 — Middleware режимов
// Проверка активных режимов. Ограничение эндпоинтов при InfoBlockade / RedCircuit /
// SteelBell / PTT / QuantumAcceleration. Возврат 423 (Locked) или 451 (InfoBlockade).
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// - regimeMiddleware — глобальный attach контекста (onRequest). Не блокирует.
// - blockDuring*() — точечные preHandler для конкретных роутов.
// - Кэш активных режимов в Redis (TTL 5 сек) — быстрее, чем list() на каждый запрос.
// - Public paths (health, version, auth) всегда разрешены — иначе система себя закроет.
// - При недоступности Redis — fail open (пропускаем), middleware не должен ломать API.

import type {
  FastifyRequest,
  FastifyReply,
  onRequestHookHandler,
  preHandlerHookHandler,
} from 'fastify';

import {
  LockedError,
  InfoBlockadeError,
} from '../../core/errors.js';
import type { RegimeType } from '../../core/types.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { invalidateRegimeCache } from '../../lib/regime-cache.js';

// Реэкспорт для обратной совместимости с теми, кто импортировал из middleware.
export { invalidateRegimeCache };

// -------- Типы --------

export interface RegimeContext {
  activeRegimes: RegimeType[];
  infoBlockade: boolean;
  steelBell: boolean;
  redCircuit: boolean;
  ptt: boolean;
  quantumAcceleration: boolean;
  loadedAt: number; // timestamp ms
}

declare module 'fastify' {
  interface FastifyRequest {
    regime?: RegimeContext;
  }
}

// -------- Константы --------

const CACHE_KEY = 'regime:context:active';
const CACHE_TTL_SEC = 5;

// Пути, которые НИКОГДА не блокируются (иначе система себя закроет).
//
// ВАЖНО: матчинг — точное совпадение или префикс с /, а не «startsWith».
// Это исключает случайный whitelist для /healthz, /version-x, /metrics-admin.
//
// ПОЛИТИКА WHITELIST:
// - /health*, /version, /metrics — системные, для мониторинга;
// - /auth/login, /auth/register, /auth/refresh, /auth/recover, /auth/status —
//   вход и регистрация должны работать всегда;
// - /auth/logout — участник должен иметь возможность выйти из системы
//   даже при активных режимах (иначе он «заперт»);
// - НЕ добавлять сюда /auth/* оптом: под whitelist не должны попадать
//   роуты, которые обязаны блокироваться режимами.
const ALWAYS_ALLOWED_PREFIXES: readonly string[] = [
  '/health',
  '/version',
  '/metrics',
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/recover',
  '/auth/status',
  '/auth/logout',
];

// Пути, блокируемые при InfoBlockade (Шлюз + всё, что с ним связано).
const INFO_BLOCKADE_PREFIXES: readonly string[] = [
  '/gateway',
];

// Пути, блокируемые при RedCircuit по умолчанию (если не передан явный список).
// Только «изменяющие» операции — чтение остаётся.
const RED_CIRCUIT_DEFAULT_BLOCKED: readonly string[] = [
  '/me/pause',
  '/me/pause/return',
  '/me/geo',
  '/delegations',
];

// -------- Загрузка контекста --------

async function loadRegimeContext(): Promise<RegimeContext> {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as RegimeContext;
      } catch {
        // кэш повреждён — идём в БД
      }
    }

    // Dynamic import — разрыв циклов (middleware → core).
    const regimes = await import('../../core/regimes/service.js');
    const active = await regimes.getActive();

    const activeTypes = active.map((r) => r.type);
    const ctx: RegimeContext = {
      activeRegimes: activeTypes,
      infoBlockade: activeTypes.includes('info_blockade'),
      steelBell: activeTypes.includes('steel_bell'),
      redCircuit: activeTypes.includes('red_circuit'),
      ptt: activeTypes.includes('ptt'),
      quantumAcceleration: activeTypes.includes('quantum_acceleration'),
      loadedAt: Date.now(),
    };

    await redis.set(CACHE_KEY, JSON.stringify(ctx), 'EX', CACHE_TTL_SEC);
    return ctx;
  } catch (e) {
    logger.warn({ err: e }, 'regime middleware: failed to load context, assuming empty');
    // fail open — пустой контекст = ничего не блокируем.
    return {
      activeRegimes: [],
      infoBlockade: false,
      steelBell: false,
      redCircuit: false,
      ptt: false,
      quantumAcceleration: false,
      loadedAt: Date.now(),
    };
  }
}

// -------- Глобальный middleware --------

export const regimeMiddleware: onRequestHookHandler = async (
  request: FastifyRequest,
) => {
  const ctx = await loadRegimeContext();
  request.regime = ctx;
};

export function getRegimeContext(request: FastifyRequest): RegimeContext {
  if (!request.regime) {
    // Fallback, если глобальный onRequest-hook не отработал (например,
    // middleware не зарегистрирован в тестовом приложении). Возвращаем
    // «пустой» контекст — fail open, режимы никого не блокируют.
    // Не пытаемся загрузить здесь: функция синхронная, а контроллеры ждут
    // sync-ответа. Если request.regime пуст — это сигнал, что middleware
    // не подключён, и его надо чинить в server.ts, а не в этом fallback'е.
    return {
      activeRegimes: [],
      infoBlockade: false,
      steelBell: false,
      redCircuit: false,
      ptt: false,
      quantumAcceleration: false,
      loadedAt: 0,
    };
  }
  return request.regime;
}

// -------- Помощники --------

// Строгий матчинг: точное совпадение или префикс с /. Иначе '/health' ловит
// '/healthz', '/version' ловит '/version-control', '/gateway' ловит
// '/gateway-admin' — то есть whitelist и блок-листы «протекают» на соседние
// роуты, которые по смыслу к ним не относятся.
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

function isAlwaysAllowed(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return ALWAYS_ALLOWED_PREFIXES.some((p) => matchesPrefix(path, p));
}

function matchesAny(url: string, prefixes: readonly string[]): boolean {
  const path = url.split('?')[0] ?? '';
  return prefixes.some((p) => matchesPrefix(path, p));
}

// -------- Точечные блокировки --------

/**
 * Блокирует указанные пути при активной InfoBlockade.
 * Возвращает 451 InfoBlockadeError.
 * По умолчанию блокирует префикс /gateway.
 */
export function blockDuringInfoBlockade(
  prefixes: readonly string[] = INFO_BLOCKADE_PREFIXES,
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (isAlwaysAllowed(request.url)) {return;}

    const ctx = request.regime ?? (await loadRegimeContext());
    if (!ctx.infoBlockade) {return;}
    if (!matchesAny(request.url, prefixes)) {return;}

    logger.warn(
      { url: request.url, method: request.method },
      'regime middleware: request blocked by InfoBlockade',
    );

    throw new InfoBlockadeError(
      'Шлюз изолирован (активна Информационная блокада)',
    );
  };
}

/**
 * Блокирует указанные пути при активном RedCircuit.
 * Возвращает 423 LockedError.
 * По умолчанию блокирует операции изменения состояния (пауза, смена гео, делегирование).
 */
export function blockDuringRedCircuit(
  prefixes: readonly string[] = RED_CIRCUIT_DEFAULT_BLOCKED,
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (isAlwaysAllowed(request.url)) {return;}

    const ctx = request.regime ?? (await loadRegimeContext());
    if (!ctx.redCircuit) {return;}
    if (!matchesAny(request.url, prefixes)) {return;}

    logger.warn(
      { url: request.url, method: request.method },
      'regime middleware: request blocked by RedCircuit',
    );

    throw new LockedError(
      'Операция заблокирована активным Красным Контуром',
      { regime: 'red_circuit' },
    );
  };
}

/**
 * Блокирует указанные пути при активном PTT (Полное Трансформационное Погружение).
 * При PTT запрещены паузы и «плато» — участник должен быть вовлечён.
 */
export function blockDuringPtt(
  prefixes: readonly string[] = ['/me/pause', '/me/pause/return'],
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (isAlwaysAllowed(request.url)) {return;}

    const ctx = request.regime ?? (await loadRegimeContext());
    if (!ctx.ptt) {return;}
    if (!matchesAny(request.url, prefixes)) {return;}

    logger.warn(
      { url: request.url, method: request.method },
      'regime middleware: request blocked by PTT',
    );

    throw new LockedError('Операция заблокирована активным ПТТ', {
      regime: 'ptt',
    });
  };
}

// -------- Утилиты для контроллеров --------

/**
 * Возвращает активные режимы из контекста запроса.
 * Удобно для контроллеров, которые хотят адаптировать ответ.
 */
export function getActiveRegimes(request: FastifyRequest): RegimeType[] {
  return getRegimeContext(request).activeRegimes;
}

export function isInfoBlockadeActive(request: FastifyRequest): boolean {
  return getRegimeContext(request).infoBlockade;
}

export function isRedCircuitActive(request: FastifyRequest): boolean {
  return getRegimeContext(request).redCircuit;
}

export function isSteelBellActive(request: FastifyRequest): boolean {
  return getRegimeContext(request).steelBell;
}

export function isQuantumAccelerationActive(request: FastifyRequest): boolean {
  return getRegimeContext(request).quantumAcceleration;
}