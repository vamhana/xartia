// C.1.03.01 — Запись: evidence / assessment / appeal / development path.
//
// Правила:
//   * evidence: только для себя (actorId === participantId) в Фазе 1.
//   * assessment: только уполномоченный, запрет self, level 0..9 (не null).
//     При записи вытесняет прежние active по (participant, atom, dimension)
//     в статус 'superseded'.
//   * assessment.evidenceIds (B1, Фаза 2): опциональные явные связи с
//     passport_evidence через passport_assessment_evidence. Evidence должны
//     принадлежать subject, совпадать по атому и измерению и быть в одном
//     из статусов submitted/accepted/disputed.
//   * appeal: только subject; assessment → under_review; state → under_review.
//   * history events — append-only (триггер в 058), пишем в той же транзакции.
//   * person_atom_states — денормализованный текущий срез, обновляется тут.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import { getAtomById } from './catalog.js';
import type { Dimension, EvidenceContext, EvidenceType } from './types.js';
import {
  isValidLevel, isDimensionApplicable,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Входные типы
// ─────────────────────────────────────────────────────────────────────

export interface SubmitEvidenceInput {
  participantId: UUID;
  atomId: string;
  dimension: Dimension;
  evidenceType: EvidenceType;
  description: string;
  artifactUrl?: string | null;
  context?: EvidenceContext;
}

export interface SubmitAssessmentInput {
  participantId: UUID;   // subject
  atomId: string;
  dimension: Dimension;
  level: number;         // 0..9
  method: string;
  context?: EvidenceContext;
  /** Явные evidence, подтверждающие assessment. В Фазе 2 — опционально. */
  evidenceIds?: UUID[];
}

export interface SubmitAppealInput {
  assessmentId: UUID;
  reason: string;
}

export interface CreatePathInput {
  goal: string;
  targetProfileSlug?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────

const ASSESSOR_ROLE_NAMES = [
  'FIRST_ARCHITECT',
  'VERIFIER',
  'OTC',
  'COUNCIL_MEMBER',
] as const;

async function hasAssessorRole(participantId: UUID): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...ASSESSOR_ROLE_NAMES]],
  );
  return (row?.n ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────
// Evidence
// ─────────────────────────────────────────────────────────────────────

export async function submitEvidence(
  input: SubmitEvidenceInput,
  actorId: UUID,
): Promise<{ evidenceId: UUID }> {
  if (input.participantId !== actorId) {
    throw new ForbiddenError(
      'Phase 1: evidence can only be submitted for yourself',
      { participant_id: input.participantId, actor_id: actorId },
    );
  }

  const atom = await getAtomById(input.atomId);
  if (!atom) {
    throw new ValidationError(`Atom ${input.atomId} not found`);
  }
  if (!isDimensionApplicable(atom.dimension_applicability, input.dimension)) {
    throw new ValidationError(
      `Dimension ${input.dimension} not applicable to atom ${input.atomId}`,
    );
  }
  if (!input.description || input.description.trim().length === 0) {
    throw new ValidationError('description must not be empty');
  }

  const evidenceId = newUUID();

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO passport_evidence
         (id, participant_id, atom_id, dimension, evidence_type,
          description, artifact_url, context, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'submitted',$9)`,
      [
        evidenceId,
        input.participantId,
        input.atomId,
        input.dimension,
        input.evidenceType,
        input.description.trim(),
        input.artifactUrl ?? null,
        JSON.stringify(input.context ?? {}),
        actorId,
      ],
    );

    // State: not_assessed → declared. Не трогаем confirmed / under_review /
    // disputed — evidence не перезаписывает действующий статус.
    await client.query(
      `INSERT INTO person_atom_states
         (participant_id, atom_id, dimension, level, status, updated_at)
       VALUES ($1,$2,$3,NULL,'declared',now())
       ON CONFLICT (participant_id, atom_id, dimension) DO UPDATE
         SET status = CASE
               WHEN person_atom_states.status = 'not_assessed' THEN 'declared'
               ELSE person_atom_states.status
             END,
             updated_at = now()`,
      [input.participantId, input.atomId, input.dimension],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1,$2,'evidence_submitted',$3::jsonb,$4)`,
      [
        input.participantId,
        input.atomId,
        JSON.stringify({
          evidence_id: evidenceId,
          dimension: input.dimension,
          evidence_type: input.evidenceType,
        }),
        actorId,
      ],
    );
  });

  return { evidenceId };
}

// ─────────────────────────────────────────────────────────────────────
// Assessment
// ─────────────────────────────────────────────────────────────────────

export async function submitAssessment(
  input: SubmitAssessmentInput,
  assessorId: UUID,
): Promise<{ assessmentId: UUID }> {
  if (input.participantId === assessorId) {
    throw new ForbiddenError('Cannot assess own work', {
      participant_id: input.participantId,
    });
  }
  if (!isValidLevel(input.level)) {
    throw new ValidationError('level must be an integer 0..9');
  }

  const atom = await getAtomById(input.atomId);
  if (!atom) {
    throw new ValidationError(`Atom ${input.atomId} not found`);
  }
  if (!isDimensionApplicable(atom.dimension_applicability, input.dimension)) {
    throw new ValidationError(
      `Dimension ${input.dimension} not applicable to atom ${input.atomId}`,
    );
  }

  if (!(await hasAssessorRole(assessorId))) {
    throw new ForbiddenError(
      'Only authorized assessors can create assessments',
      { allowed_roles: [...ASSESSOR_ROLE_NAMES] },
    );
  }

  const assessmentId = newUUID();

  await transaction(async (client) => {
    // Вытесняем прежние active/provisional/calibration_pending.
    // under_review/rejected/invalidated/superseded не трогаем.
    await client.query(
      `UPDATE passport_assessments
          SET status = 'superseded'
        WHERE participant_id = $1
          AND atom_id = $2
          AND dimension = $3
          AND status IN ('active','provisional','calibration_pending')`,
      [input.participantId, input.atomId, input.dimension],
    );

    await client.query(
      `INSERT INTO passport_assessments
         (id, participant_id, atom_id, dimension, level, method,
          assessor_id, context, status, criteria_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',$9)`,
      [
        assessmentId,
        input.participantId,
        input.atomId,
        input.dimension,
        input.level,
        input.method,
        assessorId,
        JSON.stringify(input.context ?? {}),
        atom.version,
      ],
    );

    // Связь с evidence (B1, Фаза 2). Опционально.
    if (input.evidenceIds && input.evidenceIds.length > 0) {
      const evs = await client.query<{
        id: string; participant_id: string; atom_id: string;
        dimension: Dimension; status: string;
      }>(
        `SELECT id, participant_id, atom_id, dimension, status
           FROM passport_evidence WHERE id = ANY($1::uuid[])`,
        [input.evidenceIds],
      );
      if (evs.rows.length !== input.evidenceIds.length) {
        throw new ValidationError('Some evidenceIds do not exist');
      }
      for (const r of evs.rows) {
        if (r.participant_id !== input.participantId) {
          throw new ValidationError(`evidence ${r.id} does not belong to subject`);
        }
        if (r.atom_id !== input.atomId) {
          throw new ValidationError(`evidence ${r.id} atom mismatch`);
        }
        if (r.dimension !== input.dimension) {
          throw new ValidationError(`evidence ${r.id} dimension mismatch`);
        }
        if (!['submitted', 'accepted', 'disputed'].includes(r.status)) {
          throw new ValidationError(
            `evidence ${r.id} status '${r.status}' cannot be linked`,
          );
        }
      }
      for (const ev of input.evidenceIds) {
        await client.query(
          `INSERT INTO passport_assessment_evidence (assessment_id, evidence_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [assessmentId, ev],
        );
      }
    }

    // Денормализованный текущий срез: confirmed + level.
    await client.query(
      `INSERT INTO person_atom_states
         (participant_id, atom_id, dimension, level, status, updated_at)
       VALUES ($1,$2,$3,$4,'confirmed',now())
       ON CONFLICT (participant_id, atom_id, dimension) DO UPDATE
         SET level = EXCLUDED.level,
             status = 'confirmed',
             updated_at = now()`,
      [input.participantId, input.atomId, input.dimension, input.level],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1,$2,'assessment_activated',$3::jsonb,$4)`,
      [
        input.participantId,
        input.atomId,
        JSON.stringify({
          assessment_id: assessmentId,
          dimension: input.dimension,
          level: input.level,
          method: input.method,
          assessor_id: assessorId,
          evidence_ids: input.evidenceIds ?? [],
        }),
        assessorId,
      ],
    );
  });

  return { assessmentId };
}

// ─────────────────────────────────────────────────────────────────────
// Appeal
// ─────────────────────────────────────────────────────────────────────

export async function submitAppeal(
  input: SubmitAppealInput,
  actorId: UUID,
): Promise<void> {
  if (!input.reason || input.reason.trim().length === 0) {
    throw new ValidationError('reason must not be empty');
  }

  const assessment = await queryOne<{
    id: string;
    participant_id: string;
    atom_id: string;
    dimension: Dimension;
    status: string;
  }>(
    `SELECT id, participant_id, atom_id, dimension, status
       FROM passport_assessments WHERE id = $1`,
    [input.assessmentId],
  );
  if (!assessment) {
    throw new NotFoundError('Assessment', input.assessmentId);
  }
  if (assessment.participant_id !== actorId) {
    throw new ForbiddenError('Only the subject can appeal an assessment');
  }
  if (!['active', 'provisional', 'calibration_pending'].includes(assessment.status)) {
    throw new ConflictError(
      `Assessment in status '${assessment.status}' cannot be appealed`,
    );
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE passport_assessments SET status = 'under_review' WHERE id = $1`,
      [input.assessmentId],
    );

    await client.query(
      `UPDATE person_atom_states
          SET status = 'under_review', updated_at = now()
        WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3
          AND status = 'confirmed'`,
      [assessment.participant_id, assessment.atom_id, assessment.dimension],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1,$2,'appeal_filed',$3::jsonb,$4)`,
      [
        assessment.participant_id,
        assessment.atom_id,
        JSON.stringify({
          assessment_id: input.assessmentId,
          reason: input.reason.trim(),
        }),
        actorId,
      ],
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// Development path (фантомный маршрут)
// ─────────────────────────────────────────────────────────────────────

export async function createPath(
  participantId: UUID,
  input: CreatePathInput,
): Promise<{ pathId: UUID }> {
  if (!input.goal || input.goal.trim().length === 0) {
    throw new ValidationError('goal must not be empty');
  }

  let targetProfileId: UUID | null = null;
  const missingAtoms: Array<{
    atom_id: string;
    missing_dimensions: Dimension[];
    alternative_atom_ids: string[];
  }> = [];

  if (input.targetProfileSlug) {
    const profile = await queryOne<{
      id: string;
      requirements: {
        atoms: Array<{ atom_id: string; min: Record<string, number> }>;
      };
    }>(
      `SELECT id, requirements FROM profession_profiles WHERE slug = $1`,
      [input.targetProfileSlug],
    );
    if (!profile) {
      throw new ValidationError(`Profile '${input.targetProfileSlug}' not found`);
    }
    targetProfileId = profile.id;

    for (const req of profile.requirements.atoms) {
      const states = await query<{
        dimension: Dimension;
        level: number | null;
        status: string;
      }>(
        `SELECT dimension, level, status
           FROM person_atom_states
          WHERE participant_id = $1 AND atom_id = $2`,
        [participantId, req.atom_id],
      );
      const missingDims: Dimension[] = [];
      for (const [dim, minLevel] of Object.entries(req.min) as Array<
        [Dimension, number]
      >) {
        const s = states.find((x) => x.dimension === dim);
        if (
          !s ||
          s.status !== 'confirmed' ||
          s.level === null ||
          s.level < minLevel
        ) {
          missingDims.push(dim);
        }
      }
      if (missingDims.length > 0) {
        missingAtoms.push({
          atom_id: req.atom_id,
          missing_dimensions: missingDims,
          alternative_atom_ids: [],
        });
      }
    }

    // alternative_to (§7.3, §9.3). Один запрос на все missing.
    if (missingAtoms.length > 0) {
      const altRows = await query<{ from_atom_id: string; to_atom_id: string }>(
        `SELECT from_atom_id, to_atom_id
           FROM competency_relations
          WHERE relation_type = 'alternative_to'
            AND from_atom_id = ANY($1::text[])`,
        [missingAtoms.map((m) => m.atom_id)],
      );
      const altMap = new Map<string, string[]>();
      for (const r of altRows) {
        const list = altMap.get(r.from_atom_id) ?? [];
        list.push(r.to_atom_id);
        altMap.set(r.from_atom_id, list);
      }
      for (const m of missingAtoms) {
        m.alternative_atom_ids = altMap.get(m.atom_id) ?? [];
      }
    }
  }

  const pathId = newUUID();

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO development_paths
         (id, participant_id, goal, target_profile_id, missing_atoms, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,'active')`,
      [
        pathId,
        participantId,
        input.goal.trim(),
        targetProfileId,
        JSON.stringify(missingAtoms),
      ],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'path_created', $2::jsonb, $3)`,
      [
        participantId,
        JSON.stringify({
          path_id: pathId,
          target_profile_slug: input.targetProfileSlug ?? null,
        }),
        participantId,
      ],
    );
  });

  return { pathId };
}