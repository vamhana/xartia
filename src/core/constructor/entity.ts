// C.0.26.01 — Доменная сущность Конструктор.
// Панели, виджеты, права, версии. Экран — сборка из виджетов.
//
// v0.0.02:
//   - B36: incrementVersion использует newUUID() вместо crypto.randomUUID()
//          (единый генератор ID, совместим с тестами и моками).
//   - B37: checkRightInMatrix — roleId === null = универсальное право.
//   - B38: getContextualPanel — учитывает глобальные панели (roleId === null),
//          приоритет: точная роль+контекст > глобальная+контекст > normal.

import { newUUID } from '../../lib/id.js';
import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, RightAction, RightScope } from '../types.js';

export type PanelContext = 'normal' | 'crisis' | 'steel_bell';

export interface Panel {
  id: UUID;
  name: string;
  roleId: UUID | null;
  directionId: UUID | null;
  context: PanelContext;
  version: number;
  active: boolean;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Widget {
  id: UUID;
  type: string;
  entity: string;
  config: Record<string, unknown>;
  defaultRights: Record<string, unknown>;
  createdBy: UUID;
  createdAt: ISODateTime;
}

export interface WidgetInstance {
  id: UUID;
  panelId: UUID;
  widgetId: UUID;
  /** null = корень панели; uuid = внутри контейнера-родителя. */
  parentId: UUID | null;
  position: Record<string, unknown>;
  size: Record<string, unknown>;
  overrides: Record<string, unknown>;
  createdAt: ISODateTime;
}

export interface RightsMatrixEntry {
  id: UUID;
  roleId: UUID | null;
  resource: string;
  action: RightAction;
  scope: RightScope;
  condition: Record<string, unknown> | null;
  version: number;
  createdAt: ISODateTime;
}

export interface PanelVersion {
  id: UUID;
  panelId: UUID;
  version: number;
  snapshot: Record<string, unknown>;
  createdBy: UUID;
  createdAt: ISODateTime;
}

// ─── Фабрики ─────────────────────────────────────────────────────

export function createPanel(input: {
  id: UUID;
  name: string;
  roleId?: UUID;
  directionId?: UUID;
  context?: PanelContext;
  createdBy: UUID;
}): Panel {
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('Название панели обязательно');
  }
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name.trim(),
    roleId: input.roleId ?? null,
    directionId: input.directionId ?? null,
    context: input.context ?? 'normal',
    version: 1,
    active: false,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function addWidgetInstance(input: {
  id: UUID;
  panelId: UUID;
  widgetId: UUID;
  parentId?: UUID | null;
  position: Record<string, unknown>;
  size: Record<string, unknown>;
  overrides?: Record<string, unknown>;
}): WidgetInstance {
  if (!input.position || Object.keys(input.position).length === 0) {
    throw new ValidationError('position обязателен');
  }
  if (!input.size || Object.keys(input.size).length === 0) {
    throw new ValidationError('size обязателен');
  }
  return {
    id: input.id,
    panelId: input.panelId,
    widgetId: input.widgetId,
    parentId: input.parentId ?? null,
    position: input.position,
    size: input.size,
    overrides: input.overrides ?? {},
    createdAt: new Date().toISOString(),
  };
}

export function publishPanel(p: Panel, semanticApproved: boolean): Panel {
  if (!semanticApproved) {
    throw new ConflictError('Семантический Страж не одобрил публикацию (I.4.6.1а)');
  }
  if (p.active) {throw new ConflictError('Панель уже опубликована');}
  return { ...p, active: true, updatedAt: new Date().toISOString() };
}

export function rollbackPanelTo(
  p: Panel,
  version: PanelVersion,
): Panel {
  if (version.panelId !== p.id) {
    throw new ValidationError('Версия принадлежит другой панели');
  }
  return {
    ...p,
    version: version.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function createRightsMatrixEntry(input: {
  id: UUID;
  roleId: UUID | null;
  resource: string;
  action: RightAction;
  scope: RightScope;
  condition?: Record<string, unknown> | null;
}): RightsMatrixEntry {
  if (!input.resource || input.resource.trim().length === 0) {
    throw new ValidationError('Ресурс обязателен');
  }
  return {
    id: input.id,
    roleId: input.roleId,
    resource: input.resource.trim(),
    action: input.action,
    scope: input.scope,
    condition: input.condition ?? null,
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Чистая проверка права в матрице.
 * Отличается от C.0.01.06.checkRight: здесь работаем с уже загруженным
 * списком entries, без обращения к БД.
 *
 * B37: roleId === null в записи = универсальное право (применимо к любой роли).
 */
export function checkRightInMatrix(
  entries: RightsMatrixEntry[],
  roleId: UUID | null,
  resource: string,
  action: RightAction,
  scope: RightScope,
): boolean {
  for (const e of entries) {
    // B37: null-roleId = универсальное право.
    if (e.roleId !== null && e.roleId !== roleId) {continue;}
    if (e.resource !== '*' && e.resource !== resource) {continue;}
    if (e.action !== action) {continue;}
    if (e.scope !== scope && e.scope !== 'all') {continue;}
    return true;
  }
  return false;
}

export function canPublish(
  p: Panel,
  semanticGuardianApproved: boolean,
): { allowed: boolean; reason?: string } {
  if (p.active) {return { allowed: false, reason: 'Панель уже опубликована' };}
  if (!p.name || p.name.trim().length === 0) {
    return { allowed: false, reason: 'Отсутствует название' };
  }
  if (!semanticGuardianApproved) {
    return { allowed: false, reason: 'Не одобрено Стражем' };
  }
  return { allowed: true };
}

/**
 * B38: null-roleId = панель для всех; приоритет:
 *   1. точная роль + нужный контекст;
 *   2. глобальная панель + нужный контекст;
 *   3. любая подходящая панель с context='normal' (точная роль приоритетнее);
 *   4. null.
 */
export function getContextualPanel(
  panels: Panel[],
  roleId: UUID,
  context: PanelContext,
): Panel | null {
  const active = panels.filter(
    (p) => p.active && (p.roleId === roleId || p.roleId === null),
  );
  if (active.length === 0) {return null;}

  const byExactContext = active.find(
    (p) => p.roleId === roleId && p.context === context,
  );
  if (byExactContext) {return byExactContext;}

  const byNullContext = active.find(
    (p) => p.roleId === null && p.context === context,
  );
  if (byNullContext) {return byNullContext;}

  return (
    active.find((p) => p.roleId === roleId && p.context === 'normal') ??
    active.find((p) => p.roleId === null && p.context === 'normal') ??
    null
  );
}

/**
 * B36: единый генератор ID через newUUID() (а не crypto.randomUUID()),
 * чтобы ID генерировались одинаково во всём проекте и мокались в тестах.
 */
export function incrementVersion(
  p: Panel,
  snapshot: Record<string, unknown>,
  author: UUID,
): { panel: Panel; version: PanelVersion } {
  const next = p.version + 1;
  const versionRec: PanelVersion = {
    id: newUUID(),
    panelId: p.id,
    version: next,
    snapshot,
    createdBy: author,
    createdAt: new Date().toISOString(),
  };
  return {
    panel: { ...p, version: next, updatedAt: new Date().toISOString() },
    version: versionRec,
  };
}