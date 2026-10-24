// C.0.41.02 — Сервис Bulk.src/core/bulk/service.ts
// Переиспользует L.0.01.13 (jobs) и L.0.01.07 (S3). Новых таблиц нет.
//   - createBulkJob: лимит 3 активных job на участника (как Exports/Imports),
//     enqueue(type, { ...payload, dryRun, requesterId }, requesterId).
//   - getJob: owner || FIRST_ARCHITECT (иначе 404 — anti-enumeration).
//     При completed — report читается из S3 + presigned URL (TTL 7д).
//   - listJobs: не-Архитектор видит только свои.
//   - cancelJob: только queued, иначе ConflictError.

import {
  cancel as libCancel,
  enqueue,
  getActiveJobCount,
  getJob as libGetJob,
  listJobs as libListJobs,
  type Job,
} from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { download, getDownloadUrl } from '../../lib/s3.js';
import { getEffectiveRoles } from '../../security/rbac.js';
import { ConflictError, NotFoundError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID } from '../types.js';

import {
  formatReportKey,
  isBulkType,
  validateBatchSize,
  type BulkJob,
  type BulkJobStatus,
  type BulkReport,
  type BulkType,
} from './entity.js';

// ─── Константы ───────────────────────────────────────────────────

const MAX_ACTIVE_BULK_JOBS = 3;
const PRESIGNED_TTL_SEC = 7 * 24 * 3600;

// ─── Хелперы ─────────────────────────────────────────────────────

function extractBatchSize(type: BulkType, payload: Record<string, unknown>): number {
  switch (type) {
    case 'bulk.notify': {
      const recipients = payload['recipients'] as Record<string, unknown> | undefined;
      const ids = recipients?.['ids'];
      return Array.isArray(ids) ? ids.length : 0;
    }
    case 'bulk.tasks.assign': {
      const arr = payload['task_ids'];
      return Array.isArray(arr) ? arr.length : 0;
    }
    case 'bulk.flows.charge':
    case 'bulk.roles.grant': {
      const arr = payload['participant_ids'];
      return Array.isArray(arr) ? arr.length : 0;
    }
    case 'bulk.export': {
      const arr = payload['types'];
      return Array.isArray(arr) ? arr.length : 0;
    }
  }
}

function extractDryRun(payload: Record<string, unknown>): boolean {
  return payload['dryRun'] === true;
}

function extractFirstError(errors: unknown[]): string | null {
  if (errors.length === 0) {return null;}
  const first = errors[0];
  if (first && typeof first === 'object' && 'message' in first) {
    return String((first as Record<string, unknown>)['message'] ?? '');
  }
  return first === undefined ? null : String(first);
}

function mapJob(
  job: Job,
  report: BulkReport | null,
  reportUrl: string | null,
): BulkJob {
  return {
    jobId: job.id,
    type: job.type as BulkType,
    dryRun: extractDryRun(job.payload),
    status: job.status,
    progress: job.progress,
    report,
    reportUrl,
    error: extractFirstError(job.errors),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

// ─── createBulkJob ──────────────────────────────────────────────

export async function createBulkJob(
  type: BulkType,
  payload: Record<string, unknown>,
  dryRun: boolean,
  requesterId: UUID,
): Promise<BulkJob> {
  // 1. Размер батча
  validateBatchSize(extractBatchSize(type, payload));

  // 2. Лимит активных job'ов на участника (как Exports/Imports)
  const active = await getActiveJobCount(requesterId);
  if (active >= MAX_ACTIVE_BULK_JOBS) {
    throw new ConflictError(
      `Достигнут лимит активных job'ов (${MAX_ACTIVE_BULK_JOBS}). ` +
        `Дождитесь завершения одного из текущих.`,
      { limit: MAX_ACTIVE_BULK_JOBS, active },
    );
  }

  // 3. Enqueue
  const jobId = await enqueue(
    type,
    { ...payload, dryRun, requesterId },
    requesterId,
  );

  const job = await libGetJob(jobId);
  if (!job) {
    throw new ConflictError('Не удалось создать job');
  }

  return mapJob(job, null, null);
}

// ─── getJob ────────────────────────────────────────────────────

export async function getJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<BulkJob> {
  const job = await libGetJob(jobId);
  if (!job || !isBulkType(job.type)) {
    throw new NotFoundError('Job', jobId);
  }

  // owner || FIRST_ARCHITECT (иначе 404 — anti-enumeration)
  if (job.createdBy !== requesterId) {
    const roles = await getEffectiveRoles(requesterId);
    if (!roles.includes(Role.FIRST_ARCHITECT)) {
      throw new NotFoundError('Job', jobId);
    }
  }

  let report: BulkReport | null = null;
  let reportUrl: string | null = null;

  if (job.status === 'completed' && job.resultKey) {
    try {
      const buf = await download(job.resultKey, 'archive');
      report = JSON.parse(buf.toString('utf8')) as BulkReport;
    } catch (e) {
      logger.warn({ err: e, jobId }, 'bulk.getJob: report read failed');
    }
    try {
      reportUrl = await getDownloadUrl(job.resultKey, 'archive', PRESIGNED_TTL_SEC);
    } catch (e) {
      logger.warn({ err: e, jobId }, 'bulk.getJob: presigned URL failed');
    }
  }

  return mapJob(job, report, reportUrl);
}

// ─── listJobs ──────────────────────────────────────────────────

export interface ListBulkJobsFilter {
  status?: BulkJobStatus;
  type?: BulkType;
  page?: number;
  perPage?: number;
}

export async function listJobs(
  filter: ListBulkJobsFilter,
  requesterId: UUID,
): Promise<{ data: BulkJob[]; total: number }> {
  const roles = await getEffectiveRoles(requesterId);
  const isArchitect = roles.includes(Role.FIRST_ARCHITECT);

  const libFilter: Parameters<typeof libListJobs>[0] = {};
  if (!isArchitect) {libFilter.createdBy = requesterId;}
  if (filter.status) {libFilter.status = filter.status;}
  if (filter.type) {libFilter.type = filter.type;}

  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));

  const result = await libListJobs(libFilter, page, perPage);
  const data = result.data
    .filter((j) => isBulkType(j.type))
    .map((j) => mapJob(j, null, null));

  return { data, total: data.length };
}

// ─── cancelJob ─────────────────────────────────────────────────

export async function cancelJob(
  jobId: UUID,
  requesterId: UUID,
): Promise<void> {
  const job = await libGetJob(jobId);
  if (!job || !isBulkType(job.type)) {
    throw new NotFoundError('Job', jobId);
  }

  if (job.createdBy !== requesterId) {
    const roles = await getEffectiveRoles(requesterId);
    if (!roles.includes(Role.FIRST_ARCHITECT)) {
      throw new NotFoundError('Job', jobId);
    }
  }

  if (job.status !== 'queued') {
    throw new ConflictError(
      `Нельзя отменить job в статусе '${job.status}' (только queued)`,
    );
  }

  await libCancel(jobId, requesterId);
}

// ─── re-export ─────────────────────────────────────────────────

export { formatReportKey };