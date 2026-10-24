// C.0.06.02 — Сервис планов
// Создание, утверждение, активация, остановка. Разбивка на дневные задачи.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: upsertDailyPlan в транзакции (было: UPDATE → DELETE → INSERT без tx).
//   - B2: upsertDailyPlan проверяет task.directionId === plan.directionId.
//   - B3: removeTaskFromDailyPlan проверяет существование plan/task.
//   - B4: approve/activate проверяют статус (было: только entity).
//   - B5: approve/activate/stop — атомарный UPDATE ... WHERE status=... RETURNING.
//   - B6: createPlanService — `now` внутри retry-цикла.
//   - T5: listDailyPlans — 2 запроса вместо N+1 (ANY(uuid[]) + Map).
//   - Crisis-валидация: type='crisis' требует criteria.scenario (спека обещала — было не реализовано).

import { query, queryOne, isUniqueViolation, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors.js';
import type { UUID, PlanType, PlanStatus, Priority, TaskStatus, ISODateTime } from '../types.js';

import { createPlan, approvePlan, activatePlan, formatPlanExternalId, type Plan, type PlanCheckpoint } from './entity.js';

interface PlanRow {
  id: string;
  external_id: string;
  type: PlanType;
  title: string;
  expected_result: string;
  lead_direction_id: string;
  status: PlanStatus;
  criteria: Record<string, unknown>;
  checkpoints: PlanCheckpoint[] | null;
  stop_conditions: Record<string, unknown>;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    externalId: row.external_id,
    type: row.type,
    title: row.title,
    expectedResult: row.expected_result,
    leadDirectionId: row.lead_direction_id,
    status: row.status,
    criteria: row.criteria,
    checkpoints: row.checkpoints ?? [],
    stopConditions: row.stop_conditions,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const PLAN_COLUMNS = `id, external_id, type, title, expected_result, lead_direction_id,
                      status, criteria, checkpoints, stop_conditions, approved_by, approved_at,
                      created_at, updated_at`;

export interface PlanFilter {
  type?: PlanType;
  status?: PlanStatus;
  leadDirectionId?: UUID;
  page?: number;
  perPage?: number;
}

export async function listPlans(filter: PlanFilter = {}): Promise<{ data: Plan[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.type) {
    params.push(filter.type);
    conditions.push(`type = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.leadDirectionId) {
    params.push(filter.leadDirectionId);
    conditions.push(`lead_direction_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM plans ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<PlanRow>(
    `SELECT ${PLAN_COLUMNS}
       FROM plans
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToPlan), total };
}

export async function getById(planId: UUID): Promise<Plan> {
  const row = await queryOne<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`,
    [planId],
  );
  if (!row) {throw new NotFoundError('План', planId);}
  return rowToPlan(row);
}

export interface CreatePlanRequest {
  type: PlanType;
  title: string;
  expectedResult: string;
  leadDirectionId: UUID;
  criteria?: Record<string, unknown>;
  checkpoints?: PlanCheckpoint[];
  stopConditions?: Record<string, unknown>;
}

export async function createPlanService(
  input: CreatePlanRequest,
  requesterId: UUID,
): Promise<Plan> {
  // Crisis-валидация (B-фикс; спека обещала, что в сервисе — не было).
  if (input.type === 'crisis') {
    const scenario = input.criteria?.['scenario'];
    if (typeof scenario !== 'string' || scenario.trim().length === 0) {
      throw new ValidationError(
        'Для плана типа crisis требуется criteria.scenario (непустая строка)',
      );
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();  // ← B6: внутри цикла (retry через полночь — свежая дата)
    const dateStr = now.toISOString().slice(0, 10);
    const row = await queryOne<{ max_seq: string | null }>(
      `SELECT COALESCE(MAX(SUBSTRING(external_id FROM '([0-9]{3})$')::INT), 0)::text AS max_seq
         FROM plans
        WHERE external_id LIKE $1`,
      [`PLAN-${dateStr}-%`],
    );
    const nextSeq = parseInt(row?.max_seq ?? '0', 10) + 1;
    if (nextSeq > 999) {
      throw new ConflictError('Достигнут дневной лимит планов (999)');
    }

    const externalId = formatPlanExternalId(now, nextSeq);

    const entity = createPlan({
      id: newUUID(),
      externalId,
      type: input.type,
      title: input.title,
      expectedResult: input.expectedResult,
      leadDirectionId: input.leadDirectionId,
      ...(input.criteria ? { criteria: input.criteria } : {}),
      ...(input.checkpoints ? { checkpoints: input.checkpoints } : {}),
      ...(input.stopConditions ? { stopConditions: input.stopConditions } : {}),
    });

    try {
      await query(
        `INSERT INTO plans
           (id, external_id, type, title, expected_result, lead_direction_id,
            status, criteria, checkpoints, stop_conditions)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9)`,
        [
          entity.id,
          entity.externalId,
          entity.type,
          entity.title,
          entity.expectedResult,
          entity.leadDirectionId,
          JSON.stringify(entity.criteria),
          JSON.stringify(entity.checkpoints),
          JSON.stringify(entity.stopConditions),
        ],
      );

      await logAction({
        actorId: requesterId,
        actorType: 'participant',
        action: 'plans.create',
        entityType: 'plan',
        entityId: entity.id,
        newValue: { external_id: entity.externalId, type: entity.type },
      });

      return entity;
    } catch (e) {
      if (isUniqueViolation(e)) {continue;}
      throw e;
    }
  }

  throw new ConflictError('Не удалось сгенерировать уникальный external_id для плана');
}

// -------- Lifecycle: атомарные переходы (B4, B5) --------

export async function approvePlanService(planId: UUID, requesterId: UUID): Promise<Plan> {
  // Entity-вызов оставлен для side-effect'ов (если entity что-то делает с checkpoint'ами).
  const plan = await getById(planId);
  if (plan.status !== 'draft') {
    throw new ConflictError(
      `Утвердить можно только план в статусе 'draft' (текущий: ${plan.status})`,
    );
  }
  const updated = approvePlan(plan, requesterId);

  const result = await query<{ id: string }>(
    `UPDATE plans
        SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now()
      WHERE id = $2 AND status = 'draft'
      RETURNING id`,
    [requesterId, planId],
  );
  if (result.length === 0) {
    throw new ConflictError('План уже изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'plans.approve',
    entityType: 'plan',
    entityId: planId,
  });

  return updated;
}

export async function activatePlanService(planId: UUID, requesterId: UUID): Promise<Plan> {
  const plan = await getById(planId);
  if (plan.status !== 'approved') {
    throw new ConflictError(
      `Активировать можно только план в статусе 'approved' (текущий: ${plan.status})`,
    );
  }
  const updated = activatePlan(plan);

  const result = await query<{ id: string }>(
    `UPDATE plans
        SET status = 'in_progress', updated_at = now()
      WHERE id = $1 AND status = 'approved'
      RETURNING id`,
    [planId],
  );
  if (result.length === 0) {
    throw new ConflictError('План уже изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'plans.activate',
    entityType: 'plan',
    entityId: planId,
  });

  return updated;
}

export async function stopPlanService(planId: UUID, reason: string, requesterId: UUID): Promise<Plan> {
  const plan = await getById(planId);
  if (plan.status !== 'in_progress') {
    throw new ConflictError(`Остановить можно только активный план (текущий: ${plan.status})`);
  }

  const result = await query<{ id: string }>(
    `UPDATE plans
        SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND status = 'in_progress'
      RETURNING id`,
    [planId],
  );
  if (result.length === 0) {
    throw new ConflictError('План уже изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'plans.stop',
    entityType: 'plan',
    entityId: planId,
    oldValue: { status: 'in_progress' },
    newValue: { status: 'cancelled', reason },
  });

  return { ...plan, status: 'cancelled', updatedAt: new Date().toISOString() };
}

// ============================================================================
// D.1.06.02 — Дневные планы
// ============================================================================

export interface DailyPlanTask {
  id: UUID;
  dailyPlanId: UUID;
  taskId: UUID;
  position: number;
  createdAt: ISODateTime;
}

export interface DailyPlan {
  id: UUID;
  directionId: UUID;
  date: string;
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  approvedBy: UUID | null;
  createdAt: ISODateTime;
  tasks: Array<{
    id: UUID;
    externalId: string;
    description: string;
    priority: Priority;
    status: TaskStatus;
    assignedTo: UUID | null;
    deadline: string | null;
    position: number;
  }>;
}

interface DailyPlanRow {
  id: string;
  direction_id: string;
  date: Date;
  status: 'draft' | 'approved' | 'in_progress' | 'completed';
  approved_by: string | null;
  created_at: Date;
}

function rowToDailyPlan(r: DailyPlanRow): Omit<DailyPlan, 'tasks'> {
  return {
    id: r.id,
    directionId: r.direction_id,
    date: r.date.toISOString().slice(0, 10),
    status: r.status,
    approvedBy: r.approved_by,
    createdAt: r.created_at.toISOString(),
  };
}

interface DailyTaskRow {
  daily_plan_id: string;
  id: string;
  external_id: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  assigned_to: string | null;
  deadline: Date | null;
  position: number;
}

function rowToDailyTask(t: DailyTaskRow): DailyPlan['tasks'][number] {
  return {
    id: t.id,
    externalId: t.external_id,
    description: t.description,
    priority: t.priority,
    status: t.status,
    assignedTo: t.assigned_to,
    deadline: t.deadline ? t.deadline.toISOString() : null,
    position: t.position,
  };
}

const DAILY_TASK_SELECT = `
  SELECT dpt.daily_plan_id, t.id, t.external_id, t.description, t.priority, t.status,
         t.assigned_to, t.deadline, dpt.position
    FROM daily_plan_tasks dpt
    JOIN tasks t ON t.id = dpt.task_id`;

export async function getDailyPlan(
  directionId: UUID,
  date?: string,
): Promise<DailyPlan | null> {
  const dateStr = date ?? new Date().toISOString().slice(0, 10);
  const row = await queryOne<DailyPlanRow>(
    `SELECT id, direction_id, date, status, approved_by, created_at
       FROM daily_plans
      WHERE direction_id = $1 AND date = $2`,
    [directionId, dateStr],
  );
  if (!row) {return null;}

  const taskRows = await query<DailyTaskRow>(
    `${DAILY_TASK_SELECT}
      WHERE dpt.daily_plan_id = $1
      ORDER BY dpt.position, t.priority`,
    [row.id],
  );

  return {
    ...rowToDailyPlan(row),
    tasks: taskRows.map(rowToDailyTask),
  };
}

export async function listDailyPlans(
  directionId?: UUID,
  date?: string,
): Promise<DailyPlan[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (directionId) { params.push(directionId); cond.push(`direction_id = $${params.length}`); }
  if (date) { params.push(date); cond.push(`date = $${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const rows = await query<DailyPlanRow>(
    `SELECT id, direction_id, date, status, approved_by, created_at
       FROM daily_plans ${where}
      ORDER BY date DESC LIMIT 100`,
    params,
  );
  if (rows.length === 0) {return [];}

  // T5: 1 запрос на все задачи вместо N+1.
  const planIds = rows.map((r) => r.id);
  const taskRows = await query<DailyTaskRow>(
    `${DAILY_TASK_SELECT}
      WHERE dpt.daily_plan_id = ANY($1::uuid[])
      ORDER BY dpt.daily_plan_id, dpt.position, t.priority`,
    [planIds],
  );

  const tasksByPlan = new Map<string, DailyTaskRow[]>();
  for (const t of taskRows) {
    const arr = tasksByPlan.get(t.daily_plan_id);
    if (arr) {arr.push(t);}
    else {tasksByPlan.set(t.daily_plan_id, [t]);}
  }

  return rows.map((r) => ({
    ...rowToDailyPlan(r),
    tasks: (tasksByPlan.get(r.id) ?? []).map(rowToDailyTask),
  }));
}

export async function upsertDailyPlan(input: {
  directionId: UUID;
  date: string;
  taskIds: UUID[];
  approvedById: UUID;
}): Promise<DailyPlan> {
  // Дедупликация до валидации — параллельные id не должны давать duplicate INSERT.
  const uniqueTaskIds = [...new Set(input.taskIds)];

  // Валидация задач (B2): все существуют, все в том же направлении.
  if (uniqueTaskIds.length > 0) {
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
      if (t.direction_id !== input.directionId) {
        throw new ConflictError(
          `Задача ${t.id} принадлежит другому направлению`,
          { task_direction_id: t.direction_id, plan_direction_id: input.directionId },
        );
      }
    }
  }

  // B1: транзакция — UPDATE/DELETE/INSERT атомарны.
  await transaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM daily_plans WHERE direction_id = $1 AND date = $2 FOR UPDATE`,
      [input.directionId, input.date],
    );

    let planId: UUID;
    if (existing.rows[0]) {
      planId = existing.rows[0].id;
      await client.query(
        `UPDATE daily_plans SET approved_by = $1, status = 'approved' WHERE id = $2`,
        [input.approvedById, planId],
      );
      await client.query(`DELETE FROM daily_plan_tasks WHERE daily_plan_id = $1`, [planId]);
    } else {
      planId = newUUID();
      await client.query(
        `INSERT INTO daily_plans (id, direction_id, date, status, approved_by)
         VALUES ($1, $2, $3, 'approved', $4)`,
        [planId, input.directionId, input.date, input.approvedById],
      );
    }

    let position = 0;
    for (const taskId of uniqueTaskIds) {
      await client.query(
        `INSERT INTO daily_plan_tasks (id, daily_plan_id, task_id, position)
         VALUES ($1, $2, $3, $4)`,
        [newUUID(), planId, taskId, position++],
      );
    }
  });

  const plan = await getDailyPlan(input.directionId, input.date);
  if (!plan) {throw new Error('Не удалось прочитать план после upsert');}

  await logAction({
    actorId: input.approvedById,
    actorType: 'participant',
    action: 'plans.daily_upsert',
    entityType: 'daily_plan',
    entityId: plan.id,
    newValue: {
      direction_id: input.directionId,
      date: input.date,
      tasks_count: uniqueTaskIds.length,
    },
  });

  return plan;
}

export async function removeTaskFromDailyPlan(
  planId: UUID,
  taskId: UUID,
  requesterId: UUID,
): Promise<void> {
  // B3: проверка существования — было молчаливое no-op.
  const planExists = await queryOne<{ id: string }>(
    `SELECT id FROM daily_plans WHERE id = $1`,
    [planId],
  );
  if (!planExists) {throw new NotFoundError('Дневной план', planId);}

  const removed = await query<{ id: string }>(
    `DELETE FROM daily_plan_tasks WHERE daily_plan_id = $1 AND task_id = $2 RETURNING id`,
    [planId, taskId],
  );
  if (removed.length === 0) {
    throw new NotFoundError('Задача в дневном плане', taskId);
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'plans.daily_remove_task',
    entityType: 'daily_plan',
    entityId: planId,
    newValue: { task_id: taskId },
  });
}