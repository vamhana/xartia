// C.1.06.01 — Устаревание практики (§6.4.1, §7.5, A15).
//
// ВАЖНО (ревизия A15): считаем по `practice_review_policy`, а НЕ по
// `content_change_rate`. Это разные процессы (§6.4.1). `to_calibrate`
// → null (не помечаем stale). Конкретные P24M/P12M/P6M/P3M —
// только у пилотных атомов (0001, 0009, 0017, 0041), остальные —
// `to_calibrate`.
//
// Уровень не понижается (§7.5): stale — это метка, а не изменение
// person_atom_states.level. Проверяется в test-passport-v3.
//
// Формат `practice_review_policy`:
//   'to_calibrate' | 'P<n>M' (n месяцев) — на Фазе 2 больше не нужно.
// Будущее расширение (Фаза 3): PnD, PnY, event-driven policy.

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';

import type {
  CompetencyAtomRow,
  FreshnessPolicy,
  PassportAssessmentRow,
  StaleAssessment,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// computeStaleUntil
// ─────────────────────────────────────────────────────────────────────

const MONTH_MS = 30 * 24 * 60 * 60 * 1000; // приближение; не для юр. точности

export function computeStaleUntil(
  freshness: FreshnessPolicy | undefined,
  assessedAt: Date,
  now: Date = new Date(),
): { staleSince: Date | null; policy: string } {
  const policy = freshness?.practice_review_policy ?? 'to_calibrate';
  if (policy === 'to_calibrate') {
    return { staleSince: null, policy };
  }
  const m = /^P(\d+)M$/.exec(policy);
  if (!m) {
    return { staleSince: null, policy };
  }
  const months = Number(m[1]);
  if (!Number.isFinite(months) || months <= 0) {
    return { staleSince: null, policy };
  }
  const until = new Date(assessedAt.getTime() + months * MONTH_MS);
  // staleSince = момент, когда подтверждение стало stale (until).
  // Если until ещё в будущем — null (не stale).
  return { staleSince: until <= now ? until : null, policy };
}

// ─────────────────────────────────────────────────────────────────────
// getStaleAssessments
// ─────────────────────────────────────────────────────────────────────

export async function getStaleAssessments(
  participantId: UUID,
  now: Date = new Date(),
): Promise<StaleAssessment[]> {
  // Берём активные assessments + freshness_policy атома за один запрос.
  const rows = await query<
    Pick<PassportAssessmentRow, 'atom_id' | 'dimension' | 'assessor_id' | 'created_at'> & {
      freshness_policy: CompetencyAtomRow['freshness_policy'];
    }
  >(
    `SELECT a.atom_id, a.dimension, a.assessor_id, a.created_at,
            ca.freshness_policy
       FROM passport_assessments a
       JOIN competency_atoms ca ON ca.atom_id = a.atom_id
      WHERE a.participant_id = $1
        AND a.status = 'active'
      ORDER BY a.created_at ASC`,
    [participantId],
  );

  const out: StaleAssessment[] = [];
  for (const r of rows) {
    const { staleSince, policy } = computeStaleUntil(
      r.freshness_policy,
      r.created_at,
      now,
    );
    if (staleSince) {
      out.push({
        atomId: r.atom_id,
        dimension: r.dimension,
        assessorId: r.assessor_id,
        assessedAt: r.created_at.toISOString(),
        staleSince: staleSince.toISOString(),
        policy,
      });
    }
  }
  return out;
}