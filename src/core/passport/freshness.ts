// C.1.06.01 — Устаревание практики (§6.4.1, §7.5, A15; фаза 1, §4.10).
//
// Считаем по `practice_review_policy`, а НЕ по `content_change_rate`.
// Это разные процессы (§6.4.1).
//
// Формат `practice_review_policy`: 'to_calibrate' | 'P<n>M' (n календарных
// месяцев, UTC). Вся чистая логика живёт в freshness-policy.ts (без БД,
// покрыта unit-тестами); здесь остаётся только доступ к данным.
//
// Уровень не понижается (§7.5): stale — это метка, а не изменение
// person_atom_states.level. Проверяется в test-passport-v3.
//
// `to_calibrate`, отсутствующая или неизвестная политика не считаются
// «свежим» подтверждением: см. evaluateFreshness (состояние `unverified`).
// В staleAssessments попадают только состояния `stale`; `unverified`
// используется Matching (этап 2 плана фазы 1).

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';

import { evaluateFreshness } from './freshness-policy.js';
import type {
  CompetencyAtomRow,
  PassportAssessmentRow,
  StaleAssessment,
} from './types.js';

export {
  addCalendarMonthsUTC,
  computeStaleUntil,
  evaluateFreshness,
} from './freshness-policy.js';
export type {
  FreshnessState,
  FreshnessUnverifiedReason,
} from './freshness-policy.js';

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
    const f = evaluateFreshness(r.freshness_policy, r.created_at, now);
    if (f.state === 'stale') {
      out.push({
        atomId: r.atom_id,
        dimension: r.dimension,
        assessorId: r.assessor_id,
        assessedAt: r.created_at.toISOString(),
        staleSince: f.staleSince.toISOString(),
        policy: f.policy,
      });
    }
  }
  return out;
}
