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
// v0.0.03 (C.1.10.01, §11.2, Фаза 3a):
//   - assignTaskService: проверка Matching при назначении.
//       no_match  → ConflictError, назначение запрещено (override невозможен).
//       partial   → требуется AssignOptions.override (reason, risk, accompanying,
//                   training), подтверждение COUNCIL_MEMBER / FIRST_ARCHITECT.
//       match     → назначение как раньше.
//   - Повторный matchTask перед UPDATE — защита от гонки.
//   - Audit-запись tasks.assign.override с причиной и ролевым подтверждением.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - assignTask — при наличии TaskProfile требует checkCompetencies (см.
//     matching.js); без профиля проверка пропускается (legacy-путь).
//   - listTasks/getById — нет access control (per-direction модель прав).
//   - TASK_SELECT — 2 correlated subquery на return_reason/returned_at (N+1-ish).

import { query, queryOne, isUniqueViolation, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { send as sendNotification, sendToRole } from '../../lib/notifications.js';
import { hasRole, getEffectiveRoles } from '../../security/rbac.js';
import {
  emitTaskAssigned,
  emitTaskStatusChanged,
  emitTaskSubmitted,
  emitTaskAccepted,
  emitTaskReturned,
} from '../../ws/tasks.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { matchTask } from '../passport/matching.js';
import { getTaskProfile } from '../passport/task-profile.js';
import { isTeacherOfLearnerTask } from '../passport/teaching-practice.js';
import { listByTask } from '../reports/service.js';
import { checkRight } from '../rights.js';
import { Role } from '../roles.js';
import type { UUID, Priority, TaskStatus } from '../types.js';

import { getBlockingDependencies } from './dependencies.js';


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
  // Новое (D.2.01.67):
  kind: 'package' | 'deliverable';
  expected_result: string | null;
  planned_start_at: Date | null;
  estimated_minutes: number | null;
  blocked_by_dependencies?: boolean;
  created_at: Date;
  updated_at: Date;
  plan_title?: string | null;
  plan_expected_result?: string | null;
  assigner_name?: string | null;
  assigner_external_id?: string | null;
  in_daily_plan?: boolean | null;
  return_reason?: string | null;
  returned_at?: Date | null;
  has_task_profile?: boolean;
}

interface TaskWithRelations extends Task {
  planTitle: string | null;
  planExpectedResult: string | null;
  assignerName: string | null;
  assignerExternalId: string | null;
  inDailyPlan: boolean;
  blockedByDependencies: boolean;
  returnReason: string | null;
  returnedAt: string | null;
  hasTaskProfile: boolean;
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
    kind: row.kind,
    expectedResult: row.expected_result,
    plannedStartAt: row.planned_start_at ? row.planned_start_at.toISOString() : null,
    estimatedMinutes: row.estimated_minutes,
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
    blockedByDependencies: row.blocked_by_dependencies ?? false,
    returnReason: row.return_reason ?? null,
    returnedAt: row.returned_at ? row.returned_at.toISOString() : null,
    hasTaskProfile: row.has_task_profile ?? false,
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
         t.kind, t.expected_result, t.planned_start_at, t.estimated_minutes,
         p.title AS plan_title,
         p.expected_result AS plan_expected_result,
         ap.name AS assigner_name,
         ap.external_id AS assigner_external_id,
         CASE WHEN dpt.id IS NOT NULL THEN true ELSE false END AS in_daily_plan,
         EXISTS(SELECT 1 FROM task_profiles tp WHERE tp.task_id = t.id) AS has_task_profile,
         EXISTS(
           SELECT 1 FROM task_dependencies td
             JOIN tasks dep ON dep.id = td.depends_on_task_id
            WHERE td.task_id = t.id
              AND td.dependency_type = 'blocks'
              AND dep.status <> 'accepted'
         ) AS blocked_by_dependencies,
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
  parentTaskId?: UUID;
  kind?: 'package' | 'deliverable';
  expectedResult?: string | null;
  deadline?: string | null;
  plannedStartAt?: string | null;
  estimatedMinutes?: number | null;
  requiredCompetencies?: string[];
  location?: { lat: number; lon: number };
}

export async function createTaskService(
  input: CreateTaskRequest,
  requesterId: UUID,
): Promise<Task> {
  await assertDirectionScope(requesterId, input.directionId);

  const kind: 'package' | 'deliverable' = input.kind ?? 'deliverable';

  // Обязательность expected_result — только для новых deliverable.
  // Для package он опционален (пакеты — организационные контейнеры).
  if (kind === 'deliverable') {
    const er = (input.expectedResult ?? '').trim();
    if (er.length === 0) {
      throw new ValidationError(
        'Для исполняемой задачи (deliverable) обязателен expected_result',
      );
    }
  }

  if (input.estimatedMinutes !== undefined && input.estimatedMinutes !== null && input.estimatedMinutes <= 0) {
    throw new ValidationError('estimatedMinutes должен быть > 0');
  }

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

  // Проверка родителя (D.2.01.67)
  if (input.parentTaskId) {
    const parent = await queryOne<{
      id: string; plan_id: string | null; direction_id: string; kind: string;
    }>(
      `SELECT id, plan_id, direction_id, kind FROM tasks WHERE id = $1`,
      [input.parentTaskId],
    );
    if (!parent) {throw new NotFoundError('Родительская задача', input.parentTaskId);}
    if (parent.kind !== 'package') {
      throw new ConflictError('Родительская задача должна быть package', { parent_kind: parent.kind });
    }
    if ((parent.plan_id ?? null) !== (input.planId ?? null)) {
      throw new ConflictError('Родительская задача в другом плане', {
        parent_plan_id: parent.plan_id, task_plan_id: input.planId ?? null,
      });
    }
    if (parent.direction_id !== input.directionId) {
      throw new ConflictError('Родительская задача в другом направлении', {
        parent_direction_id: parent.direction_id, task_direction_id: input.directionId,
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
      kind,
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.expectedResult !== undefined ? { expectedResult: input.expectedResult } : {}),
      ...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
      ...(input.plannedStartAt !== undefined ? { plannedStartAt: input.plannedStartAt } : {}),
      ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
      ...(input.requiredCompetencies ? { requiredCompetencies: input.requiredCompetencies } : {}),
      ...(input.location ? { location: input.location } : {}),
      baseTime: now,
    });

    const locationSql = entity.location
      ? `ST_SetSRID(ST_MakePoint($16, $17), 4326)::geography`
      : 'NULL';

    const params: unknown[] = [
      entity.id, entity.externalId, entity.planId, entity.directionId,
      entity.description, JSON.stringify(entity.requiredCompetencies),
      entity.priority, entity.status, entity.deadline, requesterId,
      entity.kind, entity.expectedResult, entity.plannedStartAt, entity.estimatedMinutes,
      entity.parentTaskId,
    ];
    if (entity.location) {
      params.push(entity.location.lon, entity.location.lat);
    }

    try {
      await query(
        `INSERT INTO tasks
           (id, external_id, plan_id, direction_id, description, required_competencies,
            priority, status, deadline, assigned_by, kind, expected_result,
            planned_start_at, estimated_minutes, parent_task_id, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, ${locationSql})`,
        params,
      );

      await logAction({
        actorId: requesterId,
        actorType: 'participant',
        action: 'tasks.create',
        entityType: 'task',
        entityId: entity.id,
        newValue: {
          external_id: entity.externalId,
          priority: entity.priority,
          kind: entity.kind,
          parent_task_id: entity.parentTaskId,
        },
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

// ─── Matching: partial / no_match и override ────────────────────────

export interface AssignOptions {
  override?: {
    reason: string;
    risk?: 'low' | 'medium' | 'high';
    accompanying?: string;
    training?: string;
  };
}

function assertOverrideReason(reason: string): void {
  if (!reason || reason.trim().length < 10) {
    throw new ValidationError('override.reason: минимум 10 символов');
  }
}

async function assertPartialOverrideAuthorized(
  taskId: UUID,
  taskDirectionId: UUID,
  requesterId: UUID,
  matching: { gaps: Array<{ critical: boolean }>; status: string },
): Promise<{ confirmedByRole: string; accompanying?: string; training?: string }> {
  const roles = await getEffectiveRoles(requesterId);
  const hasCouncil = roles.includes(Role.COUNCIL_MEMBER);
  const hasFA = roles.includes(Role.FIRST_ARCHITECT);

  if (!hasCouncil && !hasFA) {
    throw new ForbiddenError(
      'partial требует подтверждения COUNCIL_MEMBER (в своём направлении) или FIRST_ARCHITECT',
    );
  }

  // Повторная проверка через checkRight — task:A.
  const check = await checkRight({
    participantId: requesterId,
    resource: 'task',
    action: 'A',
    targetId: taskId,
  });
  if (!check.allowed) {
    throw new ForbiddenError('Нет права task:A для подтверждения partial', {
      matching,
    });
  }

  // COUNCIL_MEMBER — только своё направление.
  if (check.matchedRole === Role.COUNCIL_MEMBER) {
    await assertDirectionScope(requesterId, taskDirectionId);
  }
  // FIRST_ARCHITECT — глобально (исключение уже в assertDirectionScope).
  // OTC / VERIFIER имеют task:A, но override для них запрещён смыслом роли.
  if (check.matchedRole === Role.OTC || check.matchedRole === Role.VERIFIER) {
    throw new ForbiddenError(
      'OTC / VERIFIER не подтверждают partial override — это не их функция',
    );
  }

  return { confirmedByRole: check.matchedRole ?? 'unknown' };
}

// TODO(techdebt): assignTask — checkCompetencies при отсутствии TaskProfile
// по-прежнему не реализован (нет participant.competencies). Если профиль
// задачи есть, проверка выполняется через matchTask; иначе назначение
// проходит legacy-путём.

export async function assignTaskService(
  taskId: UUID,
  participantId: UUID,
  requesterId: UUID,
  options: AssignOptions = {},
): Promise<Task> {
  const task = await getById(taskId);
  if (task.kind === 'package') {
    throw new ConflictError(
      'Пакет работ не назначается исполнителю — назначайте дочерние deliverable',
    );
  }
  await assertDirectionScope(requesterId, task.directionId);
  await assertDirectionScope(participantId, task.directionId);
  assignTask(task, participantId);

  // ─── Matching ────────────────────────────────────────────────────
  const profile = await getTaskProfile(taskId);
  if (profile) {
    const matching = await matchTask(taskId, participantId, requesterId);
    if (matching.status === 'no_match') {
      throw new ConflictError(
        'Matching: no_match — назначение запрещено, override невозможен',
        { matching },
      );
    }
    if (matching.status === 'partial') {
      if (!options.override) {
        throw new ConflictError(
          'Matching: partial — требуется override (reason, оценка риска)',
          { matching },
        );
      }
      assertOverrideReason(options.override.reason);
      const auth = await assertPartialOverrideAuthorized(
        taskId, task.directionId, requesterId, matching,
      );
      // Повторная проверка Matching (могло измениться между read и write).
      const rematch = await matchTask(taskId, participantId, requesterId);
      if (rematch.status === 'no_match') {
        throw new ConflictError(
          'Matching повторно: no_match — назначение запрещено',
          { matching: rematch },
        );
      }
      // Audit override.
      await logAction({
        actorId: requesterId,
        actorType: 'participant',
        action: 'tasks.assign.override',
        entityType: 'task',
        entityId: taskId,
        newValue: {
          participant_id: participantId,
          confirmed_by_role: auth.confirmedByRole,
          reason: options.override.reason,
          risk: options.override.risk ?? null,
          accompanying: options.override.accompanying ?? null,
          training: options.override.training ?? null,
          matching,
        },
      });
    }
  } else {
    // §7.5: задачи без TaskProfile продолжают работать, но отсутствие
    // структурированной проверки фиксируется в audit — не выдаём
    // отсутствие проверки за её успех.
    await logAction({
      actorId: requesterId,
      actorType: 'participant',
      action: 'tasks.assign.no_profile',
      entityType: 'task',
      entityId: taskId,
      newValue: {
        participant_id: participantId,
        reason: 'TaskProfile отсутствует — структурированный Matching не проводился',
      },
    });
  }

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
  if (task.kind === 'package') {
    throw new ConflictError('Пакет работ не берётся в работу');
  }
  const blocking = await getBlockingDependencies(taskId);
  if (blocking.length > 0) {
    throw new ConflictError(
      'Задача заблокирована незакрытыми зависимостями',
      { blockedBy: blocking },
    );
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
  // §7.5: учитель, сопровождавший учебную практику, не принимает результат
  // ученика, которому помогал.
  if (await isTeacherOfLearnerTask(requesterId, taskId)) {
    throw new ForbiddenError(
      'Учитель не принимает результат ученика, которому помогал (§7.5)',
      { task_id: taskId },
    );
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