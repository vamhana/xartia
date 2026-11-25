import { describe, expect, it } from 'vitest';

import {
  addCalendarMonthsUTC,
  computeStaleUntil,
  evaluateFreshness,
  isSupportedPracticeReviewPolicy,
  parseReviewPeriodMonths,
} from './freshness-policy.js';
import type { FreshnessPolicy } from './types.js';

const d = (iso: string): Date => new Date(iso);
const policy = (p: string): FreshnessPolicy =>
  ({ content_change_rate: 'medium', practice_review_policy: p }) as FreshnessPolicy;

describe('addCalendarMonthsUTC', () => {
  it('clamps to the last day of a shorter month (leap and non-leap)', () => {
    expect(addCalendarMonthsUTC(d('2024-01-31T10:00:00.000Z'), 1).toISOString())
      .toBe('2024-02-29T10:00:00.000Z');
    expect(addCalendarMonthsUTC(d('2023-01-31T10:00:00.000Z'), 1).toISOString())
      .toBe('2023-02-28T10:00:00.000Z');
    expect(addCalendarMonthsUTC(d('2025-11-30T00:00:00.000Z'), 3).toISOString())
      .toBe('2026-02-28T00:00:00.000Z');
  });

  it('handles Feb 29 across leap and non-leap target years', () => {
    expect(addCalendarMonthsUTC(d('2024-02-29T00:00:00.000Z'), 12).toISOString())
      .toBe('2025-02-28T00:00:00.000Z');
    expect(addCalendarMonthsUTC(d('2024-02-29T00:00:00.000Z'), 48).toISOString())
      .toBe('2028-02-29T00:00:00.000Z');
  });

  it('rolls over year boundaries and keeps UTC time of day', () => {
    expect(addCalendarMonthsUTC(d('2024-11-15T23:59:59.999Z'), 3).toISOString())
      .toBe('2025-02-15T23:59:59.999Z');
    expect(addCalendarMonthsUTC(d('2024-12-31T12:34:56.789Z'), 24).toISOString())
      .toBe('2026-12-31T12:34:56.789Z');
  });
});

describe('evaluateFreshness', () => {
  const assessed = d('2024-03-15T00:00:00.000Z');

  it('treats P12M as 12 calendar months, not 360 days', () => {
    // Старая модель (12 * 30 дней) считала бы stale уже с 2025-03-10.
    const f = evaluateFreshness(policy('P12M'), assessed, d('2025-03-12T00:00:00.000Z'));
    expect(f.state).toBe('fresh');
    if (f.state === 'fresh') {
      expect(f.freshUntil.toISOString()).toBe('2025-03-15T00:00:00.000Z');
    }
  });

  it('uses an inclusive boundary: at the expiry instant it is already stale', () => {
    const justBefore = evaluateFreshness(policy('P12M'), assessed, d('2025-03-14T23:59:59.999Z'));
    expect(justBefore.state).toBe('fresh');
    const atBoundary = evaluateFreshness(policy('P12M'), assessed, d('2025-03-15T00:00:00.000Z'));
    expect(atBoundary.state).toBe('stale');
    if (atBoundary.state === 'stale') {
      expect(atBoundary.staleSince.toISOString()).toBe('2025-03-15T00:00:00.000Z');
    }
  });

  it('is deterministic at month ends (31 Jan + P1M)', () => {
    const base = d('2024-01-31T00:00:00.000Z');
    expect(evaluateFreshness(policy('P1M'), base, d('2024-02-28T23:59:59.999Z')).state).toBe('fresh');
    expect(evaluateFreshness(policy('P1M'), base, d('2024-02-29T00:00:00.000Z')).state).toBe('stale');
  });

  it('does not treat to_calibrate as fresh', () => {
    const f = evaluateFreshness(policy('to_calibrate'), assessed, d('2030-01-01T00:00:00.000Z'));
    expect(f).toEqual({ state: 'unverified', policy: 'to_calibrate', reason: 'to_calibrate' });
  });

  it('does not treat a missing policy as fresh', () => {
    expect(evaluateFreshness(undefined, assessed)).toEqual({
      state: 'unverified', policy: null, reason: 'missing_policy',
    });
    expect(evaluateFreshness(null, assessed)).toEqual({
      state: 'unverified', policy: null, reason: 'missing_policy',
    });
    const noPolicyField = { content_change_rate: 'medium' } as unknown as FreshnessPolicy;
    expect(evaluateFreshness(noPolicyField, assessed).state).toBe('unverified');
  });

  it('flags malformed policies as invalid instead of guessing', () => {
    for (const bad of ['P1Y', 'P0M', 'P-3M', 'p12m', 'P12', '12M', '', 'P1.5M', 'P99999999999999999999M']) {
      const f = evaluateFreshness(policy(bad), assessed, d('2030-01-01T00:00:00.000Z'));
      expect(f.state, `policy "${bad}"`).toBe('unverified');
      if (f.state === 'unverified') {
        expect(f.reason, `policy "${bad}"`).toBe('invalid_policy');
      }
    }
    const notString = { content_change_rate: 'medium', practice_review_policy: 12 } as unknown as FreshnessPolicy;
    expect(evaluateFreshness(notString, assessed)).toEqual({
      state: 'unverified', policy: null, reason: 'invalid_policy',
    });
  });

  it('flags a period that overflows the Date range as invalid', () => {
    const f = evaluateFreshness(policy('P999999999999M'), assessed);
    expect(f.state).toBe('unverified');
  });
});

describe('computeStaleUntil (legacy contract)', () => {
  const assessed = d('2024-03-15T00:00:00.000Z');

  it('returns staleSince only for stale, null otherwise', () => {
    expect(computeStaleUntil(policy('P12M'), assessed, d('2025-03-15T00:00:00.000Z')))
      .toEqual({ staleSince: d('2025-03-15T00:00:00.000Z'), policy: 'P12M' });
    expect(computeStaleUntil(policy('P12M'), assessed, d('2025-03-14T00:00:00.000Z')))
      .toEqual({ staleSince: null, policy: 'P12M' });
    expect(computeStaleUntil(policy('to_calibrate'), assessed, d('2030-01-01T00:00:00.000Z')))
      .toEqual({ staleSince: null, policy: 'to_calibrate' });
    expect(computeStaleUntil(undefined, assessed))
      .toEqual({ staleSince: null, policy: 'to_calibrate' });
  });
});

describe('review policy grammar (single source for engine and validation)', () => {
  it('parses P<n>M to a positive integer month count', () => {
    expect(parseReviewPeriodMonths('P12M')).toBe(12);
    expect(parseReviewPeriodMonths('P120M')).toBe(120);
    for (const bad of ['P0M', 'P1Y', 'to_calibrate', 'p12m', 'P12', '', ' P12M', 'P1.5M', 'P99999999999999999999M']) {
      expect(parseReviewPeriodMonths(bad), bad).toBeNull();
    }
  });

  it('supports exactly to_calibrate and P<n>M within the Date range', () => {
    for (const ok of ['to_calibrate', 'P3M', 'P6M', 'P12M', 'P24M', 'P120M']) {
      expect(isSupportedPracticeReviewPolicy(ok), ok).toBe(true);
    }
    for (const bad of ['P1Y', 'P0M', 'banana', '', 'P999999999999M', 12, null, undefined, {}]) {
      expect(isSupportedPracticeReviewPolicy(bad), String(bad)).toBe(false);
    }
  });

  it('never accepts a policy that evaluateFreshness reports as invalid', () => {
    const assessed = d('2024-03-15T00:00:00.000Z');
    for (const p of ['to_calibrate', 'P3M', 'P12M', 'P24M', 'P1Y', 'P0M', 'banana', 'P999999999999M']) {
      const f = evaluateFreshness(policy(p), assessed, d('2030-01-01T00:00:00.000Z'));
      const invalidForEngine = f.state === 'unverified' && f.reason === 'invalid_policy';
      expect(isSupportedPracticeReviewPolicy(p), p).toBe(!invalidForEngine);
    }
  });
});
