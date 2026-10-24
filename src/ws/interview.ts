// W.2.13.01 — Канал WS interview.src\ws\interview.ts
// WebRTC signaling + события сессии интервью.
// Комната per-interview: ws:broadcast:interview:<id>.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// - Комната изолирована по interview_id (или requestId до создания участника).
// - Клиенты (СИ, Ноология, наблюдатели) подписываются явно.
// - Сервер не участвует в медиа-потоке — только signaling.
// - Запись — на клиенте interviewer'а, потом upload в S3.

import { logger } from '../lib/logger.js';

import { publish, sendToParticipant } from './_helpers.js';

function roomChannel(interviewId: string): string {
  return `ws:broadcast:interview:${interviewId}`;
}

export async function registerInterviewChannel(): Promise<void> {
  logger.info({}, 'ws: interview channel registered (per-room)');
}

export interface SignalPayload {
  interviewId: string;
  fromConnectionId: string;
  data: unknown;
}

export async function emitOffer(payload: SignalPayload): Promise<number> {
  try {
    return await publish(roomChannel(payload.interviewId), {
      event: 'interview.offer',
      payload: {
        interviewId: payload.interviewId,
        fromConnectionId: payload.fromConnectionId,
        offer: payload.data,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId: payload.interviewId }, 'ws: emitOffer failed');
    return 0;
  }
}

export async function emitAnswer(payload: SignalPayload): Promise<number> {
  try {
    return await publish(roomChannel(payload.interviewId), {
      event: 'interview.answer',
      payload: {
        interviewId: payload.interviewId,
        fromConnectionId: payload.fromConnectionId,
        answer: payload.data,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId: payload.interviewId }, 'ws: emitAnswer failed');
    return 0;
  }
}

export async function emitIceCandidate(payload: SignalPayload): Promise<number> {
  try {
    return await publish(roomChannel(payload.interviewId), {
      event: 'interview.ice_candidate',
      payload: {
        interviewId: payload.interviewId,
        fromConnectionId: payload.fromConnectionId,
        candidate: payload.data,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId: payload.interviewId }, 'ws: emitIceCandidate failed');
    return 0;
  }
}

export async function emitRecordingStarted(
  interviewId: string,
  recorderId: string,
): Promise<number> {
  try {
    return await publish(roomChannel(interviewId), {
      event: 'interview.recording_started',
      payload: { interviewId, recorderId, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId }, 'ws: emitRecordingStarted failed');
    return 0;
  }
}

export async function emitRecordingStopped(
  interviewId: string,
  recordingUrl: string,
): Promise<number> {
  try {
    return await publish(roomChannel(interviewId), {
      event: 'interview.recording_stopped',
      payload: { interviewId, recordingUrl, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId }, 'ws: emitRecordingStopped failed');
    return 0;
  }
}

export async function emitInterviewEnded(
  interviewId: string,
  reason: string,
): Promise<number> {
  try {
    return await publish(roomChannel(interviewId), {
      event: 'interview.ended',
      payload: { interviewId, reason, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId }, 'ws: emitInterviewEnded failed');
    return 0;
  }
}

export async function emitTranscriptReady(
  interviewId: string,
  transcript: string,
): Promise<number> {
  try {
    return await publish(roomChannel(interviewId), {
      event: 'interview.transcript_ready',
      payload: {
        interviewId,
        transcriptLength: transcript.length,
        transcript,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId }, 'ws: emitTranscriptReady failed');
    return 0;
  }
}

export async function emitScoreReady(
  interviewId: string,
  scores: Record<string, number>,
  verdict: string,
): Promise<number> {
  try {
    return await publish(roomChannel(interviewId), {
      event: 'interview.score_ready',
      payload: { interviewId, scores, verdict, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, interviewId }, 'ws: emitScoreReady failed');
    return 0;
  }
}

/**
 * Персональное уведомление interviewer'у — используется при исчерпании
 * лимита Цифрового наставника или при передаче в human-ментора.
 */
export async function notifyInterviewer(
  interviewerId: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  try {
    const res = await sendToParticipant(interviewerId, event, payload);
    return res > 0;
  } catch (e) {
    logger.warn({ err: e, interviewerId, event }, 'ws: notifyInterviewer failed');
    return false;
  }
}