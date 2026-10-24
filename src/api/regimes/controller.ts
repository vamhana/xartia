// A.1.17.01 — Контроллер Regimes
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (20-й дубль).
//   - inline z.object({ mid }) × 3 → uuidMobilizationParams.
//   - writeLimit(api.write) на 6 мутациях.
//   - activateBody.conditions: +refine(JSON ≤ 100KB).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - voteLiftSteelBell — roadmap (политический механизм I.2.5.2).
//   - GET /regimes*, /mobilization/* — без requireRight (operational data).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  list, getById, getActive, isInfoBlockadeActive, isQuantumAccelerationActive,
  activateService, deactivateService, auditService,
  getMobilization, startMobilization, confirmMobilization, refuseMobilization,
  getMobilizationShare, getCurrentDeadlines,
} from '../../core/regimes/service.js';
import { uuidIdParams, uuidMobilizationParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const activateBody = z.object({
  type: z.enum([
    'red_circuit', 'steel_bell', 'ptt',
    'info_blockade', 'quantum_acceleration', 'global_red_circuit',
  ]),
  reason: z.string().min(1).max(1000),
  direction_id: uuidSchema.optional(),
  conditions: z.record(z.unknown())
    .refine((c) => JSON.stringify(c).length <= 100_000, {
      message: 'conditions: JSON ≤ 100KB',
    })
    .optional(),
  context: z.object({
    hasThreatAboveTenPercent: z.boolean().optional(),
    noGatewayData: z.boolean().optional(),
    lastPttAt: z.string().datetime({ offset: true }).nullable().optional(),
    isRedCircuitRequested: z.boolean().optional(),
    isQuantumAccelerationRequested: z.boolean().optional(),
    isGlobalThreat: z.boolean().optional(),
  }).default({}),
});

const deactivateBody = z.object({ reason: z.string().min(1).max(1000) });

const mobilizationBody = z.object({
  required_count: z.number().int().positive(),
  threshold_percent: z.number().min(0).max(100).default(10),
});

const refuseBody = z.object({ reason: z.string().max(1000).optional() });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerRegimesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/regimes', { preHandler: authMiddleware }, async (req, reply) => {
    const items = await list();
    reply.send({ data: items, audit_id: req.auditId });
  });

  app.get('/regimes/active', { preHandler: authMiddleware }, async (req, reply) => {
    const items = await getActive();
    reply.send({ data: items, audit_id: req.auditId });
  });

  app.get('/regimes/current-deadlines', { preHandler: authMiddleware }, async (req, reply) => {
    const deadlines = await getCurrentDeadlines();
    reply.send({
      ...deadlines,
      info_blockade_active: await isInfoBlockadeActive(),
      quantum_acceleration_active: await isQuantumAccelerationActive(),
      audit_id: req.auditId,
    });
  });

  app.get(
    '/regimes/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const r = await getById(p.id);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes',
    { preHandler: [authMiddleware, writeLimit, requireRight('regime', 'Act'), validateBody(activateBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof activateBody>;
      const r = await activateService({
        type: b.type,
        reason: b.reason,
        ...(b.direction_id ? { directionId: b.direction_id } : {}),
        ...(b.conditions ? { conditions: b.conditions } : {}),
        context: b.context,
      }, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes/:id/deactivate',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('regime', 'Act'),
        validateParams(uuidIdParams),
        validateBody(deactivateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof deactivateBody>;
      const r = await deactivateService(p.id, b.reason, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes/:id/audit',
    { preHandler: [authMiddleware, writeLimit, requireRight('regime', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const result = await auditService(p.id, auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // -------- Мобилизация --------

  app.get(
    '/regimes/:id/mobilization',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const m = await getMobilization(p.id);
      reply.send({ data: m, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes/:id/mobilization',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('regime', 'Act'),
        validateParams(uuidIdParams),
        validateBody(mobilizationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof mobilizationBody>;
      const m = await startMobilization(p.id, b.required_count, b.threshold_percent, auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes/mobilization/:mid/confirm',
    { preHandler: [authMiddleware, writeLimit, validateParams(uuidMobilizationParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidMobilizationParams>;
      const m = await confirmMobilization(p.mid, auth.participantId);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );

  app.post(
    '/regimes/mobilization/:mid/refuse',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        validateParams(uuidMobilizationParams),
        validateBody(refuseBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidMobilizationParams>;
      const b = req.body as z.infer<typeof refuseBody>;
      const r = await refuseMobilization(p.mid, auth.participantId, b.reason ?? null);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  app.get(
    '/regimes/mobilization/:mid/share',
    { preHandler: [authMiddleware, validateParams(uuidMobilizationParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidMobilizationParams>;
      const share = await getMobilizationShare(p.mid);
      reply.send({ ...share, audit_id: req.auditId });
    },
  );
}