// C.0.27.01 — Доменная сущность Планетарный уровень
// Общины, Совет Протоколов, мосты Потоков, план, референдумы, пульс.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type CommunityStatus = 'incubation' | 'active' | 'node' | 'center';
export type CouncilMemberType = 'delegate' | 'expert' | 'guardian';
export type BridgeStatus = 'active' | 'suspended';
export type ReferendumType = 'convergence' | 'gateway_dissolve' | 'core';
export type ReferendumStatus = 'initiated' | 'voting' | 'decided';

export interface Community {
  id: UUID;
  code: string;
  name: string;
  status: CommunityStatus;
  level: number;
  motherCommunityId: UUID | null;
  protocolVersion: string;
  createdAt: ISODateTime;
}

export interface PlanetaryCouncilMember {
  id: UUID;
  memberId: UUID;
  communityId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
  type: CouncilMemberType;
}

export interface Bridge {
  id: UUID;
  communityA: UUID;
  communityB: UUID;
  coefficient: number;
  status: BridgeStatus;
  establishedAt: ISODateTime;
  suspendedAt: ISODateTime | null;
}

export interface PlanetaryPlan {
  id: UUID;
  period: string;
  plan: Record<string, unknown>;
  approvedBy: UUID | null;
  createdAt: ISODateTime;
}

export interface Referendum {
  id: UUID;
  type: ReferendumType;
  threshold: number;
  result: Record<string, unknown> | null;
  status: ReferendumStatus;
  createdAt: ISODateTime;
  decidedAt: ISODateTime | null;
}

export interface Pulse {
  id: UUID;
  communityId: UUID;
  baseGoodsLevel: number | null;
  directionLoad: Record<string, number>;
  topSignals: Array<Record<string, unknown>>;
  createdAt: ISODateTime;
}

export interface Reserve {
  totalVolume: number;
  distributed: number;
  available: number;
}

// -------- Communities --------

export function createCommunity(input: {
  id: UUID;
  code: string;
  name: string;
  motherCommunityId?: UUID;
}): Community {
  if (!/^[А-Я]{2}$/.test(input.code)) {
    throw new ValidationError('Код общины: 2 кириллические буквы (I.3.1.4.1)');
  }
  if (!input.name.trim()) {throw new ValidationError('Имя обязательно');}
  return {
    id: input.id,
    code: input.code,
    name: input.name.trim(),
    status: 'incubation',
    level: 0,
    motherCommunityId: input.motherCommunityId ?? null,
    protocolVersion: '5.0',
    createdAt: new Date().toISOString(),
  };
}

export function getCoordinationLevel(count: number): 'direct' | 'regional' | 'continental' | 'planetary' {
  if (count <= 10) {return 'direct';}
  if (count <= 50) {return 'regional';}
  if (count <= 500) {return 'continental';}
  return 'planetary';
}

// -------- Bridges --------

export function establishBridge(input: {
  id: UUID;
  communityA: UUID;
  communityB: UUID;
  coefficient: number;
}): Bridge {
  if (input.communityA === input.communityB) {
    throw new ValidationError('Мост между одной и той же общиной запрещён');
  }
  if (input.coefficient <= 0) {throw new ValidationError('coefficient > 0');}
  return {
    id: input.id,
    communityA: input.communityA,
    communityB: input.communityB,
    coefficient: input.coefficient,
    status: 'active',
    establishedAt: new Date().toISOString(),
    suspendedAt: null,
  };
}

// -------- Referendum --------

export function createReferendum(input: {
  id: UUID;
  type: ReferendumType;
  threshold: number;
}): Referendum {
  if (input.threshold < 0 || input.threshold > 100) {
    throw new ValidationError('threshold 0–100');
  }
  return {
    id: input.id,
    type: input.type,
    threshold: input.threshold,
    result: null,
    status: 'initiated',
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
}

// -------- Expansion --------

export function canExpand(input: {
  bridgeLatencySec: number;
  standardsDeviationPct: number;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.bridgeLatencySec > 5) {reasons.push('задержка моста > 5 сек');}
  if (input.standardsDeviationPct > 10) {reasons.push('отклонение стандартов > 10%');}
  return { allowed: reasons.length === 0, reasons };
}