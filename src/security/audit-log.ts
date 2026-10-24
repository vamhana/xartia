// S.0.01.05 — Модуль audit_log (расширение C.0.01.05)
// Механизм записи (logAction, withAudit, батчинг, PII-маскирование) — в C.0.01.05.
// Здесь — реэкспорт для security-слоя и функции ЧТЕНИЯ:
//   - listEntries (фильтр + пагинация)
//   - countEntries (для meta.total)
//   - exportEntries (CSV / JSON → S3 → presigned download URL)
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// Не дублируем запись. C.0.01.05 остаётся единственным писателем.
// S.0.01.05 — read-side + реэкспорт, чтобы A.1.35.01 Admin и A.1.92.01 Exports
// работали через security-слой, а не лезли напрямую в core.

import {
  logAction,
  logBatch,
  withAudit,
  flush,
  close,
  getQueueSize,
} from '../core/audit.js';
import type { AuditEntry } from '../core/audit.js';
import { AppError } from '../core/errors.js';
import type { UUID, ISODateTime } from '../core/types.js';
import { query, queryOne } from '../lib/db.js';
import { newUUID } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { upload, getDownloadUrl } from '../lib/s3.js';

// -------- Реэкспорт --------

export { logAction, logBatch, withAudit, flush, close, getQueueSize };
export type { AuditEntry };

// -------- Типы --------

export interface AuditLogFilter {
  actorId?: UUID | null;
  actorType?: 'participant' | 'ai' | 'system';
  action?: string;
  entityType?: string;
  entityId?: UUID;
  from?: ISODateTime;
  to?: ISODateTime;
  page?: number;
  perPage?: number;
}

export interface AuditLogRow {
  id: UUID;
  actorId: UUID | null;
  actorType: 'participant' | 'ai' | 'system';
  action: string;
  entityType: string;
  entityId: UUID;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  ip: string | null;
  reason: string | null;
  requestId: string | null;
  createdAt: ISODateTime;
}

export interface ExportResult {
  key: string;
  url: string;
  format: 'csv' | 'json';
  rows: number;
  bytes: number;
}

// -------- Константы --------

// Если from/to не указаны — берём окно 24 часа, чтобы попасть в одну партицию.
const DEFAULT_WINDOW_HOURS = 24;
const MAX_PER_PAGE = 200;
const EXPORT_BATCH_SIZE = 5000;
const EXPORT_MAX_ROWS = 100_000;

// -------- Хелперы --------

interface AuditLogRowRaw {
  id: string;
  actor_id: string | null;
  actor_type: 'participant' | 'ai' | 'system';
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  ip: string | null;
  reason: string | null;
  request_id: string | null;
  created_at: Date;
}

function rowToEntry(row: AuditLogRowRaw): AuditLogRow {
  // pg обычно возвращает Date для timestamptz, но при кастомных parser'ах
  // может вернуть string. Обрабатываем оба варианта.
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();

  return {
    id: row.id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    oldValue: row.old_value,
    newValue: row.new_value,
    context: row.context,
    ip: row.ip,
    reason: row.reason,
    requestId: row.request_id,
    createdAt,
  };
}

interface BuiltWhere {
  where: string;
  params: unknown[];
}

function buildWhere(filter: AuditLogFilter): BuiltWhere {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Обязательный предикат по времени — для партиционирования.
  // Если не задан from — последние 24 часа. Это критично: без предиката
  // по created_at PostgreSQL сканирует все партиции.
  let from = filter.from;
  if (!from) {
    const d = new Date(Date.now() - DEFAULT_WINDOW_HOURS * 3600 * 1000);
    from = d.toISOString();
  }
  params.push(from);
  conditions.push(`created_at >= $${params.length}`);

  if (filter.to) {
    params.push(filter.to);
    conditions.push(`created_at <= $${params.length}`);
  }

  if (filter.actorId !== undefined) {
    if (filter.actorId === null) {
      conditions.push(`actor_id IS NULL`);
    } else {
      params.push(filter.actorId);
      conditions.push(`actor_id = $${params.length}`);
    }
  }

  if (filter.actorType) {
    params.push(filter.actorType);
    conditions.push(`actor_type = $${params.length}`);
  }

  if (filter.action) {
    params.push(filter.action);
    conditions.push(`action = $${params.length}`);
  }

  if (filter.entityType) {
    params.push(filter.entityType);
    conditions.push(`entity_type = $${params.length}`);
  }

  if (filter.entityId) {
    params.push(filter.entityId);
    conditions.push(`entity_id = $${params.length}`);
  }

  return { where: conditions.join(' AND '), params };
}

// -------- Чтение --------

export async function listEntries(
  filter: AuditLogFilter,
): Promise<{ data: AuditLogRow[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const { where, params } = buildWhere(filter);

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audit_log WHERE ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  const pageParams = [...params, perPage, offset];
  const limitIdx = pageParams.length - 1;
  const offsetIdx = pageParams.length;

  const rows = await query<AuditLogRowRaw>(
    `SELECT id, actor_id, actor_type, action, entity_type, entity_id,
            old_value, new_value, context, ip, reason, request_id, created_at
       FROM audit_log
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    pageParams,
  );

  return { data: rows.map(rowToEntry), total };
}

export async function countEntries(filter: AuditLogFilter): Promise<number> {
  const { where, params } = buildWhere(filter);
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audit_log WHERE ${where}`,
    params,
  );
  return parseInt(row?.total ?? '0', 10);
}

// -------- Экспорт --------

export async function exportEntries(
  filter: AuditLogFilter,
  format: 'csv' | 'json',
): Promise<ExportResult> {
  const { where, params } = buildWhere(filter);

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM audit_log WHERE ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  if (total === 0) {
    throw new AppError('NOT_FOUND', 'Нет записей для экспорта', 404);
  }
  if (total > EXPORT_MAX_ROWS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Слишком большой объём (${total} > ${EXPORT_MAX_ROWS}). Сузьте фильтр.`,
      422,
    );
  }

  // Читаем батчами, чтобы не держать всю выборку в памяти при больших объёмах.
  const rows: AuditLogRow[] = [];
  for (let offset = 0; offset < total; offset += EXPORT_BATCH_SIZE) {
    const pageParams = [...params, EXPORT_BATCH_SIZE, offset];
    const limitIdx = pageParams.length - 1;
    const offsetIdx = pageParams.length;

    const batch = await query<AuditLogRowRaw>(
      `SELECT id, actor_id, actor_type, action, entity_type, entity_id,
              old_value, new_value, context, ip, reason, request_id, created_at
         FROM audit_log
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      pageParams,
    );
    rows.push(...batch.map(rowToEntry));
  }

  const content = format === 'csv' ? toCsv(rows) : toJson(rows);
  const buffer = Buffer.from(content, 'utf8');

  const ext = format === 'csv' ? 'csv' : 'json';
  const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const exportId = newUUID();
  const key = `audit-exports/${year}/${month}/${exportId}.${ext}`;

  try {
    await upload(key, buffer, contentType, 'archive');
  } catch (e) {
    logger.error({ err: e, key, total }, 'audit-log: export upload failed');
    throw new AppError('S3_ERROR', 'Не удалось сохранить экспорт', 500);
  }

  // Presigned download URL (TTL 7 дней).
  const url = await getDownloadUrl(key, 'archive', 7 * 24 * 3600);

  logger.info({ key, rows: rows.length, bytes: buffer.length, format }, 'audit-log: export ready');

  return {
    key,
    url,
    format,
    rows: rows.length,
    bytes: buffer.length,
  };
}

// -------- Сериализация --------

function toJson(rows: AuditLogRow[]): string {
  return JSON.stringify(rows, null, 2);
}

function toCsv(rows: AuditLogRow[]): string {
  const header = [
    'id',
    'created_at',
    'actor_id',
    'actor_type',
    'action',
    'entity_type',
    'entity_id',
    'ip',
    'reason',
    'request_id',
    'old_value',
    'new_value',
    'context',
  ];

  const lines: string[] = [header.join(',')];

  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.createdAt),
      csvEscape(r.actorId ?? ''),
      csvEscape(r.actorType),
      csvEscape(r.action),
      csvEscape(r.entityType),
      csvEscape(r.entityId),
      csvEscape(r.ip ?? ''),
      csvEscape(r.reason ?? ''),
      csvEscape(r.requestId ?? ''),
      csvEscape(r.oldValue ? JSON.stringify(r.oldValue) : ''),
      csvEscape(r.newValue ? JSON.stringify(r.newValue) : ''),
      csvEscape(r.context ? JSON.stringify(r.context) : ''),
    ].join(','));
  }

  return lines.join('\n') + '\n';
}

function csvEscape(value: string): string {
  if (value === '') {
    return '';
  }

  // CSV-injection: Excel интерпретирует значения, начинающиеся с = + - @
  // (и табов) как формулы. Префиксуем одинарной кавычкой.
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const needsQuoting = dangerous || /[",\n\r]/.test(value);

  if (needsQuoting) {
    const escaped = value.replace(/"/g, '""');
    // Кавычка внутри значения уже обработана; для dangerous — добавляем
    // апостроф внутри кавычек, чтобы Excel точно не парсил как формулу.
    return dangerous ? `"'${escaped}"` : `"${escaped}"`;
  }

  return value;
}

// -------- Health --------

export async function healthCheck(): Promise<{
  queueSize: number;
  writable: boolean;
}> {
  let writable = false;
  try {
    await queryOne<{ ok: number }>(`SELECT 1 AS ok`);
    writable = true;
  } catch {
    writable = false;
  }
  return {
    queueSize: getQueueSize(),
    writable,
  };
}