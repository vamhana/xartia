// A.1.21.01 — Justice controller.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: +requireRight('justice','V'|'C'|'E') на всех endpoint'ах
//     (было: только authMiddleware — CRITICAL).
//   - B6: sanctionBody исключён not_imputable — только через /not-imputable.
//   - B7: DELETE /justice/isolation/:id — reason в query (Fastify 5 не парсит body).
//   - B8: +Zod-схема collectiveBody для validate-collective.
//   - B9: +rateLimit(api.write) на 9 мутациях.
//   - idParams → uuidIdParams.
//
// Кто может:
//   - POST /justice/complaints — self-service (любой участник, I.2.2).
//   - Все остальные — requireRight('justice','V'|'C'|'E') →
//     только JUSTICE (justice:['V','C','E']) и FIRST_ARCHITECT (wildcard).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  fileComplaint, listComplaints, getComplaint,
  startInvestigation, getInvestigation, closeInvestigation, extendInvestigation,
  listOverdueInvestigations,
  imposeIsolation, liftIsolation, createResocialization,
  createSanction, createNotImputable, activateRedCircuit,
  getVictimRights, auditProcess, coordinateWithRedCircuit, validateCollective,
} from '../../core/justice/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const participantParams = z.object({ participant_id: uuidSchema });

const complaintBody = z.object({
  type: z.enum(['violence', 'threat', 'coercion', 'harassment']),
  description: z.string().min(1).max(10000),
  anonymous: z.boolean().default(false),
});

const complaintListQuery = z.object({
  status: z.enum(['filed', 'investigation', 'closed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const investigationBody = z.object({
  complaint_id: uuidSchema,
  target_id: uuidSchema,
  investigator_ids: z.array(uuidSchema).max(20).optional(),
});

const investigationCloseBody = z.object({
  result: z.string().min(1).max(10000),
});

const isolationBody = z.object({
  target_id: uuidSchema,
  valid_to: z.string().datetime({ offset: true }),
  conditions: z.record(z.unknown())
    .refine((c) => JSON.stringify(c).length <= 10_000, {
      message: 'conditions ≤ 10KB',
    }),
});

// B7: reason для DELETE — через query (Fastify 5 не парсит body).
const isolationLiftQuery = z.object({
  reason: z.string().min(1).max(1000),
});

const resocializationBody = z.object({
  target_id: uuidSchema,
  program: z.record(z.unknown())
    .refine((p) => JSON.stringify(p).length <= 100_000, {
      message: 'program ≤ 100KB',
    }),
  mentors: z.array(uuidSchema).max(20).optional(),
});

// B6: not_imputable исключён — только через POST /justice/not-imputable
// (требует 20/24 голосов Жюри, I.2.5.1).
const sanctionBody = z.object({
  target_id: uuidSchema,
  type: z.enum(['restorative_talk', 'temporary_isolation', 'resocialization', 'exclusion']),
  basis: z.string().min(1).max(2000),
});

const redCircuitBody = z.object({
  reason: z.string().min(1).max(2000),
});

const notImputableBody = z.object({
  target_id: uuidSchema,
  decision_ref: uuidSchema,
});

// B8: Zod для validate-collective.
const collectiveBody = z.object({
  relatives: z.array(uuidSchema).max(50),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerJusticeRoutes(app: FastifyInstance): Promise<void> {
  // ─── Заявления ─────────────────────────────────────────
  // POST — self-service (любой участник, I.2.2).
  app.post(
    '/justice/complaints',
    { preHandler: [authMiddleware, writeLimit, validateBody(complaintBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof complaintBody>;
      const c = await fileComplaint(b, auth.participantId);
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  // GET — justice:V (Justice + Architect видят все).
  app.get(
    '/justice/complaints',
    {
      preHandler: [
        authMiddleware,
        requireRight('justice', 'V'),
        validateQuery(complaintListQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof complaintListQuery>;
      const list = await listComplaints({
        ...(q.status ? { status: q.status } : {}),
        page: q.page, perPage: q.per_page,
      });
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.get(
    '/justice/complaints/:id',
    { preHandler: [authMiddleware, requireRight('justice', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const c = await getComplaint(p.id);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // ─── Расследования ─────────────────────────────────────
  // overdue — ДО :id (defensive).
  app.get(
    '/justice/investigations/overdue',
    { preHandler: [authMiddleware, requireRight('justice', 'V')] },
    async (req, reply) => {
      const list = await listOverdueInvestigations();
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.post(
    '/justice/investigations',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('justice', 'C'),
        validateBody(investigationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof investigationBody>;
      const i = await startInvestigation({
        complaintId: b.complaint_id,
        targetId: b.target_id,
        ...(b.investigator_ids ? { investigatorIds: b.investigator_ids } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...i, audit_id: req.auditId });
    },
  );

  app.get(
    '/justice/investigations/:id',
    { preHandler: [authMiddleware, requireRight('justice', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const i = await getInvestigation(p.id);
      reply.send({ ...i, audit_id: req.auditId });
    },
  );

  app.post(
    '/justice/investigations/:id/close',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateParams(uuidIdParams), validateBody(investigationCloseBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof investigationCloseBody>;
      const i = await closeInvestigation(p.id, b.result, auth.participantId);
      reply.send({ ...i, audit_id: req.auditId });
    },
  );

  app.post(
    '/justice/investigations/:id/extend',
    { preHandler: [authMiddleware, writeLimit, requireRight('justice', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const i = await extendInvestigation(p.id, auth.participantId);
      reply.send({ ...i, audit_id: req.auditId });
    },
  );

  app.post(
    '/justice/investigations/:id/audit',
    { preHandler: [authMiddleware, writeLimit, requireRight('justice', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const r = await auditProcess(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  app.post(
    '/justice/investigations/:id/coordinate-red-circuit',
    { preHandler: [authMiddleware, writeLimit, requireRight('justice', 'E'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const r = await coordinateWithRedCircuit(p.id, auth.participantId);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // B8: Zod для relatives.
  app.post(
    '/justice/investigations/:id/validate-collective',
    {
      preHandler: [
        authMiddleware,
        requireRight('justice', 'V'),
        validateParams(uuidIdParams),
        validateBody(collectiveBody),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof collectiveBody>;
      const i = await getInvestigation(p.id);
      const r = await validateCollective(i.targetId, b.relatives);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Изоляция ──────────────────────────────────────────
  app.post(
    '/justice/isolation',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateBody(isolationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof isolationBody>;
      const iso = await imposeIsolation({
        targetId: b.target_id,
        validTo: b.valid_to,
        conditions: b.conditions,
      }, auth.participantId);
      reply.status(201).send({ ...iso, audit_id: req.auditId });
    },
  );

  // B7: DELETE — reason в query.
  app.delete(
    '/justice/isolation/:id',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateParams(uuidIdParams), validateQuery(isolationLiftQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const q = req.query as z.infer<typeof isolationLiftQuery>;
      await liftIsolation(p.id, q.reason, auth.participantId);
      reply.status(204).send();
    },
  );

  // ─── Ресоциализация ────────────────────────────────────
  app.post(
    '/justice/resocialization',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateBody(resocializationBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof resocializationBody>;
      const r = await createResocialization({
        targetId: b.target_id,
        program: b.program,
        ...(b.mentors ? { mentors: b.mentors } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Санкции ───────────────────────────────────────────
  app.post(
    '/justice/sanctions',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateBody(sanctionBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof sanctionBody>;
      const s = await createSanction({
        targetId: b.target_id,
        type: b.type,
        basis: b.basis,
      }, auth.participantId);
      reply.status(201).send({ ...s, audit_id: req.auditId });
    },
  );

  // not_imputable — только через этот endpoint (требует 20/24 Жюри).
  app.post(
    '/justice/not-imputable',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateBody(notImputableBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof notImputableBody>;
      const s = await createNotImputable(b.target_id, b.decision_ref, auth.participantId);
      reply.status(201).send({ ...s, audit_id: req.auditId });
    },
  );

  // ─── Красный Контур ────────────────────────────────────
  app.post(
    '/justice/red-circuit',
    {
      preHandler: [
        authMiddleware, writeLimit, requireRight('justice', 'E'),
        validateBody(redCircuitBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof redCircuitBody>;
      const r = await activateRedCircuit(b.reason, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Права жертвы ──────────────────────────────────────
  app.get(
    '/justice/victim-rights/:participant_id',
    {
      preHandler: [
        authMiddleware, requireRight('justice', 'V'),
        validateParams(participantParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof participantParams>;
      const r = await getVictimRights(p.participant_id);
      reply.send({ ...r, audit_id: req.auditId });
    },
  );
}