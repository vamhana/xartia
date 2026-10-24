// C.0.05.01 — Доменная сущность Мандат
// Временное полномочие. Ничего не «навсегда». Ротация обязательна.

import { ValidationError, ConflictError } from '../errors.js';
import { Role, ROLE_MAX_TERMS, ROLE_CONFLICTS } from '../roles.js';
import type { UUID, ISODateTime, MandateStatus, DelegationStatus } from '../types.js';

export interface Mandate {
  id: UUID;
  function: string;
  directionId: UUID | null;
  holderId: UUID;
  grantedBy: UUID;
  grantedAt: ISODateTime;
  expiresAt: ISODateTime;
  status: MandateStatus;
  conditions: Record<string, unknown> | null;
  scope: Record<string, unknown> | null;
}

export interface Delegation {
  id: UUID;
  function: string;
  fromId: UUID;
  toId: UUID;
  directionId: UUID | null;
  scope: Record<string, unknown> | null;
  validFrom: ISODateTime;
  validTo: ISODateTime;
  status: DelegationStatus;
  revokedAt: ISODateTime | null;
  revokedBy: UUID | null;
}

export interface Cooldown {
  id: UUID;
  participantId: UUID;
  reason: string;
  validFrom: ISODateTime;
  validTo: ISODateTime;
}

// -------- Проверки --------

export function createMandate(input: {
  id: UUID;
  function: string;
  holderId: UUID;
  grantedBy: UUID;
  directionId?: UUID;
  expiresAt: ISODateTime;
  conditions?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  grantedAt?: Date;
}): Mandate {
  if (!input.function.trim()) {throw new ValidationError('Функция обязательна');}

  const grantedAt = input.grantedAt ?? new Date();
  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= grantedAt.getTime()) {
    throw new ValidationError('expiresAt должен быть > grantedAt');
  }

  return {
    id: input.id,
    function: input.function.trim(),
    directionId: input.directionId ?? null,
    holderId: input.holderId,
    grantedBy: input.grantedBy,
    grantedAt: grantedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active',
    conditions: input.conditions ?? {},
    scope: input.scope ?? {},
  };
}

export function isActive(m: Mandate, now: Date = new Date()): boolean {
  return m.status === 'active' && new Date(m.expiresAt).getTime() > now.getTime();
}

export function isExpired(m: Mandate, now: Date = new Date()): boolean {
  return new Date(m.expiresAt).getTime() <= now.getTime();
}

export function revoke(m: Mandate, _reason: string): Mandate {
  if (m.status !== 'active') {throw new ConflictError(`Мандат уже ${m.status}`);}
  return { ...m, status: 'revoked' };
}

// -------- Конфликты ролей --------

function asRole(name: string): Role | null {
  if (Object.values(Role).includes(name as Role)) {return name as Role;}
  return null;
}

export function hasConflict(roleA: string, roleB: string): boolean {
  const a = asRole(roleA);
  const b = asRole(roleB);
  if (!a || !b) {return false;}
  const confA = ROLE_CONFLICTS[a] ?? [];
  const confB = ROLE_CONFLICTS[b] ?? [];
  return confA.includes(b) || confB.includes(a);
}

// -------- Сроки --------

export function validateTerm(
  function_: string,
  termNumber: number,
): { valid: boolean; reason?: string } {
  const role = asRole(function_);
  if (!role) {return { valid: true };}

  const policy = ROLE_MAX_TERMS[role];
  if (!policy) {return { valid: true };}

  if (policy.maxTerms !== null && termNumber > policy.maxTerms) {
    return {
      valid: false,
      reason: `Превышен лимит сроков для ${function_}: максимум ${policy.maxTerms}, запрошен ${termNumber}`,
    };
  }
  return { valid: true };
}

export function calculateCooldown(m: Mandate): {
  reason: string;
  validFrom: ISODateTime;
  validTo: ISODateTime;
} | null {
  const role = asRole(m.function);
  const policy = role ? ROLE_MAX_TERMS[role] : null;

  // Явный null в политике = роль не подлежит cooldown (I.4.1.8).
  // Для неизвестных функций — безопасный fallback 365 дней.
  if (policy && policy.cooldownDays === null) {return null;}

  const cooldownDays = policy?.cooldownDays ?? 365;

  const now = new Date();
  const validTo = new Date(now.getTime() + cooldownDays * 86_400_000);

  return {
    reason: `rotation:${m.function}`,
    validFrom: now.toISOString(),
    validTo: validTo.toISOString(),
  };
}

export function rotate(
  m: Mandate,
  successorId: UUID,
): { old: Mandate; next: Mandate } {
  if (m.status !== 'active') {throw new ConflictError(`Мандат ${m.status}`);}

  const role = asRole(m.function);
  const policy = role ? ROLE_MAX_TERMS[role] : null;
  const termDays = policy?.termDays ?? 365;

  const now = new Date();
  const nextExpires = new Date(now.getTime() + termDays * 86_400_000);

  const old: Mandate = { ...m, status: 'expired' };
  const next: Mandate = {
    ...m,
    id: crypto.randomUUID(),
    holderId: successorId,
    grantedBy: m.grantedBy,
    grantedAt: now.toISOString(),
    expiresAt: nextExpires.toISOString(),
    status: 'active',
  };

  return { old, next };
}

export function getTermPolicy(function_: string): {
  termDays: number; maxTerms: number; cooldownDays: number;
} {
  const role = asRole(function_);
  const policy = role ? ROLE_MAX_TERMS[role] : null;
  return {
    termDays: policy?.termDays ?? 365,
    maxTerms: policy?.maxTerms ?? 1,
    cooldownDays: policy?.cooldownDays ?? 365,
  };
}