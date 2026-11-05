// C.1.03.02 — Проекция: обзор (масштаб 1) и карточка атома (масштаб 3).
//
// width / depthExecution / depthUnderstanding / depthFull считаются
// раздельно (паспорт 6.6). Среднее пяти измерений не вычисляется нигде.
// calibration_pending_atoms — отдельное поле (см. план §3 A1).
//
// Никаких кэшей — 54 атома * 5 измерений = O(270) на запрос.
// Для Фазы 1 достаточно; материализация ProfileSummary — Фаза 2.

import { getStaleAssessments } from './freshness.js';
import { query, queryOne } from '../../lib/db.js';
import type { UUID } from '../types.js';
import type {
  AtomCard,
  AtomCluster,
  AssessmentItem,
  ClusterAggregate,
  CompetencyAtomRow,
  CountsByStatus,
  DevelopmentPathItem,
  Dimension,
  DimensionState,
  EvidenceItem,
  HistoryItem,
  PassportEvidenceRow,
  PassportAssessmentRow,
  PassportHistoryEventRow,
  PassportOverview,
  PersonAtomStateRow,
  VisibilityLevel,
} from './types.js';
import {
  DIMENSIONS,
  isDimensionApplicable,
  atomCountsForWidth,
  atomCountsForDepthExecution,
  atomCountsForDepthUnderstanding,
} from './types.js';
import { getAtomById, getRelationsForAtom } from './catalog.js';

// ─────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────

function emptyCounts(): CountsByStatus {
  return {
    notAssessed: 0,
    declared: 0,
    confirmed: 0,
    inProgress: 0,
    calibrationPending: 0,
    underReview: 0,
    disputed: 0,
    notApplicable: 0,
  };
}

async function getPublicVisibilityLevel(
  participantId: UUID,
): Promise<VisibilityLevel> {
  // В Фазе 1 (шаг 4) — просто читаем scope='public', дефолт 'private'.
  // Полная логика видимости — шаг 5.
  const row = await queryOne<{ visibility: VisibilityLevel }>(
    `SELECT visibility FROM passport_visibility
      WHERE participant_id = $1 AND scope = 'public'`,
    [participantId],
  );
  return row?.visibility ?? 'private';
}

async function getGoals(participantId: UUID): Promise<DevelopmentPathItem[]> {
  const rows = await query<{
    id: string;
    goal: string;
    target_profile_id: string | null;
    missing_atoms: Array<{
      atom_id: string;
      missing_dimensions: Dimension[];
      alternative_atom_ids?: string[];
    }>;
    status: DevelopmentPathItem['status'];
    created_at: Date;
  }>(
    `SELECT id, goal, target_profile_id, missing_atoms, status, created_at
       FROM development_paths
      WHERE participant_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
    [participantId],
  );

  const result: DevelopmentPathItem[] = [];

  for (const r of rows) {
    let targetProfileSlug: string | null = null;
    if (r.target_profile_id) {
      const p = await queryOne<{ slug: string }>(
        `SELECT slug FROM profession_profiles WHERE id = $1`,
        [r.target_profile_id],
      );
      targetProfileSlug = p?.slug ?? null;
    }

    const missingAtoms: DevelopmentPathItem['missingAtoms'] = [];
    for (const m of r.missing_atoms) {
      const a = await queryOne<{ name: string }>(
        `SELECT name FROM competency_atoms WHERE atom_id = $1`,
        [m.atom_id],
      );
      if (a) {
        missingAtoms.push({
          atomId: m.atom_id,
          atomName: a.name,
          missingDimensions: m.missing_dimensions,
          // ?? [] — толерантно к старым путям без поля (миграция не нужна,
          // JSONB).
          alternativeAtomIds: m.alternative_atom_ids ?? [],
        });
      }
    }

    result.push({
      id: r.id,
      goal: r.goal,
      targetProfileId: r.target_profile_id,
      targetProfileSlug,
      missingAtoms,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Обзор (масштаб 1)
// ─────────────────────────────────────────────────────────────────────

interface AtomRowMin {
  atom_id: string;
  cluster: AtomCluster;
  dimension_applicability: CompetencyAtomRow['dimension_applicability'];
  assessment_criteria: CompetencyAtomRow['assessment_criteria'];
}

export async function getOverview(participantId: UUID): Promise<PassportOverview> {
  const atoms = await query<AtomRowMin>(
    `SELECT atom_id, cluster, dimension_applicability, assessment_criteria
       FROM competency_atoms
      WHERE status <> 'deprecated'`,
  );

  const states = await query<PersonAtomStateRow>(
    `SELECT participant_id, atom_id, dimension, level, status, updated_at
       FROM person_atom_states
      WHERE participant_id = $1`,
    [participantId],
  );

  const statesByAtom = new Map<string, PersonAtomStateRow[]>();
  for (const s of states) {
    const arr = statesByAtom.get(s.atom_id) ?? [];
    arr.push(s);
    statesByAtom.set(s.atom_id, arr);
  }

  let width = 0;
  let depthExecution = 0;
  let depthUnderstanding = 0;
  let depthFull = 0;
  let calibrationPendingAtoms = 0;

  const counts = emptyCounts();
  const byCluster = new Map<AtomCluster, ClusterAggregate>();

  for (const atom of atoms) {
    const atomStates = statesByAtom.get(atom.atom_id) ?? [];
    const applicability = atom.dimension_applicability ?? {};
    const applicable = DIMENSIONS.filter((d) =>
      isDimensionApplicable(applicability, d),
    );

    const isWidth = atomCountsForWidth(atomStates, applicability);
    const isDepthExec = atomCountsForDepthExecution(atomStates, applicability);
    const isDepthUnd = atomCountsForDepthUnderstanding(atomStates, applicability);
    const isDepthFull = isDepthExec && isDepthUnd;

    if (isWidth) width++;
    if (isDepthExec) depthExecution++;
    if (isDepthUnd) depthUnderstanding++;
    if (isDepthFull) depthFull++;
    if (atom.assessment_criteria?.status !== 'approved') calibrationPendingAtoms++;

    let cluster = byCluster.get(atom.cluster);
    if (!cluster) {
      cluster = {
        cluster: atom.cluster,
        width: 0,
        depthExecution: 0,
        depthUnderstanding: 0,
        depthFull: 0,
        counts: emptyCounts(),
      };
      byCluster.set(atom.cluster, cluster);
    }
    if (isWidth) cluster.width++;
    if (isDepthExec) cluster.depthExecution++;
    if (isDepthUnd) cluster.depthUnderstanding++;
    if (isDepthFull) cluster.depthFull++;

    // Статус атома (агрегат по применимым измерениям):
    if (applicable.length === 0) {
      counts.notApplicable++;
      cluster.counts.notApplicable++;
      continue;
    }

    // Суженный union: 'inProgress' и 'notApplicable' в Фазе 1 не выставляются
    // (in_progress → оценка сразу 'confirmed', а not_applicable обработан
    // выше через early continue). Поля в CountsByStatus остаются для UI.
    type AtomStatusKey =
      | 'notAssessed'
      | 'declared'
      | 'confirmed'
      | 'calibrationPending'
      | 'underReview'
      | 'disputed';

    const statuses = applicable.map(
      (d) => atomStates.find((s) => s.dimension === d)?.status ?? 'not_assessed',
    );
    let atomStatus: AtomStatusKey = 'notAssessed';
    if (!statuses.every((s) => s === 'not_assessed')) {
      if (statuses.some((s) => s === 'under_review')) atomStatus = 'underReview';
      else if (statuses.some((s) => s === 'disputed')) atomStatus = 'disputed';
      else if (statuses.some((s) => s === 'confirmed')) atomStatus = 'confirmed';
      else if (statuses.some((s) => s === 'declared')) atomStatus = 'declared';
      else if (statuses.some((s) => s === 'calibration_pending')) {
        atomStatus = 'calibrationPending';
      }
    }

    counts[atomStatus]++;
    cluster.counts[atomStatus]++;
  }

  const goals = await getGoals(participantId);
  const visibility = await getPublicVisibilityLevel(participantId);
  const staleAssessments = await getStaleAssessments(participantId);

  return {
    participantId,
    visibility,
    width,
    depthExecution,
    depthUnderstanding,
    depthFull,
    byCluster: Array.from(byCluster.values()),
    counts,
    calibrationPendingAtoms,
    goals,
    staleAssessments,
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Карточка атома (масштаб 3)
// ─────────────────────────────────────────────────────────────────────

function toEvidenceItem(r: PassportEvidenceRow): EvidenceItem {
  return {
    id: r.id,
    atomId: r.atom_id,
    dimension: r.dimension,
    evidenceType: r.evidence_type,
    description: r.description,
    artifactUrl: r.artifact_url,
    context: r.context,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    reusedFromEvidenceId: r.reused_from_evidence_id ?? null,
  };
}

function toAssessmentItem(r: PassportAssessmentRow): AssessmentItem {
// current = active | under_review | provisional | calibration_pending.
// Исторические (superseded / invalidated / rejected) — isCurrent=false.
  const isCurrent =
    r.status === 'active' ||
    r.status === 'under_review' ||
    r.status === 'provisional' ||
    r.status === 'calibration_pending';
  return {
    id: r.id,
    atomId: r.atom_id,
    dimension: r.dimension,
    level: r.level,
    method: r.method,
    assessorId: r.assessor_id,
    context: r.context,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    isCurrent,
    criteriaVersion: r.criteria_version ?? null,
  };
}

function toHistoryItem(r: PassportHistoryEventRow): HistoryItem {
  return {
    id: r.id,
    atomId: r.atom_id,
    eventType: r.event_type,
    payload: r.payload,
    actorId: r.actor_id,
    createdAt: r.created_at.toISOString(),
  };
}

function buildDimensionStates(
  atom: CompetencyAtomRow,
  states: PersonAtomStateRow[],
): DimensionState[] {
  return DIMENSIONS.map((d) => {
    const applicable = isDimensionApplicable(
      atom.dimension_applicability,
      d,
    );
    const s = states.find((x) => x.dimension === d);
    if (!applicable) {
      return {
        dimension: d,
        level: null,
        status: 'not_applicable',
        updatedAt: s?.updated_at.toISOString() ?? new Date().toISOString(),
      };
    }
    if (!s) {
      return {
        dimension: d,
        level: null,
        status: 'not_assessed',
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      dimension: d,
      level: s.level,
      status: s.status,
      updatedAt: s.updated_at.toISOString(),
    };
  });
}

export async function getAtomCard(
  participantId: UUID,
  atomId: string,
): Promise<AtomCard | null> {
  const atom = await getAtomById(atomId);
  if (!atom) return null;

  const relations = await getRelationsForAtom(atomId);

  const states = await query<PersonAtomStateRow>(
    `SELECT participant_id, atom_id, dimension, level, status, updated_at
       FROM person_atom_states
      WHERE participant_id = $1 AND atom_id = $2`,
    [participantId, atomId],
  );

  const evidenceRows = await query<PassportEvidenceRow>(
    `SELECT id, participant_id, atom_id, dimension, evidence_type,
            description, artifact_url, context, status, created_by, created_at,
            reused_from_evidence_id
       FROM passport_evidence
      WHERE participant_id = $1 AND atom_id = $2
      ORDER BY created_at DESC`,
    [participantId, atomId],
  );

  const assessmentRows = await query<PassportAssessmentRow>(
    `SELECT id, participant_id, atom_id, dimension, level, method,
            assessor_id, context, status, created_at, criteria_version
       FROM passport_assessments
      WHERE participant_id = $1 AND atom_id = $2
        AND status IN (
          'active','under_review','provisional','calibration_pending',
          'superseded','invalidated','rejected'
         )
      ORDER BY created_at DESC`,
    [participantId, atomId],
  );

  const historyRows = await query<PassportHistoryEventRow>(
    `SELECT id, participant_id, atom_id, event_type, payload, actor_id, created_at
       FROM passport_history_events
      WHERE participant_id = $1 AND atom_id = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [participantId, atomId],
  );

  return {
    atom,
    relations,
    dimensions: buildDimensionStates(atom, states),
    evidence: evidenceRows.map(toEvidenceItem),
    assessments: assessmentRows.map(toAssessmentItem),
    history: historyRows.map(toHistoryItem),
  };
}