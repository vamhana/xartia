// C.0.40.02 — Сервис Imports.src/core/imports/service.ts
// Массовый импорт (V.7, I.1.10). Только Архитектор (import:C).
// Dry-run обязателен → confirm → execute.
//
// Переиспользует jobs + worker (I.9.07.01). Своих таблиц нет.
//
// Логика:
//   - createImport: лимит 3 активных → enqueue(dryRun).
//   - confirmImport: проверка status='completed' & dryRun=true →
//     enqueue новый job с dryRun=false & fromJobId.
//   - getJob: presigned URL + preview/report из S3 (best-effort).
//   - getTemplate: CSV-заголовки.

import {
  enqueue,
  getJob as libGetJob,
  listJobs as libListJobs,
  cancel as libCancel,
  getActiveJobCount,
  type Job,
} from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { getDownloadUrl } from '../../lib/s3.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  formatReportKey,
  getTemplateHeaders,
  isImportType,
  JOB_TYPE_FOR_IMPORT,
  MAX_ACTIVE_IMPORTS,
  PRESIGNED_TTL_SEC,
  type ImportJob,
  type ImportPreview,
  type ImportReport,
  type ImportType,
} from './entity.js';

// ─── Маппинг Job → ImportJob ────────────────────────────────────

function jobToImportJob(
  job: Job,
  preview: ImportPreview | null,
  report: ImportReport | null,
  url: string | null,
): ImportJob {
  const p = job.payload;
  const type: ImportType = (() => {
    const t = p['importType'];
    return typeof t === 'string' && isImportType(t) ? t : 'participants';
  })();
  const dryRun = p['dryRun'] === true;

  let error: string | null = null;
  if (job.errors.length > 0) {
    const first = job.errors[0];
    if (first && typeof first === 'object' && 'message' in first) {
      error = String((first as Record<string, unknown>)['message'] ?? '');
    } else {
      error = String(first);
    }
  }

  return {
    jobId: job.id,
    type,
    dryRun,
    status: job.status,
    progress: job.progress,
    preview,
    report,
    url,
    error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

// ─── S3 helpers ─────────────────────────────────────────────────

interface S3Module {
  download?: (
    key: string,
    bucket: string,
  ) => Promise<Buffer>;
}

async function tryDownloadJson<T>(key: string): Promise<T | null> {
  try {
    const mod = (await import('../../lib/s3.js')) as S3Module;
    if (typeof mod.download !== 'function') {
      // download не реализован в L.0.01.07 — fallback: getDownloadUrl + fetch.
      const url = await getDownloadUrl(key, 'archive', 600);
      const res = await fetch(url);
      if (!res.ok) {return null;}
      return (await res.json()) as T;
    }
    const buf = await mod.download(key, 'archive');
    return JSON.parse(buf.toString('utf8')) as T;
  } catch (e) {
    logger.warn({ err: e, key }, 'imports: read preview/report failed');
    return null;
  }
}

// ─── createImport ───────────────────────────────────────────────

export interface CreateImportInput {
  fileUrl: string;
  dryRun: boolean;
}

export async function createImport(
  type: ImportType,
  input: CreateImportInput,
  requesterId: UUID,
): Promise<ImportJob> {
  if (!isImportType(type)) {
    throw new ConflictError(`Неподдерживаемый тип импорта: ${type}`);
  }
  if (!input.fileUrl || !input.fileUrl.trim()) {
    throw new ValidationError('file_url обязателен');
  }

  const active = await getActiveJobCount(requesterId);
  if (active >= MAX_ACTIVE_IMPORTS) {
    throw new ConflictError(
      `Достигнут лимит активных импортов (${MAX_ACTIVE_IMPORTS}). ` +
        `Дождитесь завершения текущего.`,
      { limit: MAX_ACTIVE_IMPORTS, active },
    );
  }

  const jobType = JOB_TYPE_FOR_IMPORT[type];
  const jobId = await enqueue(
    jobType,
    {
      importType: type,
      fileUrl: input.fileUrl,
      dryRun: input.dryRun,
      requesterId,
    },
    requesterId,
  );

  const job = await libGetJob(jobId);
  if (!job) {
    throw new ConflictError('Не удалось создать job');
  }

  return jobToImportJob(job, null, null, null);
}

// ─── confirmImport ──────────────────────────────────────────────

/**
 * Превращает dry-run job в execute job.
 * Проверки:
 *   - исходный job существует, принадлежит requesterId;
 *   - status='completed';
 *   - dryRun=true (нельзя confirm execute).
 * Возвращает новый ImportJob (queued) — execute.
 */
export async function confirmImport(
  jobId: UUID,
  requesterId: UUID,
): Promise<ImportJob> {
  const original = await libGetJob(jobId);
  if (!original) {
    throw new NotFoundError('Import job', jobId);
  }
  if (original.createdBy !== requesterId) {
    throw new NotFoundError('Import job', jobId);
  }

  const p = original.payload;
  const originalDryRun = p['dryRun'] === true;
  const originalType = p['importType'];
  const originalFileUrl = p['fileUrl'];

  if (!originalDryRun) {
    throw new ConflictError('confirm доступен только для dry-run job');
  }
  if (original.status !== 'completed') {
    throw new ConflictError(
      `Dry-run job в статусе '${original.status}' — confirm невозможен`,
    );
  }
  if (typeof originalFileUrl !== 'string' || originalFileUrl.length === 0) {
    throw new ConflictError('В исходном job нет fileUrl');
  }
  if (typeof originalType !== 'string' || !isImportType(originalType)) {
    throw new ConflictError('В исходном job нет валидного importType');
  }

  const active = await getActiveJobCount(requesterId);
  if (active >= MAX_ACTIVE_IMPORTS) {
    throw new ConflictError(
      `Достигнут лимит активных импортов (${MAX_ACTIVE_IMPORTS}).`,
    );
  }

  const jobType = JOB_TYPE_FOR_IMPORT[originalType];
  const newJobId = await enqueue(
    jobType,
    {
      importType: originalType,
      fileUrl: originalFileUrl,
      dryRun: false,
      fromJobId: jobId,
      requesterId,
    },
    requesterId,
  );

  const job = await libGetJob(newJobId);
  if (!job) {
    throw new ConflictError('Не удалось создать execute job');
  }

  return jobToImportJob(job, null, null, null);
}

// ─── getJob ─────────────────────────────────────────────────────

export async function getJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<ImportJob> {
  const job = await libGetJob(jobId);
  if (!job) {
    throw new NotFoundError('Import job', jobId);
  }
  if (job.createdBy !== requesterId) {
    throw new NotFoundError('Import job', jobId);
  }

  const dryRun = job.payload['dryRun'] === true;

  let preview: ImportPreview | null = null;
  let report: ImportReport | null = null;
  let url: string | null = null;

  if (job.status === 'completed' && job.resultKey) {
    // Presigned URL на скачивание preview/report.
    try {
      url = await getDownloadUrl(job.resultKey, 'archive', PRESIGNED_TTL_SEC);
    } catch (e) {
      logger.warn(
        { err: e, jobId, resultKey: job.resultKey },
        'imports.getJob: presigned URL failed',
      );
    }

    // Preview/report читаем из S3 через download.
    if (dryRun) {
      preview = await tryDownloadJson<ImportPreview>(job.resultKey);
    } else {
      report = await tryDownloadJson<ImportReport>(job.resultKey);
    }
  }

  return jobToImportJob(job, preview, report, url);
}

// ─── listJobs ───────────────────────────────────────────────────

export interface ListImportJobsFilter {
  status?: ImportJob['status'];
  type?: ImportType;
  page?: number;
  perPage?: number;
}

export async function listJobs(
  filter: ListImportJobsFilter,
  requesterId: UUID,
): Promise<{ data: ImportJob[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));

  const libFilter: Parameters<typeof libListJobs>[0] = {
    createdBy: requesterId,
  };
  if (filter.status) {libFilter.status = filter.status;}
  if (filter.type) {libFilter.type = JOB_TYPE_FOR_IMPORT[filter.type];}

  const result = await libListJobs(libFilter, page, perPage);
  const data = result.data.map((j) => jobToImportJob(j, null, null, null));

  return { data, total: result.total };
}

// ─── cancelJob ──────────────────────────────────────────────────

export async function cancelJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<void> {
  const job = await libGetJob(jobId);
  if (!job) {
    throw new NotFoundError('Import job', jobId);
  }
  if (job.createdBy !== requesterId) {
    throw new NotFoundError('Import job', jobId);
  }
  if (job.status !== 'queued') {
    throw new ConflictError(
      `Нельзя отменить import job в статусе '${job.status}' (только queued)`,
    );
  }
  await libCancel(jobId, requesterId);
}

// ─── getTemplate ────────────────────────────────────────────────

/**
 * Возвращает CSV-шаблон (только заголовки) для заданного типа импорта.
 */
export function getTemplate(type: ImportType): string {
  if (!isImportType(type)) {
    throw new NotFoundError('Template', type);
  }
  const headers = getTemplateHeaders(type);
  return headers.join(',') + '\n';
}

// ─── re-export ──────────────────────────────────────────────────

export { formatReportKey };