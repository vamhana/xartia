// C.0.17.01 — Доменная сущность Режим
// Временное состояние системы при угрозе или перестройке.
// Никакая роль не может быть «навсегда».

import {
  STEEL_BELL_MAX_DAYS, PTT_MAX_DAYS, PTT_MIN_INTERVAL_DAYS,
  RED_CIRCUIT_AUDIT_DAYS, QUANTUM_ACCELERATION,
  INFO_BLOCKADE_TIMEOUT_MIN,
} from '../constants.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, RegimeType, Priority } from '../types.js';
export type { RegimeType };
export type RegimeStatus = 'active' | 'finished' | 'cancelled';
export type MobilizationStatus = 'active' | 'completed' | 'cancelled';

export interface Regime {
  id: UUID;
  type: RegimeType;
  directionId: UUID | null;
  activatedBy: UUID;
  activatedAt: ISODateTime;
  deactivatedAt: ISODateTime | null;
  status: RegimeStatus;
  conditions: Record<string, unknown>;
  auditSchedule: string | null;
  maxDuration: string | null;
  reason: string | null;
}

export interface CrisisMobilization {
  id: UUID;
  regimeId: UUID;
  requiredCount: number;
  confirmedCount: number;
  refusedCount: number;
  thresholdPercent: number;
  status: MobilizationStatus;
  createdAt: ISODateTime;
  completedAt: ISODateTime | null;
}

export interface CrisisRefusal {
  id: UUID;
  mobilizationId: UUID;
  participantId: UUID;
  reason: string | null;
  createdAt: ISODateTime;
}

// -------- Создание --------

export interface ActivationContext {
  hasThreatAboveTenPercent?: boolean;
  noGatewayData?: boolean;
  lastPttAt?: ISODateTime | null;
  isRedCircuitRequested?: boolean;
  isQuantumAccelerationRequested?: boolean;
  isGlobalThreat?: boolean;
}

export function canActivate(
  type: RegimeType,
  context: ActivationContext,
  activatedAt: Date = new Date(),
): { allowed: boolean; reason?: string } {
  switch (type) {
    case 'red_circuit':
      if (!context.isRedCircuitRequested) {
        return { allowed: false, reason: 'Красный Контур активирует Правозащита' };
      }
      return { allowed: true };

    case 'steel_bell':
      if (!context.hasThreatAboveTenPercent) {
        return { allowed: false, reason: 'Стальной Колокол: угроза > 10% участников' };
      }
      return { allowed: true };

    case 'ptt': {
      if (context.lastPttAt) {
        const daysSince = (activatedAt.getTime() - new Date(context.lastPttAt).getTime()) / 86_400_000;
        if (daysSince < PTT_MIN_INTERVAL_DAYS) {
          return { allowed: false, reason: `ПТТ не чаще 1 раза в 5 лет (прошло ${Math.floor(daysSince)} дней)` };
        }
      }
      return { allowed: true };
    }

    case 'info_blockade':
      if (!context.noGatewayData) {
        return { allowed: false, reason: 'Информационная блокада — автоматически при отсутствии данных Шлюза > 1ч' };
      }
      return { allowed: true };

    case 'quantum_acceleration':
      if (!context.isQuantumAccelerationRequested) {
        return { allowed: false, reason: 'Квант ускорения — при активном Стальном Колоколе' };
      }
      return { allowed: true };

    case 'global_red_circuit':
      if (!context.isGlobalThreat) {
        return { allowed: false, reason: 'Глобальный Красный Контур — угроза > 10% общин' };
      }
      return { allowed: true };
  }
}

export function activateRegime(input: {
  id: UUID;
  type: RegimeType;
  activatedBy: UUID;
  directionId?: UUID;
  reason: string;
  conditions?: Record<string, unknown>;
}): Regime {
  if (!input.reason.trim()) {throw new ValidationError('Причина активации обязательна');}

  return {
    id: input.id,
    type: input.type,
    directionId: input.directionId ?? null,
    activatedBy: input.activatedBy,
    activatedAt: new Date().toISOString(),
    deactivatedAt: null,
    status: 'active',
    conditions: input.conditions ?? {},
    auditSchedule: getAuditSchedule(input.type),
    maxDuration: getMaxDuration(input.type),
    reason: input.reason,
  };
}

export function deactivateRegime(r: Regime, reason: string): Regime {
  if (r.status !== 'active') {
    throw new ConflictError(`Режим уже ${r.status}`);
  }
  if (!reason.trim()) {throw new ValidationError('Причина деактивации обязательна');}
  return {
    ...r,
    status: 'finished',
    deactivatedAt: new Date().toISOString(),
  };
}

// -------- Сроки --------

export function getAuditSchedule(type: RegimeType): string | null {
  if (type === 'red_circuit') {return `${RED_CIRCUIT_AUDIT_DAYS} days`;}
  return null;
}

export function getMaxDuration(type: RegimeType): string | null {
  switch (type) {
    case 'steel_bell': return `${STEEL_BELL_MAX_DAYS} days`;
    case 'ptt': return `${PTT_MAX_DAYS} days`;
    case 'info_blockade': return null; // до аудита
    case 'red_circuit': return null; // до снятия угрозы
    case 'quantum_acceleration': return null; // пересчёт каждые 24ч
    case 'global_red_circuit': return null;
  }
}

function parseIntervalMs(s: string): number | null {
  const re = /(\d+)\s+(years?|months?|days?|hours?|minutes?|seconds?)/gi;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    matched = true;
    const nRaw = m[1];
    const uRaw = m[2];
    if (!nRaw || !uRaw) {continue;}
    const n = parseInt(nRaw, 10);
    const u = uRaw.toLowerCase();
    if (u.startsWith('year'))        {total += n * 365 * 86_400_000;}
    else if (u.startsWith('month'))  {total += n * 30 * 86_400_000;}
    else if (u.startsWith('day'))    {total += n * 86_400_000;}
    else if (u.startsWith('hour'))   {total += n * 3_600_000;}
    else if (u.startsWith('minute')) {total += n * 60_000;}
    else if (u.startsWith('second')) {total += n * 1_000;}
  }
  return matched ? total : null;
}

export function isExpired(r: Regime, now: Date = new Date()): boolean {
  if (!r.maxDuration || r.status !== 'active') {return false;}
  const maxMs = parseIntervalMs(r.maxDuration);
  if (maxMs === null) {return false;}
  const activatedAt = new Date(r.activatedAt).getTime();
  return (now.getTime() - activatedAt) > maxMs;
}
// -------- Квант ускорения --------

export function calculateAcceleratedDeadline(baseMs: number): number {
  return Math.floor(baseMs / QUANTUM_ACCELERATION);
}

// -------- Мобилизация --------

export function createMobilization(input: {
  id: UUID;
  regimeId: UUID;
  requiredCount: number;
  thresholdPercent?: number;
}): CrisisMobilization {
  if (input.requiredCount <= 0) {throw new ValidationError('requiredCount > 0');}
  const threshold = input.thresholdPercent ?? 10;
  if (threshold < 0 || threshold > 100) {throw new ValidationError('threshold 0–100');}
  return {
    id: input.id,
    regimeId: input.regimeId,
    requiredCount: input.requiredCount,
    confirmedCount: 0,
    refusedCount: 0,
    thresholdPercent: threshold,
    status: 'active',
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function canRefuseMobilization(_m: CrisisMobilization): boolean {
  // I.1.8.11: отказ от мобилизации без санкций
  return true;
}

export function getMobilizationPercent(m: CrisisMobilization): number {
  if (m.requiredCount === 0) {return 0;}
  return Math.round((m.confirmedCount / m.requiredCount) * 10000) / 100;
}

// -------- Инфоблокада --------

export function shouldAutoActivateInfoBlockade(
  lastGatewayActivityAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastGatewayActivityAt) {return false;}
  const minutes = (now.getTime() - lastGatewayActivityAt.getTime()) / 60_000;
  return minutes > INFO_BLOCKADE_TIMEOUT_MIN;
}

// -------- Квант ускорения — пересчёт дедлайнов --------

export function accelerateDeadlines(
  baseDeadlines: Record<Priority, number>,
): Record<Priority, number> {
  const result: Record<Priority, number> = {
    critical: 0, high: 0, standard: 0, background: 0,
  };
  for (const p of ['critical', 'high', 'standard', 'background'] as Priority[]) {
    result[p] = calculateAcceleratedDeadline(baseDeadlines[p]);
  }
  return result;
}