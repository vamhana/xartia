// A.1.31.01 — Learning controller.
//
// v0.0.02:
//   - P1: импорт assertRight.
//   - P2: digital-mentor/transfer — self-service для себя, learning:C для чужих.
//   - P3: ptt/:id/advance — requireRight('learning', 'C').
//   - P4: ptt/:id/audit — requireRight('learning', 'V').
//   - P5: refresh-courses — self-service для себя, learning:C для чужих.
//   - P6: modules/* (basic-defense, respect) — self-service для себя,
//         learning:C для чужих.
//   - P7: completeByCourse(participantId) — 2-й аргумент (без дубля).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listCourses, createCourseService, getCourse, enroll, completeByCourse,
  getDigitalMentor, transferToHuman,
  startPtt, getPtt, advancePttService, auditPtt,
  listRoutes, createRouteService, completeRouteService, getRouteQueue,
  startRefreshService, passModuleService,
  listIntegrators, assignIntegratorService, addIntegratorMenteeService,
} from '../../core/learning/service.js';
import { assertRight } from '../../core/rights.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const idParams = z.object({ id: uuidSchema });
const directionParams = z.object({ direction_id: uuidSchema });
const mentorParams = z.object({ id: uuidSchema });

const listCoursesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const createCourseBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  modules: z.array(z.record(z.unknown())).default([]),
  duration_days: z.coerce.number().int().positive(),
});

const transferMentorBody = z.object({
  mentee_id: uuidSchema,
  human_mentor_id: uuidSchema,
  reason: z.string().min(1).max(2000),
});

const pttBody = z.object({
  goal: z.string().min(1).max(5000),
  duration_days: z.coerce.number().int().min(1).max(90),
});

const routeBody = z.object({
  participant_id: uuidSchema,
  direction_id: uuidSchema,
  mentor_id: uuidSchema,
});

const routeListQuery = z.object({
  participant_id: uuidSchema.optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

const refreshBody = z.object({
  participant_id: uuidSchema,
  direction_1_id: uuidSchema,
  direction_2_id: uuidSchema,
});

const moduleBody = z.object({ participant_id: uuidSchema });

const integratorListQuery = z.object({
  direction_id: uuidSchema.optional(),
});

const integratorBody = z.object({
  mentor_id: uuidSchema,
  direction_id: uuidSchema,
});

const menteeBody = z.object({ mentee_id: uuidSchema });

export async function registerLearningRoutes(app: FastifyInstance): Promise<void> {
  // ─── Курсы ─────────────────────────────────────────────────────

  app.get<{ Querystring: z.infer<typeof listCoursesQuery> }>(
    '/learning/courses',
    { preHandler: [authMiddleware, validateQuery(listCoursesQuery)] },
    async (req, reply) => {
      const r = await listCourses({ page: req.query.page, perPage: req.query.per_page });
      reply.send({
        data: r.data,
        meta: { page: req.query.page, per_page: req.query.per_page, total: r.total },
        audit_id: req.auditId,
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/learning/courses/:id',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const c = await getCourse(req.params.id);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  app.post<{ Body: z.infer<typeof createCourseBody> }>(
    '/learning/courses',
    { preHandler: [authMiddleware, requireRight('learning', 'C'), validateBody(createCourseBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const c = await createCourseService({
        title: b.title,
        ...(b.description ? { description: b.description } : {}),
        modules: b.modules,
        durationDays: b.duration_days,
      }, auth.participantId);
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/learning/courses/:id/enroll',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const e = await enroll(req.params.id, auth.participantId);
      reply.status(201).send({ ...e, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/learning/courses/:id/complete',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      // P7: completeByCourse(courseId, participantId) — 2-й аргумент
      // (было: 3 аргумента с дублем participantId).
      const e = await completeByCourse(req.params.id, auth.participantId);
      reply.send({ ...e, audit_id: req.auditId });
    },
  );

  // ─── Цифровой наставник ────────────────────────────────────────

  app.get('/learning/digital-mentor', { preHandler: [authMiddleware] }, async (req, reply) => {
    const dm = await getDigitalMentor();
    reply.send({ ...dm, audit_id: req.auditId });
  });

  app.post<{ Body: z.infer<typeof transferMentorBody> }>(
    '/learning/digital-mentor/transfer',
    { preHandler: [authMiddleware, validateBody(transferMentorBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      // P2: Self-service: участник переводит себя к человеку-наставнику.
      // Перевод чужого mentee — только с learning:C.
      if (b.mentee_id !== auth.participantId) {
        await assertRight({
          participantId: auth.participantId,
          resource: 'learning',
          action: 'C',
          targetId: b.mentee_id,
        });
      }
      const dm = await transferToHuman(b.mentee_id, b.human_mentor_id, b.reason, auth.participantId);
      reply.send({ ...dm, audit_id: req.auditId });
    },
  );

  // ─── ПТТ ───────────────────────────────────────────────────────

  app.post<{ Body: z.infer<typeof pttBody> }>(
    '/learning/ptt',
    { preHandler: [authMiddleware, requireRight('learning', 'C'), validateBody(pttBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = await startPtt(req.body.goal, req.body.duration_days, auth.participantId);
      reply.status(201).send({ ...p, audit_id: req.auditId });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/learning/ptt/:id',
    { preHandler: [authMiddleware, validateParams(idParams)] },
    async (req, reply) => {
      const p = await getPtt(req.params.id);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  // P3: advance — мутирующая операция, требует learning:C.
  app.post<{ Params: { id: string } }>(
    '/learning/ptt/:id/advance',
    { preHandler: [authMiddleware, requireRight('learning', 'C'), validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = await advancePttService(req.params.id, auth.participantId);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  // P4: audit — чтение, требует learning:V.
  app.get<{ Params: { id: string } }>(
    '/learning/ptt/:id/audit',
    { preHandler: [authMiddleware, requireRight('learning', 'V'), validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const r = await auditPtt(req.params.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Когнитивные маршруты ──────────────────────────────────────

  app.get<{ Querystring: z.infer<typeof routeListQuery> }>(
    '/cognitive-routes',
    { preHandler: [authMiddleware, validateQuery(routeListQuery)] },
    async (req, reply) => {
      const r = await listRoutes({
        ...(req.query.participant_id ? { participantId: req.query.participant_id } : {}),
        ...(req.query.status ? { status: req.query.status } : {}),
      });
      reply.send({ data: r, audit_id: req.auditId });
    },
  );

  app.post<{ Body: z.infer<typeof routeBody> }>(
    '/cognitive-routes',
    { preHandler: [authMiddleware, requireRight('learning', 'C'), validateBody(routeBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const r = await createRouteService(b.participant_id, b.direction_id, b.mentor_id, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/cognitive-routes/:id/complete',
    { preHandler: [authMiddleware, requireRight('learning', 'E'), validateParams(idParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const r = await completeRouteService(req.params.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.get<{ Params: { direction_id: string } }>(
    '/cognitive-routes/queue/:direction_id',
    { preHandler: [authMiddleware, validateParams(directionParams)] },
    async (req, reply) => {
      const q = await getRouteQueue(req.params.direction_id);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // ─── Рефреш, модули ────────────────────────────────────────────

  // P5: refresh-courses — self-service для себя, learning:C для чужих.
  app.post<{ Body: z.infer<typeof refreshBody> }>(
    '/refresh-courses',
    { preHandler: [authMiddleware, validateBody(refreshBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      if (b.participant_id !== auth.participantId) {
        await assertRight({
          participantId: auth.participantId,
          resource: 'learning',
          action: 'C',
          targetId: b.participant_id,
        });
      }
      const r = await startRefreshService(b.participant_id, b.direction_1_id, b.direction_2_id, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // P6: modules/basic-defense — self-service для себя, learning:C для чужих.
  app.post<{ Body: z.infer<typeof moduleBody> }>(
    '/modules/basic-defense',
    { preHandler: [authMiddleware, validateBody(moduleBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      if (b.participant_id !== auth.participantId) {
        await assertRight({
          participantId: auth.participantId,
          resource: 'learning',
          action: 'C',
          targetId: b.participant_id,
        });
      }
      const m = await passModuleService(b.participant_id, 'basic_defense', auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  // P6: modules/respect — self-service для себя, learning:C для чужих.
  app.post<{ Body: z.infer<typeof moduleBody> }>(
    '/modules/respect',
    { preHandler: [authMiddleware, validateBody(moduleBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      if (b.participant_id !== auth.participantId) {
        await assertRight({
          participantId: auth.participantId,
          resource: 'learning',
          action: 'C',
          targetId: b.participant_id,
        });
      }
      const m = await passModuleService(b.participant_id, 'respect', auth.participantId);
      reply.status(201).send({ ...m, audit_id: req.auditId });
    },
  );

  // ─── Интеграторы ───────────────────────────────────────────────

  app.get<{ Querystring: z.infer<typeof integratorListQuery> }>(
    '/integration/mentors',
    { preHandler: [authMiddleware, validateQuery(integratorListQuery)] },
    async (req, reply) => {
      const list = await listIntegrators(req.query.direction_id);
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.post<{ Body: z.infer<typeof integratorBody> }>(
    '/integration/mentors',
    { preHandler: [authMiddleware, requireRight('learning', 'C'), validateBody(integratorBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const im = await assignIntegratorService(b.mentor_id, b.direction_id, auth.participantId);
      reply.status(201).send({ ...im, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof menteeBody> }>(
    '/integration/mentors/:id/mentees',
    { preHandler: [authMiddleware, requireRight('learning', 'E'), validateParams(mentorParams), validateBody(menteeBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const im = await addIntegratorMenteeService(req.params.id, req.body.mentee_id, auth.participantId);
      reply.send({ ...im, audit_id: req.auditId });
    },
  );
}