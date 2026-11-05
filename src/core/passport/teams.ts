// C.1.12.01 — TeamCapability (§11.4, Фаза 3c).
//
// A47: participants JSONB; assessor_id ∉ participants — триггер в БД +
//      API-валидация с понятной ошибкой (403).
// A48: создание — FA|COUNCIL|OTC; оценка — FA|VERIFIER.
// A56: criteria_scores — {[k]: number 0..9}, ключи ⊆ criteria.
// A57: payload team_assessed.
// A59: TeamCapability не входит в width/depth индивидуального паспорта.
//
// TeamCapability — отдельная сущность, не атом и не сводится к сумме
// индивидуальных оценок (§11.4).

import { query, queryOne, transaction } from '../../lib/db.js';
import {
  ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import { newUUID } from '../../lib/id.js';
import type { UUID } from '../types.js';
import type {
  AssessTeamInput,
  CreateTeamInput,
  TeamCapability,
  TeamCapabilityAssessment,
  TeamCapabilityAssessmentRow,
  TeamCapabilityRow,
  
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Роли
// ─────────────────────────────────────────────────────────────────────

const TEAM_CREATOR_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER', 'OTC'] as const;
const TEAM_ASSESSOR_ROLES = ['FIRST_ARCHITECT', 'VERIFIER'] as const;

async function hasAnyRole(
  participantId: UUID,
  roleNames: readonly string[],
): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...roleNames]],
  );
  return (row?.n ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toTeam(r: TeamCapabilityRow): TeamCapability {
  return {
    id: r.id,
    name: r.name,
    expectedResult: r.expected_result,
    participants: r.participants,
    criteria: r.criteria,
    assessorId: r.assessor_id,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toAssessment(r: TeamCapabilityAssessmentRow): TeamCapabilityAssessment {
  return {
    id: r.id,
    teamId: r.team_id,
    level: r.level,
    criteriaScores: r.criteria_scores,
    context: r.context,
    assessorId: r.assessor_id,
    assessedAt: r.assessed_at.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Валидация
// ─────────────────────────────────────────────────────────────────────

async function validateParticipants(participants: UUID[]): Promise<void> {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new ValidationError('participants must have at least 2 entries');
  }
  const unique = new Set(participants);
  if (unique.size !== participants.length) {
    throw new ValidationError('participants must not contain duplicates');
  }
  for (const p of participants) {
    if (typeof p !== 'string' || p.length === 0) {
      throw new ValidationError('participants must be non-empty UUID strings');
    }
  }
  const existing = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participants
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [participants],
  );
  if ((existing?.n ?? 0) !== participants.length) {
    throw new ValidationError(
      'participants contains unknown or deleted participant id(s)',
    );
  }
}

function validateCriteria(
  criteria: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
  if (criteria === undefined) return {};
  if (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria)) {
    throw new ValidationError('criteria must be an object');
  }
  for (const [k, v] of Object.entries(criteria)) {
    if (typeof k !== 'string' || k.length === 0) {
      throw new ValidationError('criteria keys must be non-empty strings');
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new ValidationError(`criteria.${k} must be an object`);
    }
  }
  return criteria;
}

function validateLevel(level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new ValidationError('level must be an integer 0..9');
  }
}

function validateCriteriaScores(
  scores: Record<string, number>,
  criteria: Record<string, unknown>,
): void {
  if (typeof scores !== 'object' || scores === null || Array.isArray(scores)) {
    throw new ValidationError('criteriaScores must be an object');
  }
  const allowed = new Set(Object.keys(criteria));
  for (const [k, v] of Object.entries(scores)) {
    if (allowed.size > 0 && !allowed.has(k)) {
      throw new ValidationError(
        `criteriaScores.${k} is not in criteria (allowed: ${[...allowed].join(', ')})`,
      );
    }
    if (!Number.isInteger(v) || v < 0 || v > 9) {
      throw new ValidationError(`criteriaScores.${k} must be an integer 0..9`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────

export async function createTeam(
  actorId: UUID,
  input: CreateTeamInput,
): Promise<TeamCapability> {
  if (!(await hasAnyRole(actorId, TEAM_CREATOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER | OTC can create teams',
      { allowed_roles: [...TEAM_CREATOR_ROLES] },
    );
  }
  if (!input.name || input.name.trim().length === 0) {
    throw new ValidationError('name must not be empty');
  }
  if (!input.expectedResult || input.expectedResult.trim().length === 0) {
    throw new ValidationError('expectedResult must not be empty');
  }
  await validateParticipants(input.participants);
  const criteria = validateCriteria(input.criteria);

  return transaction(async (client) => {
    const id = newUUID();
    const ins = await client.query<TeamCapabilityRow>(
      `INSERT INTO team_capabilities
         (id, name, expected_result, participants, criteria,
          status, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'draft',$6)
       RETURNING id, name, expected_result, participants, criteria,
                 assessor_id, status, created_by, created_at, updated_at`,
      [
        id,
        input.name.trim(),
        input.expectedResult.trim(),
        JSON.stringify(input.participants),
        JSON.stringify(criteria),
        actorId,
      ],
    );
    return toTeam(ins.rows[0]!);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────

export async function getTeam(teamId: UUID): Promise<TeamCapability | null> {
  const row = await queryOne<TeamCapabilityRow>(
    `SELECT id, name, expected_result, participants, criteria,
            assessor_id, status, created_by, created_at, updated_at
       FROM team_capabilities WHERE id = $1`,
    [teamId],
  );
  return row ? toTeam(row) : null;
}

/**
 * N7: список команд, где viewer ∈ participants ИЛИ viewer = assessor.
 */
export async function listTeamsForViewer(
  viewerId: UUID,
): Promise<TeamCapability[]> {
  const rows = await query<TeamCapabilityRow>(
    `SELECT id, name, expected_result, participants, criteria,
            assessor_id, status, created_by, created_at, updated_at
       FROM team_capabilities
      WHERE participants @> $1::jsonb
         OR assessor_id = $2
         OR created_by = $2
      ORDER BY created_at DESC`,
    [JSON.stringify([viewerId]), viewerId],
  );
  return rows.map(toTeam);
}

// ─────────────────────────────────────────────────────────────────────
// Assess
// ─────────────────────────────────────────────────────────────────────

export async function assessTeam(
  actorId: UUID,
  input: AssessTeamInput,
): Promise<TeamCapabilityAssessment> {
  if (!(await hasAnyRole(actorId, TEAM_ASSESSOR_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | VERIFIER can assess teams',
      { allowed_roles: [...TEAM_ASSESSOR_ROLES] },
    );
  }
  validateLevel(input.level);

  return transaction(async (client) => {
    const teamRes = await client.query<TeamCapabilityRow>(
      `SELECT id, name, expected_result, participants, criteria,
              assessor_id, status, created_by, created_at, updated_at
         FROM team_capabilities
        WHERE id = $1
        FOR UPDATE`,
      [input.teamId],
    );
    const team = teamRes.rows[0];
    if (!team) {
      throw new NotFoundError('Team', input.teamId);
    }

    // A47/A48: assessor ∉ participants. Триггер в БД тоже, но здесь — 403
    // с понятным сообщением (не 500).
    if (team.participants.includes(actorId)) {
      throw new ForbiddenError(
        'Assessor cannot be a member of the team',
        { team_id: input.teamId },
      );
    }

    validateCriteriaScores(input.criteriaScores, team.criteria);

    const id = newUUID();
    const ins = await client.query<TeamCapabilityAssessmentRow>(
      `INSERT INTO team_capability_assessments
         (id, team_id, level, criteria_scores, context, assessor_id)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)
       RETURNING id, team_id, level, criteria_scores, context,
                 assessor_id, assessed_at`,
      [
        id,
        input.teamId,
        input.level,
        JSON.stringify(input.criteriaScores),
        JSON.stringify(input.context ?? {}),
        actorId,
      ],
    );
    const row = ins.rows[0]!;

    // Статус: draft/active → assessed (идемпотентно для assessed).
    await client.query(
      `UPDATE team_capabilities
          SET status = 'assessed',
              assessor_id = $2,
              updated_at = now()
        WHERE id = $1
          AND status IN ('draft','active')`,
      [input.teamId, actorId],
    );

    // A57: payload.
    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'team_assessed', $2::jsonb, $1)`,
      [
        actorId,
        JSON.stringify({
          team_id: input.teamId,
          assessment_id: id,
          level: input.level,
          assessor_id: actorId,
          criteria_scores: input.criteriaScores,
        }),
      ],
    );

    return toAssessment(row);
  });
}

// ─────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────

export async function getTeamHistory(
  teamId: UUID,
): Promise<TeamCapabilityAssessment[]> {
  const rows = await query<TeamCapabilityAssessmentRow>(
    `SELECT id, team_id, level, criteria_scores, context,
            assessor_id, assessed_at
       FROM team_capability_assessments
      WHERE team_id = $1
      ORDER BY assessed_at DESC`,
    [teamId],
  );
  return rows.map(toAssessment);
}

// ─────────────────────────────────────────────────────────────────────
// Update (техдолг 3c, A64)
// ─────────────────────────────────────────────────────────────────────

export interface UpdateTeamInput {
  name?: string;
  expectedResult?: string;
  participants?: UUID[];
  criteria?: Record<string, Record<string, unknown>>;
}

export async function updateTeam(
  teamId: UUID,
  actorId: UUID,
  input: UpdateTeamInput,
): Promise<TeamCapability> {
  return transaction(async (client) => {
    const cur = await client.query<TeamCapabilityRow>(
      `SELECT id, name, expected_result, participants, criteria,
              assessor_id, status, created_by, created_at, updated_at
         FROM team_capabilities
        WHERE id = $1
        FOR UPDATE`,
      [teamId],
    );
    const team = cur.rows[0];
    if (!team) throw new NotFoundError('Team', teamId);

    // Права: created_by ИЛИ любая из TEAM_CREATOR_ROLES.
    const isAuthor = team.created_by === actorId;
    const isAdminRole = await hasAnyRole(actorId, TEAM_CREATOR_ROLES);
    if (!isAuthor && !isAdminRole) {
      throw new ForbiddenError(
        'Only the author or FIRST_ARCHITECT | COUNCIL_MEMBER | OTC can update',
      );
    }

    if (input.name !== undefined && (!input.name || input.name.trim().length === 0)) {
      throw new ValidationError('name must not be empty');
    }
    if (input.expectedResult !== undefined && (!input.expectedResult || input.expectedResult.trim().length === 0)) {
      throw new ValidationError('expectedResult must not be empty');
    }
    if (input.participants !== undefined) {
      await validateParticipants(input.participants);
      // Страховка перед триггером: если assessor_id ∈ новые participants,
      // даём понятный 422 (иначе триггер вернёт 500).
      if (team.assessor_id && input.participants.includes(team.assessor_id)) {
        throw new ValidationError(
          'participants must not contain the current assessor_id; first change/reassign assessor',
          [{ path: 'participants', message: 'assessor_id present in participants' }],
        );
      }
    }
    const criteria =
      input.criteria !== undefined ? validateCriteria(input.criteria) : team.criteria;

    const upd = await client.query<TeamCapabilityRow>(
      `UPDATE team_capabilities
          SET name = $2,
              expected_result = $3,
              participants = $4::jsonb,
              criteria = $5::jsonb,
              updated_at = now()
        WHERE id = $1
        RETURNING id, name, expected_result, participants, criteria,
                  assessor_id, status, created_by, created_at, updated_at`,
      [
        teamId,
        input.name !== undefined ? input.name.trim() : team.name,
        input.expectedResult !== undefined ? input.expectedResult.trim() : team.expected_result,
        JSON.stringify(input.participants ?? team.participants),
        JSON.stringify(criteria),
      ],
    );
    return toTeam(upd.rows[0]!);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Status: deprecated (техдолг 3c, A75)
// ─────────────────────────────────────────────────────────────────────

export async function deprecateTeam(
  teamId: UUID,
  actorId: UUID,
  reason?: string,
): Promise<TeamCapability> {
  return transaction(async (client) => {
    const cur = await client.query<TeamCapabilityRow>(
      `SELECT id, name, expected_result, participants, criteria,
              assessor_id, status, created_by, created_at, updated_at
         FROM team_capabilities
        WHERE id = $1
        FOR UPDATE`,
      [teamId],
    );
    const team = cur.rows[0];
    if (!team) throw new NotFoundError('Team', teamId);

    // Права: created_by | FA | COUNCIL_MEMBER | OTC.
    const isAuthor = team.created_by === actorId;
    const isAdminRole = await hasAnyRole(actorId, TEAM_CREATOR_ROLES);
    if (!isAuthor && !isAdminRole) {
      throw new ForbiddenError(
        'Only the author or FIRST_ARCHITECT | COUNCIL_MEMBER | OTC can deprecate',
      );
    }

    if (team.status === 'deprecated') {
      // Идемпотентно.
      return toTeam(team);
    }

    const upd = await client.query<TeamCapabilityRow>(
      `UPDATE team_capabilities
          SET status = 'deprecated', updated_at = now()
        WHERE id = $1
        RETURNING id, name, expected_result, participants, criteria,
                  assessor_id, status, created_by, created_at, updated_at`,
      [teamId],
    );
    const updated = upd.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'team_deprecated', $2::jsonb, $1)`,
      [
        actorId,
        JSON.stringify({
          team_id: teamId,
          reason: reason?.trim() ?? null,
          previous_status: team.status,
        }),
      ],
    );

    return toTeam(updated);
  });
}