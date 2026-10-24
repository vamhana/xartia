// W.2.11.01 — Канал WS notifications
// Персональные уведомления. Все события идут через WS server (sendToParticipant)
// и автоматически попадают в мультинодовые подключения через Redis pub/sub.
//
// АРХИТЕКТУРНОЕ РЕШЕНИЕ:
// - 'notifications' — виртуальный канал. Клиент не подписывается явно.
//   Каждый клиент по своему participantId автоматически получает notification.new
//   через канал ws:participant:<pid>.
// - Публикация send() → L.0.01.10 → publish('ws:participant:<pid>') → WS server.
// - emitNotificationRead / ReadAll — для мультиустройства: все сокеты участника
//   должны увидеть обновление.
// - NotificationRecord — единый тип из L.0.01.10. Не дублируем.

import type { UUID } from '../core/types.js';
import { logger } from '../lib/logger.js';
import {
  getHistory,
  getUnreadCount,
  markRead as libMarkRead,
  markAllRead as libMarkAllRead,
} from '../lib/notifications.js';
import type { NotificationRecord } from '../lib/notifications.js';

import {
  sendToParticipant,
  registerChannel,
  type WSConnection,
} from './server.js';

// -------- Реэкспорт типа --------

export type { NotificationRecord };

// -------- Регистрация --------

export async function registerNotificationChannel(): Promise<void> {
  await registerChannel('notifications', (conn: WSConnection, event: string) => {
    // Событие приходит от клиента через dispatchToChannel. Сейчас —
    // только debug. Вся логика пометки read — на стороне REST (A.1.96.01).
    logger.debug(
      { connectionId: conn.id, participantId: conn.participantId, event },
      'ws: notification channel event',
    );
  });
  logger.info({}, 'ws: notifications channel registered');
}

// -------- Публикация --------

export async function emitNotification(
  participantId: UUID,
  notification: NotificationRecord,
): Promise<boolean> {
  return sendToParticipant(participantId, 'notification.new', notification);
}

export async function emitNotificationBatch(
  participantIds: UUID[],
  notification: Omit<NotificationRecord, 'recipientId'>,
): Promise<number> {
  let count = 0;
  for (const pid of participantIds) {
    const ok = await sendToParticipant(pid, 'notification.new', {
      ...notification,
      recipientId: pid,
    });
    if (ok) {count++;}
  }
  return count;
}

/**
 * Уведомляет клиента (все его сокеты), что часть уведомлений помечена прочитанной.
 * Используется в мультиустройстве: если у участника открыто 2 вкладки,
 * обе должны увидеть, что notification.read.
 */
export async function emitNotificationRead(
  participantId: UUID,
  notificationIds: string[],
): Promise<boolean> {
  return sendToParticipant(participantId, 'notification.read', {
    ids: notificationIds,
    readAt: new Date().toISOString(),
  });
}

export async function emitNotificationReadAll(
  participantId: UUID,
): Promise<boolean> {
  return sendToParticipant(participantId, 'notification.read_all', {
    readAt: new Date().toISOString(),
  });
}

// -------- Обёртки над L.0.01.10 с автоматической эмиссией --------

/**
 * Помечает уведомления прочитанными И эмитит событие в WS.
 * Возвращает, сколько записей обновлено.
 */
export async function markReadAndEmit(
  participantId: UUID,
  notificationIds: string[],
): Promise<{ updated: number }> {
  const result = await libMarkRead(participantId, notificationIds);
  if (result.updated > 0) {
    await emitNotificationRead(participantId, notificationIds);
  }
  return result;
}

export async function markAllReadAndEmit(
  participantId: UUID,
): Promise<{ updated: number }> {
  const result = await libMarkAllRead(participantId);
  if (result.updated > 0) {
    await emitNotificationReadAll(participantId);
  }
  return result;
}

// -------- Чтение --------

export async function getUnreadCountForParticipant(
  participantId: UUID,
): Promise<number> {
  return getUnreadCount(participantId);
}

export async function getHistoryForParticipant(
  participantId: UUID,
  limit = 50,
): Promise<NotificationRecord[]> {
  return getHistory(participantId, limit);
}