// A.1.20.01 — Контроллер Archive
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams/chainParams → uuidIdParams/uuidChainParams.
//   - 7 мутаций — rateLimit(api.write).
//   - 6 GET — +requireRight('archive','V') (PII: content, ID registry).
//   - content: +refine(JSON ≤ 100KB).
//   - POST /:id/sign: signBody БЕЗ keeper_id — подписант = auth.participantId (B1).
//     (breaking change, spec v0.0.02).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - POST /archive/ids/sync, GET /archive/attributes/:signal_id — roadmap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listDocuments, getDocument, archiveService, signDocumentService, searchDocuments,
  addChainStepService, getChain, rebuildChainService,
  registerIdService, linkGlobalIdService, listIdRegistry,
  crossCheckService, reportPressureService,
} from '../../core/archive/service.js';
import { uuidIdParams, uuidChainParams, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  type: z.enum(['protocol', 'decision', 'act', 'report', 'journal']).optional(),
  direction_id: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const createBody = z.object({
  type: z.enum(['protocol', 'decision', 'act', 'report', 'journal']),
  direction_id: uuidSchema,
  subject: z.string().min(1).max(255),
  content: z.record(z.unknown())
    .refine((c) => JSON.stringify(c).length <= 100_000, {
      message: 'content: JSON ≤ 100KB',
    }),
});

// B1: keeper_id убран из body — подписант = auth.participantId.
const signBody = z.object({}).strict();  // пустой объект; strict → 422 при лишних полях

const searchQuery = z.object({ q: z.string().min(1).max(200) });

const chainStepBody = z.object({
  chain_id: uuidSchema,
  type: z.enum(['problem', 'request', 'response', 'decision', 'realization', 'result', 'correction']),
  ref_id: uuidSchema,
  description: z.string().min(1).max(2000),
});

const registerIdBody = z.object({
  participant_id: uuidSchema,
  external_id: z.string().min(1).max(32),
});

const linkGlobalBody = z.object({
  community_code: z.string().regex(/^[А-Я]{2}$/),
  global_id: z.string().min(1).max(64),
});

const crossCheckBody = z.object({
  document_a_id: uuidSchema,
  document_b_id: uuidSchema,
});

const pressureBody = z.object({ description: z.string().min(1).max(2000) });

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerArchiveRoutes(app: FastifyInstance): Promise<void> {
  // ─── Документы ───────────────────────────────────────────
  app.get(
    '/archive',
    { preHandler: [authMiddleware, requireRight('archive', 'V'), validateQuery(listQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof listQuery>;
      const result = await listDocuments({
        ...(q.type ? { type: q.type } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
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
    '/archive/search',
    { preHandler: [authMiddleware, requireRight('archive', 'V'), validateQuery(searchQuery)] },
    async (req, reply) => {
      const q = req.query as z.infer<typeof searchQuery>;
      const items = await searchDocuments(q.q);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/archive/ids',
    { preHandler: [authMiddleware, requireRight('archive', 'V')] },
    async (req, reply) => {
      const items = await listIdRegistry();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/archive/chains/:chain_id',
    { preHandler: [authMiddleware, requireRight('archive', 'V'), validateParams(uuidChainParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidChainParams>;
      const items = await getChain(p.chain_id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/archive/chains/:chain_id/rebuild',
    { preHandler: [authMiddleware, requireRight('archive', 'V'), validateParams(uuidChainParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidChainParams>;
      const result = await rebuildChainService(p.chain_id);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  app.get(
    '/archive/:id',
    { preHandler: [authMiddleware, requireRight('archive', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const d = await getDocument(p.id);
      reply.send({ ...d, audit_id: req.auditId });
    },
  );

  app.post(
    '/archive',
    { preHandler: [authMiddleware, writeLimit, requireRight('archive', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const d = await archiveService({
        type: b.type,
        directionId: b.direction_id,
        subject: b.subject,
        content: b.content,
      }, auth.participantId);
      reply.status(201).send({ ...d, audit_id: req.auditId });
    },
  );

  // B1-fix: keeper = auth.participantId (не из body).
  app.post(
    '/archive/:id/sign',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('archive', 'S'),
        validateParams(uuidIdParams),
        validateBody(signBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const result = await signDocumentService(p.id, auth.participantId);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // ─── Цепочки ─────────────────────────────────────────────
  app.post(
    '/archive/chains',
    { preHandler: [authMiddleware, writeLimit, requireRight('archive', 'C'), validateBody(chainStepBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof chainStepBody>;
      const step = await addChainStepService({
        chainId: b.chain_id,
        type: b.type,
        refId: b.ref_id,
        description: b.description,
      }, auth.participantId);
      reply.status(201).send({ ...step, audit_id: req.auditId });
    },
  );

  // ─── Реестр ID ───────────────────────────────────────────
  app.post(
    '/archive/ids',
    { preHandler: [authMiddleware, writeLimit, requireRight('archive', 'C'), validateBody(registerIdBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof registerIdBody>;
      const entry = await registerIdService(b.participant_id, b.external_id, auth.participantId);
      reply.status(201).send({ ...entry, audit_id: req.auditId });
    },
  );

  app.post(
    '/archive/ids/:id/link-global',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('archive', 'E'),
        validateParams(uuidIdParams),
        validateBody(linkGlobalBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof linkGlobalBody>;
      const entry = await linkGlobalIdService(p.id, b.community_code, b.global_id, auth.participantId);
      reply.send({ ...entry, audit_id: req.auditId });
    },
  );

  // ─── Сверка ──────────────────────────────────────────────
  app.post(
    '/archive/cross-check',
    { preHandler: [authMiddleware, writeLimit, requireRight('archive', 'C'), validateBody(crossCheckBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof crossCheckBody>;
      const result = await crossCheckService(b.document_a_id, b.document_b_id, auth.participantId);
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );

  // ─── Давление на Хранителя ───────────────────────────────
  app.post(
    '/archive/pressure',
    { preHandler: [authMiddleware, writeLimit, requireRight('archive', 'S'), validateBody(pressureBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof pressureBody>;
      const result = await reportPressureService(auth.participantId, b.description);
      reply.status(201).send({ ...result, audit_id: req.auditId });
    },
  );
}