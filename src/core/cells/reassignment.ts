// C.0.04.13 — Сигналы перестановки L0–L3.
//
// Уровни: 0 — координатор ячейки, 1 — координатор группы, 2 — Совет
// направления, 3 — Архитектор + Нология. Сигнал фиксирует причину,
// эскалацию и решение; история не удаляется.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

export type ReassignmentLevel = 0 | 1 | 2 | 3;
export type ReassignmentStatus = 'open' | 'escalated' | 'resolved' | 'rejected';

export interface ReassignmentSignal {
  id: UUID;
  level: ReassignmentLevel;
  cellId: UUID | null;
  taskId: UUID | null;
  directionId: UUID | null;
  reason: string;
  status: ReassignmentStatus;
  raisedBy: UUID;
  resolvedBy: UUID | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface Row {
  id: string;
  level: number;
  cell_id: string | null;
  task_id: string | null;
  direction_id: string | null;
  reason: string;
  status: string;
  raised_by: string;
  resolved_by: string | null;
  resolution: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

function toSignal(row: Row): ReassignmentSignal {
  return {
    id: row.id,
    level: row.level as ReassignmentLevel,
    cellId: row.cell_id,
    taskId: row.task_id,
    directionId: row.direction_id,
    reason: row.reason,
    status: row.status as ReassignmentStatus,
    raisedBy: row.raised_by,
    resolvedBy: row.resolved_by,
    resolution: row.resolution,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

export async function createReassignmentSignal(
  input: {
    level: number;
    reason: string;
    cellId?: UUID | null;
    taskId?: UUID | null;
    directionId?: UUID | null;
  },
  raisedBy: UUID,
): Promise<ReassignmentSignal> {
  if (!Number.isInteger(input.level) || input.level < 0 || input.level > 3) {
    throw new ValidationError('Уровень перестановки: 0..3');
  }
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new ValidationError('Причина: минимум 10 символов');
  }

  let directionId = input.directionId ?? null;
  if (input.cellId) {
    const cell = await queryOne<{ direction_id: string }>(
      `SELECT direction_id FROM cells WHERE id = $1`,
      [input.cellId],
    );
    if (!cell) {throw new NotFoundError('Ячейка', input.cellId);}
    directionId = directionId ?? cell.direction_id;
  }
  if (input.taskId) {
    const task = await queryOne<{ direction_id: string }>(
      `SELECT direction_id FROM tasks WHERE id = $1`,
      [input.taskId],
    );
    if (!task) {throw new NotFoundError('Задача', input.taskId);}
    directionId = directionId ?? task.direction_id;
  }

  const id = newUUID();
  const row = await queryOne<Row>(
    `INSERT INTO reassignment_signals
       (id, level, cell_id, task_id, direction_id, reason, raised_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, input.level, input.cellId ?? null, input.taskId ?? null,
     directionId, reason, raisedBy],
  );
  if (!row) {throw new ConflictError('Не удалось создать сигнал');}

  await logAction({
    actorId: raisedBy, actorType: 'participant',
    action: 'reassignment.raise', entityType: 'reassignment_signal', entityId: id,
    newValue: { level: input.level, cell_id: input.cellId ?? null, task_id: input.taskId ?? null },
  });

  return toSignal(row);
}

export async function listReassignmentSignals(filter: {
  status?: string;
  level?: number;
  cellId?: UUID;
  directionId?: UUID;
} = {}): Promise<ReassignmentSignal[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {params.push(filter.status); where.push(`status = $${params.length}`);}
  if (filter.level !== undefined) {params.push(filter.level); where.push(`level = $${params.length}`);}
  if (filter.cellId) {params.push(filter.cellId); where.push(`cell_id = $${params.length}`);}
  if (filter.directionId) {params.push(filter.directionId); where.push(`direction_id = $${params.length}`);}

  const rows = await query<Row>(
    `SELECT * FROM reassignment_signals
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT 200`,
    params,
  );
  return rows.map(toSignal);
}

export async function getReassignmentSignal(id: UUID): Promise<ReassignmentSignal> {
  const row = await queryOne<Row>(`SELECT * FROM reassignment_signals WHERE id = $1`, [id]);
  if (!row) {throw new NotFoundError('Сигнал перестановки', id);}
  return toSignal(row);
}

export async function escalateReassignmentSignal(
  id: UUID,
  actorId: UUID,
): Promise<ReassignmentSignal> {
  const current = await getReassignmentSignal(id);
  if (current.status === 'resolved' || current.status === 'rejected') {
    throw new ConflictError(`Сигнал уже ${current.status}`);
  }
  if (current.level >= 3) {
    throw new ConflictError('Сигнал уже на верхнем уровне (L3)');
  }
  const row = await queryOne<Row>(
    `UPDATE reassignment_signals
        SET level = level + 1, status = 'escalated', updated_at = now()
      WHERE id = $1 AND status IN ('open', 'escalated') AND level < 3
      RETURNING *`,
    [id],
  );
  if (!row) {throw new ConflictError('Сигнал изменён параллельно');}
  await logAction({
    actorId, actorType: 'participant',
    action: 'reassignment.escalate', entityType: 'reassignment_signal', entityId: id,
    newValue: { level: row.level },
  });
  return toSignal(row);
}

export async function resolveReassignmentSignal(
  id: UUID,
  resolution: string,
  actorId: UUID,
): Promise<ReassignmentSignal> {
  if (resolution.trim().length < 5) {
    throw new ValidationError('Решение: минимум 5 символов');
  }
  const row = await queryOne<Row>(
    `UPDATE reassignment_signals
        SET status = 'resolved', resolution = $2, resolved_by = $3,
            resolved_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('open', 'escalated')
      RETURNING *`,
    [id, resolution.trim(), actorId],
  );
  if (!row) {
    const current = await queryOne<{ status: string }>(
      `SELECT status FROM reassignment_signals WHERE id = $1`, [id],
    );
    if (!current) {throw new NotFoundError('Сигнал перестановки', id);}
    throw new ConflictError(`Сигнал уже ${current.status}`);
  }
  await logAction({
    actorId, actorType: 'participant',
    action: 'reassignment.resolve', entityType: 'reassignment_signal', entityId: id,
    newValue: { resolution },
  });
  return toSignal(row);
}

export async function rejectReassignmentSignal(
  id: UUID,
  reason: string,
  actorId: UUID,
): Promise<ReassignmentSignal> {
  const row = await queryOne<Row>(
    `UPDATE reassignment_signals
        SET status = 'rejected', resolution = $2, resolved_by = $3,
            resolved_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('open', 'escalated')
      RETURNING *`,
    [id, reason.trim(), actorId],
  );
  if (!row) {
    const current = await queryOne<{ status: string }>(
      `SELECT status FROM reassignment_signals WHERE id = $1`, [id],
    );
    if (!current) {throw new NotFoundError('Сигнал перестановки', id);}
    throw new ConflictError(`Сигнал уже ${current.status}`);
  }
  await logAction({
    actorId, actorType: 'participant',
    action: 'reassignment.reject', entityType: 'reassignment_signal', entityId: id,
    newValue: { reason },
  });
  return toSignal(row);
}
