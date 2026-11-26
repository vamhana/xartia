import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  evaluateRequiredAtom as evaluateAt,
  type EvaluatorAtom,
  type EvaluatorState,
} from './requirement-evaluator.js';
import type { Dimension, DimensionApplicability, FreshnessPolicy, RequiredAtom } from './types.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');
const FRESH_AT = new Date('2026-01-15T00:00:00.000Z'); // P12M → до 2027-01-15
const STALE_AT = new Date('2024-01-15T00:00:00.000Z'); // P12M → истекло 2025-01-15

const P12M = { content_change_rate: 'medium', practice_review_policy: 'P12M' } as FreshnessPolicy;

const evaluateRequiredAtom = (
  req: RequiredAtom,
  a: EvaluatorAtom | undefined,
  st: ReadonlyMap<Dimension, EvaluatorState> | undefined,
) => evaluateAt(req, a, st, NOW);

const ALL_APPLICABLE: DimensionApplicability = {
  U: { state: 'applicable' },
  X: { state: 'applicable' },
  D: { state: 'applicable' },
  P: { state: 'applicable' },
  E: { state: 'applicable' },
};

function atom(over: Partial<EvaluatorAtom> = {}): EvaluatorAtom {
  return {
    atom_id: 'CYB.ATOM.TEST',
    status: 'approved',
    assessment_criteria: { status: 'approved', U: 'u', X: 'x', D: 'd', P: 'p', E: 'e' },
    dimension_applicability: ALL_APPLICABLE,
    freshness_policy: P12M,
    ...over,
  };
}

function states(
  rows: Array<[Dimension, number | null, string] | [Dimension, number | null, string, Date | null]>,
): Map<Dimension, EvaluatorState> {
  return new Map(
    rows.map((r) => [
      r[0],
      { dimension: r[0], level: r[1], status: r[2], assessedAt: r.length === 4 ? r[3] : FRESH_AT },
    ]),
  );
}

const executorP5: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { P: 5 } };

describe('evaluateRequiredAtom: atom-level gates', () => {
  it('reports an unknown atom as a critical atom_not_found', () => {
    const gap = evaluateRequiredAtom(executorP5, undefined, undefined);
    expect(gap).toMatchObject({ reason: 'atom_not_found', critical: true });
    expect(gap?.missingDimensions).toEqual(['U', 'X', 'D', 'P', 'E']);
  });

  it.each(['candidate', 'draft', 'in_review', 'deprecated', 'weird', ''])(
    'blocks atom status "%s"',
    (status) => {
      const gap = evaluateRequiredAtom(executorP5, atom({ status }), states([['P', 9, 'confirmed']]));
      expect(gap).toMatchObject({ reason: 'atom_not_approved', critical: true, missingDimensions: ['P'] });
    },
  );

  it.each(['draft', 'in_review', undefined] as const)(
    'blocks criteria status %s even for an approved atom',
    (status) => {
      const criteria = { status, P: 'p' } as unknown as EvaluatorAtom['assessment_criteria'];
      const gap = evaluateRequiredAtom(
        executorP5,
        atom({ assessment_criteria: criteria }),
        states([['P', 9, 'confirmed']]),
      );
      expect(gap).toMatchObject({ reason: 'criteria_not_approved', critical: true });
    },
  );

  it('blocks missing (null) criteria', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ assessment_criteria: null }),
      states([['P', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({ reason: 'criteria_not_approved' });
  });
});

describe('evaluateRequiredAtom: applicability', () => {
  it('treats a missing entry as undetermined (critical), not as not_applicable', () => {
    const gap = evaluateRequiredAtom(
      { atom_id: 'CYB.ATOM.TEST', role: 'consultant', min: { D: 3 } }, // D не критично для consultant
      atom({ dimension_applicability: {} }),
      states([['D', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({
      reason: 'applicability_undetermined',
      critical: true,
      dimensionReasons: { D: 'applicability_undetermined' },
    });
  });

  it('treats not_applicable without a reason as undetermined', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, P: { state: 'not_applicable' } } }),
      states([['P', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({ reason: 'applicability_undetermined' });
  });

  it('skips a dimension explicitly decided as not applicable (with a reason)', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, P: { state: 'not_applicable', reason: 'outside scope' } } }),
      undefined,
    );
    expect(gap).toBeNull();
  });
});

describe('evaluateRequiredAtom: canonical state format', () => {
  it('blocks an explicitly undetermined dimension (not match, not skipped)', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, P: { state: 'undetermined' } } }),
      states([['P', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({
      reason: 'applicability_undetermined',
      critical: true,
      dimensionReasons: { P: 'applicability_undetermined' },
    });
  });

  it('works with state: applicable and skips state: not_applicable with a reason', () => {
    const decided = { U: { state: 'applicable' }, X: { state: 'applicable' }, D: { state: 'applicable' },
      P: { state: 'applicable' }, E: { state: 'applicable' } } as EvaluatorAtom['dimension_applicability'];
    expect(evaluateRequiredAtom(executorP5, atom({ dimension_applicability: decided }), states([['P', 5, 'confirmed']])))
      .toBeNull();
    const skipped = { ...decided, P: { state: 'not_applicable', reason: 'вне области' } } as EvaluatorAtom['dimension_applicability'];
    expect(evaluateRequiredAtom(executorP5, atom({ dimension_applicability: skipped }), undefined)).toBeNull();
  });

  it('does not accept not_applicable without a reason as a decision', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, P: { state: 'not_applicable' } } }),
      states([['P', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({ reason: 'applicability_undetermined', critical: true });
  });
});

describe('evaluateRequiredAtom: criteria content', () => {
  it('flags an approved profile with empty text for the required dimension', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ assessment_criteria: { status: 'approved', P: '   ' } }),
      states([['P', 9, 'confirmed']]),
    );
    expect(gap).toMatchObject({
      reason: 'assessment_criteria_invalid',
      critical: true,
      dimensionReasons: { P: 'assessment_criteria_invalid' },
    });
  });
});

describe('evaluateRequiredAtom: coverage', () => {
  it('returns null when confirmed level meets the minimum', () => {
    expect(evaluateRequiredAtom(executorP5, atom(), states([['P', 5, 'confirmed']]))).toBeNull();
  });

  it('accepts provisional as covering', () => {
    expect(evaluateRequiredAtom(executorP5, atom(), states([['P', 7, 'provisional']]))).toBeNull();
  });

  it('distinguishes below_minimum from not_assessed', () => {
    const below = evaluateRequiredAtom(executorP5, atom(), states([['P', 3, 'confirmed']]));
    expect(below).toMatchObject({
      reason: 'missing_dimensions',
      critical: true,
      dimensionReasons: { P: 'below_minimum' },
    });
    const none = evaluateRequiredAtom(executorP5, atom(), undefined);
    expect(none).toMatchObject({ dimensionReasons: { P: 'not_assessed' } });
  });

  it('does not count a level whose state is not confirmed/provisional', () => {
    for (const status of ['declared', 'under_review', 'disputed', 'not_assessed']) {
      const gap = evaluateRequiredAtom(executorP5, atom(), states([['P', 9, status]]));
      expect(gap, status).toMatchObject({ dimensionReasons: { P: 'not_assessed' } });
    }
  });

  it('treats level 0 as a measured zero, and null as no assessment', () => {
    const zeroReq: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { P: 0 } };
    expect(evaluateRequiredAtom(zeroReq, atom(), states([['P', 0, 'confirmed']]))).toBeNull();
    expect(evaluateRequiredAtom(zeroReq, atom(), states([['P', null, 'confirmed']])))
      .toMatchObject({ dimensionReasons: { P: 'not_assessed' } });
  });

  it('marks a gap non-critical when only a non-critical dimension is missing', () => {
    const req: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { P: 5, U: 5 } };
    const gap = evaluateRequiredAtom(req, atom(), states([['P', 9, 'confirmed'], ['U', 1, 'confirmed']]));
    expect(gap).toMatchObject({ critical: false, missingDimensions: ['U'], dimensionReasons: { U: 'below_minimum' } });
  });

  it('keeps every failing dimension and the most severe top-level reason', () => {
    const req: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { U: 5, P: 5 } };
    const gap = evaluateRequiredAtom(
      req,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, U: undefined } as EvaluatorAtom['dimension_applicability'] }),
      states([['P', 2, 'confirmed']]),
    );
    expect(gap).toMatchObject({
      reason: 'applicability_undetermined',
      critical: true,
      dimensionReasons: { U: 'applicability_undetermined', P: 'below_minimum' },
    });
    expect([...(gap?.missingDimensions ?? [])].sort()).toEqual(['P', 'U']);
  });
});

describe('evaluateRequiredAtom: freshness (stale_or_unverified)', () => {
  it('is a NON-critical gap even for the role-critical dimension (partial, not no_match)', () => {
    const gap = evaluateRequiredAtom(executorP5, atom(), states([['P', 9, 'confirmed', STALE_AT]]));
    expect(gap).toMatchObject({
      reason: 'stale_or_unverified',
      critical: false,
      missingDimensions: ['P'],
      dimensionReasons: { P: 'stale_or_unverified' },
    });
  });

  it('accepts a fresh confirmation', () => {
    expect(evaluateRequiredAtom(executorP5, atom(), states([['P', 9, 'confirmed', FRESH_AT]]))).toBeNull();
  });

  it('treats to_calibrate and a missing policy as unverified, not fresh', () => {
    const toCalibrate = { content_change_rate: 'medium', practice_review_policy: 'to_calibrate' } as FreshnessPolicy;
    for (const freshness_policy of [toCalibrate, null, undefined]) {
      const gap = evaluateRequiredAtom(
        executorP5,
        atom({ freshness_policy }),
        states([['P', 9, 'confirmed', FRESH_AT]]),
      );
      expect(gap, String(freshness_policy?.practice_review_policy)).toMatchObject({
        reason: 'stale_or_unverified',
        critical: false,
      });
    }
  });

  it('treats a covering level without an active assessment date as unverified', () => {
    const gap = evaluateRequiredAtom(executorP5, atom(), states([['P', 9, 'confirmed', null]]));
    expect(gap).toMatchObject({ reason: 'stale_or_unverified', dimensionReasons: { P: 'stale_or_unverified' } });
  });

  it('checks freshness only after the level covers: below_minimum wins over stale', () => {
    const gap = evaluateRequiredAtom(executorP5, atom(), states([['P', 2, 'confirmed', STALE_AT]]));
    expect(gap).toMatchObject({ reason: 'missing_dimensions', critical: true, dimensionReasons: { P: 'below_minimum' } });
  });

  it('does not let staleness hide a genuinely critical gap in another dimension', () => {
    const req: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { P: 5, U: 5 } };
    const gap = evaluateRequiredAtom(
      req,
      atom(),
      states([['P', 2, 'confirmed', FRESH_AT], ['U', 9, 'confirmed', STALE_AT]]),
    );
    expect(gap).toMatchObject({
      reason: 'missing_dimensions',
      critical: true,
      dimensionReasons: { P: 'below_minimum', U: 'stale_or_unverified' },
    });
  });

  it('keeps applicability_undetermined as the top-level reason when mixed with stale', () => {
    const req: RequiredAtom = { atom_id: 'CYB.ATOM.TEST', role: 'executor', min: { U: 5, P: 5 } };
    const gap = evaluateRequiredAtom(
      req,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, U: undefined } as EvaluatorAtom['dimension_applicability'] }),
      states([['P', 9, 'confirmed', STALE_AT]]),
    );
    expect(gap).toMatchObject({ reason: 'applicability_undetermined', critical: true });
  });

  it('never evaluates freshness for dimensions explicitly not applicable', () => {
    const gap = evaluateRequiredAtom(
      executorP5,
      atom({ dimension_applicability: { ...ALL_APPLICABLE, P: { state: 'not_applicable', reason: 'outside scope' } } }),
      states([['P', 9, 'confirmed', STALE_AT]]),
    );
    expect(gap).toBeNull();
  });
});

describe('matching.ts must not re-implement requirement rules (§4.8)', () => {
  const source = readFileSync(fileURLToPath(new URL('./matching.ts', import.meta.url)), 'utf8');

  it('delegates both matchTask and getCandidates to evaluateRequiredAtom', () => {
    expect(source.match(/evaluateRequiredAtom\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('has no private applicability/criteria/coverage logic', () => {
    for (const forbidden of [
      'isDimensionApplicable',
      'isDimensionApplicabilityResolved',
      'isAssessmentCriterionReady',
      'evaluateFreshness',
      "'atom_not_approved'",
      "'criteria_not_approved'",
    ]) {
      expect(source.includes(forbidden), forbidden).toBe(false);
    }
  });
});
