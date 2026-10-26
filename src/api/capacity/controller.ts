// A.1.28.05 — Ёмкость и компетенции.
//
// GET  /capacity?direction_id&plan_id — спрос/наличие/дефицит.
// GET  /participants/:id/competencies — список компетенций.
// PUT  /participants/:id/competencies — задать уровень (себе или Архитектор).
// DELETE /participants/:id/competencies/:competency — убрать.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getCapacity } from '../../core/capacity/service.js';
import {
  listCompetencies,
  setCompetency,
  removeCompetency,
} from '../../core/capacity/competencies.js';
import { ForbiddenError, ConflictError } from '../../core/errors.js';
import { Role } from '../../core/roles.js';
import { hasRole } from '../../security/rbac.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const capacityQuery = z.object({
  direction_id: uuidSchema.optional(),
  plan_id: uuidSchema.optional(),
});

const competencyBody = z.object({
  competency: z.string().min(1).max(64),
  level: z.number().int().min(1).max(5),
  verified: z.boolean().optional(),
});

async function assertSelfOrArchitect(requesterId: string, targetId: string): Promise<void> {
  if (requesterId === targetId) {return;}
  if (await hasRole(requesterId as never, Role.FIRST_ARCHITECT)) {return;}
  throw new ForbiddenError('Можно менять только свои компетенции');
}

export async function registerCapacityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/capacity',
    { preHandler: [authMiddleware, validateQuery(capacityQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof capacityQuery>;
      const report = await getCapacity({
        directionId: q.direction_id ?? null,
        planId: q.plan_id ?? null,
      });
      reply.send({ ...report, audit_id: req.auditId });
    },
  );

  app.get(
    '/participants/:id/competencies',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const list = await listCompetencies(p.id);
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.put(
    '/participants/:id/competencies',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(competencyBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      await assertSelfOrArchitect(auth.participantId, p.id);
      const b = req.body as z.infer<typeof competencyBody>;
      const item = await setCompetency(p.id, b, auth.participantId);
      reply.send({ ...item, audit_id: req.auditId });
    },
  );

  app.delete(
    '/participants/:id/competencies/:competency',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      await assertSelfOrArchitect(auth.participantId, p.id);
      const competency = (req.params as { competency?: string }).competency;
      if (!competency) {throw new ConflictError('Компетенция не указана');}
      await removeCompetency(p.id, competency, auth.participantId);
      reply.status(204).send();
    },
  );
}
