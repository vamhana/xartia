// A.1.99.05 — Middleware ограничения запросов
// Обёртка над S.0.01.06. Sliding window. 429 при превышении.
// Заголовки: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After.

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';

import type { Role } from '../../core/roles.js';
import {
  consume,
  checkRateLimit,
  getConfigForRole,
  raiseRateLimit,
  type RateLimitConfig,
} from '../../security/rate-limit.js';

import { getAuthContext } from './auth.js';

export interface RateLimitOptions {
  scenario?: string;             // явное имя сценария; иначе — из URL
  config?: RateLimitConfig;      // явная конфигурация; иначе — из RATE_LIMITS
  keyBy?: 'ip' | 'participant';  // override keyBy
}

// Достаём participantId из request, если authMiddleware уже отработал.
// Для публичных роутов (login/register) — undefined, ключ по IP.
function tryGetParticipantId(req: FastifyRequest): string | undefined {
  try {
    const ctx = getAuthContext(req);
    return ctx.participantId;
  } catch {
    return undefined;
  }
}

function tryGetRole(req: FastifyRequest): Role | null {
  try {
    return getAuthContext(req).role;
  } catch {
    return null;
  }
}

function buildKey(req: FastifyRequest, config: RateLimitConfig, keyByOverride?: 'ip' | 'participant'): string {
  const keyBy = keyByOverride ?? config.keyBy ?? 'ip';
  if (keyBy === 'participant') {
    const pid = tryGetParticipantId(req);
    if (pid) {return `participant:${pid}`;}
    // Не авторизован — откатываемся на IP
    return `ip:${req.ip}`;
  }
  if (keyBy === 'route') {
    return `route:${req.method}:${req.url}`;
  }
  return `ip:${req.ip}`;
}

export function rateLimit(options: RateLimitOptions = {}): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // RATE_LIMIT_ENABLED=false — документированный выключатель (.env.example,
    // k8s configmap), но до сих пор он нигде не читался: в CI, где он выставлен,
    // лимиты продолжали работать и smoke-тесты падали с 429 RATE_LIMIT.
    // Проверяем на каждом вызове, а не при импорте: значение приходит из env.
    if (process.env['RATE_LIMIT_ENABLED'] === 'false') {return;}

    const config = options.config ?? getConfigForRole(tryGetRole(req), req.url, req.method);

    const key = buildKey(req, config, options.keyBy);
    const check = await consume(key, config);

    reply.header('X-RateLimit-Limit', String(check.limit));
    reply.header('X-RateLimit-Remaining', String(check.remaining));
    reply.header('X-RateLimit-Reset', check.resetAt);

    if (!check.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((new Date(check.resetAt).getTime() - Date.now()) / 1000));
      reply.header('Retry-After', String(retryAfterSec));
      raiseRateLimit(check);
    }
  };
}

// Фабрика с явным config — для случаев, когда сценарий известен заранее
// (например, для кастомного лимита на конкретный эндпоинт).
export function rateLimitExplicit(config: RateLimitConfig): preHandlerHookHandler {
  return rateLimit({ config });
}

// Только чтение (без инкремента) — для UI-панелей, показывающих остаток.
// Использует ТОТ ЖЕ конфиг и ключ, что и `rateLimit`/`consume` — иначе
// X-RateLimit-Remaining считался бы по другой корзине (например, при
// config.keyBy='route' или при конфиге, зависящем от роли).
export function rateLimitCheck(scenario: string): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // scenario зарезервирован под именованные сценарии: сейчас конфиг
    // резолвится по URL+роли (как и в rateLimit), а scenario — no-op.
    void scenario;

    const config = getConfigForRole(tryGetRole(req), req.url, req.method);
    const key = buildKey(req, config);
    const check = await checkRateLimit(key, config);
    reply.header('X-RateLimit-Limit', String(check.limit));
    reply.header('X-RateLimit-Remaining', String(check.remaining));
    reply.header('X-RateLimit-Reset', check.resetAt);
  };
}