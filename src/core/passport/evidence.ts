// C.1.05.02 — Disputed workflow (§7.2.1, Фаза 2).
//
// dispute: subject (владелец) или assessor связанного assessment.
//          evidence.status ∈ {submitted, accepted} → 'disputed'.
//          Для связанных assessments (status ∈ {active, provisional,
//          calibration_pending}) → 'under_review'; person_atom_states
//          (status='confirmed') → 'under_review'. reason идёт в payload.
//
// resolve: FIRST_ARCHITECT | VERIFIER. evidence.status='disputed' →
//          accepted | rejected | invalidated.
//          * invalidated → связанные assessments в 'under_review'
//            подтверждаются отдельным событием 'assessment_under_review'
//            с payload.reason='evidence_invalidated'.
//          * accepted | rejected → assessment не трогаем: он остаётся
//            'under_review' до явного resolveAppeal или ручного решения.
//            Это осознанно (§7.2.1 не переписывает оценку автоматически,
//            §18.1 решает через отдельную процедуру).
//
// Повторный dispute/resolve → 409 (идемпотентно-безопасно).
// Оба действия пишут в append-only history.

import { queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

const RESOLVER_ROLE_NAMES = ['FIRST_ARCHITECT', 'VERIFIER'] as const;

export type DisputeResolution = 'accepted' | 'rejected' | 'invalidated';

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

interface EvidenceRow {
  id: string;
  participant_id: string;
  atom_id: string;
  dimension: 'U' | 'X' | 'D' | 'P' | 'E';
  status: string;
}

// ─────────────────────────────────────────────────────────────────────
// dispute
// ─────────────────────────────────────────────────────────────────────

export interface DisputeResult {
  evidenceId: UUID;
  affectedAssessmentIds: UUID[];
}

export async function disputeEvidence(
  evidenceId: UUID,
  actorId: UUID,
  reason: string,
): Promise<DisputeResult> {
  if (!reason || reason.trim().length === 0) {
    throw new ValidationError('reason is required');
  }

  return transaction(async (client) => {
    const evRes = await client.query<EvidenceRow>(
      `SELECT id, participant_id, atom_id, dimension, status
         FROM passport_evidence WHERE id = $1
         FOR UPDATE`,
      [evidenceId],
    );
    const ev = evRes.rows[0];
    if (!ev) throw new NotFoundError('Evidence', evidenceId);

    if (!['submitted', 'accepted'].includes(ev.status)) {
      throw new ConflictError(
        `Evidence in status '${ev.status}' cannot be disputed`,
      );
    }

    // Права: subject (владелец) или assessor связанного assessment.
    const linkedRes = await client.query<{
      assessment_id: string;
      assessor_id: string;
      status: string;
    }>(
      `SELECT a.id AS assessment_id, a.assessor_id, a.status
         FROM passport_assessment_evidence ae
         JOIN passport_assessments a ON a.id = ae.assessment_id
        WHERE ae.evidence_id = $1`,
      [evidenceId],
    );

    const isSubject = ev.participant_id === actorId;
    const isAssessor = linkedRes.rows.some((r) => r.assessor_id === actorId);
    if (!isSubject && !isAssessor) {
      throw new ForbiddenError(
        'Only the subject or a linked assessor can dispute this evidence',
      );
    }

    await client.query(
      `UPDATE passport_evidence SET status = 'disputed' WHERE id = $1`,
      [evidenceId],
    );

    const affectedAssessmentIds: string[] = [];
    for (const r of linkedRes.rows) {
      if (['active', 'provisional', 'calibration_pending'].includes(r.status)) {
        await client.query(
          `UPDATE passport_assessments SET status = 'under_review' WHERE id = $1`,
          [r.assessment_id],
        );
        await client.query(
          `UPDATE person_atom_states
              SET status = 'under_review', updated_at = now()
            WHERE participant_id = $1 AND atom_id = $2 AND dimension = $3
              AND status = 'confirmed'`,
          [ev.participant_id, ev.atom_id, ev.dimension],
        );
        affectedAssessmentIds.push(r.assessment_id);
      }
    }

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'evidence_disputed', $3::jsonb, $4)`,
      [
        ev.participant_id,
        ev.atom_id,
        JSON.stringify({
          evidence_id: evidenceId,
          reason: reason.trim(),
          affected_assessment_ids: affectedAssessmentIds,
        }),
        actorId,
      ],
    );

    return { evidenceId, affectedAssessmentIds };
  });
}

// ─────────────────────────────────────────────────────────────────────
// resolve
// ─────────────────────────────────────────────────────────────────────

export interface ResolveDisputeResult {
  evidenceId: UUID;
  resolution: DisputeResolution;
}

export async function resolveDispute(
  evidenceId: UUID,
  actorId: UUID,
  resolution: DisputeResolution,
  note: string,
): Promise<ResolveDisputeResult> {
  if (!note || note.trim().length === 0) {
    throw new ValidationError('note is required');
  }
  if (!(await hasResolverRole(actorId))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT or VERIFIER can resolve disputes',
      { allowed_roles: [...RESOLVER_ROLE_NAMES] },
    );
  }

  return transaction(async (client) => {
    const evRes = await client.query<EvidenceRow>(
      `SELECT id, participant_id, atom_id, dimension, status
         FROM passport_evidence WHERE id = $1
         FOR UPDATE`,
      [evidenceId],
    );
    const ev = evRes.rows[0];
    if (!ev) throw new NotFoundError('Evidence', evidenceId);

    if (ev.status !== 'disputed') {
      throw new ConflictError(
        `Evidence in status '${ev.status}', expected 'disputed'`,
      );
    }

    await client.query(
      `UPDATE passport_evidence SET status = $2 WHERE id = $1`,
      [evidenceId, resolution],
    );

    let affectedAssessmentIds: string[] = [];

    if (resolution === 'invalidated') {
      const linkedRes = await client.query<{
        assessment_id: string;
        status: string;
      }>(
        `SELECT a.id AS assessment_id, a.status
           FROM passport_assessment_evidence ae
           JOIN passport_assessments a ON a.id = ae.assessment_id
          WHERE ae.evidence_id = $1`,
        [evidenceId],
      );
      for (const r of linkedRes.rows) {
        if (r.status === 'under_review') {
          await client.query(
            `INSERT INTO passport_history_events
               (participant_id, atom_id, event_type, payload, actor_id)
             VALUES ($1, $2, 'assessment_under_review', $3::jsonb, $4)`,
            [
              ev.participant_id,
              ev.atom_id,
              JSON.stringify({
                assessment_id: r.assessment_id,
                reason: 'evidence_invalidated',
                evidence_id: evidenceId,
              }),
              actorId,
            ],
          );
          affectedAssessmentIds.push(r.assessment_id);
        }
      }
    }

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'evidence_dispute_resolved', $3::jsonb, $4)`,
      [
        ev.participant_id,
        ev.atom_id,
        JSON.stringify({
          evidence_id: evidenceId,
          resolution,
          note: note.trim(),
          affected_assessment_ids: affectedAssessmentIds,
        }),
        actorId,
      ],
    );

    return { evidenceId, resolution };
  });
}

// ─────────────────────────────────────────────────────────────────────
// reuse (§7.3, A18) — кандидат для повторного использования.
// ─────────────────────────────────────────────────────────────────────

const REUSE_FORBIDDEN = ['disputed', 'invalidated', 'rejected', 'withdrawn'] as const;

export interface ReuseEvidenceInput {
  /** Целевой atom_id. Должен совпадать с источником (A18). */
  atomId?: string;
}

export interface ReuseEvidenceResult {
  candidateEvidenceId: UUID;
  requiresAssessment: true;
}

interface EvidenceFullRow {
  id: string;
  participant_id: string;
  atom_id: string;
  dimension: 'U' | 'X' | 'D' | 'P' | 'E';
  evidence_type: string;
  description: string;
  artifact_url: string | null;
  context: Record<string, unknown>;
  status: string;
}

export async function reuseEvidence(
  evidenceId: UUID,
  actorId: UUID,
  input: ReuseEvidenceInput = {},
): Promise<ReuseEvidenceResult> {
  return transaction(async (client) => {
    const evRes = await client.query<EvidenceFullRow>(
      `SELECT id, participant_id, atom_id, dimension, evidence_type,
              description, artifact_url, context, status
         FROM passport_evidence WHERE id = $1
         FOR UPDATE`,
      [evidenceId],
    );
    const ev = evRes.rows[0];
    if (!ev) throw new NotFoundError('Evidence', evidenceId);

    if (ev.participant_id !== actorId) {
      throw new ForbiddenError('Only the owner can reuse evidence');
    }
    if ((REUSE_FORBIDDEN as readonly string[]).includes(ev.status)) {
      throw new ConflictError(
        `Evidence in status '${ev.status}' cannot be reused`,
        { evidence_id: evidenceId, status: ev.status },
      );
    }

    const targetAtomId = input.atomId ?? ev.atom_id;
    if (targetAtomId !== ev.atom_id) {
      // A18: cross-atom reuse не поддерживается. Явный atomId == источник
      // разрешён (формально), явный чужой — 400.
      throw new ValidationError(
        `A18: cross-atom evidence reuse is not supported (source=${ev.atom_id}, target=${targetAtomId})`,
      );
    }

    // criteria_version — из карточки атома (не пересчитывается, §7.3).
    const atomRow = await client.query<{ version: string }>(
      `SELECT version FROM competency_atoms WHERE atom_id = $1`,
      [targetAtomId],
    );
    const criteriaVersion = atomRow.rows[0]?.version ?? 'unknown';

    const newId = newUUID();
    await client.query(
      `INSERT INTO passport_evidence
         (id, participant_id, atom_id, dimension, evidence_type,
          description, artifact_url, context, status, created_by,
          reused_from_evidence_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'submitted',$9,$10)`,
      [
        newId,
        actorId,
        targetAtomId,
        ev.dimension,
        ev.evidence_type,
        ev.description,
        ev.artifact_url,
        JSON.stringify({
          ...(ev.context ?? {}),
          reused_from: evidenceId,
          criteria_version: criteriaVersion,
        }),
        actorId,
        evidenceId,
      ],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'evidence_submitted', $3::jsonb, $4)`,
      [
        actorId,
        targetAtomId,
        JSON.stringify({
          evidence_id: newId,
          dimension: ev.dimension,
          evidence_type: ev.evidence_type,
          reused_from_evidence_id: evidenceId,
          criteria_version: criteriaVersion,
        }),
        actorId,
      ],
    );

    return { candidateEvidenceId: newId, requiresAssessment: true };
  });
}