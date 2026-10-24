// C.0.35.01 — Доменная сущность Админ
// Дашборд, карта мандатов, запись аудита, снимок системы, recovery-очередь.
// Чистые фабрики + проверки. Все действия Архитектора логируются.
//
// Реализовано частично: read-only снимки (dashboard, mandates map, system status,
// recovery queue). Мутации (delegate, rotate, bootstrap, seed) — тонкие обёртки
// над соответствующими сервисами, реализуются в C.0.35.02.

import { ValidationError, ForbiddenError } from '../errors.js';
import type { Role } from '../roles.js';
import type { UUID, ISODateTime } from '../types.js';

// -------- Типы --------

export interface AdminDashboard {
  participantsTotal: number;
  directionsTotal: number;
  activeMandates: number;
  openSignals: number;
  activeRegimes: number;
  recoveryPending: number;    // NEW
  updatedAt: ISODateTime;
}

export interface MandatesMapEntry {
  directionId: UUID;
  holderId: UUID;
  function: string;
  expiresAt: ISODateTime;
}

export interface MandatesMap {
  directions: MandatesMapEntry[];
  heldByArchitect: string[];
  delegated: Array<{ function: string; holderId: UUID; validTo: ISODateTime }>;
  updatedAt: ISODateTime;
}

export interface AuditLogEntry {
  id: UUID;
  actorId: UUID | null;
  actorType: 'participant' | 'ai' | 'system';
  action: string;
  entityType: string;
  entityId: UUID;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: ISODateTime;
}

export interface SystemStatus {
  healthy: boolean;
  services: Record<string, 'ok' | 'fail'>;
  uptimeSec: number;
  version: string;
}

export interface RecoveryQueueItem {
  requestId: UUID;
  participantId: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: 'pending' | 'approved' | 'used' | 'rejected' | 'expired';
  requestedAt: ISODateTime;
  requestedIp: string | null;
  approvedBy: UUID | null;
  approvedAt: ISODateTime | null;
  tokenExpiresAt: ISODateTime | null;
  usedAt: ISODateTime | null;
  rejectReason: string | null;
}

// -------- Проверки --------

/**
 * Действия уровня Архитектора требуют роли FIRST_ARCHITECT.
 * Вызывающий сервис получает уже проверенного актора; контроллер решает,
 * что вернуть при отказе.
 */
export function assertArchitect(role: Role | null): void {
  if (role !== 'FIRST_ARCHITECT') {
    throw new ForbiddenError('Требуется роль FIRST_ARCHITECT');
  }
}

export function validateBootstrapInput(input: {
  directionCount: number;
  architectName: string;
  architectPhone: string;
}): void {
  if (input.directionCount <= 0 || input.directionCount > 99) {
    throw new ValidationError('directionCount должен быть 1..99');
  }
  if (!input.architectName.trim()) {
    throw new ValidationError('architectName не может быть пустым');
  }
  if (!input.architectPhone.trim()) {
    throw new ValidationError('architectPhone не может быть пустым');
  }
}