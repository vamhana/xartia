// C.0.26.02 — Сервис Конструктора.
// Панели, виджеты, права, версии. Семантический Страж (заглушка).
//
// Техдолг закрыт (v0.0.03):
//   - B1:  listMyPanels / getMyPanelById — корректная работа при directionId=null.
//   - B2:  updatePanelService — запрет изменения активной панели.
//   - B3:  addWidget — transaction + advisory lock, depth через recursive CTE.
//   - B4:  updateWidget — transaction + advisory lock, cycle/depth через CTE.
//   - B5:  deleteWidget — каскадное удаление потомков через recursive CTE.
//   - B6:  publishPanel — transaction + advisory lock + FOR UPDATE + version+1.
//   - B7:  loadPanelData — inst.entity без хака (тип инстансов расширен).
//   - B8:  listWidgets — JOIN с widgets, entity/widgetType из БД.
//   - B9:  invalidateCache — SCAN вместо KEYS.
//   - B38: listPanels + includeGlobalRole, getContextualPanel учитывает
//          глобальные панели (role_id IS NULL).
//
// T6 (SET role_id = NULL) — не баг: SET role_id = $N с null корректно пишет NULL.
// Проблема была бы в WHERE role_id = $N, но там такого нет.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID, RightAction, RightScope } from '../types.js';

import { getLoader, type LoaderContext } from './data-loaders.js';
import {
  createPanel, addWidgetInstance, publishPanel as entityPublish,
  createRightsMatrixEntry, checkRightInMatrix,
  getContextualPanel as entityContextual,
  type Panel, type Widget, type WidgetInstance,
  type RightsMatrixEntry, type PanelVersion, type PanelContext,
} from './entity.js';

/** Максимальная вложенность контейнеров. */
const MAX_DEPTH = 5;

// ─── Row-mappers ─────────────────────────────────────────────────

interface PanelRow {
  id: string;
  name: string;
  role_id: string | null;
  direction_id: string | null;
  context: PanelContext;
  version: number;
  active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function rowToPanel(r: PanelRow): Panel {
  return {
    id: r.id,
    name: r.name,
    roleId: r.role_id,
    directionId: r.direction_id,
    context: r.context,
    version: r.version,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

interface WidgetRow {
  id: string;
  type: string;
  entity: string;
  config: Record<string, unknown>;
  default_rights: Record<string, unknown>;
  created_by: string;
  created_at: Date;
}

function rowToWidget(r: WidgetRow): Widget {
  return {
    id: r.id,
    type: r.type,
    entity: r.entity,
    config: r.config ?? {},
    defaultRights: r.default_rights ?? {},
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

interface PanelWidgetRow {
  id: string;
  panel_id: string;
  widget_id: string;
  parent_id: string | null;
  position: Record<string, unknown>;
  size: Record<string, unknown>;
  overrides: Record<string, unknown>;
  created_at: Date;
}

function rowToInstance(r: PanelWidgetRow): WidgetInstance {
  return {
    id: r.id,
    panelId: r.panel_id,
    widgetId: r.widget_id,
    parentId: r.parent_id,
    position: r.position ?? {},
    size: r.size ?? {},
    overrides: r.overrides ?? {},
    createdAt: r.created_at.toISOString(),
  };
}

interface RightsRow {
  id: string;
  role_id: string | null;
  resource: string;
  action: RightAction;
  scope: RightScope;
  condition: Record<string, unknown> | null;
  version: number;
  created_at: Date;
}

function rowToRights(r: RightsRow): RightsMatrixEntry {
  return {
    id: r.id,
    roleId: r.role_id,
    resource: r.resource,
    action: r.action,
    scope: r.scope,
    condition: r.condition,
    version: r.version,
    createdAt: r.created_at.toISOString(),
  };
}

interface VersionRow {
  id: string;
  panel_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  created_by: string;
  created_at: Date;
}

function rowToVersion(r: VersionRow): PanelVersion {
  return {
    id: r.id,
    panelId: r.panel_id,
    version: r.version,
    snapshot: r.snapshot,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

// ─── Панели ──────────────────────────────────────────────────────

export interface PanelFilter {
  roleId?: UUID;
  directionId?: UUID;
  context?: PanelContext;
  active?: boolean;
  /**
   * B38: при roleId-фильтре включать глобальные панели (role_id IS NULL).
   * Используется getContextualPanel для fallback-логики.
   */
  includeGlobalRole?: boolean;
}

export async function listPanels(filter: PanelFilter = {}): Promise<Panel[]> {
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (filter.roleId) {
    params.push(filter.roleId);
    if (filter.includeGlobalRole) {
      wheres.push(`(role_id = $${params.length} OR role_id IS NULL)`);
    } else {
      wheres.push(`role_id = $${params.length}`);
    }
  }
  if (filter.directionId) {
    params.push(filter.directionId);
    wheres.push(`direction_id = $${params.length}`);
  }
  if (filter.context) {
    params.push(filter.context);
    wheres.push(`context = $${params.length}::panel_context_enum`);
  }
  if (filter.active !== undefined) {
    params.push(filter.active);
    wheres.push(`active = $${params.length}`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = await query<PanelRow>(
    `SELECT * FROM panels ${where} ORDER BY updated_at DESC LIMIT 200`,
    params,
  );
  return rows.map(rowToPanel);
}

/**
 * Панели, доступные конкретному участнику.
 * B1: при directionId=null — только панели с direction_id IS NULL.
 * При directionId=UUID — и глобальные (null), и свои.
 */
export async function listMyPanels(
  participantId: UUID,
  directionId: UUID | null,
): Promise<Panel[]> {
  const rows = await query<PanelRow>(
    `SELECT DISTINCT p.*
       FROM panels p
      WHERE p.active = true
        AND (
          p.role_id IS NULL
          -- Сравниваем роли по ИМЕНИ, а не по id: в таблице roles одна и та же
          -- функция («OTC», «COUNCIL_MEMBER») заведена отдельной строкой на
          -- каждое направление. Панель роли — про функцию, а не про строку
          -- направления, иначе ОТК направление 3 не увидел бы панель ОТК,
          -- привязанную к строке направления 9.
          OR EXISTS (
            SELECT 1
              FROM participant_roles pr
              JOIN roles rp ON rp.id = pr.role_id
              JOIN roles pt ON pt.id = p.role_id
             WHERE pr.participant_id = $1
               AND pr.status = 'active'
               AND (pr.valid_to IS NULL OR pr.valid_to > now())
               AND pt.name = rp.name
          )
        )
        AND (
          p.direction_id IS NULL
          ${directionId ? 'OR p.direction_id = $2' : ''}
        )
      ORDER BY p.updated_at DESC
      LIMIT 50`,
    directionId ? [participantId, directionId] : [participantId],
  );
  return rows.map(rowToPanel);
}

/**
 * Проверка, доступна ли конкретная панель участнику.
 * B1: при directionId=null — только глобальные панели.
 */
export async function getMyPanelById(
  panelId: UUID,
  participantId: UUID,
  directionId: UUID | null,
): Promise<Panel | null> {
  const rows = await query<PanelRow>(
    `SELECT DISTINCT p.*
       FROM panels p
      WHERE p.id = $1
        AND p.active = true
        AND (
          p.role_id IS NULL
          -- См. listMyPanels: роли сравниваем по имени (одна функция —
          -- отдельная строка на каждое направление).
          OR EXISTS (
            SELECT 1
              FROM participant_roles pr
              JOIN roles rp ON rp.id = pr.role_id
              JOIN roles pt ON pt.id = p.role_id
             WHERE pr.participant_id = $2
               AND pr.status = 'active'
               AND (pr.valid_to IS NULL OR pr.valid_to > now())
               AND pt.name = rp.name
          )
        )
        AND (
          p.direction_id IS NULL
          ${directionId ? 'OR p.direction_id = $3' : ''}
        )
      LIMIT 1`,
    directionId ? [panelId, participantId, directionId] : [panelId, participantId],
  );
  return rows[0] ? rowToPanel(rows[0]) : null;
}

export async function getPanel(panelId: UUID): Promise<Panel> {
  const r = await queryOne<PanelRow>(
    `SELECT * FROM panels WHERE id = $1`,
    [panelId],
  );
  if (!r) {throw new NotFoundError('Панель', panelId);}
  return rowToPanel(r);
}

export async function createPanelService(
  input: {
    name: string;
    roleId?: UUID;
    directionId?: UUID;
    context?: PanelContext;
  },
  requesterId: UUID,
): Promise<Panel> {
  const id = newUUID();
  const p = createPanel({
    id,
    name: input.name,
    ...(input.roleId ? { roleId: input.roleId } : {}),
    ...(input.directionId ? { directionId: input.directionId } : {}),
    ...(input.context ? { context: input.context } : {}),
    createdBy: requesterId,
  });
  await query(
    `INSERT INTO panels
       (id, name, role_id, direction_id, context, version, active, created_by)
     VALUES ($1, $2, $3, $4, $5::panel_context_enum, $6, $7, $8)`,
    [p.id, p.name, p.roleId, p.directionId, p.context, p.version, p.active, p.createdBy],
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.panel.created',
    entityType: 'panel',
    entityId: p.id,
    newValue: { name: p.name },
  });
  return p;
}

export async function updatePanelService(
  panelId: UUID,
  patch: {
    name?: string;
    context?: PanelContext;
    roleId?: UUID | null;
    directionId?: UUID | null;
  },
  requesterId: UUID,
): Promise<Panel> {
  const current = await getPanel(panelId);

  // B2: активную (published) панель нельзя менять — сначала rollback/new version.
  if (current.active) {
    throw new ConflictError(
      'Нельзя изменить активную панель — снимите с публикации или создайте новую версию',
    );
  }

  // T6: SET role_id = $N с null корректно пишет NULL (проблема была бы в WHERE).
  const updates: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    params.push(patch.name);
    updates.push(`name = $${params.length}`);
  }
  if (patch.context !== undefined) {
    params.push(patch.context);
    updates.push(`context = $${params.length}::panel_context_enum`);
  }
  if (patch.roleId !== undefined) {
    params.push(patch.roleId);
    updates.push(`role_id = $${params.length}`);
  }
  if (patch.directionId !== undefined) {
    params.push(patch.directionId);
    updates.push(`direction_id = $${params.length}`);
  }
  if (updates.length === 0) {return current;}

  params.push(panelId);
  await query(
    `UPDATE panels SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params,
  );
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.panel.updated',
    entityType: 'panel',
    entityId: panelId,
  });
  return getPanel(panelId);
}

export async function deletePanelService(
  panelId: UUID,
  requesterId: UUID,
): Promise<void> {
  const current = await getPanel(panelId);
  if (current.active) {
    throw new ConflictError('Нельзя удалить активную панель');
  }
  await query(`DELETE FROM panels WHERE id = $1`, [panelId]);
  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.panel.deleted',
    entityType: 'panel',
    entityId: panelId,
  });
}

// ─── Виджеты на холсте ───────────────────────────────────────────

interface PanelWidgetRowWithEntity extends PanelWidgetRow {
  widget_type: string;
  entity: string;
}

// B8: JOIN с widgets — entity/widgetType приходят из БД, без хака в loadPanelData.
export async function listWidgets(
  panelId: UUID,
): Promise<Array<WidgetInstance & { entity: string; widgetType: string }>> {
  const rows = await query<PanelWidgetRowWithEntity>(
    `SELECT pw.*, w.type AS widget_type, w.entity
       FROM panel_widgets pw
       JOIN widgets w ON w.id = pw.widget_id
      WHERE pw.panel_id = $1
      ORDER BY pw.created_at ASC`,
    [panelId],
  );
  return rows.map((r) => ({
    ...rowToInstance(r),
    entity: r.entity,
    widgetType: r.widget_type,
  }));
}

// ─── Добавление виджета ─────────────────────────────────────────

// B3: transaction + advisory lock по panelId; depth через recursive CTE.
export async function addWidget(
  panelId: UUID,
  input: {
    widgetId: UUID;
    parentId?: UUID | null;
    position: Record<string, unknown>;
    size: Record<string, unknown>;
    overrides?: Record<string, unknown>;
  },
  requesterId: UUID,
): Promise<WidgetInstance> {
  await getPanel(panelId);

  // Проверка, что widget существует в библиотеке (read-only, вне lock).
  const w = await queryOne<WidgetRow>(
    `SELECT * FROM widgets WHERE id = $1`,
    [input.widgetId],
  );
  if (!w) {throw new NotFoundError('Виджет библиотеки', input.widgetId);}

  const parentId = input.parentId ?? null;

  const inst = await transaction(async (client) => {
    // Advisory lock по panelId — сериализует addWidget/updateWidget на одной панели.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`constructor:panel:${panelId}`],
    );

    if (parentId) {
      const pRow = await client.query<{ panel_id: string; widget_type: string }>(
        `SELECT pw.panel_id, w2.type AS widget_type
           FROM panel_widgets pw
           JOIN widgets w2 ON w2.id = pw.widget_id
          WHERE pw.id = $1`,
        [parentId],
      );
      const p = pRow.rows[0];
      if (!p) {throw new ValidationError('Родительский контейнер не найден');}
      if (p.panel_id !== panelId) {
        throw new ValidationError('Контейнер принадлежит другой панели');
      }
      if (p.widget_type !== 'container') {
        throw new ValidationError('Родителем может быть только виджет-контейнер');
      }

      // Depth of parent — через recursive CTE (walk up).
      const depthRow = await client.query<{ depth: number }>(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id, 1 AS depth FROM panel_widgets WHERE id = $1
           UNION ALL
           SELECT p2.id, p2.parent_id, chain.depth + 1
             FROM panel_widgets p2
             JOIN chain ON chain.parent_id = p2.id
         )
         SELECT MAX(depth) AS depth FROM chain`,
        [parentId],
      );
      const parentDepth = depthRow.rows[0]?.depth ?? 0;
      if (parentDepth + 1 > MAX_DEPTH) {
        throw new ValidationError(
          `Максимальная вложенность — ${MAX_DEPTH} уровней`,
        );
      }
    }

    const id = newUUID();
    const entity = addWidgetInstance({
      id,
      panelId,
      widgetId: input.widgetId,
      parentId,
      position: input.position,
      size: input.size,
      ...(input.overrides ? { overrides: input.overrides } : {}),
    });

    await client.query(
      `INSERT INTO panel_widgets
         (id, panel_id, widget_id, parent_id, position, size, overrides)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        entity.id, entity.panelId, entity.widgetId, entity.parentId,
        JSON.stringify(entity.position),
        JSON.stringify(entity.size),
        JSON.stringify(entity.overrides),
      ],
    );
    return entity;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.widget.added',
    entityType: 'panel_widget',
    entityId: inst.id,
    newValue: { panelId, widgetId: input.widgetId, parentId },
  });
  return inst;
}

// B4: transaction + advisory lock + cycle/depth через CTE.
export async function updateWidget(
  instanceId: UUID,
  patch: {
    parentId?: UUID | null;
    position?: Record<string, unknown>;
    size?: Record<string, unknown>;
    overrides?: Record<string, unknown>;
  },
  requesterId: UUID,
): Promise<WidgetInstance> {
  const initial = await queryOne<PanelWidgetRow>(
    `SELECT * FROM panel_widgets WHERE id = $1`,
    [instanceId],
  );
  if (!initial) {throw new NotFoundError('WidgetInstance', instanceId);}

  const updated = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`constructor:panel:${initial.panel_id}`],
    );

    const lockRow = await client.query<PanelWidgetRow>(
      `SELECT * FROM panel_widgets WHERE id = $1 FOR UPDATE`,
      [instanceId],
    );
    const row = lockRow.rows[0];
    if (!row) {throw new NotFoundError('WidgetInstance', instanceId);}

    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.parentId !== undefined) {
      const newParentId = patch.parentId;

      if (newParentId === instanceId) {
        throw new ValidationError('Виджет не может быть родителем сам себе');
      }

      if (newParentId !== null) {
        // Inline parent validation (B3-паттерн).
        const p = await client.query<{ panel_id: string; widget_type: string }>(
          `SELECT pw.panel_id, w.type AS widget_type
             FROM panel_widgets pw
             JOIN widgets w ON w.id = pw.widget_id
            WHERE pw.id = $1`,
          [newParentId],
        );
        const pRow = p.rows[0];
        if (!pRow) {throw new ValidationError('Родительский контейнер не найден');}
        if (pRow.panel_id !== row.panel_id) {
          throw new ValidationError('Контейнер принадлежит другой панели');
        }
        if (pRow.widget_type !== 'container') {
          throw new ValidationError('Родителем может быть только виджет-контейнер');
        }

        // Cycle + parent depth — одним CTE (walk up from newParentId).
        const up = await client.query<{ depth: number; has_cycle: boolean }>(
          `WITH RECURSIVE chain AS (
             SELECT id, parent_id, 1 AS depth FROM panel_widgets WHERE id = $1
             UNION ALL
             SELECT p2.id, p2.parent_id, chain.depth + 1
               FROM panel_widgets p2
               JOIN chain ON chain.parent_id = p2.id
           )
           SELECT MAX(depth) AS depth, bool_or(id = $2) AS has_cycle FROM chain`,
          [newParentId, instanceId],
        );
        const upRow = up.rows[0];
        if (upRow?.has_cycle) {
          throw new ValidationError(
            'Нельзя переместить контейнер внутрь своего потомка',
          );
        }

        // Subtree height of instanceId — через CTE (walk down).
        const down = await client.query<{ height: number }>(
          `WITH RECURSIVE chain AS (
             SELECT id, 1 AS depth FROM panel_widgets WHERE id = $1
             UNION ALL
             SELECT p2.id, chain.depth + 1
               FROM panel_widgets p2
               JOIN chain ON p2.parent_id = chain.id
           )
           SELECT MAX(depth) AS height FROM chain`,
          [instanceId],
        );
        const subtreeHeight = down.rows[0]?.height ?? 1;
        const parentDepth = upRow?.depth ?? 0;
        if (parentDepth + subtreeHeight > MAX_DEPTH) {
          throw new ValidationError(
            `Максимальная вложенность — ${MAX_DEPTH} уровней`,
          );
        }
      }

      params.push(newParentId);
      updates.push(`parent_id = $${params.length}`);
    }

    if (patch.position !== undefined) {
      params.push(JSON.stringify(patch.position));
      updates.push(`position = $${params.length}::jsonb`);
    }
    if (patch.size !== undefined) {
      params.push(JSON.stringify(patch.size));
      updates.push(`size = $${params.length}::jsonb`);
    }
    if (patch.overrides !== undefined) {
      params.push(JSON.stringify(patch.overrides));
      updates.push(`overrides = $${params.length}::jsonb`);
    }

    if (updates.length === 0) {
      return row;
    }

    params.push(instanceId);
    const r = await client.query<PanelWidgetRow>(
      `UPDATE panel_widgets
          SET ${updates.join(', ')}
        WHERE id = $${params.length}
        RETURNING *`,
      params,
    );
    const fresh = r.rows[0];
    if (!fresh) {throw new NotFoundError('WidgetInstance', instanceId);}
    return fresh;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.widget.updated',
    entityType: 'panel_widget',
    entityId: instanceId,
    newValue: patch.parentId !== undefined
      ? { parentId: patch.parentId }
      : undefined,
  });
  return rowToInstance(updated);
}

// B5: каскадное удаление потомков в transaction.
export async function deleteWidget(
  instanceId: UUID,
  requesterId: UUID,
): Promise<void> {
  const row = await queryOne<PanelWidgetRow>(
    `SELECT * FROM panel_widgets WHERE id = $1`,
    [instanceId],
  );
  if (!row) {throw new NotFoundError('WidgetInstance', instanceId);}

  await transaction(async (client) => {
    // Один DELETE снимает и сам узел, и всех потомков (recursive CTE).
    await client.query(
      `WITH RECURSIVE descendants AS (
         SELECT id FROM panel_widgets WHERE id = $1
         UNION ALL
         SELECT pw.id FROM panel_widgets pw
           JOIN descendants d ON pw.parent_id = d.id
       )
       DELETE FROM panel_widgets WHERE id IN (SELECT id FROM descendants)`,
      [instanceId],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.widget.deleted',
    entityType: 'panel_widget',
    entityId: instanceId,
  });
}

// ─── Публикация и версии ─────────────────────────────────────────

// B6: transaction + advisory lock + FOR UPDATE + version+1.
export async function publishPanel(
  panelId: UUID,
  requesterId: UUID,
): Promise<Panel> {
  const result = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`constructor:publish:${panelId}`],
    );

    const fresh = await client.query<PanelRow>(
      `SELECT * FROM panels WHERE id = $1 FOR UPDATE`,
      [panelId],
    );
    const row = fresh.rows[0];
    if (!row) {throw new NotFoundError('Панель', panelId);}

    const p = rowToPanel(row);

    // Семантический Страж — заглушка. По-настоящему: C.0.29.02.
    const semanticApproved = p.name.trim().length > 0;
    const published = entityPublish(p, semanticApproved);
    const nextVersion = p.version + 1;

    await client.query(
      `UPDATE panels
          SET active = $2, version = $3, updated_at = now()
        WHERE id = $1`,
      [panelId, published.active, nextVersion],
    );

    const verId = newUUID();
    await client.query(
      `INSERT INTO panel_versions
         (id, panel_id, version, snapshot, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        verId,
        panelId,
        nextVersion,
        JSON.stringify({
          name: p.name,
          context: p.context,
          publishedAt: new Date().toISOString(),
        }),
        requesterId,
      ],
    );
    return { version: nextVersion };
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.panel.published',
    entityType: 'panel',
    entityId: panelId,
    newValue: { version: result.version },
  });
  return getPanel(panelId);
}

export async function rollbackPanel(
  panelId: UUID,
  version: number,
  requesterId: UUID,
): Promise<Panel> {
  const current = await getPanel(panelId);
  const v = await queryOne<VersionRow>(
    `SELECT * FROM panel_versions WHERE panel_id = $1 AND version = $2`,
    [panelId, version],
  );
  if (!v) {throw new NotFoundError('Версия панели', String(version));}

  const vEntity = rowToVersion(v);

  // Snapshot содержит name/context — их и восстанавливаем
  const name = typeof vEntity.snapshot['name'] === 'string'
    ? (vEntity.snapshot['name'] as string)
    : current.name;
  const context = typeof vEntity.snapshot['context'] === 'string'
    ? (vEntity.snapshot['context'] as PanelContext)
    : current.context;

  await query(
    `UPDATE panels
        SET name = $2, context = $3::panel_context_enum, updated_at = now()
      WHERE id = $1`,
    [panelId, name, context],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.panel.rolled_back',
    entityType: 'panel',
    entityId: panelId,
    newValue: { restoredVersion: version },
  });

  return getPanel(panelId);
}

export async function listVersions(panelId: UUID): Promise<PanelVersion[]> {
  const rows = await query<VersionRow>(
    `SELECT * FROM panel_versions WHERE panel_id = $1 ORDER BY version DESC`,
    [panelId],
  );
  return rows.map(rowToVersion);
}

// ─── Библиотека виджетов ─────────────────────────────────────────

export async function listWidgetLibrary(): Promise<Widget[]> {
  const rows = await query<WidgetRow>(
    `SELECT * FROM widgets ORDER BY type ASC, entity ASC LIMIT 500`,
  );
  return rows.map(rowToWidget);
}

// ─── Rights Matrix (управление) ──────────────────────────────────

export interface RightsFilter {
  roleId?: UUID;
  resource?: string;
  action?: RightAction;
  scope?: RightScope;
}

export async function listRightsMatrix(
  filter: RightsFilter = {},
): Promise<RightsMatrixEntry[]> {
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (filter.roleId) {
    params.push(filter.roleId);
    wheres.push(`role_id = $${params.length}`);
  }
  if (filter.resource) {
    params.push(filter.resource);
    wheres.push(`resource = $${params.length}`);
  }
  if (filter.action) {
    params.push(filter.action);
    wheres.push(`action = $${params.length}::right_action_enum`);
  }
  if (filter.scope) {
    params.push(filter.scope);
    wheres.push(`scope = $${params.length}::right_scope_enum`);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = await query<RightsRow>(
    `SELECT * FROM rights_matrix ${where} ORDER BY role_id, resource, action LIMIT 2000`,
    params,
  );
  return rows.map(rowToRights);
}

export async function createRightsEntry(
  input: {
    roleId: UUID | null;
    resource: string;
    action: RightAction;
    scope: RightScope;
    condition?: Record<string, unknown> | null;
  },
  requesterId: UUID,
): Promise<RightsMatrixEntry> {
  const id = newUUID();
  const e = createRightsMatrixEntry({ id, ...input });

  try {
    await transaction(async (client) => {
      // Advisory lock по ключу — сериализует параллельные create на одну запись.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [
          `rights-matrix:create:${input.roleId ?? 'null'}:` +
          `${input.resource}:${input.action}:${input.scope}`,
        ],
      );

      // Pre-check с явной обработкой NULL-role (NULL != NULL в SQL).
      const dup = await client.query<{ id: string }>(
        `SELECT id FROM rights_matrix
          WHERE resource = $1
            AND action = $2::right_action_enum
            AND scope = $3::right_scope_enum
            AND (
              (role_id IS NULL AND $4::uuid IS NULL)
              OR role_id = $4::uuid
            )
          LIMIT 1`,
        [input.resource, input.action, input.scope, input.roleId],
      );
      if (dup.rows.length > 0) {
        throw new ConflictError('Такая запись уже существует в матрице');
      }

      await client.query(
        `INSERT INTO rights_matrix
           (id, role_id, resource, action, scope, condition, version)
         VALUES ($1, $2, $3, $4::right_action_enum, $5::right_scope_enum, $6::jsonb, $7)`,
        [e.id, e.roleId, e.resource, e.action, e.scope, e.condition ? JSON.stringify(e.condition) : null, e.version],
      );
    });
  } catch (err) {
    if (err instanceof ConflictError) {throw err;}
    const pgErr = err as { code?: string };
    // Fallback: если в будущем появится partial UNIQUE (миграция 030).
    if (pgErr.code === '23505') {
      throw new ConflictError('Такая запись уже существует в матрице');
    }
    throw err;
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'constructor.rights.created',
    entityType: 'rights_matrix',
    entityId: e.id,
    newValue: { resource: e.resource, action: e.action, scope: e.scope },
  });

  // инвалидируем кэш C.0.01.06
  try {
    const { invalidateRightsMatrixCache } = await import('../rights.js');
    await invalidateRightsMatrixCache();
  } catch {
    /* best-effort */
  }
  return e;
}

export async function checkRight(
  input: {
    participantId: UUID;
    resource: string;
    action: RightAction;
    scope?: RightScope;
  },
): Promise<{ allowed: boolean; reason: string; constraints: Record<string, unknown> }> {
  // Реэкспорт через C.0.01.06, чтобы не дублировать логику ролей
  const { checkRight: coreCheck } = await import('../rights.js');
  const r = await coreCheck({
    participantId: input.participantId,
    resource: input.resource,
    action: input.action,
    ...(input.scope ? { scope: input.scope } : {}),
  });
  return {
    allowed: r.allowed,
    reason: r.reason,
    constraints: r.constraints as Record<string, unknown>,
  };
}

/**
 * B38: entityContextual ожидает и role-specific, и глобальные панели.
 * Без includeGlobalRole listPanels отфильтрует role_id IS NULL,
 * и fallback на глобальную normal не сработает.
 */
export async function getContextualPanel(
  roleId: UUID,
  context: PanelContext,
): Promise<Panel | null> {
  const all = await listPanels({
    roleId,
    active: true,
    includeGlobalRole: true,
  });
  return entityContextual(all, roleId, context);
}

// ─── Cache ───────────────────────────────────────────────────────

const CACHE_PREFIX = 'constructor:panel:';

// B9: SCAN вместо KEYS (KEYS — O(N) и блокирует Redis).
export async function invalidateCache(panelId?: UUID): Promise<void> {
  const { redis } = await import('../../lib/redis.js');
  try {
    if (panelId) {
      await redis.del(`${CACHE_PREFIX}${panelId}`);
      return;
    }
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor, 'MATCH', `${CACHE_PREFIX}*`, 'COUNT', 200,
      );
      cursor = next;
      if (keys.length > 0) { await redis.del(...keys); }
    } while (cursor !== '0');
  } catch {
    /* best-effort */
  }
}

// ─── Data loaders для runtime-вида ────────────────────────────────

export interface PanelDataResult {
  /** entity → результат loader'а (или null, если loader'а нет / упал). */
  widgetData: Record<string, unknown>;
  /** Список entity, для которых не нашлось loader'а. */
  missingEntities: string[];
  /** Список entity, чьи loader'ы упали (для диагностики). */
  failedEntities: string[];
}

/**
 * Собирает данные для всех виджетов панели.
 *
 * - Кэширует вызовы: если два виджета на entity `tasks` — loader один раз.
 * - Promise.allSettled: ошибка одного loader'а не роняет остальные.
 * - Loader'ы без instance (list-type) — кэш по entity.
 * - Loader'ы с instance (single-item) — кэш по `${entity}:${instanceId}`.
 * - Неизвестная entity → в `missingEntities`, значение `null`.
 * - Упавший loader → в `failedEntities`, значение `null`.
 *
 * B7: instances типизированы с `entity?: string`, поэтому берём `inst.entity`
 * напрямую, без `(inst as ...)`. `listWidgets` (B8) возвращает такой тип.
 */
export async function loadPanelData(
  ctx: LoaderContext,
  instances: Array<WidgetInstance & { entity?: string }>,
): Promise<PanelDataResult> {
  const widgetData: Record<string, unknown> = {};
  const missingEntities: string[] = [];
  const failedEntities: string[] = [];

  const byEntity = new Map<string, WidgetInstance[]>();
  for (const inst of instances) {
    const entity = inst.entity;
    if (!entity) {continue;}
    // Контейнеры не имеют данных — пропускаем, чтобы не попадали в missingEntities.
    if (entity === 'layout') {continue;}
    const list = byEntity.get(entity) ?? [];
    list.push(inst);
    byEntity.set(entity, list);
  }

  type Task = {
    key: string;
    entity: string;
    promise: Promise<unknown>;
  };

  const tasks: Task[] = [];

  for (const [entity, insts] of byEntity.entries()) {
    const entry = getLoader(entity);
    if (!entry) {
      missingEntities.push(entity);
      continue;
    }

    if (entry.cacheByEntity) {
      const first = insts[0];
      if (!first) {continue;}
      tasks.push({
        key: entity,
        entity,
        promise: entry.fn({ ctx, instance: first }),
      });
    } else {
      for (const inst of insts) {
        tasks.push({
          key: `${entity}:${inst.id}`,
          entity,
          promise: entry.fn({ ctx, instance: inst }),
        });
      }
    }
  }

  const results = await Promise.allSettled(tasks.map((t) => t.promise));

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const r = results[i];
    if (!t || !r) {continue;}

    if (r.status === 'fulfilled') {
      widgetData[t.key] = r.value;
    } else {
      widgetData[t.key] = null;
      if (!failedEntities.includes(t.entity)) {
        failedEntities.push(t.entity);
      }
    }
  }

  return { widgetData, missingEntities, failedEntities };
}

// реэкспорт для тестов
export { checkRightInMatrix };