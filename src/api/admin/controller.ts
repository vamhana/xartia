// A.1.35.01 — Контроллер Admin
// Дашборд, карта мандатов, режимы, логи, system status, recovery-очередь,
// инвалидация кэшей. Все роуты требуют роль FIRST_ARCHITECT, КРОМЕ
// recovery-очереди: её видят также COUNCIL_MEMBER (одобряют заявки).
//
// Мутации delegate/rotate/bootstrap/seed — заглушки, возвращающие 403 с
// указанием на канонические сервисы (см. TECHDEBT в C.0.35.02).
//
// v0.0.02:
//   - P1: импорт logAccessDenied.
//   - P2: requireArchitect — отказ пишется в access_log (иначе 403 невидимы).
//   - P3: requireArchitectOrCouncil — то же + refactor (без двойного hasRole).
//   - P4: recoveryQueueQuery.statuses — superRefine на допустимые значения.
//   - P5: participantsListQuery.status + participantPatchBody.status —
//         z.enum(PARTICIPANT_STATUSES), синхронизировано с C.0.35.02.
//   - P6: approve — dev_token выдаётся только при NODE_ENV !== 'production'.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { assertArchitect } from '../../core/admin/entity.js';
import {
  canDelegate,
  delegate,
  exportLogs,
  getDashboard,
  getMandatesMap,
  getParticipantAdmin,
  getSystemStatus,
  invalidateAllCaches,
  listLogsRich,
  listMandatesAdmin,
  listParticipantsAdmin,
  listRecoveryQueue,
  listRegimes,
  rotate,
  seedTemplates,
  updateParticipantAdmin,
} from '../../core/admin/service.js';
import { ForbiddenError } from '../../core/errors.js';
import {
  approveRecoveryRequest,
  createFromRequest,
  listRegistrationRequests,
  nextWaveNumber,
  rejectRecoveryRequest,
} from '../../core/participants/service.js';
import { getById as getDirectionById } from '../../core/directions/service.js';
import { createWelcomeTask } from '../../core/onboarding/service.js';
import type { RegistrationStatus } from '../../core/types.js';
import { Role } from '../../core/roles.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { hasRole } from '../../security/rbac.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logAccessDenied } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

// -------- Схемы --------

const recoveryActionParams = z.object({
  request_id: z.string().uuid(),
});

const recoveryRejectBody = z.object({
  reason: z.string().min(1).max(1000),
});

// P4: допустимые статусы recovery-заявки. superRefine проверяет
// каждый элемент после split(','). Cast в handler — безопасен.
const RECOVERY_STATUSES = [
  'pending', 'approved', 'used', 'rejected', 'expired',
] as const;

const recoveryQueueQuery = z
  .object({
    statuses: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((q, ctx) => {
    if (!q.statuses) {return;}
    const items = q.statuses.split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of items) {
      if (!(RECOVERY_STATUSES as readonly string[]).includes(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statuses'],
          message: `Неизвестный статус: '${s}'. Допустимые: ${RECOVERY_STATUSES.join(', ')}`,
        });
      }
    }
  });

const logsQuery = z.object({
  actor_id: z.string().uuid().optional(),
  entity_type: z.string().min(1).max(64).optional(),
  entity_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const exportQuery = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  entity_type: z.string().min(1).max(64).optional(),
});

const rotateBody = z.object({
  mandate_id: z.string().uuid(),
  successor_id: z.string().uuid(),
});

const delegateBody = z.object({
  function: z.string().min(1).max(128),
  holder_id: z.string().uuid(),
  direction_id: z.string().uuid().optional(),
  expires_at: z.string().datetime({ offset: true }),
  conditions: z.record(z.unknown()).optional(),
  scope: z.record(z.unknown()).optional(),
});

const seedBody = z.object({
  templates: z
    .array(
      z.enum([
        'directions',
        'roles',
        'interview_questions',
        'widgets',
        'containers',
        'rights_matrix',
        'all',
      ]),
    )
    .default(['all']),
});

// P5: статусы участника синхронизированы с VALID_STATUSES в C.0.35.02.
const PARTICIPANT_STATUSES = [
  'compatible', 'conditionally_compatible', 'associated', 'full',
  'paused', 'outside_trust_network', 'master', 'integrator',
  'pioneer', 'excluded',
] as const;

const participantsListQuery = z.object({
  direction_id: z.string().uuid().optional(),
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  search: z.string().min(1).max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const mandatesListQuery = z.object({
  function: z.string().min(1).max(128).optional(),
  direction_id: z.string().uuid().optional(),
  holder_id: z.string().uuid().optional(),
  status: z.enum(['active', 'expired', 'revoked']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const participantIdParams = z.object({
  id: z.string().uuid(),
});

const participantPatchBody = z.object({
  name: z.string().min(1).max(255).optional(),
  pseudonym: z.string().max(255).nullable().optional(),
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  direction_id: z.string().uuid().optional(),
  mentor_id: z.string().uuid().nullable().optional(),
});

// -------- Схемы: очередь заявок на регистрацию (A.1.35.01) --------

const REGISTRATION_QUEUE_STATUSES = [
  'new', 'interview_scheduled', 'decided', 'accepted',
  'conditionally_accepted', 'rejected',
] as const;

const registrationQueueQuery = z
  .object({
    statuses: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((q, ctx) => {
    if (!q.statuses) {return;}
    const items = q.statuses.split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of items) {
      if (!(REGISTRATION_QUEUE_STATUSES as readonly string[]).includes(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statuses'],
          message: `Недопустимый статус заявки: ${s}`,
        });
      }
    }
  });

const registrationRequestParams = z.object({
  request_id: z.string().uuid(),
});

// Приём заявки: Архитектор выбирает имя, направление и (опционально)
// профессию/волну. Остальное выводится из заявки.
const acceptRegistrationBody = z.object({
  name: z.string().min(2).max(255),
  direction_id: z.string().uuid(),
  profession_id: z.string().uuid().nullable().optional(),
  subdirection: z.string().max(64).optional(),
  // Буква волны — кириллическая: формат external_id (L.0.01.01)
  // требует ^[А-Я]?\d{5}-<направление>.
  wave: z.string().regex(/^[А-Я]$/, 'Буква волны — одна заглавная кириллическая').optional(),
  wave_number: z.number().int().min(1).max(99999).optional(),
  status: z.enum(PARTICIPANT_STATUSES).optional(),
});

// -------- Проверки --------

// P2: отказ пишется в access_log — иначе 403 невидимы для аудита.
async function requireArchitect(request: FastifyRequest): Promise<void> {
  const auth = getAuthContext(request);
  const isArchitect = await hasRole(auth.participantId, Role.FIRST_ARCHITECT);
  if (!isArchitect) {
    await logAccessDenied({
      participantId: auth.participantId,
      resource: 'admin',
      action: 'V',
      targetId: null,
      reason: 'Требуется роль FIRST_ARCHITECT',
      ip: request.ip,
    });
  }
  assertArchitect(isArchitect ? Role.FIRST_ARCHITECT : null);
}

// P3: то же + refactor — не вызываем hasRole(COUNCIL_MEMBER), если уже Архитектор.
async function requireArchitectOrCouncil(request: FastifyRequest): Promise<void> {
  const auth = getAuthContext(request);
  const isArchitect = await hasRole(auth.participantId, Role.FIRST_ARCHITECT);
  const isCouncil = !isArchitect &&
    (await hasRole(auth.participantId, Role.COUNCIL_MEMBER));
  if (!isArchitect && !isCouncil) {
    await logAccessDenied({
      participantId: auth.participantId,
      resource: 'admin',
      action: 'V',
      targetId: null,
      reason: 'Требуется роль FIRST_ARCHITECT или COUNCIL_MEMBER',
      ip: request.ip,
    });
    throw new ForbiddenError('Требуется роль FIRST_ARCHITECT или COUNCIL_MEMBER');
  }
}

// -------- Регистрация --------

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // GET /admin/dashboard
  app.get(
    '/admin/dashboard',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const data = await getDashboard(auth.participantId);
      reply.send({ ...data, audit_id: request.auditId });
    },
  );

  // GET /admin/mandates/map
  app.get(
    '/admin/mandates/map',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const data = await getMandatesMap(auth.participantId);
      reply.send({ ...data, audit_id: request.auditId });
    },
  );

  // GET /admin/regimes
  app.get(
    '/admin/regimes',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const data = await listRegimes(auth.participantId);
      reply.send({ data, audit_id: request.auditId });
    },
  );

  // GET /admin/recovery/queue
  // Доступ: FIRST_ARCHITECT или COUNCIL_MEMBER. Совет одобряет заявки,
  // значит должен их видеть. Глубже (approve) роль проверяется в A.1.01.01.
  app.get(
    '/admin/recovery/queue',
    {
      preHandler: [
        authMiddleware,
        validateQuery(recoveryQueueQuery),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitectOrCouncil(request);
      const q = request.query as z.infer<typeof recoveryQueueQuery>;
      // superRefine уже проверил значения — cast безопасен.
      const statuses = q.statuses
        ? (q.statuses
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean) as Array<typeof RECOVERY_STATUSES[number]>)
        : undefined;
      const result = await listRecoveryQueue({
        ...(statuses ? { statuses } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: request.auditId,
      });
    },
  );

  // POST /admin/recovery/:request_id/approve
  // Доступ: FIRST_ARCHITECT или COUNCIL_MEMBER (как у recovery/queue).
  // Токен уходит участнику через мессенджер; в HTTP-ответе не возвращается,
  // КРОМЕ dev-режима (ALLOW_DEV_TOKEN=true) — там dev_token для отладки.
  app.post(
    '/admin/recovery/:request_id/approve',
    {
      preHandler: [
        authMiddleware,
        validateParams(recoveryActionParams),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitectOrCouncil(request);
      const auth = getAuthContext(request);
      const p = request.params as z.infer<typeof recoveryActionParams>;
      const result = await approveRecoveryRequest(p.request_id, auth.participantId);

      // P6: dev_token — только вне production. Один ALLOW_DEV_TOKEN
      // в prod может утечь токен восстановления пароля.
      const allowDevToken =
        process.env['NODE_ENV'] !== 'production' &&
        (process.env['ALLOW_DEV_TOKEN'] === 'true' ||
          process.env['ALLOW_DEV_TOKEN'] === '1');

      reply.send({
        request_id: result.requestId,
        expires_at: result.expiresAt,
        delivered_via: result.deliveredVia,
        ...(result.deliveredVia.length === 0
          ? { warning: 'Токен не доставлен — отзовите заявку и создайте новую' }
          : {}),
        ...(allowDevToken ? { dev_token: result.token } : {}),
        audit_id: request.auditId,
      });
    },
  );

  // POST /admin/recovery/:request_id/reject
  app.post(
    '/admin/recovery/:request_id/reject',
    {
      preHandler: [
        authMiddleware,
        validateParams(recoveryActionParams),
        validateBody(recoveryRejectBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitectOrCouncil(request);
      const auth = getAuthContext(request);
      const p = request.params as z.infer<typeof recoveryActionParams>;
      const b = request.body as z.infer<typeof recoveryRejectBody>;
      await rejectRecoveryRequest(p.request_id, auth.participantId, b.reason);
      reply.status(200).send({ ok: true, audit_id: request.auditId });
    },
  );

  // GET /admin/logs
  app.get(
    '/admin/logs',
    {
      preHandler: [
        authMiddleware,
        validateQuery(logsQuery),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof logsQuery>;
      const result = await listLogsRich(
        {
          ...(q.actor_id !== undefined ? { actorId: q.actor_id } : {}),
          ...(q.entity_type ? { entityType: q.entity_type } : {}),
          ...(q.entity_id ? { entityId: q.entity_id } : {}),
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

  // GET /admin/logs/export
  app.get(
    '/admin/logs/export',
    {
      preHandler: [
        authMiddleware,
        validateQuery(exportQuery),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const q = request.query as z.infer<typeof exportQuery>;
      const result = await exportLogs(
        { ...(q.entity_type ? { entityType: q.entity_type } : {}) },
        q.format,
        auth.participantId,
      );
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // GET /admin/can-delegate
  app.get(
    '/admin/can-delegate',
    {
      preHandler: [
        authMiddleware,
        validateQuery(z.object({ function: z.string().min(1).max(128) })),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const q = request.query as { function: string };
      const allowed = await canDelegate(auth.participantId, q.function);
      reply.send({ can_delegate: allowed, audit_id: request.auditId });
    },
  );

  // GET /admin/system-status
  app.get(
    '/admin/system-status',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const data = await getSystemStatus();
      reply.send({ ...data, audit_id: request.auditId });
    },
  );

  // POST /admin/invalidate-caches
  app.post(
    '/admin/invalidate-caches',
    {
      preHandler: [
        authMiddleware,
        rateLimit({ config: mustGetLimit('api.write') }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const result = await invalidateAllCaches(auth.participantId);
      reply.send({ ...result, audit_id: request.auditId });
    },
  );

  // POST /admin/rotate
  app.post(
    '/admin/rotate',
    {
      preHandler: [
        authMiddleware,
        validateBody(rotateBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const b = request.body as z.infer<typeof rotateBody>;
      const result = await rotate(
        { mandateId: b.mandate_id, successorId: b.successor_id },
        auth.participantId,
      );
      reply.status(200).send({ ...result, audit_id: request.auditId });
    },
  );

  // POST /admin/delegate
  app.post(
    '/admin/delegate',
    {
      preHandler: [
        authMiddleware,
        validateBody(delegateBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const b = request.body as z.infer<typeof delegateBody>;
      const mandate = await delegate(
        {
          function: b.function,
          holderId: b.holder_id,
          ...(b.direction_id ? { directionId: b.direction_id } : {}),
          expiresAt: b.expires_at,
          ...(b.conditions ? { conditions: b.conditions } : {}),
          ...(b.scope ? { scope: b.scope } : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...mandate, audit_id: request.auditId });
    },
  );

  // POST /admin/seed
  app.post(
    '/admin/seed',
    {
      preHandler: [
        authMiddleware,
        validateBody(seedBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const b = request.body as z.infer<typeof seedBody>;
      const result = await seedTemplates(b.templates, auth.participantId);
      reply.status(200).send({ ...result, audit_id: request.auditId });
    },
  );

  // -------- Admin: участники --------
  app.get(
    '/admin/mandates',
    {
      preHandler: [authMiddleware, validateQuery(mandatesListQuery)],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const q = request.query as z.infer<typeof mandatesListQuery>;
      const result = await listMandatesAdmin({
        ...(q.function ? { function: q.function } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
        ...(q.holder_id ? { holderId: q.holder_id } : {}),
        ...(q.status ? { status: q.status } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: request.auditId,
      });
    },
  );


  app.get(
    '/admin/participants',
    {
      preHandler: [
        authMiddleware,
        validateQuery(participantsListQuery),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const q = request.query as z.infer<typeof participantsListQuery>;
      const result = await listParticipantsAdmin({
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.search ? { search: q.search } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: request.auditId,
      });
    },
  );

  app.get(
    '/admin/participants/:id',
    {
      preHandler: [
        authMiddleware,
        validateParams(participantIdParams),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const p = request.params as z.infer<typeof participantIdParams>;
      const row = await getParticipantAdmin(p.id);
      reply.send({ ...row, audit_id: request.auditId });
    },
  );

  app.patch(
    '/admin/participants/:id',
    {
      preHandler: [
        authMiddleware,
        validateParams(participantIdParams),
        validateBody(participantPatchBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const p = request.params as z.infer<typeof participantIdParams>;
      const b = request.body as z.infer<typeof participantPatchBody>;
      const updated = await updateParticipantAdmin(
        p.id,
        {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.pseudonym !== undefined ? { pseudonym: b.pseudonym } : {}),
          ...(b.status !== undefined ? { status: b.status } : {}),
          ...(b.direction_id !== undefined ? { directionId: b.direction_id } : {}),
          ...(b.mentor_id !== undefined ? { mentorId: b.mentor_id } : {}),
        },
        auth.participantId,
      );
      reply.send({ ...updated, audit_id: request.auditId });
    },
  );

  // -------- Очередь заявок на регистрацию (онбординг) --------
  // Почему в admin: приём нового человека — действие Архитектора,
  // как recovery-approve. Core-функция createFromRequest была реализована
  // (C.0.02.02) и покрыта race-тестом, но не имела HTTP-входа: заявка
  // навсегда оставалась в статусе `new`. Эти два роута закрывают контур.

  // GET /admin/registration-requests — заявки, ждущие решения.
  app.get(
    '/admin/registration-requests',
    {
      preHandler: [
        authMiddleware,
        validateQuery(registrationQueueQuery),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const q = request.query as z.infer<typeof registrationQueueQuery>;
      const statuses = q.statuses
        ? (q.statuses.split(',').map((s) => s.trim())
            .filter(Boolean) as RegistrationStatus[])
        : undefined;
      const result = await listRegistrationRequests({
        ...(statuses ? { statuses } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: request.auditId,
      });
    },
  );

  // POST /admin/registration-requests/:request_id/accept — принять заявку.
  // Создаёт участника с временным паролем; пароль возвращается ОДИН раз
  // и не хранится в открытом виде. Повторный accept → 409 (Core FOR UPDATE).
  app.post(
    '/admin/registration-requests/:request_id/accept',
    {
      preHandler: [
        authMiddleware,
        validateParams(registrationRequestParams),
        validateBody(acceptRegistrationBody),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await requireArchitect(request);
      const auth = getAuthContext(request);
      const p = request.params as z.infer<typeof registrationRequestParams>;
      const b = request.body as z.infer<typeof acceptRegistrationBody>;

      const direction = await getDirectionById(b.direction_id);
      const wave = b.wave ?? 'А';
      const waveNumber = b.wave_number ?? (await nextWaveNumber(wave));

      const created = await createFromRequest({
        requestId: p.request_id,
        interviewerId: auth.participantId,
        directionId: b.direction_id,
        directionNumber: direction.number,
        professionId: b.profession_id ?? null,
        wave,
        waveNumber,
        name: b.name,
        ...(b.subdirection ? { subdirection: b.subdirection } : {}),
        ...(b.status ? { status: b.status } : {}),
      });

      // Welcome-задача создаётся сразу: без неё новый участник видит пустой
      // экран. Ошибка домена задач не должна отменять приём — человек уже
      // создан; тогда в ответе welcome_task = null и это видно Архитектору.
      let welcomeTask: { id: string; externalId: string; description: string } | null = null;
      try {
        const task = await createWelcomeTask({
          participantId: created.participant.id,
          participantName: created.participant.name,
          directionId: b.direction_id,
          mentorExternalId: null,
          actorId: auth.participantId,
        });
        welcomeTask = {
          id: task.id,
          externalId: task.externalId,
          description: task.description,
        };
      } catch (e) {
        request.log.warn(
          { err: e, participantId: created.participant.id },
          'welcome task was not created',
        );
      }

      reply.code(201).send({
        participant: created.participant,
        temporary_password: created.temporaryPassword,
        welcome_task: welcomeTask,
        audit_id: request.auditId,
      });
    },
  );

}