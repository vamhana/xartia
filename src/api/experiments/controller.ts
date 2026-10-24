// A.1.30.01 — Контроллер Experiments.
// 18 эндпоинтов: эксперименты (VIII.1) + диссидентские проекты (I.1.8.10).
// Порядок регистрации критичен: /experiments/my и
// /dissident-projects/process-suspensions — ДО /:id.
//
// v0.0.02:
//   - P1: createExpBody.criteria — refine: хотя бы один ключ (пустой
//         объект `{}` семантически = «критериев нет», сервис entity
//         ожидает непустой набор).
//   - P2: leaveBody — отдельная схема для POST /experiments/:id/leave
//         (семантически отлична от joinBody; сейчас идентична, но
//         готова к расширению).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listExperiments,
  listMyExperiments,
  getExperiment,
  createExperiment,
  approveExperiment,
  joinExperiment,
  leaveExperiment,
  completeExperiment,
  recordResults,
  getResults,
  createDissident,
  getDissident,
  listDissidents,
  signPetition,
  reportDissident,
  reviewDissident,
  resourceSourceFor,
  processSuspensions,
} from '../../core/experiments/service.js';
import { assertRight } from '../../core/rights.js';
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

const expStatusSchema = z.enum([
  'filed', 'approved', 'active', 'completed', 'cancelled',
]);

const dissStatusSchema = z.enum([
  'filed', 'active', 'suspended', 'reviewed', 'closed',
]);

const listExpQuery = z.object({
  status: expStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const listDissQuery = z.object({
  status: dissStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

// P1: criteria должен содержать хотя бы один ключ. Пустой объект `{}`
// семантически эквивалентен «критериев нет» — entity-слой (C.0.30.02)
// ожидает непустой набор, иначе эксперимент невозможно валидировать.
const createExpBody = z.object({
  goal: z.string().min(1).max(5000),
  term_days: z.number().int().min(1).max(1825),
  criteria: z
    .record(z.unknown())
    .refine((c) => Object.keys(c).length > 0, {
      message: 'criteria обязательны (хотя бы один ключ)',
    }),
});

const joinBody = z.object({
  participant_id: uuidSchema.optional(),
});

// P2: семантически отдельная схема для leave. Сейчас совпадает с joinBody,
// но в будущем может разойтись (например, «причина выхода»).
const leaveBody = z.object({
  participant_id: uuidSchema.optional(),
});

const resultsBody = z.object({
  successes: z.array(z.string().max(2000)).default([]),
  failures: z.array(z.string().max(2000)).default([]),
  stats: z.record(z.unknown()).default({}),
});

const createDissBody = z.object({
  description: z.string().min(1).max(5000),
});

const reportDissBody = z.object({
  content: z.string().min(1).max(10000),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerExperimentsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── СТАТИЧЕСКИЕ РОУТЫ (ДО /:id) ─────────────────────────────

  // GET /experiments
  app.get(
    '/experiments',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateQuery(listExpQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listExpQuery>;
      const filter: Parameters<typeof listExperiments>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) {filter.status = q.status;}
      const result = await listExperiments(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /experiments
  app.post(
    '/experiments',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'C'),
        validateBody(createExpBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createExpBody>;
      const exp = await createExperiment(
        {
          goal: b.goal,
          termDays: b.term_days,
          criteria: b.criteria,
        },
        auth.participantId,
      );
      reply.status(201).send({ ...exp, audit_id: req.auditId });
    },
  );

  // GET /experiments/my — ДО /:id
  app.get(
    '/experiments/my',
    { preHandler: [authMiddleware, requireRight('experiment', 'V')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const data = await listMyExperiments(auth.participantId, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Параметризованные (experiments) ─────────────────────────

  // POST /experiments/:id/approve
  app.post(
    '/experiments/:id/approve',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'A'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const result = await approveExperiment(p.id, auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // POST /experiments/:id/join
  app.post(
    '/experiments/:id/join',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'C'),
        validateParams(idParams),
        validateBody(joinBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof joinBody>;
      const participantId = b.participant_id ?? auth.participantId;
      if (participantId !== auth.participantId) {
        // Присоединять других может только обладатель A.
        await assertRight({
          participantId: auth.participantId,
          resource: 'experiment',
          action: 'A',
          targetId: p.id,
        });
      }
      const exp = await joinExperiment(p.id, participantId);
      reply.send({ ...exp, audit_id: req.auditId });
    },
  );

  // POST /experiments/:id/leave — P2: leaveBody
  app.post(
    '/experiments/:id/leave',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'C'),
        validateParams(idParams),
        validateBody(leaveBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof leaveBody>;
      const participantId = b.participant_id ?? auth.participantId;
      if (participantId !== auth.participantId) {
        // Выписывать других может только обладатель A.
        await assertRight({
          participantId: auth.participantId,
          resource: 'experiment',
          action: 'A',
          targetId: p.id,
        });
      }
      const exp = await leaveExperiment(p.id, participantId);
      reply.send({ ...exp, audit_id: req.auditId });
    },
  );

  // POST /experiments/:id/complete
  app.post(
    '/experiments/:id/complete',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'E'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const exp = await completeExperiment(p.id, auth.participantId);
      reply.send({ ...exp, audit_id: req.auditId });
    },
  );

  // POST /experiments/:id/results
  app.post(
    '/experiments/:id/results',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'E'),
        validateParams(idParams),
        validateBody(resultsBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof resultsBody>;
      const r = await recordResults(
        p.id,
        { successes: b.successes, failures: b.failures, stats: b.stats },
        auth.participantId,
      );
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /experiments/:id/results
  app.get(
    '/experiments/:id/results',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const r = await getResults(p.id, auth.participantId);
      reply.send({ results: r, audit_id: req.auditId });
    },
  );

  // GET /experiments/:id
  app.get(
    '/experiments/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const exp = await getExperiment(p.id, auth.participantId);
      reply.send({ ...exp, audit_id: req.auditId });
    },
  );

  // ─── Диссидентские проекты: статические ────────────────────

  // GET /dissident-projects
  app.get(
    '/dissident-projects',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateQuery(listDissQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listDissQuery>;
      const filter: Parameters<typeof listDissidents>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) {filter.status = q.status;}
      const result = await listDissidents(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /dissident-projects
  app.post(
    '/dissident-projects',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'C'),
        validateBody(createDissBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createDissBody>;
      const project = await createDissident(
        { description: b.description },
        auth.participantId,
      );
      reply.status(201).send({ ...project, audit_id: req.auditId });
    },
  );

  // POST /dissident-projects/process-suspensions (cron) — ДО /:id
  app.post(
    '/dissident-projects/process-suspensions',
    { preHandler: [authMiddleware, requireRight('experiment', 'Act')] },
    async (req, reply) => {
      const result = await processSuspensions();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // ─── Диссидентские проекты: параметризованные ──────────────

  // GET /dissident-projects/:id
  app.get(
    '/dissident-projects/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const project = await getDissident(p.id, auth.participantId);
      reply.send({ ...project, audit_id: req.auditId });
    },
  );

  // POST /dissident-projects/:id/petition
  app.post(
    '/dissident-projects/:id/petition',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'C'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const project = await signPetition(p.id, auth.participantId);
      reply.send({ ...project, audit_id: req.auditId });
    },
  );

  // POST /dissident-projects/:id/report
  app.post(
    '/dissident-projects/:id/report',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'E'),
        validateParams(idParams),
        validateBody(reportDissBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof reportDissBody>;
      const project = await reportDissident(p.id, b.content, auth.participantId);
      reply.send({ ...project, audit_id: req.auditId });
    },
  );

  // POST /dissident-projects/:id/review
  app.post(
    '/dissident-projects/:id/review',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'A'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const project = await reviewDissident(p.id, auth.participantId);
      reply.send({ ...project, audit_id: req.auditId });
    },
  );

  // GET /dissident-projects/:id/resource-source
  app.get(
    '/dissident-projects/:id/resource-source',
    {
      preHandler: [
        authMiddleware,
        requireRight('experiment', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const result = await resourceSourceFor(p.id);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );
}