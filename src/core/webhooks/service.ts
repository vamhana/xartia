// C.0.37.02 — Сервис Webhooks.
// CRUD + dispatch + delivery + retry. SSRF-защита. HMAC-подпись.
// Secret зашифрован at-rest (AES-256-GCM через L.0.01.06).
//
// Dispatch вызывается из бизнес-сервисов через dynamic import —
// разрывает циклы core/* ↔ core/webhooks.

import { lookup } from 'node:dns/promises';

import { hmac, encrypt, decrypt, randomBytes, isEncrypted } from '../../lib/crypto.js';
import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { logAction } from '../audit.js';
import {
  NotFoundError,
  ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import {
  createWebhook as entityCreateWebhook,
  updateWebhook as entityUpdateWebhook,
  shouldDeliver,
  buildDelivery,
  markDelivered,
  markFailed,
  scheduleRetry,
  ALLOWED_EVENTS,
  MAX_ATTEMPTS,
  MAX_RESPONSE_BODY_BYTES,
  type Webhook,
  type WebhookDelivery,
  type DeliveryStatus,
} from './entity.js';

// ─── Вспомогательное ─────────────────────────────────────────────

function getEncryptionKey(): string {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be set (base64, 32 bytes)');
  }
  return key;
}

function generateSecret(): string {
  // 32 байта → 64 hex.
  return randomBytes(32).toString('hex');
}

// ─── Row-mapping ─────────────────────────────────────────────────

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function rowToWebhook(r: WebhookRow): Webhook {
  const encKey = getEncryptionKey();
  return {
    id: r.id,
    url: r.url,
    events: r.events ?? [],
    secret: isEncrypted(r.secret) ? decrypt(r.secret, encKey) : r.secret,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  attempts: number;
  status: DeliveryStatus;
  next_retry_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

function rowToDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhook_id,
    event: r.event,
    payload: r.payload ?? {},
    responseStatus: r.response_status,
    responseBody: r.response_body,
    attempts: r.attempts,
    status: r.status,
    nextRetryAt: r.next_retry_at ? r.next_retry_at.toISOString() : null,
    deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── SSRF-защита ─────────────────────────────────────────────────

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map((s) => parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {return false;}
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) {return true;}
  if (a === 172 && b >= 16 && b <= 31) {return true;}
  if (a === 192 && b === 168) {return true;}
  if (a === 127) {return true;}
  if (a === 169 && b === 254) {return true;}
  if (a === 0) {return true;}
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === '::1') {return true;}
  if (lower.startsWith('fc') || lower.startsWith('fd')) {return true;} // fc00::/7
  if (lower.startsWith('fe80')) {return true;} // link-local
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

function isPrivateAddress(addr: string): boolean {
  return addr.includes(':') ? isPrivateIPv6(addr) : isPrivateIPv4(addr);
}

/**
 * SSRF-защита: только HTTPS + DNS-резолв + блоклист приватных IP.
 * Env ALLOW_PRIVATE_WEBHOOKS=true (для dev-тестов) — отключает обе проверки.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const allowPrivate = process.env['ALLOW_PRIVATE_WEBHOOKS'] === 'true';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Некорректный URL');
  }

  if (parsed.protocol !== 'https:' && !allowPrivate) {
    throw new ValidationError(
      'Разрешён только HTTPS (V.6). Для dev-тестов: ALLOW_PRIVATE_WEBHOOKS=true',
      [{ path: 'url', message: 'HTTPS required' }],
    );
  }

  if (allowPrivate) {return;}

  let addresses: string[];
  try {
    const records = await lookup(parsed.hostname, { all: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new ValidationError(`Не удалось разрешить DNS: ${parsed.hostname}`);
  }
  if (addresses.length === 0) {
    throw new ValidationError(`DNS не вернул адресов для ${parsed.hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      throw new ValidationError(
        `SSRF-защита: приватный IP запрещён (${addr})`,
        [{ path: 'url', message: 'Private IP forbidden' }],
      );
    }
  }
}

// ─── HMAC ────────────────────────────────────────────────────────

/**
 * Подпись payload для заголовков доставки.
 * sign = HMAC-SHA256(secret, `${timestamp}.${JSON.stringify(payload)}`)
 * Возвращает пару { signature, timestamp } — сервер отправляет оба.
 */
export function signPayload(
  payload: Record<string, unknown>,
  secret: string,
): { signature: string; timestamp: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const data = `${timestamp}.${JSON.stringify(payload)}`;
  return { signature: hmac(data, secret), timestamp };
}

// ─── CRUD ────────────────────────────────────────────────────────

export interface CreateWebhookServiceInput {
  url: string;
  events: string[];
  secret?: string;
}

export async function createWebhook(
  input: CreateWebhookServiceInput,
  requesterId: UUID,
): Promise<Webhook> {
  await assertPublicUrl(input.url);

  const secret = input.secret ?? generateSecret();
  const entity = entityCreateWebhook({
    id: newUUID(),
    url: input.url,
    events: input.events,
    secret,
    createdBy: requesterId,
  });

  const encKey = getEncryptionKey();
  const encryptedSecret = encrypt(entity.secret, encKey);

  await query(
    `INSERT INTO webhooks
       (id, url, events, secret, active, created_by)
     VALUES ($1, $2, $3, $4, true, $5)`,
    [entity.id, entity.url, entity.events, encryptedSecret, entity.createdBy],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'webhook.created',
    entityType: 'webhook',
    entityId: entity.id,
    newValue: { url: entity.url, events: entity.events },
  });

  return entity;
}

export async function listWebhooks(_requesterId: UUID): Promise<Webhook[]> {
  const rows = await query<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks
      ORDER BY created_at DESC
      LIMIT 200`,
  );
  // Секрет не покидает сервер: он возвращается только при создании/ротации.
  return rows.map((row) => ({ ...rowToWebhook(row), secret: '' }));
}

export interface UpdateWebhookServiceInput {
  url?: string;
  events?: string[];
  active?: boolean;
}

export async function updateWebhook(
  id: UUID,
  patch: UpdateWebhookServiceInput,
  requesterId: UUID,
): Promise<Webhook> {
  const row = await queryOne<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Webhook', id);}

  // При смене URL — перепроверить SSRF.
  if (patch.url !== undefined && patch.url !== row.url) {
    await assertPublicUrl(patch.url);
  }

  const updated = entityUpdateWebhook(rowToWebhook(row), patch);

  await query(
    `UPDATE webhooks
        SET url = $2, events = $3, active = $4, updated_at = now()
      WHERE id = $1`,
    [id, updated.url, updated.events, updated.active],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'webhook.updated',
    entityType: 'webhook',
    entityId: id,
    oldValue: { url: row.url, events: row.events, active: row.active },
    newValue: { url: updated.url, events: updated.events, active: updated.active },
  });

  return updated;
}

export async function deleteWebhook(
  id: UUID,
  requesterId: UUID,
): Promise<void> {
  const row = await queryOne<{ id: string; url: string }>(
    `SELECT id, url FROM webhooks WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Webhook', id);}

  // Deliveries уходят через ON DELETE CASCADE.
  await query(`DELETE FROM webhooks WHERE id = $1`, [id]);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'webhook.deleted',
    entityType: 'webhook',
    entityId: id,
    oldValue: { url: row.url },
  });
}

// ─── Test-доставка ───────────────────────────────────────────────

export async function testWebhook(
  id: UUID,
  requesterId: UUID,
): Promise<{ sent: boolean }> {
  const row = await queryOne<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Webhook', id);}

  const w = rowToWebhook(row);
  const payload: Record<string, unknown> = {
    webhookId: w.id,
    test: true,
    timestamp: new Date().toISOString(),
  };

  // Тестовое событие игнорирует подписки — доставляем всегда.
  const d = buildDelivery(w, 'webhook.test', payload, 0);

  await query(
    `INSERT INTO webhook_deliveries
       (id, webhook_id, event, payload, attempts, status)
     VALUES ($1, $2, $3, $4::jsonb, 0, 'pending')`,
    [d.id, d.webhookId, d.event, JSON.stringify(d.payload)],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'webhook.test.sent',
    entityType: 'webhook',
    entityId: id,
  });

  await deliverOne(w, d);
  return { sent: true };
}

// ─── Deliveries ──────────────────────────────────────────────────

export async function listDeliveries(
  webhookId: UUID,
  page: number,
  perPage: number,
): Promise<{ data: WebhookDelivery[]; total: number }> {
  const w = await queryOne<{ id: string }>(
    `SELECT id FROM webhooks WHERE id = $1`,
    [webhookId],
  );
  if (!w) {throw new NotFoundError('Webhook', webhookId);}

  const p = Math.max(1, page);
  const pp = Math.min(200, Math.max(1, perPage));
  const offset = (p - 1) * pp;

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM webhook_deliveries WHERE webhook_id = $1`,
    [webhookId],
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  const rows = await query<DeliveryRow>(
    `SELECT id, webhook_id, event, payload, response_status, response_body,
            attempts, status, next_retry_at, delivered_at, created_at
       FROM webhook_deliveries
      WHERE webhook_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [webhookId, pp, offset],
  );

  return { data: rows.map(rowToDelivery), total };
}

export async function retryDelivery(
  webhookId: UUID,
  deliveryId: UUID,
  requesterId: UUID,
): Promise<{ delivered: boolean }> {
  const row = await queryOne<DeliveryRow>(
    `SELECT id, webhook_id, event, payload, response_status, response_body,
            attempts, status, next_retry_at, delivered_at, created_at
       FROM webhook_deliveries
      WHERE id = $1 AND webhook_id = $2`,
    [deliveryId, webhookId],
  );
  if (!row) {throw new NotFoundError('Доставка', deliveryId);}

  const wRow = await queryOne<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks WHERE id = $1`,
    [webhookId],
  );
  if (!wRow) {throw new NotFoundError('Webhook', webhookId);}

  const w = rowToWebhook(wRow);
  const d = rowToDelivery(row);

  const updated = await deliverOne(w, d);

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'webhook.delivery.retry',
    entityType: 'webhook_delivery',
    entityId: deliveryId,
    newValue: { status: updated.status },
  });

  return { delivered: updated.status === 'delivered' };
}

// ─── Dispatch (из бизнес-сервисов) ───────────────────────────────

/**
 * Отправить событие всем активным подписчикам.
 * Best-effort: ошибки одного webhook'а не блокируют остальных.
 * Вызывающие сервисы зовут через dynamic import и оборачивают в try/catch.
 */
export async function dispatch(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!ALLOWED_EVENTS.includes(event)) {
    logger.warn({ event }, 'webhook dispatch: unknown event');
    return;
  }

  const rows = await query<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks
      WHERE active = true AND $1 = ANY(events)`,
    [event],
  );
  if (rows.length === 0) {return;}

  for (const row of rows) {
    const w = rowToWebhook(row);
    if (!shouldDeliver(w, event)) {continue;}

    const d = buildDelivery(w, event, payload, 0);
    try {
      await query(
        `INSERT INTO webhook_deliveries
           (id, webhook_id, event, payload, attempts, status)
         VALUES ($1, $2, $3, $4::jsonb, 0, 'pending')`,
        [d.id, d.webhookId, d.event, JSON.stringify(d.payload)],
      );
      await deliverOne(w, d);
    } catch (e) {
      logger.warn(
        { err: e, webhookId: w.id, event },
        'webhook dispatch: delivery failed',
      );
    }
  }
}

// ─── Delivery (внутренний) ───────────────────────────────────────

async function deliverOne(
  w: Webhook,
  d: WebhookDelivery,
): Promise<WebhookDelivery> {
  const { signature, timestamp } = signPayload(d.payload, w.secret);

  let responseStatus: number | null = null;
  let responseBody = '';
  let networkError: string | null = null;

  try {
    const res = await fetch(w.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Charter-Signature': signature,
        'X-Charter-Timestamp': timestamp,
        'X-Charter-Delivery-Id': d.id,
        'X-Charter-Event': d.event,
      },
      body: JSON.stringify(d.payload),
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = await res.text();
  } catch (e) {
    networkError = e instanceof Error ? e.message : String(e);
  }

  let updated: WebhookDelivery;

  if (networkError === null && responseStatus !== null && responseStatus >= 200 && responseStatus < 300) {
    updated = markDelivered(d, responseStatus, responseBody);
  } else {
    const reason = networkError ?? `HTTP ${responseStatus}`;
    updated = scheduleRetry(markFailed(d, reason));
  }

  await persistDeliveryUpdate(updated);
  return updated;
}

async function persistDeliveryUpdate(d: WebhookDelivery): Promise<void> {
  await query(
    `UPDATE webhook_deliveries
        SET response_status = $2,
            response_body   = $3,
            attempts        = $4,
            status          = $5,
            next_retry_at   = $6,
            delivered_at    = $7
      WHERE id = $1`,
    [
      d.id,
      d.responseStatus,
      d.responseBody,
      d.attempts,
      d.status,
      d.nextRetryAt,
      d.deliveredAt,
    ],
  );
}

// ─── Cron ────────────────────────────────────────────────────────

export async function processRetries(): Promise<{
  processed: number;
  delivered: number;
  failed: number;
}> {
  const rows = await query<DeliveryRow>(
    `SELECT id, webhook_id, event, payload, response_status, response_body,
            attempts, status, next_retry_at, delivered_at, created_at
       FROM webhook_deliveries
      WHERE status = 'pending'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= now()
      ORDER BY next_retry_at ASC
      LIMIT 100`,
  );

  let processed = 0;
  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    processed++;
    const d = rowToDelivery(row);

    const wRow = await queryOne<WebhookRow>(
      `SELECT id, url, events, secret, active, created_by, created_at, updated_at
         FROM webhooks WHERE id = $1`,
      [d.webhookId],
    );

    if (!wRow) {
      // Webhook удалён — доставка больше не имеет смысла.
      await query(
        `UPDATE webhook_deliveries
            SET status = 'failed',
                response_body = COALESCE(response_body, '') || ' [webhook deleted]',
                next_retry_at = NULL
          WHERE id = $1`,
        [d.id],
      );
      failed++;
      continue;
    }

    const w = rowToWebhook(wRow);

    try {
      const updated = await deliverOne(w, d);
      if (updated.status === 'delivered') {delivered++;}
      else {failed++;}
    } catch (e) {
      failed++;
      logger.warn(
        { err: e, deliveryId: d.id, webhookId: w.id },
        'webhook retry: delivery failed',
      );
    }
  }

  return { processed, delivered, failed };
}

// ─── Константы/типы для контроллера ─────────────────────────────

export { ALLOWED_EVENTS, MAX_ATTEMPTS, MAX_RESPONSE_BODY_BYTES };

/** Новый секрет: старый сразу перестаёт действовать. Возвращается один раз. */
export async function rotateWebhookSecret(
  id: UUID,
  requesterId: UUID,
): Promise<{ secret: string }> {
  const row = await queryOne<WebhookRow>(
    `SELECT id, url, events, secret, active, created_by, created_at, updated_at
       FROM webhooks WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Webhook', id);}

  const secret = generateSecret();
  await query(
    `UPDATE webhooks SET secret = $2, updated_at = now() WHERE id = $1`,
    [id, encrypt(secret, getEncryptionKey())],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'webhook.secret_rotated', entityType: 'webhook', entityId: id,
  });

  return { secret };
}
