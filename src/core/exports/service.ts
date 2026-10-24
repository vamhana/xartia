// C.0.39.02 — Сервис Exports.src/core/exports/service.ts
// Массовая выгрузка (III.5). Асинхронная генерация через worker.
// Presigned URL — на 7 дней (PRESIGNED_TTL_SEC).
//
// Логика:
//   - createExport проверяет 3 активных job на участника → ConflictError.
//   - enqueue() из L.0.01.13.
//   - getJob при completed → presigned URL через L.0.01.07.
//   - listJobs / getHistory / cancelJob — только свои (createdBy = requesterId).

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
import { ConflictError, NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  formatJobKey,
  JOB_TYPE_FOR_EXPORT,
  MAX_ACTIVE_JOBS,
  PRESIGNED_TTL_SEC,
  isExportFormat,
  isExportType,
  type ExportFormat,
  type ExportJob,
  type ExportType,
} from './entity.js';

// ─── Маппинг Job → ExportJob ────────────────────────────────────

function jobToExportJob(job: Job, url: string | null): ExportJob {
  const p = job.payload;
  const type: ExportType = (() => {
    const t = p['exportType'];
    return typeof t === 'string' && isExportType(t) ? t : 'participants';
  })();
  const format: ExportFormat = (() => {
    const f = p['format'];
    return typeof f === 'string' && isExportFormat(f) ? f : 'json';
  })();

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
    format,
    status: job.status,
    progress: job.progress,
    url,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    error,
  };
}

// ─── createExport ───────────────────────────────────────────────

export interface CreateExportInput {
  filter?: Record<string, unknown>;
  format: ExportFormat;
}

export async function createExport(
  type: ExportType,
  input: CreateExportInput,
  requesterId: UUID,
): Promise<ExportJob> {
  if (!isExportType(type)) {
    throw new ConflictError(`Неподдерживаемый тип экспорта: ${type}`);
  }
  if (!isExportFormat(input.format)) {
    throw new ConflictError(`Неподдерживаемый формат: ${input.format}`);
  }

  const active = await getActiveJobCount(requesterId);
  if (active >= MAX_ACTIVE_JOBS) {
    throw new ConflictError(
      `Достигнут лимит активных экспортов (${MAX_ACTIVE_JOBS}). ` +
        `Дождитесь завершения одного из текущих.`,
      { limit: MAX_ACTIVE_JOBS, active },
    );
  }

  const jobType = JOB_TYPE_FOR_EXPORT[type];
  const jobId = await enqueue(
    jobType,
    {
      exportType: type,
      format: input.format,
      filter: input.filter ?? {},
      requesterId,
    },
    requesterId,
  );

  const job = await libGetJob(jobId);
  if (!job) {
    throw new ConflictError('Не удалось создать job');
  }

  return jobToExportJob(job, null);
}

// ─── getJob ─────────────────────────────────────────────────────

export async function getJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<ExportJob> {
  const job = await libGetJob(jobId);
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }
  if (job.createdBy !== requesterId) {
    throw new NotFoundError('Job', jobId);
  }

  let url: string | null = null;
  if (job.status === 'completed' && job.resultKey) {
    try {
      url = await getDownloadUrl(job.resultKey, 'archive', PRESIGNED_TTL_SEC);
    } catch (e) {
      logger.warn(
        { err: e, jobId, resultKey: job.resultKey },
        'exports.getJob: presigned URL failed',
      );
      url = null;
    }
  }

  return jobToExportJob(job, url);
}

// ─── listJobs ───────────────────────────────────────────────────

export interface ListJobsFilter {
  status?: ExportJob['status'];
  type?: ExportType;
  page?: number;
  perPage?: number;
}

export async function listJobs(
  filter: ListJobsFilter,
  requesterId: UUID,
): Promise<{ data: ExportJob[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));

  const libFilter: Parameters<typeof libListJobs>[0] = {
    createdBy: requesterId,
  };
  if (filter.status) {libFilter.status = filter.status;}
  if (filter.type) {libFilter.type = JOB_TYPE_FOR_EXPORT[filter.type];}

  const result = await libListJobs(libFilter, page, perPage);

  // URL для completed — best-effort presigned, но не блокируем список.
  // Клиент может дёрнуть GET /exports/jobs/:id для presigned URL.
  const data = result.data.map((j) => jobToExportJob(j, null));

  return { data, total: result.total };
}

// ─── cancelJob ──────────────────────────────────────────────────

export async function cancelJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<void> {
  const job = await libGetJob(jobId);
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }
  if (job.createdBy !== requesterId) {
    throw new NotFoundError('Job', jobId);
  }
  if (job.status !== 'queued') {
    throw new ConflictError(
      `Нельзя отменить job в статусе '${job.status}' (только queued)`,
    );
  }
  await libCancel(jobId, requesterId);
}

// ─── getHistory ─────────────────────────────────────────────────

export async function getHistory(
  requesterId: UUID,
  page = 1,
  perPage = 20,
): Promise<{ data: ExportJob[]; total: number }> {
  const p = Math.max(1, page);
  const pp = Math.min(200, Math.max(1, perPage));

  // История — все не-queued (completed/failed/cancelled).
  // Дёргаем libListJobs по 3 статусам, объединяем, сортируем, пагинируем.
  const [completed, failed, cancelled] = await Promise.all([
    libListJobs({ createdBy: requesterId, status: 'completed' }, 1, 200),
    libListJobs({ createdBy: requesterId, status: 'failed' }, 1, 200),
    libListJobs({ createdBy: requesterId, status: 'cancelled' }, 1, 200),
  ]);

  const all = [
    ...completed.data,
    ...failed.data,
    ...cancelled.data,
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const total = all.length;
  const offset = (p - 1) * pp;
  const sliced = all.slice(offset, offset + pp);

  return {
    data: sliced.map((j) => jobToExportJob(j, null)),
    total,
  };
}

// ─── Re-export ──────────────────────────────────────────────────

export { formatJobKey };