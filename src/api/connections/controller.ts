// A.1.11.01 — Контроллер Connections
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams/signalParams/directionParams → uuidIdParams/uuidSignalParams/
//     uuidDirectionParams из L.0.01.03 (12-14-й дубли).
//   - resultBody.result → connectionResultSchema из L.0.01.03.
//   - rateLimit(api.write) на 6 мутациях.
//   - GET /connections* — + requireRight('connection','V') (PII: positions/cause/protocol).
//   - protocolBody.protocol — + refine(JSON ≤ 100KB).
//   - recordPositionService получает auth.directionId — для B3-проверки.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - moderatorId из body — любой connection:C назначает любого модератора.
//     Проверка «модератор существует и имеет connection:E» — в roadmap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getById, getBySignal, startConnectionService, recordPositionService,
  finishDiagnosticsService, setResultService, attachProtocolService,
  listByDirection, listAll,
} from '../../core/connections/service.js';
import {
  uuidIdParams,
  uuidSignalParams,
  uuidDirectionParams,
  uuidSchema,
  connectionResultSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const startBody = z.object({
  signal_id: uuidSchema,
  moderator_id: uuidSchema,
});

const positionBody = z.object({
  direction_id: uuidSchema,
  claim: z.string().min(1).max(2000),
  data: z.string().min(1).max(5000),
  cause: z.string().min(1).max(2000),
  needs: z.string().min(1).max(2000),
});

const finishBody = z.object({ cause: z.string().min(1).max(2000) });

const resultBody = z.object({
  result: connectionResultSchema,   // ← T2
});

const protocolBody = z.object({
  protocol: z.record(z.unknown())
    .refine((p) => JSON.stringify(p).length <= 100_000, {
      message: 'protocol: JSON ≤ 100KB',   // ← T5
    }),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerConnectionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /connections — список (PII: positions/cause/protocol). connection:V.
  app.get(
    '/connections',
    { preHandler: [authMiddleware, requireRight('connection', 'V')] },
    async (req, reply) => {
      const items = await listAll();
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  app.get(
    '/connections/:id',
    { preHandler: [authMiddleware, requireRight('connection', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const c = await getById(p.id);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  app.get(
    '/connections/signal/:signal_id',
    { preHandler: [authMiddleware, requireRight('connection', 'V'), validateParams(uuidSignalParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidSignalParams>;
      const c = await getBySignal(p.signal_id);
      reply.send({ data: c, audit_id: req.auditId });
    },
  );

  app.get(
    '/connections/direction/:direction_id',
    { preHandler: [authMiddleware, requireRight('connection', 'V'), validateParams(uuidDirectionParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidDirectionParams>;
      const items = await listByDirection(p.direction_id);
      reply.send({ data: items, audit_id: req.auditId });
    },
  );

  // POST /connections (право: connection:C)
  app.post(
    '/connections',
    { preHandler: [authMiddleware, writeLimit, requireRight('connection', 'C'), validateBody(startBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body as z.infer<typeof startBody>;
      const c = await startConnectionService({
        signalId: b.signal_id,
        moderatorId: b.moderator_id,
      }, auth.participantId);
      reply.status(201).send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /connections/:id/position (право: connection:C).
  // B3-fix: передаём auth.directionId — позиция только за своё направление.
  app.post(
    '/connections/:id/position',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('connection', 'C'),
        validateParams(uuidIdParams),
        validateBody(positionBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof positionBody>;
      const c = await recordPositionService(p.id, {
        directionId: b.direction_id,
        claim: b.claim,
        data: b.data,
        cause: b.cause,
        needs: b.needs,
      }, auth.participantId, auth.directionId);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /connections/:id/diagnostic (право: connection:E)
  app.post(
    '/connections/:id/diagnostic',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('connection', 'E'),
        validateParams(uuidIdParams),
        validateBody(finishBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof finishBody>;
      const c = await finishDiagnosticsService(p.id, b.cause, auth.participantId);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /connections/:id/result (право: connection:E)
  app.post(
    '/connections/:id/result',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('connection', 'E'),
        validateParams(uuidIdParams),
        validateBody(resultBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof resultBody>;
      const c = await setResultService(p.id, b.result, auth.participantId);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );

  // POST /connections/:id/protocol (право: connection:E)
  app.post(
    '/connections/:id/protocol',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('connection', 'E'),
        validateParams(uuidIdParams),
        validateBody(protocolBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidIdParams>;
      const b = req.body as z.infer<typeof protocolBody>;
      const c = await attachProtocolService(p.id, b.protocol, auth.participantId);
      reply.send({ ...c, audit_id: req.auditId });
    },
  );
}