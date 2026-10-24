// C.0.05.02 — Сервис мандатов
// Выдача, ротация, отзыв, делегирование, cooldown.
// Холодный период после завершения = сроку мандата (I.4.1.8).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { invalidateCache as invalidateRbacCache } from '../../security/rbac.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, CooldownError } from '../errors.js';
import { invalidateRightsMatrixCache } from '../rights.js';
import type { UUID, MandateStatus } from '../types.js';

import {
  createMandate, revoke, rotate, calculateCooldown, hasConflict, validateTerm,
  getTermPolicy, isActive,
  type Mandate, type Cooldown, type Delegation,
} from './entity.js';


interface MandateRow {
  id: string;
  function: string;
  direction_id: string | null;
  holder_id: string;
  granted_by: string;
  granted_at: Date;
  expires_at: Date;
  status: MandateStatus;
  conditions: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
}

function rowToMandate(row: MandateRow): Mandate {
  return {
    id: row.id,
    function: row.function,
    directionId: row.direction_id,
    holderId: row.holder_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
    conditions: row.conditions ?? {},
    scope: row.scope ?? {},
  };
}

// -------- Чтение --------

export interface MandateFilter {
  function?: string;
  directionId?: UUID;
  holderId?: UUID;
  status?: MandateStatus;
  page?: number;
  perPage?: number;
}

export async function listMandates(
  filter: MandateFilter = {},
): Promise<{ data: Mandate[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.function) { params.push(filter.function); conditions.push(`function = $${params.length}`); }
  if (filter.directionId) { params.push(filter.directionId); conditions.push(`direction_id = $${params.length}`); }
  if (filter.holderId) { params.push(filter.holderId); conditions.push(`holder_id = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM mandates ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<MandateRow>(
    `SELECT id, function, direction_id, holder_id, granted_by, granted_at,
            expires_at, status, conditions, scope
       FROM mandates
       ${where}
      ORDER BY
        CASE status WHEN 'active' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END,
        expires_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToMandate), total };
}

export async function getById(id: UUID): Promise<Mandate> {
  const row = await queryOne<MandateRow>(
    `SELECT id, function, direction_id, holder_id, granted_by, granted_at,
            expires_at, status, conditions, scope
       FROM mandates WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Мандат', id);}
  return rowToMandate(row);
}

export async function listDue(withinDays: number = 30): Promise<Mandate[]> {
  const rows = await query<MandateRow>(
    `SELECT id, function, direction_id, holder_id, granted_by, granted_at,
            expires_at, status, conditions, scope
       FROM mandates
      WHERE status = 'active'
        AND expires_at <= now() + ($1 || ' days')::interval
      ORDER BY expires_at ASC
      LIMIT 200`,
    [withinDays],
  );
  return rows.map(rowToMandate);
}

// -------- Создание --------

export interface CreateMandateRequest {
  function: string;
  holderId: UUID;
  directionId?: UUID;
  expiresAt: string;
  conditions?: Record<string, unknown>;
  scope?: Record<string, unknown>;
}

export async function createMandateService(
  input: CreateMandateRequest,
  requesterId: UUID,
): Promise<Mandate> {
  // 1. Проверка конфликтов ролей у holder
  const activeMandates = await query<{ function: string }>(
    `SELECT function FROM mandates WHERE holder_id = $1 AND status = 'active'`,
    [input.holderId],
  );
  for (const m of activeMandates) {
    if (hasConflict(m.function, input.function)) {
      throw new ConflictError(
        `Конфликт ролей: ${m.function} ↔ ${input.function}`,
        { current_function: m.function },
      );
    }
  }

  // 2. Проверка срока
  const termNumber = activeMandates.filter((m) => m.function === input.function).length + 1;
  const termCheck = validateTerm(input.function, termNumber);
  if (!termCheck.valid) {throw new ConflictError(termCheck.reason ?? 'Неверный срок');}

  // 3. Проверка cooldown
  const cooldownRow = await queryOne<{ valid_to: Date; reason: string }>(
    `SELECT valid_to, reason FROM cooldowns
      WHERE participant_id = $1 AND reason LIKE $2 AND valid_to > now()
      LIMIT 1`,
    [input.holderId, `rotation:${input.function}%`],
  );
  if (cooldownRow) {
    throw new CooldownError(
      `Участник в cooldown до ${cooldownRow.valid_to.toISOString()}`,
      { reason: cooldownRow.reason },
    );
  }

  // 4. Создание
  const entity = createMandate({
    id: newUUID(),
    function: input.function,
    holderId: input.holderId,
    grantedBy: requesterId,
    ...(input.directionId ? { directionId: input.directionId } : {}),
    expiresAt: input.expiresAt,
    ...(input.conditions ? { conditions: input.conditions } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  });

  await query(
    `INSERT INTO mandates
       (id, function, direction_id, holder_id, granted_by, expires_at, status, conditions, scope)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
    [
      entity.id, entity.function, entity.directionId, entity.holderId,
      entity.grantedBy, entity.expiresAt,
      JSON.stringify(entity.conditions ?? {}),
      JSON.stringify(entity.scope ?? {}),
    ],
  );

  await invalidateRbacCache(input.holderId);
  await invalidateRightsMatrixCache();

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'mandates.create', entityType: 'mandate', entityId: entity.id,
    newValue: { function: entity.function, holder_id: entity.holderId },
  });

  return entity;
}

// -------- Ротация --------

export async function rotateMandateService(
  mandateId: UUID,
  successorId: UUID,
  requesterId: UUID,
): Promise<{ old: Mandate; next: Mandate }> {
  const m = await getById(mandateId);
  if (m.status !== 'active') {throw new ConflictError(`Мандат ${m.status}`);}

  const { old, next } = rotate(m, successorId);

  await transaction(async (client) => {
    await client.query(
      `UPDATE mandates SET status = 'expired' WHERE id = $1`,
      [m.id],
    );
    await client.query(
      `INSERT INTO mandates
         (id, function, direction_id, holder_id, granted_by, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [next.id, next.function, next.directionId, next.holderId, next.grantedBy, next.expiresAt],
    );
    // Cooldown старому — только если политика роли его предусматривает
    const cd = calculateCooldown(m);
    if (cd) {
      await client.query(
        `INSERT INTO cooldowns (id, participant_id, reason, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5)`,
        [newUUID(), m.holderId, cd.reason, cd.validFrom, cd.validTo],
      );
    }
    // Rotation log
    await client.query(
      `INSERT INTO rotations (id, mandate_id, scheduled_at, executed_at, successor_id, status)
       VALUES ($1, $2, $3, now(), $4, 'executed')`,
      [newUUID(), m.id, next.expiresAt, successorId],
    );
  });

  await Promise.all([
    invalidateRbacCache(m.holderId),
    invalidateRbacCache(successorId),
  ]);
  await invalidateRightsMatrixCache();

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'mandates.rotate', entityType: 'mandate', entityId: m.id,
    oldValue: { holder_id: m.holderId },
    newValue: { successor_id: successorId },
  });

  return { old, next };
}

// -------- Отзыв --------

export async function revokeMandateService(
  mandateId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<Mandate> {
  const m = await getById(mandateId);
  const updated = revoke(m, reason);

  await transaction(async (client) => {
    await client.query(
      `UPDATE mandates SET status = 'revoked' WHERE id = $1`,
      [mandateId],
    );
    const cd = calculateCooldown(m);
    if (cd) {
      await client.query(
        `INSERT INTO cooldowns (id, participant_id, reason, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5)`,
        [newUUID(), m.holderId, cd.reason, cd.validFrom, cd.validTo],
      );
    }
  });

  await invalidateRbacCache(m.holderId);
  await invalidateRightsMatrixCache();

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'mandates.revoke', entityType: 'mandate', entityId: mandateId,
    newValue: { reason },
  });

  return updated;
}

// -------- Cooldown --------

interface CooldownRow {
  id: string;
  participant_id: string;
  reason: string;
  valid_from: Date;
  valid_to: Date;
}

export async function getActiveCooldowns(participantId: UUID): Promise<Cooldown[]> {
  const rows = await query<CooldownRow>(
    `SELECT id, participant_id, reason, valid_from, valid_to
       FROM cooldowns
      WHERE participant_id = $1 AND valid_to > now()
      ORDER BY valid_to ASC`,
    [participantId],
  );
  return rows.map((r) => ({
    id: r.id,
    participantId: r.participant_id,
    reason: r.reason,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to.toISOString(),
  }));
}

// -------- Автоматическая ротация (cron) --------

export async function processExpired(): Promise<{ rotated: number; cooldownsCreated: number }> {
  const expired = await query<MandateRow>(
    `SELECT id, function, direction_id, holder_id, granted_by, granted_at,
            expires_at, status, conditions, scope
       FROM mandates
      WHERE status = 'active' AND expires_at <= now()
      LIMIT 500`,
  );

  let rotated = 0;
  let cooldownsCreated = 0;

  for (const row of expired) {
    const m = rowToMandate(row);
    await transaction(async (client) => {
      await client.query(
        `UPDATE mandates SET status = 'expired' WHERE id = $1`,
        [m.id],
      );
      const cd = calculateCooldown(m);
      if (cd) {
        await client.query(
          `INSERT INTO cooldowns (id, participant_id, reason, valid_from, valid_to)
           VALUES ($1, $2, $3, $4, $5)`,
          [newUUID(), m.holderId, cd.reason, cd.validFrom, cd.validTo],
        );
        cooldownsCreated++;
      }
    });
    await invalidateRbacCache(m.holderId);
    rotated++;
  }

  // Матрица прав — глобальная, инвалидируется один раз на весь batch.
  if (rotated > 0) {
    await invalidateRightsMatrixCache();
  }

  return { rotated, cooldownsCreated };
}

// -------- Делегирование --------

interface DelegationRow {
  id: string;
  function: string;
  from_id: string;
  to_id: string;
  direction_id: string | null;
  scope: Record<string, unknown> | null;
  valid_from: Date;
  valid_to: Date;
  status: 'active' | 'revoked' | 'expired';
  revoked_at: Date | null;
  revoked_by: string | null;
}

function rowToDelegation(row: DelegationRow): Delegation {
  return {
    id: row.id,
    function: row.function,
    fromId: row.from_id,
    toId: row.to_id,
    directionId: row.direction_id,
    scope: row.scope ?? {},
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to.toISOString(),
    status: row.status,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    revokedBy: row.revoked_by,
  };
}

export async function listDelegations(filter: { fromId?: UUID; toId?: UUID } = {}): Promise<Delegation[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.fromId) { params.push(filter.fromId); conditions.push(`from_id = $${params.length}`); }
  if (filter.toId) { params.push(filter.toId); conditions.push(`to_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<DelegationRow>(
    `SELECT id, function, from_id, to_id, direction_id, scope,
            valid_from, valid_to, status, revoked_at, revoked_by
       FROM delegations ${where}
      ORDER BY valid_from DESC LIMIT 200`,
    params,
  );
  return rows.map(rowToDelegation);
}

export async function delegateService(
  input: {
    function: string;
    toId: UUID;
    directionId?: UUID;
    scope?: Record<string, unknown>;
    validTo: string;
  },
  requesterId: UUID,
): Promise<Delegation> {
  // Проверка: requesterId — активный держатель функции
  const held = await queryOne<{ id: string }>(
    `SELECT id FROM mandates
      WHERE holder_id = $1 AND function = $2 AND status = 'active' AND expires_at > now()
      LIMIT 1`,
    [requesterId, input.function],
  );
  if (!held) {throw new ConflictError(`Нет активного мандата ${input.function}`);}

  const id = newUUID();
  const validFrom = new Date().toISOString();
  if (new Date(input.validTo).getTime() <= new Date(validFrom).getTime()) {
    throw new ConflictError('validTo должен быть в будущем');
  }

  await query(
    `INSERT INTO delegations
       (id, function, from_id, to_id, direction_id, scope, valid_from, valid_to, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
    [
      id, input.function, requesterId, input.toId,
      input.directionId ?? null,
      JSON.stringify(input.scope ?? {}),
      validFrom, input.validTo,
    ],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'delegations.create', entityType: 'delegation', entityId: id,
    newValue: { function: input.function, to_id: input.toId },
  });

  const rows = await query<DelegationRow>(
    `SELECT id, function, from_id, to_id, direction_id, scope,
            valid_from, valid_to, status, revoked_at, revoked_by
       FROM delegations WHERE id = $1`,
    [id],
  );
  const first = rows[0];
  if (!first) {
    throw new Error('delegation row missing after insert');
  }
  return rowToDelegation(first);
}

export async function revokeDelegationService(
  delegationId: UUID,
  requesterId: UUID,
): Promise<void> {
  const row = await queryOne<{ id: string; from_id: string; status: string }>(
    `SELECT id, from_id, status FROM delegations WHERE id = $1`,
    [delegationId],
  );
  if (!row) {throw new NotFoundError('Делегирование', delegationId);}
  if (row.status !== 'active') {throw new ConflictError(`Уже ${row.status}`);}
  if (row.from_id !== requesterId) {throw new ConflictError('Только делегирующий может отозвать');}

  await query(
    `UPDATE delegations SET status = 'revoked', revoked_at = now(), revoked_by = $1
      WHERE id = $2`,
    [requesterId, delegationId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'delegations.revoke', entityType: 'delegation', entityId: delegationId,
  });
}

// Экспорт для тестов
export { isActive, getTermPolicy };