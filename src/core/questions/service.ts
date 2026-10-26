// C.0.04.14 — Вопросы наставнику.
//
// Вопрос идёт в очередь с SLA (4 ч), на него отвечает другой человек
// (не автор вопроса). Просрочка эскалируется, ответ сохраняется.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { ForbiddenError, ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';

export interface MentorQuestion {
  id: UUID;
  participantId: UUID;
  mentorId: UUID | null;
  cellId: UUID | null;
  taskId: UUID | null;
  channelId: string | null;
  question: string;
  answer: string | null;
  status: 'open' | 'answered' | 'escalated' | 'closed';
  slaHours: number;
  createdAt: string;
  answeredAt: string | null;
  escalatedAt: string | null;
}

interface Row {
  id: string;
  participant_id: string;
  mentor_id: string | null;
  cell_id: string | null;
  task_id: string | null;
  channel_id: string | null;
  question: string;
  answer: string | null;
  status: string;
  sla_hours: number;
  created_at: Date;
  answered_at: Date | null;
  escalated_at: Date | null;
}

function toQuestion(row: Row): MentorQuestion {
  return {
    id: row.id,
    participantId: row.participant_id,
    mentorId: row.mentor_id,
    cellId: row.cell_id,
    taskId: row.task_id,
    channelId: row.channel_id,
    question: row.question,
    answer: row.answer,
    status: row.status as MentorQuestion['status'],
    slaHours: row.sla_hours,
    createdAt: row.created_at.toISOString(),
    answeredAt: row.answered_at ? row.answered_at.toISOString() : null,
    escalatedAt: row.escalated_at ? row.escalated_at.toISOString() : null,
  };
}

const SLA_HOURS = 4;

export async function createQuestion(
  input: {
    question: string;
    mentorId?: UUID | null;
    cellId?: UUID | null;
    taskId?: UUID | null;
    channelId?: string | null;
  },
  askerId: UUID,
): Promise<MentorQuestion> {
  const text = input.question.trim();
  if (text.length < 10) {throw new ValidationError('Вопрос: минимум 10 символов');}

  const row = await queryOne<Row>(
    `INSERT INTO mentor_questions
       (id, participant_id, mentor_id, cell_id, task_id, channel_id, question, sla_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [newUUID(), askerId, input.mentorId ?? null, input.cellId ?? null,
     input.taskId ?? null, input.channelId ?? null, text, SLA_HOURS],
  );
  if (!row) {throw new ConflictError('Не удалось создать вопрос');}

  await logAction({
    actorId: askerId, actorType: 'participant',
    action: 'questions.create', entityType: 'mentor_question', entityId: row.id,
    newValue: { mentor_id: input.mentorId ?? null, cell_id: input.cellId ?? null },
  });

  return toQuestion(row);
}

export async function listQuestions(filter: {
  status?: string;
  mentorId?: UUID;
  cellId?: UUID;
  mine?: UUID;
} = {}): Promise<MentorQuestion[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.status) {params.push(filter.status); where.push(`status = $${params.length}`);}
  if (filter.mentorId) {params.push(filter.mentorId); where.push(`mentor_id = $${params.length}`);}
  if (filter.cellId) {params.push(filter.cellId); where.push(`cell_id = $${params.length}`);}
  if (filter.mine) {params.push(filter.mine); where.push(`participant_id = $${params.length}`);}

  const rows = await query<Row>(
    `SELECT * FROM mentor_questions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT 200`,
    params,
  );
  return rows.map(toQuestion);
}

export async function answerQuestion(
  id: UUID,
  answer: string,
  actorId: UUID,
): Promise<MentorQuestion> {
  if (answer.trim().length < 5) {throw new ValidationError('Ответ: минимум 5 символов');}

  const current = await getQuestion(id);
  if (current.participantId === actorId) {
    throw new ForbiddenError('Нельзя отвечать на свой вопрос');
  }
  if (current.status === 'answered') {throw new ConflictError('Вопрос уже отвечен');}

  const row = await queryOne<Row>(
    `UPDATE mentor_questions
        SET answer = $2, status = 'answered',
            first_response_at = COALESCE(first_response_at, now()),
            answered_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('open', 'escalated')
      RETURNING *`,
    [id, answer.trim()],
  );
  if (!row) {throw new ConflictError('Вопрос изменён параллельно');}

  await logAction({
    actorId, actorType: 'participant',
    action: 'questions.answer', entityType: 'mentor_question', entityId: id,
  });
  return toQuestion(row);
}

export async function getQuestion(id: UUID): Promise<MentorQuestion> {
  const row = await queryOne<Row>(`SELECT * FROM mentor_questions WHERE id = $1`, [id]);
  if (!row) {throw new NotFoundError('Вопрос', id);}
  return toQuestion(row);
}

export async function escalateQuestion(
  id: UUID,
  actorId: UUID,
): Promise<MentorQuestion> {
  const row = await queryOne<Row>(
    `UPDATE mentor_questions
        SET status = 'escalated', escalated_at = COALESCE(escalated_at, now()),
            updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING *`,
    [id],
  );
  if (!row) {
    const current = await getQuestion(id);
    throw new ConflictError(`Вопрос в статусе ${current.status}`);
  }
  await logAction({
    actorId, actorType: 'participant',
    action: 'questions.escalate', entityType: 'mentor_question', entityId: id,
  });
  return toQuestion(row);
}

/** Часовой проход: открытые вопросы старше SLA → escalated. */
export async function escalateOverdueQuestions(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE mentor_questions
        SET status = 'escalated', escalated_at = COALESCE(escalated_at, now()),
            updated_at = now()
      WHERE status = 'open'
        AND created_at < now() - (sla_hours * interval '1 hour')
      RETURNING id`,
  );
  return rows.length;
}

export async function getQuestionsSla(): Promise<{
  open: number;
  escalated: number;
  overdue: number;
  avgResponseHours: number;
}> {
  const row = await queryOne<{
    open: string; escalated: string; overdue: string; avg_response: string | null;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')::text AS open,
       COUNT(*) FILTER (WHERE status = 'escalated')::text AS escalated,
       COUNT(*) FILTER (
         WHERE status IN ('open', 'escalated')
           AND created_at < now() - (sla_hours * interval '1 hour')
       )::text AS overdue,
       AVG(EXTRACT(EPOCH FROM (answered_at - created_at))/3600)
         FILTER (WHERE answered_at IS NOT NULL)::text AS avg_response
     FROM mentor_questions`,
  );
  return {
    open: parseInt(row?.open ?? '0', 10),
    escalated: parseInt(row?.escalated ?? '0', 10),
    overdue: parseInt(row?.overdue ?? '0', 10),
    avgResponseHours: Math.round(parseFloat(row?.avg_response ?? '0') * 10) / 10,
  };
}
