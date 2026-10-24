// A.1.07.01 — Контроллер Tasks
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (7-й дубль).
//   - status enum inline → taskStatusSchema из L.0.01.03.
//   - rateLimit(api.write) на 6 мутациях.
//   - createBody.description: +max(5000).
//   - required_competencies: +max(50).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - GET /tasks, /tasks/:id — без access control (любой авторизованный
//     читает любую задачу). Нужна per-direction модель прав (scope).
//   - assignTask — checkCompetencies не реализован (нет participant.competencies).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listTasks, getById, listMyTasks, createTaskService,
  assignTaskService, takeTaskService, submitTaskService,
  acceptTaskService, returnTaskService,
} from '../../core/tasks/service.js';
import { uuidIdParams, uuidSchema, prioritySchema, taskStatusSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  direction_id: uuidSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  assigned_to: uuidSchema.optional(),
  plan_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  direction_id: uuidSchema,
  description: z.string().min(1).max(5000),   // ← T4
  priority: prioritySchema,
  plan_id: uuidSchema.optional(),
  required_competencies: z.array(z.string().min(1).max(128)).max(50).optional(),   // ← T5
  location: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

const assignBody = z.object({ participant_id: uuidSchema });
const returnBody = z.object({ reason: z.string().min(1).max(500) });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerTasksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tasks', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const result = await listTasks({
      ...(q.direction_id ? { directionId: q.direction_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.assigned_to ? { assignedTo: q.assigned_to } : {}),
      ...(q.plan_id ? { planId: q.plan_id } : {}),
      page: q.page, perPage: q.per_page,
    });
    reply.send({
      data: result.data,
      meta: { page: q.page, per_page: q.per_page, total: result.total },
      audit_id: req.auditId,
    });
  });

  app.get('/tasks/my', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const tasks = await listMyTasks(auth.participantId);
    reply.send({ data: tasks, audit_id: req.auditId });
  });

  app.get('/tasks/:id', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const task = await getById(p.id);
    reply.send({ ...task, audit_id: req.auditId });
  });

  // POST /tasks (право: task:C)
  app.post(
    '/tasks',
    { preHandler: [authMiddleware, writeLimit, requireRight('task', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const task = await createTaskService({
        directionId: b.direction_id,
        description: b.description,
        priority: b.priority,
        ...(b.plan_id ? { planId: b.plan_id } : {}),
        ...(b.required_competencies ? { requiredCompetencies: b.required_competencies } : {}),
        ...(b.location ? { location: b.location } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/assign (право: task:C)
  app.post(
    '/tasks/:id/assign',
    { preHandler: [authMiddleware, writeLimit, requireRight('task', 'C'), validateParams(uuidIdParams), validateBody(assignBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof assignBody>;
      const task = await assignTaskService(p.id, b.participant_id, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/take — self-service (проверка assignedTo в сервисе)
  app.post(
    '/tasks/:id/take',
    { preHandler: [authMiddleware, writeLimit, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const task = await takeTaskService(p.id, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/submit — self-service (проверка assignedTo в сервисе — B1-fix)
  app.post(
    '/tasks/:id/submit',
    { preHandler: [authMiddleware, writeLimit, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const task = await submitTaskService(p.id, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/accept (право: otc:C; I.2.12 проверяется в сервисе — B2-fix)
  app.post(
    '/tasks/:id/accept',
    { preHandler: [authMiddleware, writeLimit, requireRight('otc', 'C'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const task = await acceptTaskService(p.id, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/return (право: otc:C; I.2.12 в сервисе — B3-fix)
  app.post(
    '/tasks/:id/return',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('otc', 'C'),
        validateParams(uuidIdParams),
        validateBody(returnBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof returnBody>;
      const task = await returnTaskService(p.id, b.reason, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );
}