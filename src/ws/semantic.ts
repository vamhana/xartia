// W.2.08.01 — Канал WS semantic
// Дрейф, тревога, вето, доклад, давление. Приоритет высший.
// Страж не может быть скрыт или удалён (I.4.6).

import { logger } from '../lib/logger.js';

import { publish, sendToParticipant } from './_helpers.js';

const REDIS_CHANNEL = 'ws:broadcast:semantic';

export async function registerSemanticChannel(): Promise<void> {
  logger.info({ channel: 'semantic' }, 'ws: semantic channel registered');
}

export interface DriftPayload {
  id: string; term: string; severity: number;
  originalMeaning: string; detectedMeaning: string; detectedAt: string;
}
export interface AlarmPayload {
  id: string; driftId: string | null; priority: number;
  raisedBy: string; raisedAt: string;
}
export interface VetoPayload {
  id: string; type: 'semantic_guardian' | 'jury';
  decisionRef: string; reason: string;
  validFrom: string; validTo: string;
}

export async function emitDriftDetected(payload: DriftPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, { event: 'semantic.drift', payload });
  } catch (e) {
    logger.warn({ err: e, driftId: payload.id }, 'ws: emitDriftDetected failed');
  }
}

export async function emitAlarmRaised(payload: AlarmPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, { event: 'semantic.alarm', payload });
  } catch (e) {
    logger.warn({ err: e, alarmId: payload.id }, 'ws: emitAlarmRaised failed');
  }
}

export async function emitAlarmEscalated(
  alarmId: string,
  to: 'council' | 'forum' | 'referendum',
  at: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'semantic.alarm_escalated',
      payload: { alarmId, to, at },
    });
  } catch (e) {
    logger.warn({ err: e, alarmId }, 'ws: emitAlarmEscalated failed');
  }
}

export async function emitVetoImposed(payload: VetoPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, { event: 'semantic.veto', payload });
  } catch (e) {
    logger.warn({ err: e, vetoId: payload.id }, 'ws: emitVetoImposed failed');
  }
}

export async function emitVetoLifted(
  vetoId: string,
  reason: string,
  at: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'semantic.veto_lifted',
      payload: { vetoId, reason, at },
    });
  } catch (e) {
    logger.warn({ err: e, vetoId }, 'ws: emitVetoLifted failed');
  }
}

export async function emitReportPublished(
  year: number,
  at: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'semantic.report_published',
      payload: { year, at },
    });
  } catch (e) {
    logger.warn({ err: e, year }, 'ws: emitReportPublished failed');
  }
}

export async function emitPressureReported(
  description: string,
  alarmId: string,
  by: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'semantic.pressure_reported',
      payload: { alarmId, by, description, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, alarmId }, 'ws: emitPressureReported failed');
  }
}

// не используется, но оставлен для будущих сценариев:
void sendToParticipant;