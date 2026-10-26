// A.1.10.10 — Предложения изменений ядра.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createProposal,
  listProposals,
  getProposal,
  listInvariants,
  startDiscussion,
  addObjection,
  resolveObjection,
  decideProposal,
  markImplemented,
  acceptImplementation,
  withdrawProposal,
} from '../../core/proposals/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

const listQuery = z.object({
  status: z.string().max(32).optional(),
  type: z.enum(['module', 'rule', 'meta', 'charter']).optional(),
  mine: z.coerce.boolean().optional(),
});

const createBody = z.object({
  type: z.enum(['module', 'rule', 'meta', 'charter']),
  title: z.string().min(5).max(255),
  problem: z.string().min(20).max(20000),
  proposal: z.string().min(20).max(50000),
  alternatives: z.string().max(20000).optional(),
  discussion_url: z.string().url().max(2048).optional(),
  invariants: z.array(z.string().min(1).max(64)).max(50).optional(),
  breaking: z.boolean().optional(),
});

const discussionBody = z.object({ days: z.number().int().min(1).max(30).optional() });

const objectionBody = z.object({
  kind: z.enum(['factual', 'conceptual', 'compatibility']),
  text: z.string().min(10).max(10000),
});

const objectionParams = uuidIdParams.extend({ objection_id: uuidSchema });

const resolveBody = z.object({
  status: z.enum(['addressed', 'rejected']),
  resolution: z.string().min(5).max(10000),
});

const decideBody = z.object({
  outcome: z.enum(['accepted', 'rejected']),
  rationale: z.string().min(20).max(20000),
  method: z.enum(['council', 'architect', 'consent', 'vote']).optional(),
});

const implementBody = z.object({ pr_url: z.string().url().max(2048) });

export async function registerProposalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invariants', { preHandler: [authMiddleware] }, async (req, reply) => {
    reply.send({ data: await listInvariants(), audit_id: req.auditId });
  });

  app.get(
    '/proposals',
    { preHandler: [authMiddleware, validateQuery(listQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listQuery>;
      const data = await listProposals({
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.mine ? { authorId: auth.participantId } : {}),
      });
      reply.send({ data, audit_id: req.auditId });
    },
  );

  app.get(
    '/proposals/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({ ...(await getProposal(p.id)), audit_id: req.auditId });
    },
  );

  app.post(
    '/proposals',
    { preHandler: [authMiddleware, validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof createBody>;
      const created = await createProposal({
        type: b.type,
        title: b.title,
        problem: b.problem,
        proposal: b.proposal,
        alternatives: b.alternatives ?? null,
        discussionUrl: b.discussion_url ?? null,
        invariants: b.invariants ?? [],
        breaking: b.breaking ?? false,
      }, auth.participantId);
      reply.status(201).send({ ...created, audit_id: req.auditId });
    },
  );

  app.post(
    '/proposals/:id/discussion',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(discussionBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof discussionBody>;
      reply.send({
        ...(await startDiscussion(p.id, b.days ?? 7, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/objections',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(objectionBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof objectionBody>;
      reply.send({
        ...(await addObjection(p.id, { kind: b.kind, text: b.text }, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/objections/:objection_id/resolve',
    {
      preHandler: [
        authMiddleware,
        validateParams(objectionParams),
        validateBody(resolveBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof objectionParams>;
      const b = req.body as z.infer<typeof resolveBody>;
      reply.send({
        ...(await resolveObjection(
          p.id, p.objection_id,
          { status: b.status, resolution: b.resolution },
          auth.participantId,
        )),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/decide',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(decideBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof decideBody>;
      reply.send({
        ...(await decideProposal(p.id, {
          outcome: b.outcome,
          rationale: b.rationale,
          ...(b.method ? { method: b.method } : {}),
        }, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/implement',
    { preHandler: [authMiddleware, validateParams(uuidIdParams), validateBody(implementBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof implementBody>;
      reply.send({
        ...(await markImplemented(p.id, b.pr_url, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/accept',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({
        ...(await acceptImplementation(p.id, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );

  app.post(
    '/proposals/:id/withdraw',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      reply.send({
        ...(await withdrawProposal(p.id, auth.participantId)),
        audit_id: req.auditId,
      });
    },
  );
}
