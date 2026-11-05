// C.1.04.02 — Приватность и доступ к чужому паспорту (Фаза 1 + Фаза 2).
//
// Состав:
//   * Visibility CRUD (getVisibility*, setVisibility) — Фаза 1.
//   * Журнал доступа (recordAccess, listAccessLog) — Фаза 1.
//   * maskOverview — Фаза 1 (страховка от утечки summary).
//   * resolveScopeGrant — Фаза 2, матрица прав (mentor/assessor/task).
//   * Grants CRUD (createGrant / revokeGrant / listGrants) — Фаза 2.
//
// Матрица прав Фазы 2 (A13–A18, docs/passport-phase2.md):
//   self       → grant: 'self', visibility='full'
//   public     → visibility.public + consent
//   mentor     → participants.mentor_id = viewer ИЛИ активный грант(mentor)
//   assessor   → роль (FIRST_ARCHITECT|VERIFIER|OTC|COUNCIL_MEMBER) + consent
//                ИЛИ активный грант(assessor)
//   task       → активный грант(task, task_id) И tasks.assigned_to = viewer
//
// «Активный грант» = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
// Отзыв гранта = автоматический отзыв доступа (паспорт §18.2).
//
// Осознанные упрощения Фазы 2:
//   * mentor = participants.mentor_id (per-atom mentor из teaching_relations — Фаза 3).
//   * assessor = role + consent, без списка subject-специфичных проверяющих
//     (паспорт §7.4 требует независимости, но не утверждает «assign» роли
//     на конкретного subject — на Фазе 2 это не блокирует пилот).
//   * task = явный грант (паспорт §18.2) + membership в задаче.
//     Заказчика в tasks нет (только assigned_to), поэтому «противоположная
//     сторона» не вычисляется, а выдаётся subject'ом как согласие.

import { query, queryOne, transaction } from '../../lib/db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import type { UUID } from '../types.js';
import type {
  GrantScope,
  PassportOverview,
  ScopeGrant,
  ScopeGrantRow,
  VisibilityLevel,
  VisibilityScope,
  VisibilityState,
} from './types.js';

const SCOPES: readonly VisibilityScope[] = ['public', 'mentor', 'assessor', 'task'] as const;
const LEVELS: readonly VisibilityLevel[] = ['private', 'summary', 'levels', 'full'] as const;

export function isVisibilityScope(x: string): x is VisibilityScope {
  return (SCOPES as readonly string[]).includes(x);
}
export function isVisibilityLevel(x: string): x is VisibilityLevel {
  return (LEVELS as readonly string[]).includes(x);
}

// ─────────────────────────────────────────────────────────────────────
// Visibility CRUD (Фаза 1)
// ─────────────────────────────────────────────────────────────────────

interface VisibilityRowState {
  scope: VisibilityScope;
  visibility: VisibilityLevel;
  consent: boolean;
  updated_at: Date;
}

export async function getVisibilityAll(
  participantId: UUID,
): Promise<VisibilityState[]> {
  const rows = await query<VisibilityRowState>(
    `SELECT scope, visibility, consent, updated_at
       FROM passport_visibility WHERE participant_id = $1`,
    [participantId],
  );
  const byScope = new Map(rows.map((r) => [r.scope, r]));
  return SCOPES.map((s) => {
    const r = byScope.get(s);
    return {
      scope: s,
      visibility: r?.visibility ?? 'private',
      consent: r?.consent ?? false,
      updatedAt: (r?.updated_at ?? new Date(0)).toISOString(),
    };
  });
}

export async function getVisibility(
  participantId: UUID,
  scope: VisibilityScope,
): Promise<VisibilityState> {
  const r = await queryOne<VisibilityRowState>(
    `SELECT scope, visibility, consent, updated_at
       FROM passport_visibility WHERE participant_id = $1 AND scope = $2`,
    [participantId, scope],
  );
  if (!r) {
    return {
      scope,
      visibility: 'private',
      consent: false,
      updatedAt: new Date(0).toISOString(),
    };
  }
  return {
    scope: r.scope,
    visibility: r.visibility,
    consent: r.consent,
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface SetVisibilityInput {
  scope: VisibilityScope;
  visibility: VisibilityLevel;
  consent: boolean;
}

export async function setVisibility(
  participantId: UUID,
  actorId: UUID,
  input: SetVisibilityInput,
): Promise<void> {
  if (participantId !== actorId) {
    throw new ForbiddenError('Only the owner can change passport visibility');
  }
  if (!isVisibilityScope(input.scope)) {
    throw new ValidationError(`Unknown scope '${input.scope}'`);
  }
  if (!isVisibilityLevel(input.visibility)) {
    throw new ValidationError(`Unknown visibility level '${input.visibility}'`);
  }
  // consent=false + visibility=full бессмысленно — нормализуем в private.
  const effectiveVisibility: VisibilityLevel = input.consent ? input.visibility : 'private';

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO passport_visibility
         (participant_id, scope, visibility, consent, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (participant_id, scope) DO UPDATE
         SET visibility = EXCLUDED.visibility,
             consent    = EXCLUDED.consent,
             updated_at = now()`,
      [participantId, input.scope, effectiveVisibility, input.consent],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'visibility_changed', $2::jsonb, $3)`,
      [
        participantId,
        JSON.stringify({
          scope: input.scope,
          visibility: effectiveVisibility,
          consent: input.consent,
        }),
        actorId,
      ],
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// Журнал доступа (Фаза 1)
// ─────────────────────────────────────────────────────────────────────

export async function recordAccess(
  subjectId: UUID,
  viewerId: UUID | null,
  scope: string,
  reason: string,
): Promise<void> {
  await query(
    `INSERT INTO passport_access_log
       (participant_id, viewer_id, scope, reason)
     VALUES ($1, $2, $3, $4)`,
    [subjectId, viewerId, scope, reason],
  );
}

export async function listAccessLog(
  participantId: UUID,
  limit = 100,
  offset = 0,
): Promise<{
  items: Array<{
    id: UUID;
    viewerId: UUID | null;
    scope: string;
    reason: string | null;
    createdAt: string;
  }>;
  total: number;
}> {
  const totalRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM passport_access_log WHERE participant_id = $1`,
    [participantId],
  );
  const rows = await query<{
    id: string;
    viewer_id: string | null;
    scope: string;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, viewer_id, scope, reason, created_at
       FROM passport_access_log
      WHERE participant_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [participantId, limit, offset],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      viewerId: r.viewer_id,
      scope: r.scope,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    })),
    total: parseInt(totalRow?.total ?? '0', 10),
  };
}

// ─────────────────────────────────────────────────────────────────────
// maskOverview — страховка от утечки (Фаза 1)
// ─────────────────────────────────────────────────────────────────────

export function maskOverview(
  overview: PassportOverview,
  visibility: VisibilityLevel,
): PassportOverview | null {
  if (visibility === 'levels' || visibility === 'full') {
    return overview;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Матрица прав (Фаза 2)
// ─────────────────────────────────────────────────────────────────────

const ASSESSOR_ROLE_NAMES = [
  'FIRST_ARCHITECT', 'VERIFIER', 'OTC', 'COUNCIL_MEMBER',
] as const;

export async function viewerHasAssessorRole(viewerId: UUID): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [viewerId, [...ASSESSOR_ROLE_NAMES]],
  );
  return (row?.n ?? 0) > 0;
}

async function isMentor(subjectId: UUID, viewerId: UUID): Promise<boolean> {
  const row = await queryOne<{ mentor_id: string | null }>(
    `SELECT mentor_id FROM participants
      WHERE id = $1 AND deleted_at IS NULL`,
    [subjectId],
  );
  if (row?.mentor_id === viewerId) return true;
  // Per-atom (Фаза 3a): активная teaching_relation(mentor=viewer, mentee=subject).
  const perAtom = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM teaching_relations
      WHERE mentor_id = $1 AND mentee_id = $2 AND status = 'active'`,
    [viewerId, subjectId],
  );
  return (perAtom?.n ?? 0) > 0;
}

async function taskHasViewer(taskId: UUID, viewerId: UUID): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tasks
      WHERE id = $1 AND assigned_to = $2`,
    [taskId, viewerId],
  );
  return (row?.n ?? 0) > 0;
}

function toGrant(r: ScopeGrantRow): ScopeGrant {
  return {
    id: r.id,
    subjectId: r.subject_id,
    viewerId: r.viewer_id,
    scope: r.scope,
    taskId: r.task_id,
    reason: r.reason,
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

async function findActiveGrant(
  subjectId: UUID,
  viewerId: UUID,
  scope: GrantScope,
  taskId?: UUID,
): Promise<ScopeGrant | null> {
  const row = await queryOne<ScopeGrantRow>(
    `SELECT id, subject_id, viewer_id, scope, task_id, reason,
            expires_at, revoked_at, created_by, created_at
       FROM passport_scope_grants
      WHERE subject_id = $1
        AND viewer_id = $2
        AND scope = $3
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND ($4::uuid IS NULL OR task_id = $4)
      ORDER BY created_at DESC
      LIMIT 1`,
    [subjectId, viewerId, scope, taskId ?? null],
  );
  return row ? toGrant(row) : null;
}

export interface AccessDecision {
  granted: boolean;
  visibility: VisibilityLevel;
  reason: string;
  // reason ∈ 'self' | 'public:consent' | 'grant:mentor_id' | 'grant:explicit'
  //        | 'role+consent' | 'deny:no_relation' | 'deny:consent_required'
  //        | 'deny:task_not_found'
}

export async function resolveScopeGrant(
  subjectId: UUID,
  viewerId: UUID,
  scope: VisibilityScope,
  opts: { taskId?: UUID; teamId?: UUID } = {},
): Promise<AccessDecision> {
  if (subjectId === viewerId) {
    return { granted: true, visibility: 'full', reason: 'self' };
  }

  switch (scope) {
    case 'public': {
      const v = await getVisibility(subjectId, 'public');
      if (v.visibility === 'private' || v.visibility === 'summary') {
        return { granted: false, visibility: v.visibility, reason: 'deny:consent_required' };
      }
      if (!v.consent) {
        return { granted: false, visibility: v.visibility, reason: 'deny:consent_required' };
      }
      return { granted: true, visibility: v.visibility, reason: 'public:consent' };
    }

    case 'mentor': {
      if (await isMentor(subjectId, viewerId)) {
        return { granted: true, visibility: 'levels', reason: 'grant:mentor_id' };
      }
      const g = await findActiveGrant(subjectId, viewerId, 'mentor');
      if (g) return { granted: true, visibility: 'levels', reason: 'grant:explicit' };
      return { granted: false, visibility: 'private', reason: 'deny:no_relation' };
    }

    case 'assessor': {
      const [hasRole, v] = await Promise.all([
        viewerHasAssessorRole(viewerId),
        getVisibility(subjectId, 'assessor'),
      ]);
      const g = await findActiveGrant(subjectId, viewerId, 'assessor');
      if (g) return { granted: true, visibility: 'levels', reason: 'grant:explicit' };
      if (!hasRole) {
        return { granted: false, visibility: v.visibility, reason: 'deny:no_relation' };
      }
      if (!v.consent || v.visibility === 'private' || v.visibility === 'summary') {
        return { granted: false, visibility: v.visibility, reason: 'deny:consent_required' };
      }
      return { granted: true, visibility: v.visibility, reason: 'role+consent' };
    }

    case 'task': {
      if (!opts.taskId) {
        return { granted: false, visibility: 'private', reason: 'deny:task_not_found' };
      }
      const g = await findActiveGrant(subjectId, viewerId, 'task', opts.taskId);
      if (!g) {
        return { granted: false, visibility: 'private', reason: 'deny:no_relation' };
      }
      if (!(await taskHasViewer(opts.taskId, viewerId))) {
        return { granted: false, visibility: 'private', reason: 'deny:no_relation' };
      }
      return { granted: true, visibility: 'levels', reason: 'grant:explicit' };
    }
    case 'team': {
      if (!opts.teamId) {
        return {
          granted: false,
          visibility: 'private',
          reason: 'deny:team_not_found',
        };
      }

      const team = await queryOne<{
        participants: string[];
        assessor_id: string | null;
      }>(
        `SELECT participants, assessor_id
           FROM team_capabilities
          WHERE id = $1`,
        [opts.teamId],
      );
      if (!team) {
        return {
          granted: false,
          visibility: 'private',
          reason: 'deny:team_not_found',
        };
      }

      // N6: viewer ∈ participants OR viewer = assessor.
      const members = Array.isArray(team.participants) ? team.participants : [];
      if (members.includes(viewerId)) {
        return {
          granted: true,
          visibility: 'levels',
          reason: 'team_member',
        };
      }
      if (team.assessor_id === viewerId) {
        return {
          granted: true,
          visibility: 'levels',
          reason: 'team_assessor',
        };
      }
      return {
        granted: false,
        visibility: 'private',
        reason: 'deny:no_relation',
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Grants CRUD (Фаза 2). Создаёт только subject (A14 / B2).
// ─────────────────────────────────────────────────────────────────────

export interface CreateGrantParams {
  viewerId: UUID;
  scope: GrantScope;
  taskId?: UUID;
  expiresAt?: string;
  reason?: string;
}

export async function createGrant(
  subjectId: UUID,
  actorId: UUID,
  input: CreateGrantParams,
): Promise<ScopeGrant> {
  if (subjectId !== actorId) {
    throw new ForbiddenError('Only the owner can create grants');
  }
  if (subjectId === input.viewerId) {
    throw new ValidationError('Cannot grant access to self');
  }
  if (input.scope === 'task' && !input.taskId) {
    throw new ValidationError('scope=task requires task_id');
  }

  const viewer = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [input.viewerId],
  );
  if (!viewer) throw new NotFoundError('Participant (viewer)', input.viewerId);

  if (input.taskId) {
    const t = await queryOne<{ id: string }>(`SELECT id FROM tasks WHERE id = $1`, [input.taskId]);
    if (!t) throw new NotFoundError('Task', input.taskId);
  }

  const inserted = await queryOne<ScopeGrantRow>(
    `INSERT INTO passport_scope_grants
       (subject_id, viewer_id, scope, task_id, reason, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7)
     RETURNING id, subject_id, viewer_id, scope, task_id, reason,
               expires_at, revoked_at, created_by, created_at`,
    [
      subjectId, input.viewerId, input.scope, input.taskId ?? null,
      input.reason ?? null, input.expiresAt ?? null, actorId,
    ],
  );
  if (!inserted) throw new Error('createGrant: no row returned');

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'grant_created', $2::jsonb, $3)`,
      [
        subjectId,
        JSON.stringify({
          grant_id: inserted.id,
          viewer_id: input.viewerId,
          scope: input.scope,
          task_id: input.taskId ?? null,
        }),
        actorId,
      ],
    );
  });

  return toGrant(inserted);
}

export async function revokeGrant(
  grantId: UUID,
  actorId: UUID,
): Promise<void> {
  const row = await queryOne<ScopeGrantRow>(
    `SELECT id, subject_id, viewer_id, scope, task_id, reason,
            expires_at, revoked_at, created_by, created_at
       FROM passport_scope_grants WHERE id = $1`,
    [grantId],
  );
  if (!row) throw new NotFoundError('Scope grant', grantId);
  if (row.subject_id !== actorId) {
    throw new ForbiddenError('Only the subject can revoke a grant');
  }
  if (row.revoked_at) return;   // идемпотентно

  await transaction(async (client) => {
    await client.query(
      `UPDATE passport_scope_grants SET revoked_at = now() WHERE id = $1`,
      [grantId],
    );
    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'grant_revoked', $2::jsonb, $3)`,
      [row.subject_id, JSON.stringify({ grant_id: grantId, scope: row.scope }), actorId],
    );
  });
}

export async function listGrants(subjectId: UUID): Promise<ScopeGrant[]> {
  const rows = await query<ScopeGrantRow>(
    `SELECT id, subject_id, viewer_id, scope, task_id, reason,
            expires_at, revoked_at, created_by, created_at
       FROM passport_scope_grants
      WHERE subject_id = $1
      ORDER BY created_at DESC`,
    [subjectId],
  );
  return rows.map(toGrant);
}