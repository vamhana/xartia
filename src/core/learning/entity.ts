// C.0.31.01 — Доменная сущность Обучение.
// Восемь сущностей: курс, запись, цифровой наставник, ПТТ,
// когнитивный маршрут, рефреш-курс, модуль, интегратор.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed' | 'dropped';
export type PttStatus =
  | 'started' | 'compression' | 'materialization' | 'reintegration'
  | 'completed' | 'cancelled';
export type RouteStatus = 'active' | 'completed' | 'cancelled';

export interface Course {
  id: UUID;
  title: string;
  description: string | null;
  modules: Array<Record<string, unknown>>;
  durationDays: number;
  createdAt: ISODateTime;
}

export interface Enrollment {
  id: UUID;
  courseId: UUID;
  participantId: UUID;
  status: EnrollmentStatus;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface DigitalMentor {
  id: UUID;
  mentorType: 'ai';
  activeMentees: number;
  algorithmVersion: string;
  createdAt: ISODateTime;
}

export interface Ptt {
  id: UUID;
  goal: string;
  durationDays: number;
  status: PttStatus;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface CognitiveRoute {
  id: UUID;
  participantId: UUID;
  directionId: UUID;
  mentorId: UUID;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  status: RouteStatus;
  certificateIssued: boolean;
}

export interface RefreshCourse {
  id: UUID;
  participantId: UUID;
  direction1Id: UUID;
  direction2Id: UUID;
  moduleBasicDefense: boolean;
  moduleRespect: boolean;
  passedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface ModulePass {
  id: UUID;
  participantId: UUID;
  module: string;
  passedAt: ISODateTime;
}

export interface IntegratorMentor {
  id: UUID;
  mentorId: UUID;
  directionId: UUID;
  mentees: UUID[];
  maxMentees: number;
  createdAt: ISODateTime;
}

// ─── Константы (I.4.6.1, V.1.3.5, V.1.12.3, I.6.12.2) ────────────

export const LEARNING_CONSTANTS = {
  PTT_MAX_DAYS: 90,
  PTT_MIN_INTERVAL_DAYS: 1825,
  DIGITAL_MENTOR_MAX_MENTEES: 50,
  ROUTE_DURATION_DAYS: 30,
  ROUTE_EXCURSION_PCT: 1,
  REFRESH_INTERVAL_YEARS: 5,
  INTEGRATOR_MAX_MENTEES: 3,
  INTEGRATOR_MIN_YEARS: 15,
  INTEGRATOR_MIN_ROUTES: 5,
} as const;

// ─── Чистые функции ─────────────────────────────────────────────

export function createCourse(input: {
  id: UUID;
  title: string;
  description?: string;
  modules: Array<Record<string, unknown>>;
  durationDays: number;
}): Course {
  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError('Название курса обязательно');
  }
  if (input.durationDays <= 0) {
    throw new ValidationError('Длительность должна быть > 0');
  }
  return {
    id: input.id,
    title: input.title.trim(),
    description: input.description?.trim() ?? null,
    modules: input.modules,
    durationDays: input.durationDays,
    createdAt: new Date().toISOString(),
  };
}

export function enroll(courseId: UUID, participantId: UUID): Enrollment {
  return {
    id: crypto.randomUUID(),
    courseId,
    participantId,
    status: 'enrolled',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

export function completeCourse(e: Enrollment): Enrollment {
  if (e.status === 'completed') {
    throw new ConflictError('Курс уже завершён');
  }
  return {
    ...e,
    status: 'completed',
    finishedAt: new Date().toISOString(),
  };
}

export function createDigitalMentor(version: string): DigitalMentor {
  return {
    id: crypto.randomUUID(),
    mentorType: 'ai',
    activeMentees: 0,
    algorithmVersion: version,
    createdAt: new Date().toISOString(),
  };
}

export function canAcceptMentee(dm: DigitalMentor): boolean {
  return dm.activeMentees < LEARNING_CONSTANTS.DIGITAL_MENTOR_MAX_MENTEES;
}

export function startPtt(goal: string, durationDays: number): Ptt {
  if (!goal || goal.trim().length === 0) {
    throw new ValidationError('Цель ПТТ обязательна');
  }
  if (durationDays <= 0 || durationDays > LEARNING_CONSTANTS.PTT_MAX_DAYS) {
    throw new ValidationError(
      `Длительность ПТТ должна быть 1–${LEARNING_CONSTANTS.PTT_MAX_DAYS} дней`,
    );
  }
  return {
    id: crypto.randomUUID(),
    goal: goal.trim(),
    durationDays,
    status: 'started',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

export function advancePtt(p: Ptt): Ptt {
  const next: Record<PttStatus, PttStatus> = {
    started: 'compression',
    compression: 'materialization',
    materialization: 'reintegration',
    reintegration: 'completed',
    completed: 'completed',
    cancelled: 'cancelled',
  };
  const to = next[p.status];
  if (to === p.status) {
    throw new ConflictError(`ПТТ уже в статусе ${p.status}`);
  }
  const finishedAt =
    to === 'completed' ? new Date().toISOString() : p.finishedAt;
  return { ...p, status: to, finishedAt };
}

export function createRoute(
  participantId: UUID,
  directionId: UUID,
  mentorId: UUID,
): CognitiveRoute {
  return {
    id: crypto.randomUUID(),
    participantId,
    directionId,
    mentorId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'active',
    certificateIssued: false,
  };
}

export function completeRoute(r: CognitiveRoute): CognitiveRoute {
  if (r.status === 'completed') {
    throw new ConflictError('Маршрут уже завершён');
  }
  return {
    ...r,
    status: 'completed',
    certificateIssued: true,
    finishedAt: new Date().toISOString(),
  };
}

export function getRouteQueueSize(directionSize: number): number {
  return Math.floor(directionSize * (LEARNING_CONSTANTS.ROUTE_EXCURSION_PCT / 100));
}

export function startRefresh(
  participantId: UUID,
  d1: UUID,
  d2: UUID,
): RefreshCourse {
  if (d1 === d2) {
    throw new ValidationError('Направления должны различаться');
  }
  return {
    id: crypto.randomUUID(),
    participantId,
    direction1Id: d1,
    direction2Id: d2,
    moduleBasicDefense: false,
    moduleRespect: false,
    passedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function passModule(participantId: UUID, module: string): ModulePass {
  if (!module || module.trim().length === 0) {
    throw new ValidationError('Модуль обязателен');
  }
  return {
    id: crypto.randomUUID(),
    participantId,
    module: module.trim(),
    passedAt: new Date().toISOString(),
  };
}

export function assignIntegrator(
  mentorId: UUID,
  directionId: UUID,
): IntegratorMentor {
  return {
    id: crypto.randomUUID(),
    mentorId,
    directionId,
    mentees: [],
    maxMentees: LEARNING_CONSTANTS.INTEGRATOR_MAX_MENTEES,
    createdAt: new Date().toISOString(),
  };
}

export function addIntegratorMentee(
  im: IntegratorMentor,
  menteeId: UUID,
): IntegratorMentor {
  if (im.mentees.includes(menteeId)) {
    throw new ConflictError('Этот участник уже под опекой');
  }
  if (im.mentees.length >= im.maxMentees) {
    throw new ConflictError(
      `Максимум ${im.maxMentees} экскурсантов (I.6.4.1)`,
    );
  }
  return { ...im, mentees: [...im.mentees, menteeId] };
}

export function canBeIntegrator(mentor: {
  routesPassed: number;
  activeYears: number;
}): boolean {
  return (
    mentor.routesPassed >= LEARNING_CONSTANTS.INTEGRATOR_MIN_ROUTES &&
    mentor.activeYears >= LEARNING_CONSTANTS.INTEGRATOR_MIN_YEARS
  );
}