// A.1.33.01 — Контроллер Aggregator.
// 11 эндпоинтов: signals, clusters, can-validate-today, validated-today,
// stats, auto-cluster, process-daily, cluster validate/route.
//
// Права: aggregator (V/C/E/Act). Порядок регистрации критичен —
// статические роуты ДО /clusters/:id.
//
// v0.0.02:
//   - P1: cluster_id — uuid | null | undefined. '' и 'null' → null
//         (фильтр «без кластера»), undefined → не фильтровать.
//   - P2: createClusterBody.signal_ids — refine: без дублей
//         (dedup в entity уменьшил бы length < 2 → ValidationError → 500).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getSignals,
  createCluster,
  listClusters,
  getCluster,
  validateCluster,
  routeCluster,
  canValidateToday,
  getValidatedToday,
  getStats,
  autoCluster,
  processDaily,
} from '../../core/aggregator/service.js';
import { uuidSchema, prioritySchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

// Хелпер: пустую строку → undefined, чтобы query-параметр `?cluster_id=`
// (пустое значение) не падал в uuidSchema. Используется для всех
// опциональных UUID-фильтров в query.
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  uuidSchema.optional(),
);

// P1: cluster_id: '', 'null' → null (фильтр «без кластера»),
// undefined → не фильтровать.
const optionalUuidOrNull = z.preprocess(
  (v) => {
    if (v === '' || v === undefined) {return undefined;}
    if (v === 'null') {return null;}
    return v;
  },
  z.union([uuidSchema, z.null()]).optional(),
);

const idParams = z.object({ id: uuidSchema });

const clusterStatusSchema = z.enum(['new', 'validated', 'rejected', 'routed']);

const listSignalsQuery = z.object({
  cluster_id: optionalUuidOrNull,
  priority: prioritySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const listClustersQuery = z.object({
  status: clusterStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

// P2: signal_ids без дублей. entity-dedup уменьшил бы массив < 2
// и бросил ValidationError (→ 500). Отсекаем дубликаты в Zod (→ 422).
const createClusterBody = z.object({
  signal_ids: z.array(uuidSchema)
    .min(2, 'Минимум 2 сигнала')
    .refine(
      (ids) => new Set(ids).size === ids.length,
      { message: 'signal_ids должны быть уникальны (без дублей)' },
    ),
  pattern: z.string().min(1).max(500),
  relevance: z.number().min(0).max(1).optional(),
  target_direction_id: uuidSchema.optional(),
});

const validateClusterBody = z.object({
  valid: z.boolean(),
  comment: z.string().max(2000).optional(),
});

const routeClusterBody = z.object({
  target_direction_id: uuidSchema,
  justification: z.string().min(1).max(2000),
});

const aggregatorQuery = z.object({
  aggregator_id: optionalUuid,
});

const statsQuery = z.object({
  aggregator_id: optionalUuid,
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerAggregatorRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── СТАТИЧЕСКИЕ РОУТЫ (ДО /clusters/:id) ────────────────────

  // GET /aggregator/signals
  app.get(
    '/aggregator/signals',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateQuery(listSignalsQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listSignalsQuery>;
      const filter: Parameters<typeof getSignals>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      // P1: null → фильтр «cluster_id IS NULL»; UUID → точное совпадение;
      // undefined → не фильтровать.
      if (q.cluster_id === null) {
        filter.clusterId = null;
      } else if (q.cluster_id !== undefined) {
        filter.clusterId = q.cluster_id;
      }
      if (q.priority) {filter.priority = q.priority;}
      const data = await getSignals(filter, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /aggregator/clusters
  app.get(
    '/aggregator/clusters',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateQuery(listClustersQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listClustersQuery>;
      const filter: Parameters<typeof listClusters>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) {filter.status = q.status;}
      const result = await listClusters(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /aggregator/clusters
  app.post(
    '/aggregator/clusters',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'C'),
        validateBody(createClusterBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createClusterBody>;
      const cluster = await createCluster(
        {
          signalIds: b.signal_ids,
          pattern: b.pattern,
          ...(b.relevance !== undefined ? { relevance: b.relevance } : {}),
          ...(b.target_direction_id
            ? { targetDirectionId: b.target_direction_id }
            : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...cluster, audit_id: req.auditId });
    },
  );

  // GET /aggregator/can-validate-today
  app.get(
    '/aggregator/can-validate-today',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateQuery(aggregatorQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof aggregatorQuery>;
      const aggregatorId = q.aggregator_id ?? auth.participantId;
      const r = await canValidateToday(aggregatorId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /aggregator/validated-today
  app.get(
    '/aggregator/validated-today',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateQuery(aggregatorQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof aggregatorQuery>;
      const aggregatorId = q.aggregator_id ?? auth.participantId;
      const count = await getValidatedToday(aggregatorId);
      reply.send({ count, audit_id: req.auditId });
    },
  );

  // GET /aggregator/stats
  app.get(
    '/aggregator/stats',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateQuery(statsQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof statsQuery>;
      const aggregatorId = q.aggregator_id ?? auth.participantId;
      const period: Parameters<typeof getStats>[1] = {};
      if (q.from) {period.from = q.from;}
      if (q.to) {period.to = q.to;}
      const stats = await getStats(aggregatorId, period);
      reply.send({ ...stats, audit_id: req.auditId });
    },
  );

  // POST /aggregator/auto-cluster (ручной запуск)
  app.post(
    '/aggregator/auto-cluster',
    { preHandler: [authMiddleware, requireRight('aggregator', 'Act')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const r = await autoCluster(auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // POST /aggregator/process-daily (cron)
  app.post(
    '/aggregator/process-daily',
    { preHandler: [authMiddleware, requireRight('aggregator', 'Act')] },
    async (req, reply) => {
      const r = await processDaily();
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── ПАРАМЕТРИЗОВАННЫЕ РОУТЫ ─────────────────────────────────

  // GET /aggregator/clusters/:id
  app.get(
    '/aggregator/clusters/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const c = await getCluster(p.id, auth.participantId);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /aggregator/clusters/:id/validate
  app.post(
    '/aggregator/clusters/:id/validate',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'E'),
        validateParams(idParams),
        validateBody(validateClusterBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof validateClusterBody>;
      const c = await validateCluster(
        p.id,
        b.valid,
        b.comment,
        auth.participantId,
      );
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /aggregator/clusters/:id/route
  app.post(
    '/aggregator/clusters/:id/route',
    {
      preHandler: [
        authMiddleware,
        requireRight('aggregator', 'E'),
        validateParams(idParams),
        validateBody(routeClusterBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof routeClusterBody>;
      const c = await routeCluster(
        p.id,
        b.target_direction_id,
        b.justification,
        auth.participantId,
      );
      reply.send({ ...c, audit_id: req.auditId });
    },
  );
}