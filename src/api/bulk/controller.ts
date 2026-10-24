// A.1.93.01 — Bulk контроллер.src/api/bulk/controller.ts
// 7 эндпоинтов. Все POST — 202 { job_id }, GET/POST статусов — как Exports.
// Порядок регистрации: статические (POST x5) → /jobs/:id (GET/DELETE).
// Права: bulk:C — только Архитектор (через '*'); COUNCIL_MEMBER — V/C;
// VERIFIER — V. roles/grant — только Архитектор (явная проверка в preHandler
// + assertArchitect в worker).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { createBulkJob, cancelJob, getJob } from '../../core/bulk/service.js';
import { ForbiddenError } from '../../core/errors.js';
import { checkRight } from '../../core/rights.js';
import { Role, isRoleValid } from '../../core/roles.js';
import type { RightAction } from '../../core/types.js';
import { uuidSchema } from '../../lib/validators.js';
import { getEffectiveRoles } from '../../security/rbac.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

// ─── Схемы ──────────────────────────────────────────────────────

const idParams = z.object({ id: uuidSchema });

const prioritySchema = z.enum(['critical', 'high', 'standard', 'background']);
const channelSchema = z.enum(['ws', 'email', 'telegram', 'whatsapp']);

const recipientsSchema = z
  .object({
    directionId: uuidSchema.optional(),
    role: z.string().optional(),
    ids: z.array(uuidSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const hasIds = Array.isArray(data.ids);
    const hasDir = typeof data.directionId === 'string';
    const hasRole = typeof data.role === 'string';

    if (hasIds && (hasDir || hasRole)) {
      ctx.addIssue({
        code: 'custom',
        message: 'ids нельзя комбинировать с directionId или role',
      });
      return;
    }
    if (!hasIds && !hasDir && !hasRole) {
      ctx.addIssue({
        code: 'custom',
        message: 'recipients не может быть пустым',
      });
      return;
    }
    if (hasRole && !isRoleValid(data.role as string)) {
      ctx.addIssue({
        code: 'custom',
        message: `Неизвестная роль: ${data.role}`,
      });
    }
    if (hasIds && (data.ids?.length ?? 0) > 1000) {
      ctx.addIssue({
        code: 'custom',
        message: 'ids: максимум 1000',
      });
    }
  });

const notifyBody = z.object({
  recipients: recipientsSchema,
  payload: z.object({
    type: z.string().min(1),
    priority: prioritySchema,
    title: z.string().min(1),
    body: z.string().min(1),
    data: z.record(z.unknown()).optional(),
    channels: z.array(channelSchema).optional(),
    persist: z.boolean().optional(),
  }),
});

const tasksAssignBody = z
  .object({
    task_ids: z.array(uuidSchema).min(1).max(1000),
    participant_ids: z.array(uuidSchema).min(1).max(1000),
  })
  .refine((d) => d.task_ids.length === d.participant_ids.length, {
    message: 'task_ids и participant_ids должны быть одинаковой длины',
    path: ['participant_ids'],
  });

const flowsChargeBody = z.object({
  participant_ids: z.array(uuidSchema).min(1).max(1000),
  type: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(1000),
});

const rolesGrantBody = z
  .object({
    participant_ids: z.array(uuidSchema).min(1).max(1000),
    role: z.string().min(1),
    direction_id: uuidSchema,
    expires_at: z.string().datetime({ offset: true }),
    dry_run: z.boolean().default(false),
  })
  .refine((d) => isRoleValid(d.role), {
    message: 'неизвестная роль',
    path: ['role'],
  })
  .refine((d) => new Date(d.expires_at).getTime() > Date.now(), {
    message: 'expires_at должен быть в будущем',
    path: ['expires_at'],
  });

const EXPORT_TYPES = ['participants', 'plans', 'goods', 'archive', 'audit-log'] as const;
type ExportTypeStr = (typeof EXPORT_TYPES)[number];

const exportBody = z.object({
  types: z.array(z.enum(EXPORT_TYPES)).min(1).max(5).optional(),
  format: z.enum(['csv', 'json']).default('json'),
});

// ─── Регистрация ────────────────────────────────────────────────

export async function registerBulkRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /bulk/notify ────────────────────────────────────────
  app.post(
    '/bulk/notify',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'C'),
        validateBody(notifyBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof notifyBody>;

      // count: известен только для { ids }. Для direction/role — null
      // (resolve в handler, там же safety-лимит 10 000).
      const count = body.recipients.ids ? body.recipients.ids.length : null;

      const job = await createBulkJob(
        'bulk.notify',
        { recipients: body.recipients, payload: body.payload },
        false,
        auth.participantId,
      );

      reply.status(202).send({
        job_id: job.jobId,
        count,
        audit_id: req.auditId,
      });
    },
  );

  // ─── POST /bulk/tasks/assign ──────────────────────────────────
  app.post(
    '/bulk/tasks/assign',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'C'),
        validateBody(tasksAssignBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof tasksAssignBody>;

      const job = await createBulkJob(
        'bulk.tasks.assign',
        { task_ids: body.task_ids, participant_ids: body.participant_ids },
        false,
        auth.participantId,
      );

      reply.status(202).send({ job_id: job.jobId, audit_id: req.auditId });
    },
  );

  // ─── POST /bulk/flows/charge ──────────────────────────────────
  app.post(
    '/bulk/flows/charge',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'C'),
        validateBody(flowsChargeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof flowsChargeBody>;

      const job = await createBulkJob(
        'bulk.flows.charge',
        {
          participant_ids: body.participant_ids,
          type: body.type,
          amount: body.amount,
          reason: body.reason,
        },
        false,
        auth.participantId,
      );

      reply.status(202).send({ job_id: job.jobId, audit_id: req.auditId });
    },
  );

  // ─── POST /bulk/roles/grant ───────────────────────────────────
  // dry_run=true → bulk:V, execute → bulk:C. Плюс явная проверка Архитектора
  // (defense-in-depth; worker тоже проверяет — assertArchitect в handler).
  app.post(
    '/bulk/roles/grant',
    {
      preHandler: [
        authMiddleware,
        validateBody(rolesGrantBody),
        async (req: FastifyRequest, _reply: FastifyReply) => {
          const auth = getAuthContext(req);
          const body = req.body as z.infer<typeof rolesGrantBody>;
          const action: RightAction = body.dry_run === true ? 'V' : 'C';

          // requireRight — это preHandlerHookHandler, его нельзя вызывать
          // как обычную функцию (this === FastifyInstance). Делаем
          // эквивалентную проверку через checkRight.
          const result = await checkRight({
            participantId: auth.participantId,
            resource: 'bulk',
            action,
            targetId: null,
          });
          if (!result.allowed) {
            throw new ForbiddenError(result.reason, {
              resource: 'bulk',
              action,
            });
          }

          const roles = await getEffectiveRoles(auth.participantId);
          if (!roles.includes(Role.FIRST_ARCHITECT)) {
            throw new ForbiddenError(
              'Только FIRST_ARCHITECT может выдавать роли через bulk',
            );
          }
        },
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof rolesGrantBody>;

      const job = await createBulkJob(
        'bulk.roles.grant',
        {
          participant_ids: body.participant_ids,
          role: body.role,
          direction_id: body.direction_id,
          expires_at: body.expires_at,
        },
        body.dry_run,
        auth.participantId,
      );

      reply.status(202).send({
        job_id: job.jobId,
        dry_run: body.dry_run,
        audit_id: req.auditId,
      });
    },
  );

  // ─── POST /bulk/export ────────────────────────────────────────
  app.post(
    '/bulk/export',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'C'),
        validateBody(exportBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof exportBody>;
      const types: ExportTypeStr[] = body.types ?? [
        'participants', 'plans', 'goods', 'archive', 'audit-log',
      ];

      const job = await createBulkJob(
        'bulk.export',
        { types, format: body.format },
        false,
        auth.participantId,
      );

      reply.status(202).send({ job_id: job.jobId, audit_id: req.auditId });
    },
  );

  // ─── GET /bulk/jobs/:id ───────────────────────────────────────
  app.get(
    '/bulk/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const job = await getJob(p.id, auth.participantId);

      reply.send({
        job_id: job.jobId,
        type: job.type,
        dry_run: job.dryRun,
        status: job.status,
        progress: job.progress,
        report: job.report,
        report_url: job.reportUrl,
        error: job.error,
        created_at: job.createdAt,
        finished_at: job.finishedAt,
        audit_id: req.auditId,
      });
    },
  );

  // ─── DELETE /bulk/jobs/:id ────────────────────────────────────
  app.delete(
    '/bulk/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('bulk', 'D'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      await cancelJob(p.id, auth.participantId);
      reply.status(204).send();
    },
  );
}

// Экспорт для тестов
export { EXPORT_TYPES };