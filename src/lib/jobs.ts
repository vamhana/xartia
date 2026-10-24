// L.0.01.13 — Очередь задач (jobs).src/lib/jobs.ts
// Worker на PostgreSQL: FOR UPDATE SKIP LOCKED.
//
// Единая таблица для Exports/Imports/Bulk (в будущем). Не Redis — задачи
// переживают рестарт, статусы видны в админке, не нужен отдельный брокер.
//
// claim() — атомарно забирает одну задачу из очереди. Параллельные воркеры
// безопасны благодаря FOR UPDATE SKIP LOCKED: каждый заберёт свою.
//
// Best-effort S3 delete в cleanupOldJobs: если deleteObject/remove/deleteKey
// не реализован в L.0.01.07 — warn и продолжаем, S3 lifecycle rule оператора
// досчистит.

import type { UUID, ISODateTime } from '../core/types.js';

import { query, queryOne } from './db.js';
import { newUUID } from './id.js';
import { logger } from './logger.js';

// ─── Типы ────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: UUID;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  resultKey: string | null;
  errors: unknown[];
  createdBy: UUID;
  createdAt: ISODateTime;
  startedAt: ISODateTime | null;
  finishedAt: ISODateTime | null;
}

export interface JobFilter {
  status?: JobStatus;
  type?: string;
  createdBy?: UUID;
  page?: number;
  perPage?: number;
}

// ─── Row-mapping ─────────────────────────────────────────────────

interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  progress: number;
  result_key: string | null;
  errors: unknown[] | null;
  created_by: string;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

function rowToJob(r: JobRow): Job {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload ?? {},
    status: r.status,
    progress: r.progress,
    resultKey: r.result_key,
    errors: r.errors ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  };
}

const JOB_COLS = `
  id, type, payload, status, progress, result_key, errors,
  created_by, created_at, started_at, finished_at
`;

// ─── Enqueue ─────────────────────────────────────────────────────

export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  createdBy: UUID,
): Promise<UUID> {
  const id = newUUID();
  await query(
    `INSERT INTO jobs (id, type, payload, status, created_by)
     VALUES ($1, $2, $3::jsonb, 'queued', $4)`,
    [id, type, JSON.stringify(payload), createdBy],
  );
  return id;
}

// ─── Claim (FOR UPDATE SKIP LOCKED) ─────────────────────────────
//
// Один SQL-запрос, без явной транзакции: Postgres выполняет UPDATE с
// подзапросом атомарно. Параллельные воркеры не возьмут одну задачу —
// FOR UPDATE SKIP LOCKED пропускает заблокированные строки.

export async function claim(): Promise<Job | null> {
  const rows = await query<JobRow>(
    `UPDATE jobs
        SET status = 'running', started_at = now()
      WHERE id = (
        SELECT id FROM jobs
         WHERE status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING ${JOB_COLS}`,
  );
  const first = rows[0];
  return first ? rowToJob(first) : null;
}

// ─── Update / complete / fail ───────────────────────────────────

export async function updateProgress(
  jobId: UUID,
  progress: number,
): Promise<void> {
  const p = Math.min(100, Math.max(0, Math.round(progress)));
  await query(
    `UPDATE jobs SET progress = $1
      WHERE id = $2 AND status = 'running'`,
    [p, jobId],
  );
}

export async function complete(
  jobId: UUID,
  resultKey: string,
): Promise<void> {
  await query(
    `UPDATE jobs
        SET status = 'completed',
            progress = 100,
            result_key = $1,
            finished_at = now()
      WHERE id = $2 AND status = 'running'`,
    [resultKey, jobId],
  );
}

export async function fail(
  jobId: UUID,
  error: unknown,
): Promise<void> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errObj = {
    message: errMsg,
    at: new Date().toISOString(),
  };
  await query(
    `UPDATE jobs
        SET status = 'failed',
            errors = errors || $1::jsonb,
            finished_at = now()
      WHERE id = $2 AND status IN ('running', 'queued')`,
    [JSON.stringify([errObj]), jobId],
  );
}

// ─── Cancel ─────────────────────────────────────────────────────
//
// Отменить можно только 'queued'. Running уже взял воркер — отмена
// возможна только через worker-специфичные механизмы (не реализовано).

export async function cancel(
  jobId: UUID,
  _requesterId: UUID,
): Promise<void> {
  const rows = await query<{ id: string }>(
    `UPDATE jobs
        SET status = 'cancelled', finished_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING id`,
    [jobId],
  );
  if (rows.length === 0) {
    // Либо не найден, либо уже не queued — точную причину разберёт сервис.
    return;
  }
}

// ─── Read ───────────────────────────────────────────────────────

export async function getJob(jobId: UUID): Promise<Job | null> {
  const row = await queryOne<JobRow>(
    `SELECT ${JOB_COLS} FROM jobs WHERE id = $1`,
    [jobId],
  );
  return row ? rowToJob(row) : null;
}

export async function listJobs(
  filter: JobFilter = {},
  page = 1,
  perPage = 20,
): Promise<{ data: Job[]; total: number }> {
  const p = Math.max(1, page);
  const pp = Math.min(200, Math.max(1, perPage));
  const offset = (p - 1) * pp;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    cond.push(`status = $${params.length}`);
  }
  if (filter.type) {
    params.push(filter.type);
    cond.push(`type = $${params.length}`);
  }
  if (filter.createdBy) {
    params.push(filter.createdBy);
    cond.push(`created_by = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM jobs ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(pp, offset);
  const rows = await query<JobRow>(
    `SELECT ${JOB_COLS}
       FROM jobs
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToJob), total };
}

// ─── Active count ──────────────────────────────────────────────

export async function getActiveJobCount(createdBy: UUID): Promise<number> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM jobs
      WHERE created_by = $1
        AND status IN ('queued', 'running')`,
    [createdBy],
  );
  return parseInt(row?.cnt ?? '0', 10);
}

// ─── Cleanup ────────────────────────────────────────────────────
//
// Удаляет завершённые задачи старше N дней.
// Best-effort S3 delete: если deleteObject/remove/deleteKey не реализован
// в L.0.01.07 — warn и продолжаем, S3 lifecycle rule досчистит.

async function tryDeleteS3(key: string): Promise<boolean> {
  try {
    const s3 = (await import('./s3.js')) as Record<string, unknown>;
    const del =
      s3['deleteObject'] ??
      s3['remove'] ??
      s3['deleteKey'] ??
      s3['delete'];
    if (typeof del !== 'function') {
      return false;
    }
    await (del as (key: string) => Promise<unknown>)(key);
    return true;
  } catch (e) {
    logger.warn({ err: e, key }, 'jobs cleanup: S3 delete failed');
    return false;
  }
}

export async function cleanupOldJobs(
  daysOld: number = 30,
): Promise<{ deletedJobs: number; deletedS3Objects: number }> {
  const rows = await query<{ id: string; result_key: string | null }>(
    `SELECT id, result_key
       FROM jobs
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND finished_at IS NOT NULL
        AND finished_at < now() - ($1::int || ' days')::interval
      LIMIT 1000`,
    [daysOld],
  );

  if (rows.length === 0) {
    return { deletedJobs: 0, deletedS3Objects: 0 };
  }

  let deletedS3 = 0;
  for (const r of rows) {
    if (r.result_key) {
      const ok = await tryDeleteS3(r.result_key);
      if (ok) {deletedS3 += 1;}
    }
  }

  const ids = rows.map((r) => r.id);
  await query(
    `DELETE FROM jobs WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  logger.info(
    { deletedJobs: ids.length, deletedS3Objects: deletedS3, daysOld },
    'jobs cleanup: done',
  );

  return { deletedJobs: ids.length, deletedS3Objects: deletedS3 };
}