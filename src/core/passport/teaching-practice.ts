// C.1.09.02 — TeachingPracticeLink: обучение на производстве (ТЗ §3.5).
//
// Связывает учителя и ученика через две реальные задачи. Учитель сохраняет
// свою задачу и ответственность; ученик — свою. Учитель не подменяет
// ученика и не отвечает за его сдачу в OTC.
//
// Проверки при создании:
//   - teacher ≠ learner;
//   - оба существуют, не deleted;
//   - source_task.assigned_to = teacher, kind='deliverable';
//   - learner_task.assigned_to = learner, kind='deliverable';
//   - source и learner tasks в одном направлении;
//   - competency_atom_id существует;
//   - computeReadiness(teacher, atom) = 'ready' (предметная компетенция);
//   - learner_task.status <> 'accepted';
//   - нет активной пары (teacher, learner, atom) в статусе proposed/active/submitted.
//
// Педагогическая компетенция НЕ проверяется — модель отсутствует. Зафиксировано
// как архитектурный пробел. Не распространяем на неё предметные пороги P/X/E.
//
// Статусы:
//   proposed → active (обе стороны согласились) → submitted (ученик сдал)
//   → completed (учитель подтвердил).
//   proposed/active/submitted → cancelled (отмена).
//   completed / cancelled — финальные.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

import { computeReadiness } from './teaching.js';

export type PracticeStatus =
  | 'proposed'
  | 'active'
  | 'submitted'
  | 'completed'
  | 'cancelled';

export interface TaskPractice {
  id: UUID;
  teacherId: UUID;
  learnerId: UUID;
  sourceTaskId: UUID;
  learnerTaskId: UUID;
  competencyAtomId: string;
  expectedLearningResult: string;
  status: PracticeStatus;
  teacherConsent: boolean;
  learnerConsent: boolean;
  createdBy: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  completedAt: ISODateTime | null;
  cancelledAt: ISODateTime | null;
  cancelReason: string | null;
}

interface TaskPracticeRow {
  id: string;
  teacher_id: string;
  learner_id: string;
  source_task_id: string;
  learner_task_id: string;
  competency_atom_id: string;
  expected_learning_result: string;
  status: PracticeStatus;
  teacher_consent: boolean;
  learner_consent: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

const PRACTICE_SELECT = `
  id, teacher_id, learner_id, source_task_id, learner_task_id,
  competency_atom_id, expected_learning_result, status,
  teacher_consent, learner_consent, created_by, created_at, updated_at,
  completed_at, cancelled_at, cancel_reason
`;

function toPractice(r: TaskPracticeRow): TaskPractice {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    learnerId: r.learner_id,
    sourceTaskId: r.source_task_id,
    learnerTaskId: r.learner_task_id,
    competencyAtomId: r.competency_atom_id,
    expectedLearningResult: r.expected_learning_result,
    status: r.status,
    teacherConsent: r.teacher_consent,
    learnerConsent: r.learner_consent,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
    cancelReason: r.cancel_reason,
  };
}

// ─── Создание ────────────────────────────────────────────────────────

export interface CreatePracticeInput {
  teacherId: UUID;
  learnerId: UUID;
  sourceTaskId: UUID;
  learnerTaskId: UUID;
  competencyAtomId: string;
  expectedLearningResult: string;
}

export async function createPractice(
  input: CreatePracticeInput,
  actorId: UUID,
): Promise<TaskPractice> {
  if (input.teacherId === input.learnerId) {
    throw new ValidationError('Учитель и ученик должны быть разными участниками');
  }
  if (input.expectedLearningResult.trim().length < 5) {
    throw new ValidationError('expectedLearningResult: минимум 5 символов');
  }
  if (!/^CYB\.ATOM\.\d{4}$/.test(input.competencyAtomId)) {
    throw new ValidationError('competencyAtomId: формат CYB.ATOM.NNNN');
  }
  if (actorId !== input.teacherId && actorId !== input.learnerId) {
    throw new ForbiddenError(
      'Создать практику может только учитель или ученик',
      { teacher_id: input.teacherId, learner_id: input.learnerId },
    );
  }

  // Участники.
  const participants = await query<{ id: string }>(
    `SELECT id FROM participants WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [[input.teacherId, input.learnerId]],
  );
  if (participants.length !== 2) {
    throw new NotFoundError('Участник(и) не найдены или удалены');
  }

  // Задачи: обе существуют, deliverable, правильные assignee, одно направление.
  const tasks = await query<{
    id: string; kind: string; assigned_to: string | null;
    direction_id: string; status: string;
  }>(
    `SELECT id, kind, assigned_to, direction_id, status
       FROM tasks WHERE id = ANY($1::uuid[])`,
    [[input.sourceTaskId, input.learnerTaskId]],
  );
  if (tasks.length !== 2) {
    throw new NotFoundError('Задача(и) не найдены');
  }
  const sourceTask = tasks.find((t) => t.id === input.sourceTaskId)!;
  const learnerTask = tasks.find((t) => t.id === input.learnerTaskId)!;

  if (sourceTask.kind !== 'deliverable') {
    throw new ConflictError('source_task должен быть deliverable', {
      task_id: input.sourceTaskId, kind: sourceTask.kind,
    });
  }
  if (learnerTask.kind !== 'deliverable') {
    throw new ConflictError('learner_task должен быть deliverable', {
      task_id: input.learnerTaskId, kind: learnerTask.kind,
    });
  }
  if (sourceTask.assigned_to !== input.teacherId) {
    throw new ConflictError(
      'source_task должна быть назначена учителю',
      { source_task_id: input.sourceTaskId, assigned_to: sourceTask.assigned_to },
    );
  }
  if (learnerTask.assigned_to !== input.learnerId) {
    throw new ConflictError(
      'learner_task должна быть назначена ученику',
      { learner_task_id: input.learnerTaskId, assigned_to: learnerTask.assigned_to },
    );
  }
  if (sourceTask.direction_id !== learnerTask.direction_id) {
    throw new ConflictError('Задачи должны быть в одном направлении', {
      source_direction: sourceTask.direction_id,
      learner_direction: learnerTask.direction_id,
    });
  }
  if (learnerTask.status === 'accepted') {
    throw new ConflictError('learner_task уже принята OTC — обучение неактуально');
  }

  // Атом существует.
  const atom = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms WHERE atom_id = $1`,
    [input.competencyAtomId],
  );
  if (!atom) {
    throw new NotFoundError('Атом', input.competencyAtomId);
  }

  // Предметная компетенция учителя.
  const readiness = await computeReadiness(input.teacherId, input.competencyAtomId);
  if (!readiness) {
    throw new NotFoundError('Атом', input.competencyAtomId);
  }
  if (readiness.state !== 'ready') {
    throw new ForbiddenError(
      `Учитель не готов обучать по атому: readiness='${readiness.state}'`,
      { readiness },
    );
  }

  const id = newUUID();
  const teacherConsent = actorId === input.teacherId;
  const learnerConsent = actorId === input.learnerId;
  const initialStatus: PracticeStatus = 'proposed';

  await transaction(async (client) => {
    // Проверка дубликата активной пары.
    const dup = await client.query<{ id: string }>(
      `SELECT id FROM task_practices
        WHERE teacher_id = $1 AND learner_id = $2 AND competency_atom_id = $3
          AND status IN ('proposed', 'active', 'submitted')
        FOR UPDATE`,
      [input.teacherId, input.learnerId, input.competencyAtomId],
    );
    if (dup.rows.length > 0) {
      throw new ConflictError(
        'Активная практика для этой пары и атома уже существует',
        { existing_id: dup.rows[0]!.id },
      );
    }

    await client.query(
      `INSERT INTO task_practices
         (id, teacher_id, learner_id, source_task_id, learner_task_id,
          competency_atom_id, expected_learning_result, status,
          teacher_consent, learner_consent, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id, input.teacherId, input.learnerId,
        input.sourceTaskId, input.learnerTaskId,
        input.competencyAtomId, input.expectedLearningResult.trim(),
        initialStatus, teacherConsent, learnerConsent, actorId,
      ],
    );
  });

  await logAction({
    actorId,
    actorType: 'participant',
    action: 'task_practices.create',
    entityType: 'task_practice',
    entityId: id,
    newValue: {
      teacher_id: input.teacherId,
      learner_id: input.learnerId,
      source_task_id: input.sourceTaskId,
      learner_task_id: input.learnerTaskId,
      competency_atom_id: input.competencyAtomId,
    },
  });

  const practice = await getById(id);
  return practice;
}

// ─── Чтение ──────────────────────────────────────────────────────────

export async function getById(id: UUID): Promise<TaskPractice> {
  const r = await queryOne<TaskPracticeRow>(
    `SELECT ${PRACTICE_SELECT} FROM task_practices WHERE id = $1`,
    [id],
  );
  if (!r) {throw new NotFoundError('Практика', id);}
  return toPractice(r);
}

export async function listMyPractices(
  participantId: UUID,
): Promise<{ asTeacher: TaskPractice[]; asLearner: TaskPractice[] }> {
  const [asTeacherRows, asLearnerRows] = await Promise.all([
    query<TaskPracticeRow>(
      `SELECT ${PRACTICE_SELECT} FROM task_practices
        WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [participantId],
    ),
    query<TaskPracticeRow>(
      `SELECT ${PRACTICE_SELECT} FROM task_practices
        WHERE learner_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [participantId],
    ),
  ]);
  return {
    asTeacher: asTeacherRows.map(toPractice),
    asLearner: asLearnerRows.map(toPractice),
  };
}

/**
 * Для OTC (Этап 5): является ли participantId учителем в активной/завершённой
 * практике по задаче learner_task_id. Используется для правила §7.5
 * «учитель не принимает результат ученика, которому помогал».
 */
export async function isTeacherOfLearnerTask(
  teacherId: UUID,
  learnerTaskId: UUID,
): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM task_practices
      WHERE teacher_id = $1 AND learner_task_id = $2
        AND status IN ('active', 'submitted', 'completed')`,
    [teacherId, learnerTaskId],
  );
  return (row?.n ?? 0) > 0;
}

export async function listPracticesForLearnerTask(
  learnerTaskId: UUID,
): Promise<TaskPractice[]> {
  const rows = await query<TaskPracticeRow>(
    `SELECT ${PRACTICE_SELECT} FROM task_practices
      WHERE learner_task_id = $1 ORDER BY created_at DESC`,
    [learnerTaskId],
  );
  return rows.map(toPractice);
}

// ─── Переходы ────────────────────────────────────────────────────────

export async function giveConsent(
  id: UUID,
  actorId: UUID,
): Promise<TaskPractice> {
  let planId = id;

  await transaction(async (client) => {
    const cur = await client.query<{
      teacher_id: string; learner_id: string;
      teacher_consent: boolean; learner_consent: boolean;
      status: PracticeStatus;
    }>(
      `SELECT teacher_id, learner_id, teacher_consent, learner_consent, status
         FROM task_practices WHERE id = $1 FOR UPDATE`,
      [planId],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('Практика', planId);}
    if (row.status === 'cancelled' || row.status === 'completed') {
      throw new ConflictError(`Нельзя дать согласие в статусе ${row.status}`);
    }
    if (row.status === 'active' || row.status === 'submitted') {
      return; // идемпотентно
    }

    const isTeacher = row.teacher_id === actorId;
    const isLearner = row.learner_id === actorId;
    if (!isTeacher && !isLearner) {
      throw new ForbiddenError('Согласие даёт только учитель или ученик');
    }

    const nextTeacher = isTeacher ? true : row.teacher_consent;
    const nextLearner = isLearner ? true : row.learner_consent;
    const nextStatus: PracticeStatus =
      nextTeacher && nextLearner ? 'active' : 'proposed';

    await client.query(
      `UPDATE task_practices
          SET teacher_consent = $2, learner_consent = $3,
              status = $4, updated_at = now()
        WHERE id = $1`,
      [planId, nextTeacher, nextLearner, nextStatus],
    );
  });

  await logAction({
    actorId, actorType: 'participant',
    action: 'task_practices.consent',
    entityType: 'task_practice', entityId: planId,
  });
  return getById(planId);
}

export async function submitPractice(
  id: UUID,
  actorId: UUID,
): Promise<TaskPractice> {
  const r = await queryOne<{ learner_id: string; status: PracticeStatus }>(
    `SELECT learner_id, status FROM task_practices WHERE id = $1`,
    [id],
  );
  if (!r) {throw new NotFoundError('Практика', id);}
  if (r.learner_id !== actorId) {
    throw new ForbiddenError('Сдать практику может только ученик');
  }
  if (r.status !== 'active') {
    throw new ConflictError(`Сдать можно только активную практику (текущий: ${r.status})`);
  }
  await query(
    `UPDATE task_practices
        SET status = 'submitted', updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [id],
  );
  await logAction({
    actorId, actorType: 'participant',
    action: 'task_practices.submit',
    entityType: 'task_practice', entityId: id,
  });
  return getById(id);
}

export async function completePractice(
  id: UUID,
  actorId: UUID,
): Promise<TaskPractice> {
  await transaction(async (client) => {
    const cur = await client.query<{
      teacher_id: string; status: PracticeStatus;
    }>(
      `SELECT teacher_id, status FROM task_practices WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = cur.rows[0];
    if (!r) {throw new NotFoundError('Практика', id);}
    if (r.teacher_id !== actorId) {
      throw new ForbiddenError('Завершить практику может только учитель');
    }
    if (r.status === 'completed') {return;} // идемпотентно
    if (r.status !== 'submitted') {
      throw new ConflictError(
        `Завершить можно только сданную практику (текущий: ${r.status})`,
      );
    }
    await client.query(
      `UPDATE task_practices
          SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'submitted'`,
      [id],
    );
  });
  await logAction({
    actorId, actorType: 'participant',
    action: 'task_practices.complete',
    entityType: 'task_practice', entityId: id,
  });
  return getById(id);
}

export async function cancelPractice(
  id: UUID,
  actorId: UUID,
  reason: string,
): Promise<TaskPractice> {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError('Причина отмены: минимум 3 символа');
  }

  await transaction(async (client) => {
    const cur = await client.query<{
      teacher_id: string; learner_id: string; status: PracticeStatus;
    }>(
      `SELECT teacher_id, learner_id, status FROM task_practices
        WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = cur.rows[0];
    if (!r) {throw new NotFoundError('Практика', id);}
    if (r.teacher_id !== actorId && r.learner_id !== actorId) {
      throw new ForbiddenError('Отменить может только учитель или ученик');
    }
    if (r.status === 'cancelled') {return;} // идемпотентно
    if (r.status === 'completed') {
      throw new ConflictError('Завершённую практику нельзя отменить');
    }
    await client.query(
      `UPDATE task_practices
          SET status = 'cancelled', cancelled_at = now(),
              cancel_reason = $2, updated_at = now()
        WHERE id = $1`,
      [id, reason.trim()],
    );
  });
  await logAction({
    actorId, actorType: 'participant',
    action: 'task_practices.cancel',
    entityType: 'task_practice', entityId: id,
    newValue: { reason },
  });
  return getById(id);
}