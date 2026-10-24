// C.0.25.02 — Сервис Quanta.
// Кванты — минимальные автономные единицы развития (IV.3).
// Жизненный цикл: detected → audit → testing → scaling → active → cancelled.
//
// Интеграции:
//   - C.0.19.02 (Verification) — createAuditService для audit().
//   - C.0.20.02 (Archive)      — archiveService для document().
//   - C.0.18.02 (Balance)      — не используется напрямую:
//     detectPotential работает через ad-hoc SQL (см. комментарий).
// Все интеграции — dynamic import, best-effort.
//
// Техдолг закрыт (v0.0.02):
//   - B1: audit — atomic audit → testing (0 rows → 409).
//   - B2: audit — при сбое verification остаёмся в 'audit', не переходим.
//   - B3: audit — atomic detected → audit (0 rows → 409).
//   - B4: test — atomic UPDATE с проверкой status IN ('audit','testing').
//   - B5: scale — atomic UPDATE WHERE status='testing'.
//   - B6: stop — atomic UPDATE WHERE status != 'cancelled'.
//   - B7: apply — community existence + UNIQUE(quantum_id, community_id).
//   - B8: recordTest — FOR UPDATE внутри transaction (вне транзакции
//         блокировка снимается сразу после queryOne и не сериализует).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import {
  detectQuantum as entityDetectQuantum,
  auditQuantum as entityAuditQuantum,
  startTesting as entityStartTesting,
  testQuantum as entityTestQuantum,
  scaleQuantum as entityScaleQuantum,
  stopQuantum as entityStopQuantum,
  applyQuantum as entityApplyQuantum,
  recordTest as entityRecordTest,
  isReadyForScale as entityIsReadyForScale,
  validateCriteria,
  DETECT_THRESHOLD_PERCENT,
  type Quantum,
  type QuantumTest,
  type QuantumCatalogEntry,
  type QuantumStatus,
  type QuantumTestResult,
} from './entity.js';

// ─── Best-effort ─────────────────────────────────────────────────

async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `quanta: ${label} failed (best-effort)`);
  }
}

// ─── Row-mapping ─────────────────────────────────────────────────

interface QuantumRow {
  id: string;
  level: number;
  type: string;
  source_cell_id: string;
  description: string;
  area_of_applicability: Record<string, unknown>;
  limitations: Record<string, unknown>;
  success_criteria: Record<string, unknown>;
  stop_criteria: Record<string, unknown>;
  status: QuantumStatus;
  mandatory: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToQuantum(r: QuantumRow): Quantum {
  return {
    id: r.id,
    level: r.level,
    type: r.type,
    sourceCellId: r.source_cell_id,
    description: r.description,
    areaOfApplicability: r.area_of_applicability ?? {},
    limitations: r.limitations ?? {},
    successCriteria: r.success_criteria ?? {},
    stopCriteria: r.stop_criteria ?? {},
    status: r.status,
    mandatory: r.mandatory,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface QuantumTestRow {
  id: string;
  quantum_id: string;
  cell_id: string;
  result: QuantumTestResult;
  notes: string | null;
  created_at: Date;
}

function rowToQuantumTest(r: QuantumTestRow): QuantumTest {
  return {
    id: r.id,
    quantumId: r.quantum_id,
    cellId: r.cell_id,
    result: r.result,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
  };
}

interface CatalogRow {
  quantum_id: string;
  community_id: string;
  applied: boolean;
  applied_at: Date | null;
}

function rowToCatalogEntry(r: CatalogRow): QuantumCatalogEntry {
  return {
    quantumId: r.quantum_id,
    communityId: r.community_id,
    applied: r.applied,
    appliedAt: r.applied_at ? r.applied_at.toISOString() : null,
  };
}

const QUANTUM_COLS = `
  id, level, type, source_cell_id, description,
  area_of_applicability, limitations, success_criteria, stop_criteria,
  status, mandatory, created_at, updated_at
`;

// ─── list / get ──────────────────────────────────────────────────

export interface QuantumFilter {
  level?: number;
  status?: QuantumStatus;
  mandatory?: boolean;
  page?: number;
  perPage?: number;
}

export async function list(
  filter: QuantumFilter = {},
  _requesterId?: UUID,
): Promise<Quantum[]> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.level !== undefined) {
    params.push(filter.level);
    cond.push(`level = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    cond.push(`status = $${params.length}`);
  }
  if (filter.mandatory !== undefined) {
    params.push(filter.mandatory);
    cond.push(`mandatory = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  params.push(perPage, offset);
  const rows = await query<QuantumRow>(
    `SELECT ${QUANTUM_COLS}
       FROM quanta
       ${where}
      ORDER BY
        CASE status
          WHEN 'detected' THEN 1 WHEN 'audit' THEN 2
          WHEN 'testing' THEN 3 WHEN 'scaling' THEN 4
          WHEN 'active' THEN 5 ELSE 6
        END,
        created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToQuantum);
}

export async function get(
  quantumId: UUID,
  _requesterId: UUID,
): Promise<Quantum> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}
  return rowToQuantum(row);
}

export async function listMandatory(): Promise<Quantum[]> {
  const rows = await query<QuantumRow>(
    `SELECT ${QUANTUM_COLS}
       FROM quanta
      WHERE mandatory = true
        AND status IN ('active', 'scaling')
      ORDER BY level ASC, created_at DESC`,
  );
  return rows.map(rowToQuantum);
}

// ─── create (обнаружение) ────────────────────────────────────────

export interface CreateQuantumInput {
  level: number;
  type: string;
  sourceCellId: UUID;
  description: string;
  areaOfApplicability?: Record<string, unknown>;
  limitations?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
  stopCriteria?: Record<string, unknown>;
  mandatory?: boolean;
}

export async function create(
  input: CreateQuantumInput,
  requesterId: UUID,
): Promise<Quantum> {
  const entity = entityDetectQuantum({
    id: newUUID(),
    level: input.level,
    type: input.type,
    sourceCellId: input.sourceCellId,
    description: input.description,
    ...(input.areaOfApplicability
      ? { areaOfApplicability: input.areaOfApplicability }
      : {}),
    ...(input.limitations ? { limitations: input.limitations } : {}),
    ...(input.successCriteria ? { successCriteria: input.successCriteria } : {}),
    ...(input.stopCriteria ? { stopCriteria: input.stopCriteria } : {}),
    ...(input.mandatory !== undefined ? { mandatory: input.mandatory } : {}),
  });

  // Проверка cell существует.
  const cell = await queryOne<{ id: string }>(
    `SELECT id FROM cells WHERE id = $1`,
    [entity.sourceCellId],
  );
  if (!cell) {
    throw new ValidationError('source_cell_id не существует');
  }

  await query(
    `INSERT INTO quanta
       (id, level, type, source_cell_id, description,
        area_of_applicability, limitations, success_criteria, stop_criteria,
        status, mandatory)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
             'detected', $10)`,
    [
      entity.id,
      entity.level,
      entity.type,
      entity.sourceCellId,
      entity.description,
      JSON.stringify(entity.areaOfApplicability),
      JSON.stringify(entity.limitations),
      JSON.stringify(entity.successCriteria),
      JSON.stringify(entity.stopCriteria),
      entity.mandatory,
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.create',
    entityType: 'quantum',
    entityId: entity.id,
    newValue: {
      level: entity.level,
      type: entity.type,
      source_cell_id: entity.sourceCellId,
    },
  });

  return entity;
}

// ─── audit ───────────────────────────────────────────────────────

export async function audit(
  quantumId: UUID,
  requesterId: UUID,
): Promise<Quantum> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const afterAudit = entityAuditQuantum(rowToQuantum(row));

  // B3: atomic detected → audit.
  const r1 = await query<{ id: string }>(
    `UPDATE quanta SET status = 'audit', updated_at = now()
      WHERE id = $1 AND status = 'detected'
      RETURNING id`,
    [quantumId],
  );
  if (r1.length === 0) {
    throw new ConflictError('Квант уже не в статусе detected (race)');
  }

  // B2: если аудит в Verification упал — остаёмся в 'audit', не переходим.
  let auditId: UUID | null = null;
  try {
    const { createAuditService } = await import('../verification/service.js');
    const a = await createAuditService(
      { type: 'planned', subject: 'quantum', subjectId: quantumId },
      requesterId,
    );
    auditId = a.id;
  } catch (e) {
    logger.warn({ err: e, quantumId }, 'quanta.audit: verification failed, остаёмся в audit');
    await logAction({
      actorId: requesterId, actorType: 'participant',
      action: 'quanta.audit', entityType: 'quantum', entityId: quantumId,
      newValue: { audit_id: null, new_status: 'audit', reason: 'verification_failed' },
    });
    return afterAudit; // status='audit'
  }

  // B1: atomic audit → testing.
  const r2 = await query<{ id: string }>(
    `UPDATE quanta SET status = 'testing', updated_at = now()
      WHERE id = $1 AND status = 'audit'
      RETURNING id`,
    [quantumId],
  );
  if (r2.length === 0) {
    throw new ConflictError('Квант уже не в статусе audit (race)');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'quanta.audit', entityType: 'quantum', entityId: quantumId,
    newValue: { audit_id: auditId, new_status: 'testing' },
  });

  return entityStartTesting(afterAudit);
}

// ─── test (валидация ячеек) ──────────────────────────────────────

export async function test(
  quantumId: UUID,
  cellIds: UUID[],
  requesterId: UUID,
): Promise<Quantum> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const entity = entityTestQuantum(rowToQuantum(row), cellIds);

  // Проверка, что все cellIds существуют.
  const found = await query<{ id: string }>(
    `SELECT id FROM cells WHERE id = ANY($1::uuid[])`,
    [cellIds],
  );
  if (found.length !== cellIds.length) {
    throw new ValidationError(
      `Некоторые cell_ids не найдены (найдено ${found.length} из ${cellIds.length})`,
    );
  }

  // B4: atomic UPDATE с проверкой status.
  const r = await query<{ id: string }>(
    `UPDATE quanta SET status = 'testing', updated_at = now()
      WHERE id = $1 AND status IN ('audit', 'testing')
      RETURNING id`,
    [quantumId],
  );
  if (r.length === 0) {
    throw new ConflictError('Квант не в audit/testing (race)');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.test_started',
    entityType: 'quantum',
    entityId: quantumId,
    newValue: { cells: cellIds },
  });

  return entity;
}

// ─── test-record ─────────────────────────────────────────────────

export async function recordTest(
  quantumId: UUID,
  cellId: UUID,
  result: QuantumTestResult,
  notes: string | undefined,
  requesterId: UUID,
): Promise<QuantumTest> {
  // B8: FOR UPDATE работает только внутри транзакции — вне её блокировка
  // снимается сразу после queryOne и параллельные recordTest не сериализуются.
  // Поэтому lock + проверка status + INSERT — в одной транзакции.
  const entity = await transaction(async (client) => {
    const lock = await client.query<{ id: string; status: QuantumStatus }>(
      `SELECT id, status FROM quanta WHERE id = $1 FOR UPDATE`,
      [quantumId],
    );
    const lockRow = lock.rows[0];
    if (!lockRow) {throw new NotFoundError('Квант', quantumId);}
    if (lockRow.status !== 'testing') {
      throw new ConflictError(
        `Квант в статусе '${lockRow.status}' — запись теста недоступна`,
      );
    }

    const cell = await client.query<{ id: string }>(
      `SELECT id FROM cells WHERE id = $1`,
      [cellId],
    );
    if (cell.rows.length === 0) {
      throw new ValidationError('cell_id не существует');
    }

    const ent = entityRecordTest(quantumId, cellId, result, notes ?? null);

    await client.query(
      `INSERT INTO quantum_tests (id, quantum_id, cell_id, result, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [ent.id, ent.quantumId, ent.cellId, ent.result, ent.notes],
    );

    return ent;
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.test_recorded',
    entityType: 'quantum_test',
    entityId: entity.id,
    newValue: {
      quantum_id: quantumId,
      cell_id: cellId,
      result: entity.result,
    },
  });

  return entity;
}

// ─── isReadyForScale ────────────────────────────────────────────

export async function isReadyForScale(
  quantumId: UUID,
): Promise<{ allowed: boolean; reason?: string }> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const tests = await query<QuantumTestRow>(
    `SELECT id, quantum_id, cell_id, result, notes, created_at
       FROM quantum_tests WHERE quantum_id = $1`,
    [quantumId],
  );

  return entityIsReadyForScale(rowToQuantum(row), tests.map(rowToQuantumTest));
}

// ─── scale ───────────────────────────────────────────────────────

export async function scale(
  quantumId: UUID,
  requesterId: UUID,
): Promise<Quantum> {
  const readiness = await isReadyForScale(quantumId);
  if (!readiness.allowed) {
    throw new ConflictError(
      readiness.reason ?? 'Квант не готов к масштабированию',
    );
  }

  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const entity = entityScaleQuantum(rowToQuantum(row));

  // B5: atomic.
  const r = await query<{ id: string }>(
    `UPDATE quanta SET status = 'scaling', updated_at = now()
      WHERE id = $1 AND status = 'testing'
      RETURNING id`,
    [quantumId],
  );
  if (r.length === 0) {
    throw new ConflictError('Квант не в testing (race)');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.scale',
    entityType: 'quantum',
    entityId: quantumId,
  });

  return entity;
}

// ─── stop ────────────────────────────────────────────────────────

export async function stop(
  quantumId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<Quantum> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const entity = entityStopQuantum(rowToQuantum(row), reason);

  // B6: atomic.
  const r = await query<{ id: string }>(
    `UPDATE quanta SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND status != 'cancelled'
      RETURNING id`,
    [quantumId],
  );
  if (r.length === 0) {
    throw new ConflictError('Квант уже отменён (race)');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.stop',
    entityType: 'quantum',
    entityId: quantumId,
    newValue: { reason },
  });

  return entity;
}

// ─── document ────────────────────────────────────────────────────

export async function document(
  quantumId: UUID,
  requesterId: UUID,
): Promise<{ documented: boolean; documentId?: UUID }> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const q = rowToQuantum(row);

  // Получить direction_id через source_cell_id.
  const cellRow = await queryOne<{ direction_id: string }>(
    `SELECT direction_id FROM cells WHERE id = $1`,
    [q.sourceCellId],
  );
  if (!cellRow) {
    throw new ValidationError('source_cell_id не найден в cells');
  }

  let documentId: UUID | undefined;

  await bestEffort('archive.archiveService', async () => {
    const { archiveService } = await import('../archive/service.js');
    const doc = await archiveService(
      {
        type: 'protocol',
        directionId: cellRow.direction_id,
        subject: `Quantum L${q.level}: ${q.type}`,
        content: {
          quantumId: q.id,
          level: q.level,
          type: q.type,
          description: q.description,
          areaOfApplicability: q.areaOfApplicability,
          limitations: q.limitations,
          successCriteria: q.successCriteria,
          stopCriteria: q.stopCriteria,
          status: q.status,
          mandatory: q.mandatory,
        },
      },
      requesterId,
    );
    documentId = doc.id;
  });

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.document',
    entityType: 'quantum',
    entityId: quantumId,
    newValue: { document_id: documentId ?? null },
  });

  return { documented: documentId !== undefined, ...(documentId ? { documentId } : {}) };
}

// ─── apply ───────────────────────────────────────────────────────

export async function apply(
  quantumId: UUID,
  communityId: UUID,
  requesterId: UUID,
): Promise<QuantumCatalogEntry> {
  const row = await queryOne<QuantumRow>(
    `SELECT ${QUANTUM_COLS} FROM quanta WHERE id = $1`,
    [quantumId],
  );
  if (!row) {throw new NotFoundError('Квант', quantumId);}

  const entity = entityApplyQuantum(rowToQuantum(row), communityId);

  // B7: community existence.
  const c = await queryOne<{ id: string }>(
    `SELECT id FROM communities WHERE id = $1`,
    [communityId],
  ).catch(() => null);
  if (!c) {throw new NotFoundError('Община', communityId);}

  // B7: INSERT ... ON CONFLICT требует UNIQUE на (quantum_id, community_id).
  // Если миграции нет — PostgreSQL вернёт 42P10; переводим в ValidationError.
  try {
    await query(
      `INSERT INTO quantum_catalog (id, quantum_id, community_id, applied, applied_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (quantum_id, community_id)
       DO UPDATE SET applied = true, applied_at = now()`,
      [newUUID(), entity.quantumId, entity.communityId],
    );
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === '42P10' || /no unique or exclusion constraint/i.test(err.message ?? '')) {
      throw new ValidationError(
        'Таблица quantum_catalog не имеет UNIQUE(quantum_id, community_id) — нужна миграция',
      );
    }
    throw e;
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'quanta.apply',
    entityType: 'quantum_catalog',
    entityId: quantumId,
    newValue: { community_id: communityId },
  });

  return entity;
}

// ─── getCatalog ──────────────────────────────────────────────────

export interface CatalogFilter {
  communityId?: UUID;
  applied?: boolean;
}

export async function getCatalog(
  filter: CatalogFilter = {},
): Promise<QuantumCatalogEntry[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.communityId) {
    params.push(filter.communityId);
    cond.push(`community_id = $${params.length}`);
  }
  if (filter.applied !== undefined) {
    params.push(filter.applied);
    cond.push(`applied = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const rows = await query<CatalogRow>(
    `SELECT quantum_id, community_id, applied, applied_at
       FROM quantum_catalog
       ${where}
      ORDER BY applied_at DESC NULLS LAST
      LIMIT 500`,
    params,
  );
  return rows.map(rowToCatalogEntry);
}

// ─── detectPotential ─────────────────────────────────────────────
//
// «Эффективность ячейки» — доля принятых задач (tasks.status='accepted')
// среди задач, назначенных участникам этой ячейки, за последние 30 дней.
// Кандидат — ячейка с efficiency > average * 1.30 (DETECT_THRESHOLD_PERCENT).
//
// Ad-hoc SQL: в C.0.18.02 Balance метрики хранятся по направлениям, а не
// по ячейкам. Готового метода нет — считаем здесь.
//
// Best-effort: если ячеек нет или у них нет задач — возвращаем [].

export interface DetectCandidate {
  cellId: UUID;
  advantage: number;
}

export async function detectPotential(): Promise<DetectCandidate[]> {
  const rows = await query<{
    cell_id: string;
    accepted: string;
    total: string;
  }>(
    `SELECT
       cm.cell_id,
       COUNT(*) FILTER (WHERE t.status = 'accepted')::text AS accepted,
       COUNT(*)::text AS total
     FROM cell_members cm
     JOIN tasks t ON t.assigned_to = cm.participant_id
     WHERE cm.valid_to IS NULL
       AND t.created_at > now() - interval '30 days'
     GROUP BY cm.cell_id
     HAVING COUNT(*) >= 3`,
  );

  if (rows.length === 0) {return [];}

  // Рассчитываем эффективность для каждой ячейки.
  const efficiencies = rows.map((r) => {
    const accepted = parseInt(r.accepted, 10);
    const total = parseInt(r.total, 10);
    return { cellId: r.cell_id, efficiency: total > 0 ? accepted / total : 0 };
  });

  const average =
    efficiencies.reduce((s, e) => s + e.efficiency, 0) / efficiencies.length;
  const threshold = average * (1 + DETECT_THRESHOLD_PERCENT / 100);

  return efficiencies
    .filter((e) => e.efficiency > threshold && average > 0)
    .map((e) => ({
      cellId: e.cellId,
      advantage: Math.round(((e.efficiency - average) / average) * 10000) / 100,
    }))
    .sort((a, b) => b.advantage - a.advantage);
}

// ─── processDaily (cron) ─────────────────────────────────────────

export async function processDaily(): Promise<{
  candidates: number;
  created: number;
}> {
  let candidates: DetectCandidate[] = [];
  try {
    candidates = await detectPotential();
  } catch (e) {
    logger.warn({ err: e }, 'quanta.processDaily: detectPotential failed');
  }

  // Автосоздание квантов не делаем: обнаружение — задача оператора
  // (BALANCER/NOOLOG), а не автоматики. Здесь только фиксируем кандидатов.
  // Если понадобится auto-create — отдельная задача с ручной проверкой.

  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'quanta.process_daily',
    entityType: 'quantum_batch',
    entityId: newUUID(),
    newValue: { candidates: candidates.length, created: 0 },
  });

  return { candidates: candidates.length, created: 0 };
}

// ─── Экспорт для контроллера ─────────────────────────────────────

export { validateCriteria, DETECT_THRESHOLD_PERCENT };