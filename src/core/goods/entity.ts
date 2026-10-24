// C.0.15.01 — Доменная сущность Благо
// Благо — общецивилизационное. Компоненты видны. Ликвидация только
// с согласия Верификации (I.1.5.6). Тройная подпись на проектные
// ресурсы (I.1.5.10.3).

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, GoodStatus, GoodType } from '../types.js';

export interface GoodComponent {
  authorId: UUID;
  part: string;
  description: string;
}

export interface Good {
  id: UUID;
  name: string;
  type: GoodType;
  status: GoodStatus;
  producerDirectionId: UUID;
  components: GoodComponent[];
  authorIds: UUID[];
  connectorId: UUID | null;
  testerId: UUID | null;
  approverId: UUID | null;
  version: number;
  description: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProjectResource {
  id: UUID;
  planId: UUID;
  resource: Record<string, unknown>;
  councilSign: UUID | null;
  balanceSign: UUID | null;
  verifierSign: UUID | null;
  status: 'pending' | 'signed' | 'issued' | 'returned';
  externalMark: boolean;
  createdAt: ISODateTime;
  issuedAt: ISODateTime | null;
}

// -------- Создание --------

export function createGood(input: {
  id: UUID;
  name: string;
  type: GoodType;
  producerDirectionId: UUID;
  description?: string;
  authorId: UUID;
}): Good {
  if (!input.name.trim()) {throw new ValidationError('Имя блага обязательно');}
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name.trim(),
    type: input.type,
    status: 'draft',
    producerDirectionId: input.producerDirectionId,
    components: [],
    authorIds: [input.authorId],
    connectorId: null,
    testerId: null,
    approverId: null,
    version: 1,
    description: input.description?.trim() ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

// -------- Компоненты --------

export function addComponent(g: Good, c: GoodComponent): Good {
  if (!c.part.trim()) {throw new ValidationError('Компонент: часть обязательна');}
  if (!c.description.trim()) {throw new ValidationError('Компонент: описание обязательно');}
  const hasAuthor = g.authorIds.includes(c.authorId);
  return {
    ...g,
    components: [...g.components, c],
    authorIds: hasAuthor ? g.authorIds : [...g.authorIds, c.authorId],
    updatedAt: new Date().toISOString(),
  };
}

// -------- Переходы --------

const ALLOWED_TRANSITIONS: Record<GoodStatus, readonly GoodStatus[]> = {
  draft: ['test', 'liquidated'],
  test: ['active', 'draft', 'liquidated'],
  active: ['obsolete', 'liquidated'],
  obsolete: ['liquidated'],
  liquidated: [],
};

export function canTransition(from: GoodStatus, to: GoodStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function testGood(g: Good, testerId: UUID): Good {
  if (!canTransition(g.status, 'test')) {
    throw new ConflictError(`Нельзя перевести ${g.status} → test`);
  }
  return { ...g, status: 'test', testerId, updatedAt: new Date().toISOString() };
}

export function approveGood(g: Good, approverId: UUID): Good {
  if (!canTransition(g.status, 'active')) {
    throw new ConflictError(`Нельзя перевести ${g.status} → active`);
  }
  return { ...g, status: 'active', approverId, updatedAt: new Date().toISOString() };
}

export function liquidateGood(g: Good, _reason: string, verifierId: UUID): Good {
  if (!verifierId) {throw new ValidationError('Ликвидация требует verifierId (I.1.5.6)');}
  if (!canTransition(g.status, 'liquidated')) {
    throw new ConflictError(`Нельзя ликвидировать в статусе ${g.status}`);
  }
  return { ...g, status: 'liquidated', updatedAt: new Date().toISOString() };
}

export function incrementVersion(
  g: Good, _changes: Record<string, unknown>, authorId: UUID,
): { good: Good; historyVersion: number } {
  const next = g.version + 1;
  return {
    good: {
      ...g,
      version: next,
      authorIds: g.authorIds.includes(authorId) ? g.authorIds : [...g.authorIds, authorId],
      updatedAt: new Date().toISOString(),
    },
    historyVersion: next,
  };
}

export function isActive(g: Good): boolean {
  return g.status === 'active';
}

// -------- Проектные ресурсы --------

export function signProjectResource(
  pr: ProjectResource,
  role: 'council' | 'balance' | 'verifier',
  signerId: UUID,
): ProjectResource {
  if (pr.status !== 'pending' && pr.status !== 'signed') {
    throw new ConflictError(`Ресурс в статусе ${pr.status}`);
  }
  const updated: ProjectResource = { ...pr };
  if (role === 'council') {updated.councilSign = signerId;}
  else if (role === 'balance') {updated.balanceSign = signerId;}
  else {updated.verifierSign = signerId;}

  if (updated.councilSign && updated.balanceSign && updated.verifierSign) {
    updated.status = 'signed';
  }
  return updated;
}

export function isTripleSigned(pr: ProjectResource): boolean {
  return !!pr.councilSign && !!pr.balanceSign && !!pr.verifierSign;
}