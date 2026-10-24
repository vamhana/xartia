// C.0.09.01 — Доменная сущность ОТК-решение

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';
export type OtcVerdict = 'accepted' | 'returned' | 'crisis_protocol';

export interface OtcDecision {
  id: UUID;
  reportId: UUID;
  otcId: UUID;
  verdict: OtcVerdict;
  comment: string | null;
  criteriaVersion: number;
  crisisProtocol: boolean;
  createdAt: ISODateTime;
}

export type OtcAppealStatus = 'filed' | 'reviewed' | 'resolved';

export interface OtcAppeal {
  id: UUID;
  decisionId: UUID;
  participantId: UUID;
  reason: string;
  status: OtcAppealStatus;
  reviewedBy: UUID | null;
  result: string | null;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
}

export function createAppeal(
  decisionId: UUID,
  participantId: UUID,
  reason: string,
): OtcAppeal {
  if (!reason.trim()) {
    throw new ValidationError('Причина апелляции обязательна');
  }
  if (reason.length > 5000) {
    throw new ValidationError('Причина не более 5000 символов');
  }
  return {
    id: crypto.randomUUID(),
    decisionId,
    participantId,
    reason: reason.trim(),
    status: 'filed',
    reviewedBy: null,
    result: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

export function canBeAppealed(
  decision: OtcDecision,
  hasActiveAppeal: boolean,
): { allowed: boolean; reason?: string } {
  if (decision.crisisProtocol) {
    return {
      allowed: false,
      reason: 'Кризисный протокол не подлежит апелляции (I.2.9.1в)',
    };
  }
  if (hasActiveAppeal) {
    return {
      allowed: false,
      reason: 'Апелляция уже подана и рассматривается',
    };
  }
  return { allowed: true };
}

export function isCrisisProtocol(d: OtcDecision): boolean {
  return d.crisisProtocol;
}

export function createDecision(
  reportId: UUID,
  otcId: UUID,
  verdict: OtcVerdict,
  comment: string | null,
  criteriaVersion = 1,
): OtcDecision {
  return {
    id: crypto.randomUUID(),
    reportId,
    otcId,
    verdict,
    comment,
    criteriaVersion,
    crisisProtocol: verdict === 'crisis_protocol',
    createdAt: new Date().toISOString(),
  };
}

export function createCrisisDecision(
  reportId: UUID,
  otcId: UUID,
  functionalityOk: boolean,
  safetyOk: boolean,
): OtcDecision {
  const accepted = functionalityOk && safetyOk;
  return createDecision(
    reportId,
    otcId,
    accepted ? 'crisis_protocol' : 'returned',
    accepted ? 'Принято в кризисном режиме' : 'Возвращено (кризисная проверка)',
  );
}