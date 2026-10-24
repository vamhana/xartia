// C.0.13.01 — Доменная сущность Всеобщий прогон
// Параллельная экспертиза запроса всеми направлениями.
// Отсутствие ответа — не согласие (I.2.3).

import { PRIORITY_DEADLINES_MS, QUANTUM_ACCELERATION } from '../constants.js';
import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime, Priority, SignalResponseType } from '../types.js';

export type RunType = 'sequential' | 'parallel' | 'crisis';
export type RunStatus = 'started' | 'collecting' | 'aggregated' | 'finished';

export interface UniversalRun {
  id: UUID;
  signalId: UUID;
  type: RunType;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  status: RunStatus;
  totalDirections: number;
  respondedDirections: number;
}

export interface RunSummary {
  support: number;
  object: number;
  clarify: number;
  amend: number;
  noInfluence: number;
  total: number;
  byDirection: Array<{ directionId: UUID; response: SignalResponseType }>;
}

// -------- Создание --------

export function startRun(input: {
  id: UUID;
  signalId: UUID;
  type: RunType;
  totalDirections: number;
}): UniversalRun {
  if (input.totalDirections <= 0) {throw new ValidationError('totalDirections > 0');}
  return {
    id: input.id,
    signalId: input.signalId,
    type: input.type,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'started',
    totalDirections: input.totalDirections,
    respondedDirections: 0,
  };
}

// -------- Дедлайн --------

export function getDeadlineForRun(
  type: RunType,
  priority: Priority,
  baseTime: Date = new Date(),
): ISODateTime {
  const base = PRIORITY_DEADLINES_MS[priority];
  let ms: number;
  if (type === 'crisis') {
    ms = 60_000; // 1 минута (I.2.6а)
  } else if (type === 'parallel') {
    ms = Math.floor(base / 2); // сроки /2 (I.2.5)
  } else {
    ms = base;
  }
  return new Date(baseTime.getTime() + ms).toISOString();
}

// -------- Прогресс --------

export function incrementResponse(r: UniversalRun): UniversalRun {
  const next = r.respondedDirections + 1;
  const status: RunStatus =
    next >= r.totalDirections ? 'aggregated' : 'collecting';
  return { ...r, respondedDirections: next, status };
}

export function getResponseProgress(r: UniversalRun): number {
  if (r.totalDirections === 0) {return 0;}
  return Math.round((r.respondedDirections / r.totalDirections) * 10000) / 100;
}

// -------- Агрегация --------

export function aggregate(responses: Array<{
  directionId: UUID;
  response: SignalResponseType;
}>): RunSummary {
  const summary: RunSummary = {
    support: 0, object: 0, clarify: 0, amend: 0, noInfluence: 0,
    total: responses.length,
    byDirection: responses.map((r) => ({
      directionId: r.directionId,
      response: r.response,
    })),
  };
  for (const r of responses) {
    switch (r.response) {
      case 'support':      summary.support++; break;
      case 'object':       summary.object++; break;
      case 'clarify':      summary.clarify++; break;
      case 'amend':        summary.amend++; break;
      case 'no_influence': summary.noInfluence++; break;
    }
  }
  return summary;
}

// -------- Готовность к плану --------

export function canProceedToPlan(
  responses: Array<{ response: SignalResponseType }>,
): { allowed: boolean; reason?: string } {
  // Нужно хотя бы одно «Поддерживаю» и ни одного «Возражаю»
  const hasSupport = responses.some((r) => r.response === 'support');
  const hasObject = responses.some((r) => r.response === 'object');
  if (!hasSupport) {
    return { allowed: false, reason: 'Нет ни одной поддержки' };
  }
  if (hasObject) {
    return { allowed: false, reason: 'Есть возражения — нужен Коннект или Арбитраж' };
  }
  return { allowed: true };
}

// -------- Квант ускорения --------

export function getAcceleratedDeadline(
  type: RunType, priority: Priority,
  accelerated: boolean,
  baseTime: Date = new Date(),
): ISODateTime {
  const base = getDeadlineForRun(type, priority, baseTime);
  if (!accelerated) {return base;}
  const ms = Math.floor((new Date(base).getTime() - baseTime.getTime()) / QUANTUM_ACCELERATION);
  return new Date(baseTime.getTime() + ms).toISOString();
}