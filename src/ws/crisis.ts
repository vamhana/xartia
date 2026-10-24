// W.2.06.01 — Канал WS crisis
// События мобилизации: старт, подтверждение, отказ, завершение.
// Полноэкранное уведомление у клиента. Приоритет высший.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн W.2.*):
// - registerCrisisChannel() — только для WS-процесса.
// - emitCrisisXxx() — публикация в Redis. Работает из API/worker.
// - Формат сообщения совместим с W.0.01.01 (dispatchFromRedis).

import { logger } from '../lib/logger.js';
import { publish } from '../lib/redis.js';

// -------- Типы --------

export interface CrisisMobilizationPayload {
  id: string;
  regimeId: string;
  requiredCount: number;
  confirmedCount: number;
  refusedCount: number;
  thresholdPercent: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface CrisisPlanPayload {
  planId: string;
  title: string;
  points: Array<{ lat: number; lon: number; label?: string }>;
}

export interface CrisisGatheringPoint {
  lat: number;
  lon: number;
  label?: string;
  etaMinutes?: number;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:crisis';

// -------- Регистрация --------

export async function registerCrisisChannel(): Promise<void> {
  // Обработчик — no-op. Клиент реагирует на событие (full-screen UI).
  logger.info({ channel: 'crisis' }, 'ws: crisis channel registered');
}

// -------- Emit --------

export async function emitMobilizationStarted(
  mobilization: CrisisMobilizationPayload,
  plan: CrisisPlanPayload,
): Promise<number> {
  try {
    const receivers = await publish(REDIS_CHANNEL, {
      event: 'crisis.mobilization_started',
      payload: { mobilization, plan },
    });
    logger.warn(
      {
        mobilizationId: mobilization.id,
        requiredCount: mobilization.requiredCount,
        thresholdPercent: mobilization.thresholdPercent,
        receivers,
      },
      'ws: emitMobilizationStarted',
    );
    return receivers;
  } catch (e) {
    logger.error({ err: e, mobilizationId: mobilization.id }, 'ws: emitMobilizationStarted failed');
    return 0;
  }
}

export async function emitMobilizationConfirmed(
  mobilizationId: string,
  confirmedCount: number,
  requiredCount: number,
  percent: number,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'crisis.mobilization_confirmed',
      payload: {
        mobilizationId,
        confirmedCount,
        requiredCount,
        percent,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, mobilizationId }, 'ws: emitMobilizationConfirmed failed');
    return 0;
  }
}

export async function emitMobilizationRefused(
  mobilizationId: string,
  refusedCount: number,
  percent: number,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'crisis.mobilization_refused',
      payload: {
        mobilizationId,
        refusedCount,
        percent,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, mobilizationId }, 'ws: emitMobilizationRefused failed');
    return 0;
  }
}

export async function emitMobilizationCompleted(
  mobilizationId: string,
  stats: { confirmedCount: number; refusedCount: number; totalParticipants: number },
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'crisis.mobilization_completed',
      payload: {
        mobilizationId,
        ...stats,
        completedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, mobilizationId }, 'ws: emitMobilizationCompleted failed');
    return 0;
  }
}

export async function emitCrisisPlanActivated(
  planId: string,
  title: string,
  points: CrisisGatheringPoint[],
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'crisis.plan_activated',
      payload: {
        planId,
        title,
        points,
        activatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, planId }, 'ws: emitCrisisPlanActivated failed');
    return 0;
  }
}