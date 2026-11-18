import { describe, expect, it } from 'vitest';
import type { UUID } from '../types.js';

import {
  isAssessmentCriterionReady,
  isDimensionApplicable,
  isDimensionApplicabilityResolved,
  atomCountsForWidth,
  atomCountsForDepthExecution,
  atomCountsForDepthUnderstanding,
} from './types.js';

describe('passport approval gate primitives', () => {
  it('treats a missing applicability entry as unresolved, not not-applicable', () => {
    const applicability = {};
    expect(isDimensionApplicabilityResolved(applicability, 'P')).toBe(false);
    expect(isDimensionApplicable(applicability, 'P')).toBe(false);
  });

  it('treats an explicit false applicability decision as resolved and not applicable', () => {
    const applicability = { P: { applicable: false, reason: 'outside atom boundary' } };
    expect(isDimensionApplicabilityResolved(applicability, 'P')).toBe(true);
    expect(isDimensionApplicable(applicability, 'P')).toBe(false);
  });

  it('does not treat false applicability without a reason as a resolved decision', () => {
    const applicability = { P: { applicable: false } };
    expect(isDimensionApplicabilityResolved(applicability, 'P')).toBe(false);
    expect(isDimensionApplicable(applicability, 'P')).toBe(false);
  });

  it('recognizes an explicit positive applicability decision', () => {
    const applicability = { P: { applicable: true } };
    expect(isDimensionApplicabilityResolved(applicability, 'P')).toBe(true);
    expect(isDimensionApplicable(applicability, 'P')).toBe(true);
  });

  it('does not count unresolved dimensions as excluded from passport width/depth', () => {
    const states = (['U', 'X', 'D', 'P', 'E'] as const).map((dimension) => ({
      participant_id: '00000000-0000-4000-8000-000000000001' as UUID,
      atom_id: 'TEST.ATOM.0001',
      dimension,
      level: 9,
      status: 'confirmed' as const,
      updated_at: new Date(),
    }));
    const incomplete = {
      U: { applicable: true }, X: { applicable: true },
      D: { applicable: true }, P: { applicable: true },
    };
    expect(atomCountsForWidth([...states], incomplete)).toBe(false);
    expect(atomCountsForDepthExecution([...states], incomplete)).toBe(true);
    expect(atomCountsForDepthUnderstanding([...states], incomplete)).toBe(false);
  });

  it('requires approved criteria with non-empty text for the requested dimension', () => {
    expect(isAssessmentCriterionReady({ status: 'draft', P: 'Can execute' }, 'P')).toBe(false);
    expect(isAssessmentCriterionReady({ status: 'approved', P: '   ' }, 'P')).toBe(false);
    expect(isAssessmentCriterionReady({ status: 'approved' }, 'P')).toBe(false);
    expect(isAssessmentCriterionReady({ status: 'approved', P: 'Can execute' }, 'P')).toBe(true);
  });
});
