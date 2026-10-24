// C.0.01.05 — Модуль аудита
// Запись всех значимых действий в audit_log.
// Не блокирует основной поток. Батчинг, ретраи, fallback.

import { maskPII } from '../lib/crypto.js';
import { db, query } from '../lib/db.js';
import { newUUID } from '../lib/id.js';
import { logger, serializeError } from '../lib/logger.js';

import type { UUID } from './types.js';

// -------- Типы --------

export interface AuditEntry {
  actorId: UUID | null;
  actorType: 'participant' | 'ai' | 'system';
  action: string;
  entityType: string;
  entityId: UUID;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  context?: Record<string, unknown>;
  ip?: string;
  reason?: string;
  requestId?: string;
}

type QueuedEntry = AuditEntry & { id: UUID };

// -------- Очередь --------

const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 500;

let queue: QueuedEntry[] = [];

export function getQueueSize(): number {
  return queue.length;
}

let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) {return;}
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

// -------- Маскирование PII --------

type MaskKind = 'phone' | 'email' | 'name' | 'redact';

// Явная карта: что с каким полем делать.
// 'redact' — полностью скрыть (пароли, messengers);
// 'phone' / 'email' — частичная маска через maskPII.
const PII_KIND: Record<string, MaskKind> = {
  phone: 'phone',
  email: 'email',
  password: 'redact',
  password_hash: 'redact',
  passwordHash: 'redact',
  messengers: 'redact',
};

// Максимальная глубина рекурсии: защита от циклических ссылок и
// бесконечных структур в oldValue / newValue / context.
const MAX_MASK_DEPTH = 6;

function maskValue(value: unknown, key: string, depth: number): unknown {
  if (depth > MAX_MASK_DEPTH) {
    return '[max depth]';
  }

  const kind = PII_KIND[key];

  if (kind === 'redact') {
    // Не важно, строка это или объект — содержимое не сохраняем.
    return '***';
  }

  if (kind && typeof value === 'string') {
    return maskPII(value, kind);
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item, key, depth + 1));
  }

  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      out[k] = maskValue(v, k, depth + 1);
    }
    return out;
  }

  return value;
}

function maskRecord(
  rec: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!rec) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = maskValue(v, k, 0);
  }
  return out;
}

// -------- Запись --------

export async function logAction(entry: AuditEntry): Promise<UUID> {
  const id = newUUID();
  queue.push({ ...entry, id });

  if (queue.length >= BATCH_SIZE) {
    await flush();
  } else {
    scheduleFlush();
  }
  return id;
}

export async function logBatch(entries: AuditEntry[]): Promise<UUID[]> {
  const ids: UUID[] = [];
  for (const entry of entries) {
    const id = newUUID();
    ids.push(id);
    queue.push({ ...entry, id });
  }
  if (queue.length >= BATCH_SIZE) {
    await flush();
  } else {
    scheduleFlush();
  }
  return ids;
}

// -------- Flush --------

export async function flush(): Promise<void> {
  if (queue.length === 0) {return;}
  const batch = queue;
  queue = [];

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  try {
    await writeBatchToDb(batch);
  } catch (e) {
    logger.error(
      { err: serializeError(e), size: batch.length },
      'audit: failed to write batch',
    );
    // Одна попытка ретрая
    try {
      await writeBatchToDb(batch);
    } catch (e2) {
      logger.error(
        { err: serializeError(e2), size: batch.length },
        'audit: batch lost after retry, falling back to system_events',
      );
      await fallbackToSystemEvents(batch, e2);
    }
  }
}

async function writeBatchToDb(batch: QueuedEntry[]): Promise<void> {
  // Отсеиваем возможные дыры до нумерации $N — иначе SQL сломается:
  // индексы параметров строятся по позиции в filtered, а не в исходном batch.
  // (QueuedEntry не бывает null, но filter оставляем как страховку от
  //  случайных undefined после будущих рефакторингов.)
  const filtered = batch.filter((e): e is QueuedEntry => Boolean(e));
  if (filtered.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const rows: string[] = [];

  // .entries() вместо индексации: noUncheckedIndexedAccess в tsconfig
  // делает filtered[i] → QueuedEntry | undefined, что требовало ручного
  // `if (!e) continue`. for...of по entries даёт сразу [number, QueuedEntry]
  // без undefined — тот же результат, без риска забыть guard.
  for (const [i, e] of filtered.entries()) {
    const base = i * 12;
    rows.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
        `$${base + 11}, $${base + 12})`,
    );

    const maskedOld = maskRecord(e.oldValue);
    const maskedNew = maskRecord(e.newValue);
    const maskedContext = maskRecord(e.context);

    values.push(
      e.id,
      e.actorId,
      e.actorType,
      e.action,
      e.entityType,
      e.entityId,
      maskedOld ? JSON.stringify(maskedOld) : null,
      maskedNew ? JSON.stringify(maskedNew) : null,
      maskedContext ? JSON.stringify(maskedContext) : null,
      e.ip ?? null,
      e.reason ?? null,
      e.requestId ?? null,
    );
  }

  const sql = `
    INSERT INTO audit_log
      (id, actor_id, actor_type, action, entity_type, entity_id,
       old_value, new_value, context, ip, reason, request_id)
    VALUES ${rows.join(', ')}
  `;

  await db.query(sql, values);
}

// Fallback-запись в system_events — страховка на случай сбоя insert в audit_log.
//
// ВАЖНО: маскирование PII применяется ЗДЕСЬ, до записи. Раньше в system_events
// лежали сырые oldValue/newValue/context в расчёте, что retryFailed() применит
// маску при повторной записи в audit_log. Но retryFailed может не наступить
// (cron не запущен, ручной вызов забыт) — и тогда PII лежит в открытом виде.
// Маскируем сразу; повторная маска в writeBatchToDb идемпотентна
// ('***' → '***', maskPII('***…', 'phone') → тоже безопасный результат).
async function fallbackToSystemEvents(
  batch: QueuedEntry[],
  originalError: unknown,
): Promise<void> {
  const maskedBatch: QueuedEntry[] = batch.map((e) => ({
    ...e,
    oldValue: maskRecord(e.oldValue),
    newValue: maskRecord(e.newValue),
    context: maskRecord(e.context) ?? undefined,
  }));

  try {
    await db.query(
      `INSERT INTO system_events (id, type, payload) VALUES ($1, $2, $3::jsonb)`,
      [
        newUUID(),
        'audit.batch.lost',
        JSON.stringify({
          size: maskedBatch.length,
          error: serializeError(originalError),
          entries: maskedBatch,
        }),
      ],
    );
  } catch (fallbackErr) {
    logger.error(
      { err: serializeError(fallbackErr), size: batch.length },
      'audit: fallback to system_events failed — batch lost permanently',
    );
  }
}

// Повторная запись батчей, потерянных при сбое audit_log.
// Читаем их из system_events и пробуем построчно: одна «плохая» запись
// не должна утащить за собой остальные.
export async function retryFailed(): Promise<{
  retried: number;
  succeeded: number;
}> {
  const events = await query<{
    id: UUID;
    payload: { entries?: QueuedEntry[]; retriedAt?: string };
  }>(
    `SELECT id, payload FROM system_events
      WHERE type = 'audit.batch.lost'
        AND (payload ? 'retriedAt') = false
      ORDER BY created_at ASC
      LIMIT 100`,
  );

  let retried = 0;
  let succeeded = 0;

  for (const ev of events) {
    retried++;
    const entries = ev.payload.entries ?? [];
    if (entries.length === 0) {
      await markEventRetried(ev.id);
      succeeded++;
      continue;
    }

    let persisted = 0;
    for (const e of entries) {
      try {
        await writeBatchToDb([e]);
        persisted++;
      } catch (single) {
        logger.error(
          {
            err: serializeError(single),
            action: e.action,
            entityId: e.entityId,
          },
          'audit: retryFailed — single entry failed',
        );
      }
    }

    if (persisted === entries.length) {
      await markEventRetried(ev.id);
      succeeded++;
    } else {
      logger.warn(
        { persisted, total: entries.length, eventId: ev.id },
        'audit: retryFailed — partial restore',
      );
    }
  }

  return { retried, succeeded };
}

async function markEventRetried(eventId: UUID): Promise<void> {
  await db.query(
    `UPDATE system_events
        SET payload = payload || jsonb_build_object('retriedAt', now()::text)
      WHERE id = $1`,
    [eventId],
  );
}

// -------- Обёртка для критичных операций --------

export async function withAudit<T>(
  action: string,
  entityType: string,
  fn: () => Promise<T>,
  meta: {
    actorId: UUID | null;
    actorType?: 'participant' | 'ai' | 'system';
    entityId: UUID;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    requestId?: string;
    ip?: string;
  },
): Promise<T> {
  try {
    const result = await fn();
    await logAction({
      actorId: meta.actorId,
      actorType: meta.actorType ?? 'participant',
      action,
      entityType,
      entityId: meta.entityId,
      oldValue: (meta.oldValue as Record<string, unknown> | undefined) ?? null,
      newValue: (meta.newValue as Record<string, unknown> | undefined) ?? null,
      reason: meta.reason,
      requestId: meta.requestId,
      ip: meta.ip,
    });
    return result;
  } catch (e) {
    await logAction({
      actorId: meta.actorId,
      actorType: meta.actorType ?? 'participant',
      action: `${action}.failed`,
      entityType,
      entityId: meta.entityId,
      oldValue: (meta.oldValue as Record<string, unknown> | undefined) ?? null,
      newValue: { error: serializeError(e) },
      reason: meta.reason,
      requestId: meta.requestId,
      ip: meta.ip,
    });
    throw e;
  }
}

// -------- Graceful shutdown --------

let closed = false;

export async function close(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}