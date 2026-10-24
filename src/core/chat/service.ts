// C.0.36.02 — Chat service.
// Каналы, сообщения, участники, кэш в Redis.
// Rich-варианты (listMyChannelsRich, getChannelHistoryRich) — для UI,
// обогащают сырые доменные объекты JOIN'ами, чтобы не плодить N+1.
//
// v0.0.02:
//   - P5: archiveChannel — только createdBy (403 для остальных).
//   - P6: 409 → 403 для canAccessChannel-отказов в sendMessage и
//         getChannelHistoryRich (403 семантически = «нет доступа»,
//         409 = «конфликт состояния»).
//   - P7: getOrCreateChannel — race: параллельный INSERT с тем же
//         channel_id → UNIQUE violation → читаем существующий и возвращаем.

import { query, queryOne, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { redis } from '../../lib/redis.js';
import {
  emitChatMessage,
  emitChatMessageEdited,
  emitChatMessageDeleted,
  emitChatMention,
  emitChatJoined,
  emitChatLeft,
  emitChatChannelArchived,
} from '../../ws/chat.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

import {
  createMessage, editMessage,
  normalizeDirectChannelId, formatScopeChannelId,
  canEditMessage,
  type ChatChannel, type ChatChannelType,
  type ChatMessage, type ChatChannelMember,
  type ChatAttachment,
} from './entity.js';

// -------- Константы --------

const RECENT_KEY = (channelId: string): string => `chat:${channelId}:recent`;
const RECENT_MAX = 100;
const RECENT_TTL_SEC = 7 * 24 * 3600;

// -------- Ряды --------

interface ChannelRow {
  id: string; channel_id: string; channel_type: ChatChannelType;
  scope_id: string | null; name: string | null; created_by: string;
  archived_at: Date | null; archived_reason: string | null;
  created_at: Date;
}
interface MemberRow {
  id: string; channel_id: string; participant_id: string;
  valid_from: Date; valid_to: Date | null;
}
interface MessageRow {
  id: string; channel_id: string; sender_id: string; content: string;
  mentions: UUID[] | null; attachments: ChatAttachment[] | null;
  reply_to_id: string | null; edited_at: Date | null; deleted_at: Date | null;
  created_at: Date;
}

function rowToChannel(r: ChannelRow): ChatChannel {
  return {
    id: r.id, channelId: r.channel_id, channelType: r.channel_type,
    scopeId: r.scope_id, name: r.name, createdBy: r.created_by,
    archivedAt: r.archived_at ? r.archived_at.toISOString() : null,
    archivedReason: r.archived_reason,
    createdAt: r.created_at.toISOString(),
  };
}
function rowToMember(r: MemberRow): ChatChannelMember {
  return {
    id: r.id, channelId: r.channel_id, participantId: r.participant_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
  };
}
function rowToMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id, channelId: r.channel_id, senderId: r.sender_id,
    content: r.content, mentions: r.mentions ?? [],
    attachments: r.attachments ?? [],
    replyToId: r.reply_to_id,
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

// -------- Проверка доступа --------

export async function canAccessChannel(
  participantId: UUID,
  channel: ChatChannel,
): Promise<{ allowed: boolean; reason?: string }> {
  if (channel.archivedAt) {
    return { allowed: false, reason: 'Канал архивирован' };
  }
  switch (channel.channelType) {
    case 'direct': {
      const parts = channel.channelId.split(':');
      if (parts.length !== 3) {return { allowed: false, reason: 'Malformed direct channel' };}
      return {
        allowed: parts[1] === participantId || parts[2] === participantId,
        reason: 'Не участник личного канала',
      };
    }
    case 'direction': {
      const row = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM participants
          WHERE id = $1 AND direction_id = $2 AND deleted_at IS NULL`,
        [participantId, channel.scopeId],
      );
      return row ? { allowed: true } : { allowed: false, reason: 'Не в направлении' };
    }
    case 'cell': {
      const row = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM cell_members
          WHERE cell_id = $1 AND participant_id = $2 AND valid_to IS NULL`,
        [channel.scopeId, participantId],
      );
      return row ? { allowed: true } : { allowed: false, reason: 'Не член ячейки' };
    }
    case 'council': {
      const row = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM council_members cm
          JOIN councils c ON c.id = cm.council_id
          WHERE cm.council_id = $1 AND cm.participant_id = $2
            AND cm.status = 'active'`,
        [channel.scopeId, participantId],
      );
      return row ? { allowed: true } : { allowed: false, reason: 'Не член Совета' };
    }
    case 'project': {
      // Упрощённо: любой активный участник, участвующий в задачах плана
      // или в lead-направлении плана.
      const row = await queryOne<{ c: number }>(
        `SELECT 1 AS c FROM plans p
          LEFT JOIN tasks t ON t.plan_id = p.id
          WHERE p.id = $1
            AND (
              p.lead_direction_id = (SELECT direction_id FROM participants WHERE id = $2)
              OR t.assigned_to = $2
            )
          LIMIT 1`,
        [channel.scopeId, participantId],
      );
      return row ? { allowed: true } : { allowed: false, reason: 'Нет доступа к проекту' };
    }
  }
}

// -------- Каналы --------

// P7: race-safe. Параллельный INSERT с тем же channel_id → UNIQUE violation
// → читаем существующий и возвращаем его.
export async function getOrCreateChannel(input: {
  channelId: string;
  channelType: ChatChannelType;
  scopeId?: UUID;
  name?: string;
  createdBy: UUID;
}): Promise<ChatChannel> {
  const existing = await queryOne<ChannelRow>(
    `SELECT id, channel_id, channel_type, scope_id, name, created_by,
            archived_at, archived_reason, created_at
       FROM chat_channels WHERE channel_id = $1`,
    [input.channelId],
  );
  if (existing) {return rowToChannel(existing);}

  const id = newUUID();
  let row: ChannelRow | undefined;
  try {
    const rows = await query<ChannelRow>(
      `INSERT INTO chat_channels
         (id, channel_id, channel_type, scope_id, name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, channel_id, channel_type, scope_id, name, created_by,
                 archived_at, archived_reason, created_at`,
      [id, input.channelId, input.channelType, input.scopeId ?? null, input.name ?? null, input.createdBy],
    );
    row = rows[0];
  } catch (e) {
    // Race: параллельный INSERT с тем же channel_id → UNIQUE violation.
    // Читаем существующий и возвращаем его.
    if (isUniqueViolation(e)) {
      const existingRace = await queryOne<ChannelRow>(
        `SELECT id, channel_id, channel_type, scope_id, name, created_by,
                archived_at, archived_reason, created_at
           FROM chat_channels WHERE channel_id = $1`,
        [input.channelId],
      );
      if (existingRace) {return rowToChannel(existingRace);}
    }
    throw e;
  }
  if (!row) {
    throw new Error('chat_channels: INSERT ... RETURNING не вернул строку');
  }

  await logAction({
    actorId: input.createdBy, actorType: 'participant',
    action: 'chat.channel_create',
    entityType: 'chat_channel', entityId: id,
    newValue: { channel_id: input.channelId, type: input.channelType },
  });

  return rowToChannel(row);
}

export async function getOrCreateDirectChannel(
  userA: UUID,
  userB: UUID,
): Promise<ChatChannel> {
  const channelId = normalizeDirectChannelId(userA, userB);
  return getOrCreateChannel({
    channelId,
    channelType: 'direct',
    createdBy: userA,
  });
}

export async function getOrCreateScopeChannel(
  type: 'direction' | 'cell' | 'council' | 'project',
  scopeId: UUID,
  by: UUID,
  name?: string,
): Promise<ChatChannel> {
  const channelId = formatScopeChannelId(type, scopeId);
  return getOrCreateChannel({
    channelId,
    channelType: type,
    scopeId,
    ...(name ? { name } : {}),
    createdBy: by,
  });
}

export async function getChannelById(id: UUID): Promise<ChatChannel> {
  const row = await queryOne<ChannelRow>(
    `SELECT id, channel_id, channel_type, scope_id, name, created_by,
            archived_at, archived_reason, created_at
       FROM chat_channels WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Канал', id);}
  return rowToChannel(row);
}

export async function getChannelByStringId(channelId: string): Promise<ChatChannel> {
  const row = await queryOne<ChannelRow>(
    `SELECT id, channel_id, channel_type, scope_id, name, created_by,
            archived_at, archived_reason, created_at
       FROM chat_channels WHERE channel_id = $1`,
    [channelId],
  );
  if (!row) {throw new NotFoundError('Канал', channelId);}
  return rowToChannel(row);
}

export async function listMyChannels(userId: UUID): Promise<ChatChannel[]> {
  // Мои каналы: явные membership + direction + cell + council.
  // Direct-каналы ищем по паттерну channel_id LIKE 'direct:<me>:%' OR 'direct:%:<me>'.
  const rows = await query<ChannelRow>(
    `SELECT DISTINCT c.id, c.channel_id, c.channel_type, c.scope_id, c.name,
            c.created_by, c.archived_at, c.archived_reason, c.created_at
       FROM chat_channels c
      WHERE c.archived_at IS NULL
        AND (
          -- Явное членство
          EXISTS (
            SELECT 1 FROM chat_channel_members m
             WHERE m.channel_id = c.id AND m.participant_id = $1 AND m.valid_to IS NULL
          )
          -- Прямой канал, где я один из двух
          OR c.channel_id LIKE 'direct:' || $1::text || ':%'
          OR c.channel_id LIKE 'direct:%:' || $1::text
          -- Канал направления
          OR (c.channel_type = 'direction' AND c.scope_id = (SELECT direction_id FROM participants WHERE id = $1))
          -- Канал ячейки
          OR (c.channel_type = 'cell' AND EXISTS (
                SELECT 1 FROM cell_members cm
                 WHERE cm.cell_id = c.scope_id AND cm.participant_id = $1 AND cm.valid_to IS NULL
              ))
          -- Канал Совета
          OR (c.channel_type = 'council' AND EXISTS (
                SELECT 1 FROM council_members cm
                 WHERE cm.council_id = c.scope_id AND cm.participant_id = $1 AND cm.status = 'active'
              ))
        )
      ORDER BY c.created_at DESC
      LIMIT 200`,
    [userId],
  );
  return rows.map(rowToChannel);
}

// -------- Участники группы --------

export async function joinChannel(
  channelDbId: UUID,
  participantId: UUID,
  by: UUID,
): Promise<ChatChannelMember> {
  const channel = await getChannelById(channelDbId);
  if (channel.channelType === 'direct') {
    throw new ConflictError('Нельзя вступить в личный канал');
  }
  if (channel.archivedAt) {throw new ConflictError('Канал архивирован');}

  const existing = await queryOne<MemberRow>(
    `SELECT id, channel_id, participant_id, valid_from, valid_to
       FROM chat_channel_members
      WHERE channel_id = $1 AND participant_id = $2 AND valid_to IS NULL`,
    [channelDbId, participantId],
  );
  if (existing) {return rowToMember(existing);}

  const id = newUUID();
  await query(
    `INSERT INTO chat_channel_members (id, channel_id, participant_id)
     VALUES ($1, $2, $3)`,
    [id, channelDbId, participantId],
  );

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'chat.channel_join',
    entityType: 'chat_channel', entityId: channelDbId,
    newValue: { participant_id: participantId },
  });

  await emitChatJoined(channel.channelId, participantId);

  return {
    id, channelId: channelDbId, participantId,
    validFrom: new Date().toISOString(), validTo: null,
  };
}

export async function leaveChannel(
  channelDbId: UUID,
  participantId: UUID,
  by: UUID,
): Promise<void> {
  const channel = await getChannelById(channelDbId);
  if (channel.channelType === 'direct') {
    throw new ConflictError('Из личного канала нельзя выйти');
  }

  await query(
    `UPDATE chat_channel_members SET valid_to = now()
      WHERE channel_id = $1 AND participant_id = $2 AND valid_to IS NULL`,
    [channelDbId, participantId],
  );

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'chat.channel_leave',
    entityType: 'chat_channel', entityId: channelDbId,
    newValue: { participant_id: participantId },
  });

  await emitChatLeft(channel.channelId, participantId);
}

export async function listChannelMembers(channelDbId: UUID): Promise<ChatChannelMember[]> {
  const rows = await query<MemberRow>(
    `SELECT id, channel_id, participant_id, valid_from, valid_to
       FROM chat_channel_members
      WHERE channel_id = $1 AND valid_to IS NULL
      ORDER BY valid_from`,
    [channelDbId],
  );
  return rows.map(rowToMember);
}

// Rich-вариант: с именем и external_id участника.
// Нужен для автокомплита упоминаний в Composer (F.4.05.05) — попап
// показывает не UUID, а человекочитаемое имя.

export interface ChannelMemberRich {
  id: UUID;
  channelId: UUID;
  participantId: UUID;
  validFrom: ISODateTime;
  validTo: ISODateTime | null;
  name: string | null;
  externalId: string | null;
  pseudonym: string | null;
}

export async function listChannelMembersRich(channelDbId: UUID): Promise<ChannelMemberRich[]> {
  const rows = await query<{
    id: string; channel_id: string; participant_id: string;
    valid_from: Date; valid_to: Date | null;
    name: string | null; external_id: string | null; pseudonym: string | null;
  }>(
    `SELECT m.id, m.channel_id, m.participant_id, m.valid_from, m.valid_to,
            p.name, p.external_id, p.pseudonym
       FROM chat_channel_members m
       LEFT JOIN participants p ON p.id = m.participant_id
      WHERE m.channel_id = $1 AND m.valid_to IS NULL
      ORDER BY m.valid_from`,
    [channelDbId],
  );
  return rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    participantId: r.participant_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
    name: r.name,
    externalId: r.external_id,
    pseudonym: r.pseudonym,
  }));
}

// -------- Сообщения --------

export async function sendMessage(input: {
  channelStringId: string;
  senderId: UUID;
  content: string;
  mentions?: UUID[];
  attachments?: ChatAttachment[];
  replyToId?: UUID;
}): Promise<ChatMessage> {
  const channel = await getChannelByStringId(input.channelStringId);
  // P6: 403 для «нет доступа» (было 409).
  const access = await canAccessChannel(input.senderId, channel);
  if (!access.allowed) {
    throw new ForbiddenError(access.reason ?? 'Нет доступа к каналу');
  }

  // reply_to_id: проверяем, что родитель существует и в том же канале.
  // Без этого INSERT падает на FK-constraint и уходит как 500 — а это
  // доменная ошибка (409).
  if (input.replyToId) {
    const parent = await queryOne<{ channel_id: string }>(
      `SELECT channel_id FROM chat_messages WHERE id = $1`,
      [input.replyToId],
    );
    if (!parent) {
      throw new ConflictError('Родительское сообщение не найдено');
    }
    if (parent.channel_id !== channel.id) {
      throw new ConflictError('Нельзя отвечать на сообщение из другого канала');
    }
  }

  const id = newUUID();
  const entity = createMessage({
    id,
    channelId: channel.id,
    senderId: input.senderId,
    content: input.content,
    ...(input.mentions ? { mentions: input.mentions } : {}),
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.replyToId ? { replyToId: input.replyToId } : {}),
  });

  await query(
    `INSERT INTO chat_messages
       (id, channel_id, sender_id, content, mentions, attachments, reply_to_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entity.id, entity.channelId, entity.senderId, entity.content,
      JSON.stringify(entity.mentions), JSON.stringify(entity.attachments),
      entity.replyToId,
    ],
  );

  // Кэш в Redis — 100 последних.
  try {
    const key = RECENT_KEY(channel.channelId);
    await redis
      .multi()
      .lpush(key, JSON.stringify(entity))
      .ltrim(key, 0, RECENT_MAX - 1)
      .expire(key, RECENT_TTL_SEC)
      .exec();
  } catch {
    // best-effort
  }

  // Аудит: только для официальных каналов (I.1.2).
  if (channel.channelType !== 'direct') {
    await logAction({
      actorId: input.senderId, actorType: 'participant',
      action: 'chat.message_send',
      entityType: 'chat_message', entityId: entity.id,
      newValue: { channel: channel.channelId, length: entity.content.length },
    });
  }

  // WS-эмиссия: broadcast в комнату канала.
  await emitChatMessage(channel.channelId, entity);

  // Персональные упоминания.
  for (const mentionedId of entity.mentions) {
    await emitChatMention(channel.channelId, mentionedId, entity);
  }

  return entity;
}

export async function getMessageById(id: UUID): Promise<ChatMessage> {
  const row = await queryOne<MessageRow>(
    `SELECT id, channel_id, sender_id, content, mentions, attachments,
            reply_to_id, edited_at, deleted_at, created_at
       FROM chat_messages WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Сообщение', id);}
  return rowToMessage(row);
}

export async function editMessageService(
  messageId: UUID,
  newContent: string,
  userId: UUID,
): Promise<ChatMessage> {
  const m = await getMessageById(messageId);
  if (!canEditMessage(m, userId)) {
    throw new ConflictError('Редактировать может только автор');
  }
  const updated = editMessage(m, newContent);

  await query(
    `UPDATE chat_messages SET content = $1, edited_at = now() WHERE id = $2`,
    [updated.content, messageId],
  );

  const channel = await getChannelById(m.channelId);

  if (channel.channelType !== 'direct') {
    await logAction({
      actorId: userId, actorType: 'participant',
      action: 'chat.message_edit',
      entityType: 'chat_message', entityId: messageId,
      oldValue: { content: m.content },
      newValue: { content: updated.content },
    });
  }

  await emitChatMessageEdited(channel.channelId, updated);
  return updated;
}

export async function deleteMessageService(
  messageId: UUID,
  userId: UUID,
): Promise<void> {
  const m = await getMessageById(messageId);

  // Раздельные проверки: сначала автор, потом — не удалено.
  // canEditMessage совмещает оба условия, из-за чего при повторном удалении
  // автор получал бы «Удалить может только автор» вместо «Уже удалено».
  if (m.senderId !== userId) {
    throw new ConflictError('Удалить может только автор');
  }
  if (m.deletedAt) {
    throw new ConflictError('Уже удалено');
  }

  await query(
    `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`,
    [messageId],
  );

  const channel = await getChannelById(m.channelId);

  if (channel.channelType !== 'direct') {
    await logAction({
      actorId: userId, actorType: 'participant',
      action: 'chat.message_delete',
      entityType: 'chat_message', entityId: messageId,
    });
  }

  await emitChatMessageDeleted(channel.channelId, messageId, userId);
}

// P5: архивировать может только создатель канала.
export async function archiveChannel(
  channelDbId: UUID,
  reason: string,
  by: UUID,
): Promise<ChatChannel> {
  if (!reason.trim()) {throw new ConflictError('Причина обязательна');}
  const channel = await getChannelById(channelDbId);
  if (channel.channelType === 'direct') {
    throw new ConflictError('Личные каналы не архивируются');
  }

  // Архивировать может только создатель канала. Для scope-каналов это
  // первый, кто вызвал getOrCreateScopeChannel. Roadmap: расширить —
  // role-based (COUNCIL_MEMBER для direction/council и т.д.).
  if (channel.createdBy !== by) {
    throw new ForbiddenError('Архивировать канал может только его создатель');
  }

  await query(
    `UPDATE chat_channels
        SET archived_at = now(), archived_reason = $1
      WHERE id = $2`,
    [reason, channelDbId],
  );

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'chat.channel_archive',
    entityType: 'chat_channel', entityId: channelDbId,
    newValue: { reason },
  });

  await emitChatChannelArchived(channel.channelId, reason);

  return { ...channel, archivedAt: new Date().toISOString(), archivedReason: reason };
}

// -------- Rich-варианты для UI --------
//
// Список каналов и история сообщений в сыром виде содержат только UUID:
//   - listMyChannels: displayName отсутствует; direct-канал — это `direct:<a>:<b>`,
//     непонятно, кто собеседник;
//   - getChannelHistoryRich: senderId — UUID, replyToId — UUID, ни имени, ни текста
//     родительского сообщения.
//
// Rich-функции обогащают это одним-двумя JOIN-ами. Цена — чуть больше SQL,
// но UI не делает N+1 запросов на каждый бабл.

export interface ChannelListItem {
  id: UUID;
  channelId: string;
  channelType: ChatChannelType;
  scopeId: UUID | null;
  name: string | null;
  displayName: string;
  peerId: UUID | null;
  peerName: string | null;
  peerExternalId: string | null;
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  lastMessage: {
    id: UUID;
    senderId: UUID;
    content: string;
    createdAt: ISODateTime;
  } | null;
}

export async function listMyChannelsRich(userId: UUID): Promise<ChannelListItem[]> {
  const channels = await listMyChannels(userId);
  if (channels.length === 0) {return [];}

  const enriched = await Promise.all(channels.map(async (ch) => {
    let displayName: string = ch.name ?? ch.channelId;
    let peerId: UUID | null = null;
    let peerName: string | null = null;
    let peerExternalId: string | null = null;

    if (ch.channelType === 'direct') {
      const parts = ch.channelId.split(':');
      const other = parts[1] === userId ? parts[2] : parts[1];
      if (other) {
        peerId = other;
        const p = await queryOne<{ name: string; external_id: string }>(
          `SELECT name, external_id FROM participants WHERE id = $1`,
          [other],
        );
        if (p) {
          peerName = p.name;
          peerExternalId = p.external_id;
          displayName = p.name;
        }
      }
    } else if (ch.channelType === 'direction' && ch.scopeId) {
      const d = await queryOne<{ number: number; name: string }>(
        `SELECT number, name FROM directions WHERE id = $1`,
        [ch.scopeId],
      );
      if (d) {displayName = `№${d.number} — ${d.name}`;}
    } else if (ch.channelType === 'cell' && ch.scopeId) {
      const c = await queryOne<{ level: number; number: string; profile: string | null }>(
        `SELECT level, number, profile FROM cells WHERE id = $1`,
        [ch.scopeId],
      );
      if (c) {displayName = `Ячейка ${c.level}×5-${c.number}${c.profile ? ` (${c.profile})` : ''}`;}
    } else if (ch.channelType === 'council' && ch.scopeId) {
      const d = await queryOne<{ number: number; name: string }>(
        `SELECT d.number, d.name
           FROM councils c JOIN directions d ON d.id = c.direction_id
          WHERE c.id = $1`,
        [ch.scopeId],
      );
      if (d) {displayName = `Совет №${d.number} — ${d.name}`;}
    } else if (ch.channelType === 'project' && ch.scopeId) {
      const p = await queryOne<{ title: string }>(
        `SELECT title FROM plans WHERE id = $1`,
        [ch.scopeId],
      );
      if (p) {displayName = p.title;}
    }

    // Last message: сначала Redis-кэш, если пусто — БД LIMIT 1.
    let lastMessage: ChannelListItem['lastMessage'] = null;
    try {
      const raw = await redis.lindex(RECENT_KEY(ch.channelId), 0);
      if (raw) {
        const m = JSON.parse(raw) as ChatMessage;
        lastMessage = {
          id: m.id, senderId: m.senderId,
          content: m.content.slice(0, 120), createdAt: m.createdAt,
        };
      }
    } catch {/* ignore */}
    if (!lastMessage) {
      const row = await queryOne<{ id: string; sender_id: string; content: string; created_at: Date }>(
        `SELECT id, sender_id, content, created_at
           FROM chat_messages
          WHERE channel_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        [ch.id],
      );
      if (row) {
        lastMessage = {
          id: row.id, senderId: row.sender_id,
          content: row.content.slice(0, 120), createdAt: row.created_at.toISOString(),
        };
      }
    }

    return {
      id: ch.id, channelId: ch.channelId, channelType: ch.channelType,
      scopeId: ch.scopeId, name: ch.name, displayName,
      peerId, peerName, peerExternalId,
      archivedAt: ch.archivedAt, createdAt: ch.createdAt,
      lastMessage,
    };
  }));

  // Свежие сверху (по lastMessage или createdAt канала).
  return enriched.sort((a, b) => {
    const aT = a.lastMessage?.createdAt ?? a.createdAt;
    const bT = b.lastMessage?.createdAt ?? b.createdAt;
    return bT.localeCompare(aT);
  });
}

export interface ChatMessageRich extends ChatMessage {
  senderName: string | null;
  senderExternalId: string | null;
  replyTo: {
    id: UUID;
    senderId: UUID;
    content: string;
  } | null;
}

export async function getChannelHistoryRich(
  channelStringId: string,
  requesterId: UUID,
  limit = 50,
  before?: string,
): Promise<ChatMessageRich[]> {
  const channel = await getChannelByStringId(channelStringId);
  // P6: 403 для «нет доступа» (было 409).
  const access = await canAccessChannel(requesterId, channel);
  if (!access.allowed) {
    throw new ForbiddenError(access.reason ?? 'Нет доступа к каналу');
  }

  const params: unknown[] = [channel.id];
  let where = `m.channel_id = $1`;
  if (before) {
    params.push(before);
    where += ` AND m.created_at < $${params.length}`;
  }
  params.push(limit);

  const rows = await query<{
    id: string; channel_id: string; sender_id: string; content: string;
    mentions: UUID[] | null; attachments: ChatAttachment[] | null;
    reply_to_id: string | null; edited_at: Date | null; deleted_at: Date | null;
    created_at: Date;
    sender_name: string | null; sender_external_id: string | null;
    reply_sender_id: string | null; reply_content: string | null;
  }>(
    `SELECT m.id, m.channel_id, m.sender_id, m.content, m.mentions, m.attachments,
            m.reply_to_id, m.edited_at, m.deleted_at, m.created_at,
            p.name AS sender_name, p.external_id AS sender_external_id,
            rm.sender_id AS reply_sender_id, rm.content AS reply_content
       FROM chat_messages m
       LEFT JOIN participants p ON p.id = m.sender_id
       LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    channelId: r.channel_id,
    senderId: r.sender_id,
    content: r.deleted_at ? '' : r.content,
    mentions: r.mentions ?? [],
    attachments: r.attachments ?? [],
    replyToId: r.reply_to_id,
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    senderName: r.sender_name,
    senderExternalId: r.sender_external_id,
    replyTo: r.reply_to_id && r.reply_content !== null
      ? { id: r.reply_to_id, senderId: r.reply_sender_id ?? '', content: r.reply_content.slice(0, 200) }
      : null,
  }));
}