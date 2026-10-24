// C.0.14.02 — Сервис Потоков
// Балансы, начисления, Капсула, возврат. Приветственный пакет.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  emitFlowCharged,
  emitCapsuleUpdated,
  emitBalanceUpdated,
} from '../../ws/flows.js';
import { logAction } from '../audit.js';
import { WELCOME_PACK, CAPSULE_MAX } from '../constants.js';
import { ConflictError } from '../errors.js';
import type { UUID, FlowType } from '../types.js';

import {
  validateCharge, calculateReturn, getReturnRate, isGentlePeriod,
  type FlowBalance, type FlowTransaction, type Capsule, type ChargeInput,
} from './entity.js';


// -------- Балансы --------

interface FlowRow {
  participant_id: string;
  type: FlowType;
  balance: string;
  updated_at: Date;
}

function rowToBalance(row: FlowRow): FlowBalance {
  return {
    participantId: row.participant_id,
    type: row.type,
    balance: parseFloat(row.balance),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getBalance(participantId: UUID, type?: FlowType): Promise<FlowBalance[]> {
  const params: unknown[] = [participantId];
  const where = type
    ? (params.push(type), `AND type = $${params.length}`)
    : '';

  const rows = await query<FlowRow>(
    `SELECT participant_id, type, balance::text AS balance, updated_at
       FROM flows
      WHERE participant_id = $1 ${where}
      ORDER BY type`,
    params,
  );
  return rows.map(rowToBalance);
}

async function emitBalanceRefresh(participantId: UUID): Promise<void> {
  try {
    const balances = await getBalance(participantId);
    await emitBalanceUpdated({
      participantId,
      balances: balances.map((b) => ({ type: b.type, balance: b.balance })),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // best-effort
  }
}

// -------- Начисление --------

export async function charge(input: ChargeInput, requesterId: UUID): Promise<FlowTransaction> {
  validateCharge(input);

  const id = newUUID();

  await transaction(async (client) => {
    // Триггер fn_update_flow_balance обновит flows
    await client.query(
      `INSERT INTO flow_transactions (id, participant_id, type, amount, reason, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.participantId, input.type, input.amount, input.reason, input.source],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'flows.charge', entityType: 'flow_transaction', entityId: id,
    newValue: { participant_id: input.participantId, amount: input.amount, type: input.type },
  });

  const result: FlowTransaction = {
    id,
    participantId: input.participantId,
    type: input.type,
    amount: input.amount,
    reason: input.reason,
    source: input.source,
    createdAt: new Date().toISOString(),
  };

  // WS-эмиссия: событие начисления + обновлённый баланс — получателю Потока.
  try {
    await emitFlowCharged({
      id: result.id,
      participantId: result.participantId,
      type: result.type,
      amount: result.amount,
      reason: result.reason,
      source: result.source,
      createdAt: result.createdAt,
    });
    await emitBalanceRefresh(result.participantId);
  } catch {
    // best-effort: транзакция уже закоммичена, событие не критично
  }

  return result;
}

// -------- Приветственный пакет --------

export async function grantWelcomePack(participantId: UUID): Promise<FlowTransaction> {
  return charge({
    participantId,
    type: 'main',
    amount: WELCOME_PACK,
    reason: 'Приветственный пакет',
    source: 'system',
  }, participantId);
}

// -------- Капсула --------

interface CapsuleRow {
  participant_id: string;
  balance: string;
  updated_at: Date;
}

function rowToCapsule(row: CapsuleRow): Capsule {
  return {
    participantId: row.participant_id,
    balance: parseFloat(row.balance),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getCapsule(participantId: UUID): Promise<Capsule> {
  const row = await queryOne<CapsuleRow>(
    `SELECT participant_id, balance::text AS balance, updated_at
       FROM capsules WHERE participant_id = $1`,
    [participantId],
  );
  if (row) {return rowToCapsule(row);}
  return {
    participantId,
    balance: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function depositCapsule(
  participantId: UUID, amount: number, requesterId: UUID,
): Promise<Capsule> {
  if (amount <= 0) {
    throw new ConflictError('Сумма должна быть > 0');
  }

  const capsuleId = newUUID();

  await transaction(async (client) => {
    // 1. Блокируем main-строку (даже если её нет — вернёт 0 строк)
    const mainRow = await client.query<{ balance: string }>(
      `SELECT balance::text AS balance FROM flows
        WHERE participant_id = $1 AND type = 'main'
        FOR UPDATE`,
      [participantId],
    );
    const mainBalance = parseFloat(mainRow.rows[0]?.balance ?? '0');
    if (mainBalance < amount) {
      throw new ConflictError(
        `Недостаточно Потоков на основном балансе (${mainBalance} < ${amount})`,
      );
    }

    // 2. Блокируем капсулу
    const capRow = await client.query<{ balance: string }>(
      `SELECT balance::text AS balance FROM capsules
        WHERE participant_id = $1
        FOR UPDATE`,
      [participantId],
    );
    const capBalance = parseFloat(capRow.rows[0]?.balance ?? '0');
    if (capBalance + amount > CAPSULE_MAX) {
      throw new ConflictError(
        `Капсула переполнена (${capBalance} + ${amount} > ${CAPSULE_MAX})`,
      );
    }

    // 3. Обновляем капсулу
    await client.query(
      `INSERT INTO capsules (id, participant_id, balance, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (participant_id)
       DO UPDATE SET balance = capsules.balance + $3, updated_at = now()`,
      [capsuleId, participantId, amount],
    );

    // 4. Списываем с main
    await client.query(
      `INSERT INTO flow_transactions (participant_id, type, amount, reason, source)
       VALUES ($1, 'main', $2, 'Пополнение Капсулы', 'capsule')`,
      [participantId, -amount],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'flows.capsule.deposit', entityType: 'capsule', entityId: participantId,
    newValue: { amount },
  });

  const updated = await getCapsule(participantId);
  try {
    await emitCapsuleUpdated({
      participantId: updated.participantId,
      balance: updated.balance,
      updatedAt: updated.updatedAt,
    });
    await emitBalanceRefresh(participantId);
  } catch {
    // best-effort: транзакция уже закоммичена
  }

  return updated;
}

export async function withdrawCapsule(
  participantId: UUID, amount: number, requesterId: UUID,
): Promise<Capsule> {
  if (amount <= 0) {throw new ConflictError('Сумма должна быть > 0');}

  await transaction(async (client) => {
    const capRow = await client.query<{ balance: string }>(
      `SELECT balance::text AS balance FROM capsules
        WHERE participant_id = $1
        FOR UPDATE`,
      [participantId],
    );
    const capBalance = parseFloat(capRow.rows[0]?.balance ?? '0');
    if (capBalance < amount) {
      throw new ConflictError(`Недостаточно Потоков в Капсуле (${capBalance} < ${amount})`);
    }

    await client.query(
      `UPDATE capsules SET balance = balance - $2, updated_at = now() WHERE participant_id = $1`,
      [participantId, amount],
    );
    await client.query(
      `INSERT INTO flow_transactions (participant_id, type, amount, reason, source)
       VALUES ($1, 'main', $2, 'Снятие из Капсулы', 'capsule')`,
      [participantId, amount],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'flows.capsule.withdraw', entityType: 'capsule', entityId: participantId,
    newValue: { amount },
  });

  const updated = await getCapsule(participantId);
  try {
    await emitCapsuleUpdated({
      participantId: updated.participantId,
      balance: updated.balance,
      updatedAt: updated.updatedAt,
    });
    await emitBalanceRefresh(participantId);
  } catch {
    // best-effort: транзакция уже закоммичена
  }

  return updated;
}

// -------- Возвраты --------

export async function getReturns(participantId: UUID): Promise<{
  percent: number;
  nextReturnAt: string | null;
  status: string;
} | null> {
  const row = await queryOne<{
    percent: string;
    next_return_at: Date;
    status: string;
  }>(
    `SELECT percent::text AS percent, next_return_at, status
       FROM flow_returns WHERE participant_id = $1`,
    [participantId],
  );
  if (!row) {return null;}
  return {
    percent: parseFloat(row.percent),
    nextReturnAt: row.next_return_at.toISOString(),
    status: row.status,
  };
}

// -------- Резервы --------

export async function getDeferredFlow(): Promise<{ totalVolume: number; distributed: number; available: number }> {
  const row = await queryOne<{ total_volume: string; distributed: string; available: string }>(
    `SELECT total_volume::text, distributed::text, available::text FROM deferred_flow LIMIT 1`,
  );
  return {
    totalVolume: parseFloat(row?.total_volume ?? '0'),
    distributed: parseFloat(row?.distributed ?? '0'),
    available: parseFloat(row?.available ?? '0'),
  };
}

export async function getFreedomReserve(): Promise<{ totalVolume: number; accessible: boolean }> {
  const row = await queryOne<{ total_volume: string; accessible: boolean }>(
    `SELECT total_volume::text, accessible FROM freedom_reserve LIMIT 1`,
  );
  return {
    totalVolume: parseFloat(row?.total_volume ?? '0'),
    accessible: row?.accessible ?? true,
  };
}

export async function getPlanetaryReserve(): Promise<{ totalVolume: number; distributed: number }> {
  const row = await queryOne<{ total_volume: string; distributed: string }>(
    `SELECT total_volume::text, distributed::text FROM planetary_reserve LIMIT 1`,
  );
  return {
    totalVolume: parseFloat(row?.total_volume ?? '0'),
    distributed: parseFloat(row?.distributed ?? '0'),
  };
}

// -------- Экспорт для OTC --------

export async function awardForAcceptedTask(
  participantId: UUID, taskId: UUID, otcId: UUID,
): Promise<FlowTransaction> {
  return charge({
    participantId,
    type: 'main',
    amount: 1,
    reason: `Приёмка задачи ${taskId}`,
    source: 'otc',
  }, otcId);
}

// Экспорт из entity для использования
export { getReturnRate, isGentlePeriod, calculateReturn };