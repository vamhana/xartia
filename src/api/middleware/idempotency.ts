// A.1.99.08 — Middleware идемпотентности
// X-Idempotency-Key. Кэш ответа в Redis (TTL 24 часа).
//
// Три хука, каждый на своём месте:
//
//   onRequest idempotency() — async.
//     - replay (ok) → return reply.send(...) — стоп цепочки;
//     - processing → return reply.status(409).send(...) — стоп цепочки;
//     - иначе SET NX reservation, сохраняем req.idempotencyKey.
//
//   onSend idempotencyCapture — СИНХРОННЫЙ (callback-style, без await).
//     Вызывается ПОСЛЕ preSerialization: payload уже сериализован
//     Fastify в string | Buffer. Ставит заголовок X-Idempotency-Key
//     и кладёт тело в req.idempotencyBody. Никаких await — иначе race
//     с @fastify/cookie и ERR_HTTP_HEADERS_SENT.
//     ВАЖНО: idempotencyCapture вызывается ТОЛЬКО когда req.idempotencyKey
//     уже установлен в onRequest (т.е. это не replay и не 409).
//
//   onResponse idempotencySave — async.
//     Заголовки уже улетели, await безопасен. Пишет в Redis:
//       - 2xx → SET ok-ответ с TTL из req.idempotencyTtlSec;
//       - не-2xx → DEL reservation (даём клиенту ретраить).

import type {
  FastifyRequest,
  FastifyReply,
  onRequestHookHandler,
  onSendHookHandler,
  onResponseHookHandler,
} from 'fastify';

import { redis } from '../../lib/redis.js';

const DEFAULT_TTL_SEC = 24 * 60 * 60;

// Резервация держится 60 сек. Если обработчик не успел завершиться за это
// время (долгая операция, зависший upstream) — ключ освободится, и
// параллельный запрос с тем же X-Idempotency-Key пройдёт. Это осознанный
// компромисс: длинные запросы > 60 сек не должны блокировать клиента вечно.
// Если операция штатно длится > 60 сек — поднять константу.
const RESERVATION_TTL_SEC = 60;
const MAX_KEY_LEN = 128;

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyTtlSec?: number;
    idempotencyBody?: string;   // JSON-строка тела ответа (установлено в onSend)
  }
}

interface CachedResponse {
  status: 'ok';
  statusCode: number;
  body: string;
}

interface Reservation {
  status: 'processing';
  startedAt: string;
}

type RedisPayload = CachedResponse | Reservation;

function extractKey(req: FastifyRequest): string | null {
  const raw = req.headers['x-idempotency-key'];
  if (typeof raw !== 'string') {return null;}
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_KEY_LEN) {return null;}
  return key;
}

function isIdempotent(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

function redisKey(key: string): string {
  return `idempotency:${key}`;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// ─── onRequest ───────────────────────────────────────────────────

export function idempotency(): onRequestHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    req.idempotencyKey = undefined;
    req.idempotencyTtlSec = undefined;
    req.idempotencyBody = undefined;

    if (!isIdempotent(req.method)) {return;}

    const key = extractKey(req);
    if (!key) {return;}

    const rk = redisKey(key);

    let cachedRaw: string | null = null;
    try {
      cachedRaw = await redis.get(rk);
    } catch (e) {
      req.log.warn({ key, err: e }, 'idempotency: redis get failed, fail-open');
      req.idempotencyKey = key;
      req.idempotencyTtlSec = DEFAULT_TTL_SEC;
      return;
    }

    if (cachedRaw) {
      let parsed: RedisPayload | null = null;
      try {
        parsed = JSON.parse(cachedRaw) as RedisPayload;
      } catch (e) {
        req.log.warn({ key, err: e }, 'idempotency: cached payload is malformed');
      }

      if (parsed && parsed.status === 'ok') {
        req.log.info({ key, statusCode: parsed.statusCode }, 'idempotency: replay');
        const bodyObj = safeParse(parsed.body);
        reply
          .header('X-Idempotency-Key', key)
          .header('X-Idempotency-Replayed', 'true')
          .status(parsed.statusCode);
        // return reply — Fastify 5 останавливает цепочку.
        return reply.send(bodyObj);
      }

      if (parsed && parsed.status === 'processing') {
        req.log.info({ key }, 'idempotency: replay (processing in flight)');
        reply.status(409);
        return reply.send({
          code: 'CONFLICT',
          message: 'Запрос с этим X-Idempotency-Key уже выполняется',
        });
      }
    }

    try {
      const reservation: Reservation = {
        status: 'processing',
        startedAt: new Date().toISOString(),
      };
      const reserved = await redis.set(
        rk,
        JSON.stringify(reservation),
        'EX',
        RESERVATION_TTL_SEC,
        'NX',
      );
      if (reserved !== 'OK') {
        reply.status(409);
        return reply.send({
          code: 'CONFLICT',
          message: 'Запрос с этим X-Idempotency-Key уже выполняется',
        });
      }
    } catch (e) {
      req.log.warn({ key, err: e }, 'idempotency: redis set failed, fail-open');
    }

    // Устанавливаем только на «обычном» пути — не на replay и не на 409.
    req.idempotencyKey = key;
    req.idempotencyTtlSec = DEFAULT_TTL_SEC;
  };
}

// ─── onSend ──────────────────────────────────────────────────────
// Payload УЖЕ сериализован (string | Buffer). Никаких await.
// onSend вызывается после preSerialization, до отправки клиенту.

export const idempotencyCapture: onSendHookHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
  payload,
  done,
) => {
  const key = req.idempotencyKey;
  if (!key) {
    done(null, payload);
    return;
  }

  reply.header('X-Idempotency-Key', key);

  // payload — уже строка (JSON.stringify сделан Fastify). Просто сохраняем.
  try {
    if (typeof payload === 'string') {
      req.idempotencyBody = payload;
    } else if (Buffer.isBuffer(payload)) {
      req.idempotencyBody = payload.toString('utf8');
    } else {
      req.idempotencyBody = JSON.stringify(payload);
    }
  } catch {
    req.idempotencyBody = 'null';
  }

  done(null, payload);
};

// ─── onResponse ──────────────────────────────────────────────────
// Заголовки уже отправлены, await безопасен.

export const idempotencySave: onResponseHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const key = req.idempotencyKey;
  if (!key) {return;}   // replay / 409 / нет ключа — пропускаем

  const rk = redisKey(key);
  const statusCode = reply.statusCode;

  try {
    if (statusCode >= 200 && statusCode < 300) {
      const body = req.idempotencyBody ?? 'null';
      const cached: CachedResponse = { status: 'ok', statusCode, body };
      const ttl = req.idempotencyTtlSec ?? DEFAULT_TTL_SEC;
      await redis.set(rk, JSON.stringify(cached), 'EX', ttl);
      req.log.info({ key, statusCode }, 'idempotency: saved');
    } else {
      // Ошибка — освобождаем резервацию.
      await redis.del(rk);
    }
  } catch (e) {
    req.log.warn({ key, err: e }, 'idempotency: save failed');
  }
};

// ─── Ручные утилиты ──────────────────────────────────────────────

export async function getCachedResponse(key: string): Promise<unknown | null> {
  try {
    const raw = await redis.get(redisKey(key));
    if (!raw) {return null;}
    const parsed = JSON.parse(raw) as RedisPayload;
    if (parsed.status !== 'ok') {return null;}
    return safeParse(parsed.body);
  } catch {
    return null;
  }
}

export async function cacheResponse(
  key: string,
  response: unknown,
  ttlSeconds: number = DEFAULT_TTL_SEC,
): Promise<void> {
  const body = JSON.stringify(response);
  const cached: CachedResponse = { status: 'ok', statusCode: 200, body };
  await redis.set(redisKey(key), JSON.stringify(cached), 'EX', ttlSeconds);
}

export async function invalidateIdempotencyKey(key: string): Promise<void> {
  await redis.del(redisKey(key));
}