// C.0.07.02 — Сервис задач
// Создание, назначение, сдача, приёмка. Мои задачи.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: submitTask — проверка assignedTo === requesterId.
//   - B2: acceptTask — проверка I.2.12 (ОТК не принимает свою работу).
//   - B3: returnTask — проверка I.2.12.
//   - B4-B5: все transitions — atomic UPDATE ... WHERE status = $orig RETURNING;
//            при 0 строк → ConflictError (race-safe).
//   - B6: createTaskService — plan.directionId === input.directionId.
//   - B7: now внутри retry-цикла.
//   - B8: createTaskService — planExists проверка (было: FK 500).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - assignTask — checkCompetencies не реализован (нет participant.competencies).
//   - listTasks/getById — нет access control (per-direction модель прав).
//   - TASK_SELECT — 2 correlated subquery на return_reason/returned_at (N+1-ish).

import { query, queryOne, isUniqueViolation, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { listByTask } from '../reports/service.js';
import { hasRole } from '../../security/rbac.js';
import { send as sendNotification, sendToRole } from '../../lib/notifications.js';
import {
  emitTaskAssigned,
  emitTaskStatusChanged,
  emitTaskSubmitted,
  emitTaskAccepted,
  emitTaskReturned,
} from '../../ws/tasks.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID, Priority, TaskStatus } from '../types.js';

/**
 * P0.5: действие с задачей — только в своём направлении.
 * Архитектор — исключение (гарант), остальные — строго своё направление.
 */
export async function assertDirectionScope(participantId: UUID, directionId: UUID): Promise<void> {
  if (await hasRole(participantId, Role.FIRST_ARCHITECT)) {return;}
  const row = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!row) {throw new ForbiddenError('Участник не найден');}
  if (row.direction_id !== directionId) {
    throw new ForbiddenError('Действие вне вашего направления');
  }
}



/**
 * Уведомление — побочный эффект, а не часть домена: его падение не должно
 * отменять назначение/сдачу/приёмку. Поэтому try/catch + лог, без rethrow.
 * В data кладём ссылку, по которой фронт открывает событие (колокольчик).
 */
async function notifySafely(
  recipientId: UUID,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sendNotification({
      recipientId,
      type,
      priority: 'standard',
      title,
      body,
      data,
    });
  } catch (e) {
    logger.warn({ err: e, recipientId, type }, 'task notification failed');
  }
}

import {
  createTask, assignTask, takeTask, submitTask, acceptTask, returnTask,
  formatTaskExternalId, getDeadlineForPriority,
  type Task,
} from './entity.js';

interface TaskRow {
  id: string;
  external_id: string;
  plan_id: string | null;
  direction_id: string;
  description: string;
  required_competencies: string[] | null;
  location: { coordinates: [number, number] } | null;
  priority: Priority;
  status: TaskStatus;
  assigned_to: string | null;
  assigned_by: string | null;
  deadline: Date | null;
  parent_task_id: string | null;
  created_at: Date;
  updated_at: Date;
  plan_title?: string | null;
  plan_expected_result?: string | null;
  assigner_name?: string | null;
  assigner_external_id?: string | null;
  in_daily_plan?: boolean | null;
  return_reason?: string | null;
  returned_at?: Date | null;
}

interface TaskWithRelations extends Task {
  planTitle: string | null;
  planExpectedResult: string | null;
  assignerName: string | null;
  assignerExternalId: string | null;
  inDailyPlan: boolean;
  returnReason: string | null;
  returnedAt: string | null;
}

function rowToTask(row: TaskRow): Task {
  let location: { lat: number; lon: number } | null = null;
  const coords = row.location?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const [lon, lat] = coords;
    if (typeof lon === 'number' && typeof lat === 'number') {
      location = { lon, lat };
    }
  }
  return {
    id: row.id,
    externalId: row.external_id,
    planId: row.plan_id,
    directionId: row.direction_id,
    description: row.description,
    requiredCompetencies: row.required_competencies ?? [],
    location,
    priority: row.priority,
    status: row.status,
    assignedTo: row.assigned_to,
    assignedBy: row.assigned_by,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    parentTaskId: row.parent_task_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToTaskWithRelations(row: TaskRow): TaskWithRelations {
  return {
    ...rowToTask(row),
    planTitle: row.plan_title ?? null,
    planExpectedResult: row.plan_expected_result ?? null,
    assignerName: row.assigner_name ?? null,
    assignerExternalId: row.assigner_external_id ?? null,
    inDailyPlan: row.in_daily_plan ?? false,
    returnReason: row.return_reason ?? null,
    returnedAt: row.returned_at ? row.returned_at.toISOString() : null,
  };
}

export interface TaskFilter {
  directionId?: UUID;
  status?: TaskStatus;
  priority?: Priority;
  assignedTo?: UUID;
  planId?: UUID;
  page?: number;
  perPage?: number;
}

const TASK_SELECT = `
  SELECT t.id, t.external_id, t.plan_id, t.direction_id, t.description,
         t.required_competencies,
         ST_AsGeoJSON(t.location)::json AS location,
         t.priority, t.status, t.assigned_to, t.assigned_by, t.deadline,
         t.parent_task_id, t.created_at, t.updated_at,
         p.title AS plan_title,
         p.expected_result AS plan_expected_result,
         ap.name AS assigner_name,
         ap.external_id AS assigner_external_id,
         CASE WHEN dpt.id IS NOT NULL THEN true ELSE false END AS in_daily_plan,
         (
           SELECT od.comment FROM otc_decisions od
             JOIN reports r2 ON r2.id = od.report_id
            WHERE r2.task_id = t.id AND od.verdict = 'returned'
            ORDER BY od.created_at DESC LIMIT 1
         ) AS return_reason,
         (
           SELECT od.created_at FROM otc_decisions od
             JOIN reports r2 ON r2.id = od.report_id
            WHERE r2.task_id = t.id AND od.verdict = 'returned'
            ORDER BY od.created_at DESC LIMIT 1
         ) AS returned_at
    FROM tasks t
    LEFT JOIN plans p ON p.id = t.plan_id
    LEFT JOIN participants ap ON ap.id = t.assigned_by
    LEFT JOIN daily_plans dp
      ON dp.direction_id = t.direction_id
     AND dp.date = CURRENT_DATE
     AND dp.status IN ('approved', 'in_progress')
    LEFT JOIN daily_plan_tasks dpt
      ON dpt.daily_plan_id = dp.id
     AND dpt.task_id = t.id
`;

export async function listTasks(filter: TaskFilter = {}): Promise<{ data: Task[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.directionId) { params.push(filter.directionId); conditions.push(`t.direction_id = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`t.status = $${params.length}`); }
  if (filter.priority) { params.push(filter.priority); conditions.push(`t.priority = $${params.length}`); }
  if (filter.assignedTo) { params.push(filter.assignedTo); conditions.push(`t.assigned_to = $${params.length}`); }
  if (filter.planId) { params.push(filter.planId); conditions.push(`t.plan_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM tasks t ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<TaskRow>(
    `${TASK_SELECT}
       ${where}
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'standard' THEN 3 ELSE 4 END,
        t.deadline NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToTaskWithRelations), total };
}

export async function getById(taskId: UUID): Promise<Task> {
  const row = await queryOne<TaskRow>(
    `${TASK_SELECT} WHERE t.id = $1`,
    [taskId],
  );
  if (!row) {throw new NotFoundError('Задача', taskId);}
  return rowToTaskWithRelations(row);
}

export async function listMyTasks(participantId: UUID): Promise<Task[]> {
  const rows = await query<TaskRow>(
    `${TASK_SELECT}
      WHERE t.assigned_to = $1 AND t.status <> 'accepted'
      ORDER BY
        CASE WHEN t.status = 'returned' THEN 0 ELSE 1 END,
        CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'standard' THEN 3 ELSE 4 END,
        t.deadline NULLS LAST`,
    [participantId],
  );
  return rows.map(rowToTaskWithRelations);
}

export interface CreateTaskRequest {
  directionId: UUID;
  description: string;
  priority: Priority;
  planId?: UUID;
  requiredCompetencies?: string[];
  location?: { lat: number; lon: number };
}

export async function createTaskService(
  input: CreateTaskRequest,
  requesterId: UUID,
): Promise<Task> {
  await assertDirectionScope(requesterId, input.directionId);

  // B8: planExists + plan.directionId match
  if (input.planId) {
    const planRow = await queryOne<{ lead_direction_id: string }>(
      `SELECT lead_direction_id FROM plans WHERE id = $1`,
      [input.planId],
    );
    if (!planRow) {throw new NotFoundError('План', input.planId);}
    if (planRow.lead_direction_id !== input.directionId) {
      throw new ConflictError('План принадлежит другому направлению', {
        plan_direction_id: planRow.lead_direction_id,
        task_direction_id: input.directionId,
      });
    }
  }

  const TASK_TYPE = 'ЗДЧ';

  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();   // ← B7: внутри цикла (retry через полночь — свежая дата)
    const dateStr = now.toISOString().slice(0, 10);
    const row = await queryOne<{ max_seq: string | null }>(
      `SELECT COALESCE(MAX(SUBSTRING(external_id FROM '([0-9]{3})$')::INT), 0)::text AS max_seq
         FROM tasks
        WHERE external_id LIKE $1`,
      [`${TASK_TYPE}-${dateStr}-%`],
    );
    const nextSeq = parseInt(row?.max_seq ?? '0', 10) + 1;
    if (nextSeq > 999) {
      throw new ConflictError('Достигнут дневной лимит задач этого типа (999)');
    }

    const externalId = formatTaskExternalId(TASK_TYPE, now, nextSeq);

    const entity = createTask({
      id: newUUID(),
      externalId,
      directionId: input.directionId,
      description: input.description,
      priority: input.priority,
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.requiredCompetencies ? { requiredCompetencies: input.requiredCompetencies } : {}),
      ...(input.location ? { location: input.location } : {}),
      baseTime: now,
    });

    const locationSql = entity.location
      ? `ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography`
      : 'NULL';

    const params: unknown[] = [
      entity.id, entity.externalId, entity.planId, entity.directionId,
      entity.description, JSON.stringify(entity.requiredCompetencies),
      entity.priority, entity.status, entity.deadline, requesterId,
    ];
    if (entity.location) {
      params.push(entity.location.lon, entity.location.lat);
    }

    try {
      await query(
        `INSERT INTO tasks
           (id, external_id, plan_id, direction_id, description, required_competencies,
            priority, status, deadline, assigned_by, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${locationSql})`,
        params,
      );

      await logAction({
        actorId: requesterId,
        actorType: 'participant',
        action: 'tasks.create',
        entityType: 'task',
        entityId: entity.id,
        newValue: { external_id: entity.externalId, priority: entity.priority },
      });

      return getById(entity.id);
    } catch (e) {
      if (isUniqueViolation(e)) {continue;}
      throw e;
    }
  }

  throw new ConflictError('Не удалось сгенерировать уникальный external_id для задачи');
}

// -------- Transitions: entity-validate + atomic UPDATE (B4-fix) --------

function toWsPayload(t: Task): {
  id: string;
  externalId: string;
  directionId: string;
  planId: string | null;
  description: string;
  priority: Priority;
  status: TaskStatus;
  assignedTo: string | null;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: t.id,
    externalId: t.externalId,
    directionId: t.directionId,
    planId: t.planId,
    description: t.description,
    priority: t.priority,
    status: t.status,
    assignedTo: t.assignedTo,
    deadline: t.deadline,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// TODO(techdebt): assignTask — checkCompetencies не реализован.
// В participants нет поля competencies; task.required_competencies
// сохраняется, но не сверяется при назначении.

export async function assignTaskService(
  taskId: UUID, participantId: UUID, requesterId: UUID,
): Promise<Task> {
  const task = await getById(taskId);
  await assertDirectionScope(requesterId, task.directionId);
  await assertDirectionScope(participantId, task.directionId);
  assignTask(task, participantId);  // entity-validate: даст понятную ошибку для invalid state

  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET status = 'assigned', assigned_to = $1, assigned_by = $2, updated_at = now()
      WHERE id = $3 AND status = $4
      RETURNING id`,
    [participantId, requesterId, taskId, task.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Задача изменена параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'tasks.assign', entityType: 'task', entityId: taskId,
    newValue: { assigned_to: participantId },
  });

  const finalTask = await getById(taskId);
  await emitTaskAssigned(toWsPayload(finalTask), participantId);
  await notifySafely(
    participantId,
    'task.assigned',
    'Вам назначена задача',
    `${finalTask.externalId}: ${finalTask.description.slice(0, 160)}`,
    { taskId, link: `/tasks/${taskId}/report` },
  );
  return finalTask;
}

export async function takeTaskService(taskId: UUID, participantId: UUID): Promise<Task> {
  const task = await getById(taskId);
  if (task.assignedTo !== participantId) {
    throw new ForbiddenError('Взять задачу может только назначенный исполнитель');
  }
  takeTask(task, participantId);  // entity-validate

  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET status = 'in_progress', updated_at = now()
      WHERE id = $1 AND status = $2 AND assigned_to = $3
      RETURNING id`,
    [taskId, task.status, participantId],
  );
  if (result.length === 0) {
    throw new ConflictError('Задача изменена параллельным запросом');
  }

  await logAction({
    actorId: participantId, actorType: 'participant',
    action: 'tasks.take', entityType: 'task', entityId: taskId,
  });

  const finalTask = await getById(taskId);
  await emitTaskStatusChanged(toWsPayload(finalTask), task.status);
  return finalTask;
}

export async function submitTaskService(taskId: UUID, requesterId: UUID): Promise<Task> {
  const task = await getById(taskId);
  // B1: только назначенный может сдать (spec: self-service)
  if (task.assignedTo !== requesterId) {
    throw new ForbiddenError('Сдать задачу может только назначенный исполнитель');
  }
  // P0.2: результат без артефакта не принимается — отчёт обязателен.
  const reports = await listByTask(taskId);
  if (!reports.some((r) => typeof r.artifactUrl === 'string' && r.artifactUrl.length > 0)) {
    throw new ConflictError('Нельзя сдать: приложите отчёт с артефактом (ссылка на коммит/PR)');
  }
  submitTask(task);  // entity-validate

  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET status = 'submitted', updated_at = now()
      WHERE id = $1 AND status = $2 AND assigned_to = $3
      RETURNING id`,
    [taskId, task.status, requesterId],
  );
  if (result.length === 0) {
    throw new ConflictError('Задача изменена параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'tasks.submit', entityType: 'task', entityId: taskId,
  });

  const finalTask = await getById(taskId);
  await emitTaskSubmitted(toWsPayload(finalTask));

  // Уведомляем ОТК направления: задача встала в очередь на проверку.
  try {
    await sendToRole(
      Role.OTC,
      {
        type: 'otc.report_submitted',
        priority: 'standard',
        title: 'Отчёт ждёт проверки',
        body: `${finalTask.externalId}: ${finalTask.description.slice(0, 160)}`,
        data: { taskId, link: '/otc' },
      },
      finalTask.directionId,
    );
  } catch (e) {
    logger.warn({ err: e, taskId }, 'отчёт: уведомление ОТК не отправлено');
  }

  return finalTask;
}

export interface AcceptOptions {
  comment?: string | null;
  criteria?: Array<{ id: string; passed: boolean; comment?: string }>;
}

/**
 * Единый путь приёмки (P0):
 *   - отчёт с артефактом обязателен;
 *   - решение ОТК создаётся, если его нет;
 *   - статус задачи и начисление Потока — в одной транзакции;
 *   - task_flow_awards не даёт начислить дважды.
 */
export async function acceptTaskService(
  taskId: UUID,
  requesterId: UUID,
  options: AcceptOptions = {},
): Promise<Task> {
  const task = await getById(taskId);
  // B2: I.2.12 — ОТК не принимает свою работу.
  if (task.assignedTo === requesterId) {
    throw new ForbiddenError('ОТК не может принять свою работу (I.2.12)');
  }
  acceptTask(task);  // entity-validate
  await assertDirectionScope(requesterId, task.directionId);

  // P0.1/P0.2: без отчёта с артефактом приёмки нет.
  const reports = await listByTask(taskId);
  const report = reports.find(
    (r) => typeof r.artifactUrl === 'string' && r.artifactUrl.length > 0,
  );
  if (!report) {
    throw new ConflictError('Нельзя принять: нет отчёта с артефактом');
  }

  const decisionId = newUUID();
  const criteria = await queryOne<{ version: number; title: string; items: unknown }>(
    `SELECT version, title, items
       FROM otc_criteria
      WHERE active AND (direction_id = $1 OR direction_id IS NULL)
      ORDER BY direction_id NULLS LAST
      LIMIT 1`,
    [task.directionId],
  );
  if (criteria) {
    const items = Array.isArray(criteria.items)
      ? criteria.items as Array<{ id: string; title: string; required?: boolean }>
      : [];
    const passed = new Map((options.criteria ?? []).map((r) => [r.id, r.passed]));
    const missing = items
      .filter((item) => item.required !== false)
      .filter((item) => passed.get(item.id) !== true)
      .map((item) => item.title);
    if (missing.length > 0) {
      throw new ConflictError(
        `Не подтверждены обязательные критерии: ${missing.join('; ')}`,
        { missing },
      );
    }
  }
  const criteriaSnapshot = criteria
    ? JSON.stringify({
        version: criteria.version,
        title: criteria.title,
        items: criteria.items,
        results: options.criteria ?? [],
      })
    : null;

  // P0.3: решение, статус и Поток — атомарно.
  await transaction(async (client) => {
    const locked = await client.query<{ status: string; assigned_to: string | null }>(
      `SELECT status, assigned_to FROM tasks WHERE id = $1 FOR UPDATE`,
      [taskId],
    );
    const row = locked.rows[0];
    if (!row || row.status !== 'submitted') {
      throw new ConflictError('Задача изменена параллельным запросом');
    }

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM otc_decisions
        WHERE report_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [report.id],
    );
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO otc_decisions
           (id, report_id, otc_id, verdict, comment, criteria_version, criteria_snapshot)
         VALUES ($1, $2, $3, 'accepted', $4, $5, $6)`,
        [decisionId, report.id, requesterId, options.comment ?? null,
         criteria?.version ?? 1, criteriaSnapshot],
      );
    }

    await client.query(
      `UPDATE tasks SET status = 'accepted', updated_at = now() WHERE id = $1`,
      [taskId],
    );

    // P0.4: одно начисление на задачу — атомарный клейм.
    if (row.assigned_to) {
      const claim = await client.query(
        `INSERT INTO task_flow_awards (task_id, participant_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id) DO NOTHING
         RETURNING task_id`,
        [taskId, row.assigned_to],
      );
      if ((claim.rowCount ?? 0) === 1) {
        await client.query(
          `INSERT INTO flow_transactions
             (id, participant_id, type, amount, reason, source, task_id)
           VALUES ($1, $2, 'main', 1, $3, 'otc', $4)`,
          [newUUID(), row.assigned_to, `Приёмка задачи ${taskId}`, taskId],
        );
      }
    }
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'tasks.accept', entityType: 'task', entityId: taskId,
    newValue: { decision_id: decisionId, report_id: report.id },
  });

  const finalTask = await getById(taskId);
  await emitTaskAccepted(toWsPayload(finalTask));

  if (finalTask.assignedTo) {
    await notifySafely(
      finalTask.assignedTo,
      'task.accepted',
      'Задача принята',
      `${finalTask.externalId} принята ОТК — работа зачтена в Поток`,
      { taskId, link: `/tasks/${taskId}/report` },
    );
  }
  return finalTask;
}

export async function returnTaskService(
  taskId: UUID, reason: string, requesterId: UUID,
): Promise<Task> {
  const task = await getById(taskId);
  // B3: I.2.12 — ОТК не возвращает свою работу.
  if (task.assignedTo === requesterId) {
    throw new ForbiddenError('ОТК не может вернуть свою работу (I.2.12)');
  }
  await assertDirectionScope(requesterId, task.directionId);
  returnTask(task, reason);  // entity-validate

  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET status = 'returned', updated_at = now()
      WHERE id = $1 AND status = $2
      RETURNING id`,
    [taskId, task.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Задача изменена параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'tasks.return', entityType: 'task', entityId: taskId,
    newValue: { reason },
  });

  const finalTask = await getById(taskId);
  await emitTaskReturned(toWsPayload(finalTask), reason);
  if (finalTask.assignedTo) {
    await notifySafely(
      finalTask.assignedTo,
      'task.returned',
      'Задача возвращена на доработку',
      `${finalTask.externalId}: ${reason.slice(0, 160)}`,
      { taskId, link: `/tasks/${taskId}/report` },
    );
  }
  return finalTask;
}


/**
 * P1: пересмотр принятой задачи.
 * Возвращает в работу, отменяет начисленный Поток обратной проводкой
 * и снимает клейм — повторная приёмка снова начислит ровно один Поток.
 */
export async function reopenTaskService(
  taskId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<Task> {
  const task = await getById(taskId);
  if (task.status !== 'accepted') {
    throw new ConflictError('Пересмотреть можно только принятую задачу');
  }
  if (task.assignedTo === requesterId) {
    throw new ForbiddenError('Нельзя пересматривать свою работу (I.2.12)');
  }
  await assertDirectionScope(requesterId, task.directionId);

  await transaction(async (client) => {
    const locked = await client.query<{ status: string; assigned_to: string | null }>(
      `SELECT status, assigned_to FROM tasks WHERE id = $1 FOR UPDATE`,
      [taskId],
    );
    const row = locked.rows[0];
    if (!row || row.status !== 'accepted') {
      throw new ConflictError('Задача изменена параллельным запросом');
    }

    await client.query(
      `UPDATE tasks
          SET status = 'in_progress',
              reopened_count = reopened_count + 1,
              last_reopen_reason = $2,
              last_reopened_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [taskId, reason],
    );

    const award = await client.query<{ participant_id: string }>(
      `DELETE FROM task_flow_awards WHERE task_id = $1 RETURNING participant_id`,
      [taskId],
    );
    if ((award.rowCount ?? 0) === 1) {
      const pid = award.rows[0]?.participant_id;
      if (pid) {
        await client.query(
          `INSERT INTO flow_transactions
             (id, participant_id, type, amount, reason, source, task_id)
           VALUES ($1, $2, 'main', -1, $3, 'otc_reopen', $4)`,
          [newUUID(), pid, `Пересмотр задачи ${taskId}: ${reason}`, taskId],
        );
      }
    }
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'tasks.reopen', entityType: 'task', entityId: taskId,
    newValue: { reason },
  });

  const finalTask = await getById(taskId);
  await emitTaskStatusChanged(toWsPayload(finalTask), 'accepted');
  if (finalTask.assignedTo) {
    await notifySafely(
      finalTask.assignedTo,
      'task.reopened',
      'Задача возвращена на пересмотр',
      `${finalTask.externalId}: ${reason.slice(0, 160)}`,
      { taskId, link: `/tasks/${taskId}/report` },
    );
  }
  return finalTask;
}

export { getDeadlineForPriority };