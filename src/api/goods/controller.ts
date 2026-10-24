// A.1.15.01 — Контроллер Goods
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (18-й дубль).
//   - goodStatusSchema/goodTypeSchema/projectResourceSignRoleSchema из L.0.01.03.
//   - writeLimit(api.write) на 7 мутациях.
//   - description: +min(1) если задан.
//   - prBody.resource: +refine(JSON ≤ 100KB).
//   - signProjectResourceService: signerId больше НЕ из body — auth.participantId.
//     signBody.signer_id удалён (breaking change, spec v0.0.02).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listGoods, getById, createGoodService, addComponentService,
  testGoodService, approveGoodService, liquidateGoodService,
  getHistory, createProjectResourceService, signProjectResourceService,
} from '../../core/goods/service.js';
import {
  uuidIdParams,
  uuidSchema,
  goodStatusSchema,
  goodTypeSchema,
  projectResourceSignRoleSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  status: goodStatusSchema.optional(),
  type: goodTypeSchema.optional(),
  producer_direction_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  name: z.string().min(1).max(255),
  type: goodTypeSchema,
  producer_direction_id: uuidSchema,
  description: z.string().min(1).max(5000).optional(),   // ← B7
});

const componentBody = z.object({
  part: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
});

const liquidateBody = z.object({
  reason: z.string().min(1).max(1000),
  verifier_id: uuidSchema,
});

const prBody = z.object({
  plan_id: uuidSchema,
  resource: z.record(z.unknown())
    .refine((r) => JSON.stringify(r).length <= 100_000, {
      message: 'resource: JSON ≤ 100KB',   // ← T4
    }),
});

// B1: signer_id убран из body — signer = auth.participantId.
const signBody = z.object({
  role: projectResourceSignRoleSchema,
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerGoodsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/goods', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const result = await listGoods({
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.producer_direction_id ? { producerDirectionId: q.producer_direction_id } : {}),
      page: q.page, perPage: q.per_page,
    });
    reply.send({
      data: result.data,
      meta: { page: q.page, per_page: q.per_page, total: result.total },
      audit_id: req.auditId,
    });
  });

  app.get('/goods/:id', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const g = await getById(p.id);
    reply.send({ ...g, audit_id: req.auditId });
  });

  app.post(
    '/goods',
    { preHandler: [authMiddleware, writeLimit, requireRight('good', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const g = await createGoodService({
        name: b.name,
        type: b.type,
        producerDirectionId: b.producer_direction_id,
        ...(b.description ? { description: b.description } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...g, audit_id: req.auditId });
    },
  );

  app.post(
    '/goods/:id/component',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('good', 'E'),
        validateParams(uuidIdParams),
        validateBody(componentBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof componentBody>;
      const g = await addComponentService(p.id, {
        authorId: auth.participantId,
        part: b.part,
        description: b.description,
      }, auth.participantId);
      reply.send({ ...g, audit_id: req.auditId });
    },
  );

  app.post(
    '/goods/:id/test',
    { preHandler: [authMiddleware, writeLimit, requireRight('good', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const g = await testGoodService(p.id, auth.participantId);
      reply.send({ ...g, audit_id: req.auditId });
    },
  );

  app.post(
    '/goods/:id/approve',
    { preHandler: [authMiddleware, writeLimit, requireRight('good', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const g = await approveGoodService(p.id, auth.participantId);
      reply.send({ ...g, audit_id: req.auditId });
    },
  );

  app.post(
    '/goods/:id/liquidate',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('good', 'D'),
        validateParams(uuidIdParams),
        validateBody(liquidateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof liquidateBody>;
      const g = await liquidateGoodService(p.id, b.reason, b.verifier_id, auth.participantId);
      reply.send({ ...g, audit_id: req.auditId });
    },
  );

  app.get('/goods/:id/history', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const history = await getHistory(p.id);
    reply.send({ data: history, audit_id: req.auditId });
  });

  app.post(
    '/project-resources',
    { preHandler: [authMiddleware, writeLimit, requireRight('good', 'C'), validateBody(prBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof prBody>;
      const pr = await createProjectResourceService(b.plan_id, b.resource, auth.participantId);
      reply.status(201).send({ ...pr, audit_id: req.auditId });
    },
  );

  // B1-fix: signerId = auth.participantId (не из body).
  app.post(
    '/project-resources/:id/sign',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('good', 'S'),
        validateParams(uuidIdParams),
        validateBody(signBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof signBody>;
      const pr = await signProjectResourceService(p.id, b.role, auth.participantId);
      reply.send({ ...pr, audit_id: req.auditId });
    },
  );
}