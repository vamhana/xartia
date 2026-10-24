// C.0.27.02 — Сервис Планетарного уровня
// Общины, Совет Протоколов, мосты, план, референдумы, пульс, резерв, расширение.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import {
  emitCommunityCreated,
  emitBridgeEstablished,
  emitExpansionFrozen,
  emitPulseUpdated,
} from '../../ws/pulse.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createCommunity, establishBridge, createReferendum,
  canExpand, getCoordinationLevel,
  type Community, type CommunityStatus,
  type PlanetaryCouncilMember, type CouncilMemberType,
  type Bridge, type BridgeStatus,
  type PlanetaryPlan, type Referendum, type ReferendumType,
  type Pulse, type Reserve,
} from './entity.js';

// -------- Rows --------

interface CommunityRow {
  id: string; code: string; name: string; status: CommunityStatus;
  level: number; mother_community_id: string | null;
  protocol_version: string; created_at: Date;
}
interface CouncilRow {
  id: string; member_id: string; community_id: string;
  valid_from: Date; valid_to: Date | null; type: CouncilMemberType;
}
interface BridgeRow {
  id: string; community_a: string; community_b: string;
  coefficient: string; status: BridgeStatus;
  established_at: Date; suspended_at: Date | null;
}
interface PlanRow {
  id: string; period: string; plan: Record<string, unknown>;
  approved_by: string | null; created_at: Date;
}
interface ReferendumRow {
  id: string; type: ReferendumType; threshold: string;
  result: Record<string, unknown> | null; status: 'initiated' | 'voting' | 'decided';
  created_at: Date; decided_at: Date | null;
}
interface PulseRow {
  id: string; community_id: string; base_goods_level: string | null;
  direction_load: Record<string, number>;
  top_signals: Array<Record<string, unknown>>; created_at: Date;
}

function rowToCommunity(r: CommunityRow): Community {
  return {
    id: r.id, code: r.code, name: r.name, status: r.status, level: r.level,
    motherCommunityId: r.mother_community_id,
    protocolVersion: r.protocol_version,
    createdAt: r.created_at.toISOString(),
  };
}
function rowToCouncil(r: CouncilRow): PlanetaryCouncilMember {
  return {
    id: r.id, memberId: r.member_id, communityId: r.community_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
    type: r.type,
  };
}
function rowToBridge(r: BridgeRow): Bridge {
  return {
    id: r.id, communityA: r.community_a, communityB: r.community_b,
    coefficient: parseFloat(r.coefficient), status: r.status,
    establishedAt: r.established_at.toISOString(),
    suspendedAt: r.suspended_at ? r.suspended_at.toISOString() : null,
  };
}
function rowToPlan(r: PlanRow): PlanetaryPlan {
  return {
    id: r.id, period: r.period, plan: r.plan,
    approvedBy: r.approved_by,
    createdAt: r.created_at.toISOString(),
  };
}
export function rowToReferendum(r: ReferendumRow): Referendum {
  return {
    id: r.id, type: r.type, threshold: parseFloat(r.threshold),
    result: r.result, status: r.status,
    createdAt: r.created_at.toISOString(),
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
  };
}
function rowToPulse(r: PulseRow): Pulse {
  return {
    id: r.id, communityId: r.community_id,
    baseGoodsLevel: r.base_goods_level ? parseFloat(r.base_goods_level) : null,
    directionLoad: r.direction_load ?? {},
    topSignals: r.top_signals ?? [],
    createdAt: r.created_at.toISOString(),
  };
}

// -------- Communities --------

export async function listCommunities(filter: { status?: CommunityStatus } = {}): Promise<Community[]> {
  const params: unknown[] = [];
  const where = filter.status
    ? (params.push(filter.status), `WHERE status = $${params.length}`)
    : '';
  const rows = await query<CommunityRow>(
    `SELECT id, code, name, status, level, mother_community_id,
            protocol_version, created_at
       FROM communities ${where}
      ORDER BY code`,
    params,
  );
  return rows.map(rowToCommunity);
}

export async function getCommunity(communityId: UUID): Promise<Community> {
  const row = await queryOne<CommunityRow>(
    `SELECT id, code, name, status, level, mother_community_id,
            protocol_version, created_at
       FROM communities WHERE id = $1`,
    [communityId],
  );
  if (!row) {throw new NotFoundError('Община', communityId);}
  return rowToCommunity(row);
}

export async function createCommunityService(input: {
  code: string;
  name: string;
  motherCommunityId?: UUID;
  by: UUID;
}): Promise<Community> {
  const entity = createCommunity({
    id: newUUID(),
    code: input.code,
    name: input.name,
    ...(input.motherCommunityId ? { motherCommunityId: input.motherCommunityId } : {}),
  });

  try {
    await query(
      `INSERT INTO communities
         (id, code, name, status, level, mother_community_id, protocol_version)
       VALUES ($1, $2, $3, 'incubation', 0, $4, '5.0')`,
      [entity.id, entity.code, entity.name, entity.motherCommunityId],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw new ConflictError('Община с таким кодом уже существует');
    }
    if (code === '23503') {
      throw new NotFoundError('Материнская община', entity.motherCommunityId ?? '');
    }
    throw e;
  }

  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'planetary.community_create',
    entityType: 'community', entityId: entity.id,
    newValue: { code: entity.code, name: entity.name },
  });

  await emitCommunityCreated(entity);
  
   try {
    const { dispatch } = await import('../webhooks/service.js');
    await dispatch('community.created', {
      communityId: entity.id,
      code: entity.code,
      name: entity.name,
      motherCommunityId: entity.motherCommunityId,
      createdBy: input.by,
    });
  } catch (e) {
    logger.warn({ err: e, event: 'community.created' }, 'webhook dispatch failed');
  } 
  
  return entity;
}

// -------- Council --------

export async function getCouncil(): Promise<PlanetaryCouncilMember[]> {
  const rows = await query<CouncilRow>(
    `SELECT id, member_id, community_id, valid_from, valid_to, type
       FROM protocol_council
      WHERE valid_to IS NULL OR valid_to > now()
      ORDER BY valid_from DESC`,
  );
  return rows.map(rowToCouncil);
}

export async function addCouncilMember(input: {
  memberId: UUID;
  communityId: UUID;
  type: CouncilMemberType;
  by: UUID;
}): Promise<PlanetaryCouncilMember> {
  const id = newUUID();
  const validFrom = new Date();
  const validTo = new Date(
    validFrom.getTime() + (input.type === 'delegate' ? 3 * 365 : 5 * 365) * 86_400_000,
  );

  await query(
    `INSERT INTO protocol_council (id, member_id, community_id, valid_from, valid_to, type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.memberId, input.communityId, validFrom, validTo, input.type],
  );

  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'planetary.council_add',
    entityType: 'protocol_council', entityId: id,
    newValue: { member_id: input.memberId, type: input.type },
  });

  return {
    id, memberId: input.memberId, communityId: input.communityId,
    validFrom: validFrom.toISOString(), validTo: validTo.toISOString(),
    type: input.type,
  };
}

// -------- Bridges --------

export async function listBridges(): Promise<Bridge[]> {
  const rows = await query<BridgeRow>(
    `SELECT id, community_a, community_b, coefficient::text AS coefficient,
            status, established_at, suspended_at
       FROM flow_bridges
      ORDER BY established_at DESC LIMIT 200`,
  );
  return rows.map(rowToBridge);
}

export async function createBridgeService(input: {
  communityA: UUID;
  communityB: UUID;
  coefficient: number;
  by: UUID;
}): Promise<Bridge> {
  // Лексикографическая нормализация пары (communityA < communityB), чтобы
  // UNIQUE (community_a, community_b) в PG ловил дубли независимо от порядка.
  // UUID в БД всегда lowercase, но нормализуем на всякий случай.
  const ca = input.communityA.toLowerCase();
  const cb = input.communityB.toLowerCase();
  const [a, b] = ca < cb ? [ca, cb] : [cb, ca];

  const entity = establishBridge({
    id: newUUID(),
    communityA: a, communityB: b,
    coefficient: input.coefficient,
  });

  try {
    await query(
      `INSERT INTO flow_bridges
         (id, community_a, community_b, coefficient, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [entity.id, entity.communityA, entity.communityB, entity.coefficient],
    );
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505') {
      throw new ConflictError('Мост между этими общинами уже существует');
    }
    if (code === '23503') {
      // FK-имя по умолчанию: flow_bridges_community_a_fkey / _community_b_fkey
      const constraint = (e as { constraint?: string }).constraint ?? '';
      const which = constraint.includes('community_b') ? input.communityB : input.communityA;
      throw new NotFoundError('Община', which);
    }
    throw e;
  }

  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'planetary.bridge_create',
    entityType: 'flow_bridge', entityId: entity.id,
    newValue: { a: entity.communityA, b: entity.communityB, coefficient: entity.coefficient },
  });

  await emitBridgeEstablished(entity);
  
  try {
    const { dispatch } = await import('../webhooks/service.js');
    await dispatch('bridge.established', {
      bridgeId: entity.id,
      communityA: entity.communityA,
      communityB: entity.communityB,
      coefficient: entity.coefficient,
      establishedBy: input.by,
    });
  } catch (e) {
    logger.warn({ err: e, event: 'bridge.established' }, 'webhook dispatch failed');
  }  
  
  return entity;
}

// -------- Plan --------

export async function getPlan(): Promise<PlanetaryPlan | null> {
  const row = await queryOne<PlanRow>(
    `SELECT id, period, plan, approved_by, created_at
       FROM planetary_plans
      ORDER BY created_at DESC LIMIT 1`,
  );
  return row ? rowToPlan(row) : null;
}

export async function createPlanService(input: {
  period: string;
  plan: Record<string, unknown>;
  by: UUID;
}): Promise<PlanetaryPlan> {
  const id = newUUID();
  await query(
    `INSERT INTO planetary_plans (id, period, plan, approved_by)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [id, input.period, JSON.stringify(input.plan), input.by],
  );

  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'planetary.plan_create',
    entityType: 'planetary_plan', entityId: id,
    newValue: { period: input.period },
  });

  const row = await queryOne<PlanRow>(
    `SELECT id, period, plan, approved_by, created_at
       FROM planetary_plans WHERE id = $1`, [id],
  );
  if (!row) {
    throw new NotFoundError('PlanetaryPlan', id);
  }
  return rowToPlan(row);
}

// -------- Referendum --------
// TODO(webhook): referendum.decided → dispatch в decideReferendum()
// функция пока не реализована в C.0.27.02.
export async function createReferendumService(input: {
  type: ReferendumType;
  threshold: number;
  by: UUID;
}): Promise<Referendum> {
  const entity = createReferendum({
    id: newUUID(), type: input.type, threshold: input.threshold,
  });
  await query(
    `INSERT INTO global_referendums (id, type, threshold, status)
     VALUES ($1, $2, $3, 'initiated')`,
    [entity.id, entity.type, entity.threshold],
  );
  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'planetary.referendum_create',
    entityType: 'referendum', entityId: entity.id,
    newValue: { type: entity.type, threshold: entity.threshold },
  });
  return entity;
}

// -------- Pulse --------

export async function getPulse(communityId?: UUID): Promise<Pulse[]> {
  const params: unknown[] = [];
  const where = communityId
    ? (params.push(communityId), `WHERE community_id = $${params.length}`)
    : '';
  const rows = await query<PulseRow>(
    `SELECT id, community_id, base_goods_level::text AS base_goods_level,
            direction_load, top_signals, created_at
       FROM planetary_pulse ${where}
      ORDER BY created_at DESC LIMIT 100`,
    params,
  );
  return rows.map(rowToPulse);
}

export async function publishPulse(pulse: Pulse): Promise<Pulse> {
  await query(
    `INSERT INTO planetary_pulse
       (id, community_id, base_goods_level, direction_load, top_signals)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      pulse.id, pulse.communityId, pulse.baseGoodsLevel,
      JSON.stringify(pulse.directionLoad),
      JSON.stringify(pulse.topSignals),
    ],
  );
  await emitPulseUpdated(pulse.communityId, pulse);
  return pulse;
}

// -------- Reserve --------

export async function getReserve(): Promise<Reserve> {
  const row = await queryOne<{ total_volume: string; distributed: string; available: string }>(
    `SELECT COALESCE(SUM(total_volume),0)::text AS total_volume,
            COALESCE(SUM(distributed),0)::text AS distributed,
            COALESCE(SUM(available),0)::text AS available
       FROM planetary_reserve`,
  );
  return {
    totalVolume: parseFloat(row?.total_volume ?? '0'),
    distributed: parseFloat(row?.distributed ?? '0'),
    available: parseFloat(row?.available ?? '0'),
  };
}

// -------- Expansion --------

export async function checkExpansionConditions(): Promise<{ allowed: boolean; reasons: string[] }> {
  const bridges = await listBridges();
  const bridgesCount = bridges.length;
  if (bridgesCount === 0) {return { allowed: true, reasons: [] };}

  const bridgesHealthy = bridges.every((b) => b.status === 'active');
  if (!bridgesHealthy) {
    return { allowed: false, reasons: ['не все мосты активны'] };
  }
  // TODO(techdebt): реальные bridgeLatencySec и standardsDeviationPct не измеряются.
  // Сейчас хардкод: latency=1s (всегда OK), deviation=0% (всегда OK).
  // Требует: (1) поля latency_ms/standards_deviation_pct в flow_bridges,
  //         (2) cron для периодического замера, (3) заполнение перед проверкой.
  // См. A.1.27.01 «ТЕХДОЛГ».
  return canExpand({ bridgeLatencySec: 1, standardsDeviationPct: 0 });
}

export async function freezeExpansion(reason: string, by: UUID): Promise<{ frozen: boolean; reason: string }> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM expansion_status WHERE frozen = true LIMIT 1`,
  );
  if (existing) {throw new ConflictError('Расширение уже заморожено');}

  const id = newUUID();
  await query(
    `INSERT INTO expansion_status (id, frozen, reason, frozen_at)
     VALUES ($1, true, $2, now())`,
    [id, reason],
  );

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'planetary.expansion_freeze',
    entityType: 'expansion_status', entityId: id,
    newValue: { reason },
  });

  await emitExpansionFrozen(reason);
  return { frozen: true, reason };
}

export async function unfreezeExpansion(by: UUID): Promise<{ frozen: boolean }> {
  const updated = await queryOne<{ id: string }>(
    `UPDATE expansion_status SET frozen = false, unfrozen_at = now()
      WHERE frozen = true RETURNING id`,
  );
  if (!updated) {
    throw new ConflictError('Расширение не заморожено');
  }
  await logAction({
    actorId: by, actorType: 'participant',
    action: 'planetary.expansion_unfreeze',
    entityType: 'expansion_status', entityId: updated.id,
  });
  return { frozen: false };
}

// -------- Coordination --------

export async function getCoordinationLevelService(): Promise<'direct' | 'regional' | 'continental' | 'planetary'> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM communities`,
  );
  return getCoordinationLevel(parseInt(row?.c ?? '0', 10));
}

// Экспорт для WS
export { getCoordinationLevel };