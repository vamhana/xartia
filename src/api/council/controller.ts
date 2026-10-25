// A.1.46.01 — Контроллер Совета направления.
//
// Совет — не должность, а функция: самый опытный участник направления с
// обязательной ротацией. Поэтому здесь только выборы, просмотр и
// дисквалификация; сама роль выдаётся через S.0.01.03.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  disqualifyCouncilMember,
  electCouncil,
  getCouncilHistory,
  getCouncilState,
  listCouncils,
} from '../../core/council/service.js';
import { uuidIdParams, uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const reasonBody = z.object({ reason: z.string().min(1).max(500) });
const disqualifyParams = uuidIdParams.extend({ participant_id: uuidSchema });

export async function registerCouncilRoutes(app: FastifyInstance): Promise<void> {
  // GET /council — состояние советов по всем направлениям.
  app.get('/council', { preHandler: [authMiddleware] }, async (req, reply) => {
    const data = await listCouncils();
    reply.send({ data, audit_id: req.auditId });
  });

  // GET /council/:id — совет конкретного направления.
  app.get(
    '/council/:id',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const state = await getCouncilState(p.id);
      reply.send({ ...state, audit_id: req.auditId });
    },
  );

  // GET /council/:id/history — история выборов и дисквалификаций.
  app.get(
    '/council/:id/history',
    { preHandler: [authMiddleware, validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const history = await getCouncilHistory(p.id);
      reply.send({ ...history, audit_id: req.auditId });
    },
  );

  // POST /council/:id/elect — переизбрать (ротация).
  app.post(
    '/council/:id/elect',
    {
      preHandler: [authMiddleware, requireRight('direction', 'E'), validateParams(uuidIdParams)],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const state = await electCouncil(p.id, auth.participantId);
      reply.send({ ...state, audit_id: req.auditId });
    },
  );

  // POST /council/:id/disqualify/:participant_id — снять с причиной.
  app.post(
    '/council/:id/disqualify/:participant_id',
    {
      preHandler: [
        authMiddleware,
        requireRight('direction', 'E'),
        validateParams(disqualifyParams),
        validateBody(reasonBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as { id: string; participant_id: string };
      const b = req.body as { reason: string };
      const state = await disqualifyCouncilMember({
        directionId: p.id as never,
        participantId: p.participant_id as never,
        reason: b.reason,
        requesterId: auth.participantId,
      });
      reply.send({ ...state, audit_id: req.auditId });
    },
  );
}
