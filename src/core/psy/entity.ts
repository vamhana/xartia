// C.0.23.01 — Доменная сущность Психоэкология.
// Психологическое здоровье общества, профилактика выгорания, экзистенциальные кризисы.
// Не лечит психические заболевания (это Здравие).
// Работает на уровне гигиены смыслов, эмоциональной экологии и коллективных настроений.
//
// Психоэкология — направление №12 (I.4.12). Наблюдатели во всех направлениях (I.4.12).
// Рефлексивная разгрузка — 3–5 дней (пост-ПТТ 3 дня, пост-Стальной Колокол 5 дней, I.2.6).
// Программа «Поиск резонанса» — V.1.6.2. Систематическое насилие → аудит (I.4.8).

import { ValidationError, ConflictError } from '../errors.js';
import type {
  UUID,
  ISODateTime,
  PsySessionType,
  PsySessionStatus,
} from '../types.js';

export type { PsySessionType, PsySessionStatus };

// ─── Типы статусов (не пересекаются с core/types.ts) ─────────────

export type PsyCrisisStatus = 'open' | 'in_progress' | 'closed';
export type PsyDischargeStatus = 'scheduled' | 'in_progress' | 'completed';
export type HygieneStatus = 'proposed' | 'applied';
export type WellbeingTrend = 'up' | 'stable' | 'down';

// ─── Сущности ────────────────────────────────────────────────────

export interface PsySession {
  id: UUID;
  participantId: UUID;
  psychologistId: UUID;
  type: PsySessionType;
  notes: string | null;
  status: PsySessionStatus;
  scheduledAt: ISODateTime;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface PsyObserver {
  id: UUID;
  participantId: UUID;
  directionId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface PsyCrisis {
  id: UUID;
  participantId: UUID;
  status: PsyCrisisStatus;
  notes: string | null;
  createdAt: ISODateTime;
  closedAt: ISODateTime | null;
}

export interface PsyDischarge {
  id: UUID;
  participantId: UUID;
  days: number;
  status: PsyDischargeStatus;
  createdAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface MoodMetric {
  id: UUID;
  directionId: UUID;
  metric: string;
  value: number;
  period: string;
  hasData: boolean;
  createdAt: ISODateTime;
}

export interface Wellbeing {
  id: UUID;
  participantId: UUID;
  score: number;
  trend: WellbeingTrend;
  createdAt: ISODateTime;
}

export interface Hygiene {
  id: UUID;
  directionId: UUID;
  measure: string;
  status: HygieneStatus;
  createdAt: ISODateTime;
  appliedAt: ISODateTime | null;
}

// ─── Константы ───────────────────────────────────────────────────

export const PSY_DISCHARGE_MIN_DAYS = 3;
export const PSY_DISCHARGE_MAX_DAYS = 5;
export const PSY_WELLBEING_MIN = 1;
export const PSY_WELLBEING_MAX = 10;
export const PSY_SYSTEMIC_VIOLENCE_THRESHOLD = 3;
export const PSY_TREND_DELTA = 0.5;

// ─── Чистые функции создания ─────────────────────────────────────

export interface CreateSessionInput {
  id: UUID;
  participantId: UUID;
  psychologistId: UUID;
  type: PsySessionType;
  scheduledAt: ISODateTime;
}

export function createSession(input: CreateSessionInput): PsySession {
  if (!input.participantId) { throw new ValidationError('participantId обязателен'); }
  if (!input.psychologistId) { throw new ValidationError('psychologistId обязателен'); }
  if (!input.scheduledAt) { throw new ValidationError('scheduledAt обязателен'); }
  if (input.psychologistId === input.participantId) {
    throw new ValidationError(
      'Психолог не может совпадать с участником — укажите другого psychologist_id (I.4.12)',
    );
  }
  return {
    id: input.id,
    participantId: input.participantId,
    psychologistId: input.psychologistId,
    type: input.type,
    notes: null,
    status: 'scheduled',
    scheduledAt: input.scheduledAt,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function completeSession(s: PsySession, notes: string): PsySession {
  if (s.status === 'completed') { throw new ConflictError('Сессия уже завершена'); }
  if (s.status === 'cancelled') { throw new ConflictError('Сессия отменена'); }
  return {
    ...s,
    status: 'completed',
    notes: notes.trim().length > 0 ? notes : s.notes,
    completedAt: new Date().toISOString(),
  };
}

export function assignObserver(input: {
  id: UUID;
  participantId: UUID;
  directionId: UUID;
}): PsyObserver {
  return {
    id: input.id,
    participantId: input.participantId,
    directionId: input.directionId,
    validFrom: new Date().toISOString(),
    validTo: null,
  };
}

export function startCrisis(input: {
  id: UUID;
  participantId: UUID;
  notes?: string | null;
}): PsyCrisis {
  return {
    id: input.id,
    participantId: input.participantId,
    status: 'open',
    notes: input.notes ?? null,
    createdAt: new Date().toISOString(),
    closedAt: null,
  };
}

export function startDischarge(input: {
  id: UUID;
  participantId: UUID;
  days: number;
}): PsyDischarge {
  if (!Number.isInteger(input.days) || input.days < PSY_DISCHARGE_MIN_DAYS) {
    throw new ValidationError(
      `Разгрузка не менее ${PSY_DISCHARGE_MIN_DAYS} дней (I.4.4)`,
    );
  }
  if (input.days > PSY_DISCHARGE_MAX_DAYS) {
    throw new ValidationError(
      `Разгрузка не более ${PSY_DISCHARGE_MAX_DAYS} дней (I.2.6)`,
    );
  }
  return {
    id: input.id,
    participantId: input.participantId,
    days: input.days,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function recordWellbeing(input: {
  id: UUID;
  participantId: UUID;
  score: number;
}): Wellbeing {
  if (
    !Number.isInteger(input.score) ||
    input.score < PSY_WELLBEING_MIN ||
    input.score > PSY_WELLBEING_MAX
  ) {
    throw new ValidationError(
      `score должен быть целым ${PSY_WELLBEING_MIN}–${PSY_WELLBEING_MAX}`,
    );
  }
  return {
    id: input.id,
    participantId: input.participantId,
    score: input.score,
    trend: 'stable',
    createdAt: new Date().toISOString(),
  };
}

export function proposeHygiene(input: {
  id: UUID;
  directionId: UUID;
  measure: string;
}): Hygiene {
  if (!input.measure.trim()) {
    throw new ValidationError('measure обязателен');
  }
  return {
    id: input.id,
    directionId: input.directionId,
    measure: input.measure.trim(),
    status: 'proposed',
    createdAt: new Date().toISOString(),
    appliedAt: null,
  };
}

// Расчёт тренда благополучия по последним записям участника.
// recent — записи в хронологическом порядке (от старой к новой).
export function calculateWellbeingTrend(recent: number[]): WellbeingTrend {
  if (recent.length < 2) { return 'stable'; }
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) { return 'stable'; }
  const delta = last - first;
  if (delta > PSY_TREND_DELTA) { return 'up'; }
  if (delta < -PSY_TREND_DELTA) { return 'down'; }
  return 'stable';
}