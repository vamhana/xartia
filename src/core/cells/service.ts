// C.0.04.02 — Сервис ячеек
// Дерево N×5, состав, роли. Создание, чтение, добавление/удаление.
// Обновление members_count — через триггер в БД (D.4.01.07).
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: инвалидация кэша дерева — по цепочке предков (было: только своя).
//   - B2: addMemberService проверяет participant.directionId === cell.directionId.
//   - B3: createCellService проверяет parent.directionId === input.directionId.
//   - B4: createCellService инвалидирует кэш предков (создание дочерней).
//   - B5: buildTree через WITH RECURSIVE — 1 запрос вместо N+1.
//   - B6: listCells — флаг rootsOnly для корней (parent_cell_id IS NULL).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - role_in_cell не проверяется на совместимость (с сервисом/направлением).
//   - updateCellService / deleteCellService — roadmap (PATCH/DELETE /cells/:id).

import { query, queryOne, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { redis } from '../../lib/redis.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import { createCell, getSize, type Cell, type CellRole, type CellMember } from './entity.js';

// -------- Типы --------

interface CellRow {
  id: string;
  level: number;
  number: string;
  profile: string | null;
  parent_cell_id: string | null;
  direction_id: string;
  members_count: number;
  created_at: Date;
}

interface CellMemberRow {
  id: string;
  cell_id: string;
  participant_id: string;
  role_in_cell: CellRole;
  valid_from: Date;
  valid_to: Date | null;
}

function rowToCell(row: CellRow): Cell {
  return {
    id: row.id,
    level: row.level,
    number: row.number,
    profile: row.profile,
    parentCellId: row.parent_cell_id,
    directionId: row.direction_id,
    membersCount: row.members_count,
    createdAt: row.created_at.toISOString(),
  };
}

function rowToMember(row: CellMemberRow): CellMember {
  return {
    id: row.id,
    cellId: row.cell_id,
    participantId: row.participant_id,
    roleInCell: row.role_in_cell,
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to ? row.valid_to.toISOString() : null,
  };
}

// -------- Инвалидация кэша дерева (B1, B4) --------
//
// При изменении в ячейке X устаревают все кэши предков X (включая X).
// Обход вверх по parent_cell_id. Depth ≤ 12 (max level) — дёшево.

async function invalidateTreeAncestors(cellId: UUID): Promise<void> {
  // WITH RECURSIVE — 1 запрос вместо N (обход вверх по parent_cell_id).
  // Depth ≤ 12 (max level), но защищено рекурсией на стороне БД.
  const rows: Array<{ id: string }> = await query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_cell_id FROM cells WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_cell_id
         FROM cells c
         JOIN ancestors a ON c.id = a.parent_cell_id
     )
     SELECT id FROM ancestors`,
    [cellId],
  );
  for (const r of rows) {
    await redis.del(`cell-tree:${r.id}`);
  }
}

// -------- Чтение --------

export interface CellFilter {
  directionId?: UUID;
  level?: number;
  parentCellId?: UUID;
  rootsOnly?: boolean;
}

export async function listCells(filter: CellFilter = {}): Promise<Cell[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.directionId) {
    params.push(filter.directionId);
    conditions.push(`direction_id = $${params.length}`);
  }
  if (filter.level !== undefined) {
    params.push(filter.level);
    conditions.push(`level = $${params.length}`);
  }
  if (filter.rootsOnly) {
    conditions.push('parent_cell_id IS NULL');
  } else if (filter.parentCellId) {
    params.push(filter.parentCellId);
    conditions.push(`parent_cell_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<CellRow>(
    `SELECT id, level, number, profile, parent_cell_id, direction_id,
            members_count, created_at
       FROM cells
       ${where}
      ORDER BY level DESC, number ASC`,
    params,
  );

  return rows.map(rowToCell);
}

export async function getById(cellId: UUID): Promise<Cell> {
  const row = await queryOne<CellRow>(
    `SELECT id, level, number, profile, parent_cell_id, direction_id,
            members_count, created_at
       FROM cells
      WHERE id = $1`,
    [cellId],
  );
  if (!row) {throw new NotFoundError('Ячейка', cellId);}
  return rowToCell(row);
}

export async function getMembers(cellId: UUID): Promise<CellMember[]> {
  const rows = await query<CellMemberRow>(
    `SELECT id, cell_id, participant_id, role_in_cell, valid_from, valid_to
       FROM cell_members
      WHERE cell_id = $1 AND valid_to IS NULL
      ORDER BY valid_from`,
    [cellId],
  );
  return rows.map(rowToMember);
}

export async function getChildren(cellId: UUID): Promise<Cell[]> {
  const rows = await query<CellRow>(
    `SELECT id, level, number, profile, parent_cell_id, direction_id,
            members_count, created_at
       FROM cells
      WHERE parent_cell_id = $1
      ORDER BY number`,
    [cellId],
  );
  return rows.map(rowToCell);
}

/**
 * Поддерево от rootCellId (плоский список, BFS-порядок).
 *
 * B5: один запрос WITH RECURSIVE вместо N+1 getById/getChildren.
 * Возвращает пустой массив, если rootCellId не существует — но контроллер
 * A.1.04.01 ожидает 404, поэтому здесь проверяем и бросаем NotFoundError.
 */
export async function buildTree(rootCellId: UUID): Promise<Cell[]> {
  const cacheKey = `cell-tree:${rootCellId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Cell[];
    } catch {
      // ignore
    }
  }

  const rows = await query<CellRow>(
    `WITH RECURSIVE tree AS (
       SELECT id, level, number, profile, parent_cell_id, direction_id,
              members_count, created_at
         FROM cells WHERE id = $1
       UNION ALL
       SELECT c.id, c.level, c.number, c.profile, c.parent_cell_id, c.direction_id,
              c.members_count, c.created_at
         FROM cells c
         JOIN tree t ON c.parent_cell_id = t.id
     )
     SELECT * FROM tree ORDER BY level DESC, number ASC`,
    [rootCellId],
  );

  if (rows.length === 0) {
    throw new NotFoundError('Ячейка', rootCellId);
  }

  const result = rows.map(rowToCell);
  await redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
  return result;
}

// -------- Создание --------

export interface CreateCellRequest {
  level: number;
  number: string;
  profile?: string;
  parentCellId?: UUID;
  directionId: UUID;
}

export async function createCellService(
  input: CreateCellRequest,
  requesterId: UUID,
): Promise<Cell> {
  // 1. Валидация через entity
  const entity = createCell({
    id: newUUID(),
    level: input.level,
    number: input.number,
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.parentCellId ? { parentCellId: input.parentCellId } : {}),
    directionId: input.directionId,
  });

  // 2. Проверка родителя: уровень + направление (B3)
  if (input.parentCellId) {
    const parent = await getById(input.parentCellId);
    if (parent.level !== input.level + 1) {
      throw new ValidationError(
        `Уровень родителя (${parent.level}) должен быть на 1 выше уровня ячейки (${input.level})`,
      );
    }
    if (parent.directionId !== input.directionId) {
      throw new ValidationError(
        `Родительская ячейка принадлежит другому направлению (${parent.directionId} != ${input.directionId})`,
      );
    }
  }

  // 3. INSERT
  try {
    await query(
      `INSERT INTO cells (id, level, number, profile, parent_cell_id, direction_id, members_count)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [
        entity.id,
        entity.level,
        entity.number,
        entity.profile,
        entity.parentCellId,
        entity.directionId,
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        `Ячейка уровня ${input.level} с номером ${input.number} уже существует`,
      );
    }
    throw e;
  }

  // 4. Инвалидация кэша предков (B4) — создание дочерней устаревает дерево корня.
  if (input.parentCellId) {
    await invalidateTreeAncestors(input.parentCellId);
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'cells.create',
    entityType: 'cell',
    entityId: entity.id,
    newValue: { level: entity.level, number: entity.number, direction_id: entity.directionId },
  });

  return entity;
}

// -------- Состав --------

export interface AddMemberRequest {
  participantId: UUID;
  roleInCell?: CellRole;
}

export async function addMemberService(
  cellId: UUID,
  input: AddMemberRequest,
  requesterId: UUID,
): Promise<CellMember> {
  const cell = await getById(cellId);
  const max = getSize(cell.level);

  // 1. Проверка размера
  if (cell.membersCount >= max) {
    throw new ConflictError(`Ячейка заполнена (${max} участников максимум)`);
  }

  // 2. Проверка: участник не в другой активной ячейке
  const existing = await queryOne<{ id: string; cell_id: string }>(
    `SELECT id, cell_id
       FROM cell_members
      WHERE participant_id = $1 AND valid_to IS NULL
      LIMIT 1`,
    [input.participantId],
  );
  if (existing) {
    throw new ConflictError('Участник уже состоит в ячейке', {
      cell_id: existing.cell_id,
    });
  }

  // 3. Проверка: участник существует
  const participant = await queryOne<{ id: string; direction_id: string }>(
    `SELECT id, direction_id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [input.participantId],
  );
  if (!participant) {throw new NotFoundError('Участник', input.participantId);}

  // 4. Проверка направления (B2): участник и ячейка — одно направление.
  if (participant.direction_id !== cell.directionId) {
    throw new ConflictError('Участник принадлежит другому направлению', {
      participant_direction_id: participant.direction_id,
      cell_direction_id: cell.directionId,
    });
  }

  // 5. INSERT — триггер обновит members_count
  const memberId = newUUID();
  const role: CellRole = input.roleInCell ?? 'member';
  await query(
    `INSERT INTO cell_members (id, cell_id, participant_id, role_in_cell)
     VALUES ($1, $2, $3, $4)`,
    [memberId, cellId, input.participantId, role],
  );

  // 6. Обновление participants.cell_id — быстрый доступ
  await query(
    `UPDATE participants SET cell_id = $1, updated_at = now() WHERE id = $2`,
    [cellId, input.participantId],
  );

  // 7. Инвалидация кэша предков (B1) — membersCount изменился.
  await invalidateTreeAncestors(cellId);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'cells.add_member',
    entityType: 'cell',
    entityId: cellId,
    newValue: { participant_id: input.participantId, role },
  });

  return {
    id: memberId,
    cellId,
    participantId: input.participantId,
    roleInCell: role,
    validFrom: new Date().toISOString(),
    validTo: null,
  };
}

export async function removeMemberService(
  cellId: UUID,
  participantId: UUID,
  requesterId: UUID,
): Promise<void> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM cell_members WHERE cell_id = $1 AND participant_id = $2 AND valid_to IS NULL`,
    [cellId, participantId],
  );
  if (!existing) {throw new NotFoundError('Активное членство');}

  await query(
    `UPDATE cell_members SET valid_to = now() WHERE id = $1`,
    [existing.id],
  );
  await query(
    `UPDATE participants SET cell_id = NULL, updated_at = now() WHERE id = $1`,
    [participantId],
  );

  // B1: инвалидация кэша предков.
  await invalidateTreeAncestors(cellId);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'cells.remove_member',
    entityType: 'cell',
    entityId: cellId,
    oldValue: { participant_id: participantId },
  });
}

/**
 * Инвалидация кэша дерева для cellId и всех предков.
 * Публичная функция для внешних потребителей (C.0.04.01, C.0.26.02).
 */
export async function invalidateCache(cellId?: UUID): Promise<void> {
  if (cellId) {
    await invalidateTreeAncestors(cellId);
  }
}