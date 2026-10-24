// C.0.36.01 (неявный) — Доменная сущность Chat
// Каналы, сообщения, участники. Нормализация direct-каналов.

import { ValidationError, ConflictError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ChatChannelType = 'direct' | 'direction' | 'cell' | 'council' | 'project';

export interface ChatChannel {
  id: UUID;
  channelId: string;
  channelType: ChatChannelType;
  scopeId: UUID | null;
  name: string | null;
  createdBy: UUID;
  archivedAt: ISODateTime | null;
  archivedReason: string | null;
  createdAt: ISODateTime;
}

export interface ChatChannelMember {
  id: UUID;
  channelId: UUID;
  participantId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
}

export interface ChatAttachment {
  key: string;
  name: string;
  size: number;
  mime: string;
}

export interface ChatMessage {
  id: UUID;
  channelId: UUID;
  senderId: UUID;
  content: string;
  mentions: UUID[];
  attachments: ChatAttachment[];
  replyToId: UUID | null;
  editedAt: ISODateTime | null;
  deletedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

// -------- Нормализация ID --------

/**
 * Канонический ID личного канала. UUID сортируются лексикографически —
 * чтобы channel ID был одинаков независимо от того, кто из двоих начал чат.
 */
export function normalizeDirectChannelId(a: UUID, b: UUID): string {
  if (a === b) {throw new ValidationError('Нельзя открыть личный чат с самим собой');}
  const [x, y] = a < b ? [a, b] : [b, a];
  return `direct:${x}:${y}`;
}

export function formatScopeChannelId(
  type: 'direction' | 'cell' | 'council' | 'project',
  scopeId: UUID,
): string {
  return `${type}:${scopeId}`;
}

export function parseChannelId(channelId: string): {
  channelType: ChatChannelType;
  parts: string[];
} {
  const [type, ...parts] = channelId.split(':');
  if (!type || !['direct', 'direction', 'cell', 'council', 'project'].includes(type)) {
    throw new ValidationError(`Invalid channel: ${channelId}`);
  }
  return { channelType: type as ChatChannelType, parts };
}

// -------- Проверки --------

export function validateMessageContent(content: string): void {
  const trimmed = content.trim();
  if (trimmed.length === 0) {throw new ValidationError('Сообщение не может быть пустым');}
  if (trimmed.length > 10_000) {throw new ValidationError('Сообщение длиннее 10000 символов');}
}

export function validateAttachments(attachments: ChatAttachment[]): void {
  if (attachments.length > 10) {
    throw new ValidationError('Не более 10 вложений на сообщение');
  }
  for (const a of attachments) {
    if (!a.key || !a.name || !a.mime) {
      throw new ValidationError('Attachment: key, name, mime обязательны');
    }
    if (a.size < 0 || a.size > 100 * 1024 * 1024) {
      throw new ValidationError('Attachment: размер 0–100 МБ');
    }
  }
}

// -------- Создание --------

export function createChannel(input: {
  id: UUID;
  channelId: string;
  channelType: ChatChannelType;
  scopeId?: UUID;
  name?: string;
  createdBy: UUID;
}): ChatChannel {
  return {
    id: input.id,
    channelId: input.channelId,
    channelType: input.channelType,
    scopeId: input.scopeId ?? null,
    name: input.name ?? null,
    createdBy: input.createdBy,
    archivedAt: null,
    archivedReason: null,
    createdAt: new Date().toISOString(),
  };
}

export function createMessage(input: {
  id: UUID;
  channelId: UUID;
  senderId: UUID;
  content: string;
  mentions?: UUID[];
  attachments?: ChatAttachment[];
  replyToId?: UUID;
}): ChatMessage {
  validateMessageContent(input.content);
  if (input.attachments) {validateAttachments(input.attachments);}
  return {
    id: input.id,
    channelId: input.channelId,
    senderId: input.senderId,
    content: input.content.trim(),
    mentions: input.mentions ?? [],
    attachments: input.attachments ?? [],
    replyToId: input.replyToId ?? null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function editMessage(m: ChatMessage, newContent: string): ChatMessage {
  if (m.deletedAt) {throw new ConflictError('Сообщение удалено');}
  validateMessageContent(newContent);
  return {
    ...m,
    content: newContent.trim(),
    editedAt: new Date().toISOString(),
  };
}

export function canEditMessage(m: ChatMessage, userId: UUID): boolean {
  return m.senderId === userId && !m.deletedAt;
}