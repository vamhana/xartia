// C.0.02.01 — Доменная сущность Участник
// ID неизменен на всю жизнь. Все переходы статусов логируются.
// Используется сервисом C.0.02.02 и всеми другими сервисами.

import {
  formatParticipantId,
  parseParticipantId,
  type ParsedParticipantId,
} from '../../lib/id.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, ParticipantStatus, RiskLevel } from '../types.js';

// -------- Типы --------

export interface Participant {
  id: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  phone: string;                    // расшифрованный (сервис отвечает за шифрование)
  messengers: Record<string, string>;
  directionId: UUID;
  subdirection: string | null;
  professionId: UUID | null;
  status: ParticipantStatus;
  profileRisk: RiskLevel;
  mentorId: UUID | null;
  cellId: UUID | null;
  geolocation: { lat: number; lon: number } | null;
  geoEnabled: boolean;
  enteredAt: ISODateTime;
  welcomePackGiven: boolean;
  isFirstArchitect: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CreateParticipantInput {
  id: UUID;
  wave: string;
  waveNumber: number;
  directionNumber: number;
  subdirection?: string;
  name: string;
  pseudonym?: string | null;
  phone: string;
  messengers: Record<string, string>;
  directionId: UUID;
  professionId?: UUID | null;
  status?: ParticipantStatus;
  profileRisk?: RiskLevel;
  enteredAt?: ISODateTime;
}

// -------- Создание --------

export function createParticipant(input: CreateParticipantInput): Participant {
  if (!input.name.trim()) {
    throw new ValidationError('Имя участника не может быть пустым');
  }
  if (!input.phone.trim()) {
    throw new ValidationError('Телефон обязателен');
  }
  if (!input.messengers || Object.keys(input.messengers).length === 0) {
    throw new ValidationError('Хотя бы один мессенджер обязателен');
  }

  const externalId = formatParticipantId(
    input.wave,
    input.waveNumber,
    input.directionNumber,
    input.subdirection,
  );

  const now = input.enteredAt ?? new Date().toISOString();

  return {
    id: input.id,
    externalId,
    name: input.name.trim(),
    pseudonym: input.pseudonym ?? null,
    phone: input.phone,
    messengers: input.messengers,
    directionId: input.directionId,
    subdirection: input.subdirection ?? null,
    professionId: input.professionId ?? null,
    status: input.status ?? 'associated',
    profileRisk: input.profileRisk ?? 'compatible',
    mentorId: null,
    cellId: null,
    geolocation: null,
    geoEnabled: false,
    enteredAt: now,
    welcomePackGiven: false,
    isFirstArchitect: false,
    createdAt: now,
    updatedAt: now,
  };
}

// -------- Мутации (иммутабельные) --------

export function assignDirection(
  p: Participant,
  directionId: UUID,
  subdirection?: string,
): Participant {
  return {
    ...p,
    directionId,
    subdirection: subdirection ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export function assignProfession(
  p: Participant,
  professionId: UUID | null,
): Participant {
  return {
    ...p,
    professionId,
    updatedAt: new Date().toISOString(),
  };
}

export function assignMentor(p: Participant, mentorId: UUID | null): Participant {
  return {
    ...p,
    mentorId,
    updatedAt: new Date().toISOString(),
  };
}

export function assignCell(p: Participant, cellId: UUID | null): Participant {
  return {
    ...p,
    cellId,
    updatedAt: new Date().toISOString(),
  };
}

// -------- Смена статуса --------

const ALLOWED_TRANSITIONS: Record<ParticipantStatus, readonly ParticipantStatus[]> = {
  associated: ['compatible', 'conditionally_compatible', 'paused', 'excluded', 'outside_trust_network'],
  compatible: ['full', 'associated', 'paused', 'outside_trust_network', 'excluded'],
  conditionally_compatible: ['compatible', 'paused', 'outside_trust_network', 'excluded'],
  full: ['master', 'integrator', 'pioneer', 'associated', 'paused', 'outside_trust_network', 'excluded'],
  paused: ['associated', 'compatible', 'excluded'],
  outside_trust_network: ['associated', 'excluded'],
  master: ['full', 'paused', 'outside_trust_network', 'excluded'],
  integrator: ['full', 'paused', 'outside_trust_network', 'excluded'],
  pioneer: ['full', 'paused', 'outside_trust_network', 'excluded'],
  excluded: [],
};

export function canTransition(from: ParticipantStatus, to: ParticipantStatus): boolean {
  if (from === to) {return false;}
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function changeStatus(
  p: Participant,
  status: ParticipantStatus,
  _reason: string,
): Participant {
  if (!canTransition(p.status, status)) {
    throw new ConflictError(
      `Недопустимый переход статуса: ${p.status} → ${status}`,
      { from: p.status, to: status },
    );
  }
  return {
    ...p,
    status,
    updatedAt: new Date().toISOString(),
  };
}

// -------- Хелперы --------

export function isActive(p: Participant): boolean {
  return p.status !== 'excluded' && p.status !== 'outside_trust_network';
}

export function isOnPause(p: Participant): boolean {
  return p.status === 'paused';
}

// -------- Смена направления --------

export interface DirectionChangeCheck {
  allowed: boolean;
  reason?: string;
}

export function canChangeDirection(
  _p: Participant,
  directionChanges: number,
): DirectionChangeCheck {
  // I.1.12.4: не более 2 смен за жизнь без полного пути вхождения
  if (directionChanges >= 2) {
    return {
      allowed: false,
      reason: 'Превышен лимит смен направления (максимум 2 без полного пути вхождения)',
    };
  }
  return { allowed: true };
}

// -------- Переработано: parseExternalId --------

export function parseExternalId(externalId: string): ParsedParticipantId {
  return parseParticipantId(externalId);
}