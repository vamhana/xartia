// W.2.01.01 — Канал WS signals
// События по сигналам: создание, обновление, эскалация, ответ, Коннект,
// смена ведущего направления.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн W.2.*):
// - registerSignalChannel() — только для WS-процесса.
// - emitSignalXxx() — публикация в Redis. Работает из API/worker.
// - Broadcast в канал 'signals'. Клиенты фильтруют у себя по направлениям.

import type { Priority, SignalType, SignalStatus, SignalResponseType } from '../core/types.js';
import { logger } from '../lib/logger.js';

import { publish, sendToParticipant } from './_helpers.js';

// -------- Типы --------

export interface SignalEventPayload {
  id: string;
  externalId: string;
  initiatorId: string;
  type: SignalType;
  description: string;
  justification: string;
  directions: string[];
  priority: Priority;
  status: SignalStatus;
  iterations: number;
  leadDirectionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseEventPayload {
  id: string;
  signalId: string;
  directionId: string;
  response: SignalResponseType;
  justification: string;
  createdAt: string;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:signals';

// -------- Регистрация --------

export async function registerSignalChannel(): Promise<void> {
  logger.info({ channel: 'signals' }, 'ws: signals channel registered');
}

// -------- Emit --------

export async function emitSignalCreated(signal: SignalEventPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.created',
      payload: signal,
    });

    // Дополнительно — персональное уведомление инициатору (мгновенный feedback).
    await sendToParticipant(signal.initiatorId, 'signal.created.ack', {
      signalId: signal.id,
      externalId: signal.externalId,
      at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, signalId: signal.id }, 'ws: emitSignalCreated failed');
  }
}

export async function emitSignalUpdated(signal: SignalEventPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.updated',
      payload: signal,
    });
  } catch (e) {
    logger.warn({ err: e, signalId: signal.id }, 'ws: emitSignalUpdated failed');
  }
}

export async function emitSignalEscalated(
  signalId: string,
  externalId: string,
  iterations: number,
  arbitrationId: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.escalated',
      payload: {
        signalId,
        externalId,
        iterations,
        arbitrationId,
        escalatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, signalId }, 'ws: emitSignalEscalated failed');
  }
}

export async function emitResponseAdded(response: ResponseEventPayload): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.response_added',
      payload: response,
    });
  } catch (e) {
    logger.warn({ err: e, signalId: response.signalId }, 'ws: emitResponseAdded failed');
  }
}

export async function emitConnectionStarted(
  signalId: string,
  connectionId: string,
  moderatorId: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.connection_started',
      payload: {
        signalId,
        connectionId,
        moderatorId,
        startedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, signalId, connectionId }, 'ws: emitConnectionStarted failed');
  }
}

export async function emitLeadDirectionSet(
  signalId: string,
  directionId: string,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'signal.lead_direction_set',
      payload: {
        signalId,
        directionId,
        setAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, signalId, directionId }, 'ws: emitLeadDirectionSet failed');
  }
}