// C.0.24.02 — Сервис Шлюза.
// Совет, сделки, активы, Гарант, Свидетели, оборона, роспуск.
//
// Техдолг закрыт (v0.0.02):
//   - B1: addCouncilMember — transaction + advisory lock.
//   - B2: rotateCouncilMember — atomic UPDATE.
//   - B3: approveTransaction — atomic UPDATE.
//   - B4: auditTransaction — проверка status.
//   - B5: convertAsset — atomic UPDATE.
//   - B6: appointGuarantor — transaction + advisory lock.
//   - B7: expireGuarantor — atomic UPDATE RETURNING.
//   - B8: establishWitness — transaction + advisory lock.
//   - B10: getSelfSufficiency — правильные метрики (dependencyYears).
//   - B11: dissolve — entityId = requesterId (gateway — не сущность БД).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createCouncilMember,
  createTransaction as createTransactionEntity,
  createExternalAsset,
  createGuarantor, createWitness, createDefense,
  isExternalMark, canDissolveGateway,
  GATEWAY_CONSTANTS,
  type GatewayCouncilMember, type GatewayTransaction,
  type ExternalAsset, type Guarantor, type ExternalWitness,
  type ExternalDefense, type DefenseType, type GatewayTxType,
  type ExternalAssetType,
} from './entity.js';

// ─── Row-mappers ─────────────────────────────────────────────────

interface CouncilRow {
  id: string;
  member_id: string;
  valid_from: Date;
  valid_to: Date;
  term_number: number;
  created_at: Date;
}

function rowToCouncil(r: CouncilRow): GatewayCouncilMember {
  return {
    id: r.id,
    memberId: r.member_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to.toISOString(),
    termNumber: r.term_number,
    createdAt: r.created_at.toISOString(),
  };
}

interface TxRow {
  id: string;
  type: GatewayTxType;
  description: string;
  amount_external: string | null;
  resource_type: string | null;
  approved_by: string | null;
  audited_by: string | null;
  classified_until: Date | null;
  status: 'pending' | 'approved' | 'completed' | 'rejected';
  created_at: Date;
  completed_at: Date | null;
}

function rowToTx(r: TxRow): GatewayTransaction {
  return {
    id: r.id,
    type: r.type,
    description: r.description,
    amountExternal: r.amount_external ? parseFloat(r.amount_external) : null,
    resourceType: r.resource_type,
    approvedBy: r.approved_by,
    auditedBy: r.audited_by,
    classifiedUntil: r.classified_until?.toISOString() ?? null,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
  };
}

interface AssetRow {
  id: string;
  type: ExternalAssetType;
  value: string;
  status: 'accepted' | 'converting' | 'converted';
  source_participant_id: string | null;
  verified_by: string | null;
  created_at: Date;
  converted_at: Date | null;
}

function rowToAsset(r: AssetRow): ExternalAsset {
  return {
    id: r.id,
    type: r.type,
    value: parseFloat(r.value),
    status: r.status,
    sourceParticipantId: r.source_participant_id,
    verifiedBy: r.verified_by,
    createdAt: r.created_at.toISOString(),
    convertedAt: r.converted_at?.toISOString() ?? null,
  };
}

interface GuarantorRow {
  id: string;
  participant_id: string;
  valid_from: Date;
  valid_to: Date;
  diagnosis: Record<string, unknown>;
  status: 'active' | 'expired' | 'removed';
  created_at: Date;
}

function rowToGuarantor(r: GuarantorRow): Guarantor {
  return {
    id: r.id,
    participantId: r.participant_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to.toISOString(),
    diagnosis: r.diagnosis ?? {},
    status: r.status,
    createdAt: r.created_at.toISOString(),
  };
}

interface WitnessRow {
  id: string;
  community_id: string;
  status: 'active' | 'inactive';
  since: Date;
  created_at: Date;
}

function rowToWitness(r: WitnessRow): ExternalWitness {
  return {
    id: r.id,
    communityId: r.community_id,
    status: r.status,
    since: r.since.toISOString(),
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Совет ───────────────────────────────────────────────────────

export async function getCouncil(): Promise<GatewayCouncilMember[]> {
  const rows = await query<CouncilRow>(
    `SELECT * FROM gateway_council
     WHERE valid_to > now()
     ORDER BY valid_from DESC
     LIMIT ${GATEWAY_CONSTANTS.COUNCIL_SIZE}`,
  );
  return rows.map(rowToCouncil);
}

// B1: transaction + advisory lock — сериализует параллельные добавления.
export async function addCouncilMember(
  memberId: UUID,
  requesterId: UUID,
): Promise<GatewayCouncilMember> {
  const m = await transaction(async (client) => {
    // B1: advisory lock.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      ['gateway:council:add'],
    );

    const active = await client.query<CouncilRow>(
      `SELECT * FROM gateway_council WHERE valid_to > now()`,
    );
    if (active.rows.length >= GATEWAY_CONSTANTS.COUNCIL_SIZE) {
      throw new ConflictError(
        `Совет Шлюза уже полный (${GATEWAY_CONSTANTS.COUNCIL_SIZE})`,
      );
    }
    if (active.rows.some((r) => r.member_id === memberId)) {
      throw new ConflictError('Этот участник уже в Совете Шлюза');
    }

    const p = await client.query<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [memberId],
    );
    if (p.rows.length === 0) {throw new NotFoundError('Участник', memberId);}

    const id = newUUID();
    const entity = createCouncilMember({ id, memberId, termNumber: 1 });
    await client.query(
      `INSERT INTO gateway_council (id, member_id, valid_from, valid_to, term_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [entity.id, entity.memberId, entity.validFrom, entity.validTo, entity.termNumber],
    );
    return entity;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.council.member.added',
    entityType: 'gateway_council',
    entityId: m.id,
    newValue: { memberId },
  });
  return m;
}

// B2: atomic UPDATE — 0 rows → член уже ротирован.
export async function rotateCouncilMember(
  memberId: UUID,
  requesterId: UUID,
): Promise<{ rotated: number }> {
  const r = await query<{ id: string }>(
    `UPDATE gateway_council
        SET valid_to = now()
      WHERE member_id = $1 AND valid_to > now()
      RETURNING id`,
    [memberId],
  );
  if (r.length === 0) {
    throw new NotFoundError('Активный член Совета', memberId);
  }
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.council.member.rotated',
    entityType: 'gateway_council',
    entityId: memberId,
    newValue: { affected: r.length },
  });
  return { rotated: r.length };
}

// ─── Сделки ──────────────────────────────────────────────────────

export async function listTransactions(filter: {
  type?: GatewayTxType;
  status?: GatewayTransaction['status'];
} = {}): Promise<GatewayTransaction[]> {
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (filter.type) {
    params.push(filter.type);
    wheres.push(`type = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    wheres.push(`status = $${params.length}`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = await query<TxRow>(
    `SELECT * FROM external_transactions ${where}
     ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  return rows.map(rowToTx);
}

export async function createTransaction(
  input: {
    type: GatewayTxType;
    description: string;
    amountExternal?: number;
    resourceType?: string;
  },
  requesterId: UUID,
): Promise<GatewayTransaction> {
  const id = newUUID();
  const tx = createTransactionEntity({ id, ...input });
  await query(
    `INSERT INTO external_transactions
       (id, type, description, amount_external, resource_type, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tx.id, tx.type, tx.description, tx.amountExternal, tx.resourceType, tx.status],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.transaction.created',
    entityType: 'external_transaction',
    entityId: tx.id,
    newValue: { type: tx.type },
  });
  return tx;
}

// B3: atomic UPDATE — 0 rows → статус не pending.
export async function approveTransaction(
  transactionId: UUID,
  requesterId: UUID,
): Promise<GatewayTransaction> {
  const r = await query<{ id: string }>(
    `UPDATE external_transactions
        SET status = 'approved', approved_by = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [transactionId, requesterId],
  );
  if (r.length === 0) {
    // Диагностика — что было.
    const current = await queryOne<{ status: string }>(
      `SELECT status FROM external_transactions WHERE id = $1`,
      [transactionId],
    );
    if (!current) {throw new NotFoundError('Сделка', transactionId);}
    throw new ConflictError(`Сделка в статусе ${current.status}, нельзя одобрить`);
  }

  const row = await queryOne<TxRow>(
    `SELECT * FROM external_transactions WHERE id = $1`,
    [transactionId],
  );
  if (!row) {throw new NotFoundError('Сделка', transactionId);}

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.transaction.approved',
    entityType: 'external_transaction',
    entityId: transactionId,
  });

  try {
    const { dispatch } = await import('../webhooks/service.js');
    await dispatch('gateway.transaction', {
      transactionId,
      type: row.type,
      approvedBy: requesterId,
      approvedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, event: 'gateway.transaction' }, 'webhook dispatch failed');
  }

  return rowToTx(row);
}

// B4: atomic UPDATE + проверка status.
export async function auditTransaction(
  transactionId: UUID,
  requesterId: UUID,
): Promise<GatewayTransaction> {
  const r = await query<{ id: string }>(
    `UPDATE external_transactions
        SET audited_by = $2
      WHERE id = $1 AND status NOT IN ('completed', 'rejected')
      RETURNING id`,
    [transactionId, requesterId],
  );
  if (r.length === 0) {
    const current = await queryOne<{ status: string }>(
      `SELECT status FROM external_transactions WHERE id = $1`,
      [transactionId],
    );
    if (!current) {throw new NotFoundError('Сделка', transactionId);}
    throw new ConflictError(
      `Сделку в статусе ${current.status} нельзя аудировать`,
    );
  }

  const row = await queryOne<TxRow>(
    `SELECT * FROM external_transactions WHERE id = $1`,
    [transactionId],
  );
  if (!row) {throw new NotFoundError('Сделка', transactionId);}

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.transaction.audited',
    entityType: 'external_transaction',
    entityId: transactionId,
  });
  return rowToTx(row);
}

// ─── Активы ──────────────────────────────────────────────────────

export async function listAssets(): Promise<ExternalAsset[]> {
  const rows = await query<AssetRow>(
    `SELECT * FROM external_assets ORDER BY created_at DESC LIMIT 200`,
  );
  return rows.map(rowToAsset);
}

export async function acceptAsset(
  input: {
    type: ExternalAssetType;
    value: number;
    sourceParticipantId?: UUID;
  },
  requesterId: UUID,
): Promise<ExternalAsset> {
  const id = newUUID();
  const a = createExternalAsset({ id, ...input });
  await query(
    `INSERT INTO external_assets
       (id, type, value, status, source_participant_id, verified_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [a.id, a.type, a.value, a.status, a.sourceParticipantId, requesterId],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.asset.accepted',
    entityType: 'external_asset',
    entityId: a.id,
    newValue: { type: a.type, value: a.value },
  });
  return { ...a, verifiedBy: requesterId };
}

// B5: atomic UPDATE.
export async function convertAsset(
  assetId: UUID,
  requesterId: UUID,
): Promise<ExternalAsset> {
  const r = await query<{ id: string }>(
    `UPDATE external_assets
        SET status = 'converted', converted_at = now()
      WHERE id = $1 AND status != 'converted'
      RETURNING id`,
    [assetId],
  );
  if (r.length === 0) {
    const current = await queryOne<{ status: string }>(
      `SELECT status FROM external_assets WHERE id = $1`,
      [assetId],
    );
    if (!current) {throw new NotFoundError('Актив', assetId);}
    throw new ConflictError('Актив уже конвертирован');
  }

  const row = await queryOne<AssetRow>(
    `SELECT * FROM external_assets WHERE id = $1`,
    [assetId],
  );
  if (!row) {throw new NotFoundError('Актив', assetId);}

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.asset.converted',
    entityType: 'external_asset',
    entityId: assetId,
  });
  return rowToAsset(row);
}

export { isExternalMark };

// ─── Гарант ──────────────────────────────────────────────────────

export async function getGuarantor(): Promise<Guarantor | null> {
  const r = await queryOne<GuarantorRow>(
    `SELECT * FROM guarantor WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
  );
  return r ? rowToGuarantor(r) : null;
}

// B6: transaction + advisory lock.
export async function appointGuarantor(
  participantId: UUID,
  diagnosis: Record<string, unknown>,
  requesterId: UUID,
): Promise<Guarantor> {
  const g = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      ['gateway:guarantor:appoint'],
    );

    const existing = await client.query<GuarantorRow>(
      `SELECT * FROM guarantor WHERE status = 'active' LIMIT 1`,
    );
    if (existing.rows[0]) {
      throw new ConflictError(
        `Гарант уже назначен (${existing.rows[0].participant_id.slice(0, 8)}…). Сначала expire.`,
      );
    }

    const p = await client.query<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [participantId],
    );
    if (p.rows.length === 0) {throw new NotFoundError('Участник', participantId);}

    const id = newUUID();
    const entity = createGuarantor({ id, participantId, diagnosis });
    await client.query(
      `INSERT INTO guarantor (id, participant_id, valid_from, valid_to, diagnosis, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        entity.id, entity.participantId, entity.validFrom, entity.validTo,
        JSON.stringify(entity.diagnosis), entity.status,
      ],
    );
    return entity;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.guarantor.appointed',
    entityType: 'guarantor',
    entityId: g.id,
    newValue: { participantId },
  });
  return g;
}

// B7: atomic UPDATE RETURNING.
export async function expireGuarantor(
  requesterId: UUID,
): Promise<Guarantor | null> {
  const r = await query<GuarantorRow>(
    `UPDATE guarantor
        SET status = 'expired'
      WHERE status = 'active'
      RETURNING *`,
  );
  const row = r[0];
  if (!row) {return null;}

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.guarantor.expired',
    entityType: 'guarantor',
    entityId: row.id,
  });
  return rowToGuarantor(row);
}

// ─── Свидетели ───────────────────────────────────────────────────

export async function listWitnesses(): Promise<ExternalWitness[]> {
  const rows = await query<WitnessRow>(
    `SELECT * FROM external_witnesses ORDER BY since DESC`,
  );
  return rows.map(rowToWitness);
}

// B8: transaction + advisory lock по communityId.
export async function establishWitness(
  communityId: UUID,
  requesterId: UUID,
): Promise<ExternalWitness> {
  const w = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`gateway:witness:${communityId}`],
    );

    const existing = await client.query<WitnessRow>(
      `SELECT * FROM external_witnesses
        WHERE community_id = $1 AND status = 'active' LIMIT 1`,
      [communityId],
    );
    if (existing.rows[0]) {
      throw new ConflictError('Эта община уже является Свидетелем');
    }

    const id = newUUID();
    const entity = createWitness({ id, communityId });
    await client.query(
      `INSERT INTO external_witnesses (id, community_id, status, since)
       VALUES ($1, $2, $3, $4)`,
      [entity.id, entity.communityId, entity.status, entity.since],
    );
    return entity;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.witness.established',
    entityType: 'external_witness',
    entityId: w.id,
    newValue: { communityId },
  });
  return w;
}

// ─── Оборона ─────────────────────────────────────────────────────

export async function activateDefense(
  type: DefenseType,
  commanderId: UUID | null,
  requesterId: UUID,
): Promise<ExternalDefense> {
  const id = newUUID();
  const d = createDefense({ id, type, ...(commanderId ? { commanderId } : {}) });
  await query(
    `INSERT INTO external_defense (id, type, status, commander_id)
     VALUES ($1, $2, $3, $4)`,
    [d.id, d.type, d.status, d.commanderId],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.defense.activated',
    entityType: 'external_defense',
    entityId: d.id,
    newValue: { type, commanderId },
  });
  return d;
}

// ─── Самодостаточность и роспуск ─────────────────────────────────

// B10: правильные метрики (dependencyYears = IMPORT_DEPENDENCY_YEARS).
export async function getSelfSufficiency(): Promise<{
  canDissolve: boolean;
  reasons: string[];
}> {
  const w = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM external_witnesses WHERE status = 'active'`,
  );
  const witnessCount = parseInt(w?.cnt ?? '0', 10);

  // B10: importDependencyPct и dependencyYears — из реальных метрик.
  // Сейчас метрики не собираются → передаём «не хуже порога» (0 / MAX).
  // TODO(techdebt): после A.1.18.02 (balance) — брать реальные значения.
  const result = canDissolveGateway({
    importDependencyPct: 0,
    dependencyYears: GATEWAY_CONSTANTS.IMPORT_DEPENDENCY_YEARS,
    witnessCount,
    verified: witnessCount >= GATEWAY_CONSTANTS.MIN_WITNESSES,
  });
  return { canDissolve: result.allowed, reasons: result.reasons };
}

// B11: entityId = requesterId (gateway — не сущность БД).
export async function dissolve(
  reason: string,
  requesterId: UUID,
): Promise<{ dissolved: boolean }> {
  const self = await getSelfSufficiency();
  if (!self.canDissolve) {
    throw new ConflictError(
      `Шлюз ещё не самодостаточен: ${self.reasons.join('; ')}`,
    );
  }
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'gateway.dissolved',
    entityType: 'gateway',
    entityId: requesterId,
    newValue: { reason },
  });
  return { dissolved: true };
}