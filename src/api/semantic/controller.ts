// A.1.29.01 — Контроллер Semantic
// Дрейф, тревога, вето, словарь, перевод, доклад, давление, Стража.
//
// v0.0.02:
//   - P1: DELETE /semantic/veto/:id — reason из query (Fastify 5 не парсит
//         body для DELETE). body.reason — fallback для клиентов, шлющих body.
//   - P2: reportQuery.year — lazy default через функцию: при загрузке модуля
//         фиксируется только «год запуска процесса», а нужен «текущий год»
//         на каждый safeParse (корректно для долгоживущего процесса).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listDrift, createDriftService,
  listAlarms, createAlarmService, acknowledgeAlarmService, escalateAlarmService,
  createVetoService, liftVetoService,
  listDictionary, createTermService, updateTermService,
  checkTranslationService,
  getReport,
  reportPressureService,
  canRemoveGuardian,
} from '../../core/semantic/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

// -------- Схемы --------

const idParams = z.object({ id: uuidSchema });

const driftListQuery = z.object({
  term: z.string().optional(),
  status: z.enum(['new', 'analyzed', 'resolved']).optional(),
  min_severity: z.coerce.number().int().min(1).max(10).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const driftBody = z.object({
  term: z.string().min(1).max(255),
  original_meaning: z.string().min(1).max(5000),
  detected_meaning: z.string().min(1).max(5000),
  severity: z.number().int().min(1).max(10),
});

const alarmListQuery = z.object({
  status: z.enum(['raised', 'acknowledged', 'escalated', 'resolved']).optional(),
});

const alarmBody = z.object({
  drift_id: uuidSchema.nullable().optional(),
});

const escalateBody = z.object({
  to: z.enum(['council', 'forum', 'referendum']),
});

const vetoBody = z.object({
  type: z.enum(['semantic_guardian', 'jury']),
  decision_ref: uuidSchema,
  reason: z.string().min(1).max(2000),
});

// Fastify 5 не парсит body для DELETE — reason принимаем из query
// (паттерн из A.1.05.01 mandates). body.reason — fallback для клиентов,
// которые шлют body в обход стандартного парсера.
const liftVetoQuery = z.object({
  reason: z.string().min(1).max(2000),
});

const dictionaryListQuery = z.object({});

const dictionaryBody = z.object({
  term: z.string().min(1).max(255),
  definition: z.string().min(1).max(10000),
});

const dictionaryPatchBody = z.object({
  definition: z.string().min(1).max(10000),
});

const translationBody = z.object({
  original: z.string().min(1).max(50000),
  translated: z.string().min(1).max(50000),
  language: z.string().min(2).max(16),
});

// P2: Zod `.default(value)` фиксирует значение при создании схемы (загрузка
// модуля). Функция вызывается при каждом safeParse — корректно для
// «текущего года» в долгоживущем процессе.
const reportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100)
    .default(() => new Date().getUTCFullYear()),
});

const pressureBody = z.object({
  description: z.string().min(1).max(2000),
});

// -------- Роуты --------

export async function registerSemanticRoutes(app: FastifyInstance): Promise<void> {
  // GET /semantic/drift
  app.get(
    '/semantic/drift',
    { preHandler: [authMiddleware, validateQuery(driftListQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof driftListQuery>;
      const result = await listDrift({
        ...(q.term ? { term: q.term } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.min_severity !== undefined ? { minSeverity: q.min_severity } : {}),
        page: q.page,
        perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /semantic/drift (право: semantic:C)
  app.post(
    '/semantic/drift',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'C'),
        validateBody(driftBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof driftBody>;
      const d = await createDriftService({
        term: b.term,
        originalMeaning: b.original_meaning,
        detectedMeaning: b.detected_meaning,
        severity: b.severity,
        detectedBy: auth.participantId,
      });
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  // GET /semantic/alarms
  app.get(
    '/semantic/alarms',
    { preHandler: [authMiddleware, validateQuery(alarmListQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof alarmListQuery>;
      const items = await listAlarms(q.status);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /semantic/alarm (право: semantic:Act)
  app.post(
    '/semantic/alarm',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'Act'),
        validateBody(alarmBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof alarmBody>;
      const a = await createAlarmService(b.drift_id ?? null, auth.participantId);
      reply.status(201).send({ ...a, audit_id: req.auditId });
    },
  );

  // POST /semantic/alarm/:id/acknowledge
  app.post(
    '/semantic/alarm/:id/acknowledge',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'Act'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const a = await acknowledgeAlarmService(p.id, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  // POST /semantic/alarm/:id/escalate
  app.post(
    '/semantic/alarm/:id/escalate',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'Act'),
        validateParams(idParams),
        validateBody(escalateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof escalateBody>;
      const a = await escalateAlarmService(p.id, b.to, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  // POST /semantic/veto (право: semantic:Act)
  app.post(
    '/semantic/veto',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'Act'),
        validateBody(vetoBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof vetoBody>;
      const v = await createVetoService({
        type: b.type,
        decisionRef: b.decision_ref,
        reason: b.reason,
        imposedBy: auth.participantId,
      });
      reply.status(201).send({ ...v, audit_id: req.auditId });
    },
  );

  // DELETE /semantic/veto/:id
  // P1: Fastify 5 не парсит body для DELETE. reason — из query (?reason=...).
  // body.reason — fallback для клиентов, шлющих body.
  app.delete(
    '/semantic/veto/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'Act'),
        validateParams(idParams),
        validateQuery(liftVetoQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const q = req.query as z.infer<typeof liftVetoQuery>;
      const bodyReason = (req.body as { reason?: string } | undefined)?.reason;
      const reason = bodyReason ?? q.reason;
      const v = await liftVetoService(p.id, reason, auth.participantId);
      reply.send({ ...v, audit_id: req.auditId });
    },
  );

  // GET /semantic/dictionary
  app.get(
    '/semantic/dictionary',
    { preHandler: [authMiddleware, validateQuery(dictionaryListQuery)] },
    async (req, reply) => {
      const items = await listDictionary();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /semantic/dictionary
  app.post(
    '/semantic/dictionary',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'C'),
        validateBody(dictionaryBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof dictionaryBody>;
      const t = await createTermService({
        term: b.term,
        definition: b.definition,
        by: auth.participantId,
      });
      reply.status(201).send({ ...t, audit_id: req.auditId });
    },
  );

  // PATCH /semantic/dictionary/:id
  app.patch(
    '/semantic/dictionary/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'C'),
        validateParams(idParams),
        validateBody(dictionaryPatchBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof dictionaryPatchBody>;
      const t = await updateTermService(p.id, b.definition, auth.participantId);
      reply.send({ ...t, audit_id: req.auditId });
    },
  );

  // POST /semantic/translations/check
  app.post(
    '/semantic/translations/check',
    {
      preHandler: [
        authMiddleware,
        requireRight('semantic', 'C'),
        validateBody(translationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof translationBody>;
      const c = await checkTranslationService({
        original: b.original,
        translated: b.translated,
        language: b.language,
        by: auth.participantId,
      });
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // GET /semantic/report
  app.get(
    '/semantic/report',
    { preHandler: [authMiddleware, validateQuery(reportQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof reportQuery>;
      const r = await getReport(q.year, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // POST /semantic/pressure (любой участник — защита Стража)
  app.post(
    '/semantic/pressure',
    {
      preHandler: [authMiddleware, validateBody(pressureBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof pressureBody>;
      const r = await reportPressureService(b.description, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /semantic/guardian — состояние Стража (публичный)
  app.get(
    '/semantic/guardian',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const canRemove = await canRemoveGuardian(auth.participantId);
      reply.send({
        active: true,
        can_remove: canRemove,
        note: 'Страж не может быть отстранён иначе как через 1.10.3',
        audit_id: req.auditId,
      });
    },
  );
}