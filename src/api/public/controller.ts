// A.1.38.01 — Публичный контроллер витрины.
//
// Без authMiddleware и без requireRight: это первая страница для человека
// с улицы. Никаких персональных данных — только агрегаты (см. C.0.43.01).

import type { FastifyInstance } from 'fastify';

import { getPublicOverview } from '../../core/public/service.js';

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/public/overview', async (_req, reply) => {
    const overview = await getPublicOverview();
    reply.send(overview);
  });
}
