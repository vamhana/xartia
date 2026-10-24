// C.0.33.01 — Доменная сущность Aggregator.
// Кластеризация сигналов (I.6.17). Роль AGGREGATOR — специалист
// Когнитивной Логистики. Мандат 2 года, не более 2 сроков.
//
// Не принимает решений — только фильтрует и группирует.
// Чистые функции, без побочных эффектов.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime, Priority } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type ClusterStatus = 'new' | 'validated' | 'rejected' | 'routed';

export interface AggregatorSignal {
  id: UUID;
  theme: string;
  sourceId: UUID;
  priority: Priority;
  receivedAt: ISODateTime;
}

export interface AggregatorCluster {
  id: UUID;
  signalIds: UUID[];
  pattern: string;
  relevance: number;
  status: ClusterStatus;
  targetDirectionId: UUID | null;
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

/** Лимит валидаций в день на одного агрегатора (I.6.17.2в). */
export const MAX_CLUSTERS_PER_DAY = 100;

/** Минимум сигналов для кластера. */
export const MIN_SIGNALS_PER_CLUSTER = 2;

/** Стаж для роли агрегатора (5 лет). */
export const AGGREGATOR_MIN_EXPERIENCE_DAYS = 1825;

// ─── Создание ────────────────────────────────────────────────────

export interface CreateClusterInput {
  id: UUID;
  signalIds: UUID[];
  pattern: string;
  relevance: number;
  targetDirectionId?: UUID;
}

export function createCluster(input: CreateClusterInput): AggregatorCluster {
  if (
    !Array.isArray(input.signalIds) ||
    input.signalIds.length < MIN_SIGNALS_PER_CLUSTER
  ) {
    throw new ValidationError(
      `Кластер требует минимум ${MIN_SIGNALS_PER_CLUSTER} сигналов`,
    );
  }
  if (!input.pattern || !input.pattern.trim()) {
    throw new ValidationError('Pattern обязателен');
  }
  if (
    !Number.isFinite(input.relevance) ||
    input.relevance < 0 ||
    input.relevance > 1
  ) {
    throw new ValidationError('relevance должен быть в диапазоне 0..1');
  }

  return {
    id: input.id,
    signalIds: [...new Set(input.signalIds)],  // dedup
    pattern: input.pattern.trim(),
    relevance: input.relevance,
    status: 'new',
    targetDirectionId: input.targetDirectionId ?? null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Переходы ────────────────────────────────────────────────────

export function validateCluster(
  c: AggregatorCluster,
  valid: boolean,
  _comment?: string,
): AggregatorCluster {
  if (c.status !== 'new') {
    throw new ConflictError(
      `Кластер в статусе '${c.status}' нельзя валидировать`,
    );
  }
  return {
    ...c,
    status: valid ? 'validated' : 'rejected',
  };
}

export function routeCluster(
  c: AggregatorCluster,
  targetDirectionId: UUID,
  _justification: string,
): AggregatorCluster {
  if (c.status !== 'validated') {
    throw new ConflictError(
      `Кластер '${c.status}' нельзя маршрутизировать`,
    );
  }
  if (!targetDirectionId) {
    throw new ValidationError('targetDirectionId обязателен');
  }
  return {
    ...c,
    status: 'routed',
    targetDirectionId,
  };
}

// ─── Проверки ────────────────────────────────────────────────────

export function canValidateToday(validatedToday: number): boolean {
  return validatedToday < MAX_CLUSTERS_PER_DAY;
}

export interface AggregatorCandidacy {
  enteredAt: ISODateTime;
  noologyCertified: boolean;
}

/**
 * I.6.17: агрегатор — стаж ≥ 5 лет в направлении + аттестация Ноологии.
 * Аттестация — module_passes.module = 'noology_certification'.
 */
export function canBeAggregator(
  candidate: AggregatorCandidacy,
  now: Date = new Date(),
): { allowed: boolean; reason?: string } {
  const entered = new Date(candidate.enteredAt).getTime();
  if (!Number.isFinite(entered)) {
    return { allowed: false, reason: 'Некорректная дата входа' };
  }
  const days = (now.getTime() - entered) / 86_400_000;
  if (days < AGGREGATOR_MIN_EXPERIENCE_DAYS) {
    return {
      allowed: false,
      reason:
        `Стаж ${Math.floor(days)} дней < ${AGGREGATOR_MIN_EXPERIENCE_DAYS} ` +
        `(5 лет, I.6.17)`,
    };
  }
  if (!candidate.noologyCertified) {
    return { allowed: false, reason: 'Нет аттестации Ноологии (I.6.17)' };
  }
  return { allowed: true };
}

// ─── Простая sync-группировка (fallback) ─────────────────────────
//
// Используется как синхронная группировка по theme. Основной алгоритм —
// N.0.01.03.clusterSignals (async, TF-IDF). Здесь — «дешёвый» fallback,
// если N.0.01.03 вернул 0 кластеров (например, тексты слишком короткие).
//
// Возвращает черновики кластеров (без id — id присваивает service).

export interface ClusterDraft {
  signalIds: UUID[];
  pattern: string;
  relevance: number;
}

export function clusterSignals(signals: AggregatorSignal[]): ClusterDraft[] {
  const byTheme = new Map<string, UUID[]>();
  for (const s of signals) {
    const key = s.theme.trim().toLowerCase();
    if (!key) {continue;}
    const list = byTheme.get(key);
    if (list) {list.push(s.sourceId);}
    else {byTheme.set(key, [s.sourceId]);}
  }

  const drafts: ClusterDraft[] = [];
  for (const [theme, sourceIds] of byTheme) {
    if (sourceIds.length < MIN_SIGNALS_PER_CLUSTER) {continue;}
    drafts.push({
      signalIds: sourceIds,
      pattern: theme,
      relevance: 0.8,  // эвристическая оценка для theme-группировки
    });
  }
  return drafts;
}