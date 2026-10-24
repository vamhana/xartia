// C.0.28.01 — Доменная сущность Convergence.
// Переход внешнего государства (V.7). 5 этапов: 0 → declaration,
// 1 → gateway, 2 → digital, 3 → social, 4 → technology, 5 → dissolve gateway.
// Добровольность, безболезненность, постепенность. Максимум 60 месяцев (I.7.2).
//
// Чистые функции, без побочных эффектов.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type ConvergenceStatus =
  | 'draft'
  | 'declared'
  | 'in_progress'
  | 'completed'
  | 'failed';

export type DebtType = 'external' | 'internal';
export type DebtAction = 'annul' | 'convert';
export type WeaponAction = 'utilize' | 'reserve' | 'energy';
export type CulturalCenterStatus = 'planned' | 'open' | 'closed';

export interface ConvergencePlan {
  id: UUID;
  stateName: string;
  stage: number; // 0..5
  status: ConvergenceStatus;
  coordinatorId: UUID | null;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface ConvergenceCouncil {
  id: UUID;
  planId: UUID;
  members: Array<Record<string, unknown>>;
}

export interface DebtConversion {
  id: UUID;
  planId: UUID;
  type: DebtType;
  amount: number;
  action: DebtAction;
  coefficient: number | null;
  createdAt: ISODateTime;
}

export interface AssetConversion {
  id: UUID;
  planId: UUID;
  assetType: string;
  value: number;
  destinationDirectionId: UUID;
  createdAt: ISODateTime;
}

export interface WeaponConversion {
  id: UUID;
  planId: UUID;
  weaponType: string;
  action: WeaponAction;
  verifiedBy: UUID | null;
  createdAt: ISODateTime;
}

export interface CulturalCenter {
  id: UUID;
  planId: UUID;
  location: { lat: number; lon: number };
  status: CulturalCenterStatus;
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

export const CONVERGENCE_MAX_MONTHS = 60;   // I.7.2
export const CONVERGENCE_STAGES = 6;        // 0..5
export const MIN_COUNCIL_MEMBERS = 11;      // 3 СП + 3 от 14 + 3 от государства + 2 аудитора
export const IMPORT_DEPENDENCY_MAX_PCT = 5;
export const COGNITIVE_ROUTE_MIN_PCT = 80;

// ─── Создание плана ──────────────────────────────────────────────

export interface CreateConvergencePlanInput {
  id: UUID;
  stateName: string;
  coordinatorId?: UUID | null;
  startedAt?: Date;
}

export function createConvergencePlan(
  input: CreateConvergencePlanInput,
): ConvergencePlan {
  if (!input.stateName || !input.stateName.trim()) {
    throw new ValidationError('state_name обязателен');
  }
  const startedAt = (input.startedAt ?? new Date()).toISOString();
  return {
    id: input.id,
    stateName: input.stateName.trim(),
    stage: 0,
    status: 'draft',
    coordinatorId: input.coordinatorId ?? null,
    startedAt,
    finishedAt: null,
  };
}

// ─── Декларация ──────────────────────────────────────────────────

export function signDeclaration(
  p: ConvergencePlan,
  signedBy: UUID,
): ConvergencePlan {
  if (p.status !== 'draft') {
    throw new ConflictError(
      `План в статусе '${p.status}' — декларация недоступна`,
    );
  }
  if (!signedBy) {
    throw new ValidationError('signed_by обязателен');
  }
  return { ...p, status: 'declared' };
}

// ─── Совет конвергенции ─────────────────────────────────────────

export function createCouncil(
  planId: UUID,
  members: Array<Record<string, unknown>>,
): ConvergenceCouncil {
  if (!Array.isArray(members) || members.length < MIN_COUNCIL_MEMBERS) {
    throw new ValidationError(
      `Совет конвергенции требует минимум ${MIN_COUNCIL_MEMBERS} участников`,
    );
  }
  return {
    id: crypto.randomUUID(),
    planId,
    members,
  };
}

// ─── Переход этапа ───────────────────────────────────────────────

export function advanceStage(p: ConvergencePlan): ConvergencePlan {
  if (p.stage >= CONVERGENCE_STAGES - 1) {
    throw new ConflictError('План уже на финальном этапе');
  }
  if (p.status === 'completed') {
    throw new ConflictError('План уже завершён');
  }
  if (p.status === 'failed') {
    throw new ConflictError('План провален');
  }
  const nextStage = p.stage + 1;
  const now = new Date().toISOString();
  if (nextStage === CONVERGENCE_STAGES - 1) {
    // Финальный этап — план завершён.
    return {
      ...p,
      stage: nextStage,
      status: 'completed',
      finishedAt: now,
    };
  }
  return { ...p, stage: nextStage, status: 'in_progress' };
}

// ─── Критерии перехода ──────────────────────────────────────────

export interface StageCriteria {
  declarationSigned: boolean;
  importDependencyPct: number | null; // null = нет данных
  cognitiveRoutePct: number | null;
  militaryIntegrated: boolean | null;
}

export function canAdvanceStage(
  p: ConvergencePlan,
  criteria: StageCriteria,
): { allowed: boolean; missing: string[] } {
  const missing: string[] = [];

  if (p.stage >= CONVERGENCE_STAGES - 1) {
    return { allowed: false, missing: ['План уже на финальном этапе'] };
  }
  if (p.status === 'completed') {
    return { allowed: false, missing: ['План завершён'] };
  }
  if (p.status === 'failed') {
    return { allowed: false, missing: ['План провален'] };
  }

  // Переход 0 → 1: требует подписанной декларации.
  if (p.stage === 0 && !criteria.declarationSigned) {
    missing.push('Декларация не подписана');
  }

  // Переход 4 → 5 (финальный, dissolve gateway): I.7.8.1.
  if (p.stage === 4) {
    if (
      criteria.importDependencyPct !== null &&
      criteria.importDependencyPct >= IMPORT_DEPENDENCY_MAX_PCT
    ) {
      missing.push(
        `Импортозависимость ${criteria.importDependencyPct.toFixed(2)}% ` +
          `≥ ${IMPORT_DEPENDENCY_MAX_PCT}%`,
      );
    }
    if (
      criteria.cognitiveRoutePct !== null &&
      criteria.cognitiveRoutePct < COGNITIVE_ROUTE_MIN_PCT
    ) {
      missing.push(
        `Когнитивный маршрут ${criteria.cognitiveRoutePct.toFixed(1)}% ` +
          `< ${COGNITIVE_ROUTE_MIN_PCT}%`,
      );
    }
    if (criteria.militaryIntegrated === false) {
      missing.push('Военные не интегрированы');
    }
  }

  return { allowed: missing.length === 0, missing };
}

// ─── Конверсии ──────────────────────────────────────────────────

export function convertDebts(
  planId: UUID,
  input: {
    type: DebtType;
    amount: number;
    action?: DebtAction;
    coefficient?: number;
  },
): DebtConversion {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('amount должен быть > 0');
  }
  const derivedAction: DebtAction =
    input.type === 'external' ? 'annul' : 'convert';
  const action = input.action ?? derivedAction;
  if (action !== derivedAction) {
    throw new ValidationError(
      `Тип ${input.type} требует action='${derivedAction}', получено '${action}'`,
    );
  }
  return {
    id: crypto.randomUUID(),
    planId,
    type: input.type,
    amount: input.amount,
    action,
    coefficient: input.coefficient ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function convertAssets(
  planId: UUID,
  input: {
    assetType: string;
    value: number;
    destinationDirectionId: UUID;
  },
): AssetConversion {
  if (!input.assetType || !input.assetType.trim()) {
    throw new ValidationError('asset_type обязателен');
  }
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new ValidationError('value должен быть > 0');
  }
  if (!input.destinationDirectionId) {
    throw new ValidationError('destination_direction_id обязателен');
  }
  return {
    id: crypto.randomUUID(),
    planId,
    assetType: input.assetType.trim(),
    value: input.value,
    destinationDirectionId: input.destinationDirectionId,
    createdAt: new Date().toISOString(),
  };
}

export function convertWeapons(
  planId: UUID,
  input: { weaponType: string; action: WeaponAction },
): WeaponConversion {
  if (!input.weaponType || !input.weaponType.trim()) {
    throw new ValidationError('weapon_type обязателен');
  }
  if (!['utilize', 'reserve', 'energy'].includes(input.action)) {
    throw new ValidationError('action must be utilize/reserve/energy');
  }
  return {
    id: crypto.randomUUID(),
    planId,
    weaponType: input.weaponType.trim(),
    action: input.action,
    verifiedBy: null,
    createdAt: new Date().toISOString(),
  };
}

export function createCulturalCenter(
  planId: UUID,
  lat: number,
  lon: number,
): CulturalCenter {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('lat должен быть в диапазоне -90..90');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('lon должен быть в диапазоне -180..180');
  }
  return {
    id: crypto.randomUUID(),
    planId,
    location: { lat, lon },
    status: 'planned',
    createdAt: new Date().toISOString(),
  };
}

// ─── Завершение ─────────────────────────────────────────────────

export function completeConvergence(p: ConvergencePlan): ConvergencePlan {
  if (p.status === 'completed') {
    throw new ConflictError('План уже завершён');
  }
  if (p.status === 'failed') {
    throw new ConflictError('План провален');
  }
  return { ...p, status: 'completed', finishedAt: new Date().toISOString() };
}

export function getMaxMonths(): number {
  return CONVERGENCE_MAX_MONTHS;
}