// A.1.92.02 — Контроллер Imports.src/api/imports/controller.ts
// 7 эндпоинтов. Асинхронный импорт через worker.
//
// Права:
//   - import:V — dry-run (VERIFIER, KEEPER, BALANCER, Архитектор через '*');
//   - import:C — только FIRST_ARCHITECT (через '*'). Остальные — нет;
//   - import:D — только FIRST_ARCHITECT (отмена queued job).
//
// Порядок регистрации: /imports/templates/:type — отдельный префикс,
// не конфликтует с /imports/:type. В POST используем 3 отдельных
// эндпоинта (participants/goods/dictionary), а не :type — чтобы
// не пересекаться с templates.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  isImportType,
  type ImportType,
} from '../../core/imports/entity.js';
import {
  createImport,
  confirmImport,
  getJob,
  listJobs,
  cancelJob,
  getTemplate,
} from '../../core/imports/service.js';
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

const templateParams = z.object({
  type: z.enum(['participants', 'goods', 'dictionary']),
});

const createImportBody = z.object({
  file_url: z.string().min(1).max(2048),
  dry_run: z.boolean().default(true),
});

const listJobsQuery = z.object({
  status: z
    .enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
    .optional(),
  type: z.enum(['participants', 'goods', 'dictionary']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(20),
});

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerImportsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── POST /imports/:type (participants / goods / dictionary) ───
  //
  // Динамическое право: dry_run → 'V', execute → 'C'.
  // Один preHandler не подходит — проверяем в теле обработчика через
  // assertRight. Это позволяет: dry-run — VERIFIER+; execute — Архитектор.
  //
  // Используем assertRight из C.0.01.06, не requireRight (тот типизирует
  // preHandler с done в Fastify 5).

  const registerImport = (
    type: ImportType,
    path: string,
  ): void => {
    app.post(
      path,
      {
        preHandler: [
          authMiddleware,
          validateBody(createImportBody),
        ],
      },
      async (req, reply) => {
        const auth = getAuthContext(req);
        const body = req.body as z.infer<typeof createImportBody>;

        // Проверка права в зависимости от dry_run.
        const { assertRight } = await import('../../core/rights.js');
        const action = body.dry_run ? 'V' : 'C';
        await assertRight({
          participantId: auth.participantId,
          resource: 'import',
          action,
        });

        const job = await createImport(
          type,
          { fileUrl: body.file_url, dryRun: body.dry_run },
          auth.participantId,
        );

        reply.status(202).send({
          job_id: job.jobId,
          dry_run: job.dryRun,
          status: job.status,
          audit_id: req.auditId,
        });
      },
    );
  };

  registerImport('participants', '/imports/participants');
  registerImport('goods', '/imports/goods');
  registerImport('dictionary', '/imports/dictionary');

  // ─── GET /imports/templates/:type ────────────────────────────
  // Отдаёт CSV с заголовками. Content-Type: text/csv.
  app.get(
    '/imports/templates/:type',
    {
      preHandler: [
        authMiddleware,
        requireRight('import', 'V'),
        validateParams(templateParams),
      ],
    },
    async (req, reply) => {
      const p = req.params as z.infer<typeof templateParams>;
      const csv = getTemplate(p.type);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="import-template-${p.type}.csv"`,
        )
        .send(csv);
    },
  );

  // ─── GET /imports/jobs ───────────────────────────────────────
  // Список своих import-jobs.
  app.get(
    '/imports/jobs',
    {
      preHandler: [
        authMiddleware,
        requireRight('import', 'V'),
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
      if (q.status) {filter.status = q.status;}
      if (q.type && isImportType(q.type)) {filter.type = q.type;}

      const result = await listJobs(filter, auth.participantId);
      reply.send({
        data: result.data,
        meta: { page: q.page, per_page: q.per_page, total: result.total },
        audit_id: req.auditId,
      });
    },
  );

  // ─── GET /imports/jobs/:id ──────────────────────────────────
  // С presigned URL + preview (dry-run) или report (execute).
  app.get(
    '/imports/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('import', 'V'),
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
        dry_run: job.dryRun,
        status: job.status,
        progress: job.progress,
        preview: job.preview,
        report: job.report,
        url: job.url,
        error: job.error,
        created_at: job.createdAt,
        finished_at: job.finishedAt,
        audit_id: req.auditId,
      });
    },
  );

  // ─── POST /imports/jobs/:id/confirm ─────────────────────────
  // Превращает dry-run job в execute job.
  // Только import:C — т.е. только Архитектор.
  app.post(
    '/imports/jobs/:id/confirm',
    {
      preHandler: [
        authMiddleware,
        requireRight('import', 'C'),
        validateParams(idParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = req.params as z.infer<typeof idParams>;
      const job = await confirmImport(p.id, auth.participantId);
      reply.send({
        job_id: job.jobId,
        dry_run: job.dryRun,
        status: job.status,
        audit_id: req.auditId,
      });
    },
  );

  // ─── DELETE /imports/jobs/:id ───────────────────────────────
  // Отмена queued job. Running уже в работе.
  app.delete(
    '/imports/jobs/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('import', 'D'),
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