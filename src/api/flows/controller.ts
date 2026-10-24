// A.1.14.01 — Контроллер Flows
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: chargeBody.amount → +positive() (было: любое число → negative=withdraw в обход капсулы).
//   - B2: capsuleAmount.amount → +finite() (было: Infinity проходит Zod).
//   - B4: writeLimit(api.write) на 3 мутациях (deposit, withdraw, charge).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - getTransactions (GET /flows/transactions), scheduleReturn/processReturns — roadmap.
//   - GET /flows* — без requireRight (reference data, не PII).
//   - charge — participant existence check → 404 (сейчас FK 500).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getBalance, getCapsule, depositCapsule, withdrawCapsule,
  getReturns, getDeferredFlow, getFreedomReserve, getPlanetaryReserve,
  charge,
} from '../../core/flows/service.js';
import { flowTypeSchema, uuidSchema } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody } from '../middleware/validation.js';

const capsuleAmount = z.object({
  amount: z.number().positive().finite(),   // ← B2
});

const chargeBody = z.object({
  participant_id: uuidSchema,
  type: flowTypeSchema,
  amount: z.number().positive().finite(),   // ← B1
  reason: z.string().min(1).max(500),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });   // ← B4

export async function registerFlowsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/flows', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const balances = await getBalance(auth.participantId);
    reply.send({ data: balances, audit_id: req.auditId });
  });

  app.get('/flows/capsule', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const capsule = await getCapsule(auth.participantId);
    reply.send({ ...capsule, audit_id: req.auditId });
  });

  app.post(
    '/flows/capsule/deposit',
    { preHandler: [authMiddleware, writeLimit, validateBody(capsuleAmount)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof capsuleAmount>;
      const capsule = await depositCapsule(auth.participantId, body.amount, auth.participantId);
      reply.send({ ...capsule, audit_id: req.auditId });
    },
  );

  app.post(
    '/flows/capsule/withdraw',
    { preHandler: [authMiddleware, writeLimit, validateBody(capsuleAmount)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof capsuleAmount>;
      const capsule = await withdrawCapsule(auth.participantId, body.amount, auth.participantId);
      reply.send({ ...capsule, audit_id: req.auditId });
    },
  );

  app.get('/flows/returns', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const returns = await getReturns(auth.participantId);
    reply.send({ ...(returns ?? { percent: 30, nextReturnAt: null, status: 'none' }), audit_id: req.auditId });
  });

  app.get('/flows/deferred', { preHandler: authMiddleware }, async (req, reply) => {
    const data = await getDeferredFlow();
    reply.send({ ...data, audit_id: req.auditId });
  });

  app.get('/flows/freedom-reserve', { preHandler: authMiddleware }, async (req, reply) => {
    const data = await getFreedomReserve();
    reply.send({ ...data, audit_id: req.auditId });
  });

  app.get('/flows/planetary-reserve', { preHandler: authMiddleware }, async (req, reply) => {
    const data = await getPlanetaryReserve();
    reply.send({ ...data, audit_id: req.auditId });
  });

  app.post(
    '/flows/charge',
    { preHandler: [authMiddleware, writeLimit, requireRight('flow', 'C'), validateBody(chargeBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof chargeBody>;
      const tx = await charge({
        participantId: body.participant_id,
        type: body.type,
        amount: body.amount,
        reason: body.reason,
        source: `manual:${auth.participantId}`,
      }, auth.participantId);
      reply.status(201).send({ ...tx, audit_id: req.auditId });
    },
  );
}