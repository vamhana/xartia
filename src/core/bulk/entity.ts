// src/core/bulk/entity.ts(C.0.41.01)
// C.0.41.01 — Доменная сущность Bulk.
// Массовые операции поверх готовых сервисов. Новых таблиц нет:
// состояние job'а — jobs (D.2.01.29), отчёт — S3 по ключу bulk/<jobId>-report.json.
// Лимит батча — 1000 на любую операцию (ids/arrays).
// Для direction/role в bulk.notify — safety-лимит 10 000 после resolve (handler).

import { ValidationError } from '../errors.js';
import type { Role } from '../roles.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы операций ───────────────────────────────────────────────

export type BulkType =
  | 'bulk.notify'
  | 'bulk.tasks.assign'
  | 'bulk.flows.charge'
  | 'bulk.roles.grant'
  | 'bulk.export';

export const BULK_TYPES: readonly BulkType[] = [
  'bulk.notify',
  'bulk.tasks.assign',
  'bulk.flows.charge',
  'bulk.roles.grant',
  'bulk.export',
];

export function isBulkType(value: string): value is BulkType {
  return (BULK_TYPES as readonly string[]).includes(value);
}

// ─── Получатели (bulk.notify) ────────────────────────────────────
// Ровно один primary mode: { ids } | { directionId } | { role } |
// { directionId, role }. Комбинации валидируются в controller (superRefine).
// Пустой объект запрещён.

export interface BulkRecipients {
  directionId?: UUID;
  role?: Role;
  ids?: UUID[];
}

// ─── Отчёт по батчу ──────────────────────────────────────────────
// Пишется handler'ом в S3. Ошибки отдельных операций — в errors,
// батч НЕ откатывается.

export interface BulkErrorEntry {
  index: number;
  id: string;
  message: string;
}

export interface BulkReport {
  processed: number;
  succeeded: number;
  failed: number;
  errors: BulkErrorEntry[];
  // bulk.export — id созданных export-job'ов
  exportJobIds?: UUID[];
  // bulk.roles.grant dry-run — превью
  preview?: { toGrant: number; conflicts: number; cooldowns: number };
}

// ─── Job (проекция jobs + отчёт) ─────────────────────────────────

export type BulkJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BulkJob {
  jobId: UUID;
  type: BulkType;
  dryRun: boolean;
  status: BulkJobStatus;
  progress: number;            // 0..100
  report: BulkReport | null;   // распарсенный из S3 (completed only)
  reportUrl: string | null;    // presigned, только при completed, TTL 7д
  error: string | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

// ─── Константы и утилиты ─────────────────────────────────────────

export const MAX_BATCH_SIZE = 1000;
export const MAX_RESOLVED_RECIPIENTS = 10_000;

export function validateBatchSize(n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new ValidationError('Размер батча должен быть неотрицательным целым');
  }
  if (n > MAX_BATCH_SIZE) {
    throw new ValidationError(
      `Размер батча ${n} превышает лимит ${MAX_BATCH_SIZE}`,
    );
  }
}

export function formatReportKey(jobId: UUID): string {
  return `bulk/${jobId}-report.json`;
}