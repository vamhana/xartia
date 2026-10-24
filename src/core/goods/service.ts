// C.0.15.02 — Сервис благ
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: signProjectResourceService — signer = auth.participantId (было из body).
//   - B2: recordHistory + version++ в каждом мутации (было: history пуст, version=1).
//   - B3: lifecycle transitions — atomic UPDATE ... WHERE status = $orig.
//   - B4: addComponentService — jsonb append через `|| jsonb_build_array($new)` (было LWW).
//   - B5: liquidateGoodService — verifier_id проверяется на роль VERIFIER.
//   - B6: signProjectResourceService — проверка роли signer'а (council/balance/verifier).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - PATCH /goods/:id, POST /goods/:id/request — roadmap.
//   - POST /goods/:id/approve — без standard_id (spec drift, conscious).
//   - invalidateCache — заглушка (кэша нет).

import type { PoolClient } from 'pg';

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { hasRole, getEffectiveRoles } from '../../security/rbac.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID, GoodStatus, GoodType } from '../types.js';

import {
  createGood, addComponent, testGood, approveGood, liquidateGood,
  signProjectResource, isTripleSigned,
  type Good, type GoodComponent, type ProjectResource,
} from './entity.js';

interface GoodRow {
  id: string;
  name: string;
  type: GoodType;
  status: GoodStatus;
  producer_direction_id: string;
  components: GoodComponent[] | null;
  author_ids: string[] | null;
  connector_id: string | null;
  tester_id: string | null;
  approver_id: string | null;
  version: number;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToGood(row: GoodRow): Good {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    producerDirectionId: row.producer_direction_id,
    components: row.components ?? [],
    authorIds: row.author_ids ?? [],
    connectorId: row.connector_id,
    testerId: row.tester_id,
    approverId: row.approver_id,
    version: row.version,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// B2: transactional history write.
async function recordHistory(
  client: PoolClient,
  goodId: UUID,
  version: number,
  changes: Record<string, unknown>,
  authorId: UUID,
): Promise<void> {
  await client.query(
    `INSERT INTO good_history (id, good_id, version, changes, author_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [newUUID(), goodId, version, JSON.stringify(changes), authorId],
  );
}

// Возвращает первую строку или бросает ConflictError — без non-null assertion.
function firstRowOrConflict<T>(
  rows: T[],
  message = 'Изменено параллельно',
): T {
  const row = rows[0];
  if (!row) {
    throw new ConflictError(message);
  }
  return row;
}

export interface GoodFilter {
  status?: GoodStatus;
  type?: GoodType;
  producerDirectionId?: UUID;
  page?: number;
  perPage?: number;
}

export async function listGoods(
  filter: GoodFilter = {},
): Promise<{ data: Good[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
  if (filter.type) { params.push(filter.type); conditions.push(`type = $${params.length}`); }
  if (filter.producerDirectionId) {
    params.push(filter.producerDirectionId);
    conditions.push(`producer_direction_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM goods ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<GoodRow>(
    `SELECT id, name, type, status, producer_direction_id, components, author_ids,
            connector_id, tester_id, approver_id, version, description, created_at, updated_at
       FROM goods ${where}
      ORDER BY updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToGood), total };
}

export async function getById(goodId: UUID): Promise<Good> {
  const row = await queryOne<GoodRow>(
    `SELECT id, name, type, status, producer_direction_id, components, author_ids,
            connector_id, tester_id, approver_id, version, description, created_at, updated_at
       FROM goods WHERE id = $1`,
    [goodId],
  );
  if (!row) {throw new NotFoundError('Благо', goodId);}
  return rowToGood(row);
}

export interface CreateGoodRequest {
  name: string;
  type: GoodType;
  producerDirectionId: UUID;
  description?: string;
}

export async function createGoodService(
  input: CreateGoodRequest, requesterId: UUID,
): Promise<Good> {
  const entity = createGood({
    id: newUUID(),
    name: input.name,
    type: input.type,
    producerDirectionId: input.producerDirectionId,
    ...(input.description ? { description: input.description } : {}),
    authorId: requesterId,
  });

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO goods
         (id, name, type, status, producer_direction_id, components, author_ids,
          version, description)
       VALUES ($1, $2, $3, 'draft', $4, '[]'::jsonb, $5::jsonb, 1, $6)`,
      [
        entity.id, entity.name, entity.type, entity.producerDirectionId,
        JSON.stringify(entity.authorIds), entity.description,
      ],
    );
    await recordHistory(client, entity.id, 1, { created: { name: entity.name, type: entity.type } }, requesterId);
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.create', entityType: 'good', entityId: entity.id,
    newValue: { name: entity.name, type: entity.type },
  });

  return entity;
}

// B4: atomic jsonb append + history + version++.
export async function addComponentService(
  goodId: UUID, component: GoodComponent, requesterId: UUID,
): Promise<Good> {
  const good = await getById(goodId);
  if (good.status === 'liquidated') {
    throw new ConflictError('Благо ликвидировано — нельзя добавить компонент');
  }
  addComponent(good, component);  // entity-validate

  const upd = await transaction(async (client) => {
    const result = await client.query<{ version: number }>(
      `UPDATE goods
          SET components = components || jsonb_build_array($1::jsonb),
              author_ids = CASE
                WHEN author_ids @> $2::jsonb THEN author_ids
                ELSE author_ids || $2::jsonb
              END,
              version = version + 1,
              updated_at = now()
        WHERE id = $3 AND status = $4
        RETURNING version`,
      [JSON.stringify(component), JSON.stringify([component.authorId]), goodId, good.status],
    );
    const row = firstRowOrConflict(result.rows, 'Благо изменено параллельно');
    const version = row.version;
    await recordHistory(client, goodId, version, { added_component: component }, requesterId);
    return version;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.add_component', entityType: 'good', entityId: goodId,
    newValue: { part: component.part, version: upd },
  });

  return getById(goodId);
}

// B3: atomic lifecycle transitions (WHERE status).
export async function testGoodService(goodId: UUID, requesterId: UUID): Promise<Good> {
  const good = await getById(goodId);
  testGood(good, requesterId);  // entity-validate (draft → test)

  await transaction(async (client) => {
    const result = await client.query<{ version: number }>(
      `UPDATE goods
          SET status = 'test', tester_id = $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND status = $3
        RETURNING version`,
      [requesterId, goodId, good.status],
    );
    const row = firstRowOrConflict(result.rows, 'Благо изменено параллельно');
    await recordHistory(
      client, goodId, row.version,
      { status: { from: good.status, to: 'test' } }, requesterId,
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.test', entityType: 'good', entityId: goodId,
  });

  return getById(goodId);
}

export async function approveGoodService(goodId: UUID, requesterId: UUID): Promise<Good> {
  const good = await getById(goodId);
  approveGood(good, requesterId);  // entity-validate (test → active)

  await transaction(async (client) => {
    const result = await client.query<{ version: number }>(
      `UPDATE goods
          SET status = 'active', approver_id = $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND status = $3
        RETURNING version`,
      [requesterId, goodId, good.status],
    );
    const row = firstRowOrConflict(result.rows, 'Благо изменено параллельно');
    await recordHistory(
      client, goodId, row.version,
      { status: { from: good.status, to: 'active' } }, requesterId,
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.approve', entityType: 'good', entityId: goodId,
  });

  return getById(goodId);
}

// B5: verifier_id должен быть VERIFIER (или FIRST_ARCHITECT).
export async function liquidateGoodService(
  goodId: UUID, reason: string, verifierId: UUID, requesterId: UUID,
): Promise<Good> {
  const good = await getById(goodId);
  liquidateGood(good, reason, verifierId);  // entity-validate

  // B5: verifier должен иметь роль VERIFIER или быть FIRST_ARCHITECT.
  const isVerifier = await hasRole(verifierId, Role.VERIFIER);
  const isArch = await hasRole(verifierId, Role.FIRST_ARCHITECT);
  if (!isVerifier && !isArch) {
    throw new ValidationError(
      `verifier_id=${verifierId} не имеет роли VERIFIER или FIRST_ARCHITECT (I.1.5.6)`,
    );
  }

  await transaction(async (client) => {
    const result = await client.query<{ version: number }>(
      `UPDATE goods
          SET status = 'liquidated', version = version + 1, updated_at = now()
        WHERE id = $1 AND status = $2
        RETURNING version`,
      [goodId, good.status],
    );
    const row = firstRowOrConflict(result.rows, 'Благо изменено параллельно');
    await recordHistory(
      client, goodId, row.version,
      { status: { from: good.status, to: 'liquidated' }, reason, verifier_id: verifierId }, requesterId,
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.liquidate', entityType: 'good', entityId: goodId,
    newValue: { reason, verifier_id: verifierId },
  });

  return getById(goodId);
}

export async function getHistory(goodId: UUID): Promise<Array<{
  id: UUID; version: number; changes: Record<string, unknown>; authorId: UUID; createdAt: string;
}>> {
  const rows = await query<{
    id: string; version: number; changes: Record<string, unknown>;
    author_id: string; created_at: Date;
  }>(
    `SELECT id, version, changes, author_id, created_at
       FROM good_history WHERE good_id = $1 ORDER BY version DESC`,
    [goodId],
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    changes: r.changes,
    authorId: r.author_id,
    createdAt: r.created_at.toISOString(),
  }));
}

// -------- Проектные ресурсы --------

interface PRRow {
  id: string;
  plan_id: string;
  resource: Record<string, unknown>;
  council_sign: string | null;
  balance_sign: string | null;
  verifier_sign: string | null;
  status: 'pending' | 'signed' | 'issued' | 'returned';
  external_mark: boolean;
  created_at: Date;
  issued_at: Date | null;
}

function rowToPR(row: PRRow): ProjectResource {
  return {
    id: row.id,
    planId: row.plan_id,
    resource: row.resource,
    councilSign: row.council_sign,
    balanceSign: row.balance_sign,
    verifierSign: row.verifier_sign,
    status: row.status,
    externalMark: row.external_mark,
    createdAt: row.created_at.toISOString(),
    issuedAt: row.issued_at ? row.issued_at.toISOString() : null,
  };
}

export async function createProjectResourceService(
  planId: UUID, resource: Record<string, unknown>, requesterId: UUID,
): Promise<ProjectResource> {
  // Проверка plan existence (иначе FK → 500).
  const plan = await queryOne<{ id: string }>(
    `SELECT id FROM plans WHERE id = $1`,
    [planId],
  );
  if (!plan) {throw new NotFoundError('План', planId);}

  const id = newUUID();
  const rows = await query<PRRow>(
    `INSERT INTO project_resources (id, plan_id, resource, status, external_mark)
     VALUES ($1, $2, $3::jsonb, 'pending', false)
     RETURNING id, plan_id, resource, council_sign, balance_sign, verifier_sign,
               status, external_mark, created_at, issued_at`,
    [id, planId, JSON.stringify(resource)],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Не удалось создать проектный ресурс');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.create_project_resource', entityType: 'project_resource', entityId: id,
    newValue: { plan_id: planId },
  });

  return rowToPR(row);
}

// B1, B6: signer = requesterId; проверка роли signer'а.
const ROLE_TO_REQUIRED_ROLE: Record<'council' | 'balance' | 'verifier', Role> = {
  council: Role.COUNCIL_MEMBER,
  balance: Role.BALANCER,
  verifier: Role.VERIFIER,
};

export async function signProjectResourceService(
  resourceId: UUID,
  role: 'council' | 'balance' | 'verifier',
  requesterId: UUID,
): Promise<ProjectResource> {
  const row = await queryOne<PRRow>(
    `SELECT id, plan_id, resource, council_sign, balance_sign, verifier_sign,
            status, external_mark, created_at, issued_at
       FROM project_resources WHERE id = $1`,
    [resourceId],
  );
  if (!row) {throw new NotFoundError('Проектный ресурс', resourceId);}
  const pr = rowToPR(row);

  // B6: роль signer'а
  const isArch = await hasRole(requesterId, Role.FIRST_ARCHITECT);
  if (!isArch) {
    const requiredRole = ROLE_TO_REQUIRED_ROLE[role];
    const roles = await getEffectiveRoles(requesterId);
    if (!roles.includes(requiredRole)) {
      throw new ForbiddenError(
        `Подпись role='${role}' требует роль ${requiredRole}`,
        { required_role: requiredRole },
      );
    }
  }

  const updated = signProjectResource(pr, role, requesterId);
  const col = role === 'council' ? 'council_sign'
            : role === 'balance' ? 'balance_sign'
            : 'verifier_sign';

  // NEW: atomic UPDATE — только если эта подпись пуста И status='pending'.
  // Повторная подпись (любой роли) → 0 rows → 409.
  const result = await query<{ id: string }>(
    `UPDATE project_resources
        SET ${col} = $1, status = $2
      WHERE id = $3
        AND status = 'pending'
        AND ${col} IS NULL
      RETURNING id`,
    [requesterId, updated.status, resourceId],
  );
  if (result.length === 0) {
    // Диагностика — почему не обновилось.
    if (pr.status === 'signed') {
      throw new ConflictError('Проектный ресурс уже подписан (status=signed)');
    }
    const currentSign = role === 'council' ? pr.councilSign
                      : role === 'balance' ? pr.balanceSign
                      : pr.verifierSign;
    if (currentSign) {
      throw new ConflictError(
        `Подпись role='${role}' уже стоит (signer=${currentSign})`,
      );
    }
    throw new ConflictError('Проектный ресурс изменён параллельно');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'goods.sign_project_resource', entityType: 'project_resource', entityId: resourceId,
    newValue: { role, triple_signed: isTripleSigned(updated) },
  });

  return getById_Pr(resourceId);
}

async function getById_Pr(id: UUID): Promise<ProjectResource> {
  const row = await queryOne<PRRow>(
    `SELECT id, plan_id, resource, council_sign, balance_sign, verifier_sign,
            status, external_mark, created_at, issued_at
       FROM project_resources WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Проектный ресурс', id);}
  return rowToPR(row);
}

export async function isExternalMarked(resourceId: UUID): Promise<boolean> {
  const row = await queryOne<{ external_mark: boolean }>(
    `SELECT external_mark FROM project_resources WHERE id = $1`,
    [resourceId],
  );
  return row?.external_mark ?? false;
}

export async function invalidateCache(_goodId?: UUID): Promise<void> {
  // кэша нет — заглушка
}