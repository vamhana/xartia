// C.0.16.01 — Стандарт достаточности
// Единый для всех. Пересмотр раз в 5 лет (I.1.5.9).

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export interface Standard {
  id: UUID;
  category: string;
  norm: number;
  version: number;
  publishedAt: ISODateTime;
  approvedBy: UUID | null;
  deprecatedAt: ISODateTime | null;
}

export function createStandard(input: {
  id: UUID;
  category: string;
  norm: number;
  approvedBy?: UUID;
}): Standard {
  if (!input.category.trim()) {throw new ValidationError('Категория обязательна');}
  if (input.norm <= 0) {throw new ValidationError('norm > 0');}
  return {
    id: input.id,
    category: input.category.trim(),
    norm: input.norm,
    version: 1,
    publishedAt: new Date().toISOString(),
    approvedBy: input.approvedBy ?? null,
    deprecatedAt: null,
  };
}

export function isValid(s: Standard): boolean {
  return s.deprecatedAt === null;
}

export function needsRevision(
  s: Standard, now: Date = new Date(), years = 5,
): boolean {
  const published = new Date(s.publishedAt).getTime();
  return (now.getTime() - published) > years * 365 * 86_400_000;
}