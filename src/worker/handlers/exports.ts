// I.9.07.02 — Обработчики экспортов для worker.src/worker/handlers/exports.ts
//
// 5 handler'ов: participants, plans, goods, archive, audit-log.
// Каждый: SELECT (LIMIT 100_000) → format (CSV/JSON) → S3 upload → complete.
//
// PII-маскирование — только participants:
//   - phone → maskPII(phone, 'phone')
//   - messengers → {} (не отдаём)
//   - password_hash, phone_hash — НЕ выбираем в SELECT.
//
// audit-log — через S.0.01.05 exportEntries (уже умеет CSV/JSON + S3).
// Остальные — свой toCsv / JSON.stringify.

import type {
  ExportFormat,
  ExportType,
} from '../../core/exports/entity.js';
import { formatJobKey } from '../../core/exports/entity.js';
import type { UUID } from '../../core/types.js';
import { maskPII } from '../../lib/crypto.js';
import { query } from '../../lib/db.js';
import {
  complete,
  updateProgress,
  type Job,
} from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { upload, getDownloadUrl } from '../../lib/s3.js';
import { decryptField } from '../../security/encryption.js';


// ─── Константы ───────────────────────────────────────────────────

const MAX_ROWS = 100_000;

const CONTENT_TYPE_CSV = 'text/csv; charset=utf-8';
const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';

// ─── Payload ─────────────────────────────────────────────────────

interface ExportPayload {
  format: ExportFormat;
  filter: Record<string, unknown>;
  exportType: ExportType;
  requesterId: UUID;
}

function readPayload(job: Job): ExportPayload {
  const p = job.payload;
  const format = (p['format'] as ExportFormat | undefined) ?? 'json';
  const filter = (p['filter'] as Record<string, unknown> | undefined) ?? {};
  const exportType = (p['exportType'] as ExportType | undefined) ?? 'participants';
  const requesterId = (p['requesterId'] as UUID | undefined) ?? job.createdBy;
  return { format, filter, exportType, requesterId };
}

// ─── CSV-эскейпинг (как в S.0.01.05) ────────────────────────────

function csvEscape(value: string): string {
  if (value === '') {return '';}
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const needsQuoting = dangerous || /[",\n\r]/.test(value);
  if (needsQuoting) {
    const escaped = value.replace(/"/g, '""');
    return dangerous ? `"'${escaped}"` : `"${escaped}"`;
  }
  return value;
}

function toCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
): string {
  const lines: string[] = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) {return '';}
          if (typeof v === 'object') {return csvEscape(JSON.stringify(v));}
          return csvEscape(String(v));
        })
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// ─── Общая финализация ──────────────────────────────────────────

async function finalize(
  job: Job,
  payload: ExportPayload,
  rows: Array<Record<string, unknown>>,
  headers: string[],
): Promise<void> {
  await updateProgress(job.id, 50);

  const content = payload.format === 'csv'
    ? toCsv(rows, headers)
    : JSON.stringify(rows, null, 2);

  const key = formatJobKey(payload.exportType, job.id, payload.format);
  const contentType = payload.format === 'csv'
    ? CONTENT_TYPE_CSV
    : CONTENT_TYPE_JSON;

  await upload(key, Buffer.from(content, 'utf8'), contentType, 'archive');

  await updateProgress(job.id, 90);
  await complete(job.id, key);

  logger.info(
    { jobId: job.id, exportType: payload.exportType, rows: rows.length, key },
    'exports: upload complete',
  );
}

// ─── participants ───────────────────────────────────────────────

interface ParticipantRow {
  id: string;
  external_id: string;
  name: string;
  pseudonym: string | null;
  direction_id: string;
  status: string;
  phone: string;            // encrypted → decrypt + maskPII
  messengers: Record<string, string> | null;
  entered_at: Date;
}

export async function handleExportParticipants(job: Job): Promise<void> {
  const payload = readPayload(job);

  const cond: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];

  const f = payload.filter;
  if (typeof f['direction_id'] === 'string') {
    params.push(f['direction_id']);
    cond.push(`direction_id = $${params.length}`);
  }
  if (typeof f['status'] === 'string') {
    params.push(f['status']);
    cond.push(`status = $${params.length}`);
  }

  params.push(MAX_ROWS);
  const rows = await query<ParticipantRow>(
    `SELECT id, external_id, name, pseudonym, direction_id, status,
            phone, messengers, entered_at
       FROM participants
      WHERE ${cond.join(' AND ')}
      ORDER BY entered_at DESC
      LIMIT $${params.length}`,
    params,
  );

  await updateProgress(job.id, 10);

  // PII-маскирование: phone → maskPII, messengers → '{}'.
  // password_hash и phone_hash — не выбираются в SELECT.
  const safe = rows.map((r) => {
    let maskedPhone = '***';
    try {
      const plain = decryptField(r.phone);
      maskedPhone = maskPII(plain, 'phone');
    } catch {
      // уже замаскирован
    }

    return {
      id: r.id,
      external_id: r.external_id,
      name: r.name,
      pseudonym: r.pseudonym ?? '',
      direction_id: r.direction_id,
      status: r.status,
      phone: maskedPhone,
      messengers: '{}',  // не отдаём
      entered_at: r.entered_at.toISOString(),
    };
  });

  await finalize(
    job,
    payload,
    safe,
    [
      'id', 'external_id', 'name', 'pseudonym', 'direction_id',
      'status', 'phone', 'messengers', 'entered_at',
    ],
  );
}

// ─── plans ──────────────────────────────────────────────────────

interface PlanRow {
  id: string;
  external_id: string;
  type: string;
  title: string;
  expected_result: string;
  lead_direction_id: string;
  status: string;
  created_at: Date;
}

export async function handleExportPlans(job: Job): Promise<void> {
  const payload = readPayload(job);

  const cond: string[] = [];
  const params: unknown[] = [];
  const f = payload.filter;
  if (typeof f['status'] === 'string') {
    params.push(f['status']);
    cond.push(`status = $${params.length}`);
  }
  if (typeof f['lead_direction_id'] === 'string') {
    params.push(f['lead_direction_id']);
    cond.push(`lead_direction_id = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  params.push(MAX_ROWS);
  const rows = await query<PlanRow>(
    `SELECT id, external_id, type, title, expected_result,
            lead_direction_id, status, created_at
       FROM plans
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  await updateProgress(job.id, 10);

  const safe = rows.map((r) => ({
    id: r.id,
    external_id: r.external_id,
    type: r.type,
    title: r.title,
    expected_result: r.expected_result,
    lead_direction_id: r.lead_direction_id,
    status: r.status,
    created_at: r.created_at.toISOString(),
  }));

  await finalize(
    job,
    payload,
    safe,
    ['id', 'external_id', 'type', 'title', 'expected_result', 'lead_direction_id', 'status', 'created_at'],
  );
}

// ─── goods ──────────────────────────────────────────────────────

interface GoodRow {
  id: string;
  name: string;
  type: string;
  status: string;
  producer_direction_id: string;
  version: number;
  description: string | null;
  created_at: Date;
}

export async function handleExportGoods(job: Job): Promise<void> {
  const payload = readPayload(job);

  const cond: string[] = [];
  const params: unknown[] = [];
  const f = payload.filter;
  if (typeof f['status'] === 'string') {
    params.push(f['status']);
    cond.push(`status = $${params.length}`);
  }
  if (typeof f['type'] === 'string') {
    params.push(f['type']);
    cond.push(`type = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  params.push(MAX_ROWS);
  const rows = await query<GoodRow>(
    `SELECT id, name, type, status, producer_direction_id, version,
            description, created_at
       FROM goods
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  await updateProgress(job.id, 10);

  const safe = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    producer_direction_id: r.producer_direction_id,
    version: r.version,
    description: r.description ?? '',
    created_at: r.created_at.toISOString(),
  }));

  await finalize(
    job,
    payload,
    safe,
    ['id', 'name', 'type', 'status', 'producer_direction_id', 'version', 'description', 'created_at'],
  );
}

// ─── archive ────────────────────────────────────────────────────

interface ArchiveRow {
  id: string;
  type: string;
  direction_id: string;
  subject: string;
  version: number;
  archived_at: Date;
}

export async function handleExportArchive(job: Job): Promise<void> {
  const payload = readPayload(job);

  const cond: string[] = [];
  const params: unknown[] = [];
  const f = payload.filter;
  if (typeof f['direction_id'] === 'string') {
    params.push(f['direction_id']);
    cond.push(`direction_id = $${params.length}`);
  }
  if (typeof f['date_from'] === 'string') {
    params.push(f['date_from']);
    cond.push(`archived_at >= $${params.length}`);
  }
  if (typeof f['date_to'] === 'string') {
    params.push(f['date_to']);
    cond.push(`archived_at <= $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';

  params.push(MAX_ROWS);
  const rows = await query<ArchiveRow>(
    `SELECT id, type, direction_id, subject, version, archived_at
       FROM archive_documents
       ${where}
      ORDER BY archived_at DESC
      LIMIT $${params.length}`,
    params,
  );

  await updateProgress(job.id, 10);

  const safe = rows.map((r) => ({
    id: r.id,
    type: r.type,
    direction_id: r.direction_id,
    subject: r.subject,
    version: r.version,
    archived_at: r.archived_at.toISOString(),
  }));

  await finalize(
    job,
    payload,
    safe,
    ['id', 'type', 'direction_id', 'subject', 'version', 'archived_at'],
  );
}

// ─── audit-log ──────────────────────────────────────────────────

export async function handleExportAuditLog(job: Job): Promise<void> {
  const payload = readPayload(job);

  await updateProgress(job.id, 10);

  // Используем S.0.01.05 exportEntries: он сам форматирует и загружает в S3.
  const f = payload.filter;
  const filter: Record<string, unknown> = {};
  if (typeof f['entity_type'] === 'string') {filter['entityType'] = f['entity_type'];}
  if (typeof f['actor_id'] === 'string') {filter['actorId'] = f['actor_id'];}
  if (typeof f['action'] === 'string') {filter['action'] = f['action'];}
  if (typeof f['from'] === 'string') {filter['from'] = f['from'];}
  if (typeof f['to'] === 'string') {filter['to'] = f['to'];}

  const mod = (await import('../../security/audit-log.js')) as {
    exportEntries?: (
      filter: Record<string, unknown>,
      format: 'csv' | 'json',
    ) => Promise<{ key: string; rows: number; bytes: number }>;
  };

  if (typeof mod.exportEntries !== 'function') {
    throw new Error('S.0.01.05.exportEntries не найден — audit-log export недоступен');
  }

  const result = await mod.exportEntries(filter, payload.format);

  await updateProgress(job.id, 90);
  await complete(job.id, result.key);

  logger.info(
    { jobId: job.id, rows: result.rows, key: result.key },
    'exports: audit-log uploaded',
  );
}

// ─── Re-export для использования в service.ts (presigned URL) ───

export async function presignedUrlFor(
  key: string,
  ttlSeconds = 7 * 24 * 3600,
): Promise<string | null> {
  try {
    return await getDownloadUrl(key, 'archive', ttlSeconds);
  } catch (e) {
    logger.warn({ err: e, key }, 'exports: getDownloadUrl failed');
    return null;
  }
}