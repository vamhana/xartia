// A.1.19.01 — Контроллер Verification
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams/decisionParams → uuidIdParams/uuidDecisionParams.
//   - 7 мутаций — rateLimit(api.write).
//   - 5 GET — +requireRight('audit','V') (PII: findings/severity/recommendation,
//     integrity alerts).
//   - codeAuditBody.findings / integrityBody.details — +refine(JSON ≤ 100KB).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - POST /verification/gateway-audit, /process-audit — roadmap.
//   - suspendGatewayDecisions — заглушка (возвращает 1, ничего не делает).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listAudits, getAudit, createAuditService, addFindingService, closeAuditService,
  listOverdueAudits, recheckService, getRecheckStats, codeAuditService,
  reportIntegrityAlertService, getActiveAlerts, suspendGatewayDecisions,
} from '../../core/verification/service.js';
import {
  uuidIdParams,
  uuidDecisionParams,
  uuidSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  type: z.enum(['planned', 'unplanned', 'procedural', 'request']).optional(),
  status: z.enum(['open', 'in_progress', 'finished']).optional(),
  subject: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  type: z.enum(['planned', 'unplanned', 'procedural', 'request']),
  subject: z.string().min(1).max(128),
  subject_id: uuidSchema.optional(),
});

const findingBody = z.object({
  finding: z.string().min(1).max(5000),
  severity: z.number().int().min(1).max(10),
  recommendation: z.string().min(1).max(5000),
});

const closeBody = z.object({ result: z.string().min(1).max(5000) });

const recheckBody = z.object({
  matches: z.boolean(),
  comment: z.string().max(2000).optional(),
});

const codeAuditBody = z.object({
  system: z.enum(['prefix_filter', 'balance', 'digital_mentor', 'other']),
  version: z.string().min(1).max(64),
  findings: z.record(z.unknown())
    .refine((f) => JSON.stringify(f).length <= 100_000, {
      message: 'findings: JSON ≤ 100KB',
    }),
});

const integrityBody = z.object({
  system: z.string().min(1).max(128),
  source_node: z.string().min(1).max(128),
  action: z.enum(['digital_attack', 'modification_attempt']),
  details: z.record(z.unknown())
    .refine((d) => JSON.stringify(d).length <= 100_000, {
      message: 'details: JSON ≤ 100KB',
    })
    .default({}),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerVerificationRoutes(app: FastifyInstance): Promise<void> {
  // ─── Аудиты ───────────────────────────────────────────────
  app.get(
    '/verification/audits',
    { preHandler: [authMiddleware, requireRight('audit', 'V'), validateQuery(listQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const result = await listAudits({
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.subject ? { subject: q.subject } : {}),
        page: q.page, perPage: q.per_page,
      });
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  app.get(
    '/verification/audits/overdue',
    { preHandler: [authMiddleware, requireRight('audit', 'V')] },
    async (req, reply) => {
      const items = await listOverdueAudits();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/verification/audits/:id',
    { preHandler: [authMiddleware, requireRight('audit', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const a = await getAudit(p.id);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/verification/audits',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'C'),
        validateBody(createBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const a = await createAuditService({
        type: b.type,
        subject: b.subject,
        ...(b.subject_id ? { subjectId: b.subject_id } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...a, audit_id: req.auditId });
    },
  );

  app.post(
    '/verification/audits/:id/finding',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'E'),
        validateParams(uuidIdParams),
        validateBody(findingBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof findingBody>;
      const f = await addFindingService(p.id, b.finding, b.severity, b.recommendation, auth.participantId);
      reply.status(201).send({ ...f, audit_id: req.auditId });
    },
  );

  app.post(
    '/verification/audits/:id/close',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'E'),
        validateParams(uuidIdParams),
        validateBody(closeBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof closeBody>;
      const a = await closeAuditService(p.id, b.result, auth.participantId);
      reply.send({ ...a, audit_id: req.auditId });
    },
  );

  // ─── Перепроверка ОТК ────────────────────────────────────
  app.post(
    '/verification/rechecks/:decision_id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'C'),
        validateParams(uuidDecisionParams),
        validateBody(recheckBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidDecisionParams>;
      const b = req.body as z.infer<typeof recheckBody>;
      const r = await recheckService(p.decision_id, b.matches, b.comment ?? null, auth.participantId);
      reply.status(201).send({ ...r, audit_id: req.auditId });
    },
  );

  app.get(
    '/verification/rechecks/stats',
    { preHandler: [authMiddleware, requireRight('audit', 'V')] },
    async (req, reply) => {
      const stats = await getRecheckStats();
      reply.send({ ...stats, audit_id: req.auditId });
    },
  );

  // ─── Аудит кода ──────────────────────────────────────────
  app.post(
    '/verification/code-audits',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'C'),
        validateBody(codeAuditBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof codeAuditBody>;
      const c = await codeAuditService(b.system, b.version, b.findings, auth.participantId);
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  // ─── Integrity alerts ────────────────────────────────────
  app.post(
    '/verification/integrity-alerts',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('audit', 'C'),
        validateBody(integrityBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof integrityBody>;
      const alert = await reportIntegrityAlertService(b.system, b.source_node, b.action, b.details, auth.participantId);
      reply.status(201).send({ ...alert, audit_id: req.auditId });
    },
  );

  app.get(
    '/verification/integrity-alerts',
    { preHandler: [authMiddleware, requireRight('audit', 'V')] },
    async (req, reply) => {
      const items = await getActiveAlerts();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // ─── Gateway suspend ─────────────────────────────────────
  app.post(
    '/verification/gateway-suspend',
    { preHandler: [authMiddleware, writeLimit, requireRight('audit', 'A')] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const result = await suspendGatewayDecisions(auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );
}