// C.0.20.01 — Доменная сущность Архив
// Документы immutable. Цепочки решений. Реестр ID. Сверка.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ArchiveDocType = 'protocol' | 'decision' | 'act' | 'report' | 'journal';
export type ChainStepType =
  | 'problem' | 'request' | 'response' | 'decision'
  | 'realization' | 'result' | 'correction';

export interface ArchiveDocument {
  id: UUID;
  type: ArchiveDocType;
  directionId: UUID;
  subject: string;
  content: Record<string, unknown>;
  version: number;
  signedBy: UUID | null;
  signature: string | null;
  archivedAt: ISODateTime;
  createdAt: ISODateTime;
}

export interface DecisionChain {
  id: UUID;
  chainId: UUID;
  step: number;
  type: ChainStepType;
  refId: UUID;
  description: string;
  createdAt: ISODateTime;
}

export interface IdRegistryEntry {
  id: UUID;
  participantId: UUID;
  externalId: string;
  communityCode: string | null;
  internalId: string | null;
  globalId: string | null;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface CrossCheck {
  id: UUID;
  documentAId: UUID;
  documentBId: UUID;
  discrepancies: Record<string, unknown>;
  createdAt: ISODateTime;
}

export function createDocument(input: {
  id: UUID;
  type: ArchiveDocType;
  directionId: UUID;
  subject: string;
  content: Record<string, unknown>;
}): ArchiveDocument {
  if (!input.subject.trim()) {throw new ValidationError('Subject обязателен');}
  const now = new Date().toISOString();
  return {
    id: input.id,
    type: input.type,
    directionId: input.directionId,
    subject: input.subject.trim(),
    content: input.content,
    version: 1,
    signedBy: null,
    signature: null,
    archivedAt: now,
    createdAt: now,
  };
}

export function signDocument(
  d: ArchiveDocument, keeperId: UUID, signature: string,
): ArchiveDocument {
  if (!signature.trim()) {throw new ValidationError('Подпись обязательна');}
  return { ...d, signedBy: keeperId, signature: signature.trim() };
}

export function canDelete(_d: ArchiveDocument): boolean {
  return false; // I.3.5.6 — Хранители не удаляют
}

// -------- Цепочки --------

export function addChainStep(input: {
  id: UUID;
  chainId: UUID;
  step: number;
  type: ChainStepType;
  refId: UUID;
  description: string;
}): DecisionChain {
  if (input.step < 1) {throw new ValidationError('step >= 1');}
  return {
    id: input.id,
    chainId: input.chainId,
    step: input.step,
    type: input.type,
    refId: input.refId,
    description: input.description,
    createdAt: new Date().toISOString(),
  };
}

export function rebuildChain(steps: DecisionChain[]): { valid: boolean; gaps: number[] } {
  const sorted = [...steps].sort((a, b) => a.step - b.step);
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (!cur) {continue;}
    const expected = i + 1;
    if (cur.step !== expected) {
      for (let g = expected; g < cur.step; g++) {gaps.push(g);}
    }
  }
  return { valid: gaps.length === 0, gaps };
}

// -------- Реестр ID --------

export function registerId(input: {
  id: UUID;
  participantId: UUID;
  externalId: string;
}): IdRegistryEntry {
  if (!input.externalId.trim()) {throw new ValidationError('externalId обязателен');}
  return {
    id: input.id,
    participantId: input.participantId,
    externalId: input.externalId.trim(),
    communityCode: null,
    internalId: null,
    globalId: null,
    validFrom: new Date().toISOString(),
    validTo: null,
  };
}

export function linkGlobalId(
  e: IdRegistryEntry, communityCode: string, globalId: string,
): IdRegistryEntry {
  if (!/^[А-Я]{2}$/.test(communityCode)) {
    throw new ValidationError('communityCode: 2 кириллические буквы');
  }
  return { ...e, communityCode, globalId };
}

// -------- Сверка --------

export function crossCheck(
  id: UUID, docAId: UUID, docBId: UUID, discrepancies: Record<string, unknown>,
): CrossCheck {
  return {
    id,
    documentAId: docAId,
    documentBId: docBId,
    discrepancies,
    createdAt: new Date().toISOString(),
  };
}