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
import { send, sendToRole } from '../../lib/notifications.js';
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
    entityId: '00000000-0000-0000-0000-000000000000',
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
  void notifyTreasury(
    'treasury.spend_request',
    'Запрос траты из казны',
    `${input.amountUsdc.toFixed(2)} USDC: ${input.purpose}`,
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

// ─── Подписанты казны (5 мест) ───────────────────────────────────────

export interface SignatorySeat {
  seat: string;
  role: string;
  holder: { participantId: UUID; name: string; externalId: string } | null;
  /** Место вакантно — функцию исполняет Архитектор (дух Хартии). */
  fallbackToArchitect: boolean;
}

interface SeatDef {
  seat: string;
  role: string;
  directionNumber: number | null;
}

const SEATS: SeatDef[] = [
  { seat: 'Архитектор', role: 'FIRST_ARCHITECT', directionNumber: null },
  { seat: 'Верификация', role: 'COUNCIL_MEMBER', directionNumber: 13 },
  { seat: 'Шлюз', role: 'COUNCIL_MEMBER', directionNumber: 15 },
  { seat: 'Внешний аудитор', role: 'KEEPER', directionNumber: null },
  { seat: 'Выборный делегат', role: 'COUNCIL_MEMBER', directionNumber: 9 },
];

async function architect(): Promise<{ participantId: UUID; name: string; externalId: string } | null> {
  const row = await queryOne<{ id: string; name: string; external_id: string }>(
    `SELECT id, name, external_id FROM participants
      WHERE is_first_architect = true AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
  );
  return row ? { participantId: row.id as UUID, name: row.name, externalId: row.external_id } : null;
}

/** Пять мест подписантов; вакантные замещает Архитектор, но подпись всё равно одна. */
export async function getSignatories(): Promise<SignatorySeat[]> {
  const arch = await architect();
  const result: SignatorySeat[] = [];
  for (const def of SEATS) {
    const params: unknown[] = [];
    let where = `r.name = $1 AND pr.status = 'active' AND (pr.valid_to IS NULL OR pr.valid_to > now())`;
    params.push(def.role);
    if (def.directionNumber !== null) {
      where += ` AND d.number = $2`;
      params.push(def.directionNumber);
    }
    const row = await queryOne<{ id: string; name: string; external_id: string }>(
      `SELECT p.id, p.name, p.external_id
         FROM participant_roles pr
         JOIN roles r ON r.id = pr.role_id
         JOIN participants p ON p.id = pr.participant_id
         LEFT JOIN directions d ON d.id = pr.direction_id
        WHERE ${where}
        ORDER BY pr.valid_from DESC
        LIMIT 1`,
      params,
    );
    const holder = row
      ? { participantId: row.id as UUID, name: row.name, externalId: row.external_id }
      : null;
    result.push({
      seat: def.seat,
      role: def.role,
      holder,
      fallbackToArchitect: holder === null && arch !== null,
    });
  }
  return result;
}

// ─── Выручка Шлюза ───────────────────────────────────────────────────

/**
 * Учесть выручку завершённой сделки Шлюза. Идемпотентно: одна сделка —
 * одна операция казны (частичный уникальный индекс + проверка).
 */
export async function recordGatewayRevenue(input: {
  transactionId: UUID;
  amountUsdc: number;
  actorId: UUID | null;
  note?: string | null;
}): Promise<TreasuryState> {
  const exists = await queryOne<{ id: string }>(
    `SELECT id FROM treasury_operations WHERE gateway_transaction_id = $1 LIMIT 1`,
    [input.transactionId],
  );
  if (exists) {return getTreasuryState();}

  const state = await recordRevenue({
    amountUsdc: input.amountUsdc,
    actorId: input.actorId,
    gatewayTransactionId: input.transactionId,
    note: input.note ?? 'Выручка Шлюза',
  });

  void notifyTreasury(
    'treasury.gateway_revenue',
    'Выручка Шлюза зачислена в казну',
    `Сделка ${input.transactionId}: ${input.amountUsdc.toFixed(2)} USDC → резерв/операции/буфер`,
  );

  return state;
}

async function notifyTreasury(type: string, title: string, body: string): Promise<void> {
  try {
    const res = await sendToRole(Role.COUNCIL_MEMBER, {
      type,
      priority: 'standard',
      title,
      body,
      data: {},
    });
    if (res.delivered === 0) {
      const arch = await architect();
      if (arch) {
        await send({
          recipientId: arch.participantId,
          type,
          priority: 'standard',
          title,
          body,
          data: {},
        });
      }
    }
  } catch {
    /* best-effort */
  }
}

// ─── Лицевые счета держателей (D.2.01.47) ────────────────────────────
//
// Из казны нет переводов людям: счета нужны, чтобы внешний человек мог
// купить монету, хранить её и перевести казне как оплату услуг.

export interface UnitAccount {
  accountId: string;
  balance: number;
}

async function ensureAccount(participantId: UUID): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM unit_accounts WHERE participant_id = $1`,
    [participantId],
  );
  if (existing) {return existing.id;}
  const id = newUUID();
  await query(
    `INSERT INTO unit_accounts (id, participant_id) VALUES ($1, $2)
     ON CONFLICT (participant_id) DO NOTHING`,
    [id, participantId],
  );
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM unit_accounts WHERE participant_id = $1`,
    [participantId],
  );
  return row?.id ?? id;
}

export async function getAccount(participantId: UUID): Promise<UnitAccount> {
  const id = await ensureAccount(participantId);
  const row = await queryOne<{ balance: string }>(
    `SELECT balance FROM unit_accounts WHERE id = $1`,
    [id],
  );
  return { accountId: id, balance: n(row?.balance ?? '0') };
}

/**
 * Покупка монеты у протокола: USDC → T1, выпуск по текущему курсу.
 * Покупка не двигает курс (R и S растут пропорционально) — это не прибыль,
 * а вход капитала. Прибылью становится только дар казне.
 */
export async function buyUnits(input: {
  participantId: UUID;
  amountUsdc: number;
}): Promise<{ account: UnitAccount; state: TreasuryState }> {
  if (!(input.amountUsdc > 0)) {throw new ValidationError('Сумма должна быть > 0');}

  await transaction(async (client) => {
    const cur = await client.query(`SELECT * FROM treasury_state WHERE id = 1 FOR UPDATE`);
    const row = cur.rows[0];
    const t1 = n(row.t1_usdc);
    const supply = n(row.supply);
    const price = supply > 0 ? Math.max(FLOOR, (t1 + T2_HAIRCUT * n(row.t2_usdc)) / supply) : FLOOR;
    const units = input.amountUsdc / price;

    const accountId = await ensureAccount(input.participantId);
    const newSupply = supply + units;
    const newT1 = t1 + input.amountUsdc;
    assertFloor(newT1, newSupply);

    await client.query(
      `UPDATE treasury_state SET t1_usdc = $1, supply = $2, updated_at = now() WHERE id = 1`,
      [newT1, newSupply],
    );
    await client.query(
      `UPDATE unit_accounts SET balance = balance + $1, updated_at = now() WHERE id = $2`,
      [units, accountId],
    );
    await client.query(
      `INSERT INTO unit_transfers (id, account_id, kind, units, usdc, price, actor_id)
       VALUES ($1,$2,'buy',$3,$4,$5,$6)`,
      [newUUID(), accountId, units, input.amountUsdc, price, input.participantId],
    );
    await client.query(
      `INSERT INTO treasury_operations
         (id, kind, amount_usdc, amount_units, price, actor_id, note)
       VALUES ($1,'buy',$2,$3,$4,$5,$6)`,
      [newUUID(), input.amountUsdc, units, price, input.participantId, 'Покупка монеты'],
    );
  });

  return { account: await getAccount(input.participantId), state: await getTreasuryState() };
}

/**
 * Дар казне: держатель переводит монеты сообществу. Монеты сжигаются,
 * эквивалент в USDC переходит из T1 в операционный счёт (общие блага).
 * Пол не может быть пробит: проверяется T1 − payout ≥ (S − units) × 1.00.
 */
export async function donateToTreasury(input: {
  participantId: UUID;
  units: number;
  note?: string | null;
}): Promise<{ account: UnitAccount; state: TreasuryState }> {
  if (!(input.units > 0)) {throw new ValidationError('Количество монет должно быть > 0');}

  await transaction(async (client) => {
    const accountId = await ensureAccount(input.participantId);
    const acc = await client.query(
      `SELECT balance FROM unit_accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    const balance = n(acc.rows[0]?.balance ?? '0');
    if (input.units > balance + 1e-9) {throw new ConflictError('На счёте недостаточно монеты');}

    const cur = await client.query(`SELECT * FROM treasury_state WHERE id = 1 FOR UPDATE`);
    const row = cur.rows[0];
    const supply = n(row.supply);
    const t1 = n(row.t1_usdc);
    const price = Math.max(FLOOR, (t1 + T2_HAIRCUT * n(row.t2_usdc)) / supply);
    const payout = input.units * price;
    if (payout > t1 + 1e-9) {throw new ConflictError('В T1 недостаточно средств');}
    const newT1 = t1 - payout;
    const newSupply = supply - input.units;
    assertFloor(newT1, newSupply);

    await client.query(
      `UPDATE unit_accounts SET balance = balance - $1, updated_at = now() WHERE id = $2`,
      [input.units, accountId],
    );
    await client.query(
      `UPDATE treasury_state
          SET t1_usdc = $1, operating_usdc = operating_usdc + $2,
              supply = $3, updated_at = now()
        WHERE id = 1`,
      [newT1, payout, newSupply],
    );
    await client.query(
      `INSERT INTO unit_transfers (id, account_id, kind, units, usdc, price, actor_id)
       VALUES ($1,$2,'donate',$3,$4,$5,$6)`,
      [newUUID(), accountId, input.units, payout, price, input.participantId],
    );
    await client.query(
      `INSERT INTO treasury_operations
         (id, kind, amount_usdc, amount_units, price, actor_id, note)
       VALUES ($1,'donate',$2,$3,$4,$5,$6)`,
      [newUUID(), payout, input.units, price, input.participantId,
        input.note ?? 'Дар казне (оплата услуг сообщества)'],
    );
  });

  void notifyTreasury(
    'treasury.donation',
    'Пополнение казны',
    `${input.units.toFixed(2)} монет переведено казне`,
  );

  return { account: await getAccount(input.participantId), state: await getTreasuryState() };
}

