// A.1.03.01 — Контроллер Directions (итоговая версия, вариант C)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { list, getById, listRoles } from '../../core/directions/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateParams, validateQuery } from '../middleware/validation.js';


const rolesQuery = z.object({ direction_id: uuidSchema.optional() });

export async function registerDirectionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /directions — reference data (список направлений для дропдаунов).
  // Без requireRight: аналог /roles, /health, /version. Содержит только
  // (id, number, name, status) — не PII. Используется F.4.04.03, F.4.04.04.
  app.get(
    '/directions',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const directions = await list();
      reply.send({ data: directions, audit_id: request.auditId });
    },
  );

  // GET /directions/:id — карточка направления (детали ресурса).
  // requireRight('direction','V'): targetId из params.id → access_log при отказе.
  app.get<{ Params: { id: string } }>(
    '/directions/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('direction', 'V', undefined, (req) => (req.params as { id: string }).id),
        validateParams(uuidIdParams),
      ],
    },
    async (request, reply) => {
      const direction = await getById(request.params.id);
      reply.send({ ...direction, audit_id: request.auditId });
    },
  );

  // GET /roles — reference data (справочник ролей). Без requireRight.
  app.get<{ Querystring: z.infer<typeof rolesQuery> }>(
    '/roles',
    { preHandler: [authMiddleware, validateQuery(rolesQuery)] },
    async (req, reply) => {
      const roles = await listRoles(req.query.direction_id);
      reply.send({ data: roles, audit_id: req.auditId });
    },
  );
}