// C.1.09.01 — TeachingRelation per-atom + readiness (Фаза 3a, §12).
//
// A22: participants.mentor_id = «основной наставник»; teaching_relations —
// per-atom детализация. Обе структуры живут; ?scope=mentor проверяет обе.
// A23: readiness — вычисляемое. Критерий: P≥7 + X≥5 + E≥5 (для применимых
// измерений). Педагогическая компетенция как отдельный атом — Фаза 3b/3c.
//
// Контракт:
//   assign  — mentor сам назначает mentee, требует readiness='ready';
//             UNIQUE(mentor, mentee, atom) WHERE active → 409.
//   revoke  — только mentor (создатель) или FIRST_ARCHITECT.
//   readiness: 'ready' | 'not_ready' | 'unknown' + score + signals.
//
// event_type в passport_history_events: teaching_relation_created / revoked.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';
import {
  DIMENSIONS, isDimensionApplicable,
  type CreateMentorQuestionInput,
  type Dimension,
  type MentorQuestion,
  type MentorQuestionRow,
  type MentorQuestionStatus,
  type ReadinessResult,
  type ReadinessSignal,
  type ReadinessState,
  type TeachingRelation,
  type TeachingRelationRow,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Константы readiness (A23)
// ─────────────────────────────────────────────────────────────────────

const READINESS_THRESHOLDS: Partial<Record<Dimension, number>> = {
  P: 7,   // depth_execution — мастерски делает
  X: 5,   // способен объяснить
  E: 5,   // способен проверить
};
// U и D в readiness не участвуют: их роль — «глубина понимания»,
// оценивается через P+X+E в комбинации (см. паспорт 6.6).

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toTeachingRelation(r: TeachingRelationRow): TeachingRelation {
  return {
    id: r.id,
    mentorId: r.mentor_id,
    menteeId: r.mentee_id,
    atomId: r.atom_id,
    dimensions: r.dimensions,
    status: r.status,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
    reason: r.reason,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Readiness
// ─────────────────────────────────────────────────────────────────────

interface AtomApplicabilityRow {
  atom_id: string;
  dimension_applicability: Record<string, { applicable?: boolean }>;
}

export async function computeReadiness(
  mentorId: UUID,
  atomId: string,
): Promise<ReadinessResult | null> {
  const atom = await queryOne<AtomApplicabilityRow>(
    `SELECT atom_id, dimension_applicability
       FROM competency_atoms WHERE atom_id = $1`,
    [atomId],
  );
  if (!atom) return null;

  const states = await query<{
    dimension: Dimension;
    level: number | null;
    status: string;
  }>(
    `SELECT dimension, level, status
       FROM person_atom_states
      WHERE participant_id = $1 AND atom_id = $2`,
    [mentorId, atomId],
  );

  const applicability = atom.dimension_applicability as
    Parameters<typeof isDimensionApplicable>[0];
  const signals: ReadinessSignal[] = [];
  let requiredOk = 0;
  let requiredTotal = 0;
  let anyAssessment = false;

  for (const [dim, required] of Object.entries(READINESS_THRESHOLDS) as Array<
    [Dimension, number]
  >) {
    if (!isDimensionApplicable(applicability, dim)) continue;
    requiredTotal++;
    const s = states.find((x) => x.dimension === dim);
    const ok =
      !!s &&
      s.status === 'confirmed' &&
      s.level !== null &&
      s.level >= required;
    if (s && s.status === 'confirmed') anyAssessment = true;
    if (ok) requiredOk++;
    signals.push({
      dimension: dim,
      level: s?.level ?? null,
      required,
      ok,
    });
  }

  if (requiredTotal === 0) {
    return {
      mentorId, atomId, state: 'unknown', score: 0, signals: [],
      reason: 'no_required_dimensions',
    };
  }

  let state: ReadinessState;
  let reason: string | undefined;
  if (requiredOk === requiredTotal) {
    state = 'ready';
  } else if (anyAssessment) {
    state = 'not_ready';
    reason = 'required_thresholds_not_met';
  } else {
    state = 'unknown';
    reason = 'no_assessment';
  }

  return {
    mentorId,
    atomId,
    state,
    score: requiredOk / requiredTotal,
    signals,
    ...(reason ? { reason } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Список кандидатов-менторов по атому
// ─────────────────────────────────────────────────────────────────────

export interface MentorCandidate {
  mentorId: UUID;
  mentorExternalId: string;
  mentorName: string;
  readiness: ReadinessResult;
}

export async function getMentorsForAtom(
  atomId: string,
  limit = 100,
): Promise<MentorCandidate[]> {
  // Sanity: атом существует.
  const atom = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms WHERE atom_id = $1`,
    [atomId],
  );
  if (!atom) throw new NotFoundError('Atom', atomId);

  // Все активные участники; readiness считается per-atom в цикле
  // (54 атома × N участников — приемлемо для 3a; оптимизация — 3b).
  const participants = await query<{
    id: string;
    external_id: string;
    name: string;
  }>(
    `SELECT id, external_id, name
       FROM participants
      WHERE deleted_at IS NULL
      ORDER BY entered_at ASC
      LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))],
  );

  const out: MentorCandidate[] = [];
  for (const p of participants) {
    const readiness = await computeReadiness(p.id, atomId);
    if (!readiness) continue;
    if (readiness.state === 'unknown') continue;  // без оценок — не показываем
    out.push({
      mentorId: p.id,
      mentorExternalId: p.external_id,
      mentorName: p.name,
      readiness,
    });
  }

  // Сортировка: ready → not_ready, внутри — по score desc, затем по имени.
  out.sort((a, b) => {
    const ra = a.readiness.state === 'ready' ? 1 : 0;
    const rb = b.readiness.state === 'ready' ? 1 : 0;
    if (ra !== rb) return rb - ra;
    if (a.readiness.score !== b.readiness.score) {
      return b.readiness.score - a.readiness.score;
    }
    return a.mentorName.localeCompare(b.mentorName);
  });

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// assign / revoke
// ─────────────────────────────────────────────────────────────────────

export interface AssignRelationInput {
  menteeId: UUID;
  atomId: string;
  dimensions?: Dimension[];
  reason?: string;
}

const VALID_DIMENSIONS: readonly Dimension[] = DIMENSIONS;

export async function assignRelation(
  mentorId: UUID,
  input: AssignRelationInput,
): Promise<TeachingRelation> {
  if (input.menteeId === mentorId) {
    throw new ValidationError('Cannot be your own mentor');
  }

  const mentee = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [input.menteeId],
  );
  if (!mentee) throw new NotFoundError('Mentee', input.menteeId);

  const dimensions = input.dimensions ?? [...DIMENSIONS];
  for (const d of dimensions) {
    if (!VALID_DIMENSIONS.includes(d)) {
      throw new ValidationError(`Unknown dimension '${d}'`);
    }
  }
  if (dimensions.length === 0) {
    throw new ValidationError('dimensions must not be empty');
  }

  const readiness = await computeReadiness(mentorId, input.atomId);
  if (!readiness) throw new NotFoundError('Atom', input.atomId);
  if (readiness.state !== 'ready') {
    throw new ForbiddenError(
      `Mentor readiness is '${readiness.state}', assign requires 'ready'`,
      { readiness },
    );
  }

  return transaction(async (client) => {
    // Уже активная relation?
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM teaching_relations
        WHERE mentor_id = $1 AND mentee_id = $2 AND atom_id = $3
          AND status = 'active'
        FOR UPDATE`,
      [mentorId, input.menteeId, input.atomId],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError(
        'Active teaching relation already exists',
        { relation_id: existing.rows[0]!.id },
      );
    }

    const id = newUUID();
    const ins = await client.query<TeachingRelationRow>(
      `INSERT INTO teaching_relations
         (id, mentor_id, mentee_id, atom_id, dimensions, status,
          reason, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,'active',$6,$7)
       RETURNING id, mentor_id, mentee_id, atom_id, dimensions, status,
                 valid_from, valid_to, reason, created_by, created_at`,
      [
        id,
        mentorId,
        input.menteeId,
        input.atomId,
        JSON.stringify(dimensions),
        input.reason ?? null,
        mentorId,
      ],
    );
    const row = ins.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'teaching_relation_created', $3::jsonb, $4)`,
      [
        mentorId,
        input.atomId,
        JSON.stringify({
          relation_id: id,
          mentee_id: input.menteeId,
          dimensions,
        }),
        mentorId,
      ],
    );

    return toTeachingRelation(row);
  });
}

export async function revokeRelation(
  actorId: UUID,
  relationId: UUID,
  reason?: string,
): Promise<TeachingRelation> {
  const actorIsFA = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = 'FIRST_ARCHITECT'`,
    [actorId],
  );

  return transaction(async (client) => {
    const cur = await client.query<TeachingRelationRow>(
      `SELECT id, mentor_id, mentee_id, atom_id, dimensions, status,
              valid_from, valid_to, reason, created_by, created_at
         FROM teaching_relations
        WHERE id = $1
        FOR UPDATE`,
      [relationId],
    );
    const row = cur.rows[0];
    if (!row) throw new NotFoundError('Teaching relation', relationId);

    const isMentor = row.mentor_id === actorId;
    const isFA = (actorIsFA?.n ?? 0) > 0;
    if (!isMentor && !isFA) {
      throw new ForbiddenError(
        'Only the mentor or FIRST_ARCHITECT can revoke',
      );
    }

    if (row.status !== 'active') {
      // Идемпотентно возвращаем как есть.
      return toTeachingRelation(row);
    }

    const upd = await client.query<TeachingRelationRow>(
      `UPDATE teaching_relations
          SET status = 'revoked',
              valid_to = now(),
              reason = COALESCE($2, reason)
        WHERE id = $1
        RETURNING id, mentor_id, mentee_id, atom_id, dimensions, status,
                  valid_from, valid_to, reason, created_by, created_at`,
      [relationId, reason ?? null],
    );
    const updated = upd.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'teaching_relation_revoked', $3::jsonb, $4)`,
      [
        actorId,
        row.atom_id,
        JSON.stringify({
          relation_id: relationId,
          mentor_id: row.mentor_id,
          mentee_id: row.mentee_id,
          reason: reason ?? null,
        }),
        actorId,
      ],
    );

    return toTeachingRelation(updated);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Списки
// ─────────────────────────────────────────────────────────────────────

export interface TeachingStudentItem {
  relationId: UUID;
  menteeId: UUID;
  menteeExternalId: string;
  menteeName: string;
  atomId: string;
  atomName: string;
  dimensions: Dimension[];
  createdAt: string;
}

export async function getStudentsForMentor(
  mentorId: UUID,
): Promise<TeachingStudentItem[]> {
  const rows = await query<{
    id: string;
    mentee_id: string;
    external_id: string;
    name: string;
    atom_id: string;
    atom_name: string;
    dimensions: Dimension[];
    created_at: Date;
  }>(
    `SELECT tr.id,
            p.id AS mentee_id,
            p.external_id,
            p.name,
            ca.atom_id,
            ca.name AS atom_name,
            tr.dimensions,
            tr.created_at
       FROM teaching_relations tr
       JOIN participants p ON p.id = tr.mentee_id
       JOIN competency_atoms ca ON ca.atom_id = tr.atom_id
      WHERE tr.mentor_id = $1 AND tr.status = 'active'
      ORDER BY tr.created_at DESC`,
    [mentorId],
  );
  return rows.map((r) => ({
    relationId: r.id,
    menteeId: r.mentee_id,
    menteeExternalId: r.external_id,
    menteeName: r.name,
    atomId: r.atom_id,
    atomName: r.atom_name,
    dimensions: r.dimensions,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface TeachingMentorItem {
  relationId: UUID | null;
  mentorId: UUID;
  mentorExternalId: string | null;
  mentorName: string | null;
  atomId: string | null;
  atomName: string | null;
  dimensions: Dimension[] | null;
  source: 'primary' | 'per_atom';
  createdAt: string | null;
}

export async function getMentorsForMentee(
  menteeId: UUID,
): Promise<TeachingMentorItem[]> {
  const out: TeachingMentorItem[] = [];

  // 1. Primary mentor
  const primary = await queryOne<{
    mentor_id: string | null;
    external_id: string | null;
    name: string | null;
  }>(
    `SELECT p.mentor_id,
            m.external_id,
            m.name
       FROM participants p
       LEFT JOIN participants m ON m.id = p.mentor_id
      WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [menteeId],
  );
  if (primary?.mentor_id && primary.external_id !== null) {
    out.push({
      relationId: null,
      mentorId: primary.mentor_id,
      mentorExternalId: primary.external_id,
      mentorName: primary.name,
      atomId: null,
      atomName: null,
      dimensions: null,
      source: 'primary',
      createdAt: null,
    });
  }

  // 2. Per-atom
  const perAtom = await query<{
    id: string;
    mentor_id: string;
    external_id: string | null;
    name: string | null;
    atom_id: string;
    atom_name: string;
    dimensions: Dimension[];
    created_at: Date;
  }>(
    `SELECT tr.id,
            tr.mentor_id,
            m.external_id,
            m.name,
            tr.atom_id,
            ca.name AS atom_name,
            tr.dimensions,
            tr.created_at
       FROM teaching_relations tr
       LEFT JOIN participants m ON m.id = tr.mentor_id
       JOIN competency_atoms ca ON ca.atom_id = tr.atom_id
      WHERE tr.mentee_id = $1 AND tr.status = 'active'
      ORDER BY tr.created_at DESC`,
    [menteeId],
  );
  for (const r of perAtom) {
    out.push({
      relationId: r.id,
      mentorId: r.mentor_id,
      mentorExternalId: r.external_id,
      mentorName: r.name,
      atomId: r.atom_id,
      atomName: r.atom_name,
      dimensions: r.dimensions,
      source: 'per_atom',
      createdAt: r.created_at.toISOString(),
    });
  }

  return out;
}

function toMentorQuestion(r: MentorQuestionRow): MentorQuestion {
  return {
    id: r.id,
    participantId: r.participant_id,
    mentorId: r.mentor_id,
    atomId: r.atom_id,
    question: r.question,
    answer: r.answer,
    status: r.status,
    slaHours: r.sla_hours,
    createdAt: r.created_at.toISOString(),
    answeredAt: r.answered_at ? r.answered_at.toISOString() : null,
    firstResponseAt: r.first_response_at
      ? r.first_response_at.toISOString()
      : null,
  };
}

const MENTOR_QUESTION_SELECT = `
  id, participant_id, mentor_id, atom_id, cell_id, task_id, channel_id,
  question, answer, status, sla_hours, created_at, updated_at,
  first_response_at, answered_at, escalated_at
`;

export async function createMentorQuestion(
  actorId: UUID,
  input: CreateMentorQuestionInput,
): Promise<MentorQuestion> {
  if (!input.question || input.question.trim().length === 0) {
    throw new ValidationError('question must not be empty');
  }
  if (input.question.length > 5000) {
    throw new ValidationError('question is too long (max 5000)');
  }

  // A40: если mentorId не задан, но есть atomId и primary mentor — берём его.
  let mentorId = input.mentorId ?? null;
  if (mentorId === null) {
    const primary = await queryOne<{ mentor_id: string | null }>(
      `SELECT mentor_id FROM participants
        WHERE id = $1 AND deleted_at IS NULL`,
      [actorId],
    );
    mentorId = primary?.mentor_id ?? null;
  }

  if (input.atomId) {
    const atom = await queryOne<{ atom_id: string }>(
      `SELECT atom_id FROM competency_atoms WHERE atom_id = $1`,
      [input.atomId],
    );
    if (!atom) {
      throw new ValidationError(
        `atomId ${input.atomId} does not exist`,
        [{ path: 'atomId', message: 'atom not found' }],
      );
    }
  }

  if (mentorId !== null) {
    const m = await queryOne<{ id: string }>(
      `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
      [mentorId],
    );
    if (!m) {
      throw new ValidationError(
        `mentorId ${mentorId} does not exist`,
        [{ path: 'mentorId', message: 'participant not found' }],
      );
    }
  }

  const id = newUUID();
  const ins = await query<MentorQuestionRow>(
    `INSERT INTO mentor_questions
       (id, participant_id, mentor_id, atom_id, task_id, question, status)
     VALUES ($1,$2,$3,$4,$5,$6,'open')
     RETURNING ${MENTOR_QUESTION_SELECT}`,
    [
      id,
      actorId,
      mentorId,
      input.atomId ?? null,
      input.taskId ?? null,
      input.question.trim(),
    ],
  );
  const row = ins[0]!;

  await query(
    `INSERT INTO passport_history_events
       (participant_id, atom_id, event_type, payload, actor_id)
     VALUES ($1, $2, 'mentor_question_asked', $3::jsonb, $1)`,
    [
      actorId,
      input.atomId ?? null,
      JSON.stringify({
        mentor_question_id: id,
        mentor_id: mentorId,
        atom_id: input.atomId ?? null,
        task_id: input.taskId ?? null,
      }),
    ],
  );

  return toMentorQuestion(row);
}

export async function getMyQuestions(
  actorId: UUID,
  status?: MentorQuestionStatus,
): Promise<MentorQuestion[]> {
  const params: unknown[] = [actorId];
  let where = `participant_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const rows = await query<MentorQuestionRow>(
    `SELECT ${MENTOR_QUESTION_SELECT}
       FROM mentor_questions
      WHERE ${where}
      ORDER BY created_at DESC`,
    params,
  );
  return rows.map(toMentorQuestion);
}

export async function getMentorQuestions(
  mentorId: UUID,
  status?: MentorQuestionStatus,
): Promise<MentorQuestion[]> {
  const params: unknown[] = [mentorId];
  let where = `mentor_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const rows = await query<MentorQuestionRow>(
    `SELECT ${MENTOR_QUESTION_SELECT}
       FROM mentor_questions
      WHERE ${where}
      ORDER BY created_at DESC`,
    params,
  );
  return rows.map(toMentorQuestion);
}

export async function answerMentorQuestion(
  actorId: UUID,
  questionId: UUID,
  answer: string,
): Promise<MentorQuestion> {
  if (!answer || answer.trim().length === 0) {
    throw new ValidationError('answer must not be empty');
  }
  if (answer.length > 10000) {
    throw new ValidationError('answer is too long (max 10000)');
  }

  return transaction(async (client) => {
    const cur = await client.query<MentorQuestionRow>(
      `SELECT ${MENTOR_QUESTION_SELECT}
         FROM mentor_questions
        WHERE id = $1
        FOR UPDATE`,
      [questionId],
    );
    const row = cur.rows[0];
    if (!row) {
      throw new NotFoundError('Mentor question', questionId);
    }

    // A41: только mentor_id вопроса, либо FIRST_ARCHITECT (эскалация).
    const isMentor = row.mentor_id === actorId;
    const isFA = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM participant_roles pr
         JOIN roles r ON r.id = pr.role_id
        WHERE pr.participant_id = $1
          AND pr.status = 'active'
          AND (pr.valid_to IS NULL OR pr.valid_to > now())
          AND r.name = 'FIRST_ARCHITECT'`,
      [actorId],
    );
    if (!isMentor && !((isFA?.n ?? 0) > 0)) {
      throw new ForbiddenError(
        'Only the mentor of this question or FIRST_ARCHITECT can answer',
        { mentor_id: row.mentor_id },
      );
    }

    if (row.status === 'closed') {
      throw new ConflictError('Question is closed');
    }

    const now = new Date();
    const firstResponse =
      row.first_response_at === null ? now : row.first_response_at;

    const upd = await client.query<MentorQuestionRow>(
      `UPDATE mentor_questions
          SET answer = $2,
              status = 'answered',
              first_response_at = COALESCE(first_response_at, now()),
              answered_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING ${MENTOR_QUESTION_SELECT}`,
      [questionId, answer.trim()],
    );
    const updated = upd.rows[0]!;
    void firstResponse;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'mentor_question_answered', $3::jsonb, $4)`,
      [
        row.participant_id,
        row.atom_id,
        JSON.stringify({
          mentor_question_id: row.id,
          mentor_id: row.mentor_id,
          answered_by: actorId,
        }),
        actorId,
      ],
    );

    return toMentorQuestion(updated);
  });
}