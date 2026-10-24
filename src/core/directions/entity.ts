// C.0.03.01 — Доменная сущность Направление
// 17 базовых (14 постоянных + 3 временных). Чистые функции.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, DirectionType, DirectionStatus } from '../types.js';

export interface Zones {
  exclusive: string[];
  shared: string[];
  adjacent: string[];
}

export interface Direction {
  id: UUID;
  number: number;
  name: string;
  type: DirectionType;
  status: DirectionStatus;
  zones: Zones;
  councilId: UUID | null;
  createdAt: ISODateTime;
  abolishedAt: ISODateTime | null;
}

export interface CreateDirectionInput {
  id: UUID;
  number: number;
  name: string;
  type: DirectionType;
  zones?: Zones;
}

const EMPTY_ZONES: Zones = { exclusive: [], shared: [], adjacent: [] };

export function createDirection(input: CreateDirectionInput): Direction {
  if (input.number < 1 || input.number > 99) {
    throw new ValidationError('Номер направления должен быть 1–99');
  }
  if (!input.name.trim()) {
    throw new ValidationError('Имя направления обязательно');
  }
  const now = new Date().toISOString();
  return {
    id: input.id,
    number: input.number,
    name: input.name.trim(),
    type: input.type,
    status: 'active',
    zones: input.zones ?? EMPTY_ZONES,
    councilId: null,
    createdAt: now,
    abolishedAt: null,
  };
}

export function isPermanent(d: Direction): boolean {
  return d.type === 'permanent';
}

export function isTemporary(d: Direction): boolean {
  return d.type === 'temporary';
}

export function isGateway(d: Direction): boolean {
  return d.number === 15;
}

export function belongsToZone(d: Direction, competence: string): 'exclusive' | 'shared' | 'adjacent' | null {
  if (d.zones.exclusive.includes(competence)) {return 'exclusive';}
  if (d.zones.shared.includes(competence)) {return 'shared';}
  if (d.zones.adjacent.includes(competence)) {return 'adjacent';}
  return null;
}

export function validateZones(zones: Zones): void {
  const all = [...zones.exclusive, ...zones.shared, ...zones.adjacent];
  const dup = all.filter((x, i) => all.indexOf(x) !== i);
  if (dup.length > 0) {
    throw new ConflictError('Компетенция не может быть в двух зонах одновременно', { duplicates: dup });
  }
}