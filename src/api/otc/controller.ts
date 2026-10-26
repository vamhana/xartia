// A.1.09.01 — Контроллер OTC
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - decisionParams → uuidIdParams (10-й дубль).
//   - GET /otc/queue, /stats, /decisions/:id/appeals, /appeals/:id — +requireRight('otc','V').
//     Было: любой авторизованный видел PII (comment/mediaUrl/geolocation/authorName).
//     Побочка: F.4.99.18 Sidebar — добавить requiresRole:['OTC','FIRST_ARCHITECT'].
//   - crisisBody.comment: +min(1) (согласовано с decideBody.comment).
//   - rateLimit(api.write) на 3 мутациях.
//
// ОСТАЁТСЯ ТЕХДОЛГ (требует C.0.09.02):
//   - POST /otc/decisions/:id/appeal — self-service; проверка authorId === requester
//     должна быть в сервисе. Спека молчит — проверить.
//   - POST /otc/crisis-decision — упрощённая проверка (2 флага) может обходить I.2.12.
//   - GET /otc/decisions/:id (карточка), /acceptance-criteria — roadmap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getQueue, decide, crisisDecide, getStats,
  getActiveCriteria, getSla, escalateOverdue,
  appeal, getAppeal, listAppealsByDecision,
} from '../../core/otc/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validation.js';

const queueQuery = z.object({ direction_id: uuidSchema.optional() });

const decideBody = z.object({
  report_id: uuidSchema,
  verdict: z.enum(['accepted', 'returned']),
  comment: z.string().min(1).max(5000).optional(),
  criteria: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    comment: z.string().max(2000).optional(),
  })).optional(),
});

const crisisBody = z.object({
  report_id: uuidSchema,
  functionality_ok: z.boolean(),
  safety_ok: z.boolean(),
  comment: z.string().min(1).max(5000).optional(),   // ← + min(1)
});

const appealBody = z.object({
  reason: z.string().min(1).max(5000),
});

const statsQuery = z.object({ direction_id: uuidSchema.optional() });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerOtcRoutes(app: FastifyInstance): Promise<void> {
  // GET /otc/queue — очередь ОТК (PII: comment/mediaUrl/geolocation). otc:V.
  app.get(
    '/otc/queue',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateQuery(queueQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof queueQuery>;
      const queue = await getQueue(q.direction_id);
      reply.send({ data: queue, audit_id: req.auditId });
    },
  );

  // GET /otc/criteria — активные критерии приёмки (снимок хранится в решении).
  app.get(
    '/otc/criteria',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateQuery(queueQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof queueQuery>;
      const criteria = await getActiveCriteria(q.direction_id);
      reply.send({ data: criteria, audit_id: req.auditId });
    },
  );

  // POST /otc/escalate — уведомить Совет о просроченных проверках.
  app.post(
    '/otc/escalate',
    { preHandler: [authMiddleware, writeLimit, requireRight('otc', 'C'), validateQuery(queueQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof queueQuery>;
      const result = await escalateOverdue(q.direction_id);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // GET /otc/sla — очередь, просрочка и среднее ожидание.
  app.get(
    '/otc/sla',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateQuery(queueQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof queueQuery>;
      const sla = await getSla(q.direction_id);
      reply.send({ ...sla, audit_id: req.auditId });
    },
  );

  // POST /otc/decisions (право: otc:C — только роль OTC)
  app.post(
    '/otc/decisions',
    { preHandler: [authMiddleware, writeLimit, requireRight('otc', 'C'), validateBody(decideBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof decideBody>;
      const decision = await decide({
        reportId: b.report_id,
        verdict: b.verdict,
        ...(b.comment ? { comment: b.comment } : {}),
        ...(b.criteria ? { criteria: b.criteria } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...decision, audit_id: req.auditId });
    },
  );

  // POST /otc/crisis-decision (право: otc:C)
  app.post(
    '/otc/crisis-decision',
    { preHandler: [authMiddleware, writeLimit, requireRight('otc', 'C'), validateBody(crisisBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof crisisBody>;
      const decision = await crisisDecide({
        reportId: b.report_id,
        functionalityOk: b.functionality_ok,
        safetyOk: b.safety_ok,
        ...(b.comment ? { comment: b.comment } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...decision, audit_id: req.auditId });
    },
  );

  // POST /otc/decisions/:id/appeal — апелляция автора отчёта (I.2.13).
  // Self-service: без requireRight, проверка authorId === requester в сервисе.
  app.post(
    '/otc/decisions/:id/appeal',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        validateParams(uuidIdParams),
        validateBody(appealBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof appealBody>;
      const result = await appeal(p.id, auth.participantId, b.reason);
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );

  // GET /otc/decisions/:id/appeals — список апелляций (otc:V)
  app.get(
    '/otc/decisions/:id/appeals',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const items = await listAppealsByDecision(p.id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // GET /otc/appeals/:id — конкретная апелляция (otc:V)
  app.get(
    '/otc/appeals/:id',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const item = await getAppeal(p.id);
      reply.send({ ...item, audit_id: req.auditId });
    },
  );

  // GET /otc/stats — статистика (otc:V)
  app.get(
    '/otc/stats',
    { preHandler: [authMiddleware, requireRight('otc', 'V'), validateQuery(statsQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof statsQuery>;
      const stats = await getStats(q.direction_id);
      reply.send({ ...stats, audit_id: req.auditId });
    },
  );
}