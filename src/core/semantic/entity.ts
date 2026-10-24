// C.0.29.01 — Доменная сущность Семантический Страж
// Дрейф, тревога, вето, словарь, проверка перевода.
// Страж — автономная группа в Ноологии. Не может быть отстранён иначе как через 1.10.3.

import {
  SEMANTIC_ALARM_RESPONSE_HOURS,
  SEMANTIC_VETO_DAYS,
} from '../constants.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

// -------- Типы --------

export type DriftStatus = 'new' | 'analyzed' | 'resolved';
export type AlarmStatus = 'raised' | 'acknowledged' | 'escalated' | 'resolved';
export type AlarmEscalation = 'council' | 'forum' | 'referendum';
export type VetoType = 'semantic_guardian' | 'jury';
export type VetoStatus = 'active' | 'lifted' | 'expired';

export interface SemanticDrift {
  id: UUID;
  term: string;
  originalMeaning: string;
  detectedMeaning: string;
  severity: number; // 1–10
  detectedBy: UUID;
  status: DriftStatus;
  createdAt: ISODateTime;
  resolvedAt: ISODateTime | null;
}

export interface SemanticAlarm {
  id: UUID;
  driftId: UUID | null;
  priority: number; // 1–10, обычно 10
  raisedBy: UUID;
  status: AlarmStatus;
  escalatedTo: AlarmEscalation | null;
  createdAt: ISODateTime;
  acknowledgedAt: ISODateTime | null;
  acknowledgedBy: UUID | null;
  escalatedAt: ISODateTime | null;
  resolvedAt: ISODateTime | null;
}

export interface Veto {
  id: UUID;
  type: VetoType;
  decisionRef: UUID;
  reason: string;
  validFrom: ISODateTime;
  validTo: ISODateTime;
  status: VetoStatus;
  liftedAt: ISODateTime | null;
  liftReason: string | null;
}

export interface DictionaryTerm {
  id: UUID;
  term: string;
  definition: string;
  version: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TranslationCheck {
  id: UUID;
  original: string;
  translated: string;
  language: string;
  ok: boolean;
  drift: Array<{ term: string; delta: string }>;
  recommendation: string | null;
  createdAt: ISODateTime;
}

// -------- Drift --------

export interface CreateDriftInput {
  id: UUID;
  term: string;
  originalMeaning: string;
  detectedMeaning: string;
  severity: number;
  detectedBy: UUID;
}

export function createDrift(input: CreateDriftInput): SemanticDrift {
  if (!input.term.trim()) {
    throw new ValidationError('Термин обязателен');
  }
  if (!input.originalMeaning.trim() || !input.detectedMeaning.trim()) {
    throw new ValidationError('Оба значения (исходное и обнаруженное) обязательны');
  }
  if (input.severity < 1 || input.severity > 10) {
    throw new ValidationError('severity 1–10');
  }
  return {
    id: input.id,
    term: input.term.trim(),
    originalMeaning: input.originalMeaning.trim(),
    detectedMeaning: input.detectedMeaning.trim(),
    severity: input.severity,
    detectedBy: input.detectedBy,
    status: 'new',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

// -------- Alarm --------

export function raiseAlarm(input: {
  id: UUID;
  driftId: UUID | null;
  raisedBy: UUID;
  priority?: number;
}): SemanticAlarm {
  const priority = input.priority ?? 10; // высший (I.4.6.1б)
  if (priority < 1 || priority > 10) {
    throw new ValidationError('priority 1–10');
  }
  return {
    id: input.id,
    driftId: input.driftId,
    priority,
    raisedBy: input.raisedBy,
    status: 'raised',
    escalatedTo: null,
    createdAt: new Date().toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    escalatedAt: null,
    resolvedAt: null,
  };
}

export function acknowledgeAlarm(a: SemanticAlarm, by: UUID): SemanticAlarm {
  if (a.status !== 'raised') {
    throw new ConflictError(`Тревога уже в статусе ${a.status}`);
  }
  return {
    ...a,
    status: 'acknowledged',
    acknowledgedAt: new Date().toISOString(),
    acknowledgedBy: by,
  };
}

export function escalateAlarm(a: SemanticAlarm, to: AlarmEscalation): SemanticAlarm {
  if (a.status === 'resolved') {
    throw new ConflictError('Тревога уже разрешена');
  }
  if (a.status === 'escalated' && a.escalatedTo === to) {
    throw new ConflictError(`Уже эскалирована на ${to}`);
  }
  return {
    ...a,
    status: 'escalated',
    escalatedTo: to,
    escalatedAt: new Date().toISOString(),
  };
}

export function shouldEscalateToForum(a: SemanticAlarm, now: Date = new Date()): boolean {
  if (a.status !== 'raised') {return false;}
  const elapsedHours =
    (now.getTime() - new Date(a.createdAt).getTime()) / (60 * 60 * 1000);
  return elapsedHours >= SEMANTIC_ALARM_RESPONSE_HOURS;
}

// -------- Veto --------

export function imposeVeto(input: {
  id: UUID;
  type: VetoType;
  decisionRef: UUID;
  reason: string;
}): Veto {
  if (!input.reason.trim()) {
    throw new ValidationError('Причина вето обязательна');
  }
  const now = new Date();
  const validTo = new Date(now.getTime() + SEMANTIC_VETO_DAYS * 86_400_000);
  return {
    id: input.id,
    type: input.type,
    decisionRef: input.decisionRef,
    reason: input.reason.trim(),
    validFrom: now.toISOString(),
    validTo: validTo.toISOString(),
    status: 'active',
    liftedAt: null,
    liftReason: null,
  };
}

export function liftVeto(v: Veto, reason: string): Veto {
  if (v.status !== 'active') {
    throw new ConflictError(`Вето уже ${v.status}`);
  }
  if (!reason.trim()) {
    throw new ValidationError('Причина снятия обязательна');
  }
  return {
    ...v,
    status: 'lifted',
    liftedAt: new Date().toISOString(),
    liftReason: reason.trim(),
  };
}

export function isVetoExpired(v: Veto, now: Date = new Date()): boolean {
  if (v.status !== 'active') {return false;}
  return now.getTime() >= new Date(v.validTo).getTime();
}

// -------- Dictionary --------

export function createDictionaryTerm(input: {
  id: UUID;
  term: string;
  definition: string;
}): DictionaryTerm {
  if (!input.term.trim()) {throw new ValidationError('Термин обязателен');}
  if (!input.definition.trim()) {throw new ValidationError('Определение обязательно');}
  const now = new Date().toISOString();
  return {
    id: input.id,
    term: input.term.trim(),
    definition: input.definition.trim(),
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDictionaryTerm(t: DictionaryTerm, definition: string): DictionaryTerm {
  if (!definition.trim()) {throw new ValidationError('Определение обязательно');}
  return {
    ...t,
    definition: definition.trim(),
    version: t.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

// -------- Translation --------

export function checkTranslation(input: {
  id: UUID;
  original: string;
  translated: string;
  language: string;
}): TranslationCheck {
  if (!input.original.trim() || !input.translated.trim()) {
    throw new ValidationError('Оригинал и перевод обязательны');
  }
  // Упрощённая эвристика: расхождение по длине > 40% → drift.
  // В полноценной реализации — обратный перевод + семантический анализ (N.0.01.06).
  const lengthRatio =
    input.original.length === 0
      ? 1
      : Math.min(input.original.length, input.translated.length) /
        Math.max(input.original.length, input.translated.length);
  const ok = lengthRatio >= 0.6;
  const drift: Array<{ term: string; delta: string }> = [];
  if (!ok) {
    drift.push({
      term: '(документ)',
      delta: `соотношение длин ${(lengthRatio * 100).toFixed(0)}% — возможна потеря смысла`,
    });
  }
  return {
    id: input.id,
    original: input.original,
    translated: input.translated,
    language: input.language,
    ok,
    drift,
    recommendation: ok ? null : 'Требуется ручная проверка перевода Стражем',
    createdAt: new Date().toISOString(),
  };
}

// -------- Guardian removal --------

export function canRemoveGuardian(input: {
  procedureApproved: boolean;
  votesFor: number;
  votesTotal: number;
}): boolean {
  // Процедура 1.10.3: 2/3 Советов + 6 дней обсуждения.
  if (!input.procedureApproved) {return false;}
  if (input.votesTotal === 0) {return false;}
  return input.votesFor / input.votesTotal >= 2 / 3;
}