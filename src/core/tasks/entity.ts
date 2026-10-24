// C.0.07.01 — Доменная сущность Задача

import { PRIORITY_DEADLINES_MS } from '../constants.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, Priority, TaskStatus } from '../types.js';

export interface Task {
  id: UUID;
  externalId: string;
  planId: UUID | null;
  directionId: UUID;
  description: string;
  requiredCompetencies: string[];
  location: { lat: number; lon: number } | null;
  priority: Priority;
  status: TaskStatus;
  assignedTo: UUID | null;
  assignedBy: UUID | null;
  deadline: ISODateTime | null;
  parentTaskId: UUID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CreateTaskInput {
  id: UUID;
  externalId: string;
  planId?: UUID;
  directionId: UUID;
  description: string;
  priority: Priority;
  requiredCompetencies?: string[];
  location?: { lat: number; lon: number };
  baseTime?: Date;
}

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ['assigned'],
  assigned: ['in_progress', 'created'],
  in_progress: ['submitted'],
  submitted: ['accepted', 'returned'],
  returned: ['in_progress'],
  accepted: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function getDeadlineForPriority(priority: Priority, baseTime: Date = new Date()): ISODateTime {
  const ms = PRIORITY_DEADLINES_MS[priority];
  return new Date(baseTime.getTime() + ms).toISOString();
}

export function createTask(input: CreateTaskInput): Task {
  if (!input.description.trim()) {throw new ValidationError('Описание задачи обязательно');}

  const now = new Date();
  const deadline = getDeadlineForPriority(input.priority, input.baseTime ?? now);

  return {
    id: input.id,
    externalId: input.externalId,
    planId: input.planId ?? null,
    directionId: input.directionId,
    description: input.description.trim(),
    requiredCompetencies: input.requiredCompetencies ?? [],
    location: input.location ?? null,
    priority: input.priority,
    status: 'created',
    assignedTo: null,
    assignedBy: null,
    deadline,
    parentTaskId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function assignTask(t: Task, participantId: UUID): Task {
  if (!canTransition(t.status, 'assigned')) {
    throw new ConflictError(`Нельзя назначить задачу в статусе ${t.status}`);
  }
  return { ...t, status: 'assigned', assignedTo: participantId, updatedAt: new Date().toISOString() };
}

export function takeTask(t: Task, participantId: UUID): Task {
  if (t.assignedTo !== participantId) {
    throw new ConflictError('Взять задачу может только назначенный участник');
  }
  if (!canTransition(t.status, 'in_progress')) {
    throw new ConflictError(`Нельзя взять задачу в статусе ${t.status}`);
  }
  return { ...t, status: 'in_progress', updatedAt: new Date().toISOString() };
}

export function submitTask(t: Task): Task {
  if (!canTransition(t.status, 'submitted')) {
    throw new ConflictError(`Нельзя сдать задачу в статусе ${t.status}`);
  }
  return { ...t, status: 'submitted', updatedAt: new Date().toISOString() };
}

export function acceptTask(t: Task): Task {
  if (!canTransition(t.status, 'accepted')) {
    throw new ConflictError(`Нельзя принять задачу в статусе ${t.status}`);
  }
  return { ...t, status: 'accepted', updatedAt: new Date().toISOString() };
}

export function returnTask(t: Task, _reason: string): Task {
  if (!canTransition(t.status, 'returned')) {
    throw new ConflictError(`Нельзя вернуть задачу в статусе ${t.status}`);
  }
  return { ...t, status: 'returned', updatedAt: new Date().toISOString() };
}

export function isOverdue(t: Task, now: Date = new Date()): boolean {
  if (!t.deadline) {return false;}
  if (t.status === 'accepted' || t.status === 'returned') {return false;}
  return new Date(t.deadline).getTime() < now.getTime();
}

export function formatTaskExternalId(type: string, date: Date, sequence: number): string {
  if (!/^[А-Я]{3}$/.test(type)) {throw new ValidationError('Тип задачи: 3 заглавные кириллицы');}
  if (sequence < 0 || sequence > 999) {throw new ValidationError('Номер задачи 0–999');}
  const d = date.toISOString().slice(0, 10);
  return `${type}-${d}-${String(sequence).padStart(3, '0')}`;
}