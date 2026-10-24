// A.1.90.01 — Health-check контроллер
// Liveness probe для K8s. Проверка живости процесса.
// Без аутентификации. Без авторизации.
//
// TECHDEBT:
//   - GET /health/ready НЕ проверяет S3 (заявлено в старой спеке,
//     L.0.01.07 s3 не импортируется).
//   - GET /health/startup всегда 200 — не проверяет завершение миграций.
//   - Timeout на Promise.all([dbHealth(), redisHealth()]) — нет в контроллере;
//     если Redis висит (не отвечает по TCP), /health/ready зависнет
//     до pool-таймаута (5s). K8s readiness probe с timeoutSeconds < 5
//     убьёт под.

import type { FastifyInstance } from 'fastify';

import { healthCheck as dbHealth } from '../../lib/db.js';
import { healthCheck as redisHealth } from '../../lib/redis.js';

import { version as API_VERSION } from './version.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // GET /health — минимальный ответ
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: API_VERSION,
  }));

  // GET /health/live — K8s liveness probe
  app.get('/health/live', async () => ({ status: 'ok' }));

  // GET /health/ready — K8s readiness probe (БД + Redis)
  app.get('/health/ready', async (_req, reply) => {
    const [db, redis] = await Promise.all([dbHealth(), redisHealth()]);
    const ok = db.primary && redis;
    reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'fail',
      checks: {
        db: db.primary ? 'ok' : 'fail',
        db_replica: db.replica ? 'ok' : 'fail',
        db_lag_ms: db.lagMs,
        redis: redis ? 'ok' : 'fail',
      },
    });
  });

  // GET /health/startup — K8s startup probe
  app.get('/health/startup', async () => ({ status: 'ok' }));
}