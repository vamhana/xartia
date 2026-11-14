// C.0.41.03 — Наряд ячейки.
//
// Наряд приходит на ячейку, координатор распределяет задачи по людям.
// Иерархия ячеек (parent_cell_id) даёт «нарастающую» схему: координатор над
// пятью ячейками распределяет по ячейкам, а те — по людям.
//
// Границы ответственности:
//   - состав наряда (какие задачи) определяет координатор ячейки;
//   - назначить задачу можно только участнику этой ячейки (иначе это уже не
//     наряд ячейки, а перекладывание работы на чужих людей);
//   - назначение ставит tasks.assigned_to, поэтому задача сразу появляется
//     в «Моих задачах» исполнителя и в его панели.
//
// D.2.01.67 + версионирование:
//   - upsertCellDailyPlan — транзакция: FOR UPDATE плана → снимок в
//     cell_daily_plan_versions → DELETE+INSERT в cell_daily_plan_tasks.
//     При первом создании — v1 (пустой) + v2 (сформированный).
//     При обновлении существующего — «Исходное состояние» (если истории не
//     было вовсе, миграция) + версия с reason после изменения.
//   - assignCellDailyTask — транзакция: FOR UPDATE задачи и наряда →
//     проверки (kind, status, direction, participant ∈ cell) →
//     UPDATE cell_daily_plan_tasks + UPDATE tasks атомарно.
//   - upsert / assign требуют координатора ячейки (или архитектора).
//   - Пакеты (kind = 'package') не входят в наряд — организационные контейнеры.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import { isCellCoordinatorOrArchitect } from './service.js';

export interface CellDailyTask {
  taskId: UUID;
  externalId: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  assignedTo: UUID | null;
  assignedName: string | null;
}

export interface CellDailyPlanView {
  planId: UUID | null;
  cellId: UUID;
  date: string;
  status: string;
  tasks: CellDailyTask[];
}

interface PlanRow {
  id: string;
  cell_id: string;
  date: string;
  status: string;
}

async function getPlanRow(cellId: UUID, date: string): Promise<PlanRow | null> {
  return queryOne<PlanRow>(
    `SELECT id, cell_id, date::text AS date, status
       FROM cell_daily_plans
      WHERE cell_id = $1 AND date = $2::date
      LIMIT 1`,
    [cellId, date],
  );
}

export async function getCellDailyPlan(
  cellId: UUID,
  date: string,
): Promise<CellDailyPlanView> {
  const plan = await getPlanRow(cellId, date);
  if (!plan) {
    return { planId: null, cellId, date, status: 'absent', tasks: [] };
  }

  const rows = await query<{
    task_id: string;
    external_id: string;
    description: string;
    status: string;
    priority: string;
    deadline: Date | null;
    assigned_to: string | null;
    assigned_name: string | null;
  }>(
    `SELECT t.id AS task_id, t.external_id, t.description, t.status, t.priority,
            t.deadline, cpt.assigned_to, p.name AS assigned_name
       FROM cell_daily_plan_tasks cpt
       JOIN tasks t ON t.id = cpt.task_id
       LEFT JOIN participants p ON p.id = cpt.assigned_to
      WHERE cpt.plan_id = $1
      ORDER BY cpt.position, t.external_id`,
    [plan.id],
  );

  return {
    planId: plan.id as UUID,
    cellId,
    date,
    status: plan.status,
    tasks: rows.map((r) => ({
      taskId: r.task_id as UUID,
      externalId: r.external_id,
      description: r.description,
      status: r.status,
      priority: r.priority,
      deadline: r.deadline ? r.deadline.toISOString() : null,
      assignedTo: (r.assigned_to as UUID | null) ?? null,
      assignedName: r.assigned_name,
    })),
  };
}

// ─── Версии ──────────────────────────────────────────────────────────

interface VersionSnapshot {
  tasks: Array<{
    taskId: string;
    position: number;
    assignedTo: string | null;
    delegatedToCellId: string | null;
  }>;
  status: string;
  approvedBy: string;
}

export type TxClient = {
  query: <R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>;
};

export async function hasAnyVersion(client: TxClient, planId: string): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM cell_daily_plan_versions WHERE plan_id = $1) AS exists`,
    [planId],
  );
  return r.rows[0]?.exists === true;
}

/**
 * Записать текущее состояние наряда как новую версию.
 * reason — человекочитаемая причина (сохраняется как есть).
 */
export async function writeVersion(
  client: TxClient,
  planId: UUID,
  reason: string,
  actorId: UUID,
): Promise<number> {
  const tasks = await client.query<{
    task_id: string;
    position: number;
    assigned_to: string | null;
    delegated_to_cell_id: string | null;
  }>(
    `SELECT task_id, position, assigned_to, delegated_to_cell_id
       FROM cell_daily_plan_tasks WHERE plan_id = $1 ORDER BY position`,
    [planId],
  );
  const plan = await client.query<{ status: string; approved_by: string }>(
    `SELECT status, approved_by FROM cell_daily_plans WHERE id = $1`,
    [planId],
  );
  const p = plan.rows[0];
  if (!p) {throw new NotFoundError('Наряд ячейки', planId);}

  const snapshot: VersionSnapshot = {
    tasks: tasks.rows.map((r) => ({
      taskId: String(r.task_id),
      position: Number(r.position),
      assignedTo: r.assigned_to ? String(r.assigned_to) : null,
      delegatedToCellId: r.delegated_to_cell_id ? String(r.delegated_to_cell_id) : null,
    })),
    status: p.status,
    approvedBy: p.approved_by,
  };

  const next = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM cell_daily_plan_versions WHERE plan_id = $1`,
    [planId],
  );
  const version = Number(next.rows[0]?.next ?? 1);

  await client.query(
    `INSERT INTO cell_daily_plan_versions
       (plan_id, version, snapshot, reason, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [planId, version, JSON.stringify(snapshot), reason, actorId],
  );
  return version;
}

export interface CellPlanVersion {
  version: number;
  snapshot: VersionSnapshot;
  reason: string | null;
  createdAt: string;
  createdBy: UUID;
}

export async function listCellPlanVersions(
  cellId: UUID,
  date: string,
): Promise<CellPlanVersion[]> {
  const plan = await getPlanRow(cellId, date);
  if (!plan) {return [];}
  const rows = await query<{
    version: number;
    snapshot: VersionSnapshot;
    reason: string | null;
    created_at: Date;
    created_by: string;
  }>(
    `SELECT version, snapshot, reason, created_at, created_by
       FROM cell_daily_plan_versions
      WHERE plan_id = $1
      ORDER BY version DESC`,
    [plan.id],
  );
  return rows.map((r) => ({
    version: r.version,
    snapshot: r.snapshot,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by as UUID,
  }));
}

// ─── upsert с версионированием ───────────────────────────────────────

/**
 * Составить/заменить наряд ячейки на дату.
 * Задачи должны быть в направлении ячейки — иначе наряд собирается из чужих
 * работ, и координатор не отвечает за то, что раздаёт.
 * Пакеты (kind = 'package') не входят в наряд.
 */
export async function upsertCellDailyPlan(input: {
  cellId: UUID;
  date: string;
  taskIds: UUID[];
  approvedById: UUID;
  reason?: string;
}): Promise<CellDailyPlanView> {
  if (!(await isCellCoordinatorOrArchitect(input.cellId, input.approvedById))) {
    throw new ForbiddenError('Составлять наряд может только координатор ячейки');
  }

  const cell = await queryOne<{ id: string; direction_id: string | null }>(
    `SELECT id, direction_id FROM cells WHERE id = $1`,
    [input.cellId],
  );
  if (!cell) {throw new NotFoundError('Ячейка', input.cellId);}
  if (!cell.direction_id) {
    throw new ConflictError('У ячейки нет направления — наряд собрать не из чего');
  }

  const uniqueTaskIds = [...new Set(input.taskIds)];
  if (uniqueTaskIds.length === 0) {
    throw new ValidationError('Наряд не может быть пустым');
  }
  if (uniqueTaskIds.length > 50) {
    throw new ValidationError('В наряд ячейки — не больше 50 задач');
  }

  const taskRows = await query<{ id: string; direction_id: string; kind: string }>(
    `SELECT id, direction_id, kind FROM tasks WHERE id = ANY($1::uuid[])`,
    [uniqueTaskIds],
  );
  const found = new Set(taskRows.map((t) => t.id));
  const missing = uniqueTaskIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new NotFoundError(`Задача(и) не найдены: ${missing.join(', ')}`);
  }
  for (const t of taskRows) {
    if (t.direction_id !== cell.direction_id) {
      throw new ConflictError(`Задача ${t.id} из другого направления`);
    }
    if (t.kind === 'package') {
      throw new ConflictError(`Задача ${t.id} — package, не входит в наряд`);
    }
  }

  await transaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM cell_daily_plans WHERE cell_id = $1 AND date = $2::date FOR UPDATE`,
      [input.cellId, input.date],
    );

    let planId: string;
    if (existing.rows[0]) {
      planId = existing.rows[0].id;

      // Если у наряда нет истории — фиксируем текущее состояние как v1.
      if (!(await hasAnyVersion(client as unknown as TxClient, planId))) {
        await writeVersion(
          client as unknown as TxClient, planId as UUID,
          'Исходное состояние (до миграции)', input.approvedById,
        );
      }

      await client.query(
        `UPDATE cell_daily_plans SET approved_by = $2, status = 'approved' WHERE id = $1`,
        [planId, input.approvedById],
      );
      await client.query(`DELETE FROM cell_daily_plan_tasks WHERE plan_id = $1`, [planId]);
      for (let i = 0; i < uniqueTaskIds.length; i += 1) {
        await client.query(
          `INSERT INTO cell_daily_plan_tasks (id, plan_id, task_id, position)
           VALUES ($1, $2, $3, $4)`,
          [newUUID(), planId, uniqueTaskIds[i], i],
        );
      }
      await writeVersion(
        client as unknown as TxClient, planId as UUID,
        input.reason ?? 'Обновление наряда', input.approvedById,
      );
    } else {
      planId = newUUID();
      await client.query(
        `INSERT INTO cell_daily_plans (id, cell_id, date, approved_by, status)
         VALUES ($1, $2, $3::date, $4, 'approved')`,
        [planId, input.cellId, input.date, input.approvedById],
      );
      // v1 — пустой наряд как точка 0.
      await writeVersion(
        client as unknown as TxClient, planId as UUID,
        'Создание наряда (пустой)', input.approvedById,
      );
      for (let i = 0; i < uniqueTaskIds.length; i += 1) {
        await client.query(
          `INSERT INTO cell_daily_plan_tasks (id, plan_id, task_id, position)
           VALUES ($1, $2, $3, $4)`,
          [newUUID(), planId, uniqueTaskIds[i], i],
        );
      }
      // v2 — сформированный наряд.
      await writeVersion(
        client as unknown as TxClient, planId as UUID,
        'Формирование наряда', input.approvedById,
      );
    }
  });

  await logAction({
    actorId: input.approvedById,
    actorType: 'participant',
    action: 'cells.daily_plan.upsert',
    entityType: 'cell',
    entityId: input.cellId,
    newValue: { date: input.date, tasks: uniqueTaskIds.length, reason: input.reason ?? null },
  });

  return getCellDailyPlan(input.cellId, input.date);
}

/** Назначить задачу наряда участнику ячейки (атомарно). */
export async function assignCellDailyTask(input: {
  cellId: UUID;
  date: string;
  taskId: UUID;
  participantId: UUID;
  requesterId: UUID;
}): Promise<CellDailyPlanView> {
  const plan = await getPlanRow(input.cellId, input.date);
  if (!plan) {throw new NotFoundError('Наряд ячейки на дату', input.date);}

  if (!(await isCellCoordinatorOrArchitect(input.cellId, input.requesterId))) {
    throw new ForbiddenError('Назначать задачи в наряде может только координатор ячейки');
  }

  const member = await queryOne<{ id: string }>(
    `SELECT id FROM cell_members
      WHERE cell_id = $1 AND participant_id = $2
        AND (valid_to IS NULL OR valid_to > now())
      LIMIT 1`,
    [input.cellId, input.participantId],
  );
  if (!member) {
    throw new ForbiddenError('Назначать можно только участнику этой ячейки');
  }

  let previousAssignee: string | null = null;
  let assignmentVersion = 0;

  await transaction(async (client) => {
    const taskLock = await client.query<{
      id: string; status: string; kind: string; direction_id: string;
      assigned_to: string | null;
    }>(
      `SELECT id, status, kind, direction_id, assigned_to
         FROM tasks WHERE id = $1 FOR UPDATE`,
      [input.taskId],
    );
    const task = taskLock.rows[0];
    if (!task) {throw new NotFoundError('Задача', input.taskId);}
    if (task.kind === 'package') {
      throw new ConflictError('Пакет работ не назначается исполнителю');
    }
    if (task.status === 'submitted' || task.status === 'accepted') {
      throw new ConflictError(`Задача в статусе ${task.status} — нельзя переназначить`);
    }
    if (task.status === 'in_progress') {
      throw new ConflictError(
        'Прямое переназначение задачи в работе запрещено — используйте процедуру передачи',
      );
    }

    previousAssignee = task.assigned_to;

    const planLock = await client.query<{ id: string }>(
      `SELECT id FROM cell_daily_plans WHERE cell_id = $1 AND date = $2::date FOR UPDATE`,
      [input.cellId, input.date],
    );
    const planId = planLock.rows[0]?.id;
    if (!planId) {throw new NotFoundError('Наряд ячейки на дату', input.date);}

    if (!(await hasAnyVersion(client as unknown as TxClient, planId))) {
      await writeVersion(
        client as unknown as TxClient, planId as UUID,
        'Исходное состояние (до миграции)', input.requesterId,
      );
    }

    const updated = await client.query(
      `UPDATE cell_daily_plan_tasks SET assigned_to = $3
        WHERE plan_id = $1 AND task_id = $2 RETURNING id`,
      [planId, input.taskId, input.participantId],
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new NotFoundError('Задача в наряде', input.taskId);
    }

    // Статус не меняем: created → assigned (первое назначение),
    // assigned → assigned (переназначение).
    const nextStatus = task.status === 'created' ? 'assigned' : task.status;
    await client.query(
      `UPDATE tasks
          SET assigned_to = $2, assigned_by = $3, status = $4, updated_at = now()
        WHERE id = $1`,
      [input.taskId, input.participantId, input.requesterId, nextStatus],
    );

    assignmentVersion = await writeVersion(
      client as unknown as TxClient, planId as UUID,
      `Назначение задачи ${input.taskId} на ${input.participantId}`,
      input.requesterId,
    );
  });

  await logAction({
    actorId: input.requesterId,
    actorType: 'participant',
    action: 'cells.daily_plan.assign',
    entityType: 'task',
    entityId: input.taskId,
    oldValue: { assigned_to: previousAssignee },
    newValue: {
      cell_id: input.cellId, date: input.date,
      participant_id: input.participantId,
      version: assignmentVersion,
    },
  });

  return getCellDailyPlan(input.cellId, input.date);
}

/** Задачи направления, которые можно включить в наряд (не принятые, не пакеты). */
export async function listCellPlanCandidates(
  cellId: UUID,
): Promise<Array<{ id: UUID; externalId: string; description: string; status: string }>> {
  const cell = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM cells WHERE id = $1`,
    [cellId],
  );
  if (!cell?.direction_id) {return [];}

  const rows = await query<{
    id: string; external_id: string; description: string; status: string;
  }>(
    `SELECT id, external_id, description, status
       FROM tasks
      WHERE direction_id = $1
        AND status IN ('created', 'assigned', 'in_progress')
        AND kind = 'deliverable'
      ORDER BY
        CASE status WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END,
        deadline NULLS LAST
      LIMIT 200`,
    [cell.direction_id],
  );
  return rows.map((r) => ({
    id: r.id as UUID,
    externalId: r.external_id,
    description: r.description,
    status: r.status,
  }));
}