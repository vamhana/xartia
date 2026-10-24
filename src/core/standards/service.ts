// C.0.16.03 — Сервис стандартов + модификаторов

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';

import { createStandard, needsRevision, type Standard } from './entity.js';
import {
  requestModifier, approveModifier, rejectModifier, applyModifier,
  type Modifier, type ModifierStatus,
} from './modifier.js';

interface StandardRow {
  id: string;
  category: string;
  norm: string;
  version: number;
  published_at: Date;
  approved_by: string | null;
  deprecated_at: Date | null;
}

function rowToStandard(row: StandardRow): Standard {
  return {
    id: row.id,
    category: row.category,
    norm: parseFloat(row.norm),
    version: row.version,
    publishedAt: row.published_at.toISOString(),
    approvedBy: row.approved_by,
    deprecatedAt: row.deprecated_at ? row.deprecated_at.toISOString() : null,
  };
}

export async function listStandards(category?: string): Promise<Standard[]> {
  const params: unknown[] = [];
  const where = category
    ? (params.push(category), `WHERE category = $${params.length} AND deprecated_at IS NULL`)
    : `WHERE deprecated_at IS NULL`;
  const rows = await query<StandardRow>(
    `SELECT id, category, norm::text AS norm, version, published_at, approved_by, deprecated_at
       FROM standards ${where} ORDER BY category, version DESC`,
    params,
  );
  return rows.map(rowToStandard);
}

export async function getStandard(id: UUID): Promise<Standard> {
  const row = await queryOne<StandardRow>(
    `SELECT id, category, norm::text AS norm, version, published_at, approved_by, deprecated_at
       FROM standards WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Стандарт', id);}
  return rowToStandard(row);
}

export async function createStandardService(
  input: { category: string; norm: number }, requesterId: UUID,
): Promise<Standard> {
  const entity = createStandard({
    id: newUUID(), category: input.category, norm: input.norm, approvedBy: requesterId,
  });

  await query(
    `INSERT INTO standards (id, category, norm, version, approved_by)
     VALUES ($1, $2, $3, 1, $4)`,
    [entity.id, entity.category, entity.norm, requesterId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'standards.create', entityType: 'standard', entityId: entity.id,
    newValue: { category: entity.category, norm: entity.norm },
  });
  return entity;
}

export async function checkRevisionDue(): Promise<Standard[]> {
  const all = await listStandards();
  return all.filter((s) => needsRevision(s));
}

// -------- Модификаторы --------

interface ModRow {
  id: string;
  name: string;
  condition: Record<string, unknown>;
  coefficient: string;
  status: ModifierStatus;
  requested_by: string | null;
  approved_by: string | null;
  created_at: Date;
  resolved_at: Date | null;
  reason_rejected: string | null;
}

function rowToMod(row: ModRow): Modifier {
  return {
    id: row.id,
    name: row.name,
    condition: row.condition,
    coefficient: parseFloat(row.coefficient),
    status: row.status,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    reasonRejected: row.reason_rejected,
  };
}

export async function listModifiers(): Promise<Modifier[]> {
  const rows = await query<ModRow>(
    `SELECT id, name, condition, coefficient::text AS coefficient, status,
            requested_by, approved_by, created_at, resolved_at, reason_rejected
       FROM modifiers ORDER BY created_at DESC`,
  );
  return rows.map(rowToMod);
}

export async function requestModifierService(
  input: { name: string; condition: Record<string, unknown>; coefficient: number },
  requesterId: UUID,
): Promise<Modifier> {
  const entity = requestModifier({
    id: newUUID(), ...input, requestedBy: requesterId,
  });
  await query(
    `INSERT INTO modifiers (id, name, condition, coefficient, status, requested_by)
     VALUES ($1, $2, $3::jsonb, $4, 'pending', $5)`,
    [entity.id, entity.name, JSON.stringify(entity.condition), entity.coefficient, requesterId],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'standards.request_modifier', entityType: 'modifier', entityId: entity.id,
    newValue: { name: entity.name, coefficient: entity.coefficient },
  });
  return entity;
}

// B1: atomic UPDATE ... WHERE status = 'pending' + ConflictError.
export async function approveModifierService(
  id: UUID, requesterId: UUID,
): Promise<Modifier> {
  const m = await getModifier(id);
  if (m.status !== 'pending') {
    throw new ConflictError(`Модификатор уже ${m.status}`);   // ← 409, не 422
  }
  approveModifier(m, requesterId);  // entity-validate (defense-in-depth)

  const result = await query<{ id: string }>(
    `UPDATE modifiers
        SET status = 'active', approved_by = $1, resolved_at = now()
      WHERE id = $2 AND status = 'pending'
      RETURNING id`,
    [requesterId, id],
  );
  if (result.length === 0) {
    throw new ConflictError('Модификатор изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'standards.approve_modifier', entityType: 'modifier', entityId: id,
  });
  return getModifier(id);
}

// B2: atomic UPDATE ... WHERE status = 'pending' + ConflictError.
export async function rejectModifierService(
  id: UUID, reason: string, requesterId: UUID,
): Promise<Modifier> {
  const m = await getModifier(id);
  if (m.status !== 'pending') {
    throw new ConflictError(`Модификатор уже ${m.status}`);
  }
  rejectModifier(m, reason);

  const result = await query<{ id: string }>(
    `UPDATE modifiers
        SET status = 'rejected', reason_rejected = $1, resolved_at = now()
      WHERE id = $2 AND status = 'pending'
      RETURNING id`,
    [reason, id],
  );
  if (result.length === 0) {
    throw new ConflictError('Модификатор изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'standards.reject_modifier', entityType: 'modifier', entityId: id,
    newValue: { reason },
  });
  return getModifier(id);
}

async function getModifier(id: UUID): Promise<Modifier> {
  const row = await queryOne<ModRow>(
    `SELECT id, name, condition, coefficient::text AS coefficient, status,
            requested_by, approved_by, created_at, resolved_at, reason_rejected
       FROM modifiers WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Модификатор', id);}
  return rowToMod(row);
}

// B3: один запрос вместо listModifiers() + filter. Missing → 404.
export async function calculateEffectiveNorm(
  standardId: UUID, modifierIds: UUID[],
): Promise<number> {
  const standard = await getStandard(standardId);
  if (modifierIds.length === 0) {return standard.norm;}

  const rows = await query<ModRow>(
    `SELECT id, name, condition, coefficient::text AS coefficient, status,
            requested_by, approved_by, created_at, resolved_at, reason_rejected
       FROM modifiers
      WHERE id = ANY($1::uuid[]) AND status = 'active'`,
    [modifierIds],
  );
  const found = new Set(rows.map((r) => r.id));
  const missing = modifierIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new NotFoundError(
      `Модификаторы не найдены или не active: ${missing.join(', ')}`,
    );
  }

  return applyModifier(standard.norm, rows.map(rowToMod));
}

export async function invalidateCache(): Promise<void> {
  // Заглушка
}