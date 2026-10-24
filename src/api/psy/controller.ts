// A.1.23.01 — Контроллер Psy.
// 19 эндпоинтов: sessions, observers, crisis, discharge, mood, resonance,
// wellbeing, hygiene, systemic-violence.
//
// Психоэкология не лечит (I.4.12). Наблюдатели во всех направлениях.
// Разгрузка 3–5 дней. Систематическое насилие → аудит (I.4.8).
//
// Права: psy_session (V/C/E/D). Act — только на cron-агрегацию
// (/psy/mood/aggregate). Self-service: crisis/wellbeing/resonance —
// можно записывать своё состояние без requireRight; для чужого
// participant_id требуется psy_session:C.
//
// Все GET-эндпоинты чтения требуют psy_session:V (кроме self-service
// POST'ов с selfOrRight и systemic-violence, где нужен Act).

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';

import {
  listSessions,
  createSession,
  completeSession,
  listObservers,
  createObserver,
  removeObserver,
  startCrisis,
  listCrises,
  startDischarge,
  listDischarges,
  startResonance,
  getMood,
  getCollectiveMood,
  recordWellbeing,
  getAggregatedWellbeing,
  proposeHygiene,
  listHygiene,
  detectSystemicViolence,
  aggregateMoodMetrics,
} from '../../core/psy/service.js';
import { assertRight } from '../../core/rights.js';
import type { RightAction } from '../../core/types.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

const aggregateMoodBody = z.object({
  period: z.enum(['hour', 'day']).default('hour'),
});

const idParams = z.object({ id: uuidSchema });
const directionParams = z.object({ direction_id: uuidSchema });

const sessionTypeSchema = z.enum([
  'onboarding',
  'crisis',
  'discharge',
  'resonance',
]);

const sessionStatusSchema = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);

const crisisStatusSchema = z.enum(['open', 'in_progress', 'closed']);
const dischargeStatusSchema = z.enum(['scheduled', 'in_progress', 'completed']);

const listSessionsQuery = z.object({
  type: sessionTypeSchema.optional(),
  status: sessionStatusSchema.optional(),
  participant_id: uuidSchema.optional(),
  psychologist_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const listCrisesQuery = z.object({
  status: crisisStatusSchema.optional(),
  participant_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const listDischargesQuery = z.object({
  status: dischargeStatusSchema.optional(),
  participant_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const createSessionBody = z.object({
  participant_id: uuidSchema,
  psychologist_id: uuidSchema.optional(),
  type: sessionTypeSchema,
  scheduled_at: z.string().datetime({ offset: true }),
});

const completeSessionBody = z.object({
  notes: z.string().max(10000).default(''),
});

const listObserversQuery = z.object({
  direction_id: uuidSchema.optional(),
});

const createObserverBody = z.object({
  participant_id: uuidSchema,
  direction_id: uuidSchema,
});

const crisisBody = z.object({
  participant_id: uuidSchema,
  notes: z.string().max(10000).optional(),
});

const dischargeBody = z.object({
  participant_id: uuidSchema,
  days: z.number().int().min(3).max(5),
});

const moodQuery = z.object({
  direction_id: uuidSchema,
});

const wellbeingBody = z.object({
  participant_id: uuidSchema,
  score: z.number().int().min(1).max(10),
});

const resonanceBody = z.object({
  participant_id: uuidSchema,
});

const hygieneBody = z.object({
  direction_id: uuidSchema,
  measure: z.string().min(1).max(2000),
});

const hygieneQuery = z.object({
  direction_id: uuidSchema.optional(),
});

const aggregateQuery = z.object({
  direction_id: uuidSchema.optional(),
  period_from: z.string().datetime({ offset: true }).optional(),
  period_to: z.string().datetime({ offset: true }).optional(),
});

const systemicQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

// ─── Self-service ────────────────────────────────────────────────
// Если participant_id совпадает с текущим — прав не требуется.
// Если participant_id чужой — требуется psy_session:<action>.

function selfOrRight(action: RightAction): preHandlerHookHandler {
  return async (request) => {
    const auth = getAuthContext(request);
    const body = (request.body ?? {}) as { participant_id?: string };
    const targetId = body.participant_id;
    if (targetId && targetId !== auth.participantId) {
      await assertRight({
        participantId: auth.participantId,
        resource: 'psy_session',
        action,
        targetId,
      });
    }
  };
}

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerPsyRoutes(app: FastifyInstance): Promise<void> {
  // ─── Mood: cron-агрегация ────────────────────────────────────
  //
  // POST /psy/mood/aggregate — K8s CronJob I.3.05.06.
  // Право: psy_session:Act (мутирующий пересчёт + WS-эмиссия).

  app.post(
    '/psy/mood/aggregate',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'Act'),
        validateBody(aggregateMoodBody),
      ],
    },
    async (req, reply) => {
      const b = req.body as z.infer<typeof aggregateMoodBody>;
      const result = await aggregateMoodMetrics(b.period);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // ─── Sessions ────────────────────────────────────────────────

  app.get(
    '/psy/sessions',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(listSessionsQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listSessionsQuery>;
      const filter: Parameters<typeof listSessions>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.type) { filter.type = q.type; }
      if (q.status) { filter.status = q.status; }
      if (q.participant_id) { filter.participantId = q.participant_id; }
      if (q.psychologist_id) { filter.psychologistId = q.psychologist_id; }
      const auth = getAuthContext(req);
      const data = await listSessions(filter, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/psy/sessions',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'C'),
        validateBody(createSessionBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createSessionBody>;
      const s = await createSession(
        {
          participantId: b.participant_id,
          ...(b.psychologist_id ? { psychologistId: b.psychologist_id } : {}),
          type: b.type,
          scheduledAt: b.scheduled_at,
        },
        auth.participantId,
      );
      reply.status(201).send({ ...s, audit_id: req.auditId });
    },
  );

  app.post(
    '/psy/sessions/:id/complete',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'E'),
        validateParams(idParams),
        validateBody(completeSessionBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof completeSessionBody>;
      const s = await completeSession(p.id, b.notes, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // ─── Observers ───────────────────────────────────────────────

  app.get(
    '/psy/observers',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(listObserversQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listObserversQuery>;
      const data = await listObservers(q.direction_id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/psy/observers',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'C'),
        validateBody(createObserverBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createObserverBody>;
      const o = await createObserver(
        { participantId: b.participant_id, directionId: b.direction_id },
        auth.participantId,
      );
      reply.status(201).send({ ...o, audit_id: req.auditId });
    },
  );

  app.delete(
    '/psy/observers/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'D'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      await removeObserver(p.id, auth.participantId);
      reply.status(204).send();
    },
  );

  // ─── Crisis ──────────────────────────────────────────────────

  app.get(
    '/psy/crises',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(listCrisesQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listCrisesQuery>;
      const filter: Parameters<typeof listCrises>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) { filter.status = q.status; }
      if (q.participant_id) { filter.participantId = q.participant_id; }
      const data = await listCrises(filter, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/psy/crisis',
    {
      preHandler: [
        authMiddleware,
        validateBody(crisisBody),
        selfOrRight('C'),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof crisisBody>;
      const c = await startCrisis(b.participant_id, b.notes, auth.participantId);
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  // ─── Reflective discharge ────────────────────────────────────

  app.get(
    '/psy/discharges',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(listDischargesQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listDischargesQuery>;
      const filter: Parameters<typeof listDischarges>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) { filter.status = q.status; }
      if (q.participant_id) { filter.participantId = q.participant_id; }
      const data = await listDischarges(filter, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.post(
    '/psy/reflective-discharge',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'C'),
        validateBody(dischargeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof dischargeBody>;
      const d = await startDischarge(b.participant_id, b.days, auth.participantId);
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  // ─── Resonance ───────────────────────────────────────────────

  app.post(
    '/psy/resonance',
    {
      preHandler: [
        authMiddleware,
        validateBody(resonanceBody),
        selfOrRight('C'),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof resonanceBody>;
      const d = await startResonance(b.participant_id, auth.participantId);
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  // ─── Mood ────────────────────────────────────────────────────

  app.get(
    '/psy/mood',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(moodQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof moodQuery>;
      const m = await getMood(q.direction_id, auth.participantId);
      reply.send({ ...m, audit_id: req.auditId });
    },
  );

  app.get(
    '/psy/mood/collective',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const data = await getCollectiveMood(auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Wellbeing ───────────────────────────────────────────────

  app.post(
    '/psy/wellbeing',
    {
      preHandler: [
        authMiddleware,
        validateBody(wellbeingBody),
        selfOrRight('C'),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof wellbeingBody>;
      const w = await recordWellbeing(b.participant_id, b.score, auth.participantId);
      reply.status(201).send({ ...w, audit_id: req.auditId });
    },
  );

  app.get(
    '/psy/wellbeing/aggregate',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(aggregateQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof aggregateQuery>;
      const filter: Parameters<typeof getAggregatedWellbeing>[0] = {};
      if (q.direction_id) { filter.directionId = q.direction_id; }
      if (q.period_from) { filter.periodFrom = q.period_from; }
      if (q.period_to) { filter.periodTo = q.period_to; }
      const w = await getAggregatedWellbeing(filter);
      reply.send({ ...w, audit_id: req.auditId });
    },
  );

  // ─── Hygiene ─────────────────────────────────────────────────

  app.post(
    '/psy/hygiene',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'C'),
        validateBody(hygieneBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof hygieneBody>;
      const h = await proposeHygiene(b.direction_id, b.measure, auth.participantId);
      reply.status(201).send({ ...h, audit_id: req.auditId });
    },
  );

  app.get(
    '/psy/hygiene',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'V'),
        validateQuery(hygieneQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof hygieneQuery>;
      const data = await listHygiene(q.direction_id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Systemic violence ───────────────────────────────────────
  //
  // ВНИМАНИЕ: метод GET, но операция мутирующая — пишет в
  // systemic_violence_signals и триггерит justice.fileComplaint.
  // Идемпотентно по (direction_id, year). Оставлено GET ради
  // простоты вызова из admin-панели; при желании — перевести
  // на POST /psy/systemic-violence/:direction_id/detect.

  app.get(
    '/psy/systemic-violence/:direction_id',
    {
      preHandler: [
        authMiddleware,
        requireRight('psy_session', 'Act'),
        validateParams(directionParams),
        validateQuery(systemicQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof directionParams>;
      const q = req.query as z.infer<typeof systemicQuery>;
      const r = await detectSystemicViolence(p.direction_id, q.year, auth.participantId);
      reply.send({ signal: r.signal, cases: r.cases, audit_id: req.auditId });
    },
  );
}