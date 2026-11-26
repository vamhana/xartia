import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConflictError } from '../errors.js';

import {
  assertCalibrationAllowed,
  combinePilot,
  isCalibrationStale,
  isPilotSnapshot,
  snapshotOf,
  type CalibrationAtomInfo,
} from './calibration-snapshot.js';
import type { Dimension, DimensionApplicability } from './types.js';

const atom = (over: Partial<CalibrationAtomInfo> = {}): CalibrationAtomInfo => ({
  atom_id: 'CYB.ATOM.TEST',
  status: 'candidate',
  version: '0.1.0',
  criteria_status: 'draft',
  dimension_applicability: {},
  ...over,
});

function conflictReason(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictError);
    return (e as ConflictError).details?.['reason'] as string | undefined;
  }
  return undefined;
}

describe('assertCalibrationAllowed: atom status (D1)', () => {
  it.each(['candidate', 'draft', 'in_review', 'approved'])('allows %s', (status) => {
    expect(() => assertCalibrationAllowed(atom({ status }), 'P')).not.toThrow();
  });

  it('refuses deprecated with a machine-readable reason', () => {
    expect(conflictReason(() => assertCalibrationAllowed(atom({ status: 'deprecated' }), 'P')))
      .toBe('atom_deprecated');
  });
});

describe('assertCalibrationAllowed: dimension applicability (D3)', () => {
  const app = (entry: unknown): DimensionApplicability => ({ P: entry }) as DimensionApplicability;
  const reasonFor = (entry: unknown, dim: Dimension = 'P'): string | undefined =>
    conflictReason(() => assertCalibrationAllowed(atom({ dimension_applicability: app(entry) }), dim));

  it('refuses a dimension explicitly decided as not_applicable', () => {
    expect(reasonFor({ state: 'not_applicable', reason: 'вне области' })).toBe('dimension_not_applicable');
  });

  it('allows applicable and undetermined (calibration can inform the decision)', () => {
    expect(reasonFor({ state: 'applicable' })).toBeUndefined();
    expect(reasonFor({ state: 'undetermined' })).toBeUndefined();
  });

  it('allows a missing entry and a not_applicable without reason (both read as undetermined)', () => {
    expect(conflictReason(() => assertCalibrationAllowed(atom({ dimension_applicability: {} }), 'P'))).toBeUndefined();
    expect(conflictReason(() => assertCalibrationAllowed(atom({ dimension_applicability: null }), 'P'))).toBeUndefined();
    expect(reasonFor({ state: 'not_applicable' })).toBeUndefined();
  });

  it('judges only the requested dimension', () => {
    const a = atom({ dimension_applicability: { E: { state: 'not_applicable', reason: 'r' } } });
    expect(() => assertCalibrationAllowed(a, 'P')).not.toThrow();
    expect(conflictReason(() => assertCalibrationAllowed(a, 'E'))).toBe('dimension_not_applicable');
  });

  it('reports deprecated before the dimension check', () => {
    const a = atom({ status: 'deprecated', dimension_applicability: { P: { state: 'not_applicable', reason: 'r' } } });
    expect(conflictReason(() => assertCalibrationAllowed(a, 'P'))).toBe('atom_deprecated');
  });
});

describe('isPilotSnapshot (D2, D6)', () => {
  const snap = (atomStatus: string | null, criteriaStatus: string | null) =>
    isPilotSnapshot({ atomVersion: '0.1.0', atomStatus, criteriaStatus });

  it('is false only when BOTH atom and criteria were approved at creation', () => {
    expect(snap('approved', 'approved')).toBe(false);
  });

  it('is true when either was not approved', () => {
    for (const [a, c] of [
      ['approved', 'draft'], ['approved', 'in_review'], ['candidate', 'approved'],
      ['candidate', 'draft'], ['draft', 'draft'], ['in_review', 'in_review'], ['deprecated', 'approved'],
    ] as const) {
      expect(snap(a, c), `${a}/${c}`).toBe(true);
    }
  });

  it('is null (unknown, never production) when the snapshot is missing', () => {
    expect(snap(null, null)).toBeNull();
    expect(snap('approved', null)).toBeNull();
    expect(snap(null, 'approved')).toBeNull();
  });

  it('snapshotOf captures the atom as it is now; the flag depends on the snapshot only', () => {
    const s = snapshotOf(atom({ status: 'approved', criteria_status: 'draft', version: '0.3.0' }));
    expect(s).toEqual({ atomVersion: '0.3.0', atomStatus: 'approved', criteriaStatus: 'draft' });
    // Атом позже утвердили, но снимок прежний → pilot не меняется.
    expect(isPilotSnapshot(s)).toBe(true);
  });
});

describe('combinePilot', () => {
  it('is true if any pilot, null if none is pilot but some are unknown, else false', () => {
    expect(combinePilot([])).toBe(false);
    expect(combinePilot([false, false])).toBe(false);
    expect(combinePilot([false, true])).toBe(true);
    expect(combinePilot([false, null])).toBeNull();
    expect(combinePilot([true, null])).toBe(true);
    expect(combinePilot([null])).toBeNull();
  });
});

describe('isCalibrationStale (D5)', () => {
  it('compares the snapshot version with the current one', () => {
    expect(isCalibrationStale('0.1.0', '0.1.0')).toBe(false);
    expect(isCalibrationStale('0.1.0', '0.2.0')).toBe(true);
  });

  it('is null when either side is unknown', () => {
    expect(isCalibrationStale(null, '0.1.0')).toBeNull();
    expect(isCalibrationStale('0.1.0', null)).toBeNull();
  });
});

describe('calibration.ts must never write competency_atoms (§8.5 п.2)', () => {
  const source = readFileSync(fileURLToPath(new URL('./calibration.ts', import.meta.url)), 'utf8');

  it('has no INSERT/UPDATE/DELETE against competency_atoms', () => {
    for (const re of [
      /UPDATE\s+competency_atoms/i,
      /INSERT\s+INTO\s+competency_atoms/i,
      /DELETE\s+FROM\s+competency_atoms/i,
    ]) {
      expect(re.test(source), String(re)).toBe(false);
    }
  });

  it('checks the target atom before creating both anchors and sessions', () => {
    expect(source.match(/assertCalibrationTarget\(input\.atomId, input\.dimension\)/g)?.length).toBe(2);
  });
});
