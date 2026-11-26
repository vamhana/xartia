import { describe, expect, it } from 'vitest';

import type { Dimension, DimensionApplicability, PersonAtomStateRow } from './types.js';
import {
  atomCountsForWidth,
  getDimensionApplicabilityState,
  isDimensionApplicabilityResolved,
  isDimensionApplicable,
} from './types.js';

const asApp = (entry: unknown, d: Dimension = 'U'): DimensionApplicability =>
  ({ [d]: entry }) as DimensionApplicability;

describe('getDimensionApplicabilityState: new canonical format', () => {
  it('reads explicit states', () => {
    expect(getDimensionApplicabilityState(asApp({ state: 'applicable' }), 'U')).toBe('applicable');
    expect(getDimensionApplicabilityState(asApp({ state: 'undetermined' }), 'U')).toBe('undetermined');
    expect(getDimensionApplicabilityState(asApp({ state: 'not_applicable', reason: 'вне области' }), 'U'))
      .toBe('not_applicable');
  });

  it('never turns not_applicable without a reason into a decision', () => {
    for (const reason of [undefined, '', '   ', 5, null]) {
      expect(getDimensionApplicabilityState(asApp({ state: 'not_applicable', reason }), 'U'), String(reason))
        .toBe('undetermined');
    }
  });

  it('treats unknown or garbage state values as undetermined', () => {
    for (const state of ['pending_review', 'APPLICABLE', '', 1, true, null, {}]) {
      expect(getDimensionApplicabilityState(asApp({ state }), 'U'), String(state)).toBe('undetermined');
    }
  });

  it('ignores a leftover legacy boolean when state is present', () => {
    expect(getDimensionApplicabilityState(asApp({ state: 'undetermined', applicable: true }), 'U'))
      .toBe('undetermined');
    expect(getDimensionApplicabilityState(asApp({ state: 'applicable', applicable: false }), 'U'))
      .toBe('applicable');
  });
});

describe('getDimensionApplicabilityState: missing data', () => {
  it('treats absent dimension, absent map and non-object entries as undetermined', () => {
    expect(getDimensionApplicabilityState({}, 'U')).toBe('undetermined');
    expect(getDimensionApplicabilityState(null, 'U')).toBe('undetermined');
    expect(getDimensionApplicabilityState(undefined, 'U')).toBe('undetermined');
    for (const bad of [null, true, 'applicable', 7, []]) {
      expect(getDimensionApplicabilityState(asApp(bad), 'U'), JSON.stringify(bad)).toBe('undetermined');
    }
  });

  it('does not leak between dimensions', () => {
    const a: DimensionApplicability = { P: { state: 'applicable' } };
    expect(getDimensionApplicabilityState(a, 'P')).toBe('applicable');
    expect(getDimensionApplicabilityState(a, 'U')).toBe('undetermined');
  });
});

describe('legacy boolean format is no longer interpreted (4d): fail-safe undetermined', () => {
  const dims: Dimension[] = ['U', 'X', 'D', 'P', 'E'];
  const legacyEntries: unknown[] = [
    { applicable: true }, { applicable: true, name: 'Понимание' },
    { applicable: false }, { applicable: false, reason: 'вне области' },
    { applicable: 'yes' }, { applicable: 1 }, { applicable: null },
  ];

  it('never turns a legacy entry into a decision, in either direction', () => {
    for (const entry of legacyEntries) {
      for (const d of dims) {
        const a = { [d]: entry } as DimensionApplicability;
        expect(getDimensionApplicabilityState(a, d), JSON.stringify(entry)).toBe('undetermined');
        expect(isDimensionApplicabilityResolved(a, d), JSON.stringify(entry)).toBe(false);
        expect(isDimensionApplicable(a, d), JSON.stringify(entry)).toBe(false);
      }
    }
  });
});

describe('helpers and consumers follow the canonical state', () => {
  it('resolved = applicable or not_applicable; applicable only for applicable', () => {
    const a: DimensionApplicability = {
      U: { state: 'applicable' },
      X: { state: 'not_applicable', reason: 'r' },
      D: { state: 'undetermined' },
    };
    expect(isDimensionApplicabilityResolved(a, 'U')).toBe(true);
    expect(isDimensionApplicabilityResolved(a, 'X')).toBe(true);
    expect(isDimensionApplicabilityResolved(a, 'D')).toBe(false);
    expect(isDimensionApplicabilityResolved(a, 'P')).toBe(false);
    expect(isDimensionApplicable(a, 'U')).toBe(true);
    expect(isDimensionApplicable(a, 'X')).toBe(false);
    expect(isDimensionApplicable(a, 'D')).toBe(false);
  });

  it('atomCountsForWidth does not count an atom with an undetermined dimension', () => {
    const states = (['U', 'X', 'D', 'P', 'E'] as Dimension[]).map(
      (dimension) => ({ dimension, level: 9, status: 'confirmed' }) as PersonAtomStateRow,
    );
    const allApplicable: DimensionApplicability = {
      U: { state: 'applicable' }, X: { state: 'applicable' }, D: { state: 'applicable' },
      P: { state: 'applicable' }, E: { state: 'applicable' },
    };
    expect(atomCountsForWidth(states, allApplicable)).toBe(true);
    expect(atomCountsForWidth(states, { ...allApplicable, E: { state: 'undetermined' } })).toBe(false);
    expect(atomCountsForWidth(states, {
      ...allApplicable, E: { state: 'not_applicable', reason: 'вне области' },
    })).toBe(true);
  });
});
