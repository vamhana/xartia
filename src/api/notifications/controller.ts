// src/api/notifications/controller.ts
/**
 * A.1.96.01 — Notifications controller.
 *
 * Preferences, devices, history, test.
 *
 * ОТЛИЧИЯ ОТ СТАРОЙ СПЕКИ:
 * - DELETE /devices/:id — id = device_token (URI-encoded), а не UUID.
 *   Причина: L.0.01.10 хранит devices в Redis-списке без явных id.
 * - GET /history возвращает { data, meta } вместо Paginated<T>.
 *   Причина: L.0.01.10 getHistory отдаёт готовый список из Redis LPUSH.
 * - PUT /preferences Body = Record<string, boolean>, не { preferences }.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../core/errors.js';
import {
  send,
  getHistory,
  registerDevice,
  unregisterDevice,
  getDevices,
  getPreferences,
  setPreferences,
} from '../../lib/notifications.js';
import type { NotificationChannel } from '../../lib/notifications.js';
import {
  markReadAndEmit,
  markAllReadAndEmit,
} from '../../ws/notifications.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Zod-схемы ───────────────────────────────────────────────────

const preferencesBody = z.record(z.boolean());

const deviceBody = z.object({
  device_token: z.string().min(1).max(512),
  platform: z.enum(['ios', 'android']),
});

const deviceParams = z.object({
  id: z.string().min(1).max(512), // device_token, URI-encoded
});

const historyQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const testBody = z.object({
  channel: z.enum(['ws', 'email', 'telegram', 'whatsapp']),
});

const notifParams = z.object({
  id: z.string().min(1).max(128),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerNotificationsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── GET /notifications/preferences ────────────────────────────
  app.get(
    '/notifications/preferences',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const preferences = await getPreferences(ctx.participantId);
      return reply.send({ preferences, audit_id: request.auditId });
    },
  );

  // ─── PUT /notifications/preferences ────────────────────────────
  app.put<{ Body: z.infer<typeof preferencesBody> }>(
    '/notifications/preferences',
    { preHandler: [authMiddleware, validateBody(preferencesBody)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const preferences = await setPreferences(ctx.participantId, request.body);
      return reply.send({ preferences, audit_id: request.auditId });
    },
  );

  // ─── GET /notifications/devices ────────────────────────────────
  app.get(
    '/notifications/devices',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const devices = await getDevices(ctx.participantId);
      return reply.send({ devices, audit_id: request.auditId });
    },
  );

  // ─── POST /notifications/devices ───────────────────────────────
  app.post<{ Body: z.infer<typeof deviceBody> }>(
    '/notifications/devices',
    { preHandler: [authMiddleware, validateBody(deviceBody)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      await registerDevice(
        ctx.participantId,
        request.body.device_token,
        request.body.platform,
      );
      return reply.status(201).send({
        device_id: request.body.device_token,
        audit_id: request.auditId,
      });
    },
  );

  // ─── PATCH /notifications/read-all ─────────────────────────────
  // ВАЖНО: регистрируется ДО /:id/read, чтобы "read-all" не матчился как :id
  app.patch(
    '/notifications/read-all',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const result = await markAllReadAndEmit(ctx.participantId);
      return reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // ─── PATCH /notifications/:id/read ─────────────────────────────
  app.patch<{ Params: { id: string } }>(
    '/notifications/:id/read',
    { preHandler: [authMiddleware, validateParams(notifParams)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const id = request.params.id;
      const result = await markReadAndEmit(ctx.participantId, [id]);
      return reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // ─── DELETE /notifications/devices/:id ─────────────────────────
  // id = device_token (URI-encoded)
  app.delete<{ Params: { id: string } }>(
    '/notifications/devices/:id',
    { preHandler: [authMiddleware, validateParams(deviceParams)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const token = decodeURIComponent(request.params.id);
      const devices = await getDevices(ctx.participantId);
      const exists = devices.find((d) => d.token === token);
      if (!exists) {
        throw new AppError('NOT_FOUND', 'Device not found', 404);
      }
      await unregisterDevice(ctx.participantId, token);
      return reply.status(204).send();
    },
  );

  // ─── GET /notifications/history ────────────────────────────────
  app.get<{ Querystring: z.infer<typeof historyQuery> }>(
    '/notifications/history',
    { preHandler: [authMiddleware, validateQuery(historyQuery)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const limit = request.query.per_page;
      const all = await getHistory(ctx.participantId, limit);
      const start = (request.query.page - 1) * limit;
      const data = all.slice(start, start + limit);
      return reply.send({
        data,
        meta: {
          page: request.query.page,
          per_page: limit,
          total: all.length,
        },
        audit_id: request.auditId,
      });
    },
  );



  // ─── POST /notifications/test ──────────────────────────────────
  app.post<{ Body: z.infer<typeof testBody> }>(
    '/notifications/test',
    { preHandler: [authMiddleware, validateBody(testBody)] },
    async (request, reply) => {
      const ctx = getAuthContext(request);
      const channel = request.body.channel as NotificationChannel;
      const result = await send({
        recipientId: ctx.participantId,
        type: 'test.notification',
        priority: 'standard',
        title: 'Тестовое уведомление',
        body: `Проверка канала ${channel}`,
        channels: [channel],
      });
      return reply.send({
        sent: result.delivered.includes(channel),
        delivered: result.delivered,
        failed: result.failed,
        audit_id: request.auditId,
      });
    },
  );
}