// A.1.22.01 — Контроллер Jury
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: +requireRight('jury','V') на 3 GET (sessions/:id, votes, outside-trust).
//   - B2: voteService получает auth.participantId (4-й арг) — проверка «модератор/self».
//   - exclude_ids: +max(50).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - POST /jury/sessions/:id/veto — roadmap (в semantic).
//   - GET /jury/appeals/:id — roadmap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createSession, getSession, voteService, decideService, countVotesService,
  assignOutsideTrustService, getOutsideTrust, reviewOutsideTrust, createAppeal,
} from '../../core/jury/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const idParams = z.object({ id: uuidSchema });
const pidParams = z.object({ participant_id: uuidSchema });

const createBody = z.object({
  type: z.enum(['normal_12', 'extended_24']),
  subject_id: uuidSchema,
  exclude_ids: z.array(uuidSchema).max(50).optional(),
});

const voteBody = z.object({
  participant_id: uuidSchema.optional(),
  vote: z.enum(['yes', 'no', 'abstain']),
});

const decideBody = z.object({ decision: z.string().min(1).max(5000) });

const outsideBody = z.object({
  participant_id: uuidSchema,
  reason: z.string().min(1).max(2000),
});

const appealBody = z.object({
  jury_session_id: uuidSchema.nullable(),
  council_type: z.string().min(1).max(64),
  subject_id: uuidSchema,
});

export async function registerJuryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/jury/sessions',
    { preHandler: [authMiddleware, requireRight('jury', 'C'), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const session = await createSession({
        type: b.type,
        subjectId: b.subject_id,
        ...(b.exclude_ids ? { excludeIds: b.exclude_ids } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...session, audit_id: req.auditId });
    },
  );

  // B1: requireRight('jury','V')
  app.get(
    '/jury/sessions/:id',
    { preHandler: [authMiddleware, requireRight('jury', 'V'), validateParams(idParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const s = await getSession(p.id);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // B2: voteService получает auth.participantId для проверки модератора.
  app.post(
    '/jury/sessions/:id/vote',
    { preHandler: [authMiddleware, validateParams(idParams), validateBody(voteBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof voteBody>;
      const voterId = b.participant_id ?? auth.participantId;
      const s = await voteService(p.id, voterId, b.vote, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  app.post(
    '/jury/sessions/:id/decision',
    {
      preHandler: [
        authMiddleware,
        requireRight('jury', 'Act'),
        validateParams(idParams),
        validateBody(decideBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const b = req.body as z.infer<typeof decideBody>;
      const s = await decideService(p.id, b.decision, auth.participantId);
      reply.send({ ...s, audit_id: req.auditId });
    },
  );

  // B1: requireRight('jury','V')
  app.get(
    '/jury/sessions/:id/votes',
    { preHandler: [authMiddleware, requireRight('jury', 'V'), validateParams(idParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof idParams>;
      const counts = await countVotesService(p.id);
      reply.send({ ...counts, audit_id: req.auditId });
    },
  );

  app.post(
    '/jury/outside-trust-network',
    {
      preHandler: [
        authMiddleware,
        requireRight('jury', 'C'),
        validateBody(outsideBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof outsideBody>;
      const ot = await assignOutsideTrustService(b.participant_id, b.reason, auth.participantId);
      reply.status(201).send({ ...ot, audit_id: req.auditId });
    },
  );

  // B1: requireRight('jury','V')
  app.get(
    '/jury/outside-trust-network/:participant_id',
    {
      preHandler: [
        authMiddleware,
        requireRight('jury', 'V'),
        validateParams(pidParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof pidParams>;
      const ot = await getOutsideTrust(p.participant_id);
      reply.send({ data: ot, audit_id: req.auditId });
    },
  );

  app.post(
    '/jury/outside-trust-network/:participant_id/review',
    {
      preHandler: [
        authMiddleware,
        requireRight('jury', 'E'),
        validateParams(pidParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof pidParams>;
      const ot = await reviewOutsideTrust(p.participant_id, auth.participantId);
      reply.send({ ...ot, audit_id: req.auditId });
    },
  );

  app.post(
    '/jury/appeals',
    { preHandler: [authMiddleware, validateBody(appealBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof appealBody>;
      const appeal = await createAppeal(
        b.jury_session_id,
        b.council_type,
        b.subject_id,
        auth.participantId,
      );
      reply.status(201).send({ ...appeal, audit_id: req.auditId });
    },
  );
}