// W.2.12.01 — Канал WS chat
// Комната на канал чата: ws:broadcast:chat:<channelId>.
// Клиенты подписываются явно.

import type { ChatMessage } from '../core/chat/entity.js';
import { logger } from '../lib/logger.js';

import { publish, sendToParticipant } from './_helpers.js';

function roomChannel(channelId: string): string {
  return `ws:broadcast:chat:${channelId}`;
}

export async function registerChatChannel(): Promise<void> {
  logger.info({}, 'ws: chat channel registered (per-room)');
}

export async function emitChatMessage(channelId: string, message: ChatMessage): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.message',
      payload: { channelId, message },
    });
  } catch (e) {
    logger.warn({ err: e, channelId, messageId: message.id }, 'ws: emitChatMessage failed');
  }
}

export async function emitChatMessageEdited(
  channelId: string,
  message: ChatMessage,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.message_edited',
      payload: { channelId, message },
    });
  } catch (e) {
    logger.warn({ err: e, channelId, messageId: message.id }, 'ws: emitChatMessageEdited failed');
  }
}

export async function emitChatMessageDeleted(
  channelId: string,
  messageId: string,
  by: string,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.message_deleted',
      payload: { channelId, messageId, deletedBy: by, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, channelId, messageId }, 'ws: emitChatMessageDeleted failed');
  }
}

export async function emitChatTyping(
  channelId: string,
  participantId: string,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.typing',
      payload: { channelId, participantId, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, channelId }, 'ws: emitChatTyping failed');
  }
}

export async function emitChatMention(
  channelId: string,
  mentionedId: string,
  message: ChatMessage,
): Promise<void> {
  try {
    // В комнату — только факт упоминания (без дублирования message).
    await publish(roomChannel(channelId), {
      event: 'chat.mention',
      payload: { channelId, mentionedId, messageId: message.id },
    });
    // Персонально упомянутому — полное сообщение.
    await sendToParticipant(mentionedId, 'chat.mentioned', {
      channelId,
      message,
      at: new Date().toISOString(),
    });
  } catch (e) {
    logger.warn({ err: e, channelId, mentionedId }, 'ws: emitChatMention failed');
  }
}

export async function emitChatJoined(
  channelId: string,
  participantId: string,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.joined',
      payload: { channelId, participantId, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, channelId, participantId }, 'ws: emitChatJoined failed');
  }
}

export async function emitChatLeft(
  channelId: string,
  participantId: string,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.left',
      payload: { channelId, participantId, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, channelId, participantId }, 'ws: emitChatLeft failed');
  }
}

export async function emitChatChannelArchived(
  channelId: string,
  reason: string,
): Promise<void> {
  try {
    await publish(roomChannel(channelId), {
      event: 'chat.channel_archived',
      payload: { channelId, reason, at: new Date().toISOString() },
    });
  } catch (e) {
    logger.warn({ err: e, channelId }, 'ws: emitChatChannelArchived failed');
  }
}