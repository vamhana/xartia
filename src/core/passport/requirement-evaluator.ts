// Кандидат ID: C.1.10.02 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Единый (чистый, без БД) evaluator требований Matching (§4.8 фазы 1).
// matchTask() и пакетный getCandidates() ОБЯЗАНЫ вызывать evaluateRequiredAtom
// и не иметь собственных правил: пакетный путь может оптимизировать только
// загрузку данных.
//
// Порядок проверок для одного required_atom:
//   1. атом найден                                  → atom_not_found
//   2. atom.status === 'approved'                   → atom_not_approved
//   3. assessment_criteria.status === 'approved'    → criteria_not_approved
//   4. по каждому требуемому измерению:
//        применимость не определена                 → applicability_undetermined
//        применимость решена как «неприменимо»      → измерение не проверяем
//        нет текста критерия для измерения          → assessment_criteria_invalid
//        нет подтверждённого уровня                 → not_assessed
//        уровень ниже минимума                      → below_minimum
//
// Верхнеуровневый `reason` сохраняет совместимость со старым контрактом
// (missing_dimensions для not_assessed/below_minimum); точные причины по
// каждому измерению лежат в `dimensionReasons`.
//
// «Покрыто» = level не null И status ∈ {confirmed, provisional} И level >= min.
// Уровень 0 — это измеренный ноль, а не отсутствие оценки.
//
// Свежесть (stale_or_unverified) здесь пока не учитывается: добавляется
// отдельным шагом, т.к. требует данных об активных оценках и решения о том,
// блокирует ли stale назначение.

import type {
  AssessmentCriteria,
  Dimension,
  DimensionApplicability,
  MatchGap,
  MatchGapDimensionReason,
  RequiredAtom,
  TaskProfileRole,
} from './types.js';
import {
  DIMENSIONS,
  isAssessmentCriterionReady,
  isDimensionApplicabilityResolved,
  isDimensionApplicable,
} from './types.js';

export const ROLE_CRITICAL: Record<TaskProfileRole, Dimension[]> = {
  executor: ['P'],
  assessor: ['E'],
  designer: ['D'],
  consultant: ['U', 'X'],
};

/** Строка каталога, нужная evaluator-у (статус атома, критерии, применимость). */
export interface EvaluatorAtom {
  atom_id: string;
  status: string;
  assessment_criteria: AssessmentCriteria | null | undefined;
  dimension_applicability: DimensionApplicability | null | undefined;
}

/** Состояние участника по одному измерению атома. */
export interface EvaluatorState {
  dimension: Dimension;
  level: number | null;
  status: string;
}

const COVERING_STATUSES: ReadonlySet<string> = new Set(['confirmed', 'provisional']);

function hasCoveringLevel(state: EvaluatorState | undefined): state is EvaluatorState & { level: number } {
  return state !== undefined
    && state.level !== null
    && COVERING_STATUSES.has(state.status);
}

/**
 * Проверяет один required_atom для одного участника.
 * Возвращает gap или null, если атом полностью покрыт.
 */
export function evaluateRequiredAtom(
  req: RequiredAtom,
  atom: EvaluatorAtom | undefined,
  states: ReadonlyMap<Dimension, EvaluatorState> | undefined,
): MatchGap | null {
  const requiredDims = Object.keys(req.min) as Dimension[];

  if (!atom) {
    // Профиль ссылается на неизвестный атом — после валидации не должно
    // случаться, но защищаемся.
    return {
      atomId: req.atom_id,
      role: req.role,
      missingDimensions: [...DIMENSIONS],
      critical: true,
      reason: 'atom_not_found',
    };
  }
  if (atom.status !== 'approved') {
    return {
      atomId: req.atom_id,
      role: req.role,
      missingDimensions: requiredDims,
      critical: true,
      reason: 'atom_not_approved',
    };
  }
  if (atom.assessment_criteria?.status !== 'approved') {
    return {
      atomId: req.atom_id,
      role: req.role,
      missingDimensions: requiredDims,
      critical: true,
      reason: 'criteria_not_approved',
    };
  }

  const criteria = atom.assessment_criteria;
  const applicability: DimensionApplicability = atom.dimension_applicability ?? {};
  const missing: Dimension[] = [];
  const dimensionReasons: Partial<Record<Dimension, MatchGapDimensionReason>> = {};

  for (const dim of requiredDims) {
    const min = req.min[dim] as number;

    if (!isDimensionApplicabilityResolved(applicability, dim)) {
      missing.push(dim);
      dimensionReasons[dim] = 'applicability_undetermined';
      continue;
    }
    if (!isDimensionApplicable(applicability, dim)) {
      continue; // решено как «неприменимо» — не входит в обязательное покрытие
    }
    if (!isAssessmentCriterionReady(criteria, dim)) {
      missing.push(dim);
      dimensionReasons[dim] = 'assessment_criteria_invalid';
      continue;
    }
    const state = states?.get(dim);
    if (!hasCoveringLevel(state)) {
      missing.push(dim);
      dimensionReasons[dim] = 'not_assessed';
      continue;
    }
    if (state.level < min) {
      missing.push(dim);
      dimensionReasons[dim] = 'below_minimum';
    }
  }

  if (missing.length === 0) {
    return null;
  }

  const reasons = Object.values(dimensionReasons);
  const undetermined = reasons.includes('applicability_undetermined');
  const invalid = reasons.includes('assessment_criteria_invalid');
  const roleCritical = ROLE_CRITICAL[req.role];

  return {
    atomId: req.atom_id,
    role: req.role,
    missingDimensions: missing,
    critical: undetermined || invalid || missing.some((d) => roleCritical.includes(d)),
    reason: undetermined
      ? 'applicability_undetermined'
      : invalid ? 'assessment_criteria_invalid' : 'missing_dimensions',
    dimensionReasons,
  };
}
