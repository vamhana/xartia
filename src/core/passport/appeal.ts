// C.1.05.01 — Resolve апелляции (Фаза 2; §18.1 + A14).
//
// Апелляция хранится append-only в passport_history_events:
//   * 'appeal_filed'  (id = appealId) — payload: { assessment_id, reason }
//   * 'appeal_resolved'              — payload: { appeal_id, resolution,
//                                                  resolver_id, note,
//                                                  replaced_by?, assigned_to?,
//                                                  original_reason }
//   * 'assessment_invalidated'       — payload: { assessment_id, appeal_id,
//                                                  replaced_by? }
//                                      (только при upheld, §6.2)
//
// "Уже resolved" = существует 'appeal_resolved' с payload->>'appeal_id' = appealId.
// Повторный resolve → 409.
//
// Независимость арбитра (§18.1 + A14):
//   resolver имеет роль FIRST_ARCHITECT | VERIFIER;
//   resolver ∉ {subject_id, assessor_id, subject.mentor_id}.
//
// Исходы (ревизия 2.1):
//   upheld   — жалоба удовлетворена:
//              без replacement: assessment → 'invalidated';
//                               state → 'not_assessed' / level NULL
//              с replacement:   assessment → 'superseded';
//                               replacement → 'active';
//                               state → 'confirmed' / level = replacement.level
//   rejected — жалоба отклонена:
//              assessment → 'active'; state → 'confirmed' (level сохраняется)
//   remanded — на повторную оценку:
//              assessment остаётся 'under_review';
//              state → 'under_review' (level сохраняется);
//              payload.assigned_to фиксирует, кому назначено
//
// Приоритеты Standard/High/Critical (паспорт §18.1) в Фазе 2 не реализуются
// (нет модуля Коннективности). reason из appeal_filed сохраняется
// в payload appeal_resolved — единственный текст мотивации.
//
// Осознанные упрощения Фазы 2:
//   * assigned_to (для remanded) проверяется только на наличие роли resolver;
//     независимость повторного оценщика от subject — ответственность вызывающего.
//   * replacement assessment не проверяется на независимость от старого
//     assessor'а — это забота того, кто создал replacement.

import { queryOne, transaction } from '../../lib/db.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

const RESOLVER_ROLE_NAMES = ['FIRST_ARCHITECT', 'VERIFIER'] as const;

export type AppealResolution = 'upheld' | 'rejected' | 'remanded';

export interface ResolveAppealInput {
  appealId: UUID;
  resolution: AppealResolution;
  note: string;
  replacementAssessmentId?: UUID;
  assignedTo?: UUID;
}

export interface ResolveAppealResult {
  appealId: UUID;
  resolution: AppealResolution;
  assessmentId: UUID;
  replacedBy: UUID | null;
}

interface AppealFiledRow {
  id: string;
  participant_id: string;
  atom_id: string | null;
  payload: { assessment_id?: string; reason?: string };
}

interface AssessmentRow {
  id: string;
  participant_id: string;
  atom_id: string;
  dimension: 'U' | 'X' | 'D' | 'P' | 'E';
  level: number | null;
  assessor_id: string;
  status: string;
}

async function hasResolverRole(participantId: UUID): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...RESOLVER_ROLE_NAMES]],
  );
  return (row?.n ?? 0) > 0;
}

export async function resolveAppeal(
  input: ResolveAppealInput,
  resolverId: UUID,
): Promise<ResolveAppealResult> {
  if (!input.note || input.note.trim().length === 0) {
    throw new ValidationError('note is required (мотивация решения)');
  }
  if (!(await hasResolverRole(resolverId))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT or VERIFIER can resolve appeals',
      { allowed_roles: [...RESOLVER_ROLE_NAMES] },
    );
  }

  return transaction(async (client) => {
    // 1. appeal_filed + FOR UPDATE (сериализация двух параллельных резолверов).
    const appealRes = await client.query<AppealFiledRow>(
      `SELECT id, participant_id, atom_id, payload
         FROM passport_history_events
        WHERE id = $1 AND event_type = 'appeal_filed'
        FOR UPDATE`,
      [input.appealId],
    );
    const appeal = appealRes.rows[0];
    if (!appeal) {
      throw new NotFoundError('Appeal', input.appealId);
    }

    const assessmentId = appeal.payload.assessment_id;
    if (!assessmentId) {
      throw new ValidationError('appeal_filed has no assessment_id in payload');
    }

    // 2. Уже resolved → 409. Проверка идёт ПОСЛЕ FOR UPDATE — иначе
    // два параллельных резолвера оба прошли бы pre-check.
    const resolvedRes = await client.query<{ id: string }>(
      `SELECT id FROM passport_history_events
        WHERE event_type = 'appeal_resolved'
          AND payload->>'appeal_id' = $1
        LIMIT 1`,
      [input.appealId],
    );
    if (resolvedRes.rows.length > 0) {
      throw new ConflictError(
        'Appeal already resolved',
        { appeal_id: input.appealId },
      );
    }

    // 3. Assessment под ревью + FOR UPDATE.
    const aRes = await client.query<AssessmentRow>(
      `SELECT id, participant_id, atom_id, dimension, level, assessor_id, status
         FROM passport_assessments
        WHERE id = $1
        FOR UPDATE`,
      [assessmentId],
    );
    const assessment = aRes.rows[0];
    if (!assessment) {
      throw new NotFoundError('Assessment', assessmentId);
    }
    if (assessment.status !== 'under_review') {
      throw new ConflictError(
        `Assessment is in status '${assessment.status}', expected 'under_review'`,
      );
    }
    if (assessment.participant_id !== appeal.participant_id) {
      throw new ValidationError('appeal.subject ≠ assessment.subject');
    }

    // 4. Независимость арбитра (§18.1 + A14).
    if (resolverId === assessment.participant_id) {
      throw new ForbiddenError('Resolver cannot be the appellant (subject)');
    }
    if (resolverId === assessment.assessor_id) {
      throw new ForbiddenError('Resolver cannot be the original assessor');
    }
    const mentorRow = await client.query<{ mentor_id: string | null }>(
      `SELECT mentor_id FROM participants WHERE id = $1`,
      [assessment.participant_id],
    );
    if (mentorRow.rows[0]?.mentor_id === resolverId) {
      throw new ForbiddenError("Resolver cannot be the appellant's mentor");
    }

    // 5. Ветка исхода.
    let replacedBy: string | null = null;

    if (input.resolution === 'upheld') {
      if (input.replacementAssessmentId) {
        const rRes = await client.query<AssessmentRow>(
          `SELECT id, participant_id, atom_id, dimension, level, assessor_id, status
             FROM passport_assessments
            WHERE id = $1
            FOR UPDATE`,
          [input.replacementAssessmentId],
        );
        const rep = rRes.rows[0];
        if (!rep) {
          throw new NotFoundError('Replacement assessment', input.replacementAssessmentId);
        }
        if (rep.id === assessment.id) {
          throw new ValidationError('replacement_assessment_id = original');
        }
        if (
          rep.participant_id !== assessment.participant_id ||
          rep.atom_id !== assessment.atom_id ||
          rep.dimension !== assessment.dimension
        ) {
          throw new ValidationError(
            'replacement assessment must match subject/atom/dimension',
          );
        }
        if (
          rep.status !== 'active' &&
          rep.status !== 'provisional' &&
          rep.status !== 'calibration_pending'
        ) {
          throw new ConflictError(
            `replacement assessment status='${rep.status}' — cannot be activated`,
          );
        }

        await client.query(
          `UPDATE passport_assessments SET status = 'superseded' WHERE id = $1`,
          [assessment.id],
        );
        await client.query(
          `UPDATE passport_assessments SET status = 'active' WHERE id = $1`,
          [rep.id],
        );
        await client.query(
          `UPDATE person_atom_states
              SET status = 'confirmed', level = $4, updated_at = now()
            WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3`,
          [assessment.participant_id, assessment.atom_id, assessment.dimension, rep.level],
        );
        replacedBy = rep.id;
      } else {
        await client.query(
          `UPDATE passport_assessments SET status = 'invalidated' WHERE id = $1`,
          [assessment.id],
        );
        await client.query(
          `UPDATE person_atom_states
              SET status = 'not_assessed', level = NULL, updated_at = now()
            WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3`,
          [assessment.participant_id, assessment.atom_id, assessment.dimension],
        );
      }
    } else if (input.resolution === 'rejected') {
      await client.query(
        `UPDATE passport_assessments SET status = 'active' WHERE id = $1`,
        [assessment.id],
      );
      await client.query(
        `UPDATE person_atom_states
            SET status = 'confirmed', updated_at = now()
          WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3`,
        [assessment.participant_id, assessment.atom_id, assessment.dimension],
      );
    } else if (input.resolution === 'remanded') {
      if (!input.assignedTo) {
        throw new ValidationError('remanded requires assignedTo');
      }
      if (!(await hasResolverRole(input.assignedTo))) {
        throw new ValidationError('assignedTo must be an authorized resolver');
      }
      await client.query(
        `UPDATE person_atom_states
            SET status = 'under_review', updated_at = now()
          WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3`,
        [assessment.participant_id, assessment.atom_id, assessment.dimension],
      );
    } else {
      throw new ValidationError(`Unknown resolution '${input.resolution}'`);
    }

    // 6. История: appeal_resolved (append-only).
    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'appeal_resolved', $3::jsonb, $4)`,
      [
        appeal.participant_id,
        appeal.atom_id,
        JSON.stringify({
          appeal_id: input.appealId,
          resolution: input.resolution,
          resolver_id: resolverId,
          note: input.note.trim(),
          replaced_by: replacedBy,
          assigned_to: input.assignedTo ?? null,
          original_reason: appeal.payload.reason ?? null,
        }),
        resolverId,
      ],
    );

    // 7. Для upheld — отдельное событие assessment_invalidated (§6.2).
    if (input.resolution === 'upheld') {
      await client.query(
        `INSERT INTO passport_history_events
           (participant_id, atom_id, event_type, payload, actor_id)
         VALUES ($1, $2, 'assessment_invalidated', $3::jsonb, $4)`,
        [
          appeal.participant_id,
          appeal.atom_id,
          JSON.stringify({
            assessment_id: assessment.id,
            replaced_by: replacedBy,
            appeal_id: input.appealId,
          }),
          resolverId,
        ],
      );
    }

    return {
      appealId: input.appealId,
      resolution: input.resolution,
      assessmentId: assessment.id,
      replacedBy,
    };
  });
}