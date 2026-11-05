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
// «Покрыто» = для каждой применяемой dimension атома:
//   level >= min[dim] И status ∈ {confirmed, provisional}.
// Если dimension_applicability[dim].applicable = false, измерение не проверяем.
//
// access_log: пополняется при чтении чужого паспорта (matching / candidates).

import { query, queryOne } from '../../lib/db.js';
import { NotFoundError } from '../errors.js';
import type { UUID } from '../types.js';
import { recordAccess } from './visibility.js';
import type {
  Dimension,
  MatchGap,
  MatchStatus,
  RequiredAtom,
  TaskCandidate,
  TaskMatching,
  TaskProfile,
  TaskProfileRole,
} from './types.js';
import {
  DIMENSIONS, isDimensionApplicable,
} from './types.js';
import { getTaskProfile } from './task-profile.js';
import { pickEffectiveValidUntil } from './permits.js';

// ─────────────────────────────────────────────────────────────────────
// Роли → критические измерения
// ─────────────────────────────────────────────────────────────────────

const ROLE_CRITICAL: Record<TaskProfileRole, Dimension[]> = {
  executor: ['P'],
  assessor: ['E'],
  designer: ['D'],
  consultant: ['U', 'X'],
};

// ─────────────────────────────────────────────────────────────────────
// Проверка одного required_atom
// ─────────────────────────────────────────────────────────────────────

interface AtomApplicabilityRow {
  atom_id: string;
  dimension_applicability: Record<string, { applicable?: boolean }>;
}

interface StateRow {
  dimension: Dimension;
  level: number | null;
  status: string;
}

function isCovered(state: StateRow | undefined, minLevel: number): boolean {
  if (!state) return false;
  if (state.status !== 'confirmed' && state.status !== 'provisional') return false;
  if (state.level === null) return false;
  return state.level >= minLevel;
}

async function checkRequiredAtom(
  participantId: UUID,
  req: RequiredAtom,
  applicability: AtomApplicabilityRow,
): Promise<MatchGap | null> {
  const states = await query<StateRow>(
    `SELECT dimension, level, status
       FROM person_atom_states
      WHERE participant_id = $1 AND atom_id = $2`,
    [participantId, req.atom_id],
  );
  const byDim = new Map(states.map((s) => [s.dimension, s]));
  const app = applicability.dimension_applicability as Parameters<
    typeof isDimensionApplicable
  >[0];

  const missingDimensions: Dimension[] = [];

  for (const [dim, minLevel] of Object.entries(req.min) as Array<
    [Dimension, number]
  >) {
    if (!isDimensionApplicable(app, dim)) continue;
    if (!isCovered(byDim.get(dim), minLevel)) {
      missingDimensions.push(dim);
    }
  }

  if (missingDimensions.length === 0) return null;

  const criticalDims = ROLE_CRITICAL[req.role];
  const critical = missingDimensions.some((d) => criticalDims.includes(d));

  return {
    atomId: req.atom_id,
    role: req.role,
    missingDimensions,
    critical,
    reason: 'missing_dimensions',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Проверка participant vs TaskProfile
// ─────────────────────────────────────────────────────────────────────

async function applyProfile(
  participantId: UUID,
  profile: TaskProfile,
): Promise<{ gaps: MatchGap[]; checkedCount: number }> {
  const atomIds = profile.requiredAtoms.map((a) => a.atom_id);

  const atoms = await query<AtomApplicabilityRow>(
    `SELECT atom_id, dimension_applicability
       FROM competency_atoms WHERE atom_id = ANY($1::text[])`,
    [atomIds],
  );
  const atomsById = new Map(atoms.map((a) => [a.atom_id, a]));

  const gaps: MatchGap[] = [];
  for (const req of profile.requiredAtoms) {
    const atom = atomsById.get(req.atom_id);
    if (!atom) {
      // Профиль ссылается на неизвестный атом — не должен случаться
      // после валидации, но защищаемся.
      gaps.push({
        atomId: req.atom_id,
        role: req.role,
        missingDimensions: [...DIMENSIONS],
        critical: true,
        reason: 'missing_dimensions',
      });
      continue;
    }
    const gap = await checkRequiredAtom(participantId, req, atom);
    if (gap) gaps.push(gap);
  }

  return { gaps, checkedCount: profile.requiredAtoms.length };
}

function aggregateStatus(gaps: MatchGap[]): MatchStatus {
  if (gaps.length === 0) return 'match';
  if (gaps.some((g) => g.critical)) return 'no_match';
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
  if (!subject) throw new NotFoundError('Participant', participantId);

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
// Permit-gap (A38, A39)
// ─────────────────────────────────────────────────────────────────────

async function checkPermitsGap(
  participantId: UUID,
  permitIds: string[],
): Promise<MatchGap | null> {
  if (permitIds.length === 0) return null;

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
// Кандидаты: top-N по matches, без уровней
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

  // Берём активных участников, у которых есть хоть какая-то оценка
  // (любая запись в person_atom_states с level IS NOT NULL).
  const participants = await query<{
    id: string;
    external_id: string;
    name: string;
  }>(
    `SELECT p.id, p.external_id, p.name
       FROM participants p
      WHERE p.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM person_atom_states s
           WHERE s.participant_id = p.id
             AND s.level IS NOT NULL
        )
      ORDER BY p.entered_at ASC
      LIMIT 200`,
  );

  // Считаем для каждого.
  const result: TaskCandidate[] = [];
  for (const p of participants) {
    const { gaps: atomGaps } = await applyProfile(p.id, profile);
    const permitGap = await checkPermitsGap(p.id, profile.permitIds);
    const allGaps = permitGap ? [permitGap, ...atomGaps] : atomGaps;
    const status = aggregateStatus(allGaps);
    // Кандидаты — только без критичных gaps (A21). permitGap всегда
    // critical → no_match, кандидат в top-N не попадает.
    if (status === 'no_match') continue;
    result.push({
      participantId: p.id,
      participantExternalId: p.external_id,
      participantName: p.name,
      matches: profile.requiredAtoms.length - atomGaps.length,
      gaps: allGaps.length,
      status,
    });
  }

  // Сортировка: match → partial, внутри — по matches desc, по имени.
  result.sort((a, b) => {
    const sa = a.status === 'match' ? 1 : 0;
    const sb = b.status === 'match' ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if (a.matches !== b.matches) return b.matches - a.matches;
    return a.participantName.localeCompare(b.participantName);
  });

  const top = result.slice(0, safeLimit);

  // access_log: запись по каждому кандидату (viewer смотрит чужой паспорт
  // в контексте задачи, §18.2).
  for (const c of top) {
    if (c.participantId !== viewerId) {
      await recordAccess(c.participantId, viewerId, 'task', 'candidates');
    }
  }

  return top;
}