// C.0.34.01 — Доменная сущность Коннективность
// Маршрутизация запросов, префильтрация, просрочки, эскалации.

import { PRIORITY_DEADLINES_MS } from '../constants.js';
import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime, Priority } from '../types.js';

export type ConnStatus = 'queued' | 'routed' | 'overdue' | 'escalated';

export interface ConnectivityItem {
  id: UUID;
  signalId: UUID;
  currentDirectionId: UUID | null;
  targetDirectionId: UUID | null;
  priority: Priority;
  deadline: ISODateTime;
  status: ConnStatus;
  iterations: number;
  createdAt: ISODateTime;
  routedAt: ISODateTime | null;
  escalatedAt: ISODateTime | null;
}

export interface PrefilterViolation {
  field: string;
  code: string;
  message: string;
}

export interface PrefilterResult {
  signalId: UUID;
  formatOk: boolean;
  etiquetteOk: boolean;
  violations: PrefilterViolation[];
}

// -------- Префильтрация --------

export function checkFormat(signal: {
  description: string;
  justification: string;
  priority: Priority;
}): PrefilterViolation[] {
  const violations: PrefilterViolation[] = [];

  if (!signal.description?.trim()) {
    violations.push({ field: 'description', code: 'EMPTY', message: 'Описание обязательно' });
  } else if (signal.description.length > 5000) {
    violations.push({ field: 'description', code: 'TOO_LONG', message: 'Описание > 5000 символов' });
  }
  if (!signal.justification?.trim()) {
    violations.push({ field: 'justification', code: 'EMPTY', message: 'Обоснование обязательно' });
  } else if (signal.justification.length > 2000) {
    violations.push({ field: 'justification', code: 'TOO_LONG', message: 'Обоснование > 2000 символов' });
  }
  return violations;
}

// «Нейтральные» маркеры — грубые, но лучше чем ничего
const ETIQUETTE_BLACKLIST = [
  'идиот', 'дурак', 'тупой', 'дебил', 'кретин',
];

export function checkEtiquette(text: string): PrefilterViolation[] {
  const violations: PrefilterViolation[] = [];
  const lower = text.toLowerCase();
  for (const word of ETIQUETTE_BLACKLIST) {
    if (lower.includes(word)) {
      violations.push({
        field: 'text',
        code: 'ETIQUETTE',
        message: `Ненейтральная лексика: «${word}»`,
      });
    }
  }
  return violations;
}

export function prefilter(signal: {
  id: UUID;
  description: string;
  justification: string;
  priority: Priority;
}): PrefilterResult {
  const formatViolations = checkFormat(signal);
  const etiquetteViolations = checkEtiquette(`${signal.description} ${signal.justification}`);

  return {
    signalId: signal.id,
    formatOk: formatViolations.length === 0,
    etiquetteOk: etiquetteViolations.length === 0,
    violations: [...formatViolations, ...etiquetteViolations],
  };
}

// -------- Дедлайны --------

export function getDeadline(priority: Priority, baseTime: Date = new Date()): ISODateTime {
  return new Date(baseTime.getTime() + PRIORITY_DEADLINES_MS[priority]).toISOString();
}

export function isOverdue(item: ConnectivityItem, now: Date = new Date()): boolean {
  if (item.status === 'escalated') {return false;}
  return new Date(item.deadline).getTime() < now.getTime();
}

export function shouldEscalate(item: ConnectivityItem): boolean {
  return item.iterations >= 3;
}

// -------- Утилиты --------

export function getQueueDepth(items: ConnectivityItem[]): number {
  return items.filter((i) => i.status === 'queued').length;
}

export function getNotificationTime(item: ConnectivityItem): ISODateTime {
  const created = new Date(item.createdAt).getTime();
  const deadline = new Date(item.deadline).getTime();
  const span = deadline - created;
  return new Date(deadline - span * 0.25).toISOString();
}

export function validateRouting(input: {
  targetDirectionId: UUID;
  allowedDirections: UUID[];
}): void {
  if (!input.allowedDirections.includes(input.targetDirectionId)) {
    throw new ValidationError(
      `Направление ${input.targetDirectionId} не в списке разрешённых`,
    );
  }
}