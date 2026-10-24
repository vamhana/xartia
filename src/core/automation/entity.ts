// C.0.32.01 — Доменная сущность Автоматизация.
// Три сущности: решение ИИ, участок, аудит оператора.
//
// Хартия I.6.15:
//   I.6.15.1 — стаж ≥ 2 года + аттестация ИИ
//   I.6.15.2 — мандат 6 мес., не более 2 сроков
//   I.6.15.3 — утверждает/отклоняет типовые запросы ИИ
//   I.6.15.4 — не совмещает с Советом, ОТК, Балансировкой, Хранителем,
//              наставником, координатором
//   I.6.15.5 — обязан фиксировать причину отклонения
//   I.6.15.6 — может отключить автоматизацию в любой момент
//
// III.1.13а — доля утверждений > 95% за 3 мес. → аудит
// III.1.13б — ошибки > 3/мес → отстранение
//
// Чистые функции. Без побочных эффектов.

import { ValidationError, ConflictError } from '../errors.js';
import { Role, getConflicts } from '../roles.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type AiRecommendation = 'approve' | 'reject';

export type AutomationDecisionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred';

export type OperatorAuditStatus = 'ok' | 'audit_required' | 'removed';

export interface AutomationDecision {
  id: UUID;
  type: string;
  content: Record<string, unknown>;
  aiRecommendation: AiRecommendation;
  deadline: ISODateTime;
  status: AutomationDecisionStatus;
  rejectionReason: string | null;
  decidedBy: UUID | null;
  decidedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface AutomationSection {
  id: UUID;
  directionId: UUID;
  enabled: boolean;
  operatorId: UUID | null;
  disabledAt: ISODateTime | null;
  disableReason: string | null;
  createdAt: ISODateTime;
}

export interface OperatorAudit {
  id: UUID;
  operatorId: UUID;
  approvalRate: number;
  errorCount: number;
  status: OperatorAuditStatus;
  recommendations: string[];
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

export const OPERATOR_MIN_EXPERIENCE_DAYS = 730; // 2 года (I.6.15.1)
export const OPERATOR_TERM_DAYS = 180;           // 6 мес. (I.6.15.2)
export const OPERATOR_MAX_TERMS = 2;             // не более 2 сроков
export const APPROVAL_RATE_AUDIT_THRESHOLD = 0.95; // > 95% (III.1.13а)
export const ERROR_COUNT_REMOVAL_THRESHOLD = 3;    // > 3/мес (III.1.13б)

// ─── Создание решения ────────────────────────────────────────────

export interface CreateDecisionInput {
  id: UUID;
  type: string;
  content: Record<string, unknown>;
  aiRecommendation: AiRecommendation;
  deadline: ISODateTime;
}

export function createDecision(input: CreateDecisionInput): AutomationDecision {
  if (!input.type.trim()) {
    throw new ValidationError('Тип решения обязателен');
  }
  if (!input.content || Object.keys(input.content).length === 0) {
    throw new ValidationError('Содержание решения обязательно');
  }
  const deadlineMs = new Date(input.deadline).getTime();
  if (!Number.isFinite(deadlineMs)) {
    throw new ValidationError('Некорректный deadline');
  }
  return {
    id: input.id,
    type: input.type.trim(),
    content: input.content,
    aiRecommendation: input.aiRecommendation,
    deadline: new Date(deadlineMs).toISOString(),
    status: 'pending',
    rejectionReason: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Переходы решения ────────────────────────────────────────────

export function approveDecision(
  d: AutomationDecision,
  by: UUID,
): AutomationDecision {
  if (d.status !== 'pending' && d.status !== 'deferred') {
    throw new ConflictError(`Решение в статусе '${d.status}' нельзя утвердить`);
  }
  return {
    ...d,
    status: 'approved',
    decidedBy: by,
    decidedAt: new Date().toISOString(),
  };
}

export function rejectDecision(
  d: AutomationDecision,
  reason: string,
  by: UUID,
): AutomationDecision {
  if (d.status !== 'pending' && d.status !== 'deferred') {
    throw new ConflictError(`Решение в статусе '${d.status}' нельзя отклонить`);
  }
  // I.6.15.5 — причина отклонения обязательна.
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError(
      'Причина отклонения обязательна (I.6.15.5)',
      [{ path: 'reason', message: 'Reason is required' }],
    );
  }
  if (reason.length > 2000) {
    throw new ValidationError(
      'Причина слишком длинная (max 2000)',
      [{ path: 'reason', message: 'Max 2000 characters' }],
    );
  }
  return {
    ...d,
    status: 'rejected',
    rejectionReason: reason.trim(),
    decidedBy: by,
    decidedAt: new Date().toISOString(),
  };
}

export function deferDecision(
  d: AutomationDecision,
  newDeadline: ISODateTime,
): AutomationDecision {
  if (d.status !== 'pending') {
    throw new ConflictError(`Решение в статусе '${d.status}' нельзя отложить`);
  }
  const newMs = new Date(newDeadline).getTime();
  if (!Number.isFinite(newMs)) {
    throw new ValidationError('Некорректный new_deadline');
  }
  if (newMs <= Date.now()) {
    throw new ValidationError('new_deadline должен быть в будущем');
  }
  return {
    ...d,
    status: 'deferred',
    deadline: new Date(newMs).toISOString(),
  };
}

export function canApprove(
  d: AutomationDecision,
  now: Date = new Date(),
): boolean {
  if (d.status !== 'pending' && d.status !== 'deferred') {
    return false;
  }
  return new Date(d.deadline).getTime() > now.getTime();
}

// ─── Участок ─────────────────────────────────────────────────────

export function createSection(input: {
  id: UUID;
  directionId: UUID;
}): AutomationSection {
  return {
    id: input.id,
    directionId: input.directionId,
    enabled: true,
    operatorId: null,
    disabledAt: null,
    disableReason: null,
    createdAt: new Date().toISOString(),
  };
}

export function assignOperator(
  s: AutomationSection,
  operatorId: UUID,
): AutomationSection {
  if (s.operatorId === operatorId) {
    throw new ConflictError('Оператор уже назначен на этот участок');
  }
  return {
    ...s,
    operatorId,
    enabled: true,
    disabledAt: null,
    disableReason: null,
  };
}

export function disableSection(
  s: AutomationSection,
  reason: string,
): AutomationSection {
  if (!s.enabled) {
    throw new ConflictError('Участок уже отключен');
  }
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError(
      'Причина отключения обязательна (I.6.15.6)',
      [{ path: 'reason', message: 'Reason is required' }],
    );
  }
  return {
    ...s,
    enabled: false,
    disabledAt: new Date().toISOString(),
    disableReason: reason.trim(),
  };
}

// ─── Аудит оператора ─────────────────────────────────────────────

export function auditOperator(input: {
  id: UUID;
  operatorId: UUID;
  decisions: AutomationDecision[];
  errorCount: number;
}): OperatorAudit {
  const { operatorId, decisions, errorCount } = input;

  const decided = decisions.filter(
    (d) => d.status === 'approved' || d.status === 'rejected',
  );
  const approved = decided.filter((d) => d.status === 'approved').length;
  const total = decided.length;

  // approvalRate = approved / total. Если решений нет — 0 (не NaN).
  const approvalRate = total > 0 ? approved / total : 0;

  const status = deriveAuditStatus(approvalRate, errorCount, total);

  const recommendations: string[] = [];
  if (status === 'audit_required') {
    recommendations.push(
      `Доля утверждений ${(approvalRate * 100).toFixed(1)}% > 95% ` +
        `(III.1.13а). Требуется аудит оператора.`,
    );
  }
  if (status === 'removed') {
    recommendations.push(
      `${errorCount} ошибок за месяц > 3 (III.1.13б). ` +
        `Оператор подлежит отстранению.`,
    );
  }
  if (total === 0) {
    recommendations.push('Нет решений за период — оценка невозможна.');
  }

  return {
    id: input.id,
    operatorId,
    approvalRate,
    errorCount,
    status,
    recommendations,
    createdAt: new Date().toISOString(),
  };
}

function deriveAuditStatus(
  approvalRate: number,
  errorCount: number,
  total: number,
): OperatorAuditStatus {
  // Приоритет: removal > audit_required > ok.
  if (errorCount > ERROR_COUNT_REMOVAL_THRESHOLD) {
    return 'removed';
  }
  if (total > 0 && approvalRate > APPROVAL_RATE_AUDIT_THRESHOLD) {
    return 'audit_required';
  }
  return 'ok';
}

export function shouldAudit(approvalRate: number): boolean {
  return approvalRate > APPROVAL_RATE_AUDIT_THRESHOLD;
}

export function shouldRemove(errorCount: number): boolean {
  return errorCount > ERROR_COUNT_REMOVAL_THRESHOLD;
}

// ─── Совместимость ───────────────────────────────────────────────

// I.6.15.4 — OPERATOR не совмещает с Советом, ОТК, Балансировкой,
// Хранителем, наставником, координатором.
//
// Источник истины — ROLE_CONFLICTS в C.0.01.01. Здесь НЕ дублируем
// список, а читаем через getConflicts(Role.OPERATOR).
export function canCombineWith(otherRole: string): boolean {
  if (!otherRole) { return true; }
  const role = otherRole as Role;
  if (!Object.values(Role).includes(role)) {
    return true; // неизвестная роль — не конфликтует
  }
  const conflicts = getConflicts(Role.OPERATOR);
  return !conflicts.includes(role);
}

// ─── Допуск к роли оператора ─────────────────────────────────────

export interface OperatorCandidacy {
  enteredAt: ISODateTime;
  aiCertified: boolean;
}

export function canBeOperator(
  candidate: OperatorCandidacy,
  now: Date = new Date(),
): { allowed: boolean; reason?: string } {
  const entered = new Date(candidate.enteredAt).getTime();
  if (!Number.isFinite(entered)) {
    return { allowed: false, reason: 'Некорректная дата входа' };
  }
  const days = (now.getTime() - entered) / 86_400_000;
  if (days < OPERATOR_MIN_EXPERIENCE_DAYS) {
    return {
      allowed: false,
      reason:
        `Стаж ${Math.floor(days)} дней < ${OPERATOR_MIN_EXPERIENCE_DAYS} ` +
        `(2 года, I.6.15.1)`,
    };
  }
  if (!candidate.aiCertified) {
    return {
      allowed: false,
      reason: 'Нет аттестации по ИИ (I.6.15.1)',
    };
  }
  return { allowed: true };
}