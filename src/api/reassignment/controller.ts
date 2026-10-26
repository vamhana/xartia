// A.1.04.21 — Сигналы перестановки L0–L3.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createReassignmentSignal,
  listReassignmentSignals,
  getReassignmentSignal,
  escalateReassignmentSignal,
  resolveReassignmentSignal,
  rejectReassignmentSignal,
} from '../../core/cells/reassignment.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  status: z.enum(['open', 'escalated', 'resolved', 'rejected']).optional(),
  level: z.coerce.number().int().min(0).max(3).optional(),
  cell_id: uuidSchema.optional(),
  direction_id: uuidSchema.optional(),
});

const createBody = z.object({
  level: z.number().int().min(0).max(3),
  reason: z.string().min(10).max(4000),
  cell_id: uuidSchema.optional(),
  task_id: uuidSchema.optional(),
  direction_id: uuidSchema.optional(),
});

const resolveBody = z.object({ resolution: z.string().min(5).max(4000) });
const rejectBody = z.object({ reason: z.string().min(5).max(4000) });

export async function registerReassignmentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/reassignment-signals',
    { preHandler: [authMiddleware, validateQuery(listQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const data = await listReassignmentSignals({
        ...(q.status ? { status: q.status } : {}),
        ...(q.level !== undefined ? { level: q.level } : {}),
        ...(q.cell_id ? { cellId: q.cell_id } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
      });
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.get(
    '/reassignment-signals/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({ ...(await getReassignmentSignal(p.id)), audit_id: req.auditId });
    },
  );

  app.post(
    '/reassignment-signals',
    { preHandler: [authMiddleware, validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const signal = await createReassignmentSignal({
        level: b.level,
        reason: b.reason,
        cellId: b.cell_id ?? null,
        taskId: b.task_id ?? null,
        directionId: b.direction_id ?? null,
      }, auth.participantId);
      reply.status(201).send({ ...signal, audit_id: req.auditId });
    },
  );

  app.post(
    '/reassignment-signals/:id/escalate',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({
        ...(await escalateReassignmentSignal(p.id, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/reassignment-signals/:id/resolve',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(resolveBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof resolveBody>;
      reply.send({
        ...(await resolveReassignmentSignal(p.id, b.resolution, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/reassignment-signals/:id/reject',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(rejectBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof rejectBody>;
      reply.send({
        ...(await rejectReassignmentSignal(p.id, b.reason, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );
}
