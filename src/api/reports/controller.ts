// A.1.08.01 — Контроллер Reports
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - idParams/taskParams → uuidIdParams/uuidTaskParams из L.0.01.03.
//   - GET /reports*, /tasks/:id/reports, /participants/:id/reports —
//     + requireRight('report','V') (было: любой авторизованный читал любой
//     отчёт с media/geolocation/comment).
//   - media_url: + max(2048).
//   - geolocation: + min/max (lat -90..90, lon -180..180).
//   - rateLimit(api.write) на POST.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - listByTask/listByParticipant — без пагинации (много отчётов у участника).
//   - MASTER (наставник) не имеет report:V — не увидит отчёты менти.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  createReportService, getById, listByTask, listByParticipant,
} from '../../core/reports/service.js';
import { uuidIdParams, uuidTaskParams } from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams } from '../middleware/validation.js';

const createBody = z.object({
  type: z.enum(['photo', 'video', 'text']),
  comment: z.string().min(1).max(5000).optional(),
  media_url: z.string().url().max(2048).optional(),   // ← max
  // Ссылка на результат работы: PR, коммит, документ.
  artifact_url: z.string().url().max(2048).optional(),
  geolocation: z.object({
    lat: z.number().min(-90).max(90),                // ← range
    lon: z.number().min(-180).max(180),
  }).optional(),
});

const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

export async function registerReportsRoutes(app: FastifyInstance): Promise<void> {
  // POST /tasks/:task_id/reports — self-service (assignee only, в сервисе).
  app.post(
    '/tasks/:task_id/reports',
    { preHandler: [authMiddleware, writeLimit, validateParams(uuidTaskParams), validateBody(createBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof uuidTaskParams>;
      const b = req.body as z.infer<typeof createBody>;
      const report = await createReportService({
        taskId: p.task_id,
        type: b.type,
        ...(b.comment ? { comment: b.comment } : {}),
        ...(b.media_url ? { mediaUrl: b.media_url } : {}),
        ...(b.artifact_url ? { artifactUrl: b.artifact_url } : {}),
        ...(b.geolocation ? { geolocation: b.geolocation } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...report, audit_id: req.auditId });
    },
  );

  // GET /tasks/:task_id/reports — requires report:V
  app.get(
    '/tasks/:task_id/reports',
    { preHandler: [authMiddleware, requireRight('report', 'V'), validateParams(uuidTaskParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidTaskParams>;
      const reports = await listByTask(p.task_id);
      reply.send({ data: reports, audit_id: req.auditId });
    },
  );

  // GET /reports/:id — requires report:V
  app.get(
    '/reports/:id',
    { preHandler: [authMiddleware, requireRight('report', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const report = await getById(p.id);
      reply.send({ ...report, audit_id: req.auditId });
    },
  );

  // GET /participants/:id/reports — requires report:V
  app.get(
    '/participants/:id/reports',
    { preHandler: [authMiddleware, requireRight('report', 'V'), validateParams(uuidIdParams)] },
    async (req, reply) => {
      const p = req.params as z.infer<typeof uuidIdParams>;
      const reports = await listByParticipant(p.id);
      reply.send({ data: reports, audit_id: req.auditId });
    },
  );
}