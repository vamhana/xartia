// A.1.34.01 — Контроллер Connectivity
//
// v0.0.02:
//   - P1: импорт requireRight + assertRight.
//   - P2: GET /queue — self-service (direction_id === auth.directionId)
//         без прав; иначе — assertRight('connectivity', 'V').
//         (requireRight — preHandler, нельзя вызывать как обычную async
//          функцию из другого preHandler; assertRight — обычная функция.)
//   - P3: GET /overdue — requireRight('connectivity', 'V').
//   - P4: POST /prefilter — requireRight('connectivity', 'C').
//   - P5: POST /escalate — requireRight('connectivity', 'E').
//   - P6: GET /protocol — requireRight('connectivity', 'V').
//   - P7: POST /check-timeouts — requireRight('connectivity', 'Act').
//   - P8: GET /stats — requireRight('connectivity', 'V').

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getQueue, getOverdue, prefilterSignal, escalateItem,
  checkTimeouts, getStats, listBySignal,
} from '../../core/connectivity/service.js';
import { assertRight } from '../../core/rights.js';
import { uuidSchema, prioritySchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateQuery } from '../middleware/validation.js';

const signalParams = z.object({ signal_id: uuidSchema });

const queueQuery = z.object({
  priority: prioritySchema.optional(),
  status: z.enum(['queued', 'routed', 'overdue', 'escalated']).optional(),
  direction_id: uuidSchema.optional(),
});



export async function registerConnectivityRoutes(app: FastifyInstance): Promise<void> {
  // P2: Self-service, если запрошено своё направление; иначе — connectivity:V.
  // NB: auth.directionId — из JWT. У Архитектора (wildcard) directionId = null,
  // поэтому isSelf = false, всегда assertRight → проходит по wildcard.
  app.get(
    '/connectivity/queue',
    {
      preHandler: [
        authMiddleware,
        async (req, _reply) => {
          const q = req.query as Partial<z.infer<typeof queueQuery>>;
          const auth = getAuthContext(req);
          const isSelf =
            q.direction_id !== undefined &&
            q.direction_id === auth.directionId;
          if (!isSelf) {
            await assertRight({
              participantId: auth.participantId,
              resource: 'connectivity',
              action: 'V',
            });
          }
        },
        validateQuery(queueQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof queueQuery>;
      const items = await getQueue({
        ...(q.priority ? { priority: q.priority } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
      });
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // P3: connectivity:V.
  app.get(
    '/connectivity/overdue',
    { preHandler: [authMiddleware, requireRight('connectivity', 'V')] },
    async (req, reply) => {
      const items = await getOverdue();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // P4: connectivity:C (мутирующий prefilter).
  app.post(
    '/connectivity/prefilter',
    {
      preHandler: [
        authMiddleware,
        requireRight('connectivity', 'C'),
        validateBody(z.object({ signal_id: uuidSchema })),
      ],
    },
    async (req, reply) => {
      const b = req.body as { signal_id: string };
      const result = await prefilterSignal(b.signal_id);
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // P5: connectivity:E (эскалация — эскалирующее действие).
  app.post(
    '/connectivity/escalate',
    {
      preHandler: [
        authMiddleware,
        requireRight('connectivity', 'E'),
        validateBody(z.object({ item_id: uuidSchema, reason: z.string().min(1) })),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as { item_id: string; reason: string };
      const item = await escalateItem(b.item_id, b.reason, auth.participantId);
      reply.status(201).send({ ...item, audit_id: req.auditId });
    },
  );

  // P6: connectivity:V.
  app.get(
    '/connectivity/protocol',
    {
      preHandler: [
        authMiddleware,
        requireRight('connectivity', 'V'),
        validateQuery(signalParams),
      ],
    },
    async (req, reply) => {
      const q = req.query as z.infer<typeof signalParams>;
      const items = await listBySignal(q.signal_id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // P7: connectivity:Act (cron-задача, мутирующий пересчёт таймаутов).
  app.post(
    '/connectivity/check-timeouts',
    { preHandler: [authMiddleware, requireRight('connectivity', 'Act')] },
    async (req, reply) => {
      const result = await checkTimeouts();
      reply.send({ ...result, audit_id: req.auditId });
    },
  );

  // P8: connectivity:V.
  app.get(
    '/connectivity/stats',
    { preHandler: [authMiddleware, requireRight('connectivity', 'V')] },
    async (req, reply) => {
      const stats = await getStats();
      reply.send({ ...stats, audit_id: req.auditId });
    },
  );
}