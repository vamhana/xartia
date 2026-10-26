// A.1.00.01 server.ts — точка входа API (glue-файл, не часть домена)
// Плагины, регистрация роутов, listen, graceful shutdown.
//
// Техдолг закрыт (v.0.0.10 → v.0.0.11):
//   - PORT парсится внутри main() (раньше — top-level, throw не ловился).
//   - parsePort бросает AppError, а не Error.
//   - trustProxy настраивается через TRUST_PROXY (default: 1 hop).
//   - /metrics* защищён опциональным METRICS_TOKEN.
//   - Доменные роуты упорядочены по ID; panels — первым, admin — последним.
//   - Импорты упорядочены как регистрация.
//   - Убран комментарий «было preSerialization».
//   - BODY_LIMIT_BYTES + ROUTE_BODY_LIMITS экспортированы.

import 'dotenv/config';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';

import { AppError } from './core/errors.js';

// ─── Роутеры: импорты в том же порядке, что и регистрация ───────────────

// 1. Panels — первыми (bootstrap фронта).
import { registerPanelsRoutes } from './api/panels/controller.js';

// 2. Системные — доступны даже при отказе домена.
import { registerHealthRoutes } from './api/system/health.js';
import { registerVersionRoutes } from './api/system/version.js';
import { registerMetricsRoutes } from './api/system/metrics.js';

// 3. Домен — по возрастанию ID.
import { registerAuthRoutes } from './api/auth/controller.js';
import { registerParticipantsRoutes } from './api/participants/controller.js';
import { registerDirectionsRoutes } from './api/directions/controller.js';
import { registerCapacityRoutes } from './api/capacity/controller.js';
import { registerProposalRoutes } from './api/proposals/controller.js';
import { registerQuestionRoutes } from './api/questions/controller.js';
import { registerReassignmentRoutes } from './api/reassignment/controller.js';
import { registerCellsRoutes } from './api/cells/controller.js';
import { registerMandatesRoutes } from './api/mandates/controller.js';
import { registerPlansRoutes } from './api/plans/controller.js';
import { registerTasksRoutes } from './api/tasks/controller.js';
import { registerReportsRoutes } from './api/reports/controller.js';
import { registerOtcRoutes } from './api/otc/controller.js';
import { registerSignalsRoutes } from './api/signals/controller.js';
import { registerConnectionsRoutes } from './api/connections/controller.js';
import { registerArbitrationsRoutes } from './api/arbitrations/controller.js';
import { registerUniversalRunsRoutes } from './api/universal-runs/controller.js';
import { registerFlowsRoutes } from './api/flows/controller.js';
import { registerGoodsRoutes } from './api/goods/controller.js';
import { registerStandardsRoutes } from './api/standards/controller.js';
import { registerRegimesRoutes } from './api/regimes/controller.js';
import { registerBalanceRoutes } from './api/balance/controller.js';
import { registerVerificationRoutes } from './api/verification/controller.js';
import { registerArchiveRoutes } from './api/archive/controller.js';
import { registerJusticeRoutes } from './api/justice/controller.js';
import { registerJuryRoutes } from './api/jury/controller.js';
import { registerPsyRoutes } from './api/psy/controller.js';
import { registerGatewayRoutes } from './api/gateway/controller.js';
import { registerQuantaRoutes } from './api/quanta/controller.js';
import { registerConstructorRoutes } from './api/constructor/controller.js';
import { registerPlanetaryRoutes } from './api/planetary/controller.js';
import { registerConvergenceRoutes } from './api/convergence/controller.js';
import { registerSemanticRoutes } from './api/semantic/controller.js';
import { registerExperimentsRoutes } from './api/experiments/controller.js';
import { registerLearningRoutes } from './api/learning/controller.js';
import { registerAutomationRoutes } from './api/automation/controller.js';
import { registerAggregatorRoutes } from './api/aggregator/controller.js';
import { registerConnectivityRoutes } from './api/connectivity/controller.js';
import { registerChatRoutes } from './api/chat/controller.js';
import { registerFilesRoutes } from './api/files/controller.js';
import { registerExportsRoutes } from './api/exports/controller.js';
import { registerImportsRoutes } from './api/imports/controller.js';
import { registerBulkRoutes } from './api/bulk/controller.js';
import { registerPermissionsRoutes } from './api/permissions/controller.js';
import { registerSearchRoutes } from './api/search/controller.js';
import { registerNotificationsRoutes } from './api/notifications/controller.js';
import { registerWebhooksRoutes } from './api/webhooks/controller.js';
import { registerCollectiveRoutes } from './api/collective/controller.js';
import { registerPublicRoutes } from './api/public/controller.js';
import { registerDevRoutes } from './api/dev/controller.js';
import { registerCouncilRoutes } from './api/council/controller.js';
import { registerTreasuryRoutes } from './api/treasury/controller.js';

// 4. Admin — последним (catch-all wildcard).
import { registerAdminRoutes } from './api/admin/controller.js';

// Middleware.
import { auditMiddleware } from './api/middleware/audit.js';
import { regimeMiddleware } from './api/middleware/regime.js';
import { errorHandler, notFoundHandler } from './api/middleware/error-handler.js';
import { idempotency, idempotencyCapture, idempotencySave } from './api/middleware/idempotency.js';

// Core / infra.
import { close as closeAudit } from './core/audit.js';
import { closeConnections as closeDb } from './lib/db.js';
import { closeConnections as closeRedis } from './lib/redis.js';
import { newUUID } from './lib/id.js';

// ─── Константы ──────────────────────────────────────────────────────────

export const BODY_LIMIT_BYTES = 20 * 1024 * 1024;
export const SHUTDOWN_TIMEOUT_MS = 15_000;

// Точечные override для роутов, которым нужен больший body limit.
// Используется в контроллерах: app.post('/imports', { bodyLimit: ROUTE_BODY_LIMITS.imports }, ...).
export const ROUTE_BODY_LIMITS = {
  default: BODY_LIMIT_BYTES,
  imports: 50 * 1024 * 1024,
  files: 50 * 1024 * 1024,
} as const;

// ─── Утилиты ────────────────────────────────────────────────────────────

export function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new AppError(
      'INVALID_PORT',
      `Invalid port: ${raw}. Expected integer 1..65535.`,
      500,
      { raw, field: 'PORT' },
    );
  }
  return n;
}

// TRUST_PROXY:
//   '' / undefined      → '1'  (один ingress/nginx — безопасный дефолт)
//   'false'             → false (не доверять X-Forwarded-For)
//   'true'              → true  (доверять всем — только для отладки)
//   '2', '3', ...       → '2', '3' (число хопов, строкой — тип Fastify v5)
//   '10.0.0.0/8,...'    → '10.0.0.0/8,...' (CIDR / список)
function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined || raw === '') {return '1';}
  if (raw === 'false') {return false;}
  if (raw === 'true') {return true;}
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) {return String(n);}
  return raw;
}

// ─── buildServer ────────────────────────────────────────────────────────

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    genReqId: () => newUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: parseTrustProxy(process.env['TRUST_PROXY']),
  });

  // ─── Плагины ──────────────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  // Fastify 5: разрешаем пустое тело для POST/PUT с Content-Type: application/json.
  // Mobile и curl без -d шлют POST без body — это нормально.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const s = (body as string | undefined) ?? '';
      if (s.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(s));
      } catch (e) {
        done(e as Error, undefined);
      }
    },
  );

  // ─── Хуки ─────────────────────────────────────────────────────────────

  // /metrics* может содержать чувствительные данные. Если METRICS_TOKEN задан —
  // требуется Bearer; иначе (dev/local) доступ открыт.
  app.addHook('onRequest', async (req, reply) => {
    const token = process.env['METRICS_TOKEN'];
    if (!token) {return;}
    if (!req.url.startsWith('/metrics')) {return;}
    if (req.headers['authorization'] !== `Bearer ${token}`) {
      return reply.code(401).send({ code: 'NO_TOKEN', message: 'Unauthorized' });
    }
  });

  app.addHook('onRequest', auditMiddleware);
  app.addHook('onRequest', regimeMiddleware);
  app.addHook('onRequest', idempotency());
  app.addHook('onSend', idempotencyCapture);
  app.addHook('onResponse', idempotencySave);

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // ─── Регистрация роутов ───────────────────────────────────────────────
  //
  // Порядок:
  //   1. panels (A.1.98.01) — первым: bootstrap-конфиг фронта, единственный
  //      до-auth эндпоинт. Регистрируется до всего домена.
  //   2. system (A.1.90.*) — health/version/metrics должны быть доступны
  //      даже при отказе домена (k8s probes / observability).
  //   3. domain (A.1.01…A.1.36, A.1.91…A.1.97) — по возрастанию ID.
  //   4. admin (A.1.35.01) — последним: catch-all wildcard-роуты админки
  //      не должны перехватывать чужие пути. Исключение из ID-порядка
  //      осознанное.

  // 1. Panels
  await registerPanelsRoutes(app);

  // 2. System
  await registerHealthRoutes(app);
  await registerVersionRoutes(app);
  await registerMetricsRoutes(app);

  // 3. Domain (по возрастанию ID)
  await registerAuthRoutes(app);
  await registerParticipantsRoutes(app);
  await registerDirectionsRoutes(app);
  await registerCellsRoutes(app);
  await registerCapacityRoutes(app);
  await registerReassignmentRoutes(app);
  await registerQuestionRoutes(app);
  await registerProposalRoutes(app);
  await registerMandatesRoutes(app);
  await registerPlansRoutes(app);
  await registerTasksRoutes(app);
  await registerReportsRoutes(app);
  await registerOtcRoutes(app);
  await registerSignalsRoutes(app);
  await registerConnectionsRoutes(app);
  await registerArbitrationsRoutes(app);
  await registerUniversalRunsRoutes(app);
  await registerFlowsRoutes(app);
  await registerGoodsRoutes(app);
  await registerStandardsRoutes(app);
  await registerRegimesRoutes(app);
  await registerBalanceRoutes(app);
  await registerVerificationRoutes(app);
  await registerArchiveRoutes(app);
  await registerJusticeRoutes(app);
  await registerJuryRoutes(app);
  await registerPsyRoutes(app);
  await registerGatewayRoutes(app);
  await registerQuantaRoutes(app);
  await registerConstructorRoutes(app);
  await registerPlanetaryRoutes(app);
  await registerConvergenceRoutes(app);
  await registerSemanticRoutes(app);
  await registerExperimentsRoutes(app);
  await registerLearningRoutes(app);
  await registerAutomationRoutes(app);
  await registerAggregatorRoutes(app);
  await registerConnectivityRoutes(app);
  await registerChatRoutes(app);
  await registerFilesRoutes(app);
  await registerExportsRoutes(app);
  await registerImportsRoutes(app);
  await registerBulkRoutes(app);
  await registerPermissionsRoutes(app);
  await registerSearchRoutes(app);
  await registerNotificationsRoutes(app);
  await registerWebhooksRoutes(app);
  await registerCollectiveRoutes(app);
  await registerPublicRoutes(app);
  await registerDevRoutes(app);
  await registerCouncilRoutes(app);
  await registerTreasuryRoutes(app);

  // 4. Admin — last
  await registerAdminRoutes(app);

  return app;
}

// ─── main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // PORT парсим внутри main — throw ловится main().catch().
  const port = parsePort(process.env['API_PORT'] ?? process.env['PORT'], 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';

  const app = await buildServer();

  try {
    await app.listen({ port, host });
    app.log.info(`XartIA API listening on ${host}:${port}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {return;}
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down...`);

    const forceExit = setTimeout(() => {
      app.log.error(
        `Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      // Порядок: audit flush → db + redis. Иначе audit потеряет batch.
      await closeAudit();
      await Promise.allSettled([closeDb(), closeRedis()]);
      clearTimeout(forceExit);
      process.exit(0);
    } catch (e) {
      app.log.error({ err: e }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  // buildServer/parsePort упали до listen. console.error — чтобы пережить
  // падение транспорта pino (в этом случае logger недоступен надёжно).
  if (e instanceof AppError) {
    console.error(
      `Fatal startup error [${e.code}]: ${e.message}`,
      e.details ?? '',
    );
  } else {
    console.error('Fatal startup error:', e);
  }
  process.exit(1);
});