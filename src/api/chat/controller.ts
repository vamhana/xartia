// A.1.36.01 — Chat API.
// Каналы (direct/direction/cell/council/project), сообщения, участники.
// GET /chat/channels отдаёт rich-форму (listMyChannelsRich), история
// сообщений — GET /chat/channels/:id/messages (getChannelHistoryRich).
// POST /chat/channels/:id/messages возвращает сырой ChatMessage —
// без senderName/senderExternalId/replyTo, это только для GET-истории.
//
// v0.0.02:
//   - P1: GET /channels/:id — canAccessChannel(auth, ch), 403 если нет доступа.
//   - P2: GET /channels/:id/members — то же.
//   - P3: GET /messages/:id — проверка доступа к каналу сообщения.
//   - P4: POST /channels/:id/join — для не-direct каналов canAccessChannel,
//         direct → сервис вернёт 409 (нельзя «вступить» в личный канал).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getOrCreateDirectChannel,
  getOrCreateScopeChannel,
  getChannelById,
  getChannelByStringId,

  joinChannel,
  leaveChannel,
  listChannelMembersRich,
  sendMessage,

  getMessageById,
  editMessageService,
  deleteMessageService,
  archiveChannel,
  canAccessChannel,
  listMyChannelsRich,
  getChannelHistoryRich,
} from '../../core/chat/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const idParams = z.object({ id: uuidSchema });

const msgParams = z.object({ id: uuidSchema });

const directBody = z.object({
  participant_id: uuidSchema,
});

const scopeBody = z.object({
  name: z.string().min(1).max(255).optional(),
});

const sendBody = z.object({
  content: z.string().min(1).max(10000),
  mentions: z.array(uuidSchema).max(50).optional(),
  attachments: z.array(z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    size: z.number().int().min(0).max(100 * 1024 * 1024),
    mime: z.string().min(1),
  })).max(10).optional(),
  reply_to_id: uuidSchema.optional(),
});

const editBody = z.object({
  content: z.string().min(1).max(10000),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

const archiveBody = z.object({
  reason: z.string().min(1).max(2000),
});

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  // GET /chat/channels — мои каналы (rich)
  app.get(
    '/chat/channels',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const items = await listMyChannelsRich(auth.participantId);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/direct — получить или создать личный канал
  app.post(
    '/chat/channels/direct',
    { preHandler: [authMiddleware, validateBody(directBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof directBody>;
      const ch = await getOrCreateDirectChannel(auth.participantId, b.participant_id);
      reply.status(201).send({ ...ch, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/direction/:id
  app.post(
    '/chat/channels/direction/:id',
    {
      preHandler: [authMiddleware, validateParams(idParams), validateBody(scopeBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof scopeBody>;
      const ch = await getOrCreateScopeChannel('direction', p.id, auth.participantId, b.name);
      reply.status(201).send({ ...ch, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/cell/:id
  app.post(
    '/chat/channels/cell/:id',
    {
      preHandler: [authMiddleware, validateParams(idParams), validateBody(scopeBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof scopeBody>;
      const ch = await getOrCreateScopeChannel('cell', p.id, auth.participantId, b.name);
      reply.status(201).send({ ...ch, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/council/:id
  app.post(
    '/chat/channels/council/:id',
    {
      preHandler: [authMiddleware, validateParams(idParams), validateBody(scopeBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof scopeBody>;
      const ch = await getOrCreateScopeChannel('council', p.id, auth.participantId, b.name);
      reply.status(201).send({ ...ch, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/project/:id
  app.post(
    '/chat/channels/project/:id',
    {
      preHandler: [authMiddleware, validateParams(idParams), validateBody(scopeBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof scopeBody>;
      const ch = await getOrCreateScopeChannel('project', p.id, auth.participantId, b.name);
      reply.status(201).send({ ...ch, audit_id: req.auditId });
    },
  );

  // GET /chat/channels/:id — по внутреннему UUID (P1: access-check)
  app.get(
    '/chat/channels/:id',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const ch = await getChannelById(p.id);
      const access = await canAccessChannel(auth.participantId, ch);
      if (!access.allowed) {
        reply.status(403).send({
          code: 'FORBIDDEN',
          message: access.reason,
          audit_id: req.auditId,
        });
        return;
      }
      reply.send({ ...ch, audit_id: req.auditId });
    },
  );

  // GET /chat/channels/:id/members (P2: access-check)
  app.get(
    '/chat/channels/:id/members',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const ch = await getChannelById(p.id);
      const access = await canAccessChannel(auth.participantId, ch);
      if (!access.allowed) {
        reply.status(403).send({
          code: 'FORBIDDEN',
          message: access.reason,
          audit_id: req.auditId,
        });
        return;
      }
      const items = await listChannelMembersRich(p.id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/:id/join (P4: access-check, кроме direct)
  app.post(
    '/chat/channels/:id/join',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const ch = await getChannelById(p.id);
      // direct → сервис вернёт 409 (joinChannel отклоняет direct).
      // Для остальных — canAccessChannel: нельзя вступить в чужой
      // direction/cell/council/project канал.
      if (ch.channelType !== 'direct') {
        const access = await canAccessChannel(auth.participantId, ch);
        if (!access.allowed) {
          reply.status(403).send({
            code: 'FORBIDDEN',
            message: access.reason,
            audit_id: req.auditId,
          });
          return;
        }
      }
      const m = await joinChannel(p.id, auth.participantId, auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/:id/leave
  app.post(
    '/chat/channels/:id/leave',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      await leaveChannel(p.id, auth.participantId, auth.participantId);
      reply.status(204).send();
    },
  );

  // POST /chat/channels/:id/archive
  app.post(
    '/chat/channels/:id/archive',
    {
      preHandler: [authMiddleware, validateParams(idParams), validateBody(archiveBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof archiveBody>;
      const ch = await archiveChannel(p.id, b.reason, auth.participantId);
      reply.send({ ...ch, audit_id: req.auditId });
    },
  );

  // GET /chat/channels/:id/messages — rich-история
  app.get(
    '/chat/channels/:id/messages',
    {
      preHandler: [
        authMiddleware,
        validateParams(idParams),
        validateQuery(historyQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const q = req.query as z.infer<typeof historyQuery>;
      const ch = await getChannelById(p.id);
      const items = await getChannelHistoryRich(ch.channelId, auth.participantId, q.limit, q.before);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /chat/channels/:id/messages
  app.post(
    '/chat/channels/:id/messages',
    {
      preHandler: [
        authMiddleware,
        validateParams(idParams),
        validateBody(sendBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof sendBody>;
      const ch = await getChannelById(p.id);
      const msg = await sendMessage({
        channelStringId: ch.channelId,
        senderId: auth.participantId,
        content: b.content,
        ...(b.mentions ? { mentions: b.mentions } : {}),
        ...(b.attachments ? { attachments: b.attachments } : {}),
        ...(b.reply_to_id ? { replyToId: b.reply_to_id } : {}),
      });
      reply.status(201).send({ ...msg, audit_id: req.auditId });
    },
  );

  // PATCH /chat/messages/:id
  app.patch(
    '/chat/messages/:id',
    {
      preHandler: [authMiddleware, validateParams(msgParams), validateBody(editBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof msgParams>;
      const b = req.body as z.infer<typeof editBody>;
      const msg = await editMessageService(p.id, b.content, auth.participantId);
      reply.send({ ...msg, audit_id: req.auditId });
    },
  );

  // DELETE /chat/messages/:id
  app.delete(
    '/chat/messages/:id',
    { preHandler: [authMiddleware, validateParams(msgParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof msgParams>;
      await deleteMessageService(p.id, auth.participantId);
      reply.status(204).send();
    },
  );

  // GET /chat/messages/:id (P3: access-check к каналу сообщения)
  app.get(
    '/chat/messages/:id',
    { preHandler: [authMiddleware, validateParams(msgParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof msgParams>;
      const msg = await getMessageById(p.id);
      const ch = await getChannelById(msg.channelId);
      const access = await canAccessChannel(auth.participantId, ch);
      if (!access.allowed) {
        reply.status(403).send({
          code: 'FORBIDDEN',
          message: access.reason,
          audit_id: req.auditId,
        });
        return;
      }
      reply.send({ ...msg, audit_id: req.auditId });
    },
  );

  // GET /chat/channels/by-string/:channel_id
  //   для клиента, знающего строковый ID (например, WS-канал)
  app.get(
    '/chat/channels/by-string/:channel_id',
    { preHandler: [authMiddleware] },
    async (req, reply) => {
      const p = req.params as { channel_id: string };
      const ch = await getChannelByStringId(decodeURIComponent(p.channel_id));
      const auth = getAuthContext(req);
      const access = await canAccessChannel(auth.participantId, ch);
      if (!access.allowed) {
        reply.status(403).send({ code: 'FORBIDDEN', message: access.reason, audit_id: req.auditId });
        return;
      }
      reply.send({ ...ch, audit_id: req.auditId });
    },
  );
}