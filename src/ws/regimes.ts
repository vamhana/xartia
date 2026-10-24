// W.2.05.01 — Канал WS regimes
// События по режимам: активация, деактивация, аудит, квант ускорения, инфоблокада.
// Broadcast для всех — без фильтрации (все должны знать о режиме).
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн для всех W.2.*):
// - registerRegimeChannel() — регистрация обработчика. Только для WS-процесса.
// - emitRegimeXxx() — публикация в Redis. Работает из любого процесса
//   (API, WS, worker). Не импортирует server.ts — только lib/redis.

import type { RegimeType, Priority } from '../core/types.js';
import { logger } from '../lib/logger.js';
import { publish } from '../lib/redis.js';

// -------- Типы --------

export interface RegimeEventPayload {
  id: string;
  type: RegimeType;
  directionId?: string | null;
  activatedBy?: string;
  activatedAt?: string;
  deactivatedAt?: string | null;
  reason?: string | null;
  status: string;
  auditSchedule?: string | null;
  maxDuration?: string | null;
}

export interface RegimeAuditPayload {
  regimeId: string;
  type: RegimeType;
  findings: string[];
  auditedAt: string;
  nextAuditAt: string | null;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:regimes';

// -------- Регистрация --------

/**
 * Регистрирует обработчик событий канала regimes. Вызывается только из
 * WS-процесса (src/ws/server.ts → startWSServer). API-процесс вызывает
 * только emit-функции.
 */
export async function registerRegimeChannel(): Promise<void> {
  // Обработчик — no-op. Клиенты сами реагируют на событие.
  // В будущем: серверная логика аудита, авто-уведомления.
  logger.info({ channel: 'regimes' }, 'ws: regimes channel registered');
}

// -------- Emit --------

export async function emitRegimeActivated(
  regime: RegimeEventPayload,
): Promise<number> {
  try {
    const receivers = await publish(REDIS_CHANNEL, {
      event: 'regime.activated',
      payload: regime,
    });
    logger.info(
      { regimeId: regime.id, type: regime.type, receivers },
      'ws: emitRegimeActivated',
    );
    return receivers;
  } catch (e) {
    logger.warn(
      { err: e, regimeId: regime.id, type: regime.type },
      'ws: emitRegimeActivated failed',
    );
    return 0;
  }
}

export async function emitRegimeDeactivated(
  regimeId: string,
  regimeType: RegimeType,
  reason: string,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'regime.deactivated',
      payload: {
        regimeId,
        type: regimeType,
        reason,
        deactivatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, regimeId }, 'ws: emitRegimeDeactivated failed');
    return 0;
  }
}

export async function emitRegimeAudited(
  payload: RegimeAuditPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'regime.audited',
      payload,
    });
  } catch (e) {
    logger.warn({ err: e, regimeId: payload.regimeId }, 'ws: emitRegimeAudited failed');
    return 0;
  }
}

export async function emitQuantumAccelerationActivated(
  baseDeadlines: Record<Priority, number>,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'quantum_acceleration.activated',
      payload: {
        baseDeadlines,
        acceleratedDeadlines: {
          critical: Math.floor(baseDeadlines.critical / 10),
          high: Math.floor(baseDeadlines.high / 10),
          standard: Math.floor(baseDeadlines.standard / 10),
          background: Math.floor(baseDeadlines.background / 10),
        },
        activatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e }, 'ws: emitQuantumAccelerationActivated failed');
    return 0;
  }
}

export async function emitInfoBlockadeActivated(
  regime: RegimeEventPayload,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'info_blockade.activated',
      payload: regime,
    });
  } catch (e) {
    logger.warn({ err: e, regimeId: regime.id }, 'ws: emitInfoBlockadeActivated failed');
    return 0;
  }
}

export async function emitInfoBlockadeLifted(
  regimeId: string,
  reason: string,
): Promise<number> {
  try {
    return await publish(REDIS_CHANNEL, {
      event: 'info_blockade.lifted',
      payload: {
        regimeId,
        reason,
        liftedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, regimeId }, 'ws: emitInfoBlockadeLifted failed');
    return 0;
  }
}