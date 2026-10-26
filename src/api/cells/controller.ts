// A.1.04.01 — Контроллер Cells
// Дерево, карточка, состав, создание, добавление/удаление участников.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  distributeCellDailyPlan,
  getDelegationTree,
} from '../../core/cells/delegation.js';
import {
  assignCellDailyTask,
  getCellDailyPlan,
  listCellPlanCandidates,
  upsertCellDailyPlan,
} from '../../core/cells/daily.js';
import {
  listCells,
  getById,
  getMembers,
  getChildren,
  buildTree,
  createCellService,
  addMemberService,
  removeMemberService,
} from '../../core/cells/service.js';
import { getCellReadiness } from '../../core/cells/readiness.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

// -------- Схемы --------
const memberParams = uuidIdParams.extend({ participant_id: uuidSchema });

const listQuery = z.object({
  direction_id: uuidSchema.optional(),
  level: z.coerce.number().int().min(0).max(11).optional(),
  parent_cell_id: uuidSchema.optional(),
  roots_only: z.coerce.boolean().optional(),
});

const createBody = z.object({
  level: z.number().int().min(0).max(11),
  number: z.string().min(1).max(16),
  profile: z.string().min(1).max(64).optional(),
  parent_cell_id: uuidSchema.optional(),
  direction_id: uuidSchema,
});

const addMemberBody = z.object({
  participant_id: uuidSchema,
  role_in_cell: z
    .enum(['member', 'coordinator', 'otc', 'keeper', 'liaison', 'verifier', 'balancer', 'psy'])
    .optional(),
});

// -------- Регистрация --------

export async function registerCellsRoutes(app: FastifyInstance): Promise<void> {
  // GET /cells — список с фильтрами
  app.get(
    '/cells',
    { preHandler: [authMiddleware, validateQuery(listQuery)] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof listQuery>;
      const cells = await listCells({
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
        ...(q.level !== undefined ? { level: q.level } : {}),
        ...(q.parent_cell_id ? { parentCellId: q.parent_cell_id } : {}),
        ...(q.roots_only !== undefined ? { rootsOnly: q.roots_only } : {}),
      });
      reply.send({ data: cells, audit_id: request.auditId });
    },
  );

  // GET /cells/:id
  app.get(
    '/cells/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const params = request.params as z.infer<typeof uuidIdParams>;
      const cell = await getById(params.id);
      reply.send({ ...cell, audit_id: request.auditId });
    },
  );

  // GET /cells/:id/readiness — чек-лист готовности ячейки.
  app.get(
    '/cells/:id/readiness',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const params = request.params as z.infer<typeof uuidIdParams>;
      const readiness = await getCellReadiness(params.id);
      reply.send({ ...readiness, audit_id: request.auditId });
    },
  );

  // GET /cells/:id/members
  app.get(
    '/cells/:id/members',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const params = request.params as z.infer<typeof uuidIdParams>;
      const members = await getMembers(params.id);
      reply.send({ data: members, audit_id: request.auditId });
    },
  );

  // GET /cells/:id/children
  app.get(
    '/cells/:id/children',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const params = request.params as z.infer<typeof uuidIdParams>;
      const children = await getChildren(params.id);
      reply.send({ data: children, audit_id: request.auditId });
    },
  );

  // GET /cells/tree/:id — полное дерево от корня
  app.get(
    '/cells/tree/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const params = request.params as z.infer<typeof uuidIdParams>;
      const tree = await buildTree(params.id);
      reply.send({ data: tree, audit_id: request.auditId });
    },
  );

  // POST /cells — создание (право: cell:C — Совет направления, Архитектор)
  app.post(
    '/cells',
    { preHandler: [authMiddleware, requireRight('cell', 'C'), validateBody(createBody)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof createBody>;
      const cell = await createCellService(
        {
          level: body.level,
          number: body.number,
          ...(body.profile ? { profile: body.profile } : {}),
          ...(body.parent_cell_id ? { parentCellId: body.parent_cell_id } : {}),
          directionId: body.direction_id,
        },
        auth.participantId,
      );
      reply.status(201).send({ ...cell, audit_id: request.auditId });
    },
  );

  // POST /cells/:id/members — добавление (право: cell:C)
  app.post(
    '/cells/:id/members',
    { preHandler: [authMiddleware, requireRight('cell', 'C'), validateParams(uuidIdParams), validateBody(addMemberBody)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const params = request.params as z.infer<typeof uuidIdParams>;
      const body = request.body as z.infer<typeof addMemberBody>;
      const member = await addMemberService(
        params.id,
        {
          participantId: body.participant_id,
          ...(body.role_in_cell ? { roleInCell: body.role_in_cell } : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...member, audit_id: request.auditId });
    },
  );

  // DELETE /cells/:id/members/:participant_id — удаление (право: cell:D)
  // -------- Наряд ячейки (C.0.41.03) --------
  // Наряд приходит на ячейку, координатор распределяет по людям.

  const cellPlanQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

  app.get(
    '/cells/:id/daily-plan',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateQuery(cellPlanQuery)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = req.query as z.infer<typeof cellPlanQuery>;
      const day = await getCellDailyPlan(p.id, q.date);
      reply.send({ ...day, audit_id: req.auditId });
    },
  );

  app.get(
    '/cells/:id/daily-plan/candidates',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const data = await listCellPlanCandidates(p.id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/cells/:id/daily-plan',
    {
      preHandler: [
        authMiddleware,
        requireRight('plan', 'C'),
        validateParams(uuidIdParams),
        validateBody(z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          task_ids: z.array(uuidSchema).min(1).max(50),
        })),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as { date: string; task_ids: string[] };
      const day = await upsertCellDailyPlan({
        cellId: p.id,
        date: b.date,
        taskIds: b.task_ids as never[],
        approvedById: auth.participantId,
      });
      reply.status(201).send({ ...day, audit_id: req.auditId });
    },
  );

  app.post(
    '/cells/:id/daily-plan/:task_id/assign',
    {
      preHandler: [
        authMiddleware,
        requireRight('plan', 'C'),
        validateParams(uuidIdParams.extend({ task_id: uuidSchema })),
        validateBody(z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          participant_id: uuidSchema,
        })),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as { id: string; task_id: string };
      const b = req.body as { date: string; participant_id: string };
      const day = await assignCellDailyTask({
        cellId: p.id,
        date: b.date,
        taskId: p.task_id as never,
        participantId: b.participant_id as never,
        requesterId: auth.participantId,
      });
      reply.send({ ...day, audit_id: req.auditId });
    },
  );

  // -------- Передача наряда дочерним ячейкам (C.0.41.04) --------

  app.get(
    '/cells/:id/daily-plan/tree',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateQuery(cellPlanQuery)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = req.query as z.infer<typeof cellPlanQuery>;
      const tree = await getDelegationTree(p.id, q.date);
      reply.send({ ...tree, audit_id: req.auditId });
    },
  );

  app.post(
    '/cells/:id/daily-plan/distribute',
    {
      preHandler: [
        authMiddleware,
        requireRight('plan', 'C'),
        validateParams(uuidIdParams),
        validateBody(z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          assignments: z.array(z.object({
            child_cell_id: uuidSchema,
            task_ids: z.array(uuidSchema).max(50),
          })).min(1).max(50),
        })),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as {
        date: string;
        assignments: Array<{ child_cell_id: string; task_ids: string[] }>;
      };
      const result = await distributeCellDailyPlan({
        cellId: p.id as never,
        date: b.date,
        assignments: b.assignments.map((a) => ({
          childCellId: a.child_cell_id as never,
          taskIds: a.task_ids as never[],
        })),
        requesterId: auth.participantId,
      });
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );

  app.delete(
    '/cells/:id/members/:participant_id',
    { preHandler: [authMiddleware, requireRight('cell', 'D'), validateParams(memberParams)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const params = request.params as z.infer<typeof memberParams>;
      await removeMemberService(params.id, params.participant_id, auth.participantId);
      reply.status(204).send();
    },
  );
}