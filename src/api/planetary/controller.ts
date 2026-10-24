// A.1.27.01 — Контроллер Planetary

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listCommunities, getCommunity, createCommunityService,
  getCouncil, addCouncilMember,
  listBridges, createBridgeService,
  getPlan, createPlanService,
  createReferendumService,
  getPulse, getReserve,
  freezeExpansion, unfreezeExpansion,
  getCoordinationLevelService, checkExpansionConditions,
} from '../../core/planetary/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const idParams = z.object({ id: uuidSchema });

const listQuery = z.object({
  status: z.enum(['incubation', 'active', 'node', 'center']).optional(),
});

const createBody = z.object({
  code: z.string().regex(/^[А-Я]{2}$/, 'Код: 2 кириллические буквы'),
  name: z.string().min(1).max(255),
  mother_community_id: uuidSchema.optional(),
});

const councilBody = z.object({
  member_id: uuidSchema,
  community_id: uuidSchema,
  type: z.enum(['delegate', 'expert', 'guardian']),
});

const bridgeBody = z.object({
  community_a: uuidSchema,
  community_b: uuidSchema,
  coefficient: z.number().positive(),
});

const planBody = z.object({
  period: z.string().min(1).max(32),
  plan: z.record(z.unknown()),
});

const referendumBody = z.object({
  type: z.enum(['convergence', 'gateway_dissolve', 'core']),
  threshold: z.number().min(0).max(100),
});

const pulseQuery = z.object({
  community_id: uuidSchema.optional(),
});

const freezeBody = z.object({
  reason: z.string().min(1).max(2000),
});

export async function registerPlanetaryRoutes(app: FastifyInstance): Promise<void> {
  // -------- Communities --------
  app.get(
    '/planetary/communities',
    { preHandler: [authMiddleware, validateQuery(listQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const items = await listCommunities({ ...(q.status ? { status: q.status } : {}) });
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/planetary/communities/:id',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const c = await getCommunity(p.id);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/communities',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(createBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const c = await createCommunityService({
        code: b.code, name: b.name,
        ...(b.mother_community_id ? { motherCommunityId: b.mother_community_id } : {}),
        by: auth.participantId,
      });
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  // -------- Council --------
  app.get(
    '/planetary/council',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const items = await getCouncil();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/council',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(councilBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof councilBody>;
      const m = await addCouncilMember({
        memberId: b.member_id,
        communityId: b.community_id,
        type: b.type,
        by: auth.participantId,
      });
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  // -------- Bridges --------
  app.get(
    '/planetary/bridges',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const items = await listBridges();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/bridges',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(bridgeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof bridgeBody>;
      const bridge = await createBridgeService({
        communityA: b.community_a,
        communityB: b.community_b,
        coefficient: b.coefficient,
        by: auth.participantId,
      });
      reply.status(201).send({ ...bridge, audit_id: req.auditId });
    },
  );

  // -------- Plan --------
  app.get(
    '/planetary/plan',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const p = await getPlan();
      reply.send({ data: p, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/plan',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(planBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof planBody>;
      const p = await createPlanService({
        period: b.period, plan: b.plan, by: auth.participantId,
      });
      reply.status(201).send({ ...p, audit_id: req.auditId });
    },
  );

  // -------- Referendum --------
  app.post(
    '/planetary/referendum',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(referendumBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof referendumBody>;
      const r = await createReferendumService({
        type: b.type, threshold: b.threshold, by: auth.participantId,
      });
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // -------- Pulse --------
  app.get(
    '/planetary/pulse',
    { preHandler: [authMiddleware, validateQuery(pulseQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof pulseQuery>;
      const items = await getPulse(q.community_id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // -------- Reserve --------
  app.get(
    '/planetary/reserve',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const r = await getReserve();
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // -------- Expansion --------
  app.get(
    '/planetary/expansion/conditions',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const cond = await checkExpansionConditions();
      const level = await getCoordinationLevelService();
      reply.send({ ...cond, coordinationLevel: level, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/expansion/freeze',
    {
      preHandler: [
        authMiddleware,
        requireRight('planetary', 'C'),
        validateBody(freezeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof freezeBody>;
      const r = await freezeExpansion(b.reason, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.post(
    '/planetary/expansion/unfreeze',
    {
      preHandler: [authMiddleware, requireRight('planetary', 'C')],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const r = await unfreezeExpansion(auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );
}