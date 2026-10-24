// A.1.13.01 — Контроллер UniversalRuns
//
// Техдолг закрыт (v0.0.02 → v0.0.03):
//   - idParams/signalParams → uuidIdParams/uuidSignalParams.
//   - type enum → runTypeSchema.
//   - rateLimit(api.write) на 3 мутациях.
//   - GET /universal-runs* — +requireRight('signal','V') (было: PII без прав).
//   - responseBody.data — +refine(JSON ≤ 10KB).
//   - submitRunResponse получает auth.directionId (B1-fix).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - listRunResponses возвращает неполные поля (data/consequences/needs) —
//     C.0.13.02 B8, нужна правка сервиса.
//   - checkTimeouts: 24h вместо PRIORITY_DEADLINES_MS.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  runService, getById, submitRunResponse, listRunResponses,
  aggregateRun, getProgress, canProceed, listBySignal, checkTimeouts,
} from '../../core/universal-runs/service.js';
import {
  uuidIdParams,
  uuidSignalParams,
  uuidSchema,
  signalResponseSchema,
  runTypeSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const runBody = z.object({
  signal_id: uuidSchema,
  type: runTypeSchema,
});

const responseBody = z.object({
  direction_id: uuidSchema,
  response: signalResponseSchema,
  justification: z.string().min(1).max(2000),
  data: z.record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 10_000, {
      message: 'data: JSON ≤ 10KB',
    })
    .optional(),
  consequences: z.string().max(2000).optional(),
  needs: z.string().max(2000).optional(),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerUniversalRunsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/universal-runs',
    { preHandler: [authMiddleware, writeLimit, requireRight('signal', 'E'), validateBody(runBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof runBody>;
      const run = await runService({ signalId: b.signal_id, type: b.type }, auth.participantId);
      reply.status(201).send({ ...run, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/:id',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const run = await getById(p.id);
      reply.send({ ...run, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/signal/:signal_id',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidSignalParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidSignalParams>;
      const runs = await listBySignal(p.signal_id);
      reply.send({ data: runs, audit_id: req.auditId });
    },
  );

  app.post(
    '/universal-runs/:id/responses',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('signal', 'C'),
        validateParams(uuidIdParams),
        validateBody(responseBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof responseBody>;
      const result = await submitRunResponse(p.id, {
        directionId: b.direction_id,
        response: b.response,
        justification: b.justification,
        ...(b.data ? { data: b.data } : {}),
        ...(b.consequences ? { consequences: b.consequences } : {}),
        ...(b.needs ? { needs: b.needs } : {}),
      }, auth.participantId, auth.directionId);
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/:id/responses',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const responses = await listRunResponses(p.id);
      reply.send({ data: responses, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/:id/aggregate',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const summary = await aggregateRun(p.id);
      reply.send({ ...summary, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/:id/progress',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const progress = await getProgress(p.id);
      reply.send({ ...progress, audit_id: req.auditId });
    },
  );

  app.get(
    '/universal-runs/:id/can-proceed',
    { preHandler: [authMiddleware, requireRight('signal', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const result = await canProceed(p.id);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  app.post(
    '/universal-runs/check-timeouts',
    { preHandler: [authMiddleware, writeLimit, requireRight('signal', 'E')] },
    async (req, reply) => {
      const result = await checkTimeouts();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );
}