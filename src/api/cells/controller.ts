// A.1.04.01 — Контроллер Cells
// Дерево, карточка, состав, создание, добавление/удаление участников.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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