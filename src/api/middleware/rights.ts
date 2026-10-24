// A.1.99.02 — Middleware проверки прав
// Вызов checkRight. Возврат 403 + запись в access_log.
//
// Два варианта:
//   - requireRight(resource, action, scope?) — простой случай: targetId берётся
//     из request.params.id. Подходит для роутов /:id.
//   - rightsMiddleware({ targetIdExtractor }) — гибкий: targetId извлекается
//     из body/query/headers через кастомную функцию.
//
// TECHDEBT: requireRight хардкодит targetId из request.params.id. Для роутов,
//   где target живёт не в params.id (body.id, query.target_id), использовать
//   rightsMiddleware — иначе проверка пройдёт по null targetId.
// TECHDEBT: logAccessDenied пишет напрямую в access_log (SQL), минуя
//   audit-сервис (C.0.01.05). При унификации потока аудита — переиспользовать.
// NOTE: rightsMiddleware сейчас НЕ логирует отказы в access_log — асимметрия
//   с requireRight. Осознанно: гибкий вариант для нестандартных проверок, где
//   причина отказа формируется сервисом. Если применяется на мутациях —
//   добавить логирование (см. план Фазы 2).
// NOTE: access_log фиксирует только отказы (granted=false). Успехи проходят
//   через logAction в сервисах. Имя таблицы шире фактического назначения —
//   кандидат на переименование в access_denied_log.
// NOTE: logAccessDenied экспортирован с объектным API — контроллеры могут
//   писать отказы в access_log даже без requireRight (например, role-based
//   approve в A.1.01.01).

import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { ForbiddenError } from '../../core/errors.js';
import { checkRight, assertRight } from '../../core/rights.js';
import type { RightAction, RightScope, UUID } from '../../core/types.js';
import { query } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

import { getAuthContext } from './auth.js';

export interface RightCheckOptions {
  resource: string;
  action: RightAction;
  scope?: RightScope;
  targetIdExtractor?: (req: FastifyRequest) => UUID | undefined;
}

export interface AccessDeniedParams {
  participantId: UUID;
  resource: string;
  action: RightAction;
  targetId?: UUID | null;
  reason: string;
  ip?: string;
}

/**
 * Публичная функция для логирования отказа в access_log.
 * Используется:
 *   - внутри requireRight (автоматически при !allowed);
 *   - снаружи (контроллеры, где проверка прав делается вручную — например,
 *     role-based approve в A.1.01.01).
 */
export async function logAccessDenied(params: AccessDeniedParams): Promise<void> {
  try {
    await query(
      `INSERT INTO access_log (participant_id, resource, resource_id, action, granted, reason, ip)
       VALUES ($1, $2, $3, $4, false, $5, $6)`,
      [
        params.participantId,
        params.resource,
        params.targetId ?? null,
        params.action,
        params.reason,
        params.ip ?? null,
      ],
    );
  } catch (e) {
    logger.error({ err: e }, 'failed to write access_log');
  }
}

export function requireRight(
  resource: string,
  action: RightAction,
  scope?: RightScope,
  targetIdExtractor?: (req: FastifyRequest) => UUID | undefined,
): preHandlerHookHandler {
  return async (request) => {
    const auth = getAuthContext(request);
    const targetId = targetIdExtractor
      ? targetIdExtractor(request)
      : (request.params as Record<string, string>)['id'] ?? undefined;

    const result = await checkRight({
      participantId: auth.participantId,
      resource,
      action,
      targetId: targetId ?? null,
      ...(scope ? { scope } : {}),
    });

    if (!result.allowed) {
      await logAccessDenied({
        participantId: auth.participantId,
        resource,
        targetId: targetId ?? null,
        action,
        reason: result.reason,
        ip: request.ip,
      });
      throw new ForbiddenError(result.reason, {
        resource,
        action,
        ...(targetId ? { targetId } : {}),
      });
    }
  };
}

// Более гибкий вариант с кастомным targetId
export function rightsMiddleware(options: RightCheckOptions): preHandlerHookHandler {
  return async (request) => {
    const auth = getAuthContext(request);
    const targetId = options.targetIdExtractor?.(request) ?? null;

    await assertRight({
      participantId: auth.participantId,
      resource: options.resource,
      action: options.action,
      targetId,
      ...(options.scope ? { scope: options.scope } : {}),
    });
  };
}