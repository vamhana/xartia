// C.1.10.01 — Matching (§11.2, Фаза 3a).
//
// A21: matching возвращает {status, gaps, checkedCount, coverage}.
// candidates — top-N по matches, без раскрытия уровней (только participantId
// + matches/gaps/status).
//
// Критичные dimension по роли (A21):
//   executor   → P
//   assessor   → E
//   designer   → D
//   consultant → U, X
//
// Агрегация:
//   match     — все required_atoms покрыты;
//   partial   — есть gaps, но все в не-критичных dimension;
//   no_match  — есть хотя бы один критичный gap.
//
// Правила проверки одного required_atom живут в requirement-evaluator.ts и
// едины для matchTask() и getCandidates() (§4.8 фазы 1). Здесь — только
// загрузка данных, permit-gap, агрегация статуса и сортировка.
// «Покрыто» = level >= min[dim] И status ∈ {confirmed, provisional};
// неприменимые (решено явно) измерения не проверяем, а нерешённая
// применимость — критичный gap `applicability_undetermined`.
//
// access_log: пополняется при чтении чужого паспорта (matching / candidates).
//
// v0.0.02: getCandidates — батчевый.
//   - 1 запрос участников (без LIMIT 200),
//   - 1 запрос competency_atoms,
//   - 1 запрос person_atom_states по всем (participants × atoms),
//   - 1 запрос participant_permits по всем участникам,
//   - агрегация match/partial/no_match — в памяти.
//   Раньше: N+1 (по applyProfile и checkPermitsGap на каждого участника).

import { query, queryOne } from '../../lib/db.js';
import { NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';

import { pickEffectiveValidUntil } from './permits.js';
import {
  evaluateRequiredAtom,
  type EvaluatorAtom,
  type EvaluatorState,
} from './requirement-evaluator.js';
import { getTaskProfile } from './task-profile.js';
import type {
  Dimension,
  MatchGap,
  MatchStatus,
  TaskCandidate,
  TaskMatching,
  TaskProfile,
} from './types.js';
import { recordAccess } from './visibility.js';

// ─────────────────────────────────────────────────────────────────────
// Проверка профиля для одного участника (правила — в requirement-evaluator)
// ─────────────────────────────────────────────────────────────────────

async function applyProfile(
  participantId: UUID,
  profile: TaskProfile,
): Promise<{ gaps: MatchGap[]; checkedCount: number }> {
  const atomIds = profile.requiredAtoms.map((a) => a.atom_id);

  const atoms = await query<EvaluatorAtom>(
    `SELECT atom_id, status, assessment_criteria, dimension_applicability
       FROM competency_atoms WHERE atom_id = ANY($1::text[])`,
    [atomIds],
  );
  const atomsById = new Map(atoms.map((a) => [a.atom_id, a]));

  const stateRows = await query<EvaluatorState & { atom_id: string }>(
    `SELECT atom_id, dimension, level, status
       FROM person_atom_states
      WHERE participant_id = $1 AND atom_id = ANY($2::text[])`,
    [participantId, atomIds],
  );
  const statesByAtom = new Map<string, Map<Dimension, EvaluatorState>>();
  for (const r of stateRows) {
    let m = statesByAtom.get(r.atom_id);
    if (!m) { m = new Map(); statesByAtom.set(r.atom_id, m); }
    m.set(r.dimension, { dimension: r.dimension, level: r.level, status: r.status });
  }

  const gaps: MatchGap[] = [];
  for (const req of profile.requiredAtoms) {
    const gap = evaluateRequiredAtom(
      req,
      atomsById.get(req.atom_id),
      statesByAtom.get(req.atom_id),
    );
    if (gap) {gaps.push(gap);}
  }

  return { gaps, checkedCount: profile.requiredAtoms.length };
}

function aggregateStatus(gaps: MatchGap[]): MatchStatus {
  if (gaps.length === 0) {return 'match';}
  if (gaps.some((g) => g.critical)) {return 'no_match';}
  return 'partial';
}

// ─────────────────────────────────────────────────────────────────────
// Публичное API: matching для одного участника
// ─────────────────────────────────────────────────────────────────────

export async function matchTask(
  taskId: UUID,
  participantId: UUID,
  viewerId: UUID,
): Promise<TaskMatching> {
  const profile = await getTaskProfile(taskId);
  if (!profile) {
    throw new NotFoundError('Task profile', taskId);
  }

  const subject = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!subject) {throw new NotFoundError('Participant', participantId);}

  const { gaps: atomGaps, checkedCount } = await applyProfile(participantId, profile);
  const permitGap = await checkPermitsGap(participantId, profile.permitIds);

  const gaps: MatchGap[] = permitGap ? [permitGap, ...atomGaps] : atomGaps;

  if (viewerId !== participantId) {
    await recordAccess(participantId, viewerId, 'task', 'matching');
  }

  const totalChecks = checkedCount + profile.permitIds.length;
  const passCount = totalChecks - gaps.length;

  return {
    taskId,
    participantId,
    status: aggregateStatus(gaps),
    gaps,
    checkedCount: totalChecks,
    coverage: totalChecks > 0 ? passCount / totalChecks : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Permit-gap (A38, A39) — одиночный, для matchTask
// ─────────────────────────────────────────────────────────────────────

async function checkPermitsGap(
  participantId: UUID,
  permitIds: string[],
): Promise<MatchGap | null> {
  if (permitIds.length === 0) {return null;}

  const rows = await query<{
    permit_id: string;
    status: string;
    valid_until: Date | null;
    permit_valid_until: Date | null;
  }>(
    `SELECT pp.permit_id, pp.status, pp.valid_until,
            p.valid_until AS permit_valid_until
       FROM participant_permits pp
       JOIN permits p ON p.permit_id = pp.permit_id
      WHERE pp.participant_id = $1 AND pp.permit_id = ANY($2::text[])
      ORDER BY pp.created_at DESC`,
    [participantId, permitIds],
  );

  const now = Date.now();

  const gapOf = (
    pid: string,
    permitStatus: 'absent' | 'expired' | 'revoked',
  ): MatchGap => ({
    atomId: null,
    permitId: pid,
    role: 'executor',
    missingDimensions: [],
    critical: true,
    reason: 'missing_permit',
    permitStatus,
  });

  for (const pid of permitIds) {
    const candidates = rows.filter((r) => r.permit_id === pid);

    // 1. Нет записи → absent.
    if (candidates.length === 0) {
      return gapOf(pid, 'absent');
    }

    // 2. Есть active — приоритет. Проверяем effective valid_until.
    const active = candidates.find((c) => c.status === 'active');
    if (active) {
      const effective = pickEffectiveValidUntil(
        active.valid_until,
        active.permit_valid_until,
      );
      if (effective !== null && effective.getTime() < now) {
        return gapOf(pid, 'expired');
      }
      // active и не истёк — permit покрыт.
      continue;
    }

    // 3. Нет active, но есть expired → expired.
    if (candidates.some((c) => c.status === 'expired')) {
      return gapOf(pid, 'expired');
    }

    // 4. Только revoked → revoked.
    return gapOf(pid, 'revoked');
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Кандидаты: top-N по matches, без уровней. Батчевая версия.
// ─────────────────────────────────────────────────────────────────────

export async function getCandidates(
  taskId: UUID,
  viewerId: UUID,
  limit = 20,
): Promise<TaskCandidate[]> {
  const profile = await getTaskProfile(taskId);
  if (!profile) {
    throw new NotFoundError('Task profile', taskId);
  }

  const safeLimit = Math.max(1, Math.min(limit, 100));

  // 1. Все активные участники с хотя бы одной оценкой — без LIMIT 200.
  const participants = await query<{
    id: string; external_id: string; name: string;
  }>(
    `SELECT p.id, p.external_id, p.name
       FROM participants p
      WHERE p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM person_atom_states s
           WHERE s.participant_id = p.id AND s.level IS NOT NULL
        )
      ORDER BY p.entered_at ASC`,
  );
  if (participants.length === 0) {return [];}

  const participantIds = participants.map((p) => p.id);
  const atomIds = profile.requiredAtoms.map((a) => a.atom_id);

  // 2. Применимость атомов — один запрос.
  const atoms = await query<EvaluatorAtom>(
    `SELECT atom_id, status, assessment_criteria, dimension_applicability
       FROM competency_atoms WHERE atom_id = ANY($1::text[])`,
    [atomIds],
  );
  const atomsById = new Map(atoms.map((a) => [a.atom_id, a]));

  // 3. Все состояния для (participants × atoms) — один запрос.
  const states = await query<{
    participant_id: string;
    atom_id: string;
    dimension: Dimension;
    level: number | null;
    status: string;
  }>(
    `SELECT participant_id, atom_id, dimension, level, status
       FROM person_atom_states
      WHERE participant_id = ANY($1::uuid[])
        AND atom_id = ANY($2::text[])`,
    [participantIds, atomIds],
  );
  const statesByKey = new Map<string, Map<Dimension, EvaluatorState>>();
  for (const s of states) {
    const key = `${s.participant_id}|${s.atom_id}`;
    let m = statesByKey.get(key);
    if (!m) { m = new Map(); statesByKey.set(key, m); }
    m.set(s.dimension, { dimension: s.dimension, level: s.level, status: s.status });
  }

  // 4. Permits — один запрос на всех.
  const permitIds = profile.permitIds;
  const permitGapsByParticipant = new Map<string, MatchGap | null>();
  if (permitIds.length > 0) {
    const rows = await query<{
      participant_id: string;
      permit_id: string;
      status: string;
      valid_until: Date | null;
      permit_valid_until: Date | null;
    }>(
      `SELECT pp.participant_id, pp.permit_id, pp.status, pp.valid_until,
              p.valid_until AS permit_valid_until
         FROM participant_permits pp
         JOIN permits p ON p.permit_id = pp.permit_id
        WHERE pp.participant_id = ANY($1::uuid[])
          AND pp.permit_id = ANY($2::text[])
        ORDER BY pp.created_at DESC`,
      [participantIds, permitIds],
    );
    const byParticipant = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byParticipant.get(r.participant_id) ?? [];
      list.push(r);
      byParticipant.set(r.participant_id, list);
    }
    const now = Date.now();
    for (const pid of participantIds) {
      const list = byParticipant.get(pid) ?? [];
      let gap: MatchGap | null = null;
      for (const permId of permitIds) {
        const candidates = list.filter((r) => r.permit_id === permId);
        if (candidates.length === 0) {
          gap = {
            atomId: null, permitId: permId, role: 'executor',
            missingDimensions: [], critical: true,
            reason: 'missing_permit', permitStatus: 'absent',
          };
          break;
        }
        const active = candidates.find((c) => c.status === 'active');
        if (active) {
          const eff = pickEffectiveValidUntil(active.valid_until, active.permit_valid_until);
          if (eff !== null && eff.getTime() < now) {
            gap = {
              atomId: null, permitId: permId, role: 'executor',
              missingDimensions: [], critical: true,
              reason: 'missing_permit', permitStatus: 'expired',
            };
            break;
          }
          continue;
        }
        if (candidates.some((c) => c.status === 'expired')) {
          gap = {
            atomId: null, permitId: permId, role: 'executor',
            missingDimensions: [], critical: true,
            reason: 'missing_permit', permitStatus: 'expired',
          };
        } else {
          gap = {
            atomId: null, permitId: permId, role: 'executor',
            missingDimensions: [], critical: true,
            reason: 'missing_permit', permitStatus: 'revoked',
          };
        }
        break;
      }
      permitGapsByParticipant.set(pid, gap);
    }
  }

  // 5. Считаем match/partial/no_match в памяти.
  const result: TaskCandidate[] = [];
  for (const p of participants) {
    const atomGaps: MatchGap[] = [];
    for (const req of profile.requiredAtoms) {
      const gap = evaluateRequiredAtom(
        req,
        atomsById.get(req.atom_id),
        statesByKey.get(`${p.id}|${req.atom_id}`),
      );
      if (gap) {atomGaps.push(gap);}
    }

    const permitGap = permitGapsByParticipant.get(p.id) ?? null;
    const allGaps = permitGap ? [permitGap, ...atomGaps] : atomGaps;
    const status = aggregateStatus(allGaps);
    if (status === 'no_match') {continue;}

    result.push({
      participantId: p.id as UUID,
      participantExternalId: p.external_id,
      participantName: p.name,
      matches: profile.requiredAtoms.length - atomGaps.length,
      gaps: allGaps.length,
      status,
    });
  }

  // 6. Сортировка и top-N.
  result.sort((a, b) => {
    const sa = a.status === 'match' ? 1 : 0;
    const sb = b.status === 'match' ? 1 : 0;
    if (sa !== sb) {return sb - sa;}
    if (a.matches !== b.matches) {return b.matches - a.matches;}
    return a.participantName.localeCompare(b.participantName);
  });
  const top = result.slice(0, safeLimit);

  // 7. access_log — по top-N.
  for (const c of top) {
    if (c.participantId !== viewerId) {
      await recordAccess(c.participantId, viewerId, 'task', 'candidates');
    }
  }

  return top;
}