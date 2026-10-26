// A.1.02.01 — Контроллер Participants
// Паспорт, обновление профиля, список.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - GET /me → getById (короткий Participant); GET /me/passport → getPassport
//     (PassportFull). Различие восстановлено по старой спеке.
//   - GET /participants — requireRight('participant','V') (было только auth).
//   - GET /participants/:id — requireRight('participant','V', extractor) +
//     validateParams (было inline idParamsSchema.parse()).
//   - Убран misleading-комментарий «только для Архитектора» — доступно всем
//     ролям с participant:V (все активные роли).
//   - /me* сознательно без requireRight: доступ к себе — базовая операция,
//     должна работать для PAUSED/OUTSIDE_TRUST/REMOTE (иначе они не увидят
//     свой статус и не смогут привязать messenger для recovery).
//
// НЕ ТЕХДОЛГ (сознательные решения):
//   - Приватность по ролям (getPassport игнорирует _requesterId) — решение
//     Архитектора 2026-10-15: полный паспорт доступен всем авторизованным.
//   - 13 недостающих эндпоинтов (history, flows, capsule, roles, pause, geo,
//     search, delegate, cooldown, PATCH/:id, …) — это roadmap, а не техдолг:
//     сервисных функций в C.0.02.02 нет, реализация = новая разработка.

import type { FastifyInstance } from 'fastify';

import { getPersonCard } from '../../core/cards/service.js';
import { z } from 'zod';

import {
  getById,
  getPassport,
  listParticipants,
  updateProfile,
} from '../../core/participants/service.js';
import {
  uuidIdParams,
  uuidSchema,
  participantStatusSchema,
  paginationSchema,
} from '../../lib/validators.js';
import { getAuthContext, authMiddleware } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const patchProfileSchema = z.object({
  pseudonym: z.string().min(1).max(64).nullable().optional(),
  messengers: z.record(z.string()).optional(),
  geo_enabled: z.boolean().optional(),
});

const listQuerySchema = paginationSchema.extend({
  direction_id: uuidSchema.optional(),
  status: participantStatusSchema.optional(),
});

export async function registerParticipantsRoutes(app: FastifyInstance): Promise<void> {
  // GET /me — короткий профиль (свой). Без requireRight: доступ к себе.
  app.get(
    '/me',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const participant = await getById(auth.participantId);
      reply.send({ ...participant, audit_id: request.auditId });
    },
  );

  // GET /me/passport — полный паспорт (свой). Без requireRight.
  app.get(
    '/me/passport',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const passport = await getPassport(auth.participantId, auth.participantId);
      reply.send({ ...passport, audit_id: request.auditId });
    },
  );

  // PATCH /me — обновление своего профиля. Без requireRight:
  // PAUSED/OUTSIDE_TRUST должны иметь возможность привязать messenger
  // (для recovery) или обновить pseudonym.
  app.patch(
    '/me',
    { preHandler: [authMiddleware, validateBody(patchProfileSchema)] },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const body = request.body as z.infer<typeof patchProfileSchema>;
      const updated = await updateProfile(auth.participantId, {
        ...(body.pseudonym !== undefined ? { pseudonym: body.pseudonym } : {}),
        ...(body.messengers !== undefined ? { messengers: body.messengers } : {}),
        ...(body.geo_enabled !== undefined ? { geoEnabled: body.geo_enabled } : {}),
      });
      reply.send({ ...updated, audit_id: request.auditId });
    },
  );

  // GET /participants — список участников. Требуется participant:V.
  // Все активные роли имеют participant:V; PAUSED/OUTSIDE_TRUST/REMOTE — нет
  // (они не видят список, но видят /me — доступ к себе).
  app.get(
    '/participants',
    {
      preHandler: [
        authMiddleware,
        requireRight('participant', 'V'),
        validateQuery(listQuerySchema),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof listQuerySchema>;
      const result = await listParticipants(
        {
          ...(q.direction_id ? { directionId: q.direction_id } : {}),
          ...(q.status ? { status: q.status } : {}),
          page: q.page,
          perPage: q.per_page,
        },
        auth.participantId,
      );
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: request.auditId,
      });
    },
  );


  // GET /participants/:id/card — карточка человека для карты ячеек.
  app.get(
    '/participants/:id/card',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (request, reply) => {
      const p = request.params as z.infer<typeof uuidIdParams>;
      reply.send({ ...(await getPersonCard(p.id)), audit_id: request.auditId });
    },
  );

  // GET /participants/:id — чужой паспорт. Требуется participant:V
  // (targetId = params.id — пишется в access_log при отказе).
  app.get<{ Params: { id: string } }>(
    '/participants/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight(
          'participant',
          'V',
          undefined,
          (req) => (req.params as { id: string }).id,
        ),
        validateParams(uuidIdParams),
      ],
    },
    async (request, reply) => {
      const auth = getAuthContext(request);
      const params = request.params;
      const passport = await getPassport(params.id, auth.participantId);
      reply.send({ ...passport, audit_id: request.auditId });
    },
  );
}