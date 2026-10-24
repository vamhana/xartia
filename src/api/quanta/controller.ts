// A.1.25.01 — Контроллер Quanta.
// 13 эндпоинтов: каталог, обнаружение, аудит, тесты, масштабирование,
// остановка, документирование, внедрение в общину, mandatory, detect, cron.
//
// Права: quantum (V/C/E/A/Act).
//
// Порядок регистрации КРИТИЧЕН: /mandatory, /detect, /process-daily
// регистрируются ДО /:id — иначе Fastify примет их за UUID.
//
// v0.0.02:
//   - writeLimit на всех POST (rate-limit api.write).
//   - uuidIdParams вместо локальной idParams (единый валидатор).
//   - JSON-body ≤ 10KB на optional-полях createBody (area/limitations/
//     success_criteria/stop_criteria).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  list,
  get,
  create,
  audit,
  test,
  scale,
  stop,
  listMandatory,
  apply,
  recordTest,
  detectPotential,
  document as documentService,
  getCatalog,
  processDaily,
} from '../../core/quanta/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

// Rate-limit: конфиг api.write резолвится один раз на старте.
const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

// Пустая строка в query → undefined. Для опциональных UUID-фильтров.
const optionalUuid = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  uuidSchema.optional(),
);

const quantumStatusSchema = z.enum([
  'detected', 'audit', 'testing', 'scaling', 'active', 'cancelled',
]);

const listQuery = z.object({
  level: z.coerce.number().int().min(1).max(6).optional(),
  status: quantumStatusSchema.optional(),
  mandatory: z
    .preprocess(
      (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
      z.boolean().optional(),
    )
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const json10k = z.record(z.unknown())
  .refine((d) => JSON.stringify(d).length <= 10_000, { message: 'JSON ≤ 10KB' });

const createBody = z.object({
  level: z.number().int().min(1).max(6),
  type: z.string().min(1).max(128),
  source_cell_id: uuidSchema,
  description: z.string().min(1).max(10000),
  area_of_applicability: json10k.optional(),
  limitations: json10k.optional(),
  success_criteria: json10k.optional(),
  stop_criteria: json10k.optional(),
  mandatory: z.boolean().optional(),
});

const testBody = z.object({
  cell_ids: z
    .array(uuidSchema)
    .min(3, 'Минимум 3 ячейки (I.3.5.2)')
    .max(5, 'Максимум 5 ячеек (I.3.5.2)'),
});

const stopBody = z.object({
  reason: z.string().min(1).max(2000),
});

const applyBody = z.object({
  community_id: uuidSchema,
});

const testRecordBody = z.object({
  cell_id: uuidSchema,
  result: z.enum(['success', 'failure']),
  notes: z.string().max(5000).optional(),
});

const catalogQuery = z.object({
  community_id: optionalUuid,
  applied: z
    .preprocess(
      (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
      z.boolean().optional(),
    )
    .optional(),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerQuantaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── СТАТИЧЕСКИЕ РОУТЫ (ДО /:id) ─────────────────────────────

  // GET /quanta — каталог
  app.get(
    '/quanta',
    {
      preHandler: [
        authMiddleware,
        requireRight('quantum', 'V'),
        validateQuery(listQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listQuery>;
      const filter: Parameters<typeof list>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.level !== undefined) {filter.level = q.level;}
      if (q.status) {filter.status = q.status;}
      if (q.mandatory !== undefined) {filter.mandatory = q.mandatory;}
      const data = await list(filter, auth.participantId);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // POST /quanta — обнаружение
  app.post(
    '/quanta',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'C'),
        validateBody(createBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const q = await create(
        {
          level: b.level,
          type: b.type,
          sourceCellId: b.source_cell_id,
          description: b.description,
          ...(b.area_of_applicability
            ? { areaOfApplicability: b.area_of_applicability }
            : {}),
          ...(b.limitations ? { limitations: b.limitations } : {}),
          ...(b.success_criteria
            ? { successCriteria: b.success_criteria }
            : {}),
          ...(b.stop_criteria ? { stopCriteria: b.stop_criteria } : {}),
          ...(b.mandatory !== undefined ? { mandatory: b.mandatory } : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...q, audit_id: req.auditId });
    },
  );

  // GET /quanta/mandatory
  app.get(
    '/quanta/mandatory',
    { preHandler: [authMiddleware, requireRight('quantum', 'V')] },
    async (req, reply) => {
      const data = await listMandatory();
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // GET /quanta/detect
  app.get(
    '/quanta/detect',
    { preHandler: [authMiddleware, requireRight('quantum', 'V')] },
    async (req, reply) => {
      const data = await detectPotential();
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // POST /quanta/process-daily — cron
  app.post(
    '/quanta/process-daily',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'Act'),
      ],
    },
    async (req, reply) => {
      const r = await processDaily();
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /quanta/catalog — список записей каталога (внедрено/нет)
  app.get(
    '/quanta/catalog',
    {
      preHandler: [
        authMiddleware,
        requireRight('quantum', 'V'),
        validateQuery(catalogQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof catalogQuery>;
      const filter: Parameters<typeof getCatalog>[0] = {};
      if (q.community_id) {filter.communityId = q.community_id;}
      if (q.applied !== undefined) {filter.applied = q.applied;}
      const data = await getCatalog(filter);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── ПАРАМЕТРИЗОВАННЫЕ РОУТЫ ────────────────────────────────

  // GET /quanta/:id
  app.get(
    '/quanta/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('quantum', 'V'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = await get(p.id, auth.participantId);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/audit
  app.post(
    '/quanta/:id/audit',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'A'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = await audit(p.id, auth.participantId);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/test — валидация 3–5 ячеек
  app.post(
    '/quanta/:id/test',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'E'),
        validateParams(uuidIdParams),
        validateBody(testBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof testBody>;
      const q = await test(p.id, b.cell_ids, auth.participantId);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/test-record — записать результат теста
  app.post(
    '/quanta/:id/test-record',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'E'),
        validateParams(uuidIdParams),
        validateBody(testRecordBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof testRecordBody>;
      const t = await recordTest(
        p.id,
        b.cell_id,
        b.result,
        b.notes,
        auth.participantId,
      );
      reply.status(201).send({ ...t, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/scale
  app.post(
    '/quanta/:id/scale',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'A'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = await scale(p.id, auth.participantId);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/stop
  app.post(
    '/quanta/:id/stop',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'A'),
        validateParams(uuidIdParams),
        validateBody(stopBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof stopBody>;
      const q = await stop(p.id, b.reason, auth.participantId);
      reply.send({ ...q, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/document
  app.post(
    '/quanta/:id/document',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'E'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const r = await documentService(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // POST /quanta/:id/apply
  app.post(
    '/quanta/:id/apply',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('quantum', 'E'),
        validateParams(uuidIdParams),
        validateBody(applyBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof applyBody>;
      const entry = await apply(p.id, b.community_id, auth.participantId);
      reply.status(201).send({ ...entry, audit_id: req.auditId });
    },
  );
}