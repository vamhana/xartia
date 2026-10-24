// C.0.25.01 — Доменная сущность Quanta.
// Кванты — минимальные автономные единицы развития (IV.3).
// Жизненный цикл: detected → audit → testing → scaling → active → cancelled.
// Обнаружение при +30% к средней (I.3.3.1).
//
// Чистые функции, без побочных эффектов.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type QuantumStatus =
  | 'detected'
  | 'audit'
  | 'testing'
  | 'scaling'
  | 'active'
  | 'cancelled';

export type QuantumTestResult = 'success' | 'failure';

export interface Quantum {
  id: UUID;
  level: number;
  type: string;
  sourceCellId: UUID;
  description: string;
  areaOfApplicability: Record<string, unknown>;
  limitations: Record<string, unknown>;
  successCriteria: Record<string, unknown>;
  stopCriteria: Record<string, unknown>;
  status: QuantumStatus;
  mandatory: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface QuantumTest {
  id: UUID;
  quantumId: UUID;
  cellId: UUID;
  result: QuantumTestResult;
  notes: string | null;
  createdAt: ISODateTime;
}

export interface QuantumCatalogEntry {
  quantumId: UUID;
  communityId: UUID;
  applied: boolean;
  appliedAt: ISODateTime | null;
}

// ─── Константы ───────────────────────────────────────────────────

export const MIN_TESTS_FOR_SCALE = 3;
export const MIN_TEST_CELLS = 3;
export const MAX_TEST_CELLS = 5;
export const QUANTUM_LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6];
export const DETECT_THRESHOLD_PERCENT = 30;

// ─── Создание ────────────────────────────────────────────────────

export interface DetectQuantumInput {
  id: UUID;
  level: number;
  type: string;
  sourceCellId: UUID;
  description: string;
  areaOfApplicability?: Record<string, unknown>;
  limitations?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
  stopCriteria?: Record<string, unknown>;
  mandatory?: boolean;
}

export function detectQuantum(input: DetectQuantumInput): Quantum {
  if (!QUANTUM_LEVELS.includes(input.level)) {
    throw new ValidationError(
      `level должен быть в диапазоне ${QUANTUM_LEVELS[0]}..${QUANTUM_LEVELS[QUANTUM_LEVELS.length - 1]}`,
      [{ path: 'level', message: 'Level must be 1..6' }],
    );
  }
  if (!input.type.trim()) {
    throw new ValidationError('type обязателен');
  }
  if (!input.description.trim()) {
    throw new ValidationError('description обязателен');
  }

  const now = new Date().toISOString();
  return {
    id: input.id,
    level: input.level,
    type: input.type.trim(),
    sourceCellId: input.sourceCellId,
    description: input.description.trim(),
    areaOfApplicability: input.areaOfApplicability ?? {},
    limitations: input.limitations ?? {},
    successCriteria: input.successCriteria ?? {},
    stopCriteria: input.stopCriteria ?? {},
    status: 'detected',
    mandatory: input.mandatory ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Переходы статуса ────────────────────────────────────────────

/**
 * Проверка допустимого перехода.
 * detected → audit → testing → scaling → active → cancelled
 * Плюс: detected → cancelled (отказ на этапе обнаружения),
 *       testing → cancelled (провал тестов),
 *       scaling → cancelled (откат масштабирования),
 *       active → cancelled (отмена внедрённого).
 */
export function canTransition(from: QuantumStatus, to: QuantumStatus): boolean {
  const allowed: Record<QuantumStatus, QuantumStatus[]> = {
    detected: ['audit', 'cancelled'],
    audit: ['testing', 'cancelled'],
    testing: ['scaling', 'cancelled'],
    scaling: ['active', 'cancelled'],
    active: ['cancelled'],
    cancelled: [],
  };
  return allowed[from].includes(to);
}

export function auditQuantum(q: Quantum): Quantum {
  if (q.status !== 'detected') {
    throw new ConflictError(`Квант в статусе '${q.status}' нельзя аудировать`);
  }
  return {
    ...q,
    status: 'audit',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Переход audit → testing. Вызывается сервисом после успешного
 * createAuditService от Verification.
 */
export function startTesting(q: Quantum): Quantum {
  if (q.status !== 'audit') {
    throw new ConflictError(
      `Квант в статусе '${q.status}' нельзя перевести в testing`,
    );
  }
  return {
    ...q,
    status: 'testing',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Валидация набора ячеек для теста (I.3.5.2: 3–5 ячеек).
 * Мутирует status='testing'. Не делает INSERT тестов — это recordTest.
 */
export function testQuantum(q: Quantum, cellIds: UUID[]): Quantum {
  if (q.status !== 'audit' && q.status !== 'testing') {
    throw new ConflictError(
      `Квант в статусе '${q.status}' нельзя тестировать`,
    );
  }
  if (cellIds.length < MIN_TEST_CELLS || cellIds.length > MAX_TEST_CELLS) {
    throw new ValidationError(
      `Тест требует ${MIN_TEST_CELLS}..${MAX_TEST_CELLS} ячеек (I.3.5.2), получено ${cellIds.length}`,
      [{ path: 'cell_ids', message: `Must be ${MIN_TEST_CELLS}..${MAX_TEST_CELLS}` }],
    );
  }
  const unique = new Set(cellIds);
  if (unique.size !== cellIds.length) {
    throw new ValidationError('cell_ids должны быть уникальны');
  }
  return {
    ...q,
    status: 'testing',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Проверка готовности к масштабированию.
 * Условия: ≥ 3 успешных тестов в РАЗНЫХ ячейках + все критерии заданы.
 */
export function isReadyForScale(
  q: Quantum,
  tests: QuantumTest[],
): { allowed: boolean; reason?: string } {
  const criteriaCheck = validateCriteria(q);
  if (!criteriaCheck.valid) {
    return {
      allowed: false,
      reason: `Не заданы критерии: ${criteriaCheck.errors.join(', ')}`,
    };
  }
  const successCellIds = new Set(
    tests.filter((t) => t.result === 'success').map((t) => t.cellId),
  );
  if (successCellIds.size < MIN_TESTS_FOR_SCALE) {
    return {
      allowed: false,
      reason:
        `Успешных тестов в разных ячейках: ${successCellIds.size} ` +
        `(нужно ≥ ${MIN_TESTS_FOR_SCALE})`,
    };
  }
  return { allowed: true };
}

export function scaleQuantum(q: Quantum): Quantum {
  if (q.status !== 'testing') {
    throw new ConflictError(
      `Квант в статусе '${q.status}' нельзя масштабировать`,
    );
  }
  return {
    ...q,
    status: 'scaling',
    updatedAt: new Date().toISOString(),
  };
}

export function stopQuantum(q: Quantum, reason: string): Quantum {
  if (q.status === 'cancelled') {
    throw new ConflictError('Квант уже отменён');
  }
  if (!reason || !reason.trim()) {
    throw new ValidationError('Причина отмены обязательна');
  }
  return {
    ...q,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
}

// ─── Каталог ─────────────────────────────────────────────────────

export function applyQuantum(
  q: Quantum,
  communityId: UUID,
): QuantumCatalogEntry {
  if (q.status !== 'active' && q.status !== 'scaling') {
    throw new ConflictError(
      `Квант в статусе '${q.status}' нельзя внедрять в общину`,
    );
  }
  return {
    quantumId: q.id,
    communityId,
    applied: true,
    appliedAt: new Date().toISOString(),
  };
}

// ─── Тесты ───────────────────────────────────────────────────────

export function recordTest(
  quantumId: UUID,
  cellId: UUID,
  result: QuantumTestResult,
  notes?: string | null,
): QuantumTest {
  if (result !== 'success' && result !== 'failure') {
    throw new ValidationError(`result должен быть success или failure`);
  }
  return {
    id: crypto.randomUUID(),
    quantumId,
    cellId,
    result,
    notes: notes ?? null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Критерии ────────────────────────────────────────────────────

export interface ValidateCriteriaResult {
  valid: boolean;
  errors: string[];
}

export function validateCriteria(q: Quantum): ValidateCriteriaResult {
  const errors: string[] = [];
  const isEmpty = (o: Record<string, unknown>): boolean =>
    !o || Object.keys(o).length === 0;

  if (isEmpty(q.areaOfApplicability)) {
    errors.push('area_of_applicability');
  }
  if (isEmpty(q.limitations)) {
    errors.push('limitations');
  }
  if (isEmpty(q.successCriteria)) {
    errors.push('success_criteria');
  }
  if (isEmpty(q.stopCriteria)) {
    errors.push('stop_criteria');
  }
  return { valid: errors.length === 0, errors };
}