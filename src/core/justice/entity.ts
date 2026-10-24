// C.0.21.01 — Доменная сущность Правозащита.
// Пять сущностей: заявление, расследование, изоляция, ресоциализация, санкция.
// Права жертвы. Презумпция невиновности. Запрет коллективной ответственности.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ComplaintType = 'violence' | 'threat' | 'coercion' | 'harassment';
export type ComplaintStatus = 'filed' | 'investigation' | 'closed';
export type InvestigationStatus = 'open' | 'in_progress' | 'closed';
export type ResocializationStatus = 'active' | 'completed' | 'failed';
export type SanctionType =
  | 'restorative_talk'
  | 'temporary_isolation'
  | 'resocialization'
  | 'exclusion'
  | 'not_imputable';
export type SanctionStatus = 'imposed' | 'served' | 'appealed' | 'revoked';

export interface VictimRights {
  anonymity: boolean;
  relocationProvided: boolean;
  psychologistAssigned: boolean;
  participation: boolean;
}

export interface VictimRightsInput {
  anonymity: boolean;
  relocationProvided: boolean;
  psychologistAssigned: boolean;
  participation: boolean;
}

export interface Complaint {
  id: UUID;
  type: ComplaintType;
  applicantId: UUID | null;
  anonymous: boolean;
  description: string;
  status: ComplaintStatus;
  createdAt: ISODateTime;
}

export interface Investigation {
  id: UUID;
  complaintId: UUID;
  investigatorIds: UUID[];
  targetId: UUID;
  status: InvestigationStatus;
  deadline: ISODateTime;
  result: string | null;
  victimRights: VictimRights;
  auditedBy: UUID | null;
  createdAt: ISODateTime;
}

export interface Isolation {
  id: UUID;
  targetId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime;
  conditions: Record<string, unknown>;
  imposedBy: UUID;
}

export interface Resocialization {
  id: UUID;
  targetId: UUID;
  program: Record<string, unknown>;
  mentors: UUID[];
  status: ResocializationStatus;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface Sanction {
  id: UUID;
  targetId: UUID;
  type: SanctionType;
  basis: string;
  decidedBy: UUID;
  decidedAt: ISODateTime;
  status: SanctionStatus;
}

export interface FileComplaintInput {
  id: UUID;
  type: ComplaintType;
  applicantId: UUID | null;
  anonymous: boolean;
  description: string;
}

const INVESTIGATION_DAYS = 14;
const EXTENSION_DAYS = 14;
const NOT_IMPUTABLE_REQUIRED = 20; // из 24

export function fileComplaint(input: FileComplaintInput): Complaint {
  if (!input.description || input.description.trim().length === 0) {
    throw new ValidationError('Описание обязательно');
  }
  return {
    id: input.id,
    type: input.type,
    applicantId: input.anonymous ? null : input.applicantId,
    anonymous: input.anonymous,
    description: input.description.trim(),
    status: 'filed',
    createdAt: new Date().toISOString(),
  };
}

export function getInvestigationDeadline(startedAt: ISODateTime): ISODateTime {
  const d = new Date(startedAt);
  d.setUTCDate(d.getUTCDate() + INVESTIGATION_DAYS);
  return d.toISOString();
}

export function startInvestigation(
  complaintId: UUID,
  targetId: UUID,
  investigatorIds: UUID[],
  victimRights: VictimRights,
): Investigation {
  if (investigatorIds.length === 0) {
    throw new ValidationError('Требуется хотя бы один следователь');
  }
  if (investigatorIds.includes(targetId)) {
    throw new ConflictError('Следователь не может быть подозреваемым');
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    complaintId,
    investigatorIds,
    targetId,
    status: 'open',
    deadline: getInvestigationDeadline(now),
    result: null,
    victimRights,
    auditedBy: null,
    createdAt: now,
  };
}

export function canExtendInvestigation(
  i: Investigation,
  now: ISODateTime,
): boolean {
  if (i.status === 'closed') {return false;}
  const deadline = new Date(i.deadline).getTime();
  const current = new Date(now).getTime();
  // Продление разрешено только после истечения первоначального срока
  return current > deadline;
}

export function extendInvestigationDeadline(i: Investigation): Investigation {
  const current = new Date(i.deadline);
  current.setUTCDate(current.getUTCDate() + EXTENSION_DAYS);
  return { ...i, deadline: current.toISOString() };
}

export function imposeIsolation(
  targetId: UUID,
  validTo: ISODateTime,
  conditions: Record<string, unknown>,
  imposedBy: UUID,
): Isolation {
  if (!validTo) {throw new ValidationError('valid_to обязателен');}
  if (Object.keys(conditions).length === 0) {
    throw new ValidationError('Условия изоляции обязательны (I.4.4)');
  }
  return {
    id: crypto.randomUUID(),
    targetId,
    validFrom: new Date().toISOString(),
    validTo,
    conditions,
    imposedBy,
  };
}

export function createSanction(
  targetId: UUID,
  type: SanctionType,
  basis: string,
  decidedBy: UUID,
): Sanction {
  if (!basis || basis.trim().length === 0) {
    throw new ValidationError('Основание обязательно');
  }
  return {
    id: crypto.randomUUID(),
    targetId,
    type,
    basis: basis.trim(),
    decidedBy,
    decidedAt: new Date().toISOString(),
    status: 'imposed',
  };
}

export function validateNoCollectiveResponsibility(
  target: UUID,
  relatives: UUID[],
  sanctions: Sanction[],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const r of relatives) {
    if (r === target) {continue;}
    const s = sanctions.find((x) => x.targetId === r);
    if (s) {
      violations.push(`Санкция против родственника/связанного ${r}: ${s.type}`);
    }
  }
  return { valid: violations.length === 0, violations };
}

export function canApplyNotImputable(
  juryVotes: { yes: number; no: number; total: number },
  verified: boolean,
): boolean {
  if (!verified) {return false;}
  if (juryVotes.total < 24) {return false;}
  return juryVotes.yes >= NOT_IMPUTABLE_REQUIRED;
}

export function getVictimRights(input: VictimRightsInput): VictimRights {
  // По I.2.2 жертва имеет все 4 права по умолчанию
  return {
    anonymity: input.anonymity,
    relocationProvided: input.relocationProvided,
    psychologistAssigned: input.psychologistAssigned,
    participation: input.participation,
  };
}

export const JUSTICE_CONSTANTS = {
  INVESTIGATION_DAYS,
  EXTENSION_DAYS,
  NOT_IMPUTABLE_REQUIRED,
};