// W.2.03.01 — Канал WS otc
// События ОТК: новый отчёт, приёмка/возврат, апелляция, кризисный протокол.
// Персональные + направленные. Кризисный протокол → обязательное уведомление Верификации.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ (единый паттерн W.2.*):
// - registerOtcChannel() — только для WS-процесса.
// - emitOtcXxx() — публикация в Redis. Работает из API.

import type { UUID } from '../core/types.js';
import { logger } from '../lib/logger.js';
import { redisPub } from '../lib/redis.js';

import {
  publish,
  sendToParticipant,
  sendToDirection,
} from './_helpers.js';

// -------- Типы --------

export interface OtcReportPayload {
  reportId: string;
  taskId: string;
  taskExternalId: string;
  directionId: string;
  authorId: string;
  type: string;
  createdAt: string;
}

export interface OtcDecisionPayload {
  decisionId: string;
  reportId: string;
  taskId: string;
  taskExternalId: string;
  directionId: string;
  otcId: string;
  verdict: 'accepted' | 'returned' | 'crisis_protocol';
  comment: string | null;
  assignedTo: string | null;
  decidedAt: string;
}

export interface OtcAppealPayload {
  appealId: string;
  decisionId: string;
  participantId: string;
  directionId: string;
  reason: string;
  filedAt: string;
}

// -------- Redis-канал --------

const REDIS_CHANNEL = 'ws:broadcast:otc';

// -------- Регистрация --------

export async function registerOtcChannel(): Promise<void> {
  logger.info({ channel: 'otc' }, 'ws: otc channel registered');
}

// -------- Emit --------

export async function emitReportSubmitted(
  report: OtcReportPayload,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'otc.report_submitted',
      payload: report,
    });

    // ОТК направления — чтобы очередь пополнилась мгновенно.
    await sendToDirection(report.directionId, 'otc.report_submitted.for_otc', {
      reportId: report.reportId,
      taskId: report.taskId,
      taskExternalId: report.taskExternalId,
      authorId: report.authorId,
      type: report.type,
      submittedAt: report.createdAt,
    });
  } catch (e) {
    logger.warn({ err: e, reportId: report.reportId }, 'ws: emitReportSubmitted failed');
  }
}

export async function emitDecisionMade(
  decision: OtcDecisionPayload,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'otc.decision_made',
      payload: decision,
    });

    // Исполнителю — результат приёмки.
    if (decision.assignedTo) {
      await sendToParticipant(decision.assignedTo, 'otc.decision_made.personal', {
        taskId: decision.taskId,
        taskExternalId: decision.taskExternalId,
        verdict: decision.verdict,
        comment: decision.comment,
        at: decision.decidedAt,
      });
    }
  } catch (e) {
    logger.warn({ err: e, decisionId: decision.decisionId }, 'ws: emitDecisionMade failed');
  }
}

export async function emitCrisisDecisionMade(
  decision: OtcDecisionPayload,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'otc.crisis_decision',
      payload: decision,
    });

    // Исполнителю — персонально.
    if (decision.assignedTo) {
      await sendToParticipant(decision.assignedTo, 'otc.crisis_decision.personal', {
        taskId: decision.taskId,
        taskExternalId: decision.taskExternalId,
        verdict: decision.verdict,
        at: decision.decidedAt,
      });
    }

    // Верификация — обязательное уведомление для пост-аудита (I.2.9.1в).
    const verifierIds = await listParticipantsWithRole('VERIFIER');
    for (const vid of verifierIds) {
      await sendToParticipant(vid, 'otc.crisis_decision.for_audit', {
        decisionId: decision.decisionId,
        taskId: decision.taskId,
        taskExternalId: decision.taskExternalId,
        otcId: decision.otcId,
        at: decision.decidedAt,
      });
    }
  } catch (e) {
    logger.warn({ err: e, decisionId: decision.decisionId }, 'ws: emitCrisisDecisionMade failed');
  }
}

export async function emitAppealFiled(
  appeal: OtcAppealPayload,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'otc.appeal_filed',
      payload: appeal,
    });

    // Совет направления — для рассмотрения апелляции (I.2.13).
    const councilIds = await listParticipantsWithRole('COUNCIL_MEMBER', appeal.directionId);
    for (const cid of councilIds) {
      await sendToParticipant(cid, 'otc.appeal_filed.for_council', {
        appealId: appeal.appealId,
        decisionId: appeal.decisionId,
        reason: appeal.reason,
        filedAt: appeal.filedAt,
      });
    }
  } catch (e) {
    logger.warn({ err: e, appealId: appeal.appealId }, 'ws: emitAppealFiled failed');
  }
}

export async function emitQueueUpdated(
  directionId: string,
  queueSize: number,
): Promise<void> {
  try {
    await publish(REDIS_CHANNEL, {
      event: 'otc.queue_updated',
      payload: {
        directionId,
        queueSize,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    logger.warn({ err: e, directionId, queueSize }, 'ws: emitQueueUpdated failed');
  }
}

// -------- Хелпер: список участников с ролью --------

async function listParticipantsWithRole(
  role: 'VERIFIER' | 'COUNCIL_MEMBER',
  directionId?: string,
): Promise<string[]> {
  try {
    const { listParticipantsWithRole: rbacList } = await import('../security/rbac.js');
    if (directionId) {
      return await rbacList(role as never, directionId as UUID);
    }
    return await rbacList(role as never);
  } catch (e) {
    logger.warn({ err: e, role }, 'ws: listParticipantsWithRole failed');
    return [];
  }
}

// `redisPub` импортирован, но не используется — оставлено для консистентности
// с другими W.2.* (в будущем может понадобиться для локального publish).
void redisPub;