// A.1.26.01 — Constructor controller.
//
// v0.0.03:
//   - GET /panels/:id/render — runtime-вид панели с данными loaders.
//     GET /panels/me НЕ регистрируется здесь — он живёт в A.1.98.01
//     (panels/controller.ts) и должен регистрироваться ДО /panels/:id.
//     Здесь только /panels/:id/render (по id, с проверкой доступа).
//
// v0.0.02 (сохранено):
//   - uuidIdParams/uuidVersionParams/uuidWidgetParams из lib/validators.
//   - contextParams: context → z.enum(['normal','crisis','steel_bell']).
//   - rightsListQuery/rightsCreateBody/checkRightBody: action/scope
//     через rightActionSchema/rightScopeSchema.
//   - 7 GET — panel:V; 9 мутаций — writeLimit (api.write).
//
// directionId для render берётся из auth.directionId (A.1.99.01, UUID | null).
// Если у участника нет направления — loadPanelData получит null и
// direction-scoped entity вернут [] (см. C.0.26.03).

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  listPanels, getPanel, createPanelService, updatePanelService, deletePanelService,
  listWidgets, addWidget, updateWidget, deleteWidget,
  publishPanel, rollbackPanel, listVersions, listWidgetLibrary,
  checkRight, listRightsMatrix, createRightsEntry, getContextualPanel,
  invalidateCache,
  getMyPanelById,
  loadPanelData,
} from '../../core/constructor/service.js';
import {
  uuidIdParams,
  uuidVersionParams,
  uuidWidgetParams,
  uuidSchema,
  rightActionSchema,
  rightScopeSchema,
} from '../../lib/validators.js';
import { mustGetLimit } from '../../security/rate-limit.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireRight } from '../middleware/rights.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';

// Rate-limit: конфиг api.write резолвится один раз на старте.
const writeLimit = rateLimit({ config: mustGetLimit('api.write') });

const contextParams = z.object({
  role_id: uuidSchema,
  context: z.enum(['normal', 'crisis', 'steel_bell']),
});

const listPanelsQuery = z.object({
  role_id: uuidSchema.optional(),
  direction_id: uuidSchema.optional(),
  context: z.enum(['normal', 'crisis', 'steel_bell']).optional(),
  active: z.enum(['true', 'false']).optional(),
});

const createPanelBody = z.object({
  name: z.string().min(1).max(255),
  role_id: uuidSchema.optional(),
  direction_id: uuidSchema.optional(),
  context: z.enum(['normal', 'crisis', 'steel_bell']).optional(),
});

const patchPanelBody = z.object({
  name: z.string().min(1).max(255).optional(),
  context: z.enum(['normal', 'crisis', 'steel_bell']).optional(),
  role_id: uuidSchema.nullable().optional(),
  direction_id: uuidSchema.nullable().optional(),
});

const addWidgetBody = z.object({
  widget_id: uuidSchema,
  parent_id: uuidSchema.nullable().optional(),
  position: z.record(z.unknown()),
  size: z.record(z.unknown()),
  overrides: z.record(z.unknown()).optional(),
});
const updateWidgetBody = z.object({
  parent_id: uuidSchema.nullable().optional(),
  position: z.record(z.unknown()).optional(),
  size: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
});

const rightsListQuery = z.object({
  role_id: uuidSchema.optional(),
  resource: z.string().optional(),
  action: rightActionSchema.optional(),
  scope: rightScopeSchema.optional(),
});

const rightsCreateBody = z.object({
  role_id: uuidSchema.nullable(),
  resource: z.string().min(1).max(64),
  action: rightActionSchema,
  scope: rightScopeSchema,
  condition: z.record(z.unknown()).nullable().optional(),
});

const checkRightBody = z.object({
  participant_id: uuidSchema.optional(),
  resource: z.string().min(1),
  action: rightActionSchema,
  scope: rightScopeSchema.optional(),
});

export async function registerConstructorRoutes(app: FastifyInstance): Promise<void> {
  // ─── Панели ─────────────────────────────────────────────────

  app.get<{ Querystring: z.infer<typeof listPanelsQuery> }>(
    '/panels',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateQuery(listPanelsQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query;
      const list = await listPanels({
        ...(q.role_id ? { roleId: q.role_id } : {}),
        ...(q.direction_id ? { directionId: q.direction_id } : {}),
        ...(q.context ? { context: q.context } : {}),
        ...(q.active !== undefined ? { active: q.active === 'true' } : {}),
      });
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/panels/:id',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const p = await getPanel(req.params.id);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  // GET /panels/:id/render — runtime-вид панели с данными loaders.
  // Проверяем доступ через getMyPanelById (только активные панели,
  // доступные участнику по роли/направлению). Отдельный от
  // /panels/me/render (A.1.98.01), который выбирает панель по контексту.
  app.get<{ Params: { id: string } }>(
    '/panels/:id/render',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);

      const panel = await getMyPanelById(
        req.params.id,
        auth.participantId,
        auth.directionId,
      );
      if (!panel) {
        reply.status(404).send({ code: 'NOT_FOUND', message: 'Панель недоступна' });
        return;
      }

      const instances = await listWidgets(panel.id);
      const data = await loadPanelData(
        {
          participantId: auth.participantId,
          directionId: auth.directionId,
          role: auth.role,
        },
        instances,
      );

      reply.send({
        panel,
        widgets: instances,
        data: data.widgetData,
        missing_entities: data.missingEntities,
        failed_entities: data.failedEntities,
        audit_id: req.auditId,
      });
    },
  );

  app.post<{ Body: z.infer<typeof createPanelBody> }>(
    '/panels',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'C'),
        validateBody(createPanelBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const p = await createPanelService({
        name: b.name,
        ...(b.role_id ? { roleId: b.role_id } : {}),
        ...(b.direction_id ? { directionId: b.direction_id } : {}),
        ...(b.context ? { context: b.context } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...p, audit_id: req.auditId });
    },
  );

  app.patch<{ Params: { id: string }; Body: z.infer<typeof patchPanelBody> }>(
    '/panels/:id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'E'),
        validateParams(uuidIdParams),
        validateBody(patchPanelBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const p = await updatePanelService(
        req.params.id,
        {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.context !== undefined ? { context: b.context } : {}),
          ...(b.direction_id !== undefined ? { directionId: b.direction_id } : {}),
          ...(b.role_id !== undefined ? { roleId: b.role_id } : {}),
        },
        auth.participantId,
      );
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/panels/:id',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'D'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      await deletePanelService(req.params.id, auth.participantId);
      reply.status(204).send();
    },
  );

  // ─── Widgets on panel ──────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/panels/:id/widgets',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const list = await listWidgets(req.params.id);
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof addWidgetBody> }>(
    '/panels/:id/widgets',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'E'),
        validateParams(uuidIdParams),
        validateBody(addWidgetBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const inst = await addWidget(req.params.id, {
        widgetId: b.widget_id,
        ...(b.parent_id !== undefined ? { parentId: b.parent_id } : {}),
        position: b.position,
        size: b.size,
        ...(b.overrides ? { overrides: b.overrides } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...inst, audit_id: req.auditId });
    },
  );

  app.patch<{ Params: { id: string; wid: string }; Body: z.infer<typeof updateWidgetBody> }>(
    '/panels/:id/widgets/:wid',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'E'),
        validateParams(uuidWidgetParams),
        validateBody(updateWidgetBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const inst = await updateWidget(
        req.params.wid,
        {
          ...(b.parent_id !== undefined ? { parentId: b.parent_id } : {}),
          ...(b.position !== undefined ? { position: b.position } : {}),
          ...(b.size !== undefined ? { size: b.size } : {}),
          ...(b.overrides !== undefined ? { overrides: b.overrides } : {}),
        },
        auth.participantId,
      );
      reply.send({ ...inst, audit_id: req.auditId });
    },
  );

  app.delete<{ Params: { id: string; wid: string } }>(
    '/panels/:id/widgets/:wid',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'E'),
        validateParams(uuidWidgetParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      await deleteWidget(req.params.wid, auth.participantId);
      reply.status(204).send();
    },
  );

  // ─── Publish, rollback, versions ───────────────────────────

  app.post<{ Params: { id: string } }>(
    '/panels/:id/publish',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'A'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = await publishPanel(req.params.id, auth.participantId);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  app.post<{ Params: { id: string; version: number } }>(
    '/panels/:id/rollback/:version',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'E'),
        validateParams(uuidVersionParams),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const p = await rollbackPanel(req.params.id, req.params.version, auth.participantId);
      reply.send({ ...p, audit_id: req.auditId });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/panels/:id/versions',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateParams(uuidIdParams),
      ],
    },
    async (req, reply) => {
      const list = await listVersions(req.params.id);
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  // ─── Library ───────────────────────────────────────────────

  app.get(
    '/widgets',
    { preHandler: [authMiddleware, requireRight('panel', 'V')] },
    async (req, reply) => {
      const list = await listWidgetLibrary();
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  // ─── Rights matrix ─────────────────────────────────────────

  app.get<{ Querystring: z.infer<typeof rightsListQuery> }>(
    '/rights-matrix',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateQuery(rightsListQuery),
      ],
    },
    async (req, reply) => {
      const q = req.query;
      const list = await listRightsMatrix({
        ...(q.role_id ? { roleId: q.role_id } : {}),
        ...(q.resource ? { resource: q.resource } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.scope ? { scope: q.scope } : {}),
      });
      reply.send({ data: list, audit_id: req.auditId });
    },
  );

  app.post<{ Body: z.infer<typeof rightsCreateBody> }>(
    '/rights-matrix',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'C'),
        validateBody(rightsCreateBody),
      ],
    },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const e = await createRightsEntry({
        roleId: b.role_id,
        resource: b.resource,
        action: b.action,
        scope: b.scope,
        ...(b.condition !== undefined ? { condition: b.condition } : {}),
      }, auth.participantId);
      reply.status(201).send({ ...e, audit_id: req.auditId });
    },
  );

  app.post<{ Body: z.infer<typeof checkRightBody> }>(
    '/rights-matrix/check',
    { preHandler: [authMiddleware, validateBody(checkRightBody)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const b = req.body;
      const r = await checkRight({
        participantId: b.participant_id ?? auth.participantId,
        resource: b.resource,
        action: b.action,
        ...(b.scope ? { scope: b.scope } : {}),
      });
      reply.send({ ...r, audit_id: req.auditId });
    },
  );

  // ─── Contextual ────────────────────────────────────────────

  app.get<{ Params: { role_id: string; context: 'normal' | 'crisis' | 'steel_bell' } }>(
    '/panels/context/:role_id/:context',
    {
      preHandler: [
        authMiddleware,
        requireRight('panel', 'V'),
        validateParams(contextParams),
      ],
    },
    async (req, reply) => {
      const p = await getContextualPanel(
        req.params.role_id,
        req.params.context,
      );
      reply.send({ data: p, audit_id: req.auditId });
    },
  );

  // ─── Cache ─────────────────────────────────────────────────

  app.post(
    '/panels/invalidate-cache',
    {
      preHandler: [
        authMiddleware,
        writeLimit,
        requireRight('panel', 'A'),
      ],
    },
    async (req, reply) => {
      await invalidateCache();
      reply.send({ invalidated: true, audit_id: req.auditId });
    },
  );
}