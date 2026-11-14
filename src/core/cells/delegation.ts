// C.0.41.04 — Передача наряда в дочерние ячейки (5 × 5).
//
// Наряд приходит на ячейку. Её координатор может:
//   - распределить задачи по людям своей ячейки (C.0.41.03), или
//   - передать части наряда дочерним ячейкам (этот модуль), а те раздадут
//     людям сами.
//
// Задача остаётся в наряде верхней ячейки (общая картина не теряется), но
// помечается delegated_to_cell_id; в дочерней ячейке создаётся свой наряд
// на ту же дату. Одна задача — одна дочерняя ячейка: иначе два человека
// делают одно и то же.
//
// Правки:
//   - Делегировать может только координатор ячейки (или архитектор).
//   - Делегирование — только внутри направления: дочерняя ячейка обязана
//     принадлежать тому же direction_id, что и родитель.
//   - Пакеты (kind = 'package') не передаются.
//   - Версионирование: «до»/«после» у родителя и у каждой дочерней ячейки
//     через writeVersion / hasAnyVersion из ./daily.js.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  getCellDailyPlan,
  writeVersion,
  hasAnyVersion,
  type CellDailyPlanView,
  type TxClient,
} from './daily.js';
import { isCellCoordinatorOrArchitect } from './service.js';

export interface Distribution {
  childCellId: UUID;
  taskIds: UUID[];
}

export interface DelegationResult {
  parent: CellDailyPlanView;
  children: Array<CellDailyPlanView & { cellNumber: string }>;
}

async function getChildren(cellId: UUID): Promise<Array<{ id: string; number: string }>> {
  return query<{ id: string; number: string }>(
    `SELECT id, number FROM cells WHERE parent_cell_id = $1 ORDER BY number`,
    [cellId],
  );
}

/**
 * Передать задачи родительского наряда дочерним ячейкам.
 * Валидация: дочерние ячейки действительно дети; задачи входят в наряд
 * родителя; ни одна задача не передана дважды и не передана повторно;
 * ни одна задача не является package; направление совпадает.
 */
export async function distributeCellDailyPlan(input: {
  cellId: UUID;
  date: string;
  assignments: Distribution[];
  requesterId: UUID;
}): Promise<DelegationResult> {
  // Право: только координатор ячейки (или архитектор).
  if (!(await isCellCoordinatorOrArchitect(input.cellId, input.requesterId))) {
    throw new ForbiddenError('Передавать наряд может только координатор ячейки');
  }

  const parent = await getCellDailyPlan(input.cellId, input.date);
  if (!parent.planId) {
    throw new NotFoundError('Наряд ячейки на дату', input.date);
  }

  const parentCell = await queryOne<{ direction_id: string }>(
    `SELECT direction_id FROM cells WHERE id = $1`,
    [input.cellId],
  );
  if (!parentCell) {throw new NotFoundError('Ячейка', input.cellId);}

  const children = await getChildren(input.cellId);
  if (children.length === 0) {
    throw new ConflictError('У ячейки нет дочерних ячеек — передавать некому');
  }
  const childIds = new Set(children.map((c) => c.id));

  // Проверка направления дочерних ячеек.
  const childRows = await query<{ id: string; direction_id: string }>(
    `SELECT id, direction_id FROM cells WHERE id = ANY($1::uuid[])`,
    [children.map((c) => c.id)],
  );
  const childDirection = new Map(childRows.map((c) => [c.id, c.direction_id]));

  const parentTaskIds = new Set(parent.tasks.map((t) => t.taskId));
  const delegatedRows = await query<{
    task_id: string; delegated_to_cell_id: string | null;
  }>(
    `SELECT task_id, delegated_to_cell_id
       FROM cell_daily_plan_tasks WHERE plan_id = $1`,
    [parent.planId],
  );
  const alreadyDelegated = new Set(
    delegatedRows.filter((r) => r.delegated_to_cell_id).map((r) => r.task_id),
  );

  // Проверка package и направления до валидации.
  const taskKinds = await query<{ id: string; kind: string }>(
    `SELECT id, kind FROM tasks WHERE id = ANY($1::uuid[])`,
    [[...parentTaskIds]],
  );
  const kindById = new Map(taskKinds.map((t) => [t.id, t.kind]));

  const seen = new Set<string>();
  for (const a of input.assignments) {
    if (!childIds.has(a.childCellId)) {
      throw new ValidationError('Дочерняя ячейка не принадлежит этой ячейке');
    }
    if (childDirection.get(a.childCellId) !== parentCell.direction_id) {
      throw new ConflictError(
        'Дочерняя ячейка принадлежит другому направлению',
        { child_cell_id: a.childCellId },
      );
    }
    if (a.taskIds.length === 0) {continue;}
    for (const taskId of a.taskIds) {
      if (!parentTaskIds.has(taskId)) {
        throw new ConflictError(`Задача ${taskId} не входит в наряд этой ячейки`);
      }
      if (kindById.get(taskId) === 'package') {
        throw new ConflictError(`Задача ${taskId} — package, не передаётся`);
      }
      if (alreadyDelegated.has(taskId)) {
        throw new ConflictError(`Задача ${taskId} уже передана дочерней ячейке`);
      }
      if (seen.has(taskId)) {
        throw new ValidationError(`Задача ${taskId} указана дважды`);
      }
      seen.add(taskId);
    }
  }
  if (seen.size === 0) {
    throw new ValidationError('Нечего передавать: ни одной задачи');
  }

  await transaction(async (client) => {
    const tx = client as unknown as TxClient;

    // Фиксируем «до» у родителя, если истории нет.
    if (!(await hasAnyVersion(tx, parent.planId!))) {
      await writeVersion(
        tx, parent.planId!, 'Исходное состояние (до миграции)', input.requesterId,
      );
    }

    for (const a of input.assignments) {
      if (a.taskIds.length === 0) {continue;}

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM cell_daily_plans WHERE cell_id = $1 AND date = $2::date FOR UPDATE`,
        [a.childCellId, input.date],
      );
      let childPlanId = existing.rows[0]?.id;
      if (childPlanId) {
        await client.query(
          `UPDATE cell_daily_plans SET approved_by = $2, status = 'delegated' WHERE id = $1`,
          [childPlanId, input.requesterId],
        );
        // «До» у дочернего, если истории нет.
        if (!(await hasAnyVersion(tx, childPlanId))) {
          await writeVersion(
            tx, childPlanId as UUID, 'Исходное состояние (до миграции)', input.requesterId,
          );
        }
      } else {
        childPlanId = newUUID();
        await client.query(
          `INSERT INTO cell_daily_plans (id, cell_id, date, approved_by, status)
           VALUES ($1, $2, $3::date, $4, 'delegated')`,
          [childPlanId, a.childCellId, input.date, input.requesterId],
        );
        await writeVersion(
          tx, childPlanId as UUID, 'Создание наряда (делегирование)', input.requesterId,
        );
      }

      for (const taskId of a.taskIds) {
        await client.query(
          `INSERT INTO cell_daily_plan_tasks (id, plan_id, task_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (plan_id, task_id) DO NOTHING`,
          [newUUID(), childPlanId, taskId],
        );
        await client.query(
          `UPDATE cell_daily_plan_tasks
              SET delegated_to_cell_id = $3
            WHERE plan_id = $1 AND task_id = $2`,
          [parent.planId, taskId, a.childCellId],
        );
      }

      // «После» у дочернего.
      await writeVersion(
        tx, childPlanId as UUID,
        `Получено делегирование от ${input.cellId}`, input.requesterId,
      );
    }

    // «После» у родителя.
    await writeVersion(
      tx, parent.planId!,
      `Делегирование ${seen.size} задач дочерним ячейкам`, input.requesterId,
    );
  });

  await logAction({
    actorId: input.requesterId,
    actorType: 'participant',
    action: 'cells.daily_plan.distribute',
    entityType: 'cell',
    entityId: input.cellId,
    newValue: {
      date: input.date,
      assignments: input.assignments.map((a) => ({ cell: a.childCellId, tasks: a.taskIds.length })),
    },
  });

  return getDelegationTree(input.cellId, input.date);
}

/** Дерево наряда: родитель и его дочерние наряды на дату. */
export async function getDelegationTree(
  cellId: UUID,
  date: string,
): Promise<DelegationResult> {
  const parent = await getCellDailyPlan(cellId, date);
  const children = await getChildren(cellId);
  const result: Array<CellDailyPlanView & { cellNumber: string }> = [];
  for (const child of children) {
    const plan = await getCellDailyPlan(child.id as UUID, date);
    result.push({ ...plan, cellNumber: child.number });
  }
  return { parent, children: result };
}

/** Сколько задач родителя передано дочерним ячейкам. */
export async function countDelegated(planId: UUID): Promise<number> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM cell_daily_plan_tasks
      WHERE plan_id = $1 AND delegated_to_cell_id IS NOT NULL`,
    [planId],
  );
  return parseInt(row?.c ?? '0', 10);
}