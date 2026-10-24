// C.0.22.01 — Доменная сущность Жюри
// Случайная выборка. Не постоянный орган. 12 или 24.
// Вето на решения, затрагивающие базовые блага.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type JurySessionType = 'normal_12' | 'extended_24';
export type Vote = 'yes' | 'no' | 'abstain';
export type OutsideTrustStatus = 'active' | 'reviewed' | 'lifted';

export interface JurySession {
  id: UUID;
  type: JurySessionType;
  subjectId: UUID;
  participants: UUID[];
  moderatorId: UUID;
  votes: Record<string, Vote>;
  decision: string | null;
  createdAt: ISODateTime;
  decidedAt: ISODateTime | null;
}

export interface OutsideTrust {
  participantId: UUID;
  reason: string;
  validFrom: ISODateTime;
  reviewAt: ISODateTime;
  status: OutsideTrustStatus;
  liftedAt: ISODateTime | null;
}

export interface Appeal {
  id: UUID;
  jurySessionId: UUID | null;
  councilType: string;
  subjectId: UUID;
  result: string | null;
  decidedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// -------- Создание --------

const REQUIRED_SIZE: Record<JurySessionType, number> = {
  normal_12: 12,
  extended_24: 24,
};

export function getRequiredSize(type: JurySessionType): number {
  return REQUIRED_SIZE[type];
}

export function assembleSession(input: {
  id: UUID;
  type: JurySessionType;
  subjectId: UUID;
  participants: UUID[];
  moderatorId: UUID;
}): JurySession {
  const required = getRequiredSize(input.type);
  if (input.participants.length !== required) {
    throw new ValidationError(
      `Нужно ${required} участников, получено ${input.participants.length}`,
    );
  }
  return {
    id: input.id,
    type: input.type,
    subjectId: input.subjectId,
    participants: input.participants,
    moderatorId: input.moderatorId,
    votes: {},
    decision: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
}

// -------- Голосование --------

export function vote(s: JurySession, participantId: UUID, v: Vote): JurySession {
  if (!s.participants.includes(participantId)) {
    throw new ConflictError('Участник не входит в сессию');
  }
  // B4: запрет переголосования.
  if (participantId in s.votes) {
    throw new ConflictError('Голос уже отдан');
  }
  return { ...s, votes: { ...s.votes, [participantId]: v } };
}

export interface VoteCount {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}

export function countVotes(s: JurySession): VoteCount {
  let yes = 0, no = 0, abstain = 0;
  for (const v of Object.values(s.votes)) {
    if (v === 'yes') {yes++;}
    else if (v === 'no') {no++;}
    else {abstain++;}
  }
  return { yes, no, abstain, total: Object.keys(s.votes).length };
}

// -------- Квалифицированное большинство --------

export function canDecideOutsideTrust(s: JurySession): boolean {
  // 9 из 12 (I.3.7)
  const { yes } = countVotes(s);
  return yes >= 9;
}

export function canDecideNotImputable(s: JurySession): boolean {
  // 18 из 24 (I.3.8)
  const { yes } = countVotes(s);
  return yes >= 18;
}

export function decide(s: JurySession, decision: string): JurySession {
  if (!decision.trim()) {throw new ValidationError('Решение обязательно');}
  return { ...s, decision: decision.trim(), decidedAt: new Date().toISOString() };
}

// -------- Вне сети доверия --------

export function assignOutsideTrust(input: {
  participantId: UUID;
  reason: string;
}): OutsideTrust {
  if (!input.reason.trim()) {throw new ValidationError('Причина обязательна');}
  const now = new Date();
  const reviewAt = new Date(now.getTime() + 180 * 86_400_000); // 6 месяцев (I.4.4)
  return {
    participantId: input.participantId,
    reason: input.reason.trim(),
    validFrom: now.toISOString(),
    reviewAt: reviewAt.toISOString(),
    status: 'active',
    liftedAt: null,
  };
}

export function canReviewOutsideTrust(ot: OutsideTrust, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(ot.reviewAt).getTime();
}