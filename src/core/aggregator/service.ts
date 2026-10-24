// C.0.33.02 — Сервис Aggregator.
// Кластеризация сигналов (I.6.17). Роль AGGREGATOR.
//
// Не принимает решений — только фильтрует и группирует.
// Лимит 100 валидаций/день (I.6.17.2в).
//
// AI-эвристика — N.0.01.03 (clusterSignals, suggestPattern, updateCluster).
// Маршрутизация — через C.0.34.02.routeSignal (dynamic import для
// разрыва цикла connectivity → signals → … → aggregator).
//
// v0.0.02:
//   - P3: createCluster — relevance от AI clamp'ится в [0,1] + NaN-guard
//         (AI может вернуть NaN / вне диапазона → entity ValidationError → 500).
//   - P4: createCluster — FK 23503 на target_direction_id → ValidationError 422.
//   - P5: validateCluster — atomic UPDATE WHERE status = 'new'.
//   - P6: routeCluster — atomic UPDATE WHERE status = 'validated'.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import type { UUID, ISODateTime, Priority } from '../types.js';

import {
  createCluster as entityCreateCluster,
  validateCluster as entityValidateCluster,
  routeCluster as entityRouteCluster,
  canValidateToday as entityCanValidateToday,
  MIN_SIGNALS_PER_CLUSTER,
  MAX_CLUSTERS_PER_DAY,
  type AggregatorSignal,
  type AggregatorCluster,
  type ClusterStatus,
} from './entity.js';

// ─── Вспомогательные типы ────────────────────────────────────────

export interface SignalFilter {
  clusterId?: UUID | null;
  priority?: Priority;
  page?: number;
  perPage?: number;
}

export interface ClusterFilter {
  status?: ClusterStatus;
  page?: number;
  perPage?: number;
}

export interface StatsPeriod {
  from?: ISODateTime;
  to?: ISODateTime;
}

export interface DailyStats {
  accepted: number;
  clustered: number;
  validated: number;
  routed: number;
}

// ─── Row-mapping ─────────────────────────────────────────────────

interface SignalRow {
  id: string;
  theme: string;
  source_id: string;
  priority: Priority;
  received_at: Date;
  cluster_id: string | null;
}

function rowToSignal(r: SignalRow): AggregatorSignal {
  return {
    id: r.id,
    theme: r.theme,
    sourceId: r.source_id,
    priority: r.priority,
    receivedAt: r.received_at.toISOString(),
  };
}

interface ClusterRow {
  id: string;
  signal_ids: string[];
  pattern: string;
  relevance: string;
  status: ClusterStatus;
  target_direction_id: string | null;
  validated_by: string | null;
  created_at: Date;
  validated_at: Date | null;
  routed_at: Date | null;
}

function rowToCluster(r: ClusterRow): AggregatorCluster {
  return {
    id: r.id,
    signalIds: r.signal_ids ?? [],
    pattern: r.pattern,
    relevance: parseFloat(r.relevance),
    status: r.status,
    targetDirectionId: r.target_direction_id,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── getSignals ──────────────────────────────────────────────────

export async function getSignals(
  filter: SignalFilter,
  _requesterId: UUID,
): Promise<AggregatorSignal[]> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];

  if (filter.clusterId === null) {
    cond.push('cluster_id IS NULL');
  } else if (filter.clusterId !== undefined) {
    params.push(filter.clusterId);
    cond.push(`cluster_id = $${params.length}`);
  }
  if (filter.priority) {
    params.push(filter.priority);
    cond.push(`priority = $${params.length}`);
  }

  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';
  params.push(perPage, offset);

  const rows = await query<SignalRow>(
    `SELECT id, theme, source_id, priority, received_at, cluster_id
       FROM aggregator_signals
       ${where}
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                      WHEN 'standard' THEN 3 ELSE 4 END,
        received_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToSignal);
}

// ─── createCluster ───────────────────────────────────────────────

export interface CreateClusterServiceInput {
  signalIds: UUID[];
  pattern: string;
  relevance?: number;
  targetDirectionId?: UUID;
}

export async function createCluster(
  input: CreateClusterServiceInput,
  requesterId: UUID,
): Promise<AggregatorCluster> {
  if (input.signalIds.length < MIN_SIGNALS_PER_CLUSTER) {
    throw new ValidationError(
      `Кластер требует минимум ${MIN_SIGNALS_PER_CLUSTER} сигналов`,
    );
  }

  // relevance: если не передан — берём из AI-эвристики.
  let relevance = input.relevance;
  if (relevance === undefined) {
    try {
      const { suggestPattern } = await import('../../ai/cluster.js');
      const suggestion = await suggestPattern(input.signalIds);
      // P3: AI может вернуть NaN / вне [0,1] → entity ValidationError → 500.
      // Clamp + NaN-guard.
      const raw = suggestion.confidence;
      relevance = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    } catch (e) {
      logger.warn({ err: e }, 'aggregator: suggestPattern failed, fallback 0.5');
      relevance = 0.5;
    }
  }

  const entity = entityCreateCluster({
    id: newUUID(),
    signalIds: input.signalIds,
    pattern: input.pattern,
    relevance,
    ...(input.targetDirectionId
      ? { targetDirectionId: input.targetDirectionId }
      : {}),
  });

  // Проверяем, что все signal_ids существуют.
  const found = await query<{ source_id: string }>(
    `SELECT source_id FROM aggregator_signals
      WHERE source_id = ANY($1::uuid[])`,
    [entity.signalIds],
  );
  if (found.length !== entity.signalIds.length) {
    throw new ValidationError(
      `Некоторые signal_ids не найдены в aggregator_signals ` +
        `(найдено ${found.length} из ${entity.signalIds.length})`,
    );
  }

  // P4: FK 23503 на target_direction_id → 422. Оборачиваем только
  // транзакцию — проверка signal_ids выше не нуждается в catch.
  try {
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO aggregator_clusters
           (id, signal_ids, pattern, relevance, status, target_direction_id)
         VALUES ($1, $2::jsonb, $3, $4, 'new', $5)`,
        [
          entity.id,
          JSON.stringify(entity.signalIds),
          entity.pattern,
          entity.relevance,
          entity.targetDirectionId,
        ],
      );
      // Привязываем aggregator_signals к кластеру.
      await client.query(
        `UPDATE aggregator_signals SET cluster_id = $1
          WHERE source_id = ANY($2::uuid[]) AND cluster_id IS NULL`,
        [entity.id, entity.signalIds],
      );
    });
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === '23503' && (err.constraint ?? '').includes('target_direction_id')) {
      throw new ValidationError(
        'target_direction_id не существует',
        [{ path: 'target_direction_id', message: 'not found' }],
      );
    }
    throw e;
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'aggregator.cluster_created',
    entityType: 'aggregator_cluster',
    entityId: entity.id,
    newValue: {
      signal_count: entity.signalIds.length,
      pattern: entity.pattern,
      relevance: entity.relevance,
    },
  });

  return entity;
}

// ─── listClusters / getCluster ───────────────────────────────────

export async function listClusters(
  filter: ClusterFilter,
  _requesterId: UUID,
): Promise<{ data: AggregatorCluster[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    cond.push(`status = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM aggregator_clusters ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<ClusterRow>(
    `SELECT id, signal_ids, pattern, relevance::text AS relevance,
            status, target_direction_id, validated_by,
            created_at, validated_at, routed_at
       FROM aggregator_clusters
       ${where}
      ORDER BY
        CASE status WHEN 'new' THEN 1 WHEN 'validated' THEN 2
                    WHEN 'routed' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToCluster), total };
}

export async function getCluster(
  clusterId: UUID,
  _requesterId: UUID,
): Promise<AggregatorCluster> {
  const row = await queryOne<ClusterRow>(
    `SELECT id, signal_ids, pattern, relevance::text AS relevance,
            status, target_direction_id, validated_by,
            created_at, validated_at, routed_at
       FROM aggregator_clusters WHERE id = $1`,
    [clusterId],
  );
  if (!row) {throw new NotFoundError('Кластер', clusterId);}
  return rowToCluster(row);
}

// ─── validateCluster ─────────────────────────────────────────────

// P5: атомарный UPDATE с проверкой status = 'new'. 0 rows → 409 (race-safe).
export async function validateCluster(
  clusterId: UUID,
  valid: boolean,
  comment: string | undefined,
  requesterId: UUID,
): Promise<AggregatorCluster> {
  // 1. Проверка лимита 100/день.
  const today = await getValidatedToday(requesterId);
  if (!entityCanValidateToday(today)) {
    throw new ConflictError(
      `Дневной лимит валидаций исчерпан (${MAX_CLUSTERS_PER_DAY}, I.6.17.2в)`,
      { limit: MAX_CLUSTERS_PER_DAY, validatedToday: today },
    );
  }

  // 2. Читаем кластер.
  const row = await queryOne<ClusterRow>(
    `SELECT id, signal_ids, pattern, relevance::text AS relevance,
            status, target_direction_id, validated_by,
            created_at, validated_at, routed_at
       FROM aggregator_clusters WHERE id = $1`,
    [clusterId],
  );
  if (!row) {throw new NotFoundError('Кластер', clusterId);}

  const updated = entityValidateCluster(rowToCluster(row), valid, comment);

  const affected = await query<{ id: string }>(
    `UPDATE aggregator_clusters
        SET status = $2, validated_by = $3, validated_at = now()
      WHERE id = $1 AND status = 'new'
      RETURNING id`,
    [clusterId, updated.status, requesterId],
  );
  if (affected.length === 0) {
    throw new ConflictError(
      'Кластер уже не в статусе new (race)',
    );
  }

  // 3. Обновление daily_stats.
  await upsertDailyStat(requesterId, {
    validated: 1,
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: valid ? 'aggregator.cluster_validated' : 'aggregator.cluster_rejected',
    entityType: 'aggregator_cluster',
    entityId: clusterId,
    newValue: {
      valid,
      ...(comment ? { comment } : {}),
      pattern: updated.pattern,
    },
  });

  return updated;
}

// ─── routeCluster ────────────────────────────────────────────────

// P6: атомарный UPDATE с проверкой status = 'validated'. 0 rows → 409 (race-safe).
export async function routeCluster(
  clusterId: UUID,
  targetDirectionId: UUID,
  justification: string,
  requesterId: UUID,
): Promise<AggregatorCluster> {
  if (!targetDirectionId) {
    throw new ValidationError('target_direction_id обязателен');
  }
  if (!justification || !justification.trim()) {
    throw new ValidationError('justification обязателен');
  }

  const row = await queryOne<ClusterRow>(
    `SELECT id, signal_ids, pattern, relevance::text AS relevance,
            status, target_direction_id, validated_by,
            created_at, validated_at, routed_at
       FROM aggregator_clusters WHERE id = $1`,
    [clusterId],
  );
  if (!row) {throw new NotFoundError('Кластер', clusterId);}

  const updated = entityRouteCluster(
    rowToCluster(row),
    targetDirectionId,
    justification,
  );

  const affected = await query<{ id: string }>(
    `UPDATE aggregator_clusters
        SET status = 'routed', target_direction_id = $2, routed_at = now()
      WHERE id = $1 AND status = 'validated'
      RETURNING id`,
    [clusterId, targetDirectionId],
  );
  if (affected.length === 0) {
    throw new ConflictError(
      'Кластер уже не в статусе validated (race)',
    );
  }

  // Маршрутизация исходных signals через connectivity (best-effort).
  // Dynamic import — разрыв цикла connectivity → signals → … → aggregator.
  let routedCount = 0;
  try {
    const { routeSignal } = await import('../connectivity/service.js');
    for (const signalId of updated.signalIds) {
      try {
        await routeSignal(
          {
            signalId,
            targetDirectionId,
            reason: `aggregator: ${justification.slice(0, 200)}`,
          },
          requesterId,
        );
        routedCount++;
      } catch (e) {
        logger.warn(
          { err: e, signalId, clusterId },
          'aggregator.routeCluster: routeSignal failed for one signal',
        );
      }
    }
  } catch (e) {
    logger.warn(
      { err: e, clusterId },
      'aggregator.routeCluster: connectivity module unavailable',
    );
  }

  await upsertDailyStat(requesterId, { routed: 1 });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'aggregator.cluster_routed',
    entityType: 'aggregator_cluster',
    entityId: clusterId,
    newValue: {
      target_direction_id: targetDirectionId,
      justification,
      routed_signals: routedCount,
    },
  });

  return updated;
}

// ─── canValidateToday / getValidatedToday ────────────────────────

export async function getValidatedToday(aggregatorId: UUID): Promise<number> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aggregator_clusters
      WHERE validated_by = $1
        AND validated_at IS NOT NULL
        AND validated_at::date = CURRENT_DATE`,
    [aggregatorId],
  );
  return parseInt(row?.cnt ?? '0', 10);
}

export async function canValidateToday(
  aggregatorId: UUID,
): Promise<{ can_validate: boolean; remaining: number; validatedToday: number }> {
  const validatedToday = await getValidatedToday(aggregatorId);
  const remaining = Math.max(0, MAX_CLUSTERS_PER_DAY - validatedToday);
  return {
    can_validate: entityCanValidateToday(validatedToday),
    remaining,
    validatedToday,
  };
}

// ─── getStats ────────────────────────────────────────────────────

export async function getStats(
  aggregatorId: UUID,
  period: StatsPeriod = {},
): Promise<DailyStats> {
  const cond: string[] = ['aggregator_id = $1'];
  const params: unknown[] = [aggregatorId];

  if (period.from) {
    params.push(period.from);
    cond.push(`date >= $${params.length}::date`);
  }
  if (period.to) {
    params.push(period.to);
    cond.push(`date <= $${params.length}::date`);
  }

  const row = await queryOne<{
    accepted: string; clustered: string; validated: string; routed: string;
  }>(
    `SELECT
       COALESCE(SUM(accepted), 0)::text AS accepted,
       COALESCE(SUM(clustered), 0)::text AS clustered,
       COALESCE(SUM(validated), 0)::text AS validated,
       COALESCE(SUM(routed), 0)::text AS routed
     FROM aggregator_daily_stats
     WHERE ${cond.join(' AND ')}`,
    params,
  );

  return {
    accepted: parseInt(row?.accepted ?? '0', 10),
    clustered: parseInt(row?.clustered ?? '0', 10),
    validated: parseInt(row?.validated ?? '0', 10),
    routed: parseInt(row?.routed ?? '0', 10),
  };
}

// ─── clusterSignals (AI-обёртка) ─────────────────────────────────

export async function clusterSignals(
  signalIds: UUID[],
  pattern: string,
  requesterId: UUID,
): Promise<AggregatorCluster> {
  // Если pattern не задан — спросим AI.
  let finalPattern = pattern;
  let relevance = 0.5;
  if (!pattern || !pattern.trim()) {
    try {
      const { suggestPattern } = await import('../../ai/cluster.js');
      const s = await suggestPattern(signalIds);
      finalPattern = s.pattern;
      relevance = s.confidence;
    } catch (e) {
      logger.warn({ err: e }, 'aggregator.clusterSignals: suggestPattern failed');
      finalPattern = '(без темы)';
    }
  }

  return createCluster(
    {
      signalIds,
      pattern: finalPattern,
      relevance,
    },
    requesterId,
  );
}

// ─── autoCluster / process-daily ─────────────────────────────────

export async function autoCluster(requesterId: UUID): Promise<{
  clustersCreated: number;
  signalsClustered: number;
}> {
  // 1. Необработанные сигналы из aggregator_signals.
  const unclustered = await query<{ source_id: string }>(
    `SELECT source_id FROM aggregator_signals
      WHERE cluster_id IS NULL
        AND received_at > now() - interval '7 days'
      ORDER BY received_at ASC
      LIMIT 500`,
  );

  if (unclustered.length < MIN_SIGNALS_PER_CLUSTER) {
    return { clustersCreated: 0, signalsClustered: 0 };
  }

  const sourceIds = unclustered.map((r) => r.source_id);

  // 2. AI-эвристика.
  let result: Awaited<ReturnType<typeof import('../../ai/cluster.js')['clusterSignals']>>;
  try {
    const { clusterSignals: aiCluster } = await import('../../ai/cluster.js');
    result = await aiCluster(sourceIds);
  } catch (e) {
    logger.warn({ err: e }, 'aggregator.autoCluster: ai clusterSignals failed');
    return { clustersCreated: 0, signalsClustered: 0 };
  }

  // 3. Создание кластеров через createCluster.
  let created = 0;
  let signalsClustered = 0;

  for (const c of result.clusters) {
    try {
      await createCluster(
        {
          signalIds: c.signalIds,
          pattern: c.pattern,
          relevance: c.relevance,
        },
        requesterId,
      );
      created++;
      signalsClustered += c.signalIds.length;
    } catch (e) {
      logger.warn({ err: e, pattern: c.pattern }, 'autoCluster: cluster create failed');
    }
  }

  // 4. Обновляем daily_stats.
  if (created > 0 || signalsClustered > 0) {
    await upsertDailyStat(requesterId, {
      accepted: sourceIds.length,
      clustered: signalsClustered,
    });
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'aggregator.auto_cluster',
    entityType: 'aggregator_cluster_batch',
    entityId: newUUID(),
    newValue: {
      total_processed: sourceIds.length,
      clusters_created: created,
      signals_clustered: signalsClustered,
    },
  });

  return { clustersCreated: created, signalsClustered };
}

/**
 * Cron-обёртка. Автокластеризация + запись в daily_stats под system.
 */
export async function processDaily(): Promise<{
  processed: number;
  clustersCreated: number;
}> {
  const unclusteredCount = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aggregator_signals
      WHERE cluster_id IS NULL
        AND received_at > now() - interval '7 days'`,
  );
  const processed = parseInt(unclusteredCount?.cnt ?? '0', 10);

  // Автокластеризация от system-пользователя.
  let clustersCreated = 0;
  try {
    const { clusterSignals: aiCluster } = await import('../../ai/cluster.js');
    const unclustered = await query<{ source_id: string }>(
      `SELECT source_id FROM aggregator_signals
        WHERE cluster_id IS NULL
          AND received_at > now() - interval '7 days'
        ORDER BY received_at ASC LIMIT 500`,
    );
    const sourceIds = unclustered.map((r) => r.source_id);
    if (sourceIds.length >= MIN_SIGNALS_PER_CLUSTER) {
      const result = await aiCluster(sourceIds);
      for (const c of result.clusters) {
        try {
          // System-контекст: пишем напрямую без requireRight в сервисе —
          // создание через helper ниже.
          await createClusterAsSystem({
            signalIds: c.signalIds,
            pattern: c.pattern,
            relevance: c.relevance,
          });
          clustersCreated++;
        } catch (e) {
          logger.warn({ err: e }, 'processDaily: cluster create failed');
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e }, 'processDaily: clustering failed');
  }

  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'aggregator.process_daily',
    entityType: 'aggregator_cluster_batch',
    entityId: newUUID(),
    newValue: { processed, clustersCreated },
  });

  return { processed, clustersCreated };
}

// ─── System-helper ───────────────────────────────────────────────

async function createClusterAsSystem(input: {
  signalIds: UUID[];
  pattern: string;
  relevance: number;
}): Promise<AggregatorCluster> {
  const entity = entityCreateCluster({
    id: newUUID(),
    signalIds: input.signalIds,
    pattern: input.pattern,
    relevance: input.relevance,
  });

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO aggregator_clusters
         (id, signal_ids, pattern, relevance, status)
       VALUES ($1, $2::jsonb, $3, $4, 'new')`,
      [
        entity.id,
        JSON.stringify(entity.signalIds),
        entity.pattern,
        entity.relevance,
      ],
    );
    await client.query(
      `UPDATE aggregator_signals SET cluster_id = $1
        WHERE source_id = ANY($2::uuid[]) AND cluster_id IS NULL`,
      [entity.id, entity.signalIds],
    );
  });

  return entity;
}

// ─── daily_stats helper ──────────────────────────────────────────

async function upsertDailyStat(
  aggregatorId: UUID,
  delta: Partial<DailyStats>,
): Promise<void> {
  const accepted = delta.accepted ?? 0;
  const clustered = delta.clustered ?? 0;
  const validated = delta.validated ?? 0;
  const routed = delta.routed ?? 0;

  await query(
    `INSERT INTO aggregator_daily_stats
       (id, aggregator_id, date, accepted, clustered, validated, routed)
     VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
     ON CONFLICT (aggregator_id, date) DO UPDATE
       SET accepted  = aggregator_daily_stats.accepted  + EXCLUDED.accepted,
           clustered = aggregator_daily_stats.clustered + EXCLUDED.clustered,
           validated = aggregator_daily_stats.validated + EXCLUDED.validated,
           routed    = aggregator_daily_stats.routed    + EXCLUDED.routed`,
    [newUUID(), aggregatorId, accepted, clustered, validated, routed],
  );
}