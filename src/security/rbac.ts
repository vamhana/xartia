// S.0.01.03 — RBAC-модуль
// Загрузка ролей участника, кэш в Redis, проверка на основе роли + мандата.
// Интеграция с C.0.01.06 (rights) и C.0.05.02 (mandates).
//
// getEffectiveRoles возвращает роли, отсортированные по убыванию приоритета
// (старшая первая). Контракт: roles[0] — primaryRole для JWT и UI.
// Сортировка — через getRolePriority из C.0.01.01.

import { logAction } from '../core/audit.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../core/errors.js';
import { invalidateRightsMatrixCache } from '../core/rights.js';
import { Role, getConflicts, getRolePriority } from '../core/roles.js';
import type { UUID, ISODateTime } from '../core/types.js';
import { query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

// -------- Типы --------

export interface RoleAssignment {
  // id записи participant_roles (для ролей) или mandates.id (для мандатов).
  // Опционально — старые потребители могут его не читать.
  id?: UUID;
  role: Role;
  directionId: UUID | null;
  mandateId: UUID | null;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

interface RoleRow {
  assignment_id: string;
  role_name: string;
  direction_id: string | null;
  mandate_id: string | null;
  valid_from: Date;
  valid_to: Date | null;
}

// -------- Кэш --------

const CACHE_TTL_SEC = 60;
const cacheKey = (participantId: UUID): string => `roles:${participantId}`;

async function readFromCache(participantId: UUID): Promise<RoleAssignment[] | null> {
  const raw = await redis.get(cacheKey(participantId));
  if (!raw) {return null;}
  try {
    return JSON.parse(raw) as RoleAssignment[];
  } catch {
    return null;
  }
}

async function writeToCache(participantId: UUID, roles: RoleAssignment[]): Promise<void> {
  try {
    await redis.set(cacheKey(participantId), JSON.stringify(roles), 'EX', CACHE_TTL_SEC);
  } catch (e) {
    // Кэш не критичен: при сбое Redis продолжаем работать через БД.
    logger.warn({ err: e, participantId }, 'rbac: cache write failed');
  }
}

export async function invalidateCache(participantId?: UUID): Promise<void> {
  if (participantId) {
    await redis.del(cacheKey(participantId));
    return;
  }
  // Инвалидация всех — через SCAN
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'roles:*', 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) {await redis.del(...keys);}
  } while (cursor !== '0');
}

// -------- Загрузка из БД --------

async function loadFromDb(participantId: UUID): Promise<RoleAssignment[]> {
  // Роли через participant_roles (постоянные)
  const rows = await query<RoleRow>(
    `SELECT pr.id AS assignment_id,
            r.name AS role_name,
            pr.direction_id,
            NULL::uuid AS mandate_id,
            pr.valid_from,
            pr.valid_to
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
      UNION ALL
     SELECT m.id AS assignment_id,
            m.function AS role_name,
            m.direction_id,
            m.id AS mandate_id,
            m.granted_at AS valid_from,
            m.expires_at AS valid_to
       FROM mandates m
      WHERE m.holder_id = $1
        AND m.status = 'active'
        AND m.expires_at > now()`,
    [participantId],
  );

  const result: RoleAssignment[] = [];
  for (const row of rows) {
    if (!isRoleString(row.role_name)) {continue;}
    result.push({
      id: row.assignment_id,
      role: row.role_name,
      directionId: row.direction_id,
      mandateId: row.mandate_id,
      validFrom: row.valid_from.toISOString(),
      validTo: row.valid_to ? row.valid_to.toISOString() : null,
    });
  }
  return result;
}

function isRoleString(s: string): s is Role {
  return Object.values(Role).includes(s as Role);
}

// -------- Публичный API --------

export async function getRoles(participantId: UUID): Promise<RoleAssignment[]> {
  const cached = await readFromCache(participantId);
  if (cached) {return cached;}

  const fresh = await loadFromDb(participantId);
  await writeToCache(participantId, fresh);
  return fresh;
}

export async function hasRole(
  participantId: UUID,
  role: Role,
  directionId?: UUID,
): Promise<boolean> {
  const roles = await getRoles(participantId);
  return roles.some(
    (r) => r.role === role && (!directionId || r.directionId === directionId),
  );
}

export async function hasAnyRole(participantId: UUID, roles: Role[]): Promise<boolean> {
  const mine = await getRoles(participantId);
  const set = new Set(roles);
  return mine.some((r) => set.has(r.role));
}

export async function assertRole(participantId: UUID, role: Role): Promise<void> {
  if (!(await hasRole(participantId, role))) {
    throw new ForbiddenError(`Требуется роль ${role}`);
  }
}

export async function getEffectiveRoles(participantId: UUID): Promise<Role[]> {
  const roles = await getRoles(participantId);
  const unique = new Set<Role>();
  for (const r of roles) {unique.add(r.role);}
  // Сортировка по убыванию приоритета: effectiveRoles[0] — всегда старшая роль.
  // Контракт: JWT.primaryRole, UI-сортировка и любые «первая роль» читатели
  // получают детерминированное значение. Раньше порядок зависел от UNION ALL
  // в loadFromDb — то есть был недетерминированным.
  return Array.from(unique).sort((a, b) => getRolePriority(b) - getRolePriority(a));
}

export async function getActiveMandates(participantId: UUID): Promise<RoleAssignment[]> {
  const roles = await getRoles(participantId);
  return roles.filter((r) => r.mandateId !== null);
}

// -------- Мутации ролей --------

export interface AssignRoleInput {
  participantId: UUID;
  role: Role;
  directionId: UUID;
  grantedBy: UUID;
  validTo?: ISODateTime | null;
}

/**
 * Выдать участнику роль. Не создаёт мандат — для срочных ролей использовать
 * C.0.05.02 createMandateService (там TTL, cooldown, ROLE_CONFLICTS-политика).
 * Здесь — «постоянная» роль в participant_roles.
 */
export async function assignRole(input: AssignRoleInput): Promise<RoleAssignment> {
  const { participantId, role, directionId, grantedBy, validTo } = input;

  // 1. Конфликты с уже активными ролями
  const conflict = await checkRoleConflict(participantId, role);
  if (conflict.conflict) {
    throw new ConflictError(
      `Роль ${role} конфликтует с активной ролью ${conflict.with ?? '?'}`,
      { role, conflictWith: conflict.with },
    );
  }

  // 2. Найти role_id по (name, direction_id).
  // UNIQUE на (direction_id, name) нет — берём первую активную.
  const roleRow = await query<{ id: string }>(
    `SELECT id FROM roles
      WHERE name = $1 AND direction_id = $2 AND active = true
      LIMIT 1`,
    [role, directionId],
  );
  const roleId = roleRow[0]?.id;
  if (!roleId) {
    throw new NotFoundError('Role', `${role}@${directionId}`);
  }

  // 3. Дубликат активной записи
  const dup = await query<{ ok: number }>(
    `SELECT 1 AS ok
       FROM participant_roles
      WHERE participant_id = $1
        AND role_id = $2
        AND status = 'active'
        AND (valid_to IS NULL OR valid_to > now())
      LIMIT 1`,
    [participantId, roleId],
  );
  if (dup.length > 0) {
    throw new ConflictError(`Роль ${role} уже активна у участника`, {
      participantId,
      role,
    });
  }

  // 4. INSERT
  const inserted = await query<{
    id: string;
    valid_from: Date;
    valid_to: Date | null;
  }>(
    `INSERT INTO participant_roles
       (participant_id, role_id, direction_id, valid_to, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, valid_from, valid_to`,
    [participantId, roleId, directionId, validTo ?? null, grantedBy],
  );
  const row = inserted[0];
  if (!row) {
    throw new Error('assignRole: INSERT returned no rows');
  }

  // 5. Audit
  await logAction({
    actorId: grantedBy,
    actorType: 'participant',
    action: 'rbac.assign_role',
    entityType: 'participant',
    entityId: participantId,
    newValue: { role, directionId, validTo: validTo ?? null },
  });

  // 6. Инвалидация кэшей
  await invalidateCache(participantId);
  await invalidateRightsMatrixCache();

  return {
    id: row.id,
    role,
    directionId,
    mandateId: null,
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to ? row.valid_to.toISOString() : null,
  };
}

/**
 * Отозвать роль у участника. reason сохраняется в audit_log
 * (в самой participant_roles колонки reason нет).
 */
export async function revokeRole(
  participantId: UUID,
  role: Role,
  reason: string,
  revokedBy: UUID,
): Promise<void> {
  if (!reason || reason.trim().length === 0) {
    throw new ConflictError('Reason is required', { participantId, role });
  }

  const updated = await query<{
    id: string;
    direction_id: string | null;
  }>(
    `UPDATE participant_roles pr
        SET status = 'revoked', valid_to = now()
       FROM roles r
      WHERE pr.role_id = r.id
        AND pr.participant_id = $1
        AND r.name = $2
        AND pr.status = 'active'
      RETURNING pr.id, pr.direction_id`,
    [participantId, role],
  );
  const row = updated[0];
  if (!row) {
    throw new NotFoundError('Active role assignment', `${role}@${participantId}`);
  }

  await logAction({
    actorId: revokedBy,
    actorType: 'participant',
    action: 'rbac.revoke_role',
    entityType: 'participant',
    entityId: participantId,
    oldValue: { role, directionId: row.direction_id },
    reason,
  });

  await invalidateCache(participantId);
  await invalidateRightsMatrixCache();
}

// -------- Проверка конфликтов --------

export async function checkRoleConflict(
  participantId: UUID,
  newRole: Role,
): Promise<{ conflict: boolean; with?: Role }> {
  const existing = await getEffectiveRoles(participantId);
  const conflicts = getConflicts(newRole);
  for (const role of existing) {
    if (conflicts.includes(role)) {
      return { conflict: true, with: role };
    }
  }
  return { conflict: false };
}

// -------- Список участников с ролью --------

export async function listParticipantsWithRole(
  role: Role,
  directionId?: UUID,
): Promise<UUID[]> {
  const rows = directionId
    ? await query<{ participant_id: string }>(
        `SELECT pr.participant_id
           FROM participant_roles pr
           JOIN roles r ON r.id = pr.role_id
          WHERE r.name = $1
            AND pr.direction_id = $2
            AND pr.status = 'active'
            AND (pr.valid_to IS NULL OR pr.valid_to > now())`,
        [role, directionId],
      )
    : await query<{ participant_id: string }>(
        `SELECT pr.participant_id
           FROM participant_roles pr
           JOIN roles r ON r.id = pr.role_id
          WHERE r.name = $1
            AND pr.status = 'active'
            AND (pr.valid_to IS NULL OR pr.valid_to > now())`,
        [role],
      );
  return rows.map((r) => r.participant_id);
}

// Реэкспорт для удобства: инвалидация кэша прав при ротации мандатов.
// Импорт — наверху файла (см. блок imports), здесь только реэкспорт.
export { invalidateRightsMatrixCache };