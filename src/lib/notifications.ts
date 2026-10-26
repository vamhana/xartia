// L.0.01.10 — Уведомления
// Единая точка отправки. WS через Redis pub/sub. Email / Telegram / WhatsApp —
// через env-конфиг (webhook или бот). Критичные уведомления не отключаются.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ: транспорт не знает про core-сервисы.
// sendToDirection / sendToRole разрешают получателей через динамический
// импорт core-сервисов — это разрывает циклические зависимости
// (core импортирует lib, lib не должен импортировать core напрямую).

import { AppError } from '../core/errors.js';
import type { Role } from '../core/roles.js';
import type { UUID } from '../core/types.js';

import { logger } from './logger.js';
import { redis, publish } from './redis.js';

// -------- Типы --------

export type NotificationPriority = 'critical' | 'high' | 'standard' | 'background';
export type NotificationChannel = 'ws' | 'email' | 'telegram' | 'whatsapp';

export interface NotificationPayload {
  recipientId: UUID;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
  templateId?: string;
  // persist: false — не сохранять в notif:history (Redis). Используется для
  // одноразовых секретов (recovery-токен): токен уходит в мессенджер, но
  // не должен оставаться в истории уведомлений на 30 дней.
  persist?: boolean;
}

export interface NotificationRecord {
  id: string;
  recipientId: UUID;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface SendResult {
  delivered: NotificationChannel[];
  failed: NotificationChannel[];
}

export interface DeviceRegistration {
  token: string;
  platform: 'ios' | 'android';
  addedAt: string;
}

// -------- Конфигурация каналов --------

const EMAIL_WEBHOOK_URL = process.env['NOTIF_EMAIL_WEBHOOK_URL'] ?? '';
const TELEGRAM_BOT_TOKEN = process.env['NOTIF_TELEGRAM_BOT_TOKEN'] ?? '';
const WHATSAPP_WEBHOOK_URL = process.env['NOTIF_WHATSAPP_WEBHOOK_URL'] ?? '';

// Критичные типы не отключаются пользователем (I.4.6, I.2.5).
const CRITICAL_TYPES: ReadonlySet<string> = new Set([
  'crisis.mobilization_started',
  'crisis.plan_activated',
  'regime.activated',
  'semantic.alarm',
  'gateway.violation',
  'integrity.alert',
]);

// Каналы по умолчанию для каждого приоритета.
const CHANNELS_BY_PRIORITY: Record<NotificationPriority, NotificationChannel[]> = {
  critical: ['ws', 'email', 'telegram', 'whatsapp'],
  high: ['ws', 'telegram'],
  standard: ['ws'],
  background: ['ws'],
};

// -------- Ключи Redis --------

const PREFS_KEY = (participantId: UUID): string => `notif:prefs:${participantId}`;
const DEVICES_KEY = (participantId: UUID): string => `notif:devices:${participantId}`;
const HISTORY_KEY = (participantId: UUID): string => `notif:history:${participantId}`;

const HISTORY_MAX = 1000; // колокольчик: все непрочитанные, а не последние 10
const HISTORY_TTL_SEC = 30 * 24 * 3600; // 30 дней

// -------- Шаблоны --------

type TemplateFn = (vars: Record<string, unknown>) => { title: string; body: string };

const TEMPLATES: Record<string, TemplateFn> = {
  'task.assigned': (v) => ({
    title: 'Новая задача',
    body: `Вам назначена задача ${v['externalId'] ?? ''}: ${v['description'] ?? ''}`,
  }),
  'task.returned': (v) => ({
    title: 'Задача возвращена',
    body: `Задача ${v['externalId'] ?? ''} возвращена: ${v['reason'] ?? ''}`,
  }),
  'signal.escalated': (v) => ({
    title: 'Сигнал эскалирован',
    body: `Сигнал ${v['externalId'] ?? ''} эскалирован: ${v['reason'] ?? ''}`,
  }),
  'otc.decision': (v) => ({
    title: 'Решение ОТК',
    body: `Отчёт проверен. Вердикт: ${v['verdict'] ?? ''}`,
  }),
  'crisis.mobilization_started': (v) => ({
    title: '🔴 МОБИЛИЗАЦИЯ',
    body: `Требуется ${v['requiredCount'] ?? '?'} участников. Порог: ${v['thresholdPercent'] ?? 10}%.`,
  }),
  'crisis.plan_activated': (v) => ({
    title: '🔴 КРИЗИСНЫЙ ПЛАН АКТИВИРОВАН',
    body: `План: ${v['title'] ?? ''}. Следуйте точкам сбора.`,
  }),
  'regime.activated': (v) => ({
    title: `Режим активирован: ${v['type'] ?? ''}`,
    body: `Причина: ${v['reason'] ?? ''}`,
  }),
  'semantic.alarm': (v) => ({
    title: '⚠️ Семантическая тревога',
    body: `Термин: ${v['term'] ?? ''}. Требуется реакция в течение 3 часов.`,
  }),
  'gateway.transaction': (v) => ({
    title: 'Сделка Шлюза',
    body: `${v['type'] ?? ''}: ${v['description'] ?? ''}`,
  }),
  'community.created': (v) => ({
    title: 'Новая община',
    body: `${v['code'] ?? ''} — ${v['name'] ?? ''}`,
  }),
  'integrity.alert': (v) => ({
    title: '🛑 ЦИФРОВАЯ АТАКА',
    body: `Система: ${v['system'] ?? ''}. Действие: ${v['action'] ?? ''}.`,
  }),
  'auth.recovery_token': (v) => ({
    title: 'Восстановление доступа',
    body:
      `Код для смены пароля: ${v['token'] ?? ''}\n` +
      `Действует до ${v['expiresAt'] ?? ''}.\n` +
      `Если вы не запрашивали восстановление — сообщите Совету направления.`,
  }),
};

export function buildFromTemplate(
  templateId: string,
  vars: Record<string, unknown>,
): { title: string; body: string } {
  const fn = TEMPLATES[templateId];
  if (!fn) {
    throw new AppError('VALIDATION_ERROR', `Unknown template: ${templateId}`, 422);
  }
  return fn(vars);
}

// -------- Отправка --------

function resolveChannels(
  payload: NotificationPayload,
  prefs: Record<string, boolean>,
): NotificationChannel[] {
  // Явные channels в payload — приоритет.
  if (payload.channels && payload.channels.length > 0) {
    return payload.channels;
  }
  // Критичный тип — все каналы, независимо от prefs.
  if (CRITICAL_TYPES.has(payload.type) || payload.priority === 'critical') {
    return CHANNELS_BY_PRIORITY['critical'];
  }
  // Иначе — по приоритету, отфильтрованные по prefs.
  const base = CHANNELS_BY_PRIORITY[payload.priority];
  return base.filter((ch) => prefs[ch] !== false);
}

export async function send(payload: NotificationPayload): Promise<SendResult> {
  if (!payload.recipientId || !payload.type || !payload.title) {
    throw new AppError('VALIDATION_ERROR', 'recipientId, type, title required', 422);
  }

  const prefs = await getPreferences(payload.recipientId);
  const channels = resolveChannels(payload, prefs);
  const record = buildRecord(payload);

  const delivered: NotificationChannel[] = [];
  const failed: NotificationChannel[] = [];

  await Promise.all(
    channels.map(async (ch) => {
      try {
        await dispatch(ch, payload, record);
        delivered.push(ch);
      } catch (e) {
        failed.push(ch);
        logger.warn(
          { err: e, channel: ch, recipientId: payload.recipientId, type: payload.type },
          'notification dispatch failed',
        );
      }
    }),
  );

  await pushHistory(payload.recipientId, record, payload.persist !== false);

  return { delivered, failed };
}

export async function sendBulk(
  payloads: NotificationPayload[],
): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  // Параллельно, но с ограничением concurrency (батчами по 50).
  const BATCH = 50;
  for (let i = 0; i < payloads.length; i += BATCH) {
    const batch = payloads.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((p) => send(p).catch(() => ({ delivered: [], failed: [] }))),
    );
    for (const r of results) {
      if (r.delivered.length > 0) {delivered++;}
      else {failed++;}
    }
  }
  return { delivered, failed };
}

export async function sendToDirection(
  directionId: UUID,
  payload: Omit<NotificationPayload, 'recipientId'>,
): Promise<{ delivered: number }> {
  const { listParticipants } = await import('../core/participants/service.js');
  const result = await listParticipants(
    { directionId, page: 1, perPage: 200 },
    directionId as unknown as UUID, // requesterId — служебный вызов
  );
  const ids = result.data.map((p) => p.id);
  const payloads: NotificationPayload[] = ids.map((id) => ({
    ...payload,
    recipientId: id,
  }));
  const res = await sendBulk(payloads);
  return { delivered: res.delivered };
}

export async function sendToRole(
  role: Role,
  payload: Omit<NotificationPayload, 'recipientId'>,
  directionId?: UUID,
): Promise<{ delivered: number }> {
  const { listParticipantsWithRole } = await import('../security/rbac.js');
  const ids = await listParticipantsWithRole(role, directionId);
  const payloads: NotificationPayload[] = ids.map((id) => ({
    ...payload,
    recipientId: id,
  }));
  const res = await sendBulk(payloads);
  return { delivered: res.delivered };
}

// -------- Dispatch по каналам --------

async function dispatch(
  channel: NotificationChannel,
  payload: NotificationPayload,
  record: NotificationRecord,
): Promise<void> {
  switch (channel) {
    case 'ws':
      // Публикуем в канал, который слушает W.0.01.01 WS server.
      // Формат сообщения совпадает с dispatchFromRedis в src/ws/server.ts.
      await publish(`ws:participant:${payload.recipientId}`, {
        event: 'notification.new',
        payload: record,
      });
      return;
    case 'email':
      await sendEmail(payload, record);
      return;
    case 'telegram':
      await sendTelegram(payload, record);
      return;
    case 'whatsapp':
      await sendWhatsApp(payload, record);
      return;
  }
}

async function sendEmail(
  payload: NotificationPayload,
  record: NotificationRecord,
): Promise<void> {
  if (!EMAIL_WEBHOOK_URL) {
    // Dev-fallback: логируем. Не бросаем — чтобы не засорять failed.
    logger.info(
      { to: payload.recipientId, title: payload.title, type: payload.type },
      'email notification (no webhook configured)',
    );
    return;
  }
  const res = await fetch(EMAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: payload.recipientId,
      subject: record.title,
      text: record.body,
      meta: { type: record.type, priority: record.priority },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`email webhook returned ${res.status}`);
  }
}

async function sendTelegram(
  payload: NotificationPayload,
  record: NotificationRecord,
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    logger.info(
      { to: payload.recipientId, title: payload.title, type: payload.type },
      'telegram notification (no bot configured)',
    );
    return;
  }
  // chatId должен храниться в prefs или devices. Для простоты — используем recipientId
  // как chatId (в реальности — маппинг через telegram-link).
  const chatId = await getTelegramChatId(payload.recipientId);
  if (!chatId) {
    logger.info(
      { recipientId: payload.recipientId, type: payload.type },
      'telegram notification skipped (no chatId linked)',
    );
    return;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${record.title}\n\n${record.body}`,
        disable_notification: record.priority === 'background',
      }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) {
    throw new Error(`telegram api returned ${res.status}`);
  }
}

async function sendWhatsApp(
  payload: NotificationPayload,
  record: NotificationRecord,
): Promise<void> {
  if (!WHATSAPP_WEBHOOK_URL) {
    logger.info(
      { to: payload.recipientId, title: payload.title, type: payload.type },
      'whatsapp notification (no webhook configured)',
    );
    return;
  }
  const res = await fetch(WHATSAPP_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: payload.recipientId,
      text: `${record.title}\n\n${record.body}`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`whatsapp webhook returned ${res.status}`);
  }
}

// -------- Записи и история --------

function buildRecord(payload: NotificationPayload): NotificationRecord {
  return {
    id: cryptoRandomId(),
    recipientId: payload.recipientId,
    type: payload.type,
    priority: payload.priority,
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
    createdAt: new Date().toISOString(),
    read: false,
  };
}

async function pushHistory(
  recipientId: UUID,
  record: NotificationRecord,
  persist: boolean,
): Promise<void> {
  if (!persist) { return; }
  const key = HISTORY_KEY(recipientId);
  try {
    await redis.lpush(key, JSON.stringify(record));
    await redis.ltrim(key, 0, HISTORY_MAX - 1);
    await redis.expire(key, HISTORY_TTL_SEC);
  } catch (e) {
    logger.warn({ err: e, recipientId }, 'notification history push failed');
  }
}

export async function getHistory(
  participantId: UUID,
  limit = 50,
): Promise<NotificationRecord[]> {
  const key = HISTORY_KEY(participantId);
  const raw = await redis.lrange(key, 0, Math.max(0, limit - 1));
  return raw
    .map((s) => {
      try {
        return JSON.parse(s) as NotificationRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is NotificationRecord => r !== null);
}

export async function markRead(
  participantId: UUID,
  notificationIds: UUID[],
): Promise<{ updated: number }> {
  const key = HISTORY_KEY(participantId);
  const raw = await redis.lrange(key, 0, HISTORY_MAX - 1);
  const set = new Set(notificationIds);
  let updated = 0;
  const newList: string[] = [];
  for (const s of raw) {
    try {
      const rec = JSON.parse(s) as NotificationRecord;
      if (set.has(rec.id) && !rec.read) {
        rec.read = true;
        updated++;
      }
      newList.push(JSON.stringify(rec));
    } catch {
      newList.push(s);
    }
  }
  if (updated > 0 && newList.length > 0) {
    // Атомарная замена через MULTI
    await redis
      .multi()
      .del(key)
      .rpush(key, ...newList)
      .expire(key, HISTORY_TTL_SEC)
      .exec();
  }
  return { updated };
}

export async function markAllRead(participantId: UUID): Promise<{ updated: number }> {
  const key = HISTORY_KEY(participantId);
  const raw = await redis.lrange(key, 0, HISTORY_MAX - 1);
  let updated = 0;
  const newList: string[] = [];
  for (const s of raw) {
    try {
      const rec = JSON.parse(s) as NotificationRecord;
      if (!rec.read) {
        rec.read = true;
        updated++;
      }
      newList.push(JSON.stringify(rec));
    } catch {
      newList.push(s);
    }
  }
  if (updated > 0 && newList.length > 0) {
    await redis
      .multi()
      .del(key)
      .rpush(key, ...newList)
      .expire(key, HISTORY_TTL_SEC)
      .exec();
  }
  return { updated };
}

export async function getUnreadCount(participantId: UUID): Promise<number> {
  const history = await getHistory(participantId, HISTORY_MAX);
  return history.filter((r) => !r.read).length;
}

// -------- Устройства --------

export async function registerDevice(
  participantId: UUID,
  deviceToken: string,
  platform: 'ios' | 'android',
): Promise<void> {
  if (!deviceToken) {
    throw new AppError('VALIDATION_ERROR', 'deviceToken required', 422);
  }
  const key = DEVICES_KEY(participantId);
  const existing = await getDevices(participantId);
  const withoutDup = existing.filter((d) => d.token !== deviceToken);
  withoutDup.push({
    token: deviceToken,
    platform,
    addedAt: new Date().toISOString(),
  });
  await redis.set(key, JSON.stringify(withoutDup));
}

export async function unregisterDevice(
  participantId: UUID,
  deviceToken: string,
): Promise<void> {
  const key = DEVICES_KEY(participantId);
  const existing = await getDevices(participantId);
  const filtered = existing.filter((d) => d.token !== deviceToken);
  if (filtered.length === 0) {
    await redis.del(key);
  } else {
    await redis.set(key, JSON.stringify(filtered));
  }
}

export async function getDevices(participantId: UUID): Promise<DeviceRegistration[]> {
  const raw = await redis.get(DEVICES_KEY(participantId));
  if (!raw) {return [];}
  try {
    return JSON.parse(raw) as DeviceRegistration[];
  } catch {
    return [];
  }
}

// -------- Preferences --------

export async function getPreferences(
  participantId: UUID,
): Promise<Record<string, boolean>> {
  const raw = await redis.get(PREFS_KEY(participantId));
  if (!raw) {return {};}
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function setPreferences(
  participantId: UUID,
  prefs: Record<string, boolean>,
): Promise<Record<string, boolean>> {
  const current = await getPreferences(participantId);
  const merged = { ...current, ...prefs };
  // Критичные каналы (ws) нельзя отключить.
  if (merged['ws'] === false) {merged['ws'] = true;}
  await redis.set(PREFS_KEY(participantId), JSON.stringify(merged));
  return merged;
}

// -------- Telegram link (опционально) --------

const TELEGRAM_LINK_KEY = (participantId: UUID): string =>
  `notif:telegram:${participantId}`;

export async function linkTelegram(
  participantId: UUID,
  chatId: string,
): Promise<void> {
  await redis.set(TELEGRAM_LINK_KEY(participantId), chatId);
}

async function getTelegramChatId(participantId: UUID): Promise<string | null> {
  return redis.get(TELEGRAM_LINK_KEY(participantId));
}

// -------- Утилиты --------

function cryptoRandomId(): string {
  // Локальный UUID, чтобы не тянуть L.0.01.01 (там циклический импорт потенциально).
  return globalThis.crypto.randomUUID();
}