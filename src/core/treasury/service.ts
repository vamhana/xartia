// C.0.47.01 — Казна: стабильная учётная единица (XartIA 5.0).
//
// Пол 1.00 в USD обеспечивается только T1. Прибыль добавляется в резерв без
// эмиссии (цена растёт), расходы списываются из премии, но не ниже пола.
// Траты — только через мультисиг 3-из-5 (роли мандатов), с проверкой
// инварианта T1 ≥ supply × 1.00 перед исполнением.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { Role } from '../roles.js';
import { getRoles } from '../../security/rbac.js';
import type { UUID } from '../types.js';

export const FLOOR = 1.0;
export const T2_HAIRCUT = 0.5;
export const APPROVALS_REQUIRED = 3;

/** Роли, которым разрешено подписывать траты казны (не более одной подписи на человека). */
const APPROVER_ROLES: Role[] = [
  Role.FIRST_ARCHITECT,
  Role.COUNCIL_MEMBER,
  Role.KEEPER,
  Role.VERIFIER,
  Role.BALANCER,
];

export interface TreasuryState {
  t1Usdc: number;
  t2Usdc: number;
  operatingUsdc: number;
  bufferUsdc: number;
  reserveUsdc: number;
  supply: number;
  price: number;
  coverage: number;
  floorUsdc: number;
  updatedAt: string;
}

export interface TreasuryOperation {
  id: string;
  kind: 'revenue' | 'spend' | 'redeem' | 'genesis';
  amountUsdc: number;
  amountUnits: number;
  price: number;
  gatewayTransactionId: string | null;
  actorId: string | null;
  note: string | null;
  createdAt: string;
}

export interface SpendRequest {
  id: string;
  amountUsdc: number;
  purpose: string;
  status: 'pending' | 'executed' | 'rejected';
  approvals: Array<{ participantId: string; role: string }>;
  createdAt: string;
}

function n(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

async function loadRow() {
  const row = await queryOne<{
    t1_usdc: string;
    t2_usdc: string;
    operating_usdc: string;
    buffer_usdc: string;
    supply: string;
    updated_at: Date;
  }>(`SELECT * FROM treasury_state WHERE id = 1`);
  if (!row) {throw new Error('treasury_state не инициализирована (миграция 042)');}
  return row;
}

function computeState(row: Awaited<ReturnType<typeof loadRow>>): TreasuryState {
  const t1 = n(row.t1_usdc);
  const t2 = n(row.t2_usdc);
  const supply = n(row.supply);
  const reserve = t1 + T2_HAIRCUT * t2;
  const price = supply > 0 ? Math.max(FLOOR, reserve / supply) : FLOOR;
  return {
    t1Usdc: t1,
    t2Usdc: t2,
    operatingUsdc: n(row.operating_usdc),
    bufferUsdc: n(row.buffer_usdc),
    reserveUsdc: reserve,
    supply,
    price,
    coverage: supply > 0 ? t1 / supply : Infinity,
    floorUsdc: supply * FLOOR,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getTreasuryState(): Promise<TreasuryState> {
  return computeState(await loadRow());
}

function assertFloor(t1: number, supply: number): void {
  if (t1 + 1e-9 < supply * FLOOR) {
    throw new ConflictError('Инвариант пола нарушен: T1 < supply × 1.00');
  }
}

/**
 * Выручка Шлюза: 60% в T1 (резерв), 30% на операционный счёт, 10% в буфер.
 * Если supply == 0 — это genesis: выпускаем юниты ровно на сумму в резерв по 1.00.
 * Дальше прибыль просто увеличивает R, цена растёт без эмиссии.
 */
export async function recordRevenue(input: {
  amountUsdc: number;
  actorId: UUID | null;
  gatewayTransactionId?: string | null;
  note?: string | null;
}): Promise<TreasuryState> {
  if (!Number.isFinite(input.amountUsdc) || input.amountUsdc <= 0) {
    throw new ValidationError('Сумма выручки должна быть > 0');
  }
  const amount = input.amountUsdc;
  const toReserve = amount * 0.6;
  const toOperating = amount * 0.3;
  const toBuffer = amount * 0.1;

  await transaction(async (client) => {
    const cur = await client.query(
      `SELECT * FROM treasury_state WHERE id = 1 FOR UPDATE`,
    );
    const row = cur.rows[0];
    const t1 = n(row.t1_usdc) + toReserve;
    const supply = n(row.supply);
    const isGenesis = supply === 0;
    const minted = isGenesis ? toReserve : 0;
    const newSupply = supply + minted;

    assertFloor(t1, newSupply);

    await client.query(
      `UPDATE treasury_state
          SET t1_usdc = $1, operating_usdc = operating_usdc + $2,
              buffer_usdc = buffer_usdc + $3, supply = $4, updated_at = now()
        WHERE id = 1`,
      [t1, toOperating, toBuffer, newSupply],
    );

    const state = computeState({ ...row, t1_usdc: String(t1), supply: String(newSupply), updated_at: new Date() });
    await client.query(
      `INSERT INTO treasury_operations
         (id, kind, amount_usdc, amount_units, price, gateway_transaction_id, actor_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        newUUID(),
        isGenesis ? 'genesis' : 'revenue',
        amount,
        minted,
        state.price,
        input.gatewayTransactionId ?? null,
        input.actorId,
        input.note ?? null,
      ],
    );
  });

  await logAction({
    actorId: input.actorId,
    actorType: 'participant',
    action: 'treasury.revenue',
    entityType: 'treasury',
    entityId: '1',
    newValue: { amount_usdc: amount, gateway_transaction_id: input.gatewayTransactionId ?? null },
  });

  return getTreasuryState();
}

/** Выкуп юнитов по текущей цене (пол 1.00 гарантирован). */
export async function redeemUnits(input: {
  amountUnits: number;
  actorId: UUID | null;
  note?: string | null;
}): Promise<TreasuryState> {
  if (!Number.isFinite(input.amountUnits) || input.amountUnits <= 0) {
    throw new ValidationError('Количество юнитов должно быть > 0');
  }

  await transaction(async (client) => {
    const cur = await client.query(`SELECT * FROM treasury_state WHERE id = 1 FOR UPDATE`);
    const row = cur.rows[0];
    const supply = n(row.supply);
    if (input.amountUnits > supply) {throw new ConflictError('Юнитов больше, чем выпущено');}
    const t1 = n(row.t1_usdc);
    const t2 = n(row.t2_usdc);
    const price = supply > 0 ? Math.max(FLOOR, (t1 + T2_HAIRCUT * t2) / supply) : FLOOR;
    const payout = input.amountUnits * price;
    if (payout > t1 + 1e-9) {throw new ConflictError('В T1 недостаточно средств для выкупа по полу');}
    const newT1 = t1 - payout;
    const newSupply = supply - input.amountUnits;
    assertFloor(newT1, newSupply);

    await client.query(
      `UPDATE treasury_state SET t1_usdc = $1, supply = $2, updated_at = now() WHERE id = 1`,
      [newT1, newSupply],
    );
    await client.query(
      `INSERT INTO treasury_operations
         (id, kind, amount_usdc, amount_units, price, actor_id, note)
       VALUES ($1,'redeem',$2,$3,$4,$5,$6)`,
      [newUUID(), payout, input.amountUnits, price, input.actorId, input.note ?? null],
    );
  });

  return getTreasuryState();
}

export async function requestSpend(input: {
  amountUsdc: number;
  purpose: string;
  actorId: UUID;
}): Promise<SpendRequest> {
  if (!(input.amountUsdc > 0)) {throw new ValidationError('Сумма должна быть > 0');}
  if (!input.purpose.trim()) {throw new ValidationError('Назначение обязательно');}

  const id = newUUID();
  await query(
    `INSERT INTO treasury_spend_requests (id, amount_usdc, purpose, created_by)
     VALUES ($1,$2,$3,$4)`,
    [id, input.amountUsdc, input.purpose.trim(), input.actorId],
  );
  await logAction({
    actorId: input.actorId,
    actorType: 'participant',
    action: 'treasury.spend.request',
    entityType: 'treasury_spend',
    entityId: id,
    newValue: { amount_usdc: input.amountUsdc, purpose: input.purpose },
  });
  return getSpendRequest(id);
}

async function approverRole(participantId: UUID): Promise<Role | null> {
  const roles = await getRoles(participantId);
  const role = roles.find((r) => APPROVER_ROLES.includes(r.role));
  return role?.role ?? null;
}

export async function approveSpend(input: {
  requestId: UUID;
  participantId: UUID;
}): Promise<SpendRequest> {
  const role = await approverRole(input.participantId);
  if (!role) {throw new ConflictError('Нет роли, дающей право подписи казны');}

  const req = await queryOne<{ status: string }>(
    `SELECT status FROM treasury_spend_requests WHERE id = $1`,
    [input.requestId],
  );
  if (!req) {throw new NotFoundError('Запрос траты', input.requestId);}
  if (req.status !== 'pending') {throw new ConflictError('Запрос уже закрыт');}

  await query(
    `INSERT INTO treasury_approvals (request_id, participant_id, role)
     VALUES ($1,$2,$3) ON CONFLICT (request_id, participant_id) DO NOTHING`,
    [input.requestId, input.participantId, role],
  );

  const count = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM treasury_approvals WHERE request_id = $1`,
    [input.requestId],
  );
  const approvals = parseInt(count?.c ?? '0', 10);

  if (approvals >= APPROVALS_REQUIRED) {
    await executeSpend(input.requestId, input.participantId);
  }

  return getSpendRequest(input.requestId);
}

async function executeSpend(requestId: UUID, actorId: UUID): Promise<void> {
  await transaction(async (client) => {
    const reqRes = await client.query(
      `SELECT * FROM treasury_spend_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    const req = reqRes.rows[0];
    if (!req || req.status !== 'pending') {return;}
    const amount = n(req.amount_usdc);
    const cur = await client.query(`SELECT * FROM treasury_state WHERE id = 1 FOR UPDATE`);
    const row = cur.rows[0];
    const t1 = n(row.t1_usdc);
    const supply = n(row.supply);
    // Трата разрешена только из премии: после неё пол должен остаться цел.
    if (t1 - amount < supply * FLOOR - 1e-9) {
      await client.query(
        `UPDATE treasury_spend_requests
            SET status = 'rejected', executed_at = now() WHERE id = $1`,
        [requestId],
      );
      return;
    }
    await client.query(
      `UPDATE treasury_state SET t1_usdc = $1, operating_usdc = operating_usdc + $2,
              updated_at = now() WHERE id = 1`,
      [t1 - amount, amount],
    );
    await client.query(
      `UPDATE treasury_spend_requests
          SET status = 'executed', executed_at = now() WHERE id = $1`,
      [requestId],
    );
    await client.query(
      `INSERT INTO treasury_operations
         (id, kind, amount_usdc, amount_units, price, actor_id, note)
       VALUES ($1,'spend',$2,0,$3,$4,$5)`,
      [newUUID(), amount, computeState(row).price, actorId, req.purpose],
    );
  });
}

export async function getSpendRequest(id: UUID): Promise<SpendRequest> {
  const row = await queryOne<{
    id: string;
    amount_usdc: string;
    purpose: string;
    status: 'pending' | 'executed' | 'rejected';
    created_at: Date;
  }>(`SELECT * FROM treasury_spend_requests WHERE id = $1`, [id]);
  if (!row) {throw new NotFoundError('Запрос траты', id);}
  const approvals = await query<{ participant_id: string; role: string }>(
    `SELECT participant_id, role FROM treasury_approvals WHERE request_id = $1`,
    [id],
  );
  return {
    id: row.id,
    amountUsdc: n(row.amount_usdc),
    purpose: row.purpose,
    status: row.status,
    approvals: approvals.map((a) => ({ participantId: a.participant_id, role: a.role })),
    createdAt: row.created_at.toISOString(),
  };
}

export async function listSpendRequests(): Promise<SpendRequest[]> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM treasury_spend_requests ORDER BY created_at DESC LIMIT 50`,
  );
  const result: SpendRequest[] = [];
  for (const r of rows) {result.push(await getSpendRequest(r.id as UUID));}
  return result;
}

export async function listOperations(limit = 50): Promise<TreasuryOperation[]> {
  const rows = await query<{
    id: string;
    kind: TreasuryOperation['kind'];
    amount_usdc: string;
    amount_units: string;
    price: string;
    gateway_transaction_id: string | null;
    actor_id: string | null;
    note: string | null;
    created_at: Date;
  }>(`SELECT * FROM treasury_operations ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountUsdc: n(r.amount_usdc),
    amountUnits: n(r.amount_units),
    price: n(r.price),
    gatewayTransactionId: r.gateway_transaction_id,
    actorId: r.actor_id,
    note: r.note,
    createdAt: r.created_at.toISOString(),
  }));
}
