// A.1.28.01 — Контроллер Convergence.
// 19 эндпоинтов: план, декларация, совет (POST/GET), этапы, конверсии
// (POST/GET для debts/assets/weapons/culture), завершение, критерии,
// аудит, валидация, max-months.
//
// Права: convergence (V/C/E/A).
// Порядок: /plans и /plans/:id — базовые; все остальные — с :id в path,
// коллизий нет. /plans/:id/stage/:n — двухуровневый, регистрируется
// после базовых /plans/:id. GET /plans/:id/council регистрируется после
// GET /plans/:id, чтобы :id не съел "council".
//
// v0.0.02:
//   - B.1: (отменено в B.5) импорт ConflictError перенесён в сервис
//   - B.2: stageParams.n — min(1) (0 — не валидный этап; 0 зарезервирован
//          под 'draft' в БД).
//   - B.3: councilBody + superRefine — роли-префиксы SP/DIR/STATE/AUDITOR,
//          квоты 3/3/3/2 (I.7.3).
//   - B.4: debtsBody — .finite() на amount/coefficient + superRefine:
//          external → annul, internal → convert.
//   - B.5: POST /plans/:id/stage/:n — валидация этапа в сервисе
//          (advanceStage(planId, targetStage, requesterId)), без race.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createPlan,
  getPlan,
  listPlans,
  signDeclaration,
  createCouncil,
  getCouncil,
  advanceStage,
  convertDebts,
  convertAssets,
  convertWeapons,
  createCulturalCenter,
  complete,
  checkStageCriteria,
  auditProgress,
  validateCompletion,
  getMaxMonths,
  listDebts,
  listAssets,
  listWeapons,
  listCulturalCenters,
} from '../../core/convergence/service.js';
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

// B.2: этап 0 — это 'draft' (в БД), переход начинается с 1.
const stageParams = z.object({
  id: uuidSchema,
  n: z.coerce.number().int().min(1).max(5),
});

const planStatusSchema = z.enum([
  'draft',
  'declared',
  'in_progress',
  'completed',
  'failed',
]);

const listQuery = z.object({
  status: planStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const createBody = z.object({
  state_name: z.string().min(1).max(255),
  coordinator_id: uuidSchema.optional(),
});

const declarationBody = z.object({
  signed_by: uuidSchema,
});

// B.3: префикс роли → квоты. Префикс — до первого дефиса, опциональный
// суффикс после дефиса (например, 'DIR-energy', 'SP-1').
const COUNCIL_ROLE_RE = /^(SP|DIR|STATE|AUDITOR)(-[A-Za-z0-9_]+)?$/;

const councilBody = z
  .object({
    members: z
      .array(z.record(z.unknown()))
      .min(11, 'Минимум 11 участников (I.7.3)'),
  })
  .superRefine((body, ctx) => {
    const counts = { SP: 0, DIR: 0, STATE: 0, AUDITOR: 0 };
    for (let i = 0; i < body.members.length; i++) {
      const m = body.members[i];
      if (!m) {continue;}
      const role = m['role'];
      if (typeof role !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', i, 'role'],
          message: 'role обязателен и должен быть строкой',
        });
        continue;
      }
      const match = COUNCIL_ROLE_RE.exec(role);
      if (!match) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', i, 'role'],
          message: 'role должен начинаться с SP, DIR, STATE или AUDITOR',
        });
        continue;
      }
      const prefix = match[1] as keyof typeof counts;
      counts[prefix]++;
    }
    const required: Array<[keyof typeof counts, number, string]> = [
      ['SP',      3, 'Совет Протоколов'],
      ['DIR',     3, 'направления'],
      ['STATE',   3, 'государства'],
      ['AUDITOR', 2, 'аудитора'],
    ];
    for (const [key, min, label] of required) {
      if (counts[key] < min) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members'],
          message: `Нужно минимум ${min} участника от ${label} (${key}), сейчас ${counts[key]}`,
        });
      }
    }
  });

// B.4: amount/coefficient — конечные числа; action согласован с type.
const debtsBody = z
  .object({
    type: z.enum(['external', 'internal']),
    amount: z.number().positive('amount > 0').finite('amount должен быть конечным'),
    action: z.enum(['annul', 'convert']).optional(),
    coefficient: z.number().finite().optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.action) {return;}
    const expected = body.type === 'external' ? 'annul' : 'convert';
    if (body.action !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['action'],
        message: `Тип ${body.type} требует action='${expected}', получено '${body.action}'`,
      });
    }
  });

const assetsBody = z.object({
  asset_type: z.string().min(1).max(64),
  value: z.number().positive('value > 0'),
  destination_direction_id: uuidSchema,
});

const weaponsBody = z.object({
  weapon_type: z.string().min(1).max(64),
  action: z.enum(['utilize', 'reserve', 'energy']),
});

const cultureBody = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerConvergenceRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── Базовые роуты планов ───────────────────────────────────

  // GET /convergence/plans
  app.get(
    '/convergence/plans',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateQuery(listQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listQuery>;
      const filter: Parameters<typeof listPlans>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) {filter.status = q.status;}
      const result = await listPlans(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // POST /convergence/plans
  app.post(
    '/convergence/plans',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateBody(createBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const plan = await createPlan(
        {
          stateName: b.state_name,
          ...(b.coordinator_id ? { coordinatorId: b.coordinator_id } : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...plan, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id
  app.get(
    '/convergence/plans/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const plan = await getPlan(p.id, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  // ─── Декларация ─────────────────────────────────────────────

  // POST /convergence/plans/:id/declaration
  app.post(
    '/convergence/plans/:id/declaration',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'E'),
        validateParams(idParams),
        validateBody(declarationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof declarationBody>;
      const plan = await signDeclaration(p.id, b.signed_by, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  // ─── Совет ──────────────────────────────────────────────────

  // POST /convergence/plans/:id/council
  app.post(
    '/convergence/plans/:id/council',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateParams(idParams),
        validateBody(councilBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof councilBody>;
      const council = await createCouncil(
        p.id,
        b.members,
        auth.participantId,
      );
      reply.status(201).send({ ...council, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/council
  app.get(
    '/convergence/plans/:id/council',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const council = await getCouncil(p.id);
      reply.send({ council, audit_id: req.auditId });
    },
  );

  // ─── Переход этапа ─────────────────────────────────────────

  // POST /convergence/plans/:id/stage/:n
  // B.5: targetStage передаётся в сервис, где под тем же getPlan проверяется
  // plan.stage + 1 === targetStage — без race (см. B.6). При несовпадении
  // сервис бросает ConflictError → Fastify error handler вернёт 409.
  app.post(
    '/convergence/plans/:id/stage/:n',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'E'),
        validateParams(stageParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof stageParams>;
      const plan = await advanceStage(p.id, p.n, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  // ─── Конверсии ─────────────────────────────────────────────

  // POST /convergence/plans/:id/debts
  app.post(
    '/convergence/plans/:id/debts',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateParams(idParams),
        validateBody(debtsBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof debtsBody>;
      const conv = await convertDebts(
        p.id,
        {
          type: b.type,
          amount: b.amount,
          ...(b.action ? { action: b.action } : {}),
          ...(b.coefficient !== undefined
            ? { coefficient: b.coefficient }
            : {}),
        },
        auth.participantId,
      );
      reply.status(201).send({ ...conv, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/debts
  app.get(
    '/convergence/plans/:id/debts',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const data = await listDebts(p.id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // POST /convergence/plans/:id/assets
  app.post(
    '/convergence/plans/:id/assets',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateParams(idParams),
        validateBody(assetsBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof assetsBody>;
      const conv = await convertAssets(
        p.id,
        {
          assetType: b.asset_type,
          value: b.value,
          destinationDirectionId: b.destination_direction_id,
        },
        auth.participantId,
      );
      reply.status(201).send({ ...conv, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/assets
  app.get(
    '/convergence/plans/:id/assets',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const data = await listAssets(p.id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // POST /convergence/plans/:id/weapons
  app.post(
    '/convergence/plans/:id/weapons',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateParams(idParams),
        validateBody(weaponsBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof weaponsBody>;
      const conv = await convertWeapons(
        p.id,
        { weaponType: b.weapon_type, action: b.action },
        auth.participantId,
      );
      reply.status(201).send({ ...conv, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/weapons
  app.get(
    '/convergence/plans/:id/weapons',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const data = await listWeapons(p.id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // POST /convergence/plans/:id/culture
  app.post(
    '/convergence/plans/:id/culture',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'C'),
        validateParams(idParams),
        validateBody(cultureBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof cultureBody>;
      const center = await createCulturalCenter(
        p.id,
        b.lat,
        b.lon,
        auth.participantId,
      );
      reply.status(201).send({ ...center, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/culture
  app.get(
    '/convergence/plans/:id/culture',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const data = await listCulturalCenters(p.id);
      reply.send({ data, audit_id: req.auditId });
    },
  );

  // ─── Завершение ────────────────────────────────────────────

  // POST /convergence/plans/:id/complete
  app.post(
    '/convergence/plans/:id/complete',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'E'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const plan = await complete(p.id, auth.participantId);
      reply.send({ ...plan, audit_id: req.auditId });
    },
  );

  // ─── Критерии, аудит, валидация ────────────────────────────

  // GET /convergence/plans/:id/criteria
  app.get(
    '/convergence/plans/:id/criteria',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const r = await checkStageCriteria(p.id);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // POST /convergence/plans/:id/audit
  app.post(
    '/convergence/plans/:id/audit',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'A'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const r = await auditProgress(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // GET /convergence/plans/:id/validate-completion
  app.get(
    '/convergence/plans/:id/validate-completion',
    {
      preHandler: [
        authMiddleware,
        requireRight('convergence', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const r = await validateCompletion(p.id);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Метаданные ────────────────────────────────────────────

  // GET /convergence/max-months — просто для справки.
  app.get(
    '/convergence/max-months',
    { preHandler: [authMiddleware, requireRight('convergence', 'V')] },
    async (req, reply) => {
      reply.send({ max_months: getMaxMonths(), audit_id: req.auditId });
    },
  );
}