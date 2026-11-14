// C.0.31.03 — Персональный план дня.
//
// ТЗ §9: план на локальную дату, timezone, доступное время, блоки разных
// типов. Плановое время (planned_minutes) отделено от фактического
// (actual_minutes): фактическое фиксируется только при close() — это
// подтверждённое событие (ТЗ §9.4).
//
// Версии: append-only. Каждое изменение содержимого (PUT) создаёт новую
// версию. Соглашение: v1 — пустой план при создании, v2+ — состояние после
// каждого PUT. Аналогично cell_daily_plan_versions (D.2.01.68).
//
// Переходы статусов:
//   draft → confirmed (confirm)
//   confirmed → closed (close)
//   draft → closed — запрещено
//   closed — финал (PUT, confirm запрещены)
//   PUT на confirmed возвращает план в draft (требует повторного confirm).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import {
  ConflictError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ActivityKind = 'production' | 'learning' | 'teaching' | 'other';
export type DayPlanStatus = 'draft' | 'confirmed' | 'closed';
export type BlockStatus = 'planned' | 'in_progress' | 'done' | 'skipped';

export interface ParticipantDayBlock {
  id: UUID;
  kind: ActivityKind;
  taskId: UUID | null;
  taskPracticeId: UUID | null;
  learningGoalId: UUID | null;
  teachingAssignmentId: UUID | null;
  plannedMinutes: number;
  actualMinutes: number | null;
  position: number;
  status: BlockStatus;
  comment: string | null;
}

export interface ParticipantDayPlan {
  id: UUID;
  participantId: UUID;
  date: string;
  timezone: string;
  availableMinutes: number;
  status: DayPlanStatus;
  version: number;
  blocks: ParticipantDayBlock[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DayBlockInput {
  kind: ActivityKind;
  taskId?: UUID | null;
  taskPracticeId?: UUID | null;
  learningGoalId?: UUID | null;
  teachingAssignmentId?: UUID | null;
  plannedMinutes: number;
  status?: BlockStatus;
  comment?: string | null;
}

export interface DayBlockVersionRow {
  id: string;
  kind: ActivityKind;
  task_id: string | null;
  task_practice_id: string | null;
  learning_goal_id: string | null;
  teaching_assignment_id: string | null;
  planned_minutes: number;
  actual_minutes: number | null;
  position: number;
  status: BlockStatus;
  comment: string | null;
}

interface PlanRow {
  id: string;
  participant_id: string;
  date: string;
  timezone: string;
  available_minutes: number;
  status: DayPlanStatus;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function rowToBlock(r: DayBlockVersionRow): ParticipantDayBlock {
  return {
    id: r.id,
    kind: r.kind,
    taskId: r.task_id,
    taskPracticeId: r.task_practice_id,
    learningGoalId: r.learning_goal_id,
    teachingAssignmentId: r.teaching_assignment_id,
    plannedMinutes: r.planned_minutes,
    actualMinutes: r.actual_minutes,
    position: r.position,
    status: r.status,
    comment: r.comment,
  };
}

async function loadBlocks(planId: UUID): Promise<ParticipantDayBlock[]> {
  const rows = await query<DayBlockVersionRow>(
    `SELECT id, kind, task_id, task_practice_id, learning_goal_id,
            teaching_assignment_id, planned_minutes, actual_minutes,
            position, status, comment
       FROM participant_day_blocks
      WHERE day_plan_id = $1
      ORDER BY position, created_at`,
    [planId],
  );
  return rows.map(rowToBlock);
}

async function rowToPlan(row: PlanRow): Promise<ParticipantDayPlan> {
  const blocks = await loadBlocks(row.id as UUID);
  return {
    id: row.id,
    participantId: row.participant_id,
    date: typeof row.date === 'string' ? row.date : (row.date as Date).toISOString().slice(0, 10),
    timezone: row.timezone,
    availableMinutes: row.available_minutes,
    status: row.status,
    version: row.version,
    blocks,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ─── Версии ──────────────────────────────────────────────────────────

interface VersionSnapshot {
  availableMinutes: number;
  blocks: Array<{
    id: string;
    kind: ActivityKind;
    taskId: string | null;
    taskPracticeId: string | null;
    learningGoalId: string | null;
    teachingAssignmentId: string | null;
    plannedMinutes: number;
    actualMinutes: number | null;
    position: number;
    status: BlockStatus;
    comment: string | null;
  }>;
  status: DayPlanStatus;
}

type TxClient = {
  query: <R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number | null }>;
};

async function hasAnyVersion(client: TxClient, planId: string): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM participant_day_plan_versions WHERE day_plan_id = $1) AS exists`,
    [planId],
  );
  return r.rows[0]?.exists === true;
}

async function writeVersion(
  client: TxClient,
  planId: UUID,
  reason: string,
  actorId: UUID,
): Promise<number> {
  const blocks = await client.query<DayBlockVersionRow>(
    `SELECT id, kind, task_id, task_practice_id, learning_goal_id,
            teaching_assignment_id, planned_minutes, actual_minutes,
            position, status, comment
       FROM participant_day_blocks
      WHERE day_plan_id = $1
      ORDER BY position, created_at`,
    [planId],
  );
  const plan = await client.query<{
    status: DayPlanStatus; available_minutes: number;
  }>(
    `SELECT status, available_minutes FROM participant_day_plans WHERE id = $1`,
    [planId],
  );
  const p = plan.rows[0];
  if (!p) {throw new NotFoundError('План дня', planId);}

  const snapshot: VersionSnapshot = {
    availableMinutes: p.available_minutes,
    blocks: blocks.rows.map((r) => ({
      id: String(r.id),
      kind: r.kind,
      taskId: r.task_id ? String(r.task_id) : null,
      taskPracticeId: r.task_practice_id ? String(r.task_practice_id) : null,
      learningGoalId: r.learning_goal_id ? String(r.learning_goal_id) : null,
      teachingAssignmentId: r.teaching_assignment_id
        ? String(r.teaching_assignment_id) : null,
      plannedMinutes: Number(r.planned_minutes),
      actualMinutes: r.actual_minutes === null ? null : Number(r.actual_minutes),
      position: Number(r.position),
      status: r.status,
      comment: r.comment,
    })),
    status: p.status,
  };

  const next = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM participant_day_plan_versions WHERE day_plan_id = $1`,
    [planId],
  );
  const version = Number(next.rows[0]?.next ?? 1);

  await client.query(
    `INSERT INTO participant_day_plan_versions
       (id, day_plan_id, version, snapshot, reason, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [newUUID(), planId, version, JSON.stringify(snapshot), reason, actorId],
  );
  return version;
}

export interface DayPlanVersion {
  version: number;
  snapshot: VersionSnapshot;
  reason: string | null;
  createdAt: string;
  createdBy: UUID;
}

export async function listVersions(
  planId: UUID,
): Promise<DayPlanVersion[]> {
  const rows = await query<{
    version: number;
    snapshot: VersionSnapshot;
    reason: string | null;
    created_at: Date;
    created_by: string;
  }>(
    `SELECT version, snapshot, reason, created_at, created_by
       FROM participant_day_plan_versions
      WHERE day_plan_id = $1
      ORDER BY version DESC`,
    [planId],
  );
  return rows.map((r) => ({
    version: r.version,
    snapshot: r.snapshot,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
    createdBy: r.created_by as UUID,
  }));
}

export async function listMyDayPlans(
  participantId: UUID,
  limit = 30,
): Promise<Array<Omit<ParticipantDayPlan, 'blocks'>>> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const rows = await query<PlanRow>(
    `SELECT id, participant_id, date, timezone, available_minutes,
            status, version, created_at, updated_at
       FROM participant_day_plans
      WHERE participant_id = $1
      ORDER BY date DESC
      LIMIT $2`,
    [participantId, safeLimit],
  );
  return rows.map((r) => ({
    id: r.id,
    participantId: r.participant_id,
    date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().slice(0, 10),
    timezone: r.timezone,
    availableMinutes: r.available_minutes,
    status: r.status,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

// ─── Проверки ────────────────────────────────────────────────────────

function assertDate(dateStr: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ValidationError('date: формат YYYY-MM-DD');
  }
}

function assertTimezone(tz: string): void {
  if (!tz || tz.length === 0 || tz.length > 64) {
    throw new ValidationError('timezone: 1–64 символа');
  }
}

function assertAvailableMinutes(m: number): void {
  if (!Number.isInteger(m) || m <= 0 || m > 1440) {
    throw new ValidationError('availableMinutes: целое 1–1440');
  }
}

function validateBlocks(
  blocks: DayBlockInput[],
  availableMinutes: number,
): void {
  let total = 0;
  const seenTaskIds = new Set<string>();
  for (const b of blocks) {
    if (!Number.isInteger(b.plannedMinutes) || b.plannedMinutes <= 0) {
      throw new ValidationError(`block.plannedMinutes должен быть > 0`);
    }
    if (b.kind === 'production') {
      if (!b.taskId) {
        throw new ValidationError(
          'block(kind=production): taskId обязателен',
        );
      }
      if (seenTaskIds.has(b.taskId)) {
        throw new ConflictError(
          `Задача ${b.taskId} указана в нескольких блоках одного дня`,
        );
      }
      seenTaskIds.add(b.taskId);
    }
    total += b.plannedMinutes;
  }
  if (total > availableMinutes) {
    throw new ConflictError(
      `Сумма запланированных минут (${total}) превышает доступное время (${availableMinutes})`,
      { total, availableMinutes },
    );
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────

export async function getDayPlan(
  participantId: UUID,
  date: string,
): Promise<ParticipantDayPlan | null> {
  assertDate(date);
  const row = await queryOne<PlanRow>(
    `SELECT id, participant_id, date, timezone, available_minutes,
            status, version, created_at, updated_at
       FROM participant_day_plans
      WHERE participant_id = $1 AND date = $2::date`,
    [participantId, date],
  );
  if (!row) {return null;}
  return rowToPlan(row);
}

export async function getOrCreateDayPlan(
  participantId: UUID,
  date: string,
  timezone: string,
  availableMinutes: number,
  actorId: UUID,
): Promise<ParticipantDayPlan> {
  assertDate(date);
  assertTimezone(timezone);
  assertAvailableMinutes(availableMinutes);

  const existing = await getDayPlan(participantId, date);
  if (existing) {return existing;}

  const planId = newUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO participant_day_plans
         (id, participant_id, date, timezone, available_minutes, status, version)
       VALUES ($1, $2, $3::date, $4, $5, 'draft', 1)
       ON CONFLICT (participant_id, date) DO NOTHING`,
      [planId, participantId, date, timezone, availableMinutes],
    );
    // Если параллельный запрос создал — перечитываем; иначе пишем v1.
    const row = await client.query<{ id: string }>(
      `SELECT id FROM participant_day_plans WHERE participant_id = $1 AND date = $2::date`,
      [participantId, date],
    );
    const actualId = row.rows[0]?.id;
    if (actualId && actualId === planId) {
      await writeVersion(
        client as unknown as TxClient, planId as UUID,
        'Создание плана (пустой)', actorId,
      );
    }
  });

  await logAction({
    actorId,
    actorType: 'participant',
    action: 'day_plan.create',
    entityType: 'day_plan',
    entityId: planId,
    newValue: { date, timezone, availableMinutes },
  });

  const plan = await getDayPlan(participantId, date);
  if (!plan) {throw new ConflictError('План не создался');}
  return plan;
}

export async function upsertDayPlan(input: {
  participantId: UUID;
  date: string;
  timezone: string;
  availableMinutes: number;
  blocks: DayBlockInput[];
  reason?: string;
  actorId: UUID;
}): Promise<ParticipantDayPlan> {
  assertDate(input.date);
  assertTimezone(input.timezone);
  assertAvailableMinutes(input.availableMinutes);
  validateBlocks(input.blocks, input.availableMinutes);

  let planId: UUID | null = null;
  let previousStatus: DayPlanStatus | null = null;
  let versionWritten = 0;

  await transaction(async (client) => {
    const existing = await client.query<{
      id: string; status: DayPlanStatus; version: number;
    }>(
      `SELECT id, status, version FROM participant_day_plans
        WHERE participant_id = $1 AND date = $2::date
        FOR UPDATE`,
      [input.participantId, input.date],
    );

    if (existing.rows[0]) {
      planId = existing.rows[0].id as UUID;
      previousStatus = existing.rows[0].status;
      if (previousStatus === 'closed') {
        throw new ConflictError('План закрыт — изменения запрещены');
      }
      // Снимок «до» — только если истории ещё нет (старый план).
      if (!(await hasAnyVersion(client as unknown as TxClient, planId))) {
        await writeVersion(
          client as unknown as TxClient, planId,
          'Исходное состояние (до миграции)', input.actorId,
        );
      }
      // Удаляем блоки и вставляем новые.
      await client.query(
        `DELETE FROM participant_day_blocks WHERE day_plan_id = $1`,
        [planId],
      );
      // Изменение confirmed возвращает план в draft — требует reconfirm.
      const newStatus: DayPlanStatus = previousStatus === 'confirmed' ? 'draft' : previousStatus;
      await client.query(
        `UPDATE participant_day_plans
            SET timezone = $2, available_minutes = $3, status = $4,
                updated_at = now()
          WHERE id = $1`,
        [planId, input.timezone, input.availableMinutes, newStatus],
      );
    } else {
      planId = newUUID();
      await client.query(
        `INSERT INTO participant_day_plans
           (id, participant_id, date, timezone, available_minutes, status, version)
         VALUES ($1, $2, $3::date, $4, $5, 'draft', 1)`,
        [planId, input.participantId, input.date, input.timezone, input.availableMinutes],
      );
      // v1 — пустой план.
      await writeVersion(
        client as unknown as TxClient, planId,
        'Создание плана (пустой)', input.actorId,
      );
    }

    for (let i = 0; i < input.blocks.length; i += 1) {
      const b = input.blocks[i]!;
      await client.query(
        `INSERT INTO participant_day_blocks
           (id, day_plan_id, kind, task_id, task_practice_id,
            learning_goal_id, teaching_assignment_id, planned_minutes,
            position, status, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newUUID(), planId, b.kind,
          b.taskId ?? null, b.taskPracticeId ?? null,
          b.learningGoalId ?? null, b.teachingAssignmentId ?? null,
          b.plannedMinutes, i, b.status ?? 'planned',
          b.comment ?? null,
        ],
      );
    }

    versionWritten = await writeVersion(
      client as unknown as TxClient, planId,
      input.reason ?? 'Обновление плана', input.actorId,
    );
  });

  await logAction({
    actorId: input.actorId,
    actorType: 'participant',
    action: 'day_plan.upsert',
    entityType: 'day_plan',
    entityId: planId!,
    newValue: {
      date: input.date,
      blocks: input.blocks.length,
      version: versionWritten,
      status: previousStatus,
    },
  });

  const plan = await getDayPlan(input.participantId, input.date);
  if (!plan) {throw new ConflictError('План не найден после upsert');}
  return plan;
}

export async function confirmDayPlan(input: {
  participantId: UUID;
  date: string;
  actorId: UUID;
}): Promise<ParticipantDayPlan> {
  assertDate(input.date);
  let planId: UUID | null = null;

  await transaction(async (client) => {
    const cur = await client.query<{ id: string; status: DayPlanStatus }>(
      `SELECT id, status FROM participant_day_plans
        WHERE participant_id = $1 AND date = $2::date
        FOR UPDATE`,
      [input.participantId, input.date],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('План дня на дату', input.date);}
    planId = row.id as UUID;

    if (row.status === 'confirmed') {
      // Идемпотентно.
      return;
    }
    if (row.status !== 'draft') {
      throw new ConflictError(`Нельзя подтвердить план в статусе ${row.status}`);
    }

    if (!(await hasAnyVersion(client as unknown as TxClient, planId))) {
      await writeVersion(
        client as unknown as TxClient, planId,
        'Исходное состояние (до миграции)', input.actorId,
      );
    }

    await client.query(
      `UPDATE participant_day_plans
          SET status = 'confirmed', updated_at = now()
        WHERE id = $1`,
      [planId],
    );

    await writeVersion(
      client as unknown as TxClient, planId,
      'Подтверждение плана', input.actorId,
    );
  });

  await logAction({
    actorId: input.actorId,
    actorType: 'participant',
    action: 'day_plan.confirm',
    entityType: 'day_plan',
    entityId: planId!,
  });

  const plan = await getDayPlan(input.participantId, input.date);
  if (!plan) {throw new ConflictError('План не найден после confirm');}
  return plan;
}

export interface CloseBlockActual {
  blockId: UUID;
  actualMinutes: number;
}

export async function closeDayPlan(input: {
  participantId: UUID;
  date: string;
  actuals: CloseBlockActual[];
  actorId: UUID;
}): Promise<ParticipantDayPlan> {
  assertDate(input.date);
  let planId: UUID | null = null;

  await transaction(async (client) => {
    const cur = await client.query<{ id: string; status: DayPlanStatus }>(
      `SELECT id, status FROM participant_day_plans
        WHERE participant_id = $1 AND date = $2::date
        FOR UPDATE`,
      [input.participantId, input.date],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('План дня на дату', input.date);}
    planId = row.id as UUID;

    if (row.status === 'closed') {
      throw new ConflictError('План уже закрыт');
    }
    if (row.status !== 'confirmed') {
      throw new ConflictError(
        'Закрыть можно только подтверждённый план',
        { current_status: row.status },
      );
    }

    // Проверка: все blockId из actuals принадлежат плану.
    const blockIds = await client.query<{ id: string }>(
      `SELECT id FROM participant_day_blocks WHERE day_plan_id = $1`,
      [planId],
    );
    const allowed = new Set(blockIds.rows.map((r) => r.id));
    for (const a of input.actuals) {
      if (!allowed.has(a.blockId)) {
        throw new ValidationError(
          `Блок ${a.blockId} не принадлежит этому плану`,
        );
      }
      if (!Number.isInteger(a.actualMinutes) || a.actualMinutes < 0) {
        throw new ValidationError(
          `actualMinutes для блока ${a.blockId}: целое >= 0`,
        );
      }
    }

    if (!(await hasAnyVersion(client as unknown as TxClient, planId))) {
      await writeVersion(
        client as unknown as TxClient, planId,
        'Исходное состояние (до миграции)', input.actorId,
      );
    }

    for (const a of input.actuals) {
      await client.query(
        `UPDATE participant_day_blocks
            SET actual_minutes = $2, status = 'done'
          WHERE id = $1`,
        [a.blockId, a.actualMinutes],
      );
    }

    await client.query(
      `UPDATE participant_day_plans
          SET status = 'closed', updated_at = now()
        WHERE id = $1`,
      [planId],
    );

    await writeVersion(
      client as unknown as TxClient, planId,
      'Закрытие плана (фактические минуты)', input.actorId,
    );
  });

  await logAction({
    actorId: input.actorId,
    actorType: 'participant',
    action: 'day_plan.close',
    entityType: 'day_plan',
    entityId: planId!,
    newValue: { date: input.date, actuals: input.actuals.length },
  });

  const plan = await getDayPlan(input.participantId, input.date);
  if (!plan) {throw new ConflictError('План не найден после close');}
  return plan;
}