import { describe, expect, it } from 'vitest';

import {
  validateAssessmentCriteria,
  validateDeprecateAtomPayload,
  validateDimensionApplicability,
  validateFreshnessPolicy,
  validateNewAtomPayload,
  validateUpdateAtomPayload,
} from './catalog-payload-validation.js';

type Obj = Record<string, unknown>;

// Payload в точности как в существующих smoke (test-catalog-v04, test-passport-v8).
const validNew = (): Obj => ({
  cluster: 'software_development',
  name: 'Атом',
  definition: 'Определение',
  boundary_includes: [],
  boundary_excludes: [],
  assessment_criteria: { status: 'draft' },
  assessment_methods: [],
  dimension_applicability: { U: { applicable: true } },
  freshness_policy: { content_change_rate: 'slow', practice_review_policy: 'P24M' },
  version: '0.1.0',
});

const invalid = (fn: () => void, fragment: string): void => {
  expect(fn).toThrowError(fragment);
};

describe('validateNewAtomPayload', () => {
  it('accepts the payloads used by existing smoke tests', () => {
    expect(() => validateNewAtomPayload(validNew())).not.toThrow();
  });

  it('accepts criteria texts, optional context/input/outcome and applicability name', () => {
    const p = {
      ...validNew(),
      context: 'ctx', input: null, outcome: 'out',
      boundary_includes: ['a'], assessment_methods: ['exam'],
      assessment_criteria: { status: 'in_review', U: 'понимает', P: 'выполняет' },
      dimension_applicability: {
        U: { applicable: true, name: 'Понимание' },
        E: { applicable: false, reason: 'не оценивается' },
      },
      freshness_policy: { content_change_rate: 'medium', practice_review_policy: 'to_calibrate' },
    };
    expect(() => validateNewAtomPayload(p)).not.toThrow();
  });

  it('rejects approved criteria for a brand-new atom', () => {
    invalid(
      () => validateNewAtomPayload({ ...validNew(), assessment_criteria: { status: 'approved' } }),
      'draft|in_review',
    );
  });

  it('rejects unknown top-level fields instead of ignoring them', () => {
    invalid(() => validateNewAtomPayload({ ...validNew(), status: 'approved' }), 'payload.status');
    invalid(() => validateNewAtomPayload({ ...validNew(), atom_id: 'CYB.ATOM.9999' }), 'payload.atom_id');
  });

  it('requires every mandatory field', () => {
    for (const f of Object.keys(validNew())) {
      const p = validNew();
      delete p[f];
      invalid(() => validateNewAtomPayload(p), f);
    }
  });

  it('rejects non-semver versions', () => {
    for (const version of ['0.1', 'abc', '1.0.0-beta', ' 1.0.0', '', 1]) {
      invalid(() => validateNewAtomPayload({ ...validNew(), version }), 'semver');
    }
  });

  it('rejects bad types in text/array fields', () => {
    invalid(() => validateNewAtomPayload({ ...validNew(), name: '  ' }), 'name');
    invalid(() => validateNewAtomPayload({ ...validNew(), definition: 5 }), 'definition');
    invalid(() => validateNewAtomPayload({ ...validNew(), boundary_includes: [1] }), 'boundary_includes[0]');
    invalid(() => validateNewAtomPayload({ ...validNew(), boundary_excludes: 'x' }), 'boundary_excludes');
    invalid(() => validateNewAtomPayload({ ...validNew(), assessment_methods: [''] }), 'assessment_methods[0]');
    invalid(() => validateNewAtomPayload({ ...validNew(), context: 5 }), 'context');
    invalid(() => validateNewAtomPayload({ ...validNew(), cluster: 'nope' }), 'cluster');
  });
});

describe('validateAssessmentCriteria', () => {
  it('requires an object with a valid status', () => {
    for (const v of [null, [], 'x', 1, {}]) {
      invalid(() => validateAssessmentCriteria(v, 'update_atom'), 'assessment_criteria');
    }
    invalid(() => validateAssessmentCriteria({ status: 'ready' }, 'update_atom'), 'status');
  });

  it('allows approved only for update_atom', () => {
    expect(() => validateAssessmentCriteria({ status: 'approved' }, 'update_atom')).not.toThrow();
    invalid(() => validateAssessmentCriteria({ status: 'approved' }, 'new_atom'), 'draft|in_review');
  });

  it('rejects unknown keys and empty / non-string criterion texts', () => {
    invalid(() => validateAssessmentCriteria({ status: 'draft', Z: 'x' }, 'update_atom'), 'assessment_criteria.Z');
    invalid(() => validateAssessmentCriteria({ status: 'draft', U: '' }, 'update_atom'), 'assessment_criteria.U');
    invalid(() => validateAssessmentCriteria({ status: 'draft', P: '   ' }, 'update_atom'), 'assessment_criteria.P');
    invalid(() => validateAssessmentCriteria({ status: 'draft', E: 5 }, 'update_atom'), 'assessment_criteria.E');
    invalid(() => validateAssessmentCriteria({ status: 'draft', X: { a: 1 } }, 'update_atom'), 'assessment_criteria.X');
  });
});

describe('validateDimensionApplicability', () => {
  it('accepts the seed format (with name) and a reasoned not-applicable', () => {
    expect(() => validateDimensionApplicability({})).not.toThrow();
    expect(() => validateDimensionApplicability({
      U: { applicable: true, name: 'Понимание' },
      P: { applicable: false, reason: 'вне области' },
    })).not.toThrow();
  });

  it('rejects wrong shape, unknown dimension/keys and a missing reason', () => {
    invalid(() => validateDimensionApplicability([]), 'object');
    invalid(() => validateDimensionApplicability({ Z: { applicable: true } }), 'Z invalid');
    invalid(() => validateDimensionApplicability({ U: true }), 'must be an object');
    invalid(() => validateDimensionApplicability({ U: { applicable: 'yes' } }), 'applicable must be boolean');
    invalid(() => validateDimensionApplicability({ U: { applicable: true, extra: 1 } }), 'U.extra');
    invalid(() => validateDimensionApplicability({ U: { applicable: false } }), 'reason');
    invalid(() => validateDimensionApplicability({ U: { applicable: false, reason: '  ' } }), 'reason');
    invalid(() => validateDimensionApplicability({ U: { applicable: true, reason: 5 } }), 'reason must be string');
    invalid(() => validateDimensionApplicability({ U: { applicable: true, name: 5 } }), 'name must be string');
  });
});

describe('validateFreshnessPolicy', () => {
  const policy = (p: unknown, rate: unknown = 'slow'): Obj => ({
    content_change_rate: rate,
    practice_review_policy: p,
  });

  it('accepts exactly what the freshness engine understands', () => {
    for (const p of ['to_calibrate', 'P3M', 'P6M', 'P12M', 'P24M', 'P120M']) {
      expect(() => validateFreshnessPolicy(policy(p)), p).not.toThrow();
    }
  });

  it('rejects policies the engine would treat as invalid forever', () => {
    for (const p of ['P1Y', 'P0M', 'P-1M', 'p12m', 'P12', 'banana', '', ' P12M', 'P1.5M',
      'P99999999999999999999M', 'P999999999999M', 12, null, undefined]) {
      invalid(() => validateFreshnessPolicy(policy(p)), 'practice_review_policy');
    }
  });

  it('validates content_change_rate and rejects unknown keys', () => {
    invalid(() => validateFreshnessPolicy(policy('P12M', 'sometimes')), 'content_change_rate');
    invalid(() => validateFreshnessPolicy({ ...policy('P12M'), note: 'x' }), 'freshness_policy.note');
    invalid(() => validateFreshnessPolicy(null), 'object');
  });
});

describe('validateUpdateAtomPayload', () => {
  it('accepts a single changed field, bump, and approved criteria', () => {
    expect(() => validateUpdateAtomPayload({ definition: 'новое' })).not.toThrow();
    expect(() => validateUpdateAtomPayload({ name: 'x', bump: 'major' })).not.toThrow();
    expect(() => validateUpdateAtomPayload({ assessment_criteria: { status: 'approved', U: 'u' } })).not.toThrow();
  });

  it('needs at least one content field; bump alone is not a change', () => {
    invalid(() => validateUpdateAtomPayload({}), 'at least one field');
    invalid(() => validateUpdateAtomPayload({ bump: 'minor' }), 'at least one field');
  });

  it('rejects unknown fields (status, version, atom_id are not updatable)', () => {
    for (const f of ['status', 'version', 'atom_id', 'cluster', 'translations']) {
      invalid(() => validateUpdateAtomPayload({ definition: 'x', [f]: 'y' }), `payload.${f}`);
    }
  });

  it('rejects wrong types instead of stringifying them', () => {
    invalid(() => validateUpdateAtomPayload({ name: {} }), 'name');
    invalid(() => validateUpdateAtomPayload({ name: null }), 'name');
    invalid(() => validateUpdateAtomPayload({ definition: 5 }), 'definition');
    invalid(() => validateUpdateAtomPayload({ boundary_includes: [{}] }), 'boundary_includes[0]');
    invalid(() => validateUpdateAtomPayload({ assessment_methods: 'exam' }), 'assessment_methods');
    invalid(() => validateUpdateAtomPayload({ context: null }), 'context');
    invalid(() => validateUpdateAtomPayload({ outcome: 5 }), 'outcome');
  });

  it('validates nested structures and an explicit bump', () => {
    invalid(() => validateUpdateAtomPayload({ assessment_criteria: { status: 'draft', Z: 'x' } }), 'assessment_criteria.Z');
    invalid(() => validateUpdateAtomPayload({ dimension_applicability: { U: { applicable: false } } }), 'reason');
    invalid(() => validateUpdateAtomPayload({ freshness_policy: { content_change_rate: 'slow', practice_review_policy: 'P1Y' } }), 'practice_review_policy');
    for (const bump of ['huge', '', 1, null]) {
      invalid(() => validateUpdateAtomPayload({ definition: 'x', bump }), 'bump');
    }
  });
});

describe('validateDeprecateAtomPayload', () => {
  it('requires a non-empty reason', () => {
    expect(() => validateDeprecateAtomPayload({ reason: 'устарел' })).not.toThrow();
    invalid(() => validateDeprecateAtomPayload({}), 'reason');
    invalid(() => validateDeprecateAtomPayload({ reason: '  ' }), 'reason');
  });
});
