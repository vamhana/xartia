// A.1.95.01 — Контроллер Search.
// Универсальный поиск (I.1.10). Только чтение.
//
// Права: НЕ requireRight. Доступ — любой авторизованный.
// Приватность: PII (phone, messengers, password_hash) НЕ возвращаем.
// /search/participants отдаёт ParticipantBrief вместо Participant[].
//
// Порядок регистрации не критичен — все роуты статические (нет :id),
// но для читаемости сначала универсальный, потом по типам, в конце
// suggestions.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  searchAll,
  searchParticipants,
  searchSignals,
  searchGoods,
  searchArchive,
  searchTasks,
  getSuggestions,
} from '../../core/search/service.js';
import {
  searchQuerySchema,
  uuidSchema,
  prioritySchema,
  taskStatusSchema,
} from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validation.js';

// ─── Схемы для отдельных эндпоинтов ─────────────────────────────

const participantsQuery = z.object({
  q: z.string().min(1).max(200),
  by: z.enum(['id', 'name', 'external_id']).optional(),
});

const signalsQuery = z.object({
  q: z.string().min(2).max(200),
  priority: prioritySchema.optional(),
});

const goodsQuery = z.object({
  q: z.string().min(2).max(200),
  type: z.enum(['material', 'nonmaterial']).optional(),
});

const archiveQuery = z.object({
  q: z.string().min(2).max(200),
  direction_id: uuidSchema.optional(),
});

const tasksQuery = z.object({
  q: z.string().min(2).max(200),
  status: taskStatusSchema.optional(),
});

const suggestionsQuery = z.object({
  q: z.string().min(1).max(100),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerSearchRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── Универсальный поиск ────────────────────────────────────

  // GET /search
  app.get(
    '/search',
    {
      preHandler: [authMiddleware, validateQuery(searchQuerySchema)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof searchQuerySchema>;

      const options: Parameters<typeof searchAll>[1] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.types) {options.types = q.types;}
      if (q.direction_id) {options.directionId = q.direction_id;}

      const result = await searchAll(q.q, options, auth.participantId);

      reply.send({
        results: result.results,
        total: result.total,
        meta: {
          page: q.page,
          per_page: q.per_page,
          total: result.total,
        },
        audit_id: req.auditId,
      });
    },
  );

  // ─── Поиск по типам ────────────────────────────────────────

  // GET /search/participants
  app.get(
    '/search/participants',
    {
      preHandler: [authMiddleware, validateQuery(participantsQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof participantsQuery>;
      const data = await searchParticipants(
        q.q,
        q.by,
        auth.participantId,
      );
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /search/signals
  app.get(
    '/search/signals',
    {
      preHandler: [authMiddleware, validateQuery(signalsQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof signalsQuery>;
      const data = await searchSignals(q.q, q.priority, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /search/goods
  app.get(
    '/search/goods',
    {
      preHandler: [authMiddleware, validateQuery(goodsQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof goodsQuery>;
      const data = await searchGoods(q.q, q.type, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /search/archive
  app.get(
    '/search/archive',
    {
      preHandler: [authMiddleware, validateQuery(archiveQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof archiveQuery>;
      const data = await searchArchive(q.q, q.direction_id, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /search/tasks
  app.get(
    '/search/tasks',
    {
      preHandler: [authMiddleware, validateQuery(tasksQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof tasksQuery>;
      const data = await searchTasks(q.q, q.status, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Подсказки ─────────────────────────────────────────────

  // GET /search/suggestions
  app.get(
    '/search/suggestions',
    {
      preHandler: [authMiddleware, validateQuery(suggestionsQuery)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof suggestionsQuery>;
      const data = await getSuggestions(q.q, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );
}