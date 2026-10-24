// S.0.01.06 — Rate limiting
// Redis-based fixed window (атомарный INCR+EXPIRE через Lua).
// 429 при превышении. Интеграция с A.1.99.05 (middleware rate-limit).
//
// Честный sliding window (ZSET-лог) — techdebt: дороже по памяти и CPU,
// для текущих лимитов достаточно fixed window. Атомарность INCR+EXPIRE
// закрывает race между чтением и записью счётчика.
//
// FIX 2026-10-15 (1):
//   - ROUTE_MAP учитывает HTTP-метод. Раньше GET /signals попадал под
//     лимит signal.create (10/час на POST) — чтение сигналов упиралось
//     в 429. Теперь правило матчится только при совпадении метода.
//   - resetAt считается от границы бакета, а не от PTTL ключа. PTTL
//     выставлялся с запасом +60_000, из-за чего X-RateLimit-Reset и
//     Retry-After были на 60 сек больше реального окна.
//   - Добавлен сценарий 'auth.status' (30/мин IP) для GET-статуса заявки.
//   - getConfigForRoute / getConfigForRole принимают method. Вызывающий
//     (A.1.99.05) обязан его прокидывать.
//   - Добавлены сценарии auth.recover.request/approve/confirm (флоу B).
//
// FIX 2026-10-15 (2):
//   - windowKey включает config.scenario. Раньше сценарии с одинаковыми
//     keyBy+windowMs (auth.recover.request + auth.recover.confirm;
//     api.general + api.write; signal.create + task.create) писали в один
//     Redis-ключ и получали ложные 429. Теперь ключ:
//       ratelimit:<scenario>:<baseKey>:<bucket>
//   - mustGetLimit возвращает копию config с полем scenario.
//
// TECHDEBT: явные конфиги (rateLimitExplicit) не имеют scenario — их ключ
//   получается ratelimit:_:<baseKey>:<bucket>. Если два разных явных конфига
//   имеют одинаковые keyBy+windowMs — снова коллизия. Решается либо явным
//   параметром scenario в RateLimitOptions, либо отказом от rateLimitExplicit.

import { RateLimitError } from '../core/errors.js';
import type { Role } from '../core/roles.js';
import type { ISODateTime } from '../core/types.js';
import { redis } from '../lib/redis.js';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyBy?: 'ip' | 'participant' | 'route';
  skipRoles?: Role[];
  /**
   * Имя сценария из RATE_LIMITS. Заполняется mustGetLimit автоматически.
   * Входит в Redis-ключ, чтобы сценарии с одинаковыми keyBy+windowMs не
   * делили один счётчик. Без этого auth.recover.request и auth.recover.confirm
   * (оба ip + 60мин) инкрементируют один ключ и дают ложные 429.
   */
  scenario?: string;
}

// ─── Конфигурация ────────────────────────────────────────────────
// Ключи — имена «сценариев», не URL. Маппинг route → scenario ниже.

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Auth
  'auth.login':    { windowMs: 15 * 60_000, max: 50,   keyBy: 'ip' },// 50 для тестов
  'auth.register': { windowMs: 60 * 60_000, max: 30,   keyBy: 'ip' },// 30 для тестов
  'auth.refresh':  { windowMs: 60_000,      max: 30,  keyBy: 'ip' },

  // LEGACY: оставлен для совместимости (ссылки в тестах/доках).
  // Активные роуты recovery используют request/approve/confirm.
  'auth.recover':  { windowMs: 60 * 60_000, max: 3,   keyBy: 'ip' },

  // Recovery (флоу B, S.0.01.04): заявка → approve → confirm.
  // request — публичный, но злоупотребление создаёт мусор в БД → лимит по IP.
  // approve — авторизован (Совет/Архитектор), лимит по participant.
  // confirm — публичный, но с одноразовым токеном (64 hex); лимит по IP —
  //   защита от перебора, не мешает честному пользователю.
  'auth.recover.request': { windowMs: 60 * 60_000, max: 3,   keyBy: 'ip' },
  'auth.recover.approve': { windowMs: 60_000,      max: 30,  keyBy: 'participant' },
  'auth.recover.confirm': { windowMs: 60 * 60_000, max: 5,   keyBy: 'ip' },

  // GET /auth/status/:request_id — публичный роут, раскрывает метаданные
  // заявки (status, interview_at). 30/мин на IP — с запасом на легитимные
  // проверки статуса, но не для массового сканирования UUID.
  'auth.status':   { windowMs: 60_000,      max: 30,  keyBy: 'ip' },

  // Общие
  // FIRST_ARCHITECT — единственный с полным доступом (I.1.10): не лимитируем
  // в dev/prod, чтобы bootstrap и массовые админ-операции не упирались в 100/мин.
  'api.general': {
    windowMs: 60_000,
    max: 100,
    keyBy: 'participant',
    skipRoles: ['FIRST_ARCHITECT' as Role],
  },
  'api.write': {
    windowMs: 60_000,
    max: 30,
    keyBy: 'participant',
    skipRoles: ['FIRST_ARCHITECT' as Role],
  },

  // Домены
  'signal.create': { windowMs: 60 * 60_000, max: 10,  keyBy: 'participant' },
  'task.create':   { windowMs: 60 * 60_000, max: 30,  keyBy: 'participant' },

  // WS
  'ws.connect':    { windowMs: 60_000,      max: 5,   keyBy: 'ip' },
};

// ─── Ключевые операции ───────────────────────────────────────────

function nowMs(): number {
  return Date.now();
}

// Ключ: ratelimit:<scenario>:<baseKey>:<bucket>.
// scenarioPart = config.scenario ?? '_' — для явных конфигов без сценария
// (rateLimitExplicit) ставим заглушку, чтобы формат ключа был предсказуем.
function windowKey(baseKey: string, config: RateLimitConfig): string {
  const bucket = Math.floor(nowMs() / config.windowMs);
  const scenarioPart = config.scenario ?? '_';
  return `ratelimit:${scenarioPart}:${baseKey}:${bucket}`;
}

// Граница текущего бакета (когда счётчик сбросится). Используется для
// X-RateLimit-Reset и Retry-After. Раньше consume возвращал now + PTTL,
// но PTTL = windowMs + 60_000 (запас), из-за чего resetAt был на 60 сек
// больше реального окна и расходился с checkRateLimit (там была граница
// бакета). Теперь обе функции используют одну формулу.
function bucketEndMs(config: RateLimitConfig): number {
  return (Math.floor(nowMs() / config.windowMs) + 1) * config.windowMs;
}

// Атомарный INCR + PEXPIRE одной командой. Если между INCR и EXPIRE упадёт
// процесс — ключ останется без TTL и «залипнет» навсегда. Race между
// параллельными запросами: без атомарности N запросов прочитают count=4,
// все увидят «можно», все инкрементируют и все получат allowed=true.
// Возвращает только count — PTTL не нужен, resetAt считается от бакета.
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetAt: ISODateTime;
  limit: number;
}

// Только чтение, без инкремента (для UI-проверок и заголовков).
// Один GET вместо GET + PTTL.
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitCheck> {
  const k = windowKey(key, config);
  const raw = await redis.get(k);
  const used = raw ? Number(raw) || 0 : 0;
  return {
    allowed: used < config.max,
    remaining: Math.max(0, config.max - used),
    resetAt: new Date(bucketEndMs(config)).toISOString(),
    limit: config.max,
  };
}

// Инкремент + проверка (для middleware). Атомарно через Lua.
export async function consume(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitCheck> {
  const k = windowKey(key, config);
  // TTL ключа — окно + запас 60 сек, чтобы ключ не «провалился» в 0 в момент
  // чтения. На resetAt не влияет: там используется bucketEndMs.
  const ttlMs = config.windowMs + 60_000;

  const result = await redis.eval(
    CONSUME_SCRIPT,
    1,
    k,
    String(ttlMs),
  );

  const count = typeof result === 'number' ? result : Number(result);

  return {
    allowed: count <= config.max,
    remaining: Math.max(0, config.max - count),
    resetAt: new Date(bucketEndMs(config)).toISOString(),
    limit: config.max,
  };
}

export async function reset(key: string): Promise<void> {
  // key приходит как baseKey (например, 'ip:127.0.0.1') или
  // 'participant:<uuid>', без scenario. Формат ключа теперь
  // ratelimit:<scenario>:<baseKey>:<bucket>, поэтому матчим по
  // ratelimit:*:<key>:*.
  const pattern = `ratelimit:*:${key}:*`;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) {await redis.del(...keys);}
  } while (cursor !== '0');
}

// ─── Маппинг route → config ──────────────────────────────────────

interface RouteEntry {
  pattern: RegExp;
  scenario: string;
  // HTTP-метод, к которому применяется правило. Обязателен для роутов,
  // где на одном URL могут быть разные методы (например, /signals: GET
  // читает список, POST создаёт — у них разные лимиты). Для auth-роутов
  // метод тоже указываем явно — если он когда-нибудь появится с GET-версией,
  // правило не «протечёт» на неё.
  method: string;
}

const ROUTE_MAP: readonly RouteEntry[] = [
  { method: 'POST', pattern: /^\/auth\/login\/?$/,    scenario: 'auth.login' },
  { method: 'POST', pattern: /^\/auth\/register\/?$/, scenario: 'auth.register' },
  { method: 'POST', pattern: /^\/auth\/refresh\/?$/,  scenario: 'auth.refresh' },
  // Recovery (флоу B): три роута. Порядок в массиве неважен — паттерны
  // не пересекаются. Ключ auth.recover в RATE_LIMITS оставлен как legacy
  // и в ROUTE_MAP не участвует.
  { method: 'POST', pattern: /^\/auth\/recover\/request\/?$/,        scenario: 'auth.recover.request' },
  { method: 'POST', pattern: /^\/auth\/recover\/approve\/[^/]+\/?$/, scenario: 'auth.recover.approve' },
  { method: 'POST', pattern: /^\/auth\/recover\/confirm\/?$/,        scenario: 'auth.recover.confirm' },
  { method: 'GET',  pattern: /^\/auth\/status\//,     scenario: 'auth.status' },
  { method: 'POST', pattern: /^\/signals\/?$/,        scenario: 'signal.create' },
  { method: 'POST', pattern: /^\/tasks\/?$/,          scenario: 'task.create' },
];

// Возвращает копию конфига с заполненным scenario. Копия — чтобы
// RATE_LIMITS оставался чистым объектом (scenario проставляется на лету),
// и чтобы у вызывающего был иммутабельный конфиг.
export function mustGetLimit(scenario: keyof typeof RATE_LIMITS): RateLimitConfig {
  const cfg = RATE_LIMITS[scenario];
  if (!cfg) {
    throw new Error(`RATE_LIMITS['${scenario}'] is not configured`);
  }
  return { ...cfg, scenario };
}

export function getConfigForRoute(
  route: string,
  method: string,
): RateLimitConfig {
  for (const entry of ROUTE_MAP) {
    if (entry.method !== method) { continue; }
    if (entry.pattern.test(route)) {
      return mustGetLimit(entry.scenario as keyof typeof RATE_LIMITS);
    }
  }
  return mustGetLimit('api.general');
}

// Роли с повышенными лимитами (×3) — Совет, Верификатор, Балансировщик.
// Обоснование: спека A.1.99.05 явно упоминает, что у этих ролей нагрузка выше.
const ELEVATED_ROLES: ReadonlySet<Role> = new Set([
  'COUNCIL_MEMBER' as Role,
  'VERIFIER' as Role,
  'BALANCER' as Role,
]);

// Права роли: FIRST_ARCHITECT и другие из skipRoles не лимитируются.
// ElevatedRoles (Совет/Верификатор/Балансировщик) — ×3.
// scenario сохраняется через spread — ключ остаётся правильным.
export function getConfigForRole(
  role: Role | null,
  route: string,
  method: string,
): RateLimitConfig {
  const base = getConfigForRoute(route, method);

  if (role && base.skipRoles?.includes(role)) {
    return { ...base, max: Number.MAX_SAFE_INTEGER };
  }

  if (role && ELEVATED_ROLES.has(role)) {
    return { ...base, max: base.max * 3 };
  }

  return base;
}

// ─── Утилита: 429 ────────────────────────────────────────────────

export function raiseRateLimit(check: RateLimitCheck): never {
  const retryAfterSec = Math.max(1, Math.ceil((new Date(check.resetAt).getTime() - nowMs()) / 1000));
  throw new RateLimitError(retryAfterSec);
}