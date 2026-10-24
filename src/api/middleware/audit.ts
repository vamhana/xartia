// A.1.99.03 — Middleware аудита
// Прикрепляет request.auditId (для последующей записи в audit_log через сервисы),
// читает X-Audit-Reason и X-Request-ID, проставляет X-Audit-Id в ответе.
//
// TECHDEBT: middleware НЕ пишет в audit_log — это ответственность сервисов
//   (S.0.01.05, C.0.01.05). Fallback flush в system_events — там же.
// X-Audit-Id в ответе всегда совпадает с request.auditId — иначе downstream
//   логи и ответ клиенту разъедутся по идентификатору.

import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';

import { newUUID } from '../../lib/id.js';

const MAX_CLIENT_REQUEST_ID_LEN = 128;

declare module 'fastify' {
  interface FastifyRequest {
    auditId: string;
    auditReason?: string;
    requestIp?: string;
  }
}

export const auditMiddleware: onRequestHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  request.auditId = newUUID();

  const reason = request.headers['x-audit-reason'];
  if (typeof reason === 'string') {request.auditReason = reason;}

  // Клиентский X-Request-ID имеет приоритет над сгенерированным auditId —
  // это позволяет корреляцию между клиентом и сервером. Длина ограничена,
  // чтобы клиент не мог раздуть audit_log (или подменить id мусором).
  const reqId = request.headers['x-request-id'];
  if (
    typeof reqId === 'string' &&
    reqId.length > 0 &&
    reqId.length <= MAX_CLIENT_REQUEST_ID_LEN
  ) {
    request.auditId = reqId;
  }

  request.requestIp = request.ip;

  // ВАЖНО: header ставим ПОСЛЕ выбора финального auditId.
  reply.header('X-Audit-Id', request.auditId);
};