// L.0.01.08 — Redis-клиент
// Три соединения: main, pub, sub (subscriber блокирует, поэтому отдельно).
// Кэш, rate limit, pub/sub для WebSocket, распределённые локи.
// Namespace-префиксы обязательны.
//
// v0.0.02 (после инцидента «MaxRetriesPerRequestError на старте ws»):
//   - main: maxRetriesPerRequest=3, быстрый retryStrategy (50ms × n, cap 2s).
//     Быстрый fail-fast для кэша и rate-limit (лучше промах, чем висящий
//     HTTP-запрос), но без потери сессий — cap 2s всё равно даёт восстановление.
//   - redisPub: maxRetriesPerRequest=null (бесконечные попытки). Публикация
//     WS-событий не должна дропаться на transient disconnect. Внимание:
//     при недоступном Redis publish() висит до реконнекта, а не падает —
//     caller (broadcast/sendTo*) должен иметь свой timeout/логику.
//   - redisSub: maxRetriesPerRequest=null + enableReadyCheck=false.
//     Subscriber mode отвергает INFO (ready-check), поэтому флаг обязателен —
//     иначе ioredis переподключается и теряет подписки. retryStrategy
//     даёт переподписку на каждом реконнекте (autoResubscribe по умолчанию).
//
// v0.0.03 (Windows + Docker Desktop fix для того же инцидента):
//   - family: 4 — IPv6-loopback не пробрасывается, ioredis резолвит
//     localhost в ::1 и висит до connect timeout.
//   - keepAlive: 30_000 — Docker Desktop NAT рвёт idle TCP-соединения,
//     клиент не замечает → EPIPE/MaxRetriesPerRequestError.
//   - connectTimeout: 10_000 — совпадает с дефолтом ioredis, но явно:
//     чтобы поведение не менялось при обновлении ioredis.

import { randomUUID } from 'node:crypto';

import Redis, { type RedisOptions } from 'ioredis';

import { AppError } from '../core/errors.js';

import { logger } from './logger.js';

// -------- Конфигурация --------

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// В dev/prod через docker-compose REDIS_URL всегда задан. Fallback на localhost
// удобен локально, но в production без явного REDIS_URL — отказ.
if (process.env['NODE_ENV'] === 'production' && !process.env['REDIS_URL']) {
  throw new AppError('CONFIG', 'REDIS_URL must be set in production', 500);
}

// ─── TCP-опции (Windows + Docker Desktop fix) ─────────────────────────
// Применяются в main/pub/sub одинаково. Не удалять без проверки на
// Windows + Docker Desktop — без family: 4 воспроизводится стабильно:
//   - family: 4 — Windows/Docker Desktop не пробрасывает IPv6-loopback,
//                 ioredis по умолчанию резолвит localhost → ::1 и висит
//                 до connectTimeout. Явный IPv4 убирает этот класс ошибок.
//   - keepAlive: 30_000 — Docker Desktop NAT рвёт idle TCP-соединения
//                 (~через несколько минут), Redis-клиент не замечает и
//                 падает с EPIPE/MaxRetriesPerRequestError. Keep-alive
//                 пакеты каждые 30 сек держат соединение живым.
//   - connectTimeout: 10_000 — совпадает с дефолтом ioredis, но явно:
//                 чтобы поведение не менялось при обновлении ioredis.

// main: кэш, sessions, rate-limit, distributed locks.
// Fail-fast после 3 попыток — вызывающий решает, что делать (cache miss,
// 401 на isSessionActive, retry в middleware). Быстрый retryStrategy.
const mainOptions: RedisOptions = {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  family: 4,
  keepAlive: 30_000,
  connectTimeout: 10_000,
};

// pub: publisher для WS-событий (broadcast, sendToParticipant, ...).
// maxRetriesPerRequest=null → publish() не бросает на transient disconnect,
// ждёт восстановления Redis. Это важно для WS: дропнутый broadcast = потеря
// уведомления клиенту. Но: при долгом дауне publish() висит — вызывающий
// (broadcast/sendToParticipant) должен сам ограничивать ожидание.
const pubOptions: RedisOptions = {
  lazyConnect: false,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 100, 5000),
  family: 4,
  keepAlive: 30_000,
  connectTimeout: 10_000,
};

// sub: subscriber. После psubscribe соединение в subscriber mode, INFO
// отвергается — enableReadyCheck обязан быть false, иначе ioredis
// переподключается и теряет подписки. autoResubscribe (по умолчанию true)
// восстанавливает подписки на каждом реконнекте.
const subOptions: RedisOptions = {
  lazyConnect: false,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 100, 5000),
  family: 4,
  keepAlive: 30_000,
  connectTimeout: 10_000,
};

// -------- Три клиента --------

export const redis: Redis = new Redis(REDIS_URL, {
  ...mainOptions,
  connectionName: 'charter-main',
});

export const redisPub: Redis = new Redis(REDIS_URL, {
  ...pubOptions,
  connectionName: 'charter-pub',
});

export const redisSub: Redis = new Redis(REDIS_URL, {
  ...subOptions,
  connectionName: 'charter-sub',
});

redis.on('error', (e) => {
  logger.warn({ err: e }, 'redis: connection error');
});
redisPub.on('error', (e) => {
  logger.warn({ err: e }, 'redisPub: connection error');
});
redisSub.on('error', (e) => {
  logger.warn({ err: e }, 'redisSub: connection error');
});

// -------- Базовые операции --------

export async function get<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) {return null;}
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (ttlSeconds !== undefined) {
    await redis.set(key, raw, 'EX', ttlSeconds);
  } else {
    await redis.set(key, raw);
  }
}

export async function del(key: string): Promise<void> {
  await redis.del(key);
}

export async function exists(key: string): Promise<boolean> {
  return (await redis.exists(key)) === 1;
}

// INCR + EXPIRE одной командой: если между INCR и EXPIRE процесс упадёт,
// ключ останется без TTL и займёт память навсегда.
const INCR_WITH_TTL_SCRIPT = `
local v = redis.call('INCR', KEYS[1])
if v == 1 and tonumber(ARGV[1]) > 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return v
`;

export async function incr(key: string, ttlSeconds?: number): Promise<number> {
  if (ttlSeconds === undefined) {
    return redis.incr(key);
  }
  const result = await redis.eval(INCR_WITH_TTL_SCRIPT, 1, key, String(ttlSeconds));
  return typeof result === 'number' ? result : Number(result);
}

export async function expire(key: string, ttlSeconds: number): Promise<void> {
  await redis.expire(key, ttlSeconds);
}

export async function ttl(key: string): Promise<number> {
  return redis.ttl(key);
}

// -------- Удаление по префиксу --------

export async function delByPrefix(prefix: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== '0');
  return deleted;
}

// -------- Pub/Sub --------

export async function publish(channel: string, message: unknown): Promise<number> {
  const raw = JSON.stringify(message);
  return redisPub.publish(channel, raw);
}

export type MessageHandler = (message: unknown) => void;

const subscriptionRefs = new Map<string, { count: number; listener: (ch: string, msg: string) => void }>();
const handlerRegistry = new Map<string, Set<MessageHandler>>();

export async function subscribe(channel: string, handler: MessageHandler): Promise<() => void> {
  const existing = subscriptionRefs.get(channel);

  let listener: (ch: string, msg: string) => void;
  if (existing) {
    listener = existing.listener;
    existing.count++;
  } else {
    listener = (_ch: string, msg: string) => {
      // dispatcher для всех handlers этого канала
      const handlers = handlerRegistry.get(channel);
      if (!handlers) {return;}
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg);
      } catch {
        parsed = msg;
      }
      for (const h of handlers) {
        try {
          h(parsed);
        } catch (e) {
          logger.error({ err: e, channel }, 'redis: subscriber handler error');
        }
      }
    };
    subscriptionRefs.set(channel, { count: 1, listener });
    await redisSub.subscribe(channel);
    redisSub.on('message', listener);
  }

  // Регистрируем handler
  let handlers = handlerRegistry.get(channel);
  if (!handlers) {
    handlers = new Set();
    handlerRegistry.set(channel, handlers);
  }
  handlers.add(handler);

  // Возвращаем unsubscribe
  return () => {
    const list = handlerRegistry.get(channel);
    if (list) {
      list.delete(handler);
      if (list.size === 0) {handlerRegistry.delete(channel);}
    }
    const ref = subscriptionRefs.get(channel);
    if (ref) {
      ref.count--;
      if (ref.count <= 0) {
        redisSub.off('message', ref.listener);
        void redisSub.unsubscribe(channel);
        subscriptionRefs.delete(channel);
      }
    }
  };
}

// -------- Распределённые локи --------

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
  return result === 'OK' ? token : null;
}

export async function releaseLock(key: string, token: string): Promise<boolean> {
  const result = await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
  return result === 1;
}

// -------- Namespaced API --------

export interface NamespacedRedis {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  delByPrefix(): Promise<number>;
}

export function namespaced(namespace: string): NamespacedRedis {
  const prefix = `${namespace}:`;
  return {
    get: <T>(key: string) => get<T>(prefix + key),
    set: <T>(key: string, value: T, ttl?: number) => set(prefix + key, value, ttl),
    del: (key: string) => del(prefix + key),
    exists: (key: string) => exists(prefix + key),
    incr: (key: string, ttl?: number) => incr(prefix + key, ttl),
    delByPrefix: () => delByPrefix(prefix),
  };
}

// -------- Health-check --------

export async function healthCheck(): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

// -------- Graceful shutdown --------

let closed = false;

export async function closeConnections(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;
  // allSettled: если один quit упадёт, остальные всё равно завершатся.
  await Promise.allSettled([redis.quit(), redisPub.quit(), redisSub.quit()]);
}