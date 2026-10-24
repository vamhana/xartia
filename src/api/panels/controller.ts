// A.1.98.01 — Panels runtime controller.
// Отдача панелей текущему участнику с учётом роли, направления, контекста.
// F.4.98.01 Workspace использует /panels/me/render.
//
// ВАЖНО: регистрируется ДО registerConstructorRoutes, чтобы /panels/me
// не матчился как /panels/:id.
//
// v0.0.02:
//   - B8 (C.0.26.02): listWidgets уже JOIN'ит widgets и возвращает
//     entity/widgetType — enrichment и `as never` в /panels/me/render
//     больше не нужны, loadPanelData принимает instances напрямую.
//   - directionId берётся из auth.directionId (A.1.99.01, UUID | null).
//     listMyPanels / loadPanelData корректно работают при null.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Panel } from '../../core/constructor/entity.js';
import {
  listMyPanels,
  listWidgets,
  listWidgetLibrary,
  loadPanelData,
} from '../../core/constructor/service.js';
import { uuidSchema } from '../../lib/validators.js';
import { authMiddleware, getAuthContext } from '../middleware/auth.js';
import { validateParams, validateQuery } from '../middleware/validation.js';

// ─── Схемы ───────────────────────────────────────────────────────

type ContextKind = 'normal' | 'crisis' | 'steel_bell';

const contextParams = z.object({
  context: z.enum(['normal', 'crisis', 'steel_bell']),
});

const widgetIdParams = z.object({
  widget_id: z.string().uuid(),
});

/**
 * Выбор панели: контекст важнее, но внутри контекста — специфичность.
 *
 * Порядок: роль+контекст → роль → направление → глобальная. Раньше бралась
 * «первая normal по updated_at», из-за чего ОТК мог увидеть обзор направления
 * вместо своей очереди, а Архитектор — чужую панель.
 */
function pickPanel(panels: Panel[], context?: ContextKind): Panel | null {
  if (panels.length === 0) {return null;}
  const score = (p: Panel): number => {
    const ctx = context
      ? (p.context === context ? 2 : p.context === 'normal' ? 1 : 0)
      : (p.context === 'normal' ? 2 : 1);
    const specificity = p.roleId ? 2 : p.directionId ? 1 : 0;
    return ctx * 10 + specificity;
  };
  return [...panels].sort((a, b) => score(b) - score(a))[0] ?? null;
}

// ─── Роуты ───────────────────────────────────────────────────────

export async function registerPanelsRoutes(app: FastifyInstance): Promise<void> {
  // GET /panels/me — панели, доступные текущему участнику
  app.get('/panels/me', { preHandler: authMiddleware }, async (req, reply) => {
    const auth = getAuthContext(req);
    const panels = await listMyPanels(auth.participantId, auth.directionId);
    reply.send({ data: panels, audit_id: req.auditId });
  });

  // GET /panels/me/context/:context — панель под конкретный контекст
  app.get<{ Params: { context: ContextKind } }>(
    '/panels/me/context/:context',
    { preHandler: [authMiddleware, validateParams(contextParams)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const panels = await listMyPanels(auth.participantId, auth.directionId);

      reply.send({ data: pickPanel(panels, req.params.context), audit_id: req.auditId });
    },
  );

  // GET /panels/me/render — панель + инстансы + библиотека виджетов
  // + данные виджетов (widgetData) для текущего участника.
  const renderQuery = z.object({
    context: z.enum(['normal', 'crisis', 'steel_bell']).optional(),
    panel_id: uuidSchema.optional(),
  });

  app.get<{
    Querystring: { context?: ContextKind; panel_id?: string };
  }>(
    '/panels/me/render',
    { preHandler: [authMiddleware, validateQuery(renderQuery)] },
    async (req, reply) => {
      const auth = getAuthContext(req);
      const allPanels = await listMyPanels(auth.participantId, auth.directionId);

      let panel: Panel | null = null;

      if (req.query.panel_id) {
        // явный panel_id — только из доступных
        panel = allPanels.find((p) => p.id === req.query.panel_id) ?? null;
        if (!panel) {
          reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Панель недоступна',
            audit_id: req.auditId,
          });
          return;
        }
      } else if (req.query.context) {
        panel = pickPanel(allPanels, req.query.context);
      } else {
        panel = pickPanel(allPanels);
      }

      if (!panel) {
        reply.send({
          data: {
            panel: null,
            instances: [],
            widgets: [],
            widgetData: {},
            missingEntities: [],
            failedEntities: [],
            available: [],
          },
          audit_id: req.auditId,
        });
        return;
      }

      // B8: listWidgets (C.0.26.02) уже JOIN'ит widgets и возвращает
      // entity/widgetType — enrichment и `as never` больше не нужны.
      const instances = await listWidgets(panel.id);
      const library = await listWidgetLibrary();

      // Собираем данные виджетов от имени текущего участника.
      const { widgetData, missingEntities, failedEntities } = await loadPanelData(
        {
          participantId: auth.participantId,
          directionId: auth.directionId,
          role: auth.role,
        },
        instances,
      );

      // Отдаём только те виджеты, что реально используются на панели.
      // В ответе — обычные instances (без entity), чтобы не раздувать payload.
      const usedWidgetIds = new Set(instances.map((i) => i.widgetId));
      const widgets = library.filter((w) => usedWidgetIds.has(w.id));

      reply.send({
        data: {
          panel,
          instances,
          widgets,
          widgetData,
          missingEntities,
          failedEntities,
          available: allPanels.map((p) => ({
            id: p.id,
            name: p.name,
            context: p.context,
          })),
        },
        audit_id: req.auditId,
      });
    },
  );

  // POST /panels/me/widgets/:widget_id/action — заглушка.
  // Реализация действий виджетов — Phase 2.
  app.post<{ Params: { widget_id: string } }>(
    '/panels/me/widgets/:widget_id/action',
    { preHandler: [authMiddleware, validateParams(widgetIdParams)] },
    async (req, reply) => {
      reply.status(501).send({
        code: 'NOT_IMPLEMENTED',
        message: 'Действия виджетов — Phase 2',
        audit_id: req.auditId,
      });
    },
  );
}