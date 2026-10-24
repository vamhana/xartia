// N.0.01.04 — ИИ-обнаружение аномалий
// Скорость, формат, этикет, приоритет, итерации.
// Не командует — только сигнализирует (III.1.1).

import { detectAnomaly, type Anomaly, type AnomalyType } from '../core/balance/entity.js';
import type { UUID } from '../core/types.js';
import { query, queryOne } from '../lib/db.js';
import { logger } from '../lib/logger.js';

export interface AnomalyCandidate {
  type: AnomalyType;
  directionId: UUID;
  severity: number;
  evidence: Record<string, unknown>;
}

// -------- Speed anomaly --------
// Сравнение фактической скорости сигналов с нормативом.
// Порог: > 20% медленнее норматива.

const SPEED_DEVIATION_THRESHOLD = 0.20;

export async function checkSpeedAnomaly(directionId?: UUID): Promise<AnomalyCandidate[]> {
  const params: unknown[] = [];
  const whereDir = directionId
    ? (params.push(directionId), `AND s.lead_direction_id = $${params.length}`)
    : '';

  const rows = await query<{
    direction_id: string;
    priority: string;
    avg_seconds: string;
    deadline_ms: string;
    total: string;
  }>(
    `SELECT
       s.lead_direction_id AS direction_id,
       s.priority,
       AVG(EXTRACT(EPOCH FROM (r.created_at - s.created_at)))::text AS avg_seconds,
       ns.deadline_ms::text AS deadline_ms,
       COUNT(*)::text AS total
     FROM signals s
     JOIN responses r ON r.signal_id = s.id
     LEFT JOIN normative_speeds ns
       ON ns.priority = s.priority
       AND ns.version = (SELECT MAX(version) FROM normative_speeds WHERE priority = s.priority)
     WHERE s.created_at > now() - interval '7 days' ${whereDir}
     GROUP BY s.lead_direction_id, s.priority, ns.deadline_ms
     HAVING COUNT(*) >= 3`,
    params,
  );

  const result: AnomalyCandidate[] = [];
  for (const row of rows) {
    if (!row.direction_id || !row.deadline_ms) {continue;}
    const avgMs = parseFloat(row.avg_seconds) * 1000;
    const normMs = parseFloat(row.deadline_ms);
    if (avgMs <= normMs) {continue;}

    const deviation = (avgMs - normMs) / normMs;
    if (deviation < SPEED_DEVIATION_THRESHOLD) {continue;}

    const severity = Math.min(10, Math.round(5 + deviation * 10));
    result.push({
      type: 'speed',
      directionId: row.direction_id,
      severity,
      evidence: {
        priority: row.priority,
        avg_ms: Math.round(avgMs),
        norm_ms: normMs,
        deviation_pct: Math.round(deviation * 100),
        samples: parseInt(row.total, 10),
      },
    });
  }

  return result;
}

// -------- Format anomaly --------
// Доля возвратов по формату/этикету > 30%.

const FORMAT_RETURN_THRESHOLD = 0.30;

export async function checkFormatAnomaly(directionId: UUID): Promise<AnomalyCandidate[]> {
  const row = await queryOne<{ total: string; bad: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE format_ok = false OR etiquette_ok = false)::text AS bad
     FROM signal_attributes sa
     JOIN signals s ON s.id = sa.signal_id
     WHERE s.lead_direction_id = $1
       AND s.created_at > now() - interval '7 days'`,
    [directionId],
  );

  const total = parseInt(row?.total ?? '0', 10);
  const bad = parseInt(row?.bad ?? '0', 10);
  if (total < 5) {return [];}

  const ratio = bad / total;
  if (ratio < FORMAT_RETURN_THRESHOLD) {return [];}

  return [{
    type: 'format',
    directionId,
    severity: Math.min(10, Math.round(5 + ratio * 10)),
    evidence: { total, bad, ratio_pct: Math.round(ratio * 100) },
  }];
}

// -------- Priority anomaly --------
// Систематическое завышение приоритета > 30% critical/high.
// Проверяем за 7 дней.

const PRIORITY_OVERUSE_THRESHOLD = 0.30;

export async function checkPriorityAnomaly(directionId: UUID): Promise<AnomalyCandidate[]> {
  const row = await queryOne<{ total: string; critical: string; high: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE priority = 'critical')::text AS critical,
       COUNT(*) FILTER (WHERE priority = 'high')::text AS high
     FROM signals
     WHERE lead_direction_id = $1
       AND created_at > now() - interval '7 days'`,
    [directionId],
  );

  const total = parseInt(row?.total ?? '0', 10);
  if (total < 10) {return [];}

  const critical = parseInt(row?.critical ?? '0', 10);
  const high = parseInt(row?.high ?? '0', 10);
  const ratio = (critical + high) / total;
  if (ratio < PRIORITY_OVERUSE_THRESHOLD) {return [];}

  return [{
    type: 'priority',
    directionId,
    severity: Math.min(10, Math.round(5 + ratio * 8)),
    evidence: { total, critical, high, ratio_pct: Math.round(ratio * 100) },
  }];
}

// -------- Iteration anomaly --------
// Сигналы с iterations >= 3 — неясность ЗПО.

export async function checkIterationAnomaly(directionId: UUID): Promise<AnomalyCandidate[]> {
  const row = await queryOne<{ total: string; escalated: string }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE iterations >= 3)::text AS escalated
     FROM signals
     WHERE lead_direction_id = $1
       AND created_at > now() - interval '30 days'`,
    [directionId],
  );

  const total = parseInt(row?.total ?? '0', 10);
  const escalated = parseInt(row?.escalated ?? '0', 10);
  if (total < 5 || escalated < 3) {return [];}

  const ratio = escalated / total;
  return [{
    type: 'iteration',
    directionId,
    severity: Math.min(10, Math.round(4 + ratio * 15)),
    evidence: { total, escalated, ratio_pct: Math.round(ratio * 100) },
  }];
}

// -------- Запуск всех проверок --------

export async function detectAnomalies(directionId?: UUID): Promise<AnomalyCandidate[]> {
  const directions = directionId
    ? [directionId]
    : (await query<{ id: string }>(
        `SELECT id FROM directions WHERE status = 'active'`,
      )).map((r) => r.id);

  const all: AnomalyCandidate[] = [];

  // Speed — сразу по всем направлениям
  try {
    const speed = await checkSpeedAnomaly(directionId);
    all.push(...speed);
  } catch (e) {
    logger.warn({ err: e }, 'speed anomaly check failed');
  }

  for (const dirId of directions) {
    try {
      const [fmt, prio, iter] = await Promise.all([
        checkFormatAnomaly(dirId),
        checkPriorityAnomaly(dirId),
        checkIterationAnomaly(dirId),
      ]);
      all.push(...fmt, ...prio, ...iter);
    } catch (e) {
      logger.warn({ err: e, directionId: dirId }, 'anomaly checks failed for direction');
    }
  }

  return all;
}

// -------- Запись в БД --------

export async function persistAnomalies(candidates: AnomalyCandidate[]): Promise<Anomaly[]> {
  const persisted: Anomaly[] = [];
  for (const c of candidates) {
    const entity = detectAnomaly({
      type: c.type,
      directionId: c.directionId,
      severity: c.severity,
      details: c.evidence,
    });

    // Не дублируем открытые аномалии того же типа для того же направления
    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM anomalies
        WHERE type = $1 AND direction_id = $2 AND status <> 'resolved'
        LIMIT 1`,
      [c.type, c.directionId],
    );
    if (exists) {continue;}

    await query(
      `INSERT INTO anomalies (id, type, direction_id, severity, status, details)
       VALUES ($1, $2, $3, $4, 'new', $5)`,
      [entity.id, entity.type, entity.directionId, entity.severity, JSON.stringify(entity.details)],
    );
    persisted.push(entity);
  }
  return persisted;
}

// -------- Мета-запрос --------

export async function suggestMetaRequest(anomaly: Anomaly): Promise<{
  should_create: boolean;
  target_directions: UUID[];
}> {
  // При устойчивой аномалии (severity >= 7) — мета-запрос
  if (anomaly.severity < 7) {return { should_create: false, target_directions: [] };}

  // Целевые направления по типу аномалии
  const targets = await query<{ id: string; number: number }>(
    `SELECT id, number FROM directions WHERE number IN (6, 7, 5)`,
  );

  const targetIds = targets.map((t) => t.id);
  return { should_create: true, target_directions: targetIds };
}

// -------- Утилита для cron --------

export async function runDaily(): Promise<{ detected: number; persisted: number }> {
  const candidates = await detectAnomalies();
  const persisted = await persistAnomalies(candidates);
  return { detected: candidates.length, persisted: persisted.length };
}