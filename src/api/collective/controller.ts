// A.1.40.01 — Контроллер «Коллектив».
//
// Один запрос на экран: кто есть, направления, роли, лента событий.
// Права: participant:V — то же, что у списка участников (все активные роли).
// Персональные данные не отдаются: только ID, имя, статус, направление, роли.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getOverview } from '../../core/collective/service.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateQuery } from '../middleware/validation.js';

const overviewQuery = z.object({
  activity_limit: z.coerce.number().int().min(1).max(60).default(40),
});

export async function registerCollectiveRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/collective',
    { preHandler: [authMiddleware, requireRight('participant', 'V'), validateQuery(overviewQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof overviewQuery>;
      const overview = await getOverview(q.activity_limit);
      reply.send({ ...overview, audit_id: req.auditId });
    },
  );
}
