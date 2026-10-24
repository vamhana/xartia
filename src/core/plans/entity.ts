// C.0.06.01 — Доменная сущность План реализации
// Содержит задачи, сроки, критерии. Кризисный и ПТТ имеют расширенные поля.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, PlanStatus, PlanType } from '../types.js';

export interface PlanCheckpoint {
  at: ISODateTime;
  description: string;
}

export interface Plan {
  id: UUID;
  externalId: string;
  type: PlanType;
  title: string;
  expectedResult: string;
  leadDirectionId: UUID;
  /** Сигнал, из которого вырос план (nullable: бывают плановые работы). */
  signalId: UUID | null;
  /** Конкретный человек-куратор, а не направление. */
  curatorId: UUID | null;
  status: PlanStatus;
  criteria: Record<string, unknown>;
  checkpoints: PlanCheckpoint[];
  stopConditions: Record<string, unknown>;
  approvedBy: UUID | null;
  approvedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CreatePlanInput {
  id: UUID;
  externalId: string;
  type: PlanType;
  title: string;
  expectedResult: string;
  leadDirectionId: UUID;
  signalId?: UUID | null;
  curatorId?: UUID | null;
  criteria?: Record<string, unknown>;
  checkpoints?: PlanCheckpoint[];
  stopConditions?: Record<string, unknown>;
}

export function createPlan(input: CreatePlanInput): Plan {
  if (!input.title.trim()) {throw new ValidationError('Название плана обязательно');}
  if (!input.expectedResult.trim()) {throw new ValidationError('Ожидаемый результат обязателен');}

  if (input.type === 'crisis') {
    const crit = input.criteria ?? {};
    if (!('scenario' in crit)) {
      throw new ValidationError('Кризисный план требует сценарий мобилизации (criteria.scenario)');
    }
  }

  const now = new Date().toISOString();
  return {
    id: input.id,
    externalId: input.externalId,
    type: input.type,
    title: input.title.trim(),
    expectedResult: input.expectedResult.trim(),
    leadDirectionId: input.leadDirectionId,
    signalId: input.signalId ?? null,
    curatorId: input.curatorId ?? null,
    status: 'draft',
    criteria: input.criteria ?? {},
    checkpoints: input.checkpoints ?? [],
    stopConditions: input.stopConditions ?? {},
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function canBeApproved(p: Plan): { allowed: boolean; reason?: string } {
  if (p.status === 'approved' || p.status === 'in_progress') {
    return { allowed: false, reason: `План уже в статусе ${p.status}` };
  }
  if (p.status === 'completed' || p.status === 'cancelled') {
    return { allowed: false, reason: `План ${p.status}` };
  }
  return { allowed: true };
}

export function approvePlan(p: Plan, approverId: UUID): Plan {
  const check = canBeApproved(p);
  if (!check.allowed) {throw new ConflictError(check.reason ?? 'Нельзя утвердить план');}
  const now = new Date().toISOString();
  return { ...p, status: 'approved', approvedBy: approverId, approvedAt: now, updatedAt: now };
}

export function activatePlan(p: Plan): Plan {
  if (p.status !== 'approved') {
    throw new ConflictError('Активировать можно только утверждённый план');
  }
  return { ...p, status: 'in_progress', updatedAt: new Date().toISOString() };
}

export function isCrisis(p: Plan): boolean { return p.type === 'crisis'; }
export function isDissident(p: Plan): boolean { return p.type === 'dissident'; }

export function formatPlanExternalId(date: Date, number: number): string {
  if (number < 0 || number > 999) {throw new ValidationError('Номер плана 0–999');}
  const d = date.toISOString().slice(0, 10);
  return `PLAN-${d}-${String(number).padStart(3, '0')}`;
}