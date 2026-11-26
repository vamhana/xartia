// Кандидат ID: C.1.13.02 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Чистая (без БД) логика калибровочного снимка и признака pilot (§4.10 фазы 1).
//
// Правила:
//   * anchor и калибровочную сессию можно создавать по атомам candidate / draft /
//     in_review / approved (калибровка и есть способ проверить критерии ДО
//     утверждения); по deprecated нельзя;
//   * по явно неприменимому измерению (not_applicable) нельзя: калибровать
//     нечего; по undetermined можно: калибровка может помочь принять решение;
//   * при создании фиксируется снимок (версия атома, статус атома, статус
//     критериев). pilot вычисляется ИЗ СНИМКА, поэтому не становится
//     production, когда атом позже утвердят;
//   * неизвестный снимок (записи до миграции 074) даёт pilot = null и никогда
//     не считается production;
//   * калибровка НЕ утверждает атом и критерии: связи «результат калибровки →
//     approval» в Фазе 1 нет.

import { ConflictError } from '../errors.js';

import type { Dimension, DimensionApplicability } from './types.js';
import { getDimensionApplicabilityState } from './types.js';

/** Строка каталога, нужная для проверки допустимости и снимка. */
export interface CalibrationAtomInfo {
  atom_id: string;
  status: string;
  version: string;
  criteria_status: string | null;
  dimension_applicability: DimensionApplicability | null | undefined;
}

export interface CalibrationSnapshot {
  atomVersion: string | null;
  atomStatus: string | null;
  criteriaStatus: string | null;
}

/**
 * Можно ли создавать калибровочный материал по этому атому и измерению.
 * Бросает ConflictError с машинной причиной в details.reason.
 */
export function assertCalibrationAllowed(atom: CalibrationAtomInfo, dimension: Dimension): void {
  if (atom.status === 'deprecated') {
    throw new ConflictError(
      `Atom ${atom.atom_id} is deprecated: calibration materials cannot be created`,
      { reason: 'atom_deprecated', atom_id: atom.atom_id },
    );
  }
  if (getDimensionApplicabilityState(atom.dimension_applicability, dimension) === 'not_applicable') {
    throw new ConflictError(
      `Dimension ${dimension} is not applicable to ${atom.atom_id}: nothing to calibrate`,
      { reason: 'dimension_not_applicable', atom_id: atom.atom_id, dimension },
    );
  }
}

/** Снимок атома, как он есть сейчас (для сравнения и тестов). */
export function snapshotOf(atom: CalibrationAtomInfo): CalibrationSnapshot {
  return {
    atomVersion: atom.version,
    atomStatus: atom.status,
    criteriaStatus: atom.criteria_status,
  };
}

/**
 * pilot = материал создан, пока атом или его критерии не были утверждены.
 *   null  — снимок неизвестен (запись до миграции 074);
 *   false — и атом, и критерии были approved на момент создания;
 *   true  — иначе.
 */
export function isPilotSnapshot(s: CalibrationSnapshot): boolean | null {
  if (s.atomStatus === null || s.criteriaStatus === null) {
    return null;
  }
  return !(s.atomStatus === 'approved' && s.criteriaStatus === 'approved');
}

/** Общий признак: true, если хоть один pilot; null, если нет pilot, но есть неизвестные. */
export function combinePilot(flags: ReadonlyArray<boolean | null>): boolean | null {
  if (flags.some((f) => f === true)) {
    return true;
  }
  if (flags.some((f) => f === null)) {
    return null;
  }
  return false;
}

/**
 * Калибровка проведена по устаревшей версии атома: версия в снимке отличается
 * от текущей. null — сравнить нельзя (снимка нет).
 */
export function isCalibrationStale(
  snapshotVersion: string | null,
  currentVersion: string | null,
): boolean | null {
  if (snapshotVersion === null || currentVersion === null) {
    return null;
  }
  return snapshotVersion !== currentVersion;
}
