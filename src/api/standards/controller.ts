// A.1.16.01 — Контроллер Standards
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (19-й дубль).
//   - writeLimit(api.write) на 4 мутациях.
//   - createBody.norm: +finite() (было: Infinity проходил Zod).
//   - modifierBody.condition: +refine(JSON ≤ 10KB).
//   - /standards/calculate: UUID-валидация modifier_ids перенесена из Zod-transform
//     в handler (validateQuery не умеет transform); calcQuery упрощён.
//   - /standards/calculate переставлен ДО /:id (defensive, семантически ок).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - standard:C/A нет у COUNCIL_MEMBER (только FIRST_ARCHITECT wildcard) —
//     по I.1.5.9 Совет должен создавать. Roadmap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ValidationError } from '../../core/errors.js';
import {
  listStandards, getStandard, createStandardService,
  listModifiers, requestModifierService, approveModifierService, rejectModifierService,
  calculateEffectiveNorm, checkRevisionDue,
} from '../../core/standards/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({ category: z.string().optional() });

const createBody = z.object({
  category: z.string().min(1).max(64),
  norm: z.number().positive().finite(),   // ← T3
});

const modifierBody = z.object({
  name: z.string().min(1).max(128),
  condition: z.record(z.unknown())
    .refine((c) => JSON.stringify(c).length <= 10_000, {
      message: 'condition: JSON ≤ 10KB',   // ← B4
    }),
  coefficient: z.number().min(-1).max(10),
});

const rejectBody = z.object({ reason: z.string().min(1).max(1000) });

// calcQuery больше не делает transform — UUID-валидация modifier_ids
// выполняется в handler'е /standards/calculate (validateQuery не умеет transform).
const calcQuery = z.object({
  standard_id: uuidSchema,
  modifier_ids: z.string().optional(),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerStandardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/standards', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const items = await listStandards(q.category);
    reply.send({ data: items, audit_id: req.auditId });
  });

  app.get('/standards/revision-due', { preHandler: authMiddleware }, async (req, reply) => {
    const items = await checkRevisionDue();
    reply.send({ data: items, audit_id: req.auditId });
  });

  // /calculate — ДО /:id (defensive).
  app.get(
    '/standards/calculate',
    { preHandler: [authMiddleware, validateQuery(calcQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof calcQuery>;

      // UUID-валидация каждого id вручную (validateQuery не умеет transform).
      const ids: string[] = [];
      if (q.modifier_ids) {
        for (const raw of q.modifier_ids.split(',').map((s) => s.trim()).filter(Boolean)) {
          const parsed = uuidSchema.safeParse(raw);
          if (!parsed.success) {
            throw new ValidationError('modifier_ids: невалидный UUID', [
              { path: 'modifier_ids', message: raw },
            ]);
          }
          ids.push(parsed.data);
        }
      }

      const norm = await calculateEffectiveNorm(q.standard_id, ids);
      reply.send({ norm, audit_id: req.auditId });
    },
  );

  app.get(
    '/standards/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const s = await getStandard(p.id);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  app.post(
    '/standards',
    { preHandler: [authMiddleware, writeLimit, requireRight('standard', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const s = await createStandardService({ category: b.category, norm: b.norm }, auth.participantId);
      reply.status(201).send({ ...s, audit_id: req.auditId });
    },
  );

  // -------- Модификаторы --------

  app.get('/modifiers', { preHandler: authMiddleware }, async (req, reply) => {
    const items = await listModifiers();
    reply.send({ data: items, audit_id: req.auditId });
  });

  app.post(
    '/modifiers',
    { preHandler: [authMiddleware, writeLimit, requireRight('standard', 'C'), validateBody(modifierBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof modifierBody>;
      const m = await requestModifierService({
        name: b.name,
        condition: b.condition,
        coefficient: b.coefficient,
      }, auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  app.post(
    '/modifiers/:id/approve',
    { preHandler: [authMiddleware, writeLimit, requireRight('standard', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const m = await approveModifierService(p.id, auth.participantId);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );

  app.post(
    '/modifiers/:id/reject',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('standard', 'A'),
        validateParams(uuidIdParams),
        validateBody(rejectBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof rejectBody>;
      const m = await rejectModifierService(p.id, b.reason, auth.participantId);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );
}