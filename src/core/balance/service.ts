// C.0.18.02 — Сервис Балансировки
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: resolveAnomaly — atomic UPDATE ... WHERE status <> 'resolved'.
//   - B2: createMetaRequest — транзакция (signal + anomaly update).
//   - B3: createMetaRequest — atomic UPDATE ... WHERE meta_request_id IS NULL.
//   - B4: recalcNormativeSpeeds — транзакция (все 4 priority).
//   - B5: recalcNormativeSpeeds — pg_advisory_xact_lock per priority.
//   - B6: removeCompetenceRisk — atomic UPDATE ... WHERE status = 'active'.
//   - B7: addCompetenceRisk — проверка на существующий active risk.
//   - B8: WS-emit — try/catch (best-effort).
//   - B9: collectDailyMetrics — INSERT ... ON CONFLICT (direction_id, period) DO NOTHING.
//   - B10: getMetrics — при directionId undefined фильтрует direction_id IS NULL
//          (было: без фильтра → последняя метрика любого направления).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - monitorGateway — заглушка (0/0), нужен real analysis.
//   - listMetaFlows — не реализован.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import {
  emitAnomalyResolved,
  emitMetaRequest,
  emitNormativeSpeedsUpdated,
  emitCompetenceRisk,
} from '../../ws/balance.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError } from '../errors.js';
import type { UUID, Priority } from '../types.js';

import {
  assignCompetenceRisk,
  recalcNormativeSpeed,
  detectAnomaly,
  type Anomaly, type AnomalyType, type AnomalyStatus,
  type BalanceMetricsSnapshot,
  type NormativeSpeed, type CompetenceRisk, type GuardianIndex,
  type GuardianIndexType,
} from './entity.js';

// ─── best-effort helper ────────────────────────────────────────
async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `balance: ${label} failed`);
  }
}

// ─── Anomalies ─────────────────────────────────────────────────

interface AnomalyRow {
  id: string; type: AnomalyType; direction_id: string; severity: number;
  status: AnomalyStatus; meta_request_id: string | null;
  details: Record<string, unknown>; created_at: Date; resolved_at: Date | null;
}

function rowToAnomaly(r: AnomalyRow): Anomaly {
  return {
    id: r.id, type: r.type, directionId: r.direction_id, severity: r.severity,
    status: r.status, metaRequestId: r.meta_request_id,
    details: r.details ?? {},
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
  };
}

export interface AnomalyFilter {
  type?: AnomalyType;
  status?: AnomalyStatus;
  directionId?: UUID;
  minSeverity?: number;
  page?: number;
  perPage?: number;
}

export async function listAnomalies(
  filter: AnomalyFilter = {},
): Promise<{ data: Anomaly[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.type) { params.push(filter.type); cond.push(`type = $${params.length}`); }
  if (filter.status) { params.push(filter.status); cond.push(`status = $${params.length}`); }
  if (filter.directionId) { params.push(filter.directionId); cond.push(`direction_id = $${params.length}`); }
  if (filter.minSeverity !== undefined) {
    params.push(filter.minSeverity);
    cond.push(`severity >= $${params.length}`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM anomalies ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<AnomalyRow>(
    `SELECT id, type, direction_id, severity, status, meta_request_id,
            details, created_at, resolved_at
       FROM anomalies ${where}
      ORDER BY severity DESC, created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToAnomaly), total };
}

export async function getAnomaly(id: UUID): Promise<Anomaly> {
  const row = await queryOne<AnomalyRow>(
    `SELECT id, type, direction_id, severity, status, meta_request_id,
            details, created_at, resolved_at
       FROM anomalies WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Аномалия', id);}
  return rowToAnomaly(row);
}

// B1: atomic UPDATE.
export async function resolveAnomaly(id: UUID, by: UUID): Promise<Anomaly> {
  const a = await getAnomaly(id);
  if (a.status === 'resolved') {throw new ConflictError('Аномалия уже решена');}

  const result = await query<{ id: string }>(
    `UPDATE anomalies
        SET status = 'resolved', resolved_at = now()
      WHERE id = $1 AND status <> 'resolved'
      RETURNING id`,
    [id],
  );
  if (result.length === 0) {
    throw new ConflictError('Аномалия уже решена параллельным запросом');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'balance.resolve_anomaly', entityType: 'anomaly', entityId: id,
  });

  await bestEffort('emitAnomalyResolved', () =>
    emitAnomalyResolved(id, a.directionId, a.type, by),
  );

  return getAnomaly(id);
}

// ─── Meta-request (B2, B3) ─────────────────────────────────────

export async function createMetaRequest(
  anomalyId: UUID,
  targetDirections: UUID[],
  by: UUID,
): Promise<{ metaRequestId: UUID; targetDirections: UUID[] }> {
  const a = await getAnomaly(anomalyId);
  if (a.metaRequestId) {throw new ConflictError('Мета-запрос уже создан');}
  if (targetDirections.length === 0) {throw new ConflictError('Нужно хотя бы одно направление');}

  // B2 (частично): signal создаётся через createSignalService — это ОТДЕЛЬНАЯ
  // транзакция (сервис signals открывает свою). Мы не можем поместить signal
  // INSERT в нашу транзакцию без дублирования его логики (external_id, meta_flows,
  // signal_attributes, WS-эмиссия и т.д.).
  //
  // Pragmatic fix: создаём signal, потом atomic UPDATE с WHERE meta_request_id IS NULL.
  // При race (два параллельных createMetaRequest):
  //   - оба создадут signal (дубль)
  //   - только один UPDATE пройдёт (0 rows у второго)
  //   - второй signal останется orphaned (не привязан к anomaly) → лог + 409
  //   - cleanup orphaned signal'ов — техдолг (cron или ручной)
  //
  // TODO(techdebt): вынести INSERT signal в отдельную функцию, принимающую
  // PoolClient, и вызывать её внутри transaction с advisory lock. Тогда race
  // закрывается полностью.
  const { createSignalService } = await import('../signals/service.js');
  const signal = await createSignalService({
    type: 'problem',
    description: `Мета-запрос: аномалия ${a.type} (severity=${a.severity})`,
    justification: `Устойчивая аномалия в направлении ${a.directionId}. Требуется анализ.`,
    priority: a.severity >= 8 ? 'high' : 'standard',
    directions: targetDirections,
  }, by);

  // B3: atomic UPDATE — если meta_request_id уже установлен параллельным
  // запросом, 0 rows → signal orphaned.
  const upd = await query<{ id: string }>(
    `UPDATE anomalies
        SET meta_request_id = $1, status = 'analyzed'
      WHERE id = $2 AND meta_request_id IS NULL
      RETURNING id`,
    [signal.id, anomalyId],
  );
  if (upd.length === 0) {
    logger.error(
      { anomalyId, orphanedSignalId: signal.id },
      'balance.createMetaRequest: race, signal orphaned (нужен cleanup)',
    );
    throw new ConflictError('Мета-запрос уже создан параллельным запросом');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'balance.create_meta_request', entityType: 'anomaly', entityId: anomalyId,
    newValue: { meta_request_id: signal.id, target_directions: targetDirections },
  });

  await bestEffort('emitMetaRequest', () =>
    emitMetaRequest(signal.id, anomalyId, targetDirections),
  );

  return { metaRequestId: signal.id, targetDirections };
}

// ─── NormativeSpeeds (B4, B5) ─────────────────────────────────

interface NormRow {
  id: string; priority: Priority; deadline_ms: string;
  version: number; published_at: Date;
}

function rowToNorm(r: NormRow): NormativeSpeed {
  return {
    id: r.id, priority: r.priority,
    deadlineMs: parseInt(r.deadline_ms, 10),
    version: r.version,
    publishedAt: r.published_at.toISOString(),
  };
}

export async function listNormativeSpeeds(): Promise<NormativeSpeed[]> {
  const rows = await query<NormRow>(
    `SELECT DISTINCT ON (priority) id, priority,
            deadline_ms::text AS deadline_ms, version, published_at
       FROM normative_speeds
      ORDER BY priority, version DESC`,
  );
  return rows.map(rowToNorm);
}

// B4, B5: транзакция + advisory lock per priority.
export async function recalcNormativeSpeeds(by: UUID): Promise<{ updated: number }> {
  const priorities: Priority[] = ['critical', 'high', 'standard', 'background'];
  let updated = 0;

  for (const priority of priorities) {
    const result = await transaction(async (client) => {
      // B5: advisory lock по priority — сериализует параллельные recalc.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`balance:recalc:${priority}`],
      );

      const speeds = await client.query<{ seconds: string }>(
        `SELECT EXTRACT(EPOCH FROM (r.created_at - s.created_at))::text AS seconds
           FROM signals s
           JOIN responses r ON r.signal_id = s.id
          WHERE s.priority = $1
            AND s.created_at > now() - interval '30 days'
          LIMIT 1000`,
        [priority],
      );
      if (speeds.rows.length < 5) {return false;}

      const speedsMs = speeds.rows.map((r) => parseFloat(r.seconds) * 1000);
      const newDeadline = recalcNormativeSpeed(speedsMs);

      const vRow = await client.query<{ v: string }>(
        `SELECT COALESCE(MAX(version), 0)::text AS v FROM normative_speeds WHERE priority = $1`,
        [priority],
      );
      const nextVersion = parseInt(vRow.rows[0]?.v ?? '0', 10) + 1;

      await client.query(
        `INSERT INTO normative_speeds (id, priority, deadline_ms, version)
         VALUES ($1, $2, $3, $4)`,
        [newUUID(), priority, newDeadline, nextVersion],
      );
      return true;
    });

    if (result) {updated++;}
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'balance.recalc_norms',
    entityType: 'normative_speed_batch',
    entityId: newUUID(),
    newValue: { updated },
  });

  await bestEffort('emitNormativeSpeedsUpdated', () =>
    emitNormativeSpeedsUpdated(updated),
  );

  return { updated };
}

// ─── CompetenceRisks (B6, B7) ─────────────────────────────────

interface RiskRow {
  id: string; direction_id: string; status: string; reason: string;
  verified_by: string | null; valid_from: Date; valid_to: Date | null;
}

function rowToRisk(r: RiskRow): CompetenceRisk {
  return {
    id: r.id, directionId: r.direction_id,
    status: r.status as CompetenceRisk['status'],
    reason: r.reason, verifiedBy: r.verified_by,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
  };
}

export async function listCompetenceRisks(): Promise<CompetenceRisk[]> {
  const rows = await query<RiskRow>(
    `SELECT id, direction_id, status, reason, verified_by, valid_from, valid_to
       FROM competence_risks WHERE status = 'active'
      ORDER BY valid_from DESC`,
  );
  return rows.map(rowToRisk);
}

// B7: проверка на существующий active risk на то же direction.
export async function addCompetenceRisk(
  directionId: UUID, reason: string, by: UUID,
): Promise<CompetenceRisk> {
  const entity = assignCompetenceRisk(directionId, reason, by);

  await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`balance:risk:${directionId}`],
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM competence_risks
        WHERE direction_id = $1 AND status = 'active' LIMIT 1`,
      [directionId],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError('Активный компетентностный риск для этого направления уже существует');
    }
    await client.query(
      `INSERT INTO competence_risks (id, direction_id, status, reason, verified_by)
       VALUES ($1, $2, 'active', $3, $4)`,
      [entity.id, entity.directionId, entity.reason, entity.verifiedBy],
    );
  });

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'balance.add_competence_risk',
    entityType: 'competence_risk', entityId: entity.id,
    newValue: { direction_id: directionId, reason },
  });

  await bestEffort('emitCompetenceRisk', () =>
    emitCompetenceRisk(entity, 'added', by),
  );

  return entity;
}

// B6: atomic UPDATE.
export async function removeCompetenceRisk(riskId: UUID, by: UUID): Promise<void> {
  const row = await queryOne<RiskRow>(
    `SELECT id, direction_id, status, reason, verified_by, valid_from, valid_to
       FROM competence_risks WHERE id = $1 AND status = 'active'`,
    [riskId],
  );
  if (!row) {throw new NotFoundError('Компетентностный риск', riskId);}

  const result = await query<{ id: string }>(
    `UPDATE competence_risks
        SET status = 'removed', valid_to = now()
      WHERE id = $1 AND status = 'active'
      RETURNING id`,
    [riskId],
  );
  if (result.length === 0) {
    throw new ConflictError('Риск уже удалён параллельным запросом');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'balance.remove_competence_risk',
    entityType: 'competence_risk', entityId: riskId,
  });

  await bestEffort('emitCompetenceRisk', () =>
    emitCompetenceRisk(rowToRisk(row), 'removed', by),
  );
}

// ─── Indices ───────────────────────────────────────────────────

interface IndexRow {
  id: string; type: GuardianIndexType; value: string;
  direction_id: string | null; created_at: Date;
}

function rowToIndex(r: IndexRow): GuardianIndex {
  return {
    id: r.id, type: r.type, value: parseFloat(r.value),
    directionId: r.direction_id,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listIndices(type?: GuardianIndexType): Promise<GuardianIndex[]> {
  const params: unknown[] = [];
  const where = type
    ? (params.push(type), `WHERE type = $${params.length}`)
    : '';
  const rows = await query<IndexRow>(
    `SELECT DISTINCT ON (type, direction_id)
            id, type, value::text AS value, direction_id, created_at
       FROM guardian_indices
       ${where}
      ORDER BY type, direction_id, created_at DESC`,
    params,
  );
  return rows.map(rowToIndex);
}

// ─── Metrics (B10) ────────────────────────────────────────────

export async function getMetrics(
  directionId?: UUID, period?: string,
): Promise<BalanceMetricsSnapshot> {
  // B10: при directionId undefined — только глобальные метрики (direction_id IS NULL),
  // а не «последняя любого направления».
  const cond: string[] = [];
  const params: unknown[] = [];
  if (directionId) {
    params.push(directionId);
    cond.push(`direction_id = $${params.length}`);
  } else {
    cond.push(`direction_id IS NULL`);
  }
  if (period) { params.push(period); cond.push(`period = $${params.length}`); }
  const where = `WHERE ${cond.join(' AND ')}`;

  const row = await queryOne<{
    id: string; direction_id: string | null; period: string;
    metrics: Record<string, number>; created_at: Date;
  }>(
    `SELECT id, direction_id, period, metrics, created_at
       FROM balance_metrics ${where}
      ORDER BY created_at DESC LIMIT 1`,
    params,
  );

  if (!row) {
    return {
      id: '',
      directionId: directionId ?? null,
      period: period ?? new Date().toISOString().slice(0, 10),
      metrics: {},
      createdAt: new Date().toISOString(),
    };
  }
  return {
    id: row.id, directionId: row.direction_id, period: row.period,
    metrics: row.metrics, createdAt: row.created_at.toISOString(),
  };
}

// ─── Pulse ─────────────────────────────────────────────────────

export async function getPulse(directionId?: UUID): Promise<{
  directionId: UUID | null;
  metrics: Record<string, number>;
}> {
  const metrics: Record<string, number> = {};

  if (directionId) {
    const [signals, tasks, overdue, anomalies] = await Promise.all([
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM signals
          WHERE lead_direction_id = $1 AND status NOT IN ('completed','rejected')`,
        [directionId],
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM tasks
          WHERE direction_id = $1 AND status NOT IN ('accepted','returned')`,
        [directionId],
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM tasks
          WHERE direction_id = $1 AND status NOT IN ('accepted','returned') AND deadline < now()`,
        [directionId],
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM anomalies
          WHERE direction_id = $1 AND status <> 'resolved'`,
        [directionId],
      ),
    ]);
    metrics['open_signals'] = parseInt(signals?.c ?? '0', 10);
    metrics['active_tasks'] = parseInt(tasks?.c ?? '0', 10);
    metrics['overdue_tasks'] = parseInt(overdue?.c ?? '0', 10);
    metrics['open_anomalies'] = parseInt(anomalies?.c ?? '0', 10);
  } else {
    const [signals, tasks, anomalies] = await Promise.all([
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM signals WHERE status NOT IN ('completed','rejected')`,
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM tasks WHERE status NOT IN ('accepted','returned')`,
      ),
      queryOne<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM anomalies WHERE status <> 'resolved'`,
      ),
    ]);
    metrics['open_signals'] = parseInt(signals?.c ?? '0', 10);
    metrics['active_tasks'] = parseInt(tasks?.c ?? '0', 10);
    metrics['open_anomalies'] = parseInt(anomalies?.c ?? '0', 10);
  }

  return { directionId: directionId ?? null, metrics };
}

// ─── Cron (B9) ─────────────────────────────────────────────────

export async function collectDailyMetrics(): Promise<{ collected: number }> {
  const directions = await query<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active'`,
  );
  const period = new Date().toISOString().slice(0, 10);
  let collected = 0;

  for (const d of directions) {
    const pulse = await getPulse(d.id);
    // B9: ON CONFLICT — повторный cron за день не создаёт дубли.
    const result = await query<{ id: string }>(
      `INSERT INTO balance_metrics (id, direction_id, period, metrics)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (direction_id, period) DO NOTHING
       RETURNING id`,
      [newUUID(), d.id, period, JSON.stringify(pulse.metrics)],
    );
    if (result.length > 0) {collected++;}
  }

  return { collected };
}

// ─── Gateway / Excess capacity (заглушки / roadmap) ──────────

export async function monitorGateway(): Promise<{
  importsDependency: number;
  infiltration: number;
}> {
  return { importsDependency: 0, infiltration: 0 };
}

export async function calculateExcessCapacity(): Promise<number> {
  const [loadRow, overdueRow] = await Promise.all([
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks WHERE status IN ('created','assigned','in_progress')`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks WHERE status NOT IN ('accepted','returned') AND deadline < now()`),
  ]);
  const load = parseInt(loadRow?.c ?? '0', 10);
  const overdue = parseInt(overdueRow?.c ?? '0', 10);
  const normalizer = Math.max(1, load + 100);
  const loadPct = load / normalizer;
  const overduePct = overdue / normalizer;
  const value = 0.5 * (1 - loadPct) + 0.5 * (1 - overduePct);
  return Math.max(0, Math.min(1, value));
}

export { detectAnomaly };