// S.0.01.01 — JWT-модуль
// Генерация и верификация access/refresh токенов.
// Ротация refresh. Blacklist для отозванных токенов (Redis).
//
// v0.0.04:
//   - P6: rotateRefresh — Redis SET NX lock (refresh-lock:<hash>, EX 5)
//     сериализует параллельные ротации одного токена. Второй вызов получает
//     409 CONFLICT (details.reason = 'REFRESH_IN_PROGRESS') — клиент
//     повторяет запрос, а не делает logout. 401 здесь был бы семантически
//     неверен: токен валиден, просто уже обрабатывается.
//   - P7: revokeAllForParticipant — O(1) через participant:<id>:sessions SET.
//     issueTokens добавляет sessionId в SET; revokeSession удаляет.
//     Старый scan('session:*') перебирал все сессии всех участников.
//   - P15: tokenHash — sha256 hex slice(0, 32) вместо slice(-32).
//     slice(-32) брал хвост base64url-подписи; при изменении формата
//     (padding, поля) возможна коллизия.
//   - P16: revokeToken — assert decoded.type ∈ {'access','refresh'}.
//     Защита от случайного blacklist мусорной строки.
//
// v0.0.03 (сохранено):
//   - JwtPayload.directionId: UUID | null — участник может быть без направления.
//   - verifyToken / decodeToken: отсутствующий/пустой directionId → null.

import { createHash } from 'node:crypto';

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { JWT_ACCESS_TTL_SEC, JWT_REFRESH_TTL_SEC } from '../core/constants.js';
import { UnauthorizedError, ConflictError, AppError } from '../core/errors.js';
import { Role } from '../core/roles.js';
import type { UUID } from '../core/types.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

// -------- Ключ --------

const JWT_SECRET = process.env['JWT_SECRET'];

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new AppError(
    'CONFIG',
    'JWT_SECRET must be set and at least 32 characters long',
    500,
  );
}

const secretKey = new TextEncoder().encode(JWT_SECRET);

// -------- Типы --------

export interface JwtPayload {
  sub: UUID;
  externalId: string;
  role: Role;
  directionId: UUID | null;
  sessionId: UUID;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

type TokenInput = Omit<JwtPayload, 'iat' | 'exp' | 'type'>;

// -------- Подпись --------

async function signToken(
  payload: TokenInput,
  type: 'access' | 'refresh',
  ttlSec: number,
): Promise<string> {
  return new SignJWT({
    externalId: payload.externalId,
    role: payload.role,
    directionId: payload.directionId,
    sessionId: payload.sessionId,
    type,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .setIssuer('xartia')
    .setAudience('xartia-api')
    .sign(secretKey);
}

export function signAccessToken(payload: TokenInput): Promise<string> {
  return signToken(payload, 'access', JWT_ACCESS_TTL_SEC);
}

export function signRefreshToken(payload: TokenInput): Promise<string> {
  return signToken(payload, 'refresh', JWT_REFRESH_TTL_SEC);
}

// -------- Верификация --------

/** Извлекает directionId из raw JWT-payload: строка UUID или null. */
function readDirectionId(raw: JWTPayload): UUID | null {
  const v = raw['directionId'];
  return typeof v === 'string' && v.length > 0 ? (v as UUID) : null;
}

export async function verifyToken(
  token: string,
  expectedType: 'access' | 'refresh',
): Promise<JwtPayload> {
  let raw: JWTPayload;
  try {
    const result = await jwtVerify(token, secretKey, {
      issuer: 'xartia',
      audience: 'xartia-api',
    });
    raw = result.payload;
  } catch (e) {
    // jose использует коды, а не сообщения. 'exp' claim timestamp check failed
    // не содержит слова 'expired', поэтому классифицируем по code.
    const code = (e as { code?: string }).code;
    if (code === 'ERR_JWT_EXPIRED') {
      throw new UnauthorizedError('Token expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Invalid token', 'INVALID_TOKEN');
  }

  if (raw['type'] !== expectedType) {
    throw new UnauthorizedError(
      `Expected ${expectedType} token, got ${String(raw['type'])}`,
      'INVALID_TOKEN',
    );
  }

  const sub = raw.sub;
  if (!sub) {throw new UnauthorizedError('Token has no subject', 'INVALID_TOKEN');}

  return {
    sub,
    externalId: String(raw['externalId'] ?? ''),
    role: raw['role'] as Role,
    directionId: readDirectionId(raw),
    sessionId: String(raw['sessionId'] ?? ''),
    type: expectedType,
    iat: raw.iat ?? 0,
    exp: raw.exp ?? 0,
  };
}

// -------- Декодирование без проверки --------

export function decodeToken(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) {return null;}
    const raw = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as JWTPayload;
    if (!raw.sub) {return null;}
    return {
      sub: raw.sub,
      externalId: String(raw['externalId'] ?? ''),
      role: raw['role'] as Role,
      directionId: readDirectionId(raw),
      sessionId: String(raw['sessionId'] ?? ''),
      type: (raw['type'] === 'refresh' ? 'refresh' : 'access'),
      iat: raw.iat ?? 0,
      exp: raw.exp ?? 0,
    };
  } catch {
    return null;
  }
}

// -------- Выдача пары --------

export async function issueTokens(payload: TokenInput): Promise<AuthTokens> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(payload),
    signRefreshToken(payload),
  ]);

  try {
    await redis.set(
      `session:${payload.sessionId}`,
      JSON.stringify({
        participantId: payload.sub,
        createdAt: new Date().toISOString(),
      }),
      'EX',
      JWT_REFRESH_TTL_SEC,
    );

    const sessionsKey = `participant:${payload.sub}:sessions`;
    await redis.sadd(sessionsKey, payload.sessionId);
    await redis.expire(sessionsKey, JWT_REFRESH_TTL_SEC);
  } catch (e) {
    // Redis недоступен. Это не 401 (креды верны) и не 500 (не баг в коде) —
    // 503: зависимость временно недоступна, клиент может повторить.
    logger.error(
      { err: e, participantId: payload.sub, sessionId: payload.sessionId },
      'issueTokens: redis write failed',
    );
    throw new AppError(
      'SESSION_CREATE_FAILED',
      'Сервис сессий временно недоступен. Повторите запрос через несколько секунд.',
      503,
      { retry_after_sec: 5 },
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresIn: JWT_ACCESS_TTL_SEC,
    tokenType: 'Bearer',
  };
}

// -------- Ротация refresh --------

export async function rotateRefresh(
  refreshToken: string,
  roleResolver?: (participantId: UUID) => Promise<Role>,
): Promise<AuthTokens> {
  const payload = await verifyToken(refreshToken, 'refresh');

  if (await isRevoked(refreshToken)) {
    throw new UnauthorizedError('Refresh token revoked', 'REVOKED');
  }

  if (!(await isSessionActive(payload.sessionId))) {
    throw new UnauthorizedError('Session revoked', 'REVOKED');
  }

  // P6: SET NX lock на 5 секунд. Параллельный refresh с тем же токеном
  // получит 409 CONFLICT (reason: REFRESH_IN_PROGRESS) — клиент повторит
  // запрос, а не сделает logout. 401 здесь семантически неверен: токен
  // валиден, просто уже обрабатывается.
  const lockKey = `refresh-lock:${tokenHash(refreshToken)}`;
  const lockAcquired = await redis.set(lockKey, '1', 'EX', 5, 'NX');
  if (lockAcquired === null) {
    throw new ConflictError(
      'Refresh уже обрабатывается — повторите через секунду',
      { reason: 'REFRESH_IN_PROGRESS' },
    );
  }

  try {
    await revokeToken(refreshToken, 'rotation');

    let newRole: Role = payload.role;
    if (roleResolver) {
      try {
        newRole = await roleResolver(payload.sub);
      } catch {
        // ignore — оставляем старую роль
      }
    }

    return issueTokens({
      sub: payload.sub,
      externalId: payload.externalId,
      role: newRole,
      directionId: payload.directionId,
      sessionId: payload.sessionId,
    });
  } finally {
    // Lock auto-expires через 5s, но снимаем явно — чтобы следующий
    // легитимный refresh с тем же токеном (например, при повторном
    // клике в UI) не ждал 5 секунд.
    await redis.del(lockKey).catch(() => undefined);
  }
}

// -------- Blacklist --------

const BLACKLIST_PREFIX = 'blacklist:';

// P15: sha256 hex slice(0,32) — стабильный хэш от всего токена.
// Раньше token.slice(-32) брал хвост подписи; при изменении формата
// (padding, добавление полей) возможна коллизия.
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export async function revokeToken(token: string, reason: string): Promise<void> {
  const decoded = decodeToken(token);
  if (!decoded) {
    return;
  }

  // P16: assert type. decodeToken по умолчанию ставит 'access', если
  // raw.type !== 'refresh'. Явная проверка ловит мусор вроде "abc.def.ghi"
  // (decodeToken вернёт null и мы не дойдём, но на будущее — страховка).
  if (decoded.type !== 'refresh' && decoded.type !== 'access') {
    throw new Error(`Unexpected token type: ${String(decoded.type)}`);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = decoded.exp > 0 ? decoded.exp : nowSec + JWT_REFRESH_TTL_SEC;
  const ttl = Math.max(1, expSec - nowSec);

  await redis.set(
    `${BLACKLIST_PREFIX}${tokenHash(token)}`,
    JSON.stringify({ reason, revokedAt: new Date().toISOString() }),
    'EX',
    ttl,
  );
}

export async function isRevoked(token: string): Promise<boolean> {
  const v = await redis.get(`${BLACKLIST_PREFIX}${tokenHash(token)}`);
  return v !== null;
}

// Удаление одной сессии — для /auth/logout.
// Убивает session:<id> → isSessionActive возвращает false.
// P7: также удаляет из SET participant:<id>:sessions.
export async function revokeSession(sessionId: UUID): Promise<void> {
  if (!sessionId) {return;}
  // Читаем participantId из session-ключа ДО удаления — чтобы
  // почистить индекс participant:<id>:sessions.
  const raw = await redis.get(`session:${sessionId}`);
  let participantId: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { participantId?: string };
      participantId = parsed.participantId ?? null;
    } catch {
      // ignore
    }
  }
  await redis.del(`session:${sessionId}`);
  if (participantId) {
    await redis.srem(`participant:${participantId}:sessions`, sessionId);
  }
}

// Проверка живости сессии.
export async function isSessionActive(sessionId: UUID): Promise<boolean> {
  if (!sessionId) {
    return false;
  }
  const v = await redis.get(`session:${sessionId}`);
  return v !== null;
}

// P7: O(1) вместо O(N) scan('session:*').
// issueTokens кладёт sessionId в SET participant:<id>:sessions.
export async function revokeAllForParticipant(participantId: UUID): Promise<number> {
  const sessionsKey = `participant:${participantId}:sessions`;
  const sessionIds = await redis.smembers(sessionsKey);
  if (sessionIds.length === 0) {
    return 0;
  }

  const keys = sessionIds.map((id) => `session:${id}`);
  await redis.del(...keys);
  await redis.del(sessionsKey);
  return sessionIds.length;
}

// -------- TTL --------

export function getAccessTtl(): number {
  return JWT_ACCESS_TTL_SEC;
}

export function getRefreshTtl(): number {
  return JWT_REFRESH_TTL_SEC;
}