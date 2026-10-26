// C.0.14.01 — Доменная сущность Поток
// Потоки — не деньги (I.1.6). Не передаются, не наследуются.

import { CAPSULE_MAX } from '../constants.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, FlowType } from '../types.js';

export interface FlowBalance {
  participantId: UUID;
  type: FlowType;
  balance: number;
  updatedAt: ISODateTime;
}

export interface FlowTransaction {
  id: UUID;
  participantId: UUID;
  type: FlowType;
  amount: number;
  reason: string;
  source: string;
  createdAt: ISODateTime;
}

export interface Capsule {
  participantId: UUID;
  balance: number;
  updatedAt: ISODateTime;
}

export interface ChargeInput {
  participantId: UUID;
  type: FlowType;
  amount: number;
  reason: string;
  source: string;
  /** Задача-основание: даёт идемпотентность начисления (P0). */
  taskId?: UUID;
}

export function validateCharge(input: ChargeInput): void {
  if (input.amount <= 0) {throw new ValidationError('Сумма должна быть > 0');}
  if (!input.reason.trim()) {throw new ValidationError('Причина обязательна');}
  if (!input.source.trim()) {throw new ValidationError('Источник обязателен');}
}

export function canDepositToCapsule(current: number, amount: number): boolean {
  return current + amount <= CAPSULE_MAX;
}

export function calculateReturn(balance: number, rate: number): { returned: number; remaining: number } {
  if (rate <= 0) {throw new ValidationError('Rate должен быть > 0');}
  const returned = Math.floor((balance / rate) * 10000) / 10000;
  return { returned, remaining: balance - returned };
}

export function getReturnRate(isGentle: boolean): number {
  return isGentle ? 60 : 30;
}

export function isGentlePeriod(enteredAt: ISODateTime, now: Date = new Date()): boolean {
  const entered = new Date(enteredAt).getTime();
  const days = (now.getTime() - entered) / 86_400_000;
  return days <= 180;
}

export function assertCapsuleDeposit(current: number, amount: number): void {
  if (amount <= 0) {throw new ValidationError('Сумма должна быть > 0');}
  if (!canDepositToCapsule(current, amount)) {
    throw new ConflictError(`Капсула не может превышать ${CAPSULE_MAX} Потоков`);
  }
}