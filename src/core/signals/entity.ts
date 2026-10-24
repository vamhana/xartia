// C.0.10.01 — Доменная сущность Сигнал
// Лимит итераций 3. Инициатор может указать ведущее направление.
// Отсутствие ответа — не согласие (I.2.3).

import { PRIORITY_DEADLINES_MS } from '../constants.js';
import { ValidationError, ConflictError } from '../errors.js';
import type {
  UUID, ISODateTime, Priority, SignalStatus, SignalType, SignalResponseType,
} from '../types.js';

export interface Signal {
  id: UUID;
  externalId: string;
  initiatorId: UUID;
  type: SignalType;
  description: string;
  justification: string;
  directions: UUID[];
  desiredDeadline: ISODateTime | null;
  priority: Priority;
  status: SignalStatus;
  iterations: number;
  leadDirectionId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SignalResponse {
  id: UUID;
  signalId: UUID;
  directionId: UUID;
  response: SignalResponseType;
  justification: string;
  data: Record<string, unknown> | null;
  consequences: string | null;
  needs: string | null;
  createdAt: ISODateTime;
}

export interface CreateSignalInput {
  id: UUID;
  externalId: string;
  initiatorId: UUID;
  type: SignalType;
  description: string;
  justification: string;
  priority: Priority;
  directions?: UUID[];
  desiredDeadline?: ISODateTime;
  leadDirectionId?: UUID;
}

// -------- Создание --------

export function createSignal(input: CreateSignalInput): Signal {
  if (!input.description.trim()) {throw new ValidationError('Описание сигнала обязательно');}
  if (input.description.length > 5000) {throw new ValidationError('Описание не более 5000 символов');}
  if (!input.justification.trim()) {throw new ValidationError('Обоснование обязательно');}
  if (input.justification.length > 2000) {throw new ValidationError('Обоснование не более 2000 символов');}

  const now = new Date().toISOString();
  return {
    id: input.id,
    externalId: input.externalId,
    initiatorId: input.initiatorId,
    type: input.type,
    description: input.description.trim(),
    justification: input.justification.trim(),
    directions: input.directions ?? [],
    desiredDeadline: input.desiredDeadline ?? null,
    priority: input.priority,
    status: 'new',
    iterations: 0,
    leadDirectionId: input.leadDirectionId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

// -------- Переходы статуса --------

const ALLOWED_TRANSITIONS: Record<SignalStatus, readonly SignalStatus[]> = {
  new: ['run', 'rejected'],
  run: ['connect', 'plan', 'rejected'],
  connect: ['plan', 'rejected'],
  plan: ['completed', 'rejected'],
  completed: [],
  rejected: [],
};

export function canTransition(from: SignalStatus, to: SignalStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function changeStatus(s: Signal, to: SignalStatus): Signal {
  if (!canTransition(s.status, to)) {
    throw new ConflictError(`Нельзя перевести сигнал ${s.status} → ${to}`);
  }
  return { ...s, status: to, updatedAt: new Date().toISOString() };
}

// -------- Итерации --------

const MAX_ITERATIONS = 3;

export function incrementIteration(s: Signal): Signal {
  return { ...s, iterations: s.iterations + 1, updatedAt: new Date().toISOString() };
}

export function canEscalate(s: Signal): boolean {
  return s.iterations >= MAX_ITERATIONS;
}

// -------- Дедлайны --------

export function getDeadlineForPriority(p: Priority, baseTime: Date = new Date()): ISODateTime {
  return new Date(baseTime.getTime() + PRIORITY_DEADLINES_MS[p]).toISOString();
}

// -------- Формат --------

export function formatSignalExternalId(date: Date, sequence: number): string {
  if (sequence < 0 || sequence > 999) {throw new ValidationError('Номер сигнала 0–999');}
  const d = date.toISOString().slice(0, 10);
  return `SIG-${d}-${String(sequence).padStart(3, '0')}`;
}

// -------- Валидация ответа --------

export function validateResponse(input: {
  response: SignalResponseType;
  justification?: string | null;
  data?: unknown;
  consequences?: string | null;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.justification?.trim()) {
    errors.push('Обоснование обязательно для любого ответа');
  }
  // Для 'clarify' и 'amend' нужно указать, что именно
  if (input.response === 'clarify' && !input.data) {
    errors.push('Ответ "Требую уточнения" требует данных о том, что уточнить');
  }
  return { valid: errors.length === 0, errors };
}