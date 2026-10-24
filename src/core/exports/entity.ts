// C.0.39.01 — Доменная сущность Exports.src/core/exports/entity.ts
// Массовая выгрузка данных (III.5, I.1.10). Асинхронная генерация
// через worker, S3 + presigned URL 7 дней.
//
// Чистые функции, без побочных эффектов.

import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type ExportType =
  | 'participants'
  | 'plans'
  | 'goods'
  | 'archive'
  | 'audit-log';

export type ExportFormat = 'csv' | 'json';

export type ExportJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ExportJob {
  jobId: UUID;
  type: ExportType;
  format: ExportFormat;
  status: ExportJobStatus;
  progress: number;
  url: string | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
  error: string | null;
}

// ─── Константы ───────────────────────────────────────────────────

/** Тип job для worker'а. */
export const JOB_TYPE_FOR_EXPORT: Readonly<Record<ExportType, string>> = {
  participants: 'export.participants',
  plans: 'export.plans',
  goods: 'export.goods',
  archive: 'export.archive',
  'audit-log': 'export.audit-log',
};

/** Presigned URL живёт 7 дней. */
export const PRESIGNED_TTL_SEC = 7 * 24 * 3600;

/** Максимум активных job на участника. */
export const MAX_ACTIVE_JOBS = 3;

/** Максимум строк в одном экспорте. */
export const MAX_ROWS = 100_000;

// ─── Чистые функции ─────────────────────────────────────────────

/**
 * S3-ключ: exports/<type>/<jobId>.<format>
 * Согласовано с handler'ами worker'а.
 */
export function formatJobKey(
  type: ExportType,
  jobId: UUID,
  format: ExportFormat,
): string {
  return `exports/${type}/${jobId}.${format}`;
}

/**
 * Проверка, что заданный `type` — валидный ExportType.
 */
export function isExportType(s: string): s is ExportType {
  return (
    s === 'participants' ||
    s === 'plans' ||
    s === 'goods' ||
    s === 'archive' ||
    s === 'audit-log'
  );
}

export function isExportFormat(s: string): s is ExportFormat {
  return s === 'csv' || s === 'json';
}