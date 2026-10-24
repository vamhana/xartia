// A.1.06.01 — Контроллер Plans
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams → uuidIdParams (6-й дубль по проекту).
//   - type/status enums inline → planTypeSchema/planStatusSchema из L.0.01.03.
//   - checkpoints[].description: +min(1).
//   - rateLimit(api.write) на 6 мутациях.
//
// GET /plans*, /daily-plans* — reference data (без requireRight):
// /daily-plans/current используется F.4.02.03 Tasks.tsx у всех ролей.
// Требование plan:V сломало бы список задач у ASSOCIATED (нет plan:V).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  computeDeviation, hasRecentDeviationSignal, listDeviations,
} from '../../core/plans/deviation.js';
import { createSignalService } from '../../core/signals/service.js';
import { ConflictError } from '../../core/errors.js';
import {
  listPlans, getById, createPlanService,
  approvePlanService, activatePlanService, stopPlanService,
  getDailyPlan,
  listDailyPlans,
  upsertDailyPlan,
  removeTaskFromDailyPlan,
} from '../../core/plans/service.js';
import { uuidIdParams, uuidSchema, planTypeSchema, planStatusSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  type: planTypeSchema.optional(),
  status: planStatusSchema.optional(),
  lead_direction_id: uuidSchema.optional(),
  signal_id: uuidSchema.optional(),
  curator_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  type: planTypeSchema,
  title: z.string().min(1).max(255),
  expected_result: z.string().min(1),
  lead_direction_id: uuidSchema,
  signal_id: uuidSchema.optional(),
  curator_id: uuidSchema.optional(),
  criteria: z.record(z.unknown()).optional(),
  checkpoints: z.array(z.object({
    at: z.string().datetime({ offset: true }),
    description: z.string().min(1),   // ← было без min
  })).optional(),
  stop_conditions: z.record(z.unknown()).optional(),
});

const stopBody = z.object({ reason: z.string().min(1).max(500) });

const deviationsQuery = z.object({
  lead_direction_id: uuidSchema.optional(),
  only_behind: z.enum(['true', 'false']).optional(),
});

const dailyListQuery = z.object({
  direction_id: uuidSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const dailyUpsertBody = z.object({
  direction_id: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  task_ids: z.array(uuidSchema).max(100),
});

const dailyTaskParams = uuidIdParams.extend({ task_id: uuidSchema });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerPlansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plans', { preHandler: [authMiddleware, validateQuery(listQuery)] }, async (req, reply) => {
    const q = req.query as z.infer<typeof listQuery>;
    const result = await listPlans({
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.lead_direction_id ? { leadDirectionId: q.lead_direction_id } : {}),
      ...(q.signal_id ? { signalId: q.signal_id } : {}),
      ...(q.curator_id ? { curatorId: q.curator_id } : {}),
      page: q.page, perPage: q.per_page,
    });
    reply.send({
      data: result.data,
      meta: { page: q.page, per_page: q.per_page, total: result.total },
      audit_id: req.auditId,
    });
  });

  // GET /plans/deviations — что отстаёт. Объявлен выше /plans/:id, чтобы
  // статический сегмент не воспринимался как UUID.
  app.get(
    '/plans/deviations',
    { preHandler: [authMiddleware, validateQuery(deviationsQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof deviationsQuery>;
      const result = await listDeviations({
        ...(q.lead_direction_id ? { leadDirectionId: q.lead_direction_id } : {}),
        ...(q.only_behind === 'true' ? { onlyBehind: true } : {}),
      });
      reply.send({ data: result.data, meta: { total: result.total }, audit_id: req.auditId });
    },
  );

  // GET /plans/:id/deviation — отклонение по одному плану.
  app.get(
    '/plans/:id/deviation',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const deviation = await computeDeviation(p.id);
      reply.send({ ...deviation, audit_id: req.auditId });
    },
  );

  // POST /plans/:id/deviation/signal — балансировка поднимает сигнал
  // направлению. Это её работа по Хартии: заметить отклонение и не решать
  // за направление, а позвать его проверить.
  app.post(
    '/plans/:id/deviation/signal',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('signal', 'C'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const deviation = await computeDeviation(p.id);
      if (deviation.status === 'on_track') {
        throw new ConflictError('План идёт в графике — сигнал не требуется');
      }

      const recent = await hasRecentDeviationSignal(p.id);
      if (recent) {
        throw new ConflictError('Сигнал по этому плану уже поднят', { signalId: recent });
      }

      const behind = deviation.status === 'behind';
      const facts = behind
        ? (deviation.overdue > 0
            ? `просрочено задач: ${deviation.overdue}.`
            : 'пройденные чекпоинты не закрыты.')
        : `идёт быстрее графика: принято ${deviation.done} из ${deviation.total}, ожидалось ${deviation.expectedDone}.`;

      const signal = await createSignalService({
        type: behind ? 'problem' : 'idea',
        description: `[план:${deviation.planId}] ${deviation.title}: ${facts}`,
        justification: behind
          ? `Балансировка: план ${deviation.externalId} отстаёт от графика. `
            + 'Просьба проверить участок и при необходимости усилить его.'
          : `Балансировка: план ${deviation.externalId} идёт быстрее графика. `
            + 'Проверьте, можно ли перенести опыт на отстающие участки и подтянуть их.',
        priority: behind && deviation.overdue > 3 ? 'high' : 'standard',
        directions: [deviation.leadDirectionId],
        leadDirectionId: deviation.leadDirectionId,
      }, auth.participantId);

      reply.status(201).send({ ...signal, audit_id: req.auditId });
    },
  );

  app.get('/plans/:id', { preHandler: [authMiddleware, validateParams(uuidIdParams)] }, async (req, reply) => {
    const p = req.params as z.infer<typeof uuidIdParams>;
    const plan = await getById(p.id);
    reply.send({ ...plan, audit_id: req.auditId });
  });

  app.post(
    '/plans',
    { preHandler: [authMiddleware, writeLimit, requireRight('plan', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const plan = await createPlanService({
        type: b.type,
        title: b.title,
        expectedResult: b.expected_result,
        leadDirectionId: b.lead_direction_id,
        ...(b.signal_id ? { signalId: b.signal_id } : {}),
        ...(b.curator_id ? { curatorId: b.curator_id } : {}),
        ...(b.criteria ? { criteria: b.criteria } : {}),
        ...(b.checkpoints ? { checkpoints: b.checkpoints } : {}),
        ...(b.stop_conditions ? { stopConditions: b.stop_conditions } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...plan, audit_id: req.auditId });
    },
  );

  app.post(
    '/plans/:id/approve',
    { preHandler: [authMiddleware, writeLimit, requireRight('plan', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const plan = await approvePlanService(p.id, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  app.post(
    '/plans/:id/activate',
    { preHandler: [authMiddleware, writeLimit, requireRight('plan', 'A'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const plan = await activatePlanService(p.id, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  app.post(
    '/plans/:id/stop',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('plan', 'E'),
        validateParams(uuidIdParams),
        validateBody(stopBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof stopBody>;
      const plan = await stopPlanService(p.id, b.reason, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  // -------- Daily plans (reference data для Tasks) --------

  app.get(
    '/daily-plans',
    { preHandler: [authMiddleware, validateQuery(dailyListQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof dailyListQuery>;
      const items = await listDailyPlans(q.direction_id, q.date);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/daily-plans/current',
    { preHandler: [authMiddleware, validateQuery(z.object({ direction_id: uuidSchema }))] },
    async (req, reply) => {
      const q = req.query as { direction_id: string };
      const plan = await getDailyPlan(q.direction_id);
      reply.send({ data: plan, audit_id: req.auditId });
    },
  );

  app.post(
    '/daily-plans',
    { preHandler: [authMiddleware, writeLimit, requireRight('plan', 'A'), validateBody(dailyUpsertBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof dailyUpsertBody>;
      const plan = await upsertDailyPlan({
        directionId: b.direction_id,
        date: b.date,
        taskIds: b.task_ids,
        approvedById: auth.participantId,
      });
      reply.status(201).send({ ...plan, audit_id: req.auditId });
    },
  );

  app.delete(
    '/daily-plans/:id/tasks/:task_id',
    { preHandler: [authMiddleware, writeLimit, requireRight('plan', 'A'), validateParams(dailyTaskParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof dailyTaskParams>;
      await removeTaskFromDailyPlan(p.id, p.task_id, auth.participantId);
      reply.status(204).send();
    },
  );
}