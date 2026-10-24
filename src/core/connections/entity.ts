// C.0.11.01 — Доменная сущность Коннект
// Процедура профессионального соединения направлений при разногласиях.
// Цель — установить причину расхождения, не «победить».

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ConnectionStatus = 'started' | 'diagnostics' | 'finished';
export type ConnectionResult =
  | 'resolved' | 'divergent' | 'variant_found' | 'incompatible' | 'undetermined';

export interface ConnectionPosition {
  directionId: UUID;
  claim: string;
  data: string;
  cause: string;
  needs: string;
  recordedAt: ISODateTime;
}

export interface Connection {
  id: UUID;
  signalId: UUID;
  moderatorId: UUID;
  status: ConnectionStatus;
  positions: ConnectionPosition[];
  cause: string | null;
  result: ConnectionResult | null;
  protocol: Record<string, unknown> | null;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  diagnosticDeadline: ISODateTime;
}

export interface CreatePositionInput {
  directionId: UUID;
  claim: string;
  data: string;
  cause: string;
  needs: string;
}

// -------- Создание --------

export function startConnection(
  signalId: UUID,
  moderatorId: UUID,
  startedAt: Date = new Date(),
): Connection {
  const diagnosticDeadline = new Date(startedAt.getTime() + 60 * 60 * 1000); // 1 час (I.3.2)
  return {
    id: crypto.randomUUID(),
    signalId,
    moderatorId,
    status: 'started',
    positions: [],
    cause: null,
    result: null,
    protocol: null,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    diagnosticDeadline: diagnosticDeadline.toISOString(),
  };
}

// -------- Позиции --------

export function validatePosition(input: CreatePositionInput): void {
  if (!input.claim.trim()) {throw new ValidationError('claim обязателен (I.3.3)');}
  if (!input.data.trim()) {throw new ValidationError('data обязателен (I.3.3)');}
  if (!input.cause.trim()) {throw new ValidationError('cause обязателен (I.3.3)');}
  if (!input.needs.trim()) {throw new ValidationError('needs обязателен (I.3.3)');}
}

export function addPosition(c: Connection, position: ConnectionPosition): Connection {
  // Нельзя добавлять позицию после завершения
  if (c.status === 'finished') {
    throw new ConflictError('Коннект завершён — позиции больше не принимаются');
  }
  // Одна позиция на направление
  if (c.positions.some((p) => p.directionId === position.directionId)) {
    throw new ConflictError('Позиция от этого направления уже зафиксирована');
  }
  const updated = [...c.positions, position];
  // Когда все стороны высказались (>= 2) — переходим в diagnostics
  const nextStatus: ConnectionStatus =
    updated.length >= 2 && c.status === 'started' ? 'diagnostics' : c.status;
  return { ...c, positions: updated, status: nextStatus };
}

// -------- Диагностика --------

export function finishDiagnostics(c: Connection, cause: string): Connection {
  if (c.status !== 'diagnostics') {
    throw new ConflictError('Диагностика ещё не начата или уже завершена');
  }
  if (!cause.trim()) {throw new ValidationError('Причина обязательна (I.3.4)');}
  return { ...c, status: 'finished', cause: cause.trim(), finishedAt: new Date().toISOString() };
}

// -------- Результат --------

export function setResult(c: Connection, result: ConnectionResult): Connection {
  if (c.status !== 'finished') {
    throw new ConflictError('Результат можно установить только после завершения диагностики');
  }
  return { ...c, result };
}

// -------- Протокол --------

export function attachProtocol(c: Connection, protocol: Record<string, unknown>): Connection {
  return { ...c, protocol };
}

// -------- Утилиты --------

export function isFinished(c: Connection): boolean {
  return c.status === 'finished';
}

export function isDiagnosticOverdue(c: Connection, now: Date = new Date()): boolean {
  return new Date(c.diagnosticDeadline).getTime() < now.getTime() && c.status !== 'finished';
}

export function canMoveToArbitration(c: Connection): boolean {
  return (
    c.status === 'finished' &&
    (c.result === 'incompatible' || c.result === 'undetermined')
  );
}

export function getDeadline(startedAt: ISODateTime): ISODateTime {
  return new Date(new Date(startedAt).getTime() + 60 * 60 * 1000).toISOString();
}