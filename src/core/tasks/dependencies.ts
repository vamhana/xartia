// C.0.07.03 — Зависимости задач.
//
// Иерархия (parent_task_id) и зависимости (task_dependencies) — разные вещи.
// Здесь — только зависимости. Проверка циклов — рекурсивным CTE в транзакции
// с блокировкой строк, чтобы параллельное добавление не создало цикл.
//
// Инварианты:
//   - нельзя зависеть от себя (CHECK в БД + проверка в сервисе);
//   - нельзя создать дубликат (UNIQUE в БД + 409 в сервисе);
//   - нельзя создать цикл (проверка сервисом);
//   - завершение предшествующей задачи не завершает зависимую — блокировка
//     снимается, но работа остаётся за исполнителем.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

export type DependencyType = 'blocks';

export interface TaskDependency {
  id: UUID;
  taskId: UUID;
  dependsOnTaskId: UUID;
  dependencyType: DependencyType;
  createdBy: UUID;
  createdAt: string;
}

export interface BlockingDependency {
  dependencyId: UUID;
  taskId: UUID;
  externalId: string;
  description: string;
  status: string;
}

interface DependencyRow {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: DependencyType;
  created_by: string;
  created_at: Date;
}

function rowToDependency(r: DependencyRow): TaskDependency {
  return {
    id: r.id as UUID,
    taskId: r.task_id as UUID,
    dependsOnTaskId: r.depends_on_task_id as UUID,
    dependencyType: r.dependency_type,
    createdBy: r.created_by as UUID,
    createdAt: r.created_at.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Чтение
// ─────────────────────────────────────────────────────────────────────

export async function listDependencies(taskId: UUID): Promise<TaskDependency[]> {
  const rows = await query<DependencyRow>(
    `SELECT id, task_id, depends_on_task_id, dependency_type, created_by, created_at
       FROM task_dependencies
      WHERE task_id = $1
      ORDER BY created_at`,
    [taskId],
  );
  return rows.map(rowToDependency);
}

/** Блокирующие зависимости: depends_on ещё не accepted. */
export async function getBlockingDependencies(taskId: UUID): Promise<BlockingDependency[]> {
  const rows = await query<{
    dependency_id: string;
    id: string;
    external_id: string;
    description: string;
    status: string;
  }>(
    `SELECT td.id AS dependency_id, dep.id, dep.external_id, dep.description, dep.status
       FROM task_dependencies td
       JOIN tasks dep ON dep.id = td.depends_on_task_id
      WHERE td.task_id = $1
        AND td.dependency_type = 'blocks'
        AND dep.status <> 'accepted'
      ORDER BY dep.external_id`,
    [taskId],
  );
  return rows.map((r) => ({
    dependencyId: r.dependency_id as UUID,
    taskId: r.id as UUID,
    externalId: r.external_id,
    description: r.description,
    status: r.status,
  }));
}

/** Быстрый предикат для takeTask. */
export async function isBlockedByDependencies(taskId: UUID): Promise<boolean> {
  const row = await queryOne<{ blocked: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM task_dependencies td
       JOIN tasks dep ON dep.id = td.depends_on_task_id
       WHERE td.task_id = $1
         AND td.dependency_type = 'blocks'
         AND dep.status <> 'accepted'
     ) AS blocked`,
    [taskId],
  );
  return row?.blocked ?? false;
}

// ─────────────────────────────────────────────────────────────────────
// Создание
// ─────────────────────────────────────────────────────────────────────

export async function addDependency(input: {
  taskId: UUID;
  dependsOnTaskId: UUID;
  dependencyType?: DependencyType;
  requesterId: UUID;
}): Promise<TaskDependency> {
  if (input.taskId === input.dependsOnTaskId) {
    throw new ValidationError('Задача не может зависеть от самой себя');
  }
  const type: DependencyType = input.dependencyType ?? 'blocks';

  return transaction(async (client) => {
    // 1. Блокируем обе задачи — защита от гонки при параллельном добавлении.
    const exists = await client.query<{ id: string }>(
      `SELECT id FROM tasks WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[input.taskId, input.dependsOnTaskId]],
    );
    if (exists.rows.length !== 2) {
      const found = new Set(exists.rows.map((r) => r.id));
      const missing = [input.taskId, input.dependsOnTaskId].filter((id) => !found.has(id));
      throw new NotFoundError(`Задача(и) не найдены: ${missing.join(', ')}`);
    }

    // 2. Проверка цикла: существует ли путь depends_on → … → task?
    //    Если да, добавление task → depends_on создаст цикл.
    const cycle = await client.query<{ has_path: boolean }>(
      `WITH RECURSIVE reach AS (
         SELECT depends_on_task_id AS target
           FROM task_dependencies
          WHERE task_id = $1
         UNION
         SELECT td.depends_on_task_id
           FROM task_dependencies td
           JOIN reach r ON td.task_id = r.target
       )
       SELECT EXISTS (SELECT 1 FROM reach WHERE target = $2) AS has_path`,
      [input.dependsOnTaskId, input.taskId],
    );
    if (cycle.rows[0]?.has_path) {
      throw new ConflictError(
        'Добавление зависимости создаёт цикл',
        { task_id: input.taskId, depends_on_task_id: input.dependsOnTaskId },
      );
    }

    // 3. INSERT (UNIQUE защитит от дубля, но дадим понятную ошибку).
    const id = newUUID();
    try {
      const ins = await client.query<DependencyRow>(
        `INSERT INTO task_dependencies
           (id, task_id, depends_on_task_id, dependency_type, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, task_id, depends_on_task_id, dependency_type, created_by, created_at`,
        [id, input.taskId, input.dependsOnTaskId, type, input.requesterId],
      );
      return rowToDependency(ins.rows[0]!);
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505' && err.constraint === 'uq_dep_pair') {
        throw new ConflictError('Зависимость уже существует', {
          task_id: input.taskId,
          depends_on_task_id: input.dependsOnTaskId,
        });
      }
      throw e;
    }
  }).then(async (dep) => {
    await logAction({
      actorId: input.requesterId,
      actorType: 'participant',
      action: 'tasks.dependency.add',
      entityType: 'task',
      entityId: input.taskId,
      newValue: { depends_on_task_id: input.dependsOnTaskId, type },
    });
    return dep;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Удаление
// ─────────────────────────────────────────────────────────────────────

export async function removeDependency(input: {
  taskId: UUID;
  dependencyId: UUID;
  requesterId: UUID;
}): Promise<void> {
  const removed = await query<{ depends_on_task_id: string }>(
    `DELETE FROM task_dependencies
      WHERE id = $1 AND task_id = $2
      RETURNING depends_on_task_id`,
    [input.dependencyId, input.taskId],
  );
  if (removed.length === 0) {
    throw new NotFoundError('Зависимость', input.dependencyId);
  }
  await logAction({
    actorId: input.requesterId,
    actorType: 'participant',
    action: 'tasks.dependency.remove',
    entityType: 'task',
    entityId: input.taskId,
    oldValue: { depends_on_task_id: removed[0]!.depends_on_task_id },
  });
}