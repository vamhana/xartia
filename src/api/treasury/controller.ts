// A.1.47.01 — Контроллер казны (XartIA 5.0).
//
// Пол 1.00, NAV-цена, выручка Шлюза 60/30/10, траты через мультисиг 3-из-5.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  approveSpend,
  getSpendRequest,
  getTreasuryState,
  getSignatories,
  listOperations,
  listSpendRequests,
  recordRevenue,
  redeemUnits,
  requestSpend,
} from '../../core/treasury/service.js';
import { uuidIdParams } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const revenueBody = z.object({
  amount_usdc: z.number().positive().max(1_000_000_000),
  gateway_transaction_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

const redeemBody = z.object({
  amount_units: z.number().positive().max(1e18),
  note: z.string().max(500).optional(),
});

const spendBody = z.object({
  amount_usdc: z.number().positive().max(1_000_000_000),
  purpose: z.string().min(1).max(500),
});

export async function registerTreasuryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/treasury/state', { preHandler: [authMiddleware] }, async (req, reply) => {
    const state = await getTreasuryState();
    reply.send({ ...state, audit_id: req.auditId });
  });

  app.get('/treasury/signatories', { preHandler: [authMiddleware] }, async (req, reply) => {
    const data = await getSignatories();
    reply.send({ data, audit_id: req.auditId });
  });

  app.get('/treasury/operations', { preHandler: [authMiddleware] }, async (req, reply) => {
    const data = await listOperations(100);
    reply.send({ data, audit_id: req.auditId });
  });

  app.get('/treasury/spend-requests', { preHandler: [authMiddleware] }, async (req, reply) => {
    const data = await listSpendRequests();
    reply.send({ data, audit_id: req.auditId });
  });

  app.post(
    '/treasury/revenue',
    {
      preHandler: [
        authMiddleware,
        requireRight('flow', 'C'),
        validateBody(revenueBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof revenueBody>;
      const state = await recordRevenue({
        amountUsdc: body.amount_usdc,
        actorId: auth.participantId,
        gatewayTransactionId: body.gateway_transaction_id ?? null,
        note: body.note ?? null,
      });
      reply.status(201).send({ ...state, audit_id: req.auditId });
    },
  );

  app.post(
    '/treasury/redeem',
    {
      preHandler: [authMiddleware, requireRight('flow', 'C'), validateBody(redeemBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof redeemBody>;
      const state = await redeemUnits({
        amountUnits: body.amount_units,
        actorId: auth.participantId,
        note: body.note ?? null,
      });
      reply.send({ ...state, audit_id: req.auditId });
    },
  );

  app.post(
    '/treasury/spend',
    {
      preHandler: [authMiddleware, requireRight('flow', 'C'), validateBody(spendBody)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const body = req.body as z.infer<typeof spendBody>;
      const request = await requestSpend({
        amountUsdc: body.amount_usdc,
        purpose: body.purpose,
        actorId: auth.participantId,
      });
      reply.status(201).send({ ...request, audit_id: req.auditId });
    },
  );

  app.post(
    '/treasury/spend-requests/:id/approve',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const request = await approveSpend({
        requestId: p.id,
        participantId: auth.participantId,
      });
      reply.send({ ...request, audit_id: req.auditId });
    },
  );

  app.get(
    '/treasury/spend-requests/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const request = await getSpendRequest(p.id);
      reply.send({ ...request, audit_id: req.auditId });
    },
  );
}
