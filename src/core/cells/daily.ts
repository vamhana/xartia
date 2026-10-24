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

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

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

/**
 * Составить/заменить наряд ячейки на дату.
 * Задачи должны быть в направлении ячейки — иначе наряд собирается из чужих
 * работ, и координатор не отвечает за то, что раздаёт.
 */
export async function upsertCellDailyPlan(input: {
  cellId: UUID;
  date: string;
  taskIds: UUID[];
  approvedById: UUID;
}): Promise<CellDailyPlanView> {
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

  const taskRows = await query<{ id: string; direction_id: string }>(
    `SELECT id, direction_id FROM tasks WHERE id = ANY($1::uuid[])`,
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
  }

  const planId = newUUID();
  await transaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM cell_daily_plans WHERE cell_id = $1 AND date = $2::date FOR UPDATE`,
      [input.cellId, input.date],
    );
    let id = existing.rows[0]?.id;
    if (id) {
      await client.query(
        `UPDATE cell_daily_plans SET approved_by = $2, status = 'approved' WHERE id = $1`,
        [id, input.approvedById],
      );
      await client.query(`DELETE FROM cell_daily_plan_tasks WHERE plan_id = $1`, [id]);
    } else {
      id = planId;
      await client.query(
        `INSERT INTO cell_daily_plans (id, cell_id, date, approved_by, status)
         VALUES ($1, $2, $3::date, $4, 'approved')`,
        [id, input.cellId, input.date, input.approvedById],
      );
    }
    for (let i = 0; i < uniqueTaskIds.length; i += 1) {
      await client.query(
        `INSERT INTO cell_daily_plan_tasks (id, plan_id, task_id, position)
         VALUES ($1, $2, $3, $4)`,
        [newUUID(), id, uniqueTaskIds[i], i],
      );
    }
  });

  await logAction({
    actorId: input.approvedById,
    actorType: 'participant',
    action: 'cells.daily_plan.upsert',
    entityType: 'cell',
    entityId: input.cellId,
    newValue: { date: input.date, tasks: uniqueTaskIds.length },
  });

  return getCellDailyPlan(input.cellId, input.date);
}

/** Назначить задачу наряда участнику ячейки. */
export async function assignCellDailyTask(input: {
  cellId: UUID;
  date: string;
  taskId: UUID;
  participantId: UUID;
  requesterId: UUID;
}): Promise<CellDailyPlanView> {
  const plan = await getPlanRow(input.cellId, input.date);
  if (!plan) {throw new NotFoundError('Наряд ячейки на дату', input.date);}

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

  const updated = await query(
    `UPDATE cell_daily_plan_tasks
        SET assigned_to = $3
      WHERE plan_id = $1 AND task_id = $2
      RETURNING id`,
    [plan.id, input.taskId, input.participantId],
  );
  if (updated.length === 0) {
    throw new NotFoundError('Задача в наряде', input.taskId);
  }

  // Задача сразу становится личной: иначе наряд существует, а исполнитель
  // о нём не знает.
  await query(
    `UPDATE tasks SET assigned_to = $2, assigned_by = $3, updated_at = now()
      WHERE id = $1`,
    [input.taskId, input.participantId, input.requesterId],
  );

  await logAction({
    actorId: input.requesterId,
    actorType: 'participant',
    action: 'cells.daily_plan.assign',
    entityType: 'task',
    entityId: input.taskId,
    newValue: { cell_id: input.cellId, date: input.date, participant_id: input.participantId },
  });

  return getCellDailyPlan(input.cellId, input.date);
}

/** Задачи направления, которые можно включить в наряд (не принятые). */
export async function listCellPlanCandidates(
  cellId: UUID,
): Promise<Array<{ id: UUID; externalId: string; description: string; status: string }>> {
  const cell = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM cells WHERE id = $1`,
    [cellId],
  );
  if (!cell?.direction_id) {return [];}

  const rows = await query<{ id: string; external_id: string; description: string; status: string }>(
    `SELECT id, external_id, description, status
       FROM tasks
      WHERE direction_id = $1
        AND status IN ('created', 'assigned', 'in_progress')
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
