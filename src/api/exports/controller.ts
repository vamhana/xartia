// A.1.92.01 — Контроллер Exports.
// 9 эндпоинтов. Асинхронная генерация через worker.
//
// Права: export (C для POST, V для GET, D для DELETE).
//
// Порядок регистрации КРИТИЧЕН: /exports/history и /exports/jobs —
// ДО /exports/jobs/:id. Иначе Fastify поймает "history"/"jobs" как UUID.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  isExportType,
  type ExportFormat,
  type ExportType,
  type ExportJobStatus,
} from '../../core/exports/entity.js';
import {
  createExport,
  getJob,
  listJobs,
  cancelJob,
  getHistory,
} from '../../core/exports/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { requireRight } from '../middleware/rights.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

const idParams = z.object({ id: uuidSchema });

const exportFormatSchema = z.enum(['csv', 'json']);

const participantsExportBody = z.object({
  format: exportFormatSchema,
  filter: z
    .object({
      direction_id: uuidSchema.optional(),
      status: z.string().optional(),
    })
    .optional(),
});

const plansExportBody = z.object({
  format: exportFormatSchema,
  filter: z
    .object({
      status: z.string().optional(),
      lead_direction_id: uuidSchema.optional(),
    })
    .optional(),
});

const goodsExportBody = z.object({
  format: exportFormatSchema,
  filter: z
    .object({
      status: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
});

const archiveExportBody = z.object({
  format: exportFormatSchema,
  filter: z
    .object({
      direction_id: uuidSchema.optional(),
      date_from: z.string().datetime({ offset: true }).optional(),
      date_to: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
});

const auditLogExportBody = z.object({
  format: exportFormatSchema,
  filter: z
    .object({
      entity_type: z.string().optional(),
      actor_id: uuidSchema.optional(),
      action: z.string().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
});

const listJobsQuery = z.object({
  status: z
    .enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
    .optional(),
  type: z
    .enum(['participants', 'plans', 'goods', 'archive', 'audit-log'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

const historyQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerExportsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── Универсальный POST-хелпер ─────────────────────────────
  //
  // Замыкание, чтобы не дублировать 5 почти одинаковых роутов.
  const registerExport = (
    path: string,
    type: ExportType,
    bodySchema: z.ZodType,
  ): void => {
    app.post(
      path,
      {
        preHandler: [
          authMiddleware,
          requireRight('export', 'C'),
          validateBody(bodySchema),
        ],
      },
      async (req, reply) => {
        const auth = getAuthContext(req);
        const body = req.body as {
          format: ExportFormat;
          filter?: Record<string, unknown>;
        };
        const job = await createExport(
          type,
          {
            format: body.format,
            ...(body.filter ? { filter: body.filter } : {}),
          },
          auth.participantId,
        );
        reply.status(202).send({
          job_id: job.jobId,
          status: job.status,
          url: null,
          audit_id: req.auditId,
        });
      },
    );
  };

  registerExport('/exports/participants', 'participants', participantsExportBody);
  registerExport('/exports/plans', 'plans', plansExportBody);
  registerExport('/exports/goods', 'goods', goodsExportBody);
  registerExport('/exports/archive', 'archive', archiveExportBody);
  registerExport('/exports/audit-log', 'audit-log', auditLogExportBody);

  // ─── СТАТИЧЕСКИЕ РОУТЫ (ДО /:id) ─────────────────────────────

  // GET /exports/history — только завершённые/проваленные/отменённые.
  app.get(
    '/exports/history',
    {
      preHandler: [
        authMiddleware,
        requireRight('export', 'V'),
        validateQuery(historyQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof historyQuery>;
      const result = await getHistory(auth.participantId, q.page, q.per_page);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // GET /exports/jobs
  app.get(
    '/exports/jobs',
    {
      preHandler: [
        authMiddleware,
        requireRight('export', 'V'),
        validateQuery(listJobsQuery),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const q = req.query as z.infer<typeof listJobsQuery>;

      const filter: Parameters<typeof listJobs>[0] = {
        page: q.page,
        perPage: q.per_page,
      };
      if (q.status) {filter.status = q.status as ExportJobStatus;}
      if (q.type && isExportType(q.type)) {filter.type = q.type;}

      const result = await listJobs(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // ─── Параметризованные роуты ────────────────────────────────

  // GET /exports/jobs/:id — с presigned URL при completed.
  app.get(
    '/exports/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('export', 'V'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const job = await getJob(p.id, auth.participantId);
      reply.send({
        job_id: job.jobId,
        type: job.type,
        format: job.format,
        status: job.status,
        progress: job.progress,
        url: job.url,
        error: job.error,
        created_at: job.createdAt,
        finished_at: job.finishedAt,
        audit_id: req.auditId,
      });
    },
  );

  // DELETE /exports/jobs/:id → 204
  app.delete(
    '/exports/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('export', 'D'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      await cancelJob(p.id, auth.participantId);
      reply.status(204).send();
    },
  );
}