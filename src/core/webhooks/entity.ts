// C.0.37.01 — Доменная сущность Webhooks.
// Внешние интеграции: HTTP-подписки на события платформы (V.6, V.7).
//
// Чистые функции. Без побочных эффектов.
//
// HMAC-подпись: sign = HMAC-SHA256(secret, `${timestamp}.${JSON.stringify(payload)}`)
// Заголовки: X-Charter-Signature, X-Charter-Timestamp, X-Charter-Delivery-Id.
//
// Retry: MAX_ATTEMPTS retry-попыток после первой. Backoff 60/300/1800 сек.
// Итого 4 POST'а: 1 первая + 3 retry.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

// ─── Типы ────────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface Webhook {
  id: UUID;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WebhookDelivery {
  id: UUID;
  webhookId: UUID;
  event: string;
  payload: Record<string, unknown>;
  responseStatus: number | null;
  responseBody: string | null;
  attempts: number;
  status: DeliveryStatus;
  nextRetryAt: ISODateTime | null;
  deliveredAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// ─── Константы ───────────────────────────────────────────────────

/** Максимум retry-попыток после первой. Общее число POST = MAX_ATTEMPTS + 1. */
export const MAX_ATTEMPTS = 3;

/** Экспоненциальный backoff (сек): 1 мин, 5 мин, 30 мин. */
export const RETRY_BACKOFF_SEC: readonly number[] = [60, 300, 1800];

/** Обрезка response body (защита от OOM и роста таблицы). */
export const MAX_RESPONSE_BODY_BYTES = 10 * 1024;

/** Разрешённые события (V.6, V.7). */
export const ALLOWED_EVENTS: readonly string[] = [
  'regime.activated',
  'gateway.transaction',
  'semantic.alarm',
  'community.created',
  'bridge.established',
  'referendum.decided',
];

// ─── Создание ────────────────────────────────────────────────────

export interface CreateWebhookInput {
  id: UUID;
  url: string;
  events: string[];
  secret: string;         // hex, 64 символа
  createdBy: UUID;
}

export function createWebhook(input: CreateWebhookInput): Webhook {
  if (!input.url || !input.url.trim()) {
    throw new ValidationError('URL обязателен');
  }
  if (!input.secret || input.secret.length < 16) {
    throw new ValidationError('secret должен быть минимум 16 символов');
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    throw new ValidationError('Хотя бы одно событие обязательно');
  }
  for (const e of input.events) {
    if (!ALLOWED_EVENTS.includes(e)) {
      throw new ValidationError(`Неизвестное событие: ${e}`);
    }
  }

  const now = new Date().toISOString();
  return {
    id: input.id,
    url: input.url.trim(),
    events: [...new Set(input.events)],   // dedup
    secret: input.secret,
    active: true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Обновление ──────────────────────────────────────────────────

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  active?: boolean;
}

export function updateWebhook(
  w: Webhook,
  patch: UpdateWebhookInput,
): Webhook {
  const next: Webhook = { ...w, updatedAt: new Date().toISOString() };

  if (patch.url !== undefined) {
    if (!patch.url.trim()) {
      throw new ValidationError('URL не может быть пустым');
    }
    next.url = patch.url.trim();
  }
  if (patch.events !== undefined) {
    if (patch.events.length === 0) {
      throw new ValidationError('Хотя бы одно событие обязательно');
    }
    for (const e of patch.events) {
      if (!ALLOWED_EVENTS.includes(e)) {
        throw new ValidationError(`Неизвестное событие: ${e}`);
      }
    }
    next.events = [...new Set(patch.events)];
  }
  if (patch.active !== undefined) {
    next.active = patch.active;
  }

  return next;
}

// ─── Проверка подписки ───────────────────────────────────────────

export function shouldDeliver(w: Webhook, event: string): boolean {
  return w.active && w.events.includes(event);
}

// ─── Создание доставки ───────────────────────────────────────────

export function buildDelivery(
  w: Webhook,
  event: string,
  payload: Record<string, unknown>,
  attempt: number,
): WebhookDelivery {
  return {
    id: crypto.randomUUID(),
    webhookId: w.id,
    event,
    payload,
    responseStatus: null,
    responseBody: null,
    attempts: attempt,
    status: 'pending',
    nextRetryAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  };
}

// ─── Переходы доставки ───────────────────────────────────────────

export function markDelivered(
  d: WebhookDelivery,
  status: number,
  body: string,
): WebhookDelivery {
  return {
    ...d,
    responseStatus: status,
    responseBody: truncate(body, MAX_RESPONSE_BODY_BYTES),
    attempts: d.attempts + 1,
    status: 'delivered',
    nextRetryAt: null,
    deliveredAt: new Date().toISOString(),
  };
}

export function markFailed(
  d: WebhookDelivery,
  reason: string,
): WebhookDelivery {
  return {
    ...d,
    responseBody: truncate(reason, MAX_RESPONSE_BODY_BYTES),
    attempts: d.attempts + 1,
    status: 'failed',
  };
}

export function scheduleRetry(d: WebhookDelivery): WebhookDelivery {
  if (d.attempts > MAX_ATTEMPTS) {
    return { ...d, status: 'failed', nextRetryAt: null };
  }

  // noUncheckedIndexedAccess делает массив-индексацию → T | undefined.
  // Достаём fallback явно, без non-null assertion.
  const lastBackoff = RETRY_BACKOFF_SEC[RETRY_BACKOFF_SEC.length - 1] ?? 60;
  const backoffSec = RETRY_BACKOFF_SEC[d.attempts - 1] ?? lastBackoff;

  const nextRetryAt = new Date(Date.now() + backoffSec * 1000).toISOString();
  return { ...d, status: 'pending', nextRetryAt };
}

// ─── Вспомогательное ─────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) {return s;}
  return s.slice(0, max) + '…[truncated]';
}