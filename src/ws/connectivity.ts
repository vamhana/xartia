// W.2.07.01 — Канал WS connectivity
// События Коннективности: queued, routed, overdue, escalated, deadline_approaching.
// Broadcast в канал + направленное уведомление целевому Совету/Связному.

import type { Priority } from '../core/types.js';
import { logger } from '../lib/logger.js';

import { publish, sendToDirection } from './_helpers.js';

export interface ConnectivityItemPayload {
  id: string;
  signalId: string;
  currentDirectionId: string | null;
  targetDirectionId: string | null;
  priority: Priority;
  deadline: string;
  status: string;
  iterations: number;
  createdAt: string;
  routedAt: string | null;
  escalatedAt: string | null;
}

const REDIS_CHANNEL = 'ws:broadcast:connectivity';

export async function registerConnectivityChannel(): Promise<void> {
  logger.info({ channel: 'connectivity' }, 'ws: connectivity channel registered');
}

/**
 * TODO: вызывается из `routeSignal`, когда item переходит в статус 'queued'
 * (сейчас сразу 'routed'). Также для будущего сценария префильтрации,
 * когда сигнал попадает в очередь ожидания.
 */
export async function emitItemQueued(item: ConnectivityItemPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'connectivity.queued',
      payload: item,
    });
    if (item.targetDirectionId) {
      await sendToDirection(item.targetDirectionId, 'connectivity.queued.for_direction', {
        itemId: item.id,
        signalId: item.signalId,
        priority: item.priority,
        deadline: item.deadline,
      });
    }
  } catch (e) {
    logger.warn({ err: e, itemId: item.id }, 'ws: emitItemQueued failed');
  }
}

export async function emitItemRouted(item: ConnectivityItemPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'connectivity.routed',
      payload: item,
    });
    if (item.targetDirectionId) {
      await sendToDirection(item.targetDirectionId, 'connectivity.routed.for_direction', {
        itemId: item.id,
        signalId: item.signalId,
        priority: item.priority,
        deadline: item.deadline,
      });
    }
  } catch (e) {
    logger.warn({ err: e, itemId: item.id }, 'ws: emitItemRouted failed');
  }
}

export async function emitItemOverdue(item: ConnectivityItemPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'connectivity.overdue',
      payload: item,
    });
    if (item.currentDirectionId) {
      await sendToDirection(item.currentDirectionId, 'connectivity.overdue.for_direction', {
        itemId: item.id,
        signalId: item.signalId,
        deadline: item.deadline,
      });
    }
    // Балансировка — сигнал о просрочке (I.2.4).
    if (item.targetDirectionId) {
      await sendToDirection(item.targetDirectionId, 'connectivity.overdue.for_balance', {
        itemId: item.id,
        priority: item.priority,
        deadline: item.deadline,
      });
    }
  } catch (e) {
    logger.warn({ err: e, itemId: item.id }, 'ws: emitItemOverdue failed');
  }
}

export async function emitItemEscalated(
  item: ConnectivityItemPayload,
  arbitrationId: string | null,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'connectivity.escalated',
      payload: { item, arbitrationId },
    });
    if (item.targetDirectionId) {
      await sendToDirection(item.targetDirectionId, 'connectivity.escalated.for_direction', {
        itemId: item.id,
        signalId: item.signalId,
        iterations: item.iterations,
        arbitrationId,
      });
    }
  } catch (e) {
    logger.warn({ err: e, itemId: item.id }, 'ws: emitItemEscalated failed');
  }
}
/**
 * TODO: вызывается из `checkTimeouts` (cron) после расширения сигнатуры
 * функции до `{notified, overdue, escalated}`. Пока тестируется напрямую.
 */
export async function emitDeadlineApproaching(
  item: ConnectivityItemPayload,
  percent: number,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'connectivity.deadline_approaching',
      payload: { item, percent, at: new Date().toISOString() },
    });
    if (item.targetDirectionId) {
      await sendToDirection(item.targetDirectionId, 'connectivity.deadline_approaching.for_direction', {
        itemId: item.id,
        signalId: item.signalId,
        priority: item.priority,
        deadline: item.deadline,
        percent,
      });
    }
  } catch (e) {
    logger.warn({ err: e, itemId: item.id }, 'ws: emitDeadlineApproaching failed');
  }
}