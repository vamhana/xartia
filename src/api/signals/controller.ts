// A.1.10.01 — Контроллер Signals
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (11-й дубль).
//   - status enum inline → signalStatusSchema из L.0.01.03.
//   - rateLimit(api.write) на 4 мутациях.
//   - respondBody.justification: +max(2000).
//   - respondBody.data: +refine(JSON ≤ 10000).
//
// ОСТАЁТСЯ ТЕХДОЛГ (требует C.0.10.02):
//   - B1: escalate — есть ли проверка iterations >= 3 в markAsEscalated?
//   - B2: respondService — проверка direction_id === auth.direction? (иначе
//     signal:C позволяет отвечать «за любое направление»).
//   - B3: routeSignal — проверка статуса сигнала (нельзя для completed).
//   - B4: respondService — граница iterations при clarify.
//   - B5: routeSignal — транзакция с обновлением статуса сигнала?
//   - B6: respondService — уникальность (direction_id, signal_id)?
//   - B7: GET /signals* — без requireRight (16/28 ролей видят чужие сигналы).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { routeSignal } from '../../core/connectivity/service.js';
import {
  listSignals, getById, createSignalService, respondService,
  listResponses, markAsEscalated,
} from '../../core/signals/service.js';
import {
  uuidIdParams,
  uuidSchema,
  prioritySchema,
  signalTypeSchema,
  signalResponseSchema,
  signalStatusSchema,           // ← T2
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  priority: prioritySchema.optional(),
  status: signalStatusSchema.optional(),       // ← T2
  type: signalTypeSchema.optional(),
  lead_direction_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  type: signalTypeSchema,
  description: z.string().min(1).max(5000),
  justification: z.string().min(1).max(2000),
  priority: prioritySchema,
  directions: z.array(uuidSchema).optional(),
  desired_deadline: z.string().datetime({ offset: true }).optional(),
  lead_direction_id: uuidSchema.optional(),
});

const respondBody = z.object({
  direction_id: uuidSchema,
  response: signalResponseSchema,
  justification: z.string().min(1).max(2000),   // ← T4
  data: z.record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 10_000, {
      message: 'data: JSON ≤ 10KB',
    })
    .optional(),                                // ← T5
  consequences: z.string().max(2000).optional(),
  needs: z.string().max(2000).optional(),
});

const routeBody = z.object({
  target_direction_id: uuidSchema,
  reason: z.string().max(500).optional(),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });   // ← T3

export async function registerSignalsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/signals', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const result = await listSignals({
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.lead_direction_id ? { leadDirectionId: q.lead_direction_id } : {}),
      page: q.page, perPage: q.per_page,
    });
    reply.send({
      data: result.data,
      meta: { page: q.page, per_page: q.per_page, total: result.total },
      audit_id: req.auditId,
    });
  });

  app.get('/signals/:id', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const signal = await getById(p.id);
    reply.send({ ...signal, audit_id: req.auditId });
  });

  app.post(
    '/signals',
    { preHandler: [authMiddleware, writeLimit, requireRight('signal', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const signal = await createSignalService({
        type: b.type,
        description: b.description,
        justification: b.justification,
        priority: b.priority,
        ...(b.directions ? { directions: b.directions } : {}),
        ...(b.desired_deadline ? { desiredDeadline: b.desired_deadline } : {}),
        ...(b.lead_direction_id ? { leadDirectionId: b.lead_direction_id } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...signal, audit_id: req.auditId });
    },
  );

  app.get(
    '/signals/:id/responses',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const responses = await listResponses(p.id);
      reply.send({ data: responses, audit_id: req.auditId });
    },
  );

  app.post(
    '/signals/:id/responses',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('signal', 'C'),
        validateParams(uuidIdParams),
        validateBody(respondBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof respondBody>;
      // B2: сервис проверяет b.direction_id === requesterDirectionId.
      const response = await respondService(
        p.id,
        b.direction_id,
        {
          response: b.response,
          justification: b.justification,
          ...(b.data ? { data: b.data } : {}),
          ...(b.consequences ? { consequences: b.consequences } : {}),
          ...(b.needs ? { needs: b.needs } : {}),
        },
        auth.participantId,
        auth.directionId,   // для B2-проверки в сервисе
      );
      reply.status(201).send({ ...response, audit_id: req.auditId });
    },
  );

  app.post(
    '/signals/:id/route',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('signal', 'E'),
        validateParams(uuidIdParams),
        validateBody(routeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof routeBody>;
      const item = await routeSignal({
        signalId: p.id,
        targetDirectionId: b.target_direction_id,
        ...(b.reason ? { reason: b.reason } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...item, audit_id: req.auditId });
    },
  );

  // POST /signals/:id/escalate — TODO(techdebt, B1): проверка iterations >= 3
  // должна быть в markAsEscalated. Сейчас любой signal:E эскалирует любой сигнал.
  app.post(
    '/signals/:id/escalate',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('signal', 'E'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const signal = await markAsEscalated(p.id, 'Достигнут лимит итераций', auth.participantId);
      reply.status(201).send({ signal, audit_id: req.auditId });
    },
  );
}