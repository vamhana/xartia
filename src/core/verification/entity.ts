// C.0.19.01 — Доменная сущность Верификация
// Аудит, перепроверка, расследование. Независимость от проверяемых (I.2.1).

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type AuditType = 'planned' | 'unplanned' | 'procedural' | 'request';
export type AuditStatus = 'open' | 'in_progress' | 'finished';
export type RecheckResult = 'match' | 'mismatch';
export type CodeSystem = 'prefix_filter' | 'balance' | 'digital_mentor' | 'other';
export type IntegrityAction = 'digital_attack' | 'modification_attempt';

export interface Audit {
  id: UUID;
  type: AuditType;
  subject: string;
  subjectId: UUID | null;
  initiatorId: UUID;
  status: AuditStatus;
  result: string | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface AuditFinding {
  id: UUID;
  auditId: UUID;
  finding: string;
  severity: number; // 1-10
  recommendation: string;
  createdAt: ISODateTime;
}

export interface VerificationRecheck {
  id: UUID;
  otcDecisionId: UUID;
  verifierId: UUID;
  result: RecheckResult;
  comment: string | null;
  createdAt: ISODateTime;
}

export interface CodeAudit {
  id: UUID;
  system: CodeSystem;
  version: string;
  findings: Record<string, unknown>;
  conductedBy: UUID;
  createdAt: ISODateTime;
}

export interface IntegrityAlert {
  id: UUID;
  system: string;
  sourceNode: string;
  action: IntegrityAction;
  details: Record<string, unknown>;
  handledAt: ISODateTime | null;
  resolution: string | null;
  createdAt: ISODateTime;
}

// -------- Создание --------

export function createAudit(input: {
  id: UUID;
  type: AuditType;
  subject: string;
  subjectId?: UUID;
  initiatorId: UUID;
}): Audit {
  if (!input.subject.trim()) {throw new ValidationError('Subject обязателен');}
  return {
    id: input.id,
    type: input.type,
    subject: input.subject.trim(),
    subjectId: input.subjectId ?? null,
    initiatorId: input.initiatorId,
    status: 'open',
    result: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

export function addFinding(
  finding: string, severity: number, recommendation: string,
): { finding: string; severity: number; recommendation: string } {
  if (!finding.trim()) {throw new ValidationError('Finding обязателен');}
  if (severity < 1 || severity > 10) {throw new ValidationError('severity 1–10');}
  if (!recommendation.trim()) {throw new ValidationError('Recommendation обязателен');}
  return { finding: finding.trim(), severity, recommendation: recommendation.trim() };
}

export function closeAudit(a: Audit, result: string): Audit {
  if (a.status === 'finished') {throw new ConflictError('Аудит уже закрыт');}
  if (!result.trim()) {throw new ValidationError('Результат обязателен');}
  return {
    ...a,
    status: 'finished',
    result: result.trim(),
    finishedAt: new Date().toISOString(),
  };
}

// -------- Перепроверка ОТК --------

export function createRecheck(
  otcDecisionId: UUID, verifierId: UUID, matches: boolean, comment: string | null,
): VerificationRecheck {
  return {
    id: crypto.randomUUID(),
    otcDecisionId,
    verifierId,
    result: matches ? 'match' : 'mismatch',
    comment,
    createdAt: new Date().toISOString(),
  };
}

// -------- Независимость --------

export function canAudit(
  verifierId: UUID, subjectId: UUID | null, initiatorId: UUID,
): { allowed: boolean; reason?: string } {
  if (subjectId && subjectId === verifierId) {
    return { allowed: false, reason: 'Верификатор не может проверять свою работу (I.2.2)' };
  }
  if (subjectId && subjectId === initiatorId) {
    return { allowed: false, reason: 'Инициатор не может быть субъектом своего аудита' };
  }
  return { allowed: true };
}

// -------- Просрочка --------

export function isOverdue(a: Audit, maxDays: number, now: Date = new Date()): boolean {
  if (a.status === 'finished') {return false;}
  const created = new Date(a.createdAt).getTime();
  return (now.getTime() - created) > maxDays * 86_400_000;
}