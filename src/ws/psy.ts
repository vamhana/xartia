// W.2.14.01 — Канал WS psy
// События по психоэкологии: сессии, наблюдатели, кризисы, разгрузка,
// благодарение, гигиена смыслов, обновление настроений, систематическое
// насилие. Broadcast для всех — без фильтрации.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн W.2.*):
// - registerPsyChannel() — регистрация обработчика. Только для WS-процесса.
// - emitPsyXxx() — публикация в Redis. Работает из любого процесса
//   (API, WS, worker). Не импортирует server.ts — только lib/redis.
//
// РЕГИСТРАЦИЯ: W.0.01.01 startWSServer() → registerPsyChannel().
// ПОДПИСКА (фронт): useWSSubscription('psy', handler).

import type { UUID, ISODateTime } from '../core/types.js';
import { logger } from '../lib/logger.js';
import { publish } from '../lib/redis.js';

// -------- Типы payload --------

export interface PsySessionPayload {
  id: UUID;
  participantId: UUID;
  psychologistId: UUID;
  type: 'onboarding' | 'crisis' | 'discharge' | 'resonance';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  scheduledAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface PsyObserverPayload {
  id: UUID;
  participantId: UUID;
  directionId: UUID;
  validFrom: ISODateTime;
}

export interface PsyCrisisPayload {
  id: UUID;
  participantId: UUID;
  status: 'open' | 'in_progress' | 'closed';
  createdAt: ISODateTime;
}

export interface PsyDischargePayload {
  id: UUID;
  participantId: UUID;
  days: number;
  status: 'scheduled' | 'in_progress' | 'completed';
  createdAt: ISODateTime;
}

export interface PsyWellbeingPayload {
  id: UUID;
  participantId: UUID;
  score: number;
  trend: 'up' | 'stable' | 'down';
}

export interface PsyHygienePayload {
  id: UUID;
  directionId: UUID;
  measure: string;
  status: 'proposed' | 'applied';
}

export interface PsyMoodPayload {
  directionId: UUID;
  metric: string;
  value: number;
  periodStart: ISODateTime;
  periodEnd: ISODateTime;
  kind: 'hour' | 'day';
}

export interface PsyViolencePayload {
  directionId: UUID;
  year: number;
  cases: number;
  signal: boolean;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:psy';

// -------- Регистрация --------

/**
 * Регистрирует обработчик канала psy. Вызывается только из WS-процесса
 * (src/ws/server.ts → startWSServer). API-процесс вызывает только emit-функции.
 */
export async function registerPsyChannel(): Promise<void> {
  // Обработчик — no-op. Клиенты сами реагируют на событие.
  // В будущем: серверная логика аудита, авто-уведомления психологам.
  logger.info({ channel: 'psy' }, 'ws: psy channel registered');
}

// -------- Emit --------

export async function emitPsySessionScheduled(
  session: PsySessionPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.session.scheduled',
      payload: session,
    });
  } catch (e) {
    logger.warn(
      { err: e, sessionId: session.id },
      'ws: emitPsySessionScheduled failed',
    );
    return 0;
  }
}

export async function emitPsySessionCompleted(
  session: PsySessionPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.session.completed',
      payload: session,
    });
  } catch (e) {
    logger.warn(
      { err: e, sessionId: session.id },
      'ws: emitPsySessionCompleted failed',
    );
    return 0;
  }
}

export async function emitPsyObserverAssigned(
  observer: PsyObserverPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.observer.assigned',
      payload: observer,
    });
  } catch (e) {
    logger.warn(
      { err: e, observerId: observer.id },
      'ws: emitPsyObserverAssigned failed',
    );
    return 0;
  }
}

export async function emitPsyObserverRemoved(
  observerId: UUID,
  directionId: UUID,
  removedBy: UUID,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.observer.removed',
      payload: {
        observerId,
        directionId,
        removedBy,
        removedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn(
      { err: e, observerId },
      'ws: emitPsyObserverRemoved failed',
    );
    return 0;
  }
}

export async function emitPsyCrisisStarted(
  crisis: PsyCrisisPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.crisis.started',
      payload: crisis,
    });
  } catch (e) {
    logger.warn(
      { err: e, crisisId: crisis.id },
      'ws: emitPsyCrisisStarted failed',
    );
    return 0;
  }
}

export async function emitPsyDischargeStarted(
  discharge: PsyDischargePayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.discharge.started',
      payload: discharge,
    });
  } catch (e) {
    logger.warn(
      { err: e, dischargeId: discharge.id },
      'ws: emitPsyDischargeStarted failed',
    );
    return 0;
  }
}

export async function emitPsyWellbeingRecorded(
  wellbeing: PsyWellbeingPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.wellbeing.recorded',
      payload: wellbeing,
    });
  } catch (e) {
    logger.warn(
      { err: e, participantId: wellbeing.participantId },
      'ws: emitPsyWellbeingRecorded failed',
    );
    return 0;
  }
}

export async function emitPsyHygieneProposed(
  hygiene: PsyHygienePayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.hygiene.proposed',
      payload: hygiene,
    });
  } catch (e) {
    logger.warn(
      { err: e, hygieneId: hygiene.id },
      'ws: emitPsyHygieneProposed failed',
    );
    return 0;
  }
}

export async function emitPsyMoodUpdated(
  mood: PsyMoodPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.mood.updated',
      payload: mood,
    });
  } catch (e) {
    logger.warn(
      { err: e, directionId: mood.directionId },
      'ws: emitPsyMoodUpdated failed',
    );
    return 0;
  }
}

export async function emitPsySystemicViolenceDetected(
  payload: PsyViolencePayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'psy.systemic_violence.detected',
      payload,
    });
  } catch (e) {
    logger.warn(
      { err: e, directionId: payload.directionId },
      'ws: emitPsySystemicViolenceDetected failed',
    );
    return 0;
  }
}