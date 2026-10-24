// src/api/files/controller.ts
/**
 * A.1.91.01 — Files controller.
 *
 * Presigned S3: upload (POST), download (302 redirect), metadata, list by task,
 * archive doc, delete (Architect/Oblivion).
 *
 * ОТЛИЧИЯ ОТ СТАРОЙ СПЕКИ:
 * - :key в path = S3-ключ (URI-encoded), а не абстрактный UUID.
 *   Причина: нет таблицы media_registry; L.0.01.07 работает с key+scope.
 * - ACL для download не проверяется (нужен F.4.99.10 useRights + маппинг).
 * - DELETE — по роли (FIRST_ARCHITECT / OBLIVION), не по right.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { logAction } from '../../core/audit.js';
import { AppError } from '../../core/errors.js';
import { Role } from '../../core/roles.js';
import {
  getUploadUrl,
  getDownloadUrl,
  deleteObject,
  headObject,
  listObjects,
  type S3Scope,
} from '../../lib/s3.js';
import { uuidSchema } from '../../lib/validators.js';
import { getEffectiveRoles } from '../../security/rbac.js';
import {
  authMiddleware,
  getAuthContext,
} from '../middleware/auth.js';
import {
  validateBody,
  validateParams,
} from '../middleware/validation.js';

// ─── Zod-схемы ───────────────────────────────────────────────────

const keyParams = z.object({
  key: z
    .string()
    .min(1)
    .max(1024)
    .refine((v) => !v.startsWith('/'), 'key must not start with /')
    .refine((v) => !v.includes('..'), 'key must not contain ..'),
});

const taskParams = z.object({ task_id: uuidSchema });
const docParams = z.object({ doc_id: uuidSchema });

const uploadBody = z
  .object({
    task_id: uuidSchema.optional(),
    report_id: uuidSchema.optional(),
    type: z.enum(['report', 'interview', 'archive', 'chat', 'gateway']),
    extension: z
      .string()
      .min(1)
      .max(10)
      .regex(/^[a-zA-Z0-9]+$/, 'extension must be alphanumeric'),
    content_type: z.string().min(3).max(128).optional(),
  })
  .refine(
    (b) => b.type === 'chat' || b.type === 'gateway' || b.task_id || b.report_id,
    { message: 'task_id or report_id is required for non-chat types' },
  );

// ─── Хелперы ─────────────────────────────────────────────────────

function scopeForType(type: string): S3Scope {
  if (type === 'archive') {return 'archive';}
  if (type === 'gateway') {return 'gateway';}
  return 'media';
}

function defaultContentType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg') {return 'image/jpeg';}
  if (e === 'png') {return 'image/png';}
  if (e === 'webp') {return 'image/webp';}
  if (e === 'mp4') {return 'video/mp4';}
  if (e === 'webm') {return 'video/webm';}
  if (e === 'mov') {return 'video/quicktime';}
  if (e === 'pdf') {return 'application/pdf';}
  if (e === 'txt') {return 'text/plain';}
  if (e === 'json') {return 'application/json';}
  return 'application/octet-stream';
}

function buildKey(body: z.infer<typeof uploadBody>): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = body.extension.replace(/^\./, '').toLowerCase();

  switch (body.type) {
    case 'report': {
      if (!body.task_id) {throw new AppError('VALIDATION_ERROR', 'task_id required', 422);}
      const rid = body.report_id ?? crypto.randomUUID();
      return `media/${body.task_id}/${rid}.${ext}`;
    }
    case 'interview':
      return `media/interviews/${yyyy}-${mm}/${crypto.randomUUID()}.${ext}`;
    case 'archive': {
      const id = body.report_id ?? crypto.randomUUID();
      return `archive/${yyyy}/${id}.${ext}`;
    }
    case 'chat':
      return `media/chat/${yyyy}-${mm}/${crypto.randomUUID()}.${ext}`;
    case 'gateway':
      return `gateway/${yyyy}-${mm}/${crypto.randomUUID()}.${ext}`;
  }
}

async function assertArchitectOrOblivion(request: FastifyRequest): Promise<void> {
  const ctx = getAuthContext(request);
  const roles = await getEffectiveRoles(ctx.participantId);
  if (!roles.includes(Role.FIRST_ARCHITECT) && !roles.includes(Role.OBLIVION)) {
    throw new AppError('FORBIDDEN', 'Only Architect or Oblivion can delete files', 403);
  }
}

// ─── Регистрация ─────────────────────────────────────────────────

export async function registerFilesRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /files/upload-url ────────────────────────────────────
  // Регистрируется ПЕРВЫМ, чтобы `/upload-url` не матчился как `:key`.
  app.post<{ Body: z.infer<typeof uploadBody> }>(
    '/files/upload-url',
    { preHandler: [authMiddleware, validateBody(uploadBody)] },
    async (request, reply) => {
     // const ctx = getAuthContext(request);
      const body = request.body;
      const key = buildKey(body);
      const scope = scopeForType(body.type);
      const contentType = body.content_type ?? defaultContentType(body.extension);

      const result = await getUploadUrl(key, contentType, scope, 900);

      return reply.status(200).send({
        url: result.url,
        fields: result.fields,
        key: result.key,
        content_type: contentType,
        expires_in: 900,
        audit_id: request.auditId,
      });
    },
  );

  // ─── GET /files/medias/:task_id ────────────────────────────────
  app.get<{ Params: { task_id: string } }>(
    '/files/medias/:task_id',
    { preHandler: [authMiddleware, validateParams(taskParams)] },
    async (request, reply) => {
      const prefix = `media/${request.params.task_id}/`;
      const objects = await listObjects(prefix, 'media', 200);

      const items = await Promise.all(
        objects.map(async (o) => ({
          key: o.key,
          url: await getDownloadUrl(o.key, 'media', 900),
          size: o.size,
          last_modified: o.lastModified,
        })),
      );

      return reply.send({ data: items, audit_id: request.auditId });
    },
  );

  // ─── GET /files/archive/:doc_id ────────────────────────────────
  app.get<{ Params: { doc_id: string } }>(
    '/files/archive/:doc_id',
    { preHandler: [authMiddleware, validateParams(docParams)] },
    async (request, reply) => {
      const { doc_id } = request.params;

      // Пробуем найти любой объект в archive с этим id
      // (формат ключа: archive/<year>/<id>.<ext> или archive/<id>.<ext>)
      const year = new Date().getUTCFullYear();
      const candidates = await Promise.all([
        listObjects(`archive/${year}/${doc_id}`, 'archive', 5),
        listObjects(`archive/${doc_id}`, 'archive', 5),
      ]);
      const found = candidates.flat()[0];
      if (!found) {
        throw new AppError('NOT_FOUND', `Archive document ${doc_id} not found`, 404);
      }
      const url = await getDownloadUrl(found.key, 'archive', 900);
      return reply.redirect(url);
    },
  );

  // ─── GET /files/:key ───────────────────────────────────────────
  // ВАЖНО: регистрируется ПОСЛЕ /upload-url, /medias, /archive.
  app.get<{ Params: { key: string } }>(
    '/files/:key',
    { preHandler: [authMiddleware, validateParams(keyParams)] },
    async (request, reply) => {
      const key = request.params.key;
      const scope = key.startsWith('archive/')
        ? 'archive'
        : key.startsWith('gateway/')
          ? 'gateway'
          : 'media';

      const head = await headObject(key, scope);
      if (!head) {
        throw new AppError('NOT_FOUND', `File ${key} not found`, 404);
      }
      const url = await getDownloadUrl(key, scope, 900);
      return reply.redirect(url);
    },
  );

  // ─── GET /files/:key/meta ──────────────────────────────────────
  app.get<{ Params: { key: string } }>(
    '/files/:key/meta',
    { preHandler: [authMiddleware, validateParams(keyParams)] },
    async (request, reply) => {
      const key = request.params.key;
      const scope = key.startsWith('archive/')
        ? 'archive'
        : key.startsWith('gateway/')
          ? 'gateway'
          : 'media';
      const head = await headObject(key, scope);
      if (!head) {
        throw new AppError('NOT_FOUND', `File ${key} not found`, 404);
      }
      // Отдаём и presigned URL, и метаданные одним ответом — фронту
      // нужен url для открытия, а 302 redirect из GET /files/:key
      // не работает без Authorization (Bearer в localStorage, не куки).
      const url = await getDownloadUrl(key, scope, 900);
      return reply.send({
        key,
        size: head.size,
        content_type: head.contentType,
        uploaded_at: head.lastModified,
        url,
        expires_in: 900,
        audit_id: request.auditId,
      });
    },
  );

  // ─── DELETE /files/:key ────────────────────────────────────────
  app.delete<{ Params: { key: string } }>(
    '/files/:key',
    { preHandler: [authMiddleware, validateParams(keyParams)] },
    async (request, reply) => {
      await assertArchitectOrOblivion(request);
      const ctx = getAuthContext(request);
      const key = request.params.key;
      const scope = key.startsWith('archive/')
        ? 'archive'
        : key.startsWith('gateway/')
          ? 'gateway'
          : 'media';

      const head = await headObject(key, scope);
      if (!head) {
        throw new AppError('NOT_FOUND', `File ${key} not found`, 404);
      }
      await deleteObject(key, scope);
      await logAction({
        actorId: ctx.participantId,
        actorType: 'participant',
        action: 'files.delete',
        entityType: 'file',
        entityId: key,
        newValue: { key, scope, size: head.size },
      });
      return reply.status(204).send();
    },
  );
}