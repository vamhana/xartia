// C.0.40.01 — Доменная сущность Imports.src/core/imports/entity.ts
// Массовый импорт данных (V.7, I.1.10). Только Архитектор.
// Обязательный dry-run → confirm → execute.
//
// Переиспользует jobs + worker (I.9.07.01). Своих таблиц нет.
//
// Чистые функции, без побочных эффектов.

import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type ImportType = 'participants' | 'goods' | 'dictionary';

export type ImportJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ImportError {
  row: number;       // 1-based, без заголовка
  field: string;
  message: string;
}

export interface ImportPreview {
  toCreate: number;
  toSkip: number;
  errors: ImportError[];
  totalRows: number;
}

export interface ImportReport {
  created: number;
  skipped: number;
  errors: ImportError[];
  totalRows: number;
}

export interface ImportJob {
  jobId: UUID;
  type: ImportType;
  dryRun: boolean;
  status: ImportJobStatus;
  progress: number;
  preview: ImportPreview | null;
  report: ImportReport | null;
  url: string | null;
  error: string | null;
  createdAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

// ─── Константы ───────────────────────────────────────────────────

/** Тип job для worker'а (dispatch). */
export const JOB_TYPE_FOR_IMPORT: Readonly<Record<ImportType, string>> = {
  participants: 'import.participants',
  goods: 'import.goods',
  dictionary: 'import.dictionary',
};

/** Лимиты (I.1.10). */
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_ACTIVE_IMPORTS = 3;

/** Presigned URL — 7 дней. */
export const PRESIGNED_TTL_SEC = 7 * 24 * 3600;

// ─── Шаблоны (заголовки CSV) ────────────────────────────────────

export const PARTICIPANTS_HEADERS: readonly string[] = [
  'external_id',
  'name',
  'phone',
  'messengers_json',
  'direction_number',
  'wave_letter',
  'wave_number',
] as const;

export const GOODS_HEADERS: readonly string[] = [
  'name',
  'type',
  'producer_direction_number',
  'description',
] as const;

export const DICTIONARY_HEADERS: readonly string[] = [
  'term',
  'definition',
] as const;

export function getTemplateHeaders(type: ImportType): readonly string[] {
  switch (type) {
    case 'participants': return PARTICIPANTS_HEADERS;
    case 'goods': return GOODS_HEADERS;
    case 'dictionary': return DICTIONARY_HEADERS;
  }
}

// ─── Чистые функции ─────────────────────────────────────────────

/**
 * S3-ключ для preview/report.
 *   - dry-run: imports/<jobId>-preview.json
 *   - execute: imports/<jobId>-report.json
 */
export function formatReportKey(jobId: UUID, dryRun: boolean): string {
  return `imports/${jobId}-${dryRun ? 'preview' : 'report'}.json`;
}

export function isImportType(s: string): s is ImportType {
  return s === 'participants' || s === 'goods' || s === 'dictionary';
}