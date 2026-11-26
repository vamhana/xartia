// Кандидат ID: C.1.15.02 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Чистая (без БД) строгая валидация payload каталожных предложений
// (§3.5 / §4.9 фазы 1). Вызывается при создании предложения И перед слиянием
// (mergeProposal), чтобы в competency_atoms не попадал JSONB, который не
// понимают assessment, Matching и движок свежести.
//
// Правила:
//   * неизвестные ключи отвергаются, а не игнорируются молча;
//   * assessment_criteria: только status + тексты U/X/D/P/E (непустые строки).
//     Новый атом не может стартовать с approved-критериями (он candidate);
//     update_atom может: слияние выполняют FIRST_ARCHITECT / COUNCIL_MEMBER;
//   * dimension_applicability: только каноническая форма { state, name?, reason? };
//     устаревший boolean `applicable` в новых предложениях не принимается;
//   * freshness_policy.practice_review_policy — только то, что понимает
//     движок свежести (`to_calibrate` | `P<n>M`), см. freshness-policy.ts;
//   * version нового атома — x.y.z, иначе bumpVersion молча не повышает версию.

import { ValidationError } from '../errors.js';

import { isSupportedPracticeReviewPolicy } from './freshness-policy.js';
import type { AtomCluster } from './types.js';

export const ALLOWED_CLUSTERS: readonly AtomCluster[] = [
  'requirements_and_computational_thinking',
  'software_development',
  'data_and_databases',
  'server_interfaces_and_api',
  'testing_and_quality',
  'software_security',
  'infrastructure_and_operations',
];

const ALLOWED_CONTENT_RATES = ['permanent', 'slow', 'medium', 'fast', 'very_fast'];
const ALLOWED_DIMENSIONS = ['U', 'X', 'D', 'P', 'E'] as const;
const APPLICABILITY_STATES = ['applicable', 'not_applicable', 'undetermined'] as const;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const BUMP_KINDS = ['major', 'minor', 'patch'];

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rejectUnknownKeys(obj: Obj, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ValidationError(`${path}.${key} is not an allowed field`);
    }
  }
}

function requireNonEmptyString(v: unknown, path: string): void {
  if (typeof v !== 'string' || !v.trim()) {
    throw new ValidationError(`${path} must be non-empty string`);
  }
}

function requireStringArray(v: unknown, path: string): void {
  if (!Array.isArray(v)) {
    throw new ValidationError(`${path} must be array`);
  }
  v.forEach((item, i) => requireNonEmptyString(item, `${path}[${i}]`));
}

// ─────────────────────────────────────────────────────────────────────
// Вложенные структуры
// ─────────────────────────────────────────────────────────────────────

export function validateAssessmentCriteria(
  value: unknown,
  mode: 'new_atom' | 'update_atom',
): void {
  if (!isPlainObject(value)) {
    throw new ValidationError('assessment_criteria must be object');
  }
  rejectUnknownKeys(value, ['status', ...ALLOWED_DIMENSIONS], 'assessment_criteria');

  const allowedStatuses = mode === 'new_atom'
    ? ['draft', 'in_review']
    : ['draft', 'in_review', 'approved'];
  if (typeof value.status !== 'string' || !allowedStatuses.includes(value.status)) {
    throw new ValidationError(
      mode === 'new_atom'
        ? 'assessment_criteria.status must be draft|in_review (a new atom starts as candidate)'
        : 'assessment_criteria.status must be draft|in_review|approved',
    );
  }
  for (const dim of ALLOWED_DIMENSIONS) {
    if (dim in value) {
      requireNonEmptyString(value[dim], `assessment_criteria.${dim}`);
    }
  }
}

export function validateDimensionApplicability(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new ValidationError('dimension_applicability must be object');
  }
  for (const [d, rawEntry] of Object.entries(value)) {
    if (!(ALLOWED_DIMENSIONS as readonly string[]).includes(d)) {
      throw new ValidationError(`dimension_applicability.${d} invalid`);
    }
    if (!isPlainObject(rawEntry)) {
      throw new ValidationError(`dimension_applicability.${d} must be an object`);
    }
    if ('applicable' in rawEntry) {
      throw new ValidationError(
        `dimension_applicability.${d}.applicable is the legacy boolean form; use state `
        + '(applicable|not_applicable|undetermined)',
      );
    }
    rejectUnknownKeys(rawEntry, ['state', 'name', 'reason'], `dimension_applicability.${d}`);
    if ('name' in rawEntry && typeof rawEntry.name !== 'string') {
      throw new ValidationError(`dimension_applicability.${d}.name must be string`);
    }
    if ('reason' in rawEntry && typeof rawEntry.reason !== 'string') {
      throw new ValidationError(`dimension_applicability.${d}.reason must be string`);
    }
    if (typeof rawEntry.state !== 'string'
        || !(APPLICABILITY_STATES as readonly string[]).includes(rawEntry.state)) {
      throw new ValidationError(
        `dimension_applicability.${d}.state must be applicable|not_applicable|undetermined`,
      );
    }
    if (rawEntry.state === 'not_applicable') {
      requireNonEmptyString(
        rawEntry.reason,
        `dimension_applicability.${d}.reason (required when state=not_applicable)`,
      );
    }
  }
}

export function validateFreshnessPolicy(value: unknown): void {
  if (!isPlainObject(value)) {
    throw new ValidationError('freshness_policy must be object');
  }
  rejectUnknownKeys(value, ['content_change_rate', 'practice_review_policy'], 'freshness_policy');
  if (typeof value.content_change_rate !== 'string'
      || !ALLOWED_CONTENT_RATES.includes(value.content_change_rate)) {
    throw new ValidationError(
      'freshness_policy.content_change_rate must be permanent|slow|medium|fast|very_fast',
    );
  }
  if (!isSupportedPracticeReviewPolicy(value.practice_review_policy)) {
    throw new ValidationError(
      'freshness_policy.practice_review_policy must be to_calibrate or P<n>M (n >= 1 months)',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Payload по типам предложений
// ─────────────────────────────────────────────────────────────────────

export function validateNewAtomPayload(payload: Obj): void {
  const required = [
    'cluster', 'name', 'definition',
    'boundary_includes', 'boundary_excludes',
    'assessment_criteria', 'assessment_methods',
    'dimension_applicability', 'freshness_policy', 'version',
  ];
  for (const f of required) {
    if (!(f in payload)) {
      throw new ValidationError(`new_atom payload missing required field: ${f}`);
    }
  }
  rejectUnknownKeys(payload, [...required, 'context', 'input', 'outcome'], 'payload');

  requireNonEmptyString(payload.name, 'name');
  requireNonEmptyString(payload.definition, 'definition');
  requireStringArray(payload.boundary_includes, 'boundary_includes');
  requireStringArray(payload.boundary_excludes, 'boundary_excludes');
  requireStringArray(payload.assessment_methods, 'assessment_methods');
  if (typeof payload.cluster !== 'string'
      || !ALLOWED_CLUSTERS.includes(payload.cluster as AtomCluster)) {
    throw new ValidationError(`cluster must be one of ${ALLOWED_CLUSTERS.join('|')}`);
  }
  for (const f of ['context', 'input', 'outcome'] as const) {
    if (f in payload && payload[f] !== null && typeof payload[f] !== 'string') {
      throw new ValidationError(`${f} must be string or null`);
    }
  }
  validateAssessmentCriteria(payload.assessment_criteria, 'new_atom');
  validateDimensionApplicability(payload.dimension_applicability);
  validateFreshnessPolicy(payload.freshness_policy);
  if (typeof payload.version !== 'string' || !SEMVER_RE.test(payload.version)) {
    throw new ValidationError('version must be semver x.y.z');
  }
}

export function validateUpdateAtomPayload(payload: Obj): void {
  const contentFields = [
    'name', 'definition', 'boundary_includes', 'boundary_excludes',
    'context', 'input', 'outcome',
    'assessment_criteria', 'assessment_methods',
    'dimension_applicability', 'freshness_policy',
  ];
  rejectUnknownKeys(payload, [...contentFields, 'bump'], 'payload');
  if (!contentFields.some((f) => f in payload)) {
    throw new ValidationError('update_atom payload must change at least one field');
  }

  if ('name' in payload) {
    requireNonEmptyString(payload.name, 'name');
  }
  if ('definition' in payload) {
    requireNonEmptyString(payload.definition, 'definition');
  }
  for (const f of ['boundary_includes', 'boundary_excludes', 'assessment_methods'] as const) {
    if (f in payload) {
      requireStringArray(payload[f], f);
    }
  }
  for (const f of ['context', 'input', 'outcome'] as const) {
    if (f in payload && typeof payload[f] !== 'string') {
      throw new ValidationError(`${f} must be string (clearing a field is not supported)`);
    }
  }
  if ('assessment_criteria' in payload) {
    validateAssessmentCriteria(payload.assessment_criteria, 'update_atom');
  }
  if ('dimension_applicability' in payload) {
    validateDimensionApplicability(payload.dimension_applicability);
  }
  if ('freshness_policy' in payload) {
    validateFreshnessPolicy(payload.freshness_policy);
  }
  if ('bump' in payload && (typeof payload.bump !== 'string' || !BUMP_KINDS.includes(payload.bump))) {
    throw new ValidationError('bump must be major|minor|patch');
  }
}

export function validateDeprecateAtomPayload(payload: Obj): void {
  if (typeof payload.reason !== 'string' || !payload.reason.trim()) {
    throw new ValidationError('deprecate_atom payload.reason must be non-empty string');
  }
}
