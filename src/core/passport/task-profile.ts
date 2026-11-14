// C.1.08.01 — TaskProfile (§11.1, Фаза 3a).
//
// Требования к задаче через атомы: required_atoms с ролями и минимумами
// по измерениям. tasks.required_competencies (legacy JSONB) не трогаем.
//
// Правила (A19, A26, A31, A32):
//   * Создаёт: FIRST_ARCHITECT | COUNCIL_MEMBER | OTC.
//   * PATCH: создатель профиля ИЛИ FIRST_ARCHITECT.
//   * Один профиль на задачу (task_id UNIQUE). Повторный POST → 409.
//   * version++ при PATCH; history append-only (триггер 060).
//   * permit_ids принимаем как string[], но не валидируем (Permit — 3b).
//
// event_type в passport_history_events:
//   'task_profile_created' / 'task_profile_updated'.

import { queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import type {
  Dimension,
  RequiredAtom,
  TaskProfile,
  TaskProfileRow,
  TaskProfileRole,
  TaskProfileStatus,
} from './types.js';
import { DIMENSIONS, isValidLevel } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Роли
// ─────────────────────────────────────────────────────────────────────

const PROFILE_AUTHOR_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER', 'OTC'] as const;

async function hasProfileAuthorRole(participantId: UUID): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM participant_roles pr
       JOIN roles r ON r.id = pr.role_id
      WHERE pr.participant_id = $1
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
        AND r.name = ANY($2::text[])`,
    [participantId, [...PROFILE_AUTHOR_ROLES]],
  );
  return (row?.n ?? 0) > 0;
}

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toTaskProfile(r: TaskProfileRow): TaskProfile {
  return {
    id: r.id,
    taskId: r.task_id,
    requiredAtoms: r.required_atoms,
    permitIds: r.permit_ids,
    acceptanceCriteria: r.acceptance_criteria,
    evidenceForm: r.evidence_form,
    securityConstraints: r.security_constraints,
    version: r.version,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Валидация required_atoms
// ─────────────────────────────────────────────────────────────────────

const VALID_ROLES: readonly TaskProfileRole[] = [
  'executor', 'designer', 'consultant', 'assessor',
] as const;

async function validateRequiredAtoms(
  items: unknown,
): Promise<RequiredAtom[]> {
  if (!Array.isArray(items)) {
    throw new ValidationError('required_atoms must be an array');
  }
  const out: RequiredAtom[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      throw new ValidationError('required_atoms[*] must be an object');
    }
    const r = raw as Record<string, unknown>;

    const atomId = typeof r.atom_id === 'string' ? r.atom_id : null;
    if (!atomId || !/^CYB\.ATOM\.\d{4}$/.test(atomId)) {
      throw new ValidationError(
        `required_atoms[*].atom_id must match CYB.ATOM.NNNN (got ${String(r.atom_id)})`,
      );
    }
    if (seen.has(atomId)) {
      throw new ValidationError(`duplicate atom_id ${atomId} in required_atoms`);
    }
    seen.add(atomId);

    const role = r.role as TaskProfileRole;
    if (!VALID_ROLES.includes(role)) {
      throw new ValidationError(
        `required_atoms[${atomId}].role must be one of ${VALID_ROLES.join('|')}`,
      );
    }

    if (!r.min || typeof r.min !== 'object' || Array.isArray(r.min)) {
      throw new ValidationError(`required_atoms[${atomId}].min must be object`);
    }
    const min: Partial<Record<Dimension, number>> = {};
    for (const [k, v] of Object.entries(r.min as Record<string, unknown>)) {
      if (!(DIMENSIONS as readonly string[]).includes(k)) {
        throw new ValidationError(
          `required_atoms[${atomId}].min.${k} is not a valid dimension`,
        );
      }
      if (!isValidLevel(v)) {
        throw new ValidationError(
          `required_atoms[${atomId}].min.${k} must be integer 0..9`,
        );
      }
      min[k as Dimension] = v;
    }
    if (Object.keys(min).length === 0) {
      throw new ValidationError(
        `required_atoms[${atomId}].min must have at least one dimension`,
      );
    }

    out.push({ atom_id: atomId, min, role });
  }

  if (out.length === 0) {
    throw new ValidationError('required_atoms must have at least one entry');
  }

  // Проверяем существование атомов одним запросом.
  const ids = out.map((x) => x.atom_id);
  const existing = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM competency_atoms WHERE atom_id = ANY($1::text[])`,
    [ids],
  );
  if ((existing?.n ?? 0) !== ids.length) {
    throw new ValidationError('required_atoms contains unknown atom_id(s)');
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Чтение
// ─────────────────────────────────────────────────────────────────────

interface TaskProfileRaw {
  id: string;
  task_id: string;
  required_atoms: RequiredAtom[];
  permit_ids: string[];
  acceptance_criteria: Record<string, unknown> | null;
  evidence_form: Record<string, unknown> | null;
  security_constraints: Record<string, unknown> | null;
  version: number;
  status: TaskProfileStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export async function getTaskProfile(
  taskId: UUID,
): Promise<TaskProfile | null> {
  const row = await queryOne<TaskProfileRaw>(
    `SELECT id, task_id, required_atoms, permit_ids,
            acceptance_criteria, evidence_form, security_constraints,
            version, status, created_by, created_at, updated_at
       FROM task_profiles WHERE task_id = $1`,
    [taskId],
  );
  return row
    ? toTaskProfile({
        ...row,
        required_atoms: row.required_atoms ?? [],
        permit_ids: row.permit_ids ?? [],
      } as TaskProfileRow)
    : null;
}

// ─────────────────────────────────────────────────────────────────────
// Создание
// ─────────────────────────────────────────────────────────────────────

export interface CreateTaskProfileInput {
  requiredAtoms: unknown;
  permitIds?: string[];
  acceptanceCriteria?: Record<string, unknown> | null;
  evidenceForm?: Record<string, unknown> | null;
  securityConstraints?: Record<string, unknown> | null;
}

export async function createTaskProfile(
  taskId: UUID,
  actorId: UUID,
  input: CreateTaskProfileInput,
): Promise<TaskProfile> {
  if (!(await hasProfileAuthorRole(actorId))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER | OTC can create task profiles',
      { allowed_roles: [...PROFILE_AUTHOR_ROLES] },
    );
  }

  const taskExists = await queryOne<{ id: string }>(
    `SELECT id FROM tasks WHERE id = $1`,
    [taskId],
  );
  if (!taskExists) {
    throw new NotFoundError('Task', taskId);
  }

  const requiredAtoms = await validateRequiredAtoms(input.requiredAtoms);

  if (input.permitIds !== undefined && !Array.isArray(input.permitIds)) {
    throw new ValidationError('permitIds must be an array');
  }
  const permitIds = input.permitIds ?? [];
  if (permitIds.length > 0) {
    const existing = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM permits
        WHERE permit_id = ANY($1::text[]) AND status = 'active'`,
      [permitIds],
    );
    if ((existing?.n ?? 0) !== permitIds.length) {
      throw new ValidationError(
        'permitIds contains unknown or inactive permit_id(s)',
        permitIds.map((p) => ({ path: 'permitIds', message: `permit ${p} not active` })),
      );
    }
  }

  return transaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM task_profiles WHERE task_id = $1 FOR UPDATE`,
      [taskId],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError('Task already has a profile', { task_id: taskId });
    }

    const id = newUUID();
    const ins = await client.query<TaskProfileRaw>(
      `INSERT INTO task_profiles
         (id, task_id, required_atoms, permit_ids,
          acceptance_criteria, evidence_form, security_constraints,
          version, status, created_by)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,
               1,'active',$8)
       RETURNING id, task_id, required_atoms, permit_ids,
                 acceptance_criteria, evidence_form, security_constraints,
                 version, status, created_by, created_at, updated_at`,
      [
        id,
        taskId,
        JSON.stringify(requiredAtoms),
        JSON.stringify(permitIds),
        input.acceptanceCriteria !== undefined && input.acceptanceCriteria !== null
          ? JSON.stringify(input.acceptanceCriteria) : null,
        input.evidenceForm !== undefined && input.evidenceForm !== null
          ? JSON.stringify(input.evidenceForm) : null,
        input.securityConstraints !== undefined && input.securityConstraints !== null
          ? JSON.stringify(input.securityConstraints) : null,
        actorId,
      ],
    );
    const row = ins.rows[0]!;

    // history (append-only)
    await client.query(
      `INSERT INTO task_profiles_history
         (task_profile_id, version, snapshot, actor_id)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [row.id, 1, JSON.stringify(row), actorId],
    );

    // passport_history_events
    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'task_profile_created', $2::jsonb, $3)`,
      [
        actorId,
        JSON.stringify({ task_id: taskId, task_profile_id: row.id, version: 1 }),
        actorId,
      ],
    );

    return toTaskProfile(row);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Обновление (PATCH)
// ─────────────────────────────────────────────────────────────────────

export interface UpdateTaskProfileInput {
  requiredAtoms?: unknown;
  permitIds?: string[];
  acceptanceCriteria?: Record<string, unknown> | null;
  evidenceForm?: Record<string, unknown> | null;
  securityConstraints?: Record<string, unknown> | null;
  status?: TaskProfileStatus;
}

const VALID_STATUS: readonly TaskProfileStatus[] = ['draft', 'active', 'deprecated'];

export async function updateTaskProfile(
  taskId: UUID,
  actorId: UUID,
  input: UpdateTaskProfileInput,
): Promise<TaskProfile> {
  const current = await queryOne<TaskProfileRaw>(
    `SELECT id, task_id, required_atoms, permit_ids,
            acceptance_criteria, evidence_form, security_constraints,
            version, status, created_by, created_at, updated_at
       FROM task_profiles WHERE task_id = $1`,
    [taskId],
  );
  if (!current) {
    throw new NotFoundError('Task profile', taskId);
  }

  if (current.created_by !== actorId && !(await hasProfileAuthorRole(actorId))) {
    // Автор профиля может редактировать свой; иначе — только роли автора.
    throw new ForbiddenError(
      'Only the profile author or FIRST_ARCHITECT | COUNCIL_MEMBER | OTC can update',
    );
  }

  let requiredAtoms = current.required_atoms;
  if (input.requiredAtoms !== undefined) {
    requiredAtoms = await validateRequiredAtoms(input.requiredAtoms);
  }
  if (input.permitIds !== undefined && !Array.isArray(input.permitIds)) {
    throw new ValidationError('permitIds must be an array');
  }
  if (input.permitIds !== undefined && input.permitIds.length > 0) {
    const existing = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM permits
        WHERE permit_id = ANY($1::text[]) AND status = 'active'`,
      [input.permitIds],
    );
    if ((existing?.n ?? 0) !== input.permitIds.length) {
      throw new ValidationError('permitIds contains unknown or inactive permit_id(s)');
    }
  }
  if (input.status !== undefined && !VALID_STATUS.includes(input.status)) {
    throw new ValidationError(`status must be one of ${VALID_STATUS.join('|')}`);
  }

  const permitIds = input.permitIds ?? current.permit_ids;
  const acceptanceCriteria =
    input.acceptanceCriteria !== undefined
      ? input.acceptanceCriteria
      : current.acceptance_criteria;
  const evidenceForm =
    input.evidenceForm !== undefined ? input.evidenceForm : current.evidence_form;
  const securityConstraints =
    input.securityConstraints !== undefined
      ? input.securityConstraints
      : current.security_constraints;
  const status = input.status ?? current.status;

  return transaction(async (client) => {
    const nextVersion = current.version + 1;
    const upd = await client.query<TaskProfileRaw>(
      `UPDATE task_profiles
          SET required_atoms = $2::jsonb,
              permit_ids = $3::jsonb,
              acceptance_criteria = $4::jsonb,
              evidence_form = $5::jsonb,
              security_constraints = $6::jsonb,
              status = $7,
              version = $8,
              updated_at = now()
        WHERE task_id = $1
        RETURNING id, task_id, required_atoms, permit_ids,
                  acceptance_criteria, evidence_form, security_constraints,
                  version, status, created_by, created_at, updated_at`,
      [
        taskId,
        JSON.stringify(requiredAtoms),
        JSON.stringify(permitIds),
        acceptanceCriteria !== null ? JSON.stringify(acceptanceCriteria) : null,
        evidenceForm !== null ? JSON.stringify(evidenceForm) : null,
        securityConstraints !== null ? JSON.stringify(securityConstraints) : null,
        status,
        nextVersion,
      ],
    );
    const row = upd.rows[0]!;

    await client.query(
      `INSERT INTO task_profiles_history
         (task_profile_id, version, snapshot, actor_id)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [row.id, nextVersion, JSON.stringify(row), actorId],
    );

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, NULL, 'task_profile_updated', $2::jsonb, $3)`,
      [
        actorId,
        JSON.stringify({
          task_id: taskId,
          task_profile_id: row.id,
          version: nextVersion,
        }),
        actorId,
      ],
    );

    return toTaskProfile(row);
  });
}