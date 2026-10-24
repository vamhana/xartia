// C.0.12.01 — Доменная сущность Арбитраж
// Разрешение процедурных конфликтов. Срок — 3 часа (I.3.7).
// Не подменяет Советы, не выбирает «победившую» точку зрения.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ArbitrationType = 'procedural' | 'ownership';
export type ArbitrationStatus =
  | 'submitted' | 'in_progress' | 'decided' | 'escalated_to_jury';

export interface Arbitration {
  id: UUID;
  type: ArbitrationType;
  connectionId: UUID | null;
  signalId: UUID | null;
  parties: UUID[];
  question: string;
  decision: string | null;
  status: ArbitrationStatus;
  deadline: ISODateTime;
  decidedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export function createArbitration(input: {
  type: ArbitrationType;
  connectionId?: UUID;
  signalId?: UUID;
  parties?: UUID[];
  question: string;
  baseTime?: Date;
}): Arbitration {
  if (!input.question.trim()) {throw new ValidationError('Вопрос обязателен');}
  const now = input.baseTime ?? new Date();
  const deadline = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 часа (I.3.7)

  return {
    id: crypto.randomUUID(),
    type: input.type,
    connectionId: input.connectionId ?? null,
    signalId: input.signalId ?? null,
    parties: input.parties ?? [],
    question: input.question.trim(),
    decision: null,
    status: 'submitted',
    deadline: deadline.toISOString(),
    decidedAt: null,
    createdAt: now.toISOString(),
  };
}

export function startProcessing(a: Arbitration): Arbitration {
  if (a.status !== 'submitted') {
    throw new ConflictError(`Нельзя начать обработку из статуса ${a.status}`);
  }
  return { ...a, status: 'in_progress' };
}

export function decide(a: Arbitration, decision: string): Arbitration {
  if (!decision.trim()) {throw new ValidationError('Решение обязательно');}
  if (a.status === 'decided' || a.status === 'escalated_to_jury') {
    throw new ConflictError(`Уже ${a.status}`);
  }
  return {
    ...a,
    status: 'decided',
    decision: decision.trim(),
    decidedAt: new Date().toISOString(),
  };
}

export function escalateToJury(a: Arbitration): Arbitration {
  if (a.type !== 'ownership') {
    throw new ConflictError('В Жюри эскалируется только арбитраж принадлежности');
  }
  return { ...a, status: 'escalated_to_jury' };
}

export function isOverdue(a: Arbitration, now: Date = new Date()): boolean {
  if (a.status === 'decided' || a.status === 'escalated_to_jury') {return false;}
  return new Date(a.deadline).getTime() < now.getTime();
}

export function publishInterim(a: Arbitration, extraHours = 3): { arbitration: Arbitration; interim: string } {
  const newDeadline = new Date(Date.now() + extraHours * 60 * 60 * 1000).toISOString();
  const interim = `Арбитраж задержан. Новый срок: ${newDeadline}`;
  return {
    arbitration: { ...a, deadline: newDeadline },
    interim,
  };
}

export function canDecide(a: Arbitration): boolean {
  return a.status === 'submitted' || a.status === 'in_progress';
}