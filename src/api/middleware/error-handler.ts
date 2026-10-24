// A.1.99.07 — Глобальный обработчик ошибок
// Единый формат ответа. Логирование stack trace. Маппинг доменных ошибок на HTTP.
//
// ВАЖНО: перед любым reply.send() проверяем reply.sent / reply.raw.headersSent.
// Если ответ уже ушёл (replay из idempotency-хука, стрим, ранний send) —
// повторный send бросает FST_ERR_REP_ALREADY_SENT и маскирует настоящую ошибку.
//
// ВАЖНО: audit_id в теле ответа ВСЕГДА совпадает с X-Audit-Id в заголовке и
// с request.auditId, который используется сервисами при logAction. Иначе
// клиент видит один id, а audit_log хранит другой — невозможно сопоставить.
// Если auditMiddleware ещё не отработал (например, упал сам) — fallback на
// request.id (Fastify genReqId), и только в крайнем случае — newUUID().

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { isAppError, toHttpResponse } from '../../core/errors.js';
import { newUUID } from '../../lib/id.js';
import { logger, serializeError } from '../../lib/logger.js';

function alreadySent(reply: FastifyReply): boolean {
  return reply.sent === true || reply.raw.headersSent === true;
}

// request.auditId ставится auditMiddleware (onRequest). Если по какой-то
// причине его нет (middleware не подключён, отработал с ошибкой) —
// используем request.id от Fastify (genReqId: newUUID). newUUID() — последний
// рубеж, чтобы audit_id вообще был в ответе.
function resolveAuditId(request: FastifyRequest): string {
  return request.auditId ?? request.id ?? newUUID();
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const auditId = resolveAuditId(request);

  // Если ответ уже отправлен — только логируем, не пытаемся ответить повторно.
  if (alreadySent(reply)) {
    logger.warn(
      {
        err: serializeError(error),
        url: request.url,
        method: request.method,
        auditId,
        statusCode: reply.statusCode,
      },
      'error-handler: reply already sent, skipping send',
    );
    return;
  }

  // Zod — превращаем в ValidationError-совместимый ответ
  if (error instanceof ZodError) {
    // Zod 3: `issues` — каноничное, `errors` — deprecated алиас.
    // Zod 4: `errors` удалён, остаётся только `issues`.
    const issues = error.issues ?? error.errors ?? [];
    reply.status(422).send({
      code: 'VALIDATION_ERROR',
      message: 'Ошибка валидации',
      details: {
        fields: issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
      audit_id: auditId,
    });
    return;
  }

  if (isAppError(error)) {
    const { statusCode, body } = toHttpResponse(error, auditId);
    if (statusCode >= 500) {
      logger.error({ err: serializeError(error), auditId }, 'app error');
    } else if (statusCode >= 400) {
      logger.warn({ code: error.code, auditId }, error.message);
    }
    reply.status(statusCode).send(body);
    return;
  }

  // Fastify validation (schema-based, не Zod)
  if ((error as FastifyError).validation) {
    reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: error.message,
      audit_id: auditId,
    });
    return;
  }

  // 404
  if ((error as FastifyError).statusCode === 404) {
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: 'Маршрут не найден',
      audit_id: auditId,
    });
    return;
  }

  // Неизвестная ошибка
  logger.error(
    { err: serializeError(error), url: request.url, method: request.method, auditId },
    'unhandled error',
  );
  reply.status(500).send({
    code: 'INTERNAL_ERROR',
    message: 'Внутренняя ошибка сервера',
    audit_id: auditId,
  });
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply): void {
  const auditId = resolveAuditId(req);

  if (alreadySent(reply)) {
    logger.warn(
      { url: req.url, method: req.method, auditId, statusCode: reply.statusCode },
      'notFoundHandler: reply already sent, skipping send',
    );
    return;
  }
  reply.status(404).send({
    code: 'NOT_FOUND',
    message: 'Маршрут не найден',
    audit_id: auditId,
  });
}