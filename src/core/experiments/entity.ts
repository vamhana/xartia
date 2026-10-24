// C.0.30.01 — Доменная сущность Experiments.
// Эксперименты (VIII.1) и диссидентские проекты (I.1.8.10).
// Протоколы до 5 лет, утверждение 75% через Всеобщий прогон.
// Диссидентские: 1% подписей, отчёты каждые 60 дней, пересмотр через 2 года.
//
// Чистые функции, без побочных эффектов.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type ExperimentStatus =
  | 'filed'
  | 'approved'
  | 'active'
  | 'completed'
  | 'cancelled';

export type DissidentResourceSource = 'deferred_flow' | 'freedom_reserve';

export type DissidentStatus =
  | 'filed'
  | 'active'
  | 'suspended'
  | 'reviewed'
  | 'closed';

export interface Experiment {
  id: UUID;
  externalId: string;
  goal: string;
  termDays: number;
  participants: UUID[];
  criteria: Record<string, unknown>;
  status: ExperimentStatus;
  approvedBy: UUID | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface ExperimentResults {
  id: UUID;
  protocolId: UUID;
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
  published: boolean;
  createdAt: ISODateTime;
}

export interface DissidentProject {
  id: UUID;
  initiatorId: UUID;
  description: string;
  petitionCount: number;
  requiredPercent: number;
  resourceSource: DissidentResourceSource;
  status: DissidentStatus;
  reportIntervalDays: number;
  lastReportAt: ISODateTime | null;
  closedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

export const EXPERIMENT_MAX_TERM_DAYS = 1825;         // 5 лет (I.8.1.4)
export const DISSIDENT_PETITION_PCT = 0.01;           // 1% (I.1.8.10)
export const DISSIDENT_REPORT_INTERVAL_DAYS = 60;
export const DISSIDENT_REVIEW_YEARS = 2;
export const DISSIDENT_FREEDOM_RESERVE_PCT = 0.02;    // 2% (I.1.8.10)
export const EXPERIMENT_APPROVAL_PCT = 0.75;          // 75% (VIII.1.2.2)

// ─── formatExternalId ───────────────────────────────────────────

/** `EXP-<num>-<year>` — согласовано с CHECK в 003_tables.sql. */
export function formatExternalId(number: number, year: number): string {
  if (!Number.isInteger(number) || number < 1) {
    throw new ValidationError('External ID number must be positive integer');
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError('Year must be 2000..2100');
  }
  return `EXP-${number}-${year}`;
}

// ─── Создание эксперимента ──────────────────────────────────────

export interface CreateExperimentInput {
  id: UUID;
  externalId: string;
  goal: string;
  termDays: number;
  criteria: Record<string, unknown>;
  initiatorId: UUID;
}

export function createExperiment(input: CreateExperimentInput): Experiment {
  if (!input.goal || !input.goal.trim()) {
    throw new ValidationError('goal обязателен');
  }
  if (
    !Number.isInteger(input.termDays) ||
    input.termDays < 1 ||
    input.termDays > EXPERIMENT_MAX_TERM_DAYS
  ) {
    throw new ValidationError(
      `term_days должен быть 1..${EXPERIMENT_MAX_TERM_DAYS} (I.8.1.4)`,
      [{ path: 'term_days', message: `1..${EXPERIMENT_MAX_TERM_DAYS}` }],
    );
  }
  if (!input.criteria || Object.keys(input.criteria).length === 0) {
    throw new ValidationError('criteria обязательны');
  }
  return {
    id: input.id,
    externalId: input.externalId,
    goal: input.goal.trim(),
    termDays: input.termDays,
    participants: [input.initiatorId],
    criteria: input.criteria,
    status: 'filed',
    approvedBy: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

// ─── Переходы эксперимента ─────────────────────────────────────

export function approveExperiment(
  e: Experiment,
  approvedBy: UUID,
): Experiment {
  if (e.status === 'active') {
    return e; // идемпотентно
  }
  if (e.status !== 'filed') {
    throw new ConflictError(
      `Эксперимент в статусе '${e.status}' нельзя утвердить`,
    );
  }
  return { ...e, status: 'active', approvedBy };
}

export function joinExperiment(
  e: Experiment,
  participantId: UUID,
): Experiment {
  if (e.status !== 'filed' && e.status !== 'active') {
    throw new ConflictError(
      `Эксперимент в статусе '${e.status}' — присоединение недоступно`,
    );
  }
  if (e.participants.includes(participantId)) {
    throw new ConflictError('Участник уже в эксперименте');
  }
  return { ...e, participants: [...e.participants, participantId] };
}

export function leaveExperiment(
  e: Experiment,
  participantId: UUID,
): Experiment {
  if (!e.participants.includes(participantId)) {
    throw new ConflictError('Участник не в эксперименте');
  }
  return {
    ...e,
    participants: e.participants.filter((p) => p !== participantId),
  };
}

export function completeExperiment(e: Experiment): Experiment {
  if (e.status === 'completed') {
    throw new ConflictError('Эксперимент уже завершён');
  }
  if (e.status === 'cancelled') {
    throw new ConflictError('Эксперимент отменён');
  }
  return {
    ...e,
    status: 'completed',
    finishedAt: new Date().toISOString(),
  };
}

// ─── Результаты ─────────────────────────────────────────────────

export function recordResults(input: {
  id: UUID;
  protocolId: UUID;
  successes: string[];
  failures: string[];
  stats: Record<string, unknown>;
}): ExperimentResults {
  if (!Array.isArray(input.successes) || !Array.isArray(input.failures)) {
    throw new ValidationError('successes и failures должны быть массивами');
  }
  return {
    id: input.id,
    protocolId: input.protocolId,
    successes: input.successes,
    failures: input.failures,
    stats: input.stats ?? {},
    published: false,
    createdAt: new Date().toISOString(),
  };
}

// ─── Диссидентские проекты ─────────────────────────────────────

export interface CreateDissidentInput {
  id: UUID;
  initiatorId: UUID;
  description: string;
}

export function createDissident(input: CreateDissidentInput): DissidentProject {
  if (!input.description || !input.description.trim()) {
    throw new ValidationError('description обязателен');
  }
  return {
    id: input.id,
    initiatorId: input.initiatorId,
    description: input.description.trim(),
    petitionCount: 0,
    requiredPercent: 1, // 1% по умолчанию
    resourceSource: 'deferred_flow',
    status: 'filed',
    reportIntervalDays: DISSIDENT_REPORT_INTERVAL_DAYS,
    lastReportAt: null,
    closedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function signPetition(d: DissidentProject): DissidentProject {
  if (d.status === 'closed') {
    throw new ConflictError('Проект закрыт');
  }
  if (d.status === 'reviewed') {
    throw new ConflictError('Проект на пересмотре');
  }
  return { ...d, petitionCount: d.petitionCount + 1 };
}

/**
 * I.1.8.10: проект получает финансирование при petitionCount >= totalParticipants * 1%.
 * Минимум 1 подпись — иначе проект с 0 подписей «никогда» не наберёт 1% на малой базе.
 */
export function hasEnoughSignatures(
  d: DissidentProject,
  totalParticipants: number,
): boolean {
  if (totalParticipants <= 0) {return false;}
  const required = Math.max(
    1,
    Math.ceil(totalParticipants * DISSIDENT_PETITION_PCT),
  );
  return d.petitionCount >= required;
}

/**
 * Источник финансирования:
 * - 'freedom_reserve' при `petitionCount >= totalParticipants * 2%` (I.1.8.10):
 *   подавление проекта Советом → 2% Резерва свободы.
 * - 'deferred_flow' в остальных случаях (при 1%).
 *
 * Принимает totalParticipants как аргумент, чтобы не тянуть SQL в entity.
 */
export function resourceSourceFor(
  d: DissidentProject,
  totalParticipants: number,
): DissidentResourceSource {
  if (totalParticipants <= 0) {return 'deferred_flow';}
  const freedomThreshold = totalParticipants * DISSIDENT_FREEDOM_RESERVE_PCT;
  if (d.petitionCount >= freedomThreshold && freedomThreshold >= 1) {
    return 'freedom_reserve';
  }
  return 'deferred_flow';
}

export function reportDissident(
  _d: DissidentProject,
  now: Date = new Date(),
): { nextReportAt: ISODateTime } {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + DISSIDENT_REPORT_INTERVAL_DAYS);
  return { nextReportAt: next.toISOString() };
}

/**
 * I.1.8.10: приостановка при отсутствии отчёта > 60 дней.
 *
 * Спека говорит «lastReportAt === null → suspend», но это убивает
 * только что созданный проект. Defense-in-depth:
 *   - lastReportAt === null → suspend ТОЛЬКО если now - createdAt > 60 дней;
 *   - lastReportAt !== null → suspend если now - lastReportAt > 60 дней.
 */
export function shouldSuspend(
  d: DissidentProject,
  now: Date = new Date(),
): boolean {
  const cutoff = DISSIDENT_REPORT_INTERVAL_DAYS * 86_400_000;
  if (d.lastReportAt === null) {
    const created = new Date(d.createdAt).getTime();
    return now.getTime() - created > cutoff;
  }
  const lastReport = new Date(d.lastReportAt).getTime();
  return now.getTime() - lastReport > cutoff;
}

/**
 * I.1.8.10: пересмотр через 2 года с момента создания.
 */
export function canReview(
  d: DissidentProject,
  now: Date = new Date(),
): boolean {
  const created = new Date(d.createdAt).getTime();
  const twoYears = DISSIDENT_REVIEW_YEARS * 365 * 86_400_000;
  return now.getTime() - created >= twoYears;
}