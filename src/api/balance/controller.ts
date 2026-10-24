// A.1.18.01 — Контроллер Balance
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (21-й дубль).
//   - 6 мутаций — rateLimit(api.write).
//   - GET /balance* — +requireRight('balance','V') (PII: metrics/pulse/risks).
//   - metaRequestBody.target_directions: +max(50).
//   - POST /balance/detect — emit в try/catch per-anomaly (best-effort).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - period в getMetrics — не поддерживается на уровне контроллера.
//   - listMetaFlows (GET /balance/meta-flows) — roadmap.
//   - monitorGateway — заглушка (0/0).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { detectAnomalies, persistAnomalies } from '../../ai/anomaly.js';
import {
  listAnomalies, getAnomaly, resolveAnomaly, createMetaRequest,
  listNormativeSpeeds, recalcNormativeSpeeds,
  listCompetenceRisks, addCompetenceRisk, removeCompetenceRisk,
  listIndices, getPulse, getMetrics,
} from '../../core/balance/service.js';
import { logger } from '../../lib/logger.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { emitAnomalyDetected } from '../../ws/balance.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const anomaliesQuery = z.object({
  type: z.enum(['speed', 'format', 'etiquette', 'priority', 'iteration']).optional(),
  status: z.enum(['new', 'analyzed', 'resolved']).optional(),
  direction_id: uuidSchema.optional(),
  min_severity: z.coerce.number().int().min(1).max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const metaRequestBody = z.object({
  target_directions: z.array(uuidSchema).min(1).max(50),   // ← T4
});

const riskBody = z.object({
  direction_id: uuidSchema,
  reason: z.string().min(1).max(1000),
});

const indicesQuery = z.object({
  type: z.enum(['defense_maturity', 'excess_capacity', 'import_dependency']).optional(),
});

const pulseQuery = z.object({
  direction_id: uuidSchema.optional(),
});

const detectBody = z.object({
  direction_id: uuidSchema.optional(),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerBalanceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/balance/metrics',
    { preHandler: [authMiddleware, requireRight('balance', 'V'), validateQuery(pulseQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof pulseQuery>;
      const m = await getMetrics(q.direction_id);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );

  app.get(
    '/balance/pulse',
    { preHandler: [authMiddleware, requireRight('balance', 'V'), validateQuery(pulseQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof pulseQuery>;
      const p = await getPulse(q.direction_id);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  app.get(
    '/balance/anomalies',
    { preHandler: [authMiddleware, requireRight('balance', 'V'), validateQuery(anomaliesQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof anomaliesQuery>;
      const result = await listAnomalies({
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
        ...(q.min_severity !== undefined ? { minSeverity: q.min_severity } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  app.get(
    '/balance/anomalies/:id',
    { preHandler: [authMiddleware, requireRight('balance', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await getAnomaly(p.id);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/balance/anomalies/:id/resolve',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('balance', 'E'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await resolveAnomaly(p.id, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/balance/anomalies/:id/meta-request',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('balance', 'C'),
        validateParams(uuidIdParams),
        validateBody(metaRequestBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof metaRequestBody>;
      const result = await createMetaRequest(p.id, b.target_directions, auth.participantId);
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );

  app.post(
    '/balance/detect',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('balance', 'C'),
        validateBody(detectBody),
      ],
    },
    async (req, reply) => {
      const b = req.body as z.infer<typeof detectBody>;
      const candidates = await detectAnomalies(b.direction_id);
      const persisted = await persistAnomalies(candidates);
      // B11: emit per-anomaly best-effort — падение одного не ломает остальные.
      for (const a of persisted) {
        try {
          await emitAnomalyDetected(a);
        } catch (e) {
          logger.warn({ err: e, anomalyId: a.id }, 'balance detect: WS emit failed');
        }
      }
      reply.send({
        detected: candidates.length,
        persisted: persisted.length,
        anomalies: persisted,
        audit_id: req.auditId,
      });
    },
  );

  app.get(
    '/balance/norms',
    { preHandler: [authMiddleware, requireRight('balance', 'V')] },
    async (req, reply) => {
      const norms = await listNormativeSpeeds();
      reply.send({ data: norms, audit_id: req.auditId });
    },
  );

  app.post(
    '/balance/norms/recalc',
    { preHandler: [authMiddleware, writeLimit, requireRight('balance', 'E')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const result = await recalcNormativeSpeeds(auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  app.get(
    '/balance/risks',
    { preHandler: [authMiddleware, requireRight('balance', 'V')] },
    async (req, reply) => {
      const risks = await listCompetenceRisks();
      reply.send({ data: risks, audit_id: req.auditId });
    },
  );

  app.post(
    '/balance/risks',
    { preHandler: [authMiddleware, writeLimit, requireRight('balance', 'C'), validateBody(riskBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof riskBody>;
      const risk = await addCompetenceRisk(b.direction_id, b.reason, auth.participantId);
      reply.status(201).send({ ...risk, audit_id: req.auditId });
    },
  );

  app.delete(
    '/balance/risks/:id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('balance', 'D'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      await removeCompetenceRisk(p.id, auth.participantId);
      reply.status(204).send();
    },
  );

  app.get(
    '/balance/indices',
    { preHandler: [authMiddleware, requireRight('balance', 'V'), validateQuery(indicesQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof indicesQuery>;
      const indices = await listIndices(q.type);
      reply.send({ data: indices, audit_id: req.auditId });
    },
  );
}