// C.0.18.01 — Доменная сущность Балансировка
// Наблюдение за системой. Не командует, только сигнализирует (III.1.1).

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime, Priority } from '../types.js';

export type AnomalyType = 'speed' | 'format' | 'etiquette' | 'priority' | 'iteration';
export type AnomalyStatus = 'new' | 'analyzed' | 'resolved';
export type CompetenceRiskStatus = 'active' | 'removed';
export type GuardianIndexType = 'defense_maturity' | 'excess_capacity' | 'import_dependency';

export interface Anomaly {
  id: UUID;
  type: AnomalyType;
  directionId: UUID;
  severity: number;
  status: AnomalyStatus;
  metaRequestId: UUID | null;
  details: Record<string, unknown>;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
}

export interface BalanceMetricsSnapshot {
  id: UUID;
  directionId: UUID | null;
  period: string;
  metrics: Record<string, number>;
  createdAt: ISODateTime;
}

export interface NormativeSpeed {
  id: UUID;
  priority: Priority;
  deadlineMs: number;
  version: number;
  publishedAt: ISODateTime;
}

export interface CompetenceRisk {
  id: UUID;
  directionId: UUID;
  status: CompetenceRiskStatus;
  reason: string;
  verifiedBy: UUID | null;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface GuardianIndex {
  id: UUID;
  type: GuardianIndexType;
  value: number;
  directionId: UUID | null;
  createdAt: ISODateTime;
}

// -------- Детект --------

export function detectAnomaly(input: {
  type: AnomalyType;
  directionId: UUID;
  severity: number;
  details?: Record<string, unknown>;
}): Anomaly {
  if (input.severity < 1 || input.severity > 10) {
    throw new ValidationError('severity должен быть 1–10');
  }
  return {
    id: crypto.randomUUID(),
    type: input.type,
    directionId: input.directionId,
    severity: input.severity,
    status: 'new',
    metaRequestId: null,
    details: input.details ?? {},
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

// -------- Нормативы --------

export function recalcNormativeSpeed(speeds: number[]): number {
  if (speeds.length === 0) {throw new ValidationError('Нужен хотя бы один замер');}
  const sorted = [...speeds].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
  return Math.round(median * 0.95);
}

// -------- Компетентностный риск --------

export function assignCompetenceRisk(
  directionId: UUID,
  reason: string,
  verifiedBy: UUID | null,
): CompetenceRisk {
  if (!reason.trim()) {throw new ValidationError('Причина обязательна');}
  return {
    id: crypto.randomUUID(),
    directionId,
    status: 'active',
    reason: reason.trim(),
    verifiedBy,
    validFrom: new Date().toISOString(),
    validTo: null,
  };
}

// -------- Индексы --------

export function shouldFreezeExpansion(index: number): boolean {
  return index < 0.4;
}

export function shouldExpandCapacity(index: number): boolean {
  return index > 0.7;
}