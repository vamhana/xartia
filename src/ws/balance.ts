// W.2.09.01 — Канал WS balance
// Аномалии, мета-запросы, нормативы, риски, индексы, пульс.

import type {
  Anomaly, CompetenceRisk, GuardianIndex,
} from '../core/balance/entity.js';
import { logger } from '../lib/logger.js';

import { publish } from './_helpers.js';

const REDIS_CHANNEL = 'ws:broadcast:balance';

export async function registerBalanceChannel(): Promise<void> {
  logger.info({ channel: 'balance' }, 'ws: balance channel registered');
}

export async function emitAnomalyDetected(anomaly: Anomaly): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.anomaly',
      payload: anomaly,
    });
  } catch (e) {
    logger.warn({ err: e, anomalyId: anomaly.id }, 'ws: emitAnomalyDetected failed');
  }
}

export async function emitAnomalyResolved(
  anomalyId: string,
  directionId: string,
  type: string,
  by: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.anomaly_resolved',
      payload: { anomalyId, directionId, type, resolvedBy: by, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, anomalyId }, 'ws: emitAnomalyResolved failed');
  }
}

export async function emitMetaRequest(
  metaRequestId: string,
  anomalyId: string,
  targetDirections: string[],
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.meta_request',
      payload: { metaRequestId, anomalyId, targetDirections, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, metaRequestId }, 'ws: emitMetaRequest failed');
  }
}

export async function emitNormativeSpeedsUpdated(updated: number): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.norms_updated',
      payload: { updated, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e }, 'ws: emitNormativeSpeedsUpdated failed');
  }
}

export async function emitCompetenceRisk(
  risk: CompetenceRisk,
  action: 'added' | 'removed',
  by: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.competence_risk',
      payload: { risk, action, by, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, riskId: risk.id }, 'ws: emitCompetenceRisk failed');
  }
}

export async function emitExcessCapacity(index: number): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.excess_capacity',
      payload: { index, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, index }, 'ws: emitExcessCapacity failed');
  }
}

export async function emitPulseUpdated(
  directionId: string | null,
  metrics: Record<string, number>,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'balance.pulse_updated',
      payload: { directionId, metrics, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, directionId }, 'ws: emitPulseUpdated failed');
  }
}

// Резерв для будущих cron
void ((_: GuardianIndex) => _);