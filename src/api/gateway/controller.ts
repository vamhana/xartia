// A.1.24.01 — Gateway controller.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (25-й дубль).
//   - rateLimit(api.write) на 11 мутациях (B23).
//   - amount_external / value: +.finite() (B24).
//   - guarantorBody.diagnosis: +refine(JSON ≤ 10KB) (B25).

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { InfoBlockadeError } from '../../core/errors.js';
import {
  getCouncil, addCouncilMember, rotateCouncilMember,
  listTransactions, createTransaction, approveTransaction, auditTransaction,
  listAssets, acceptAsset, convertAsset,
  getGuarantor, appointGuarantor, expireGuarantor,
  listWitnesses, establishWitness,
  activateDefense,
  getSelfSufficiency, dissolve,
} from '../../core/gateway/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { isInfoBlockadeActive } from '../../security/gateway-isolation.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

async function gatewayGuard(_request: FastifyRequest): Promise<void> {
  if (await isInfoBlockadeActive()) {
    throw new InfoBlockadeError(
      'Шлюз изолирован (активна Информационная блокада)',
    );
  }
}

const memberBody = z.object({ member_id: uuidSchema });

const txListQuery = z.object({
  type: z.enum(['purchase', 'sale', 'diplomacy', 'migration']).optional(),
  status: z.enum(['pending', 'approved', 'completed', 'rejected']).optional(),
});

const txCreateBody = z.object({
  type: z.enum(['purchase', 'sale', 'diplomacy', 'migration']),
  description: z.string().min(1).max(5000),
  amount_external: z.number().positive().finite().optional(),   // B24
  resource_type: z.string().max(128).optional(),
});

const assetBody = z.object({
  type: z.enum(['real_estate', 'business', 'finance']),
  value: z.number().positive().finite(),   // B24
  source_participant_id: uuidSchema.optional(),
});

const guarantorBody = z.object({
  participant_id: uuidSchema,
  diagnosis: z.record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 10_000, {
      message: 'diagnosis: JSON ≤ 10KB',   // B25
    }),
});

const witnessBody = z.object({ community_id: uuidSchema });

const defenseBody = z.object({
  type: z.enum(['external', 'internal', 'global']),
  commander_id: uuidSchema.nullable().optional(),
});

const dissolveBody = z.object({ reason: z.string().min(1).max(2000) });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });   // B23

export async function registerGatewayRoutes(app: FastifyInstance): Promise<void> {
  app.get('/gateway/council', { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V')] }, async (req, reply) => {
    const list = await getCouncil();
    reply.send({ data: list, audit_id: req.auditId });
  });

  app.post(
    '/gateway/council',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(memberBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const m = await addCouncilMember((req.body as { member_id: string }).member_id, auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  app.delete(
    '/gateway/council/:id',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'Dg'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const r = await rotateCouncilMember(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.get(
    '/gateway/transactions',
    { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V'), validateQuery(txListQuery)] },
    async (req, reply) => {
      const list = await listTransactions(req.query as z.infer<typeof txListQuery>);
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.post(
    '/gateway/transactions',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(txCreateBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof txCreateBody>;
      const tx = await createTransaction({
        type: b.type,
        description: b.description,
        ...(b.amount_external !== undefined ? { amountExternal: b.amount_external } : {}),
        ...(b.resource_type ? { resourceType: b.resource_type } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...tx, audit_id: req.auditId });
    },
  );

  app.post(
    '/gateway/transactions/:id/approve',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const tx = await approveTransaction(p.id, auth.participantId);
      reply.send({ ...tx, audit_id: req.auditId });
    },
  );

  app.post(
    '/gateway/transactions/:id/audit',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const tx = await auditTransaction(p.id, auth.participantId);
      reply.send({ ...tx, audit_id: req.auditId });
    },
  );

  app.get('/gateway/assets', { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V')] }, async (req, reply) => {
    const list = await listAssets();
    reply.send({ data: list, audit_id: req.auditId });
  });

  app.post(
    '/gateway/assets',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(assetBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof assetBody>;
      const a = await acceptAsset({
        type: b.type,
        value: b.value,
        ...(b.source_participant_id ? { sourceParticipantId: b.source_participant_id } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/gateway/assets/:id/convert',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await convertAsset(p.id, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.get('/gateway/guarantor', { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V')] }, async (req, reply) => {
    const g = await getGuarantor();
    reply.send({ data: g, audit_id: req.auditId });
  });

  app.post(
    '/gateway/guarantor',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(guarantorBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof guarantorBody>;
      const g = await appointGuarantor(b.participant_id, b.diagnosis, auth.participantId);
      reply.status(201).send({ ...g, audit_id: req.auditId });
    },
  );

  app.delete('/gateway/guarantor', { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'Dg')] }, async (req, reply) => {
    const auth = getAuthContext(req);
    const g = await expireGuarantor(auth.participantId);
    reply.send({ data: g, audit_id: req.auditId });
  });

  app.get('/gateway/witnesses', { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V')] }, async (req, reply) => {
    const list = await listWitnesses();
    reply.send({ data: list, audit_id: req.auditId });
  });

  app.post(
    '/gateway/witnesses',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(witnessBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof witnessBody>;
      const w = await establishWitness(b.community_id, auth.participantId);
      reply.status(201).send({ ...w, audit_id: req.auditId });
    },
  );

  app.post(
    '/gateway/defense',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'C'), validateBody(defenseBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof defenseBody>;
      const d = await activateDefense(b.type, b.commander_id ?? null, auth.participantId);
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  app.get('/gateway/self-sufficiency', { preHandler: [authMiddleware, gatewayGuard, requireRight('gateway', 'V')] }, async (req, reply) => {
    const r = await getSelfSufficiency();
    reply.send({ ...r, audit_id: req.auditId });
  });

  app.post(
    '/gateway/dissolve',
    { preHandler: [authMiddleware, gatewayGuard, writeLimit, requireRight('gateway', 'A'), validateBody(dissolveBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof dissolveBody>;
      const r = await dissolve(b.reason, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );
}