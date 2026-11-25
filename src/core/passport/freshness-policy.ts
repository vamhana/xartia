// Кандидат ID: C.1.06.02 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Чистая (без БД) логика политики свежести практики (§4.10 фазы 1).
// Вынесена из freshness.ts, чтобы её можно было тестировать без DATABASE_URL.
//
// Правила:
//   * `P<n>M` — это n КАЛЕНДАРНЫХ месяцев в UTC, а не n * 30 дней.
//     Если в целевом месяце нет нужного числа, берётся его последний день
//     (31 янв + 1M = 28/29 фев; 29 фев 2024 + 12M = 28 фев 2025).
//     Время суток (UTC) сохраняется.
//   * `to_calibrate`, отсутствующая или нераспознанная политика НЕ означают
//     «свежо». Это отдельное состояние `unverified` с машинной причиной.
//   * stale — метка состояния. Числовой уровень 0–9 никогда не меняется.

import type { FreshnessPolicy } from './types.js';

export type FreshnessUnverifiedReason =
  | 'to_calibrate'
  | 'missing_policy'
  | 'invalid_policy';

export type FreshnessState =
  | { state: 'fresh'; policy: string; freshUntil: Date }
  | { state: 'stale'; policy: string; staleSince: Date }
  | { state: 'unverified'; policy: string | null; reason: FreshnessUnverifiedReason };

const PERIOD_RE = /^P(\d+)M$/;

/** Прибавляет календарные месяцы в UTC с обрезкой по концу месяца. */
export function addCalendarMonthsUTC(date: Date, months: number): Date {
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Состояние свежести подтверждения, выставленного в `assessedAt`.
 * Граница включительная: в момент `freshUntil` подтверждение уже stale.
 */
export function evaluateFreshness(
  freshness: FreshnessPolicy | null | undefined,
  assessedAt: Date,
  now: Date = new Date(),
): FreshnessState {
  const raw: unknown = freshness?.practice_review_policy;
  if (raw === undefined || raw === null) {
    return { state: 'unverified', policy: null, reason: 'missing_policy' };
  }
  if (typeof raw !== 'string') {
    return { state: 'unverified', policy: null, reason: 'invalid_policy' };
  }
  if (raw === 'to_calibrate') {
    return { state: 'unverified', policy: raw, reason: 'to_calibrate' };
  }
  const match = PERIOD_RE.exec(raw);
  const months = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(months) || months <= 0) {
    return { state: 'unverified', policy: raw, reason: 'invalid_policy' };
  }
  const until = addCalendarMonthsUTC(assessedAt, months);
  if (Number.isNaN(until.getTime())) {
    return { state: 'unverified', policy: raw, reason: 'invalid_policy' };
  }
  return until.getTime() <= now.getTime()
    ? { state: 'stale', policy: raw, staleSince: until }
    : { state: 'fresh', policy: raw, freshUntil: until };
}

/**
 * Совместимая обёртка со старым контрактом: возвращает staleSince только для
 * состояния `stale`. Для `unverified` вернёт null, но это НЕ значит «свежо».
 * Новому коду нужен evaluateFreshness.
 */
export function computeStaleUntil(
  freshness: FreshnessPolicy | null | undefined,
  assessedAt: Date,
  now: Date = new Date(),
): { staleSince: Date | null; policy: string } {
  const s = evaluateFreshness(freshness, assessedAt, now);
  return {
    staleSince: s.state === 'stale' ? s.staleSince : null,
    policy: s.policy ?? 'to_calibrate',
  };
}
