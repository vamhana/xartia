// C.0.24.01 — Доменная сущность Шлюз.
// Временное направление №15. Изолирован от 14 направлений.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type GatewayTxType = 'purchase' | 'sale' | 'diplomacy' | 'migration';
export type GatewayTxStatus = 'pending' | 'approved' | 'completed' | 'rejected';
export type ExternalAssetType = 'real_estate' | 'business' | 'finance';
export type ExternalAssetStatus = 'accepted' | 'converting' | 'converted';
export type GuarantorStatus = 'active' | 'expired' | 'removed';
export type WitnessStatus = 'active' | 'inactive';
export type DefenseType = 'external' | 'internal' | 'global';
export type DefenseStatus = 'active' | 'inactive';

export interface GatewayCouncilMember {
  id: UUID;
  memberId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime;
  termNumber: number;
  createdAt: ISODateTime;
}

export interface GatewayTransaction {
  id: UUID;
  type: GatewayTxType;
  description: string;
  amountExternal: number | null;
  resourceType: string | null;
  approvedBy: UUID | null;
  auditedBy: UUID | null;
  classifiedUntil: ISODateTime | null;
  status: GatewayTxStatus;
  createdAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface ExternalAsset {
  id: UUID;
  type: ExternalAssetType;
  value: number;
  status: ExternalAssetStatus;
  sourceParticipantId: UUID | null;
  verifiedBy: UUID | null;
  createdAt: ISODateTime;
  convertedAt: ISODateTime | null;
}

export interface Guarantor {
  id: UUID;
  participantId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime;
  diagnosis: Record<string, unknown>;
  status: GuarantorStatus;
  createdAt: ISODateTime;
}

export interface ExternalWitness {
  id: UUID;
  communityId: UUID;
  status: WitnessStatus;
  since: ISODateTime;
  createdAt: ISODateTime;
}

export interface ExternalDefense {
  id: UUID;
  type: DefenseType;
  status: DefenseStatus;
  commanderId: UUID | null;
  rotationAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

export const GATEWAY_CONSTANTS = {
  COUNCIL_SIZE: 7,
  COUNCIL_TERM_YEARS: 5,
  GUARANTOR_TERM_YEARS: 5,
  MIN_WITNESSES: 2,
  DISSOLVE_MAX_YEARS: 50,
  IMPORT_DEPENDENCY_PCT: 5,
  IMPORT_DEPENDENCY_YEARS: 3,
} as const;

// ─── Фабрики ─────────────────────────────────────────────────────

export function createCouncilMember(input: {
  id: UUID;
  memberId: UUID;
  termNumber: number;
  years?: number;
}): GatewayCouncilMember {
  const now = new Date();
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + (input.years ?? GATEWAY_CONSTANTS.COUNCIL_TERM_YEARS));
  return {
    id: input.id,
    memberId: input.memberId,
    validFrom: now.toISOString(),
    validTo: to.toISOString(),
    termNumber: input.termNumber,
    createdAt: now.toISOString(),
  };
}

export function createTransaction(input: {
  id: UUID;
  type: GatewayTxType;
  description: string;
  amountExternal?: number;
  resourceType?: string;
}): GatewayTransaction {
  if (!input.description || input.description.trim().length === 0) {
    throw new ValidationError('Описание обязательно');
  }
  return {
    id: input.id,
    type: input.type,
    description: input.description.trim(),
    amountExternal: input.amountExternal ?? null,
    resourceType: input.resourceType ?? null,
    approvedBy: null,
    auditedBy: null,
    classifiedUntil: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function createExternalAsset(input: {
  id: UUID;
  type: ExternalAssetType;
  value: number;
  sourceParticipantId?: UUID;
}): ExternalAsset {
  if (input.value <= 0) {
    throw new ValidationError('Стоимость должна быть > 0');
  }
  return {
    id: input.id,
    type: input.type,
    value: input.value,
    status: 'accepted',
    sourceParticipantId: input.sourceParticipantId ?? null,
    verifiedBy: null,
    createdAt: new Date().toISOString(),
    convertedAt: null,
  };
}

export function createGuarantor(input: {
  id: UUID;
  participantId: UUID;
  diagnosis: Record<string, unknown>;
  years?: number;
}): Guarantor {
  if (!input.diagnosis || Object.keys(input.diagnosis).length === 0) {
    throw new ValidationError('Диагностика обязательна (I.5.4.7)');
  }
  const now = new Date();
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + (input.years ?? GATEWAY_CONSTANTS.GUARANTOR_TERM_YEARS));
  return {
    id: input.id,
    participantId: input.participantId,
    validFrom: now.toISOString(),
    validTo: to.toISOString(),
    diagnosis: input.diagnosis,
    status: 'active',
    createdAt: now.toISOString(),
  };
}

export function createWitness(input: {
  id: UUID;
  communityId: UUID;
}): ExternalWitness {
  return {
    id: input.id,
    communityId: input.communityId,
    status: 'active',
    since: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

export function createDefense(input: {
  id: UUID;
  type: DefenseType;
  commanderId?: UUID;
}): ExternalDefense {
  return {
    id: input.id,
    type: input.type,
    status: 'active',
    commanderId: input.commanderId ?? null,
    rotationAt: null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Проверки ────────────────────────────────────────────────────

export function isExternalMark(asset: ExternalAsset): boolean {
  return asset.sourceParticipantId !== null;
}

export function canDissolveGateway(input: {
  importDependencyPct: number;
  dependencyYears: number;
  witnessCount: number;
  verified: boolean;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.importDependencyPct > GATEWAY_CONSTANTS.IMPORT_DEPENDENCY_PCT) {
    reasons.push(
      `Импортозависимость > ${GATEWAY_CONSTANTS.IMPORT_DEPENDENCY_PCT}%`,
    );
  }
  if (input.dependencyYears < GATEWAY_CONSTANTS.IMPORT_DEPENDENCY_YEARS) {
    reasons.push(
      `Период самодостаточности < ${GATEWAY_CONSTANTS.IMPORT_DEPENDENCY_YEARS} лет`,
    );
  }
  if (input.witnessCount < GATEWAY_CONSTANTS.MIN_WITNESSES) {
    reasons.push(`Меньше ${GATEWAY_CONSTANTS.MIN_WITNESSES} Свидетелей`);
  }
  if (!input.verified) {
    reasons.push('Верификация не подтвердила');
  }
  return { allowed: reasons.length === 0, reasons };
}