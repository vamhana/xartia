// C.0.04.01 — Доменная сущность Ячейка N×5
// Иерархия: ячейка уровня N состоит из 5 ячеек уровня N-1.
// Чистые функции без побочных эффектов.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type CellRole =
  | 'member'
  | 'coordinator'
  | 'otc'
  | 'keeper'
  | 'liaison'
  | 'verifier'
  | 'balancer'
  | 'psy';

export interface Cell {
  id: UUID;
  level: number;
  number: string;
  profile: string | null;
  parentCellId: UUID | null;
  directionId: UUID;
  membersCount: number;
  createdAt: ISODateTime;
}

export interface CellMember {
  id: UUID;
  cellId: UUID;
  participantId: UUID;
  roleInCell: CellRole;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface CreateCellInput {
  id: UUID;
  level: number;
  number: string;
  profile?: string;
  parentCellId?: UUID;
  directionId: UUID;
}

// -------- Иерархия --------

/**
 * Размер ячейки уровня N.
 * level 0  → 5
 * level 1  → 25
 * level 2  → 125
 * ...
 * level 11 → 244_140_625
 */
export function getSize(level: number): number {
  if (level < 0 || level > 11) {
    throw new ValidationError('Уровень ячейки должен быть 0–11');
  }
  return 5 ** (level + 1);
}

export function createCell(input: CreateCellInput): Cell {
  if (input.level < 0 || input.level > 11) {
    throw new ValidationError('Уровень ячейки должен быть 0–11');
  }
  if (!input.number.trim()) {
    throw new ValidationError('Номер ячейки обязателен');
  }
  if (input.parentCellId && input.level === 0) {
    throw new ValidationError('Ячейка уровня 0 не может иметь родителя');
  }
  const now = new Date().toISOString();
  return {
    id: input.id,
    level: input.level,
    number: input.number.trim(),
    profile: input.profile ?? null,
    parentCellId: input.parentCellId ?? null,
    directionId: input.directionId,
    membersCount: 0,
    createdAt: now,
  };
}

export function getCellExternalId(cell: Cell): string {
  const base = `${cell.level}×5-${cell.number}`;
  return cell.profile ? `${base}-${cell.profile}` : base;
}

export function validateHierarchy(cells: Cell[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(cells.map((c) => [c.id, c]));

  for (const cell of cells) {
    if (cell.parentCellId) {
      const parent = byId.get(cell.parentCellId);
      if (!parent) {
        errors.push(`Ячейка ${cell.id}: родитель ${cell.parentCellId} не найден`);
        continue;
      }
      if (parent.level !== cell.level + 1) {
        errors.push(
          `Ячейка ${cell.id} (level ${cell.level}): родитель (level ${parent.level}) должен быть на 1 выше`,
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}


