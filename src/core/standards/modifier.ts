// C.0.16.02 — Модификатор стандарта
// Объективные условия: климат, здоровье, профессия, возраст, семья.
// Перечень открыт. До решения — экспериментальная материализация.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ModifierStatus = 'pending' | 'active' | 'rejected';

export interface Modifier {
  id: UUID;
  name: string;
  condition: Record<string, unknown>;
  coefficient: number;
  status: ModifierStatus;
  requestedBy: UUID | null;
  approvedBy: UUID | null;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
  reasonRejected: string | null;
}

export function requestModifier(input: {
  id: UUID;
  name: string;
  condition: Record<string, unknown>;
  coefficient: number;
  requestedBy: UUID;
}): Modifier {
  if (!input.name.trim()) {throw new ValidationError('Имя модификатора обязательно');}
  if (Object.keys(input.condition).length === 0) {
    throw new ValidationError('condition не может быть пустым');
  }
  if (input.coefficient < -1 || input.coefficient > 10) {
    throw new ValidationError('coefficient должен быть -1..10');
  }
  return {
    id: input.id,
    name: input.name.trim(),
    condition: input.condition,
    coefficient: input.coefficient,
    status: 'pending',
    requestedBy: input.requestedBy,
    approvedBy: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    reasonRejected: null,
  };
}

export function approveModifier(m: Modifier, approvedBy: UUID): Modifier {
  if (m.status !== 'pending') {throw new ValidationError(`Уже ${m.status}`);}
  return {
    ...m,
    status: 'active',
    approvedBy,
    resolvedAt: new Date().toISOString(),
  };
}

export function rejectModifier(m: Modifier, reason: string): Modifier {
  if (m.status !== 'pending') {throw new ValidationError(`Уже ${m.status}`);}
  if (!reason.trim()) {throw new ValidationError('Причина отказа обязательна');}
  return {
    ...m,
    status: 'rejected',
    reasonRejected: reason.trim(),
    resolvedAt: new Date().toISOString(),
  };
}

// Аддитивно для положительных, мультипликативно для отрицательных (I.1.5.9)
export function applyModifier(baseNorm: number, modifiers: Modifier[]): number {
  let positiveSum = 0;
  let negativeProduct = 1;

  for (const m of modifiers) {
    if (m.status !== 'active') {continue;}
    if (m.coefficient >= 0) {positiveSum += m.coefficient;}
    else {negativeProduct *= (1 + m.coefficient);}
  }

  const result = baseNorm * (1 + positiveSum) * negativeProduct;
  return Math.max(0, Math.round(result * 10000) / 10000);
}

export function getExperimentalMaterialization(m: Modifier): boolean {
  return m.status === 'pending';
}