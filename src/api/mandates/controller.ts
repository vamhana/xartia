// A.1.05.01 — Контроллер Mandates
//
// Техдолг закрыт (v0.0.03 → v0.0.04):
//   - idParams → uuidIdParams из L.0.01.03 (5-й дубль по проекту).
//   - DELETE /mandates/:id — reason через validateQuery(revokeQuerySchema)
//     вместо ручной валидации. body.reason — fallback для клиентов, которые
//     всё же шлют body (Fastify 5 не парсит body для DELETE).
//   - rate-limit (api.write) на всех мутациях: POST /mandates, /rotate,
//     DELETE /mandates, POST /delegations, DELETE /delegations,
//     POST /process-expired.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - GET /cooldowns: participant_id не проверяется на право чтения чужого
//     cooldown. Сейчас любой авторизованный может запросить cooldown
//     другого участника. Нужен условный preHandler: self — всегда разрешено;
//     чужой — checkRight('participant','V') + logAccessDenied.
//   - DELETE /mandates/:id: reason в query попадает в access/audit-логи.
//     Архитектурный компромисс (Fastify 5 не парсит body для DELETE).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listMandates, getById, listDue,
  createMandateService, rotateMandateService, revokeMandateService,
  getActiveCooldowns, processExpired,
  listDelegations, delegateService, revokeDelegationService,
} from '../../core/mandates/service.js';
import { uuidSchema, uuidIdParams } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

// ---- Схемы ----

const listQuery = z.object({
  function: z.string().optional(),
  direction_id: uuidSchema.optional(),
  holder_id: uuidSchema.optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const dueQuery = z.object({ within_days: z.coerce.number().int().min(1).max(365).default(30) });

const createBody = z.object({
  function: z.string().min(1).max(128),
  holder_id: uuidSchema,
  direction_id: uuidSchema.optional(),
  expires_at: z.string().datetime({ offset: true }),
  conditions: z.record(z.unknown()).optional(),
  scope: z.record(z.unknown()).optional(),
});

const rotateBody = z.object({ successor_id: uuidSchema });

// DELETE /mandates/:id — reason через query (основной канал, Fastify 5 не
// парсит body для DELETE). body.reason — fallback.
const revokeQuerySchema = z.object({
  reason: z.string().min(1, 'Укажите причину').max(500, 'Максимум 500 символов'),
});

const cooldownQuery = z.object({ participant_id: uuidSchema.optional() });

const delegateBody = z.object({
  function: z.string().min(1).max(128),
  to_id: uuidSchema,
  direction_id: uuidSchema.optional(),
  scope: z.record(z.unknown()).optional(),
  valid_to: z.string().datetime({ offset: true }),
});

// Rate-limit для мутаций — api.write.
const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerMandatesRoutes(app: FastifyInstance): Promise<void> {
  // GET /mandates
  app.get('/mandates', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const result = await listMandates({
      ...(q.function ? { function: q.function } : {}),
      ...(q.direction_id ? { directionId: q.direction_id } : {}),
      ...(q.holder_id ? { holderId: q.holder_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      page: q.page, perPage: q.per_page,
    });
    reply.send({
      data: result.data,
      meta: { page: q.page, per_page: q.per_page, total: result.total },
      audit_id: req.auditId,
    });
  });

  // GET /mandates/due
  app.get('/mandates/due', { preHandler: [authMiddleware, validateQuery(dueQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof dueQuery>;
    const items = await listDue(q.within_days);
    reply.send({ data: items, audit_id: req.auditId });
  });

  // GET /mandates/:id
  app.get('/mandates/:id', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const m = await getById(p.id);
    reply.send({ ...m, audit_id: req.auditId });
  });

  // POST /mandates (право: mandate:C)
  app.post(
    '/mandates',
    { preHandler: [authMiddleware, writeLimit, requireRight('mandate', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const m = await createMandateService({
        function: b.function,
        holderId: b.holder_id,
        ...(b.direction_id ? { directionId: b.direction_id } : {}),
        expiresAt: b.expires_at,
        ...(b.conditions ? { conditions: b.conditions } : {}),
        ...(b.scope ? { scope: b.scope } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  // POST /mandates/:id/rotate (право: mandate:R)
  app.post(
    '/mandates/:id/rotate',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('mandate', 'R'),
        validateParams(uuidIdParams),
        validateBody(rotateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof rotateBody>;
      const result = await rotateMandateService(p.id, b.successor_id, auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // DELETE /mandates/:id (право: mandate:D)
  // reason — из query (Fastify 5 не парсит body для DELETE). Zod-валидация
  // через validateQuery. body.reason — fallback для клиентов, которые
  // всё-таки шлют body (если когда-нибудь настроят contentTypeParser).
  app.delete(
    '/mandates/:id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('mandate', 'D'),
        validateParams(uuidIdParams),
        validateQuery(revokeQuerySchema),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = req.query as z.infer<typeof revokeQuerySchema>;
      const bodyReason = (req.body as { reason?: string } | undefined)?.reason;
      const reason = bodyReason ?? q.reason;

      const m = await revokeMandateService(p.id, reason, auth.participantId);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );

  // GET /cooldowns — TODO(techdebt): проверить право на чтение чужого
  // cooldown. Сейчас — любой авторизованный может запросить по participant_id.
  app.get(
    '/cooldowns',
    { preHandler: [authMiddleware, validateQuery(cooldownQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof cooldownQuery>;
      const pid = q.participant_id ?? auth.participantId;
      const items = await getActiveCooldowns(pid);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /mandates/process-expired (право: mandate:Act — только Архитектор)
  app.post(
    '/mandates/process-expired',
    { preHandler: [authMiddleware, writeLimit, requireRight('mandate', 'Act')] },
    async (req, reply) => {
      const result = await processExpired();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // -------- Delegations --------

  app.get('/delegations', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const items = await listDelegations({ fromId: auth.participantId });
    reply.send({ data: items, audit_id: req.auditId });
  });

  // POST /delegations (право: mandate:C)
  app.post(
    '/delegations',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('mandate', 'C'),
        validateBody(delegateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof delegateBody>;
      const d = await delegateService({
        function: b.function,
        toId: b.to_id,
        ...(b.direction_id ? { directionId: b.direction_id } : {}),
        ...(b.scope ? { scope: b.scope } : {}),
        validTo: b.valid_to,
      }, auth.participantId);
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  // DELETE /delegations/:id (право: mandate:D)
  app.delete(
    '/delegations/:id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('mandate', 'D'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      await revokeDelegationService(p.id, auth.participantId);
      reply.status(204).send();
    },
  );
}