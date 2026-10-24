// A.1.12.01 — Контроллер Arbitrations
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (15-й дубль).
//   - type/status enums → arbitrationTypeSchema/arbitrationStatusSchema из L.0.01.03.
//   - rateLimit(api.write) на 5 мутациях.
//   - GET /arbitrations* — +requireRight('arbitration','V')
//     (было: любой авторизованный видел question/decision — юридические тексты).
//   - submitBody: +refine(procedural требует connectionId).
//   - escalateBody.reason — передаётся в escalateToJuryService (было: терялся).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - entity escalateToJury не принимает reason — reason только в audit_log.
//     Для сохранения в БД нужна миграция + правка entity.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listArbitrations, getById, submitArbitrationService,
  startProcessingService, decideService, escalateToJuryService,
  publishInterimService, listOverdue, getPrecedents,
} from '../../core/arbitrations/service.js';
import {
  uuidIdParams,
  uuidSchema,
  arbitrationTypeSchema,
  arbitrationStatusSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  type: arbitrationTypeSchema.optional(),
  status: arbitrationStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const precedentsQuery = z.object({
  type: arbitrationTypeSchema.optional(),
});

const submitBody = z.object({
  type: arbitrationTypeSchema,
  connection_id: uuidSchema.optional(),
  signal_id: uuidSchema.optional(),
  parties: z.array(uuidSchema).max(50).optional(),
  question: z.string().min(1).max(5000),
}).refine(
  (b) => b.type === 'ownership' || b.connection_id !== undefined,
  { message: 'Для type=procedural требуется connection_id (I.3.7)', path: ['connection_id'] },
);

const decideBody = z.object({
  decision: z.string().min(1).max(10000),
});

const escalateBody = z.object({
  reason: z.string().min(1).max(500),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerArbitrationsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/arbitrations',
    { preHandler: [authMiddleware, requireRight('arbitration', 'V'), validateQuery(listQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const result = await listArbitrations({
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
        page: q.page, perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  app.get(
    '/arbitrations/overdue',
    { preHandler: [authMiddleware, requireRight('arbitration', 'V')] },
    async (req, reply) => {
      const items = await listOverdue();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/arbitrations/precedents',
    { preHandler: [authMiddleware, requireRight('arbitration', 'V'), validateQuery(precedentsQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof precedentsQuery>;
      const items = await getPrecedents(q.type);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/arbitrations/:id',
    { preHandler: [authMiddleware, requireRight('arbitration', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await getById(p.id);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/arbitrations',
    { preHandler: [authMiddleware, writeLimit, requireRight('arbitration', 'C'), validateBody(submitBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof submitBody>;
      const a = await submitArbitrationService({
        type: b.type,
        ...(b.connection_id ? { connectionId: b.connection_id } : {}),
        ...(b.signal_id ? { signalId: b.signal_id } : {}),
        ...(b.parties ? { parties: b.parties } : {}),
        question: b.question,
      }, auth.participantId);
      reply.status(201).send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/arbitrations/:id/start',
    { preHandler: [authMiddleware, writeLimit, requireRight('arbitration', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await startProcessingService(p.id, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/arbitrations/:id/decision',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('arbitration', 'A'),
        validateParams(uuidIdParams),
        validateBody(decideBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof decideBody>;
      const a = await decideService(p.id, b.decision, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/arbitrations/:id/escalate',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('arbitration', 'E'),
        validateParams(uuidIdParams),
        validateBody(escalateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof escalateBody>;
      // B1-fix: reason передаётся в сервис.
      const a = await escalateToJuryService(p.id, b.reason, auth.participantId);
      reply.status(201).send({ arbitration: a, audit_id: req.auditId });
    },
  );

  app.post(
    '/arbitrations/:id/interim',
    { preHandler: [authMiddleware, writeLimit, requireRight('arbitration', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const result = await publishInterimService(p.id, auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );
}