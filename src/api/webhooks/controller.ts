// A.1.97.01 — Контроллер Webhooks.
// 9 эндпоинтов: CRUD + test + deliveries + retry + events + process-retries.
//
// Порядок регистрации КРИТИЧЕН: /webhooks/events и /webhooks/process-retries
// должны идти ДО /webhooks/:id, иначе Fastify поймает "events" и
// "process-retries" как UUID.
//
// Права: webhook (V/C/E/D/Act). Доступ: FIRST_ARCHITECT, PROTOCOL_COUNCIL,
// VERIFIER (только V). См. C.0.01.06 FALLBACK_PERMISSIONS.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  listDeliveries,
  retryDelivery,
  processRetries,
  rotateWebhookSecret,
  ALLOWED_EVENTS,
} from '../../core/webhooks/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

const idParams = z.object({ id: uuidSchema });

const deliveryParams = z.object({
  id: uuidSchema,
  delivery_id: uuidSchema,
});

const createBody = z.object({
  url: z.string().url('Некорректный URL').max(2048),
  events: z
    .array(z.enum(ALLOWED_EVENTS as unknown as [string, ...string[]]))
    .min(1, 'Хотя бы одно событие')
    .max(ALLOWED_EVENTS.length),
  secret: z.string().min(16).max(128).optional(),
});

const updateBody = z.object({
  url: z.string().url('Некорректный URL').max(2048).optional(),
  events: z
    .array(z.enum(ALLOWED_EVENTS as unknown as [string, ...string[]]))
    .min(1)
    .max(ALLOWED_EVENTS.length)
    .optional(),
  active: z.boolean().optional(),
});

const deliveriesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerWebhooksRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── ВАЖНО: статические роуты ДО /:id ────────────────────────

  // GET /webhooks/events — список доступных событий.
  app.get(
    '/webhooks/events',
    { preHandler: [authMiddleware, requireRight('webhook', 'V')] },
    async (req, reply) => {
      reply.send({ data: ALLOWED_EVENTS, audit_id: req.auditId });
    },
  );

  // POST /webhooks/process-retries — cron.
  app.post(
    '/webhooks/process-retries',
    { preHandler: [authMiddleware, requireRight('webhook', 'Act')] },
    async (req, reply) => {
      const result = await processRetries();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // ─── Список ──────────────────────────────────────────────────

  // GET /webhooks
  app.get(
    '/webhooks',
    { preHandler: [authMiddleware, requireRight('webhook', 'V')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const items = await listWebhooks(auth.participantId);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // ─── Создание ────────────────────────────────────────────────

  // POST /webhooks
  app.post(
    '/webhooks',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'C'),
        validateBody(createBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const w = await createWebhook(
        {
          url: b.url,
          events: b.events,
          ...(b.secret ? { secret: b.secret } : {}),
        },
        auth.participantId,
      );
      // Секрет возвращаем только при создании — потом он недоступен.
      reply.status(201).send({ ...w, audit_id: req.auditId });
    },
  );

  // ─── Конкретный webhook ──────────────────────────────────────

  // PATCH /webhooks/:id
  app.patch(
    '/webhooks/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'E'),
        validateParams(idParams),
        validateBody(updateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof updateBody>;
      const patch: { url?: string; events?: string[]; active?: boolean } = {};
      if (b.url !== undefined) {patch.url = b.url;}
      if (b.events !== undefined) {patch.events = b.events;}
      if (b.active !== undefined) {patch.active = b.active;}
      const w = await updateWebhook(p.id, patch, auth.participantId);
      reply.send({ ...w, audit_id: req.auditId });
    },
  );

  // DELETE /webhooks/:id → 204
  app.delete(
    '/webhooks/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'D'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      await deleteWebhook(p.id, auth.participantId);
      reply.status(204).send();
    },
  );

  // POST /webhooks/:id/test
  app.post(
    '/webhooks/:id/test',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'E'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const r = await testWebhook(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /webhooks/:id/deliveries
  app.get(
    '/webhooks/:id/deliveries',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'V'),
        validateParams(idParams),
        validateQuery(deliveriesQuery),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const q = req.query as z.infer<typeof deliveriesQuery>;
      const result = await listDeliveries(p.id, q.page, q.per_page);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /webhooks/:id/retry/:delivery_id
  app.post(
    '/webhooks/:id/retry/:delivery_id',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'E'),
        validateParams(deliveryParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof deliveryParams>;
      const r = await retryDelivery(p.id, p.delivery_id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // POST /webhooks/:id/rotate-secret — новый секрет (показывается один раз).
  app.post(
    '/webhooks/:id/rotate-secret',
    {
      preHandler: [
        authMiddleware,
        requireRight('webhook', 'E'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const r = await rotateWebhookSecret(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

}