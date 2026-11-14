// A.1.07.01 — Контроллер Tasks
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (7-й дубль).
//   - status enum inline → taskStatusSchema из L.0.01.03.
//   - rateLimit(api.write) на 6 мутациях.
//   - createBody.description: +max(5000).
//   - required_competencies: +max(50).
//
// D.2.01.67 (v0.0.03):
//   - createBody: parent_task_id, kind, expected_result, deadline,
//     planned_start_at, estimated_minutes.
//   - POST /tasks пробрасывает новые поля в createTaskService.
//   - Новые маршруты зависимостей: GET/POST/DELETE /tasks/:id/dependencies.
//
// C.1.10.01 (v0.0.04):
//   - assignBody: override { reason, risk?, accompanying?, training? }.
//   - POST /tasks/:id/assign пробрасывает override в assignTaskService;
//     сервис проверяет Matching (partial требует override, no_match — запрет).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - GET /tasks, /tasks/:id — без access control (любой авторизованный
//     читает любую задачу). Нужна per-direction модель прав (scope).
//   - assignTask — checkCompetencies при отсутствии TaskProfile (legacy-путь).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { Role } from '../../core/roles.js';
import { createSignalService } from '../../core/signals/service.js';
import {
  listDependencies, getBlockingDependencies,
  addDependency, removeDependency,
} from '../../core/tasks/dependencies.js';
import {
  hasRecentOverdueSignal,
  listUnsubmittedTasks,
} from '../../core/tasks/overdue.js';
import {
  listTasks, getById, listMyTasks, createTaskService,
  assignTaskService, takeTaskService, submitTaskService,
  acceptTaskService, returnTaskService, reopenTaskService,
} from '../../core/tasks/service.js';
import { logger } from '../../lib/logger.js';
import { send as sendNotification } from '../../lib/notifications.js';
import { uuidIdParams, uuidSchema, prioritySchema, taskStatusSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { listParticipantsWithRole } from '../../security/rbac.js';
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
  parent_task_id: uuidSchema.optional(),
  kind: z.enum(['package', 'deliverable']).optional(),
  expected_result: z.string().min(1).max(5000).optional(),
  deadline: z.string().datetime().nullable().optional(),
  planned_start_at: z.string().datetime().nullable().optional(),
  estimated_minutes: z.number().int().positive().optional(),
  required_competencies: z.array(z.string().min(1).max(128)).max(50).optional(),   // ← T5
  location: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

const assignBody = z.object({
  participant_id: uuidSchema,
  override: z.object({
    reason: z.string().min(10).max(2000),
    risk: z.enum(['low', 'medium', 'high']).optional(),
    accompanying: z.string().max(2000).optional(),
    training: z.string().max(2000).optional(),
  }).optional(),
});
const reopenBody = z.object({ reason: z.string().min(3).max(1000) });
const acceptBody = z.object({
  comment: z.string().max(5000).optional(),
  criteria: z.array(z.object({
    id: z.string().min(1),
    passed: z.boolean(),
    comment: z.string().max(2000).optional(),
  })).optional(),
});
const returnBody = z.object({ reason: z.string().min(1).max(500) });

// -------- Зависимости задач (C.0.07.03) --------
const dependencyParams = uuidIdParams.extend({ dep_id: uuidSchema });

const addDependencyBody = z.object({
  depends_on_task_id: uuidSchema,
  dependency_type: z.enum(['blocks']).optional(),
});

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

  // GET /tasks/overdue — задачи, не сданные в ОТК (срок истёк, отчёта нет).
  // Объявлен выше /tasks/:id, чтобы статический сегмент не приняли за UUID.
  app.get(
    '/tasks/overdue',
    { preHandler: [authMiddleware, validateQuery(z.object({ direction_id: uuidSchema.optional() }))] },
    async (req, reply) => {
      const q = req.query as { direction_id?: string };
      const data = await listUnsubmittedTasks(q.direction_id as never);
      reply.send({ data, meta: { total: data.length }, audit_id: req.auditId });
    },
  );

  // POST /tasks/overdue/scan — балансировка поднимает сигналы направлениям.
  app.post(
    '/tasks/overdue/scan',
    { preHandler: [authMiddleware, writeLimit, requireRight('signal', 'C')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const tasks = await listUnsubmittedTasks();
      const byDirection = new Map<string, typeof tasks>();
      for (const t of tasks) {
        const list = byDirection.get(t.directionId) ?? [];
        list.push(t);
        byDirection.set(t.directionId, list);
      }

      let created = 0;
      let skipped = 0;
      for (const [directionId, list] of byDirection) {
        const recent = await hasRecentOverdueSignal(directionId as never);
        if (recent) {skipped += 1; continue;}

        const worst = list[0]!;
        try {
          await createSignalService({
            type: 'problem',
            description: `[просрочка:${directionId}] Не сданы в ОТК: ${list.length} задач(и). `
              + `Самая старая: ${worst.externalId} — просрочена на ${worst.daysLate} дн.`,
            justification:
              'Балансировка: задачи идут по сроку, но не переданы на проверку. '
              + 'ОТК нечего проверять, пока отчёт не сдан — просьба разобрать участок.',
            priority: list.length > 3 ? 'high' : 'standard',
            directions: [directionId as never],
            leadDirectionId: directionId as never,
          }, auth.participantId);
          created += 1;
        } catch (e) {
          logger.warn({ err: e, directionId }, 'overdue signal failed');
        }
      }

      // Балансировка получает уведомление — она держит индикатор.
      try {
        const balancers = await listParticipantsWithRole(Role.BALANCER);
        for (const recipientId of balancers) {
          await sendNotification({
            recipientId,
            type: 'tasks.overdue',
            priority: 'standard',
            title: 'Задачи не сданы в ОТК',
            body: `Просрочено и не передано на проверку: ${tasks.length}. Новых сигналов: ${created}.`,
            data: { link: '/balance' },
          });
        }
      } catch (e) {
        logger.warn({ err: e }, 'overdue notification failed');
      }

      reply.send({
        data: { tasks: tasks.length, directions: byDirection.size, created, skipped },
        audit_id: req.auditId,
      });
    },
  );

  // -------- Зависимости задач (C.0.07.03) --------
  // Регистрируются до /tasks/:id, чтобы не пересечься с параметрическим маршрутом.

  app.get(
    '/tasks/:id/dependencies',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const [deps, blocking] = await Promise.all([
        listDependencies(p.id as never),
        getBlockingDependencies(p.id as never),
      ]);
      reply.send({
        data: deps,
        blockedByDependencies: blocking.length > 0,
        blocking,
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/tasks/:id/dependencies',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('task', 'C'),
        validateParams(uuidIdParams), validateBody(addDependencyBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof addDependencyBody>;
      const dep = await addDependency({
        taskId: p.id as never,
        dependsOnTaskId: b.depends_on_task_id as never,
        ...(b.dependency_type ? { dependencyType: b.dependency_type } : {}),
        requesterId: auth.participantId,
      });
      reply.status(201).send({ ...dep, audit_id: req.auditId });
    },
  );

  app.delete(
    '/tasks/:id/dependencies/:dep_id',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('task', 'C'),
        validateParams(dependencyParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof dependencyParams>;
      await removeDependency({
        taskId: p.id as never,
        dependencyId: p.dep_id as never,
        requesterId: auth.participantId,
      });
      reply.status(204).send();
    },
  );

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
        ...(b.parent_task_id ? { parentTaskId: b.parent_task_id } : {}),
        ...(b.kind ? { kind: b.kind } : {}),
        ...(b.expected_result !== undefined ? { expectedResult: b.expected_result } : {}),
        ...(b.deadline !== undefined ? { deadline: b.deadline } : {}),
        ...(b.planned_start_at !== undefined ? { plannedStartAt: b.planned_start_at } : {}),
        ...(b.estimated_minutes !== undefined ? { estimatedMinutes: b.estimated_minutes } : {}),
        ...(b.required_competencies ? { requiredCompetencies: b.required_competencies } : {}),
        ...(b.location ? { location: b.location } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...task, audit_id: req.auditId });
    },
  );

  // POST /tasks/:id/assign (право: task:C)
  // Matching проверяется в сервисе (C.1.10.01): partial требует override
  // (reason + опционально risk/accompanying/training), no_match — запрет.
  app.post(
    '/tasks/:id/assign',
    { preHandler: [authMiddleware, writeLimit, requireRight('task', 'C'), validateParams(uuidIdParams), validateBody(assignBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof assignBody>;
      const task = await assignTaskService(
        p.id, b.participant_id, auth.participantId,
        b.override ? { override: b.override } : {},
      );
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
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('otc', 'C'),
        validateParams(uuidIdParams),
        validateBody(acceptBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof acceptBody>;
      const task = await acceptTaskService(p.id, auth.participantId, {
        comment: b.comment ?? null,
        ...(b.criteria ? { criteria: b.criteria } : {}),
      });
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

  // POST /tasks/:id/reopen — пересмотр принятой задачи (P1).
  app.post(
    '/tasks/:id/reopen',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('otc', 'C'),
        validateParams(uuidIdParams),
        validateBody(reopenBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof reopenBody>;
      const task = await reopenTaskService(p.id, b.reason, auth.participantId);
      reply.send({ ...task, audit_id: req.auditId });
    },
  );
}