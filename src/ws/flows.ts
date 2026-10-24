// W.2.04.01 — Канал WS flows
// Персональные события по Потокам: начисление, возврат, Капсула, баланс.
// ТОЛЬКО sendToParticipant — не broadcast. Иначе чужие балансы утекают подписчикам.

import type { FlowType } from '../core/types.js';
import { logger } from '../lib/logger.js';

import { sendToParticipant } from './_helpers.js';

// -------- Типы --------

export interface FlowTransactionPayload {
  id: string;
  participantId: string;
  type: FlowType;
  amount: number;
  reason: string;
  source: string | null;
  createdAt: string;
}

export interface CapsulePayload {
  participantId: string;
  balance: number;
  updatedAt: string;
}

export interface BalancePayload {
  participantId: string;
  balances: Array<{ type: FlowType; balance: number }>;
  updatedAt: string;
}

// -------- Регистрация --------

export async function registerFlowChannel(): Promise<void> {
  logger.info({ channel: 'flows' }, 'ws: flows channel registered (personal-only)');
}

// -------- Emit --------

export async function emitFlowCharged(tx: FlowTransactionPayload): Promise<void> {
  try {
    await sendToParticipant(tx.participantId, 'flow.charged', {
      transactionId: tx.id,
      type: tx.type,
      amount: tx.amount,
      reason: tx.reason,
      source: tx.source,
      at: tx.createdAt,
    });
  } catch (e) {
    logger.warn({ err: e, transactionId: tx.id }, 'ws: emitFlowCharged failed');
  }
}
/**
 * TODO: вызывается из cron-задачи `processReturns` (см. C.0.14.02).
 * Функция `processReturns` пока не реализована — вернёмся к этому
 * при задаче «cron возврата Потоков в резерв».
 */
export async function emitFlowReturned(
  participantId: string,
  returned: number,
  remaining: number,
): Promise<void> {
  try {
    await sendToParticipant(participantId, 'flow.returned', {
      returned,
      remaining,
      at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, participantId }, 'ws: emitFlowReturned failed');
  }
}

export async function emitCapsuleUpdated(capsule: CapsulePayload): Promise<void> {
  try {
    await sendToParticipant(capsule.participantId, 'capsule.updated', {
      balance: capsule.balance,
      updatedAt: capsule.updatedAt,
    });
  } catch (e) {
    logger.warn({ err: e, participantId: capsule.participantId }, 'ws: emitCapsuleUpdated failed');
  }
}

export async function emitBalanceUpdated(payload: BalancePayload): Promise<void> {
  try {
    await sendToParticipant(payload.participantId, 'balance.updated', {
      balances: payload.balances,
      updatedAt: payload.updatedAt,
    });
  } catch (e) {
    logger.warn({ err: e, participantId: payload.participantId }, 'ws: emitBalanceUpdated failed');
  }
}