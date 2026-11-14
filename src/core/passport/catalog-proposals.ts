// C.1.15.01 — Workflow предложений каталога (§16.1, каталог v0.4).
//
// Жизненный цикл:
//   draft → submitted → in_review → approved → merged
//                                  ↘ rejected (финальный)
//
// Права:
//   create + submit — любой авторизованный (автор)
//   in_review, approve, reject — FIRST_ARCHITECT | COUNCIL_MEMBER
//   merge — FIRST_ARCHITECT | COUNCIL_MEMBER
//
// merge:
//   new_atom      — INSERT competency_atoms; MAX(atom_id)+1 → CYB.ATOM.NNNN;
//                   проставляет atom_id в proposal (status='merged').
//                   CHECK в 064 разрешает это (atom_id IS NULL OR status='merged').
//   update_atom   — UPDATE competency_atoms (bump version, минор).
//   deprecate_atom— UPDATE competency_atoms SET status='deprecated'.
//
// History: catalog_proposal_created (create), catalog_proposal_merged (merge).
// Всё в одной транзакции, все проверки до INSERT/UPDATE.

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '../errors.js';
import type { UUID } from '../types.js';

import type {
  AtomCluster,
  CatalogProposal,
  CatalogProposalRow,
  CatalogProposalStatus,
  CatalogProposalType,
} from './types.js';

const REVIEWER_ROLES = ['FIRST_ARCHITECT', 'COUNCIL_MEMBER'] as const;

const ALLOWED_CLUSTERS: readonly AtomCluster[] = [
  'requirements_and_computational_thinking',
  'software_development',
  'data_and_databases',
  'server_interfaces_and_api',
  'testing_and_quality',
  'software_security',
  'infrastructure_and_operations',
];

const ALLOWED_CONTENT_RATES = ['permanent', 'slow', 'medium', 'fast', 'very_fast'];
const ALLOWED_DIMENSIONS = ['U', 'X', 'D', 'P', 'E'];
const ATOM_ID_RE = /^CYB\.ATOM\.\d{4}$/;

// ─────────────────────────────────────────────────────────────────────
// Роли
// ─────────────────────────────────────────────────────────────────────

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

async function atomExists(atomId: string): Promise<boolean> {
  const r = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms WHERE atom_id = $1`,
    [atomId],
  );
  return r !== null;
}

// ─────────────────────────────────────────────────────────────────────
// Валидация payload
// ─────────────────────────────────────────────────────────────────────

function validateDimensionApplicability(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('dimension_applicability must be object');
  }
  for (const d of Object.keys(value)) {
    if (!ALLOWED_DIMENSIONS.includes(d)) {
      throw new ValidationError(`dimension_applicability.${d} invalid`);
    }
  }
}

function validateFreshnessPolicy(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('freshness_policy must be object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.content_change_rate !== 'string' ||
      !ALLOWED_CONTENT_RATES.includes(v.content_change_rate)) {
    throw new ValidationError(
      'freshness_policy.content_change_rate must be permanent|slow|medium|fast|very_fast',
    );
  }
  if (typeof v.practice_review_policy !== 'string' || !v.practice_review_policy) {
    throw new ValidationError(
      'freshness_policy.practice_review_policy must be non-empty string',
    );
  }
}

function validateNewAtomPayload(payload: Record<string, unknown>): void {
  const required = [
    'cluster', 'name', 'definition',
    'boundary_includes', 'boundary_excludes',
    'assessment_criteria', 'assessment_methods',
    'dimension_applicability', 'freshness_policy', 'version',
  ];
  for (const f of required) {
    if (!(f in payload)) {
      throw new ValidationError(`new_atom payload missing required field: ${f}`);
    }
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    throw new ValidationError('name must be non-empty string');
  }
  if (typeof payload.definition !== 'string' || !payload.definition.trim()) {
    throw new ValidationError('definition must be non-empty string');
  }
  if (!Array.isArray(payload.boundary_includes)) {
    throw new ValidationError('boundary_includes must be array');
  }
  if (!Array.isArray(payload.boundary_excludes)) {
    throw new ValidationError('boundary_excludes must be array');
  }
  if (!Array.isArray(payload.assessment_methods)) {
    throw new ValidationError('assessment_methods must be array');
  }
  if (typeof payload.cluster !== 'string' ||
      !ALLOWED_CLUSTERS.includes(payload.cluster as AtomCluster)) {
    throw new ValidationError(`cluster must be one of ${ALLOWED_CLUSTERS.join('|')}`);
  }
  if (typeof payload.assessment_criteria !== 'object' || payload.assessment_criteria === null) {
    throw new ValidationError('assessment_criteria must be object');
  }
  validateDimensionApplicability(payload.dimension_applicability);
  validateFreshnessPolicy(payload.freshness_policy);
  if (typeof payload.version !== 'string' || !payload.version) {
    throw new ValidationError('version must be non-empty string');
  }
}

function validateUpdateAtomPayload(payload: Record<string, unknown>): void {
  const allowed = [
    'name', 'definition', 'boundary_includes', 'boundary_excludes',
    'context', 'input', 'outcome',
    'assessment_criteria', 'assessment_methods',
    'dimension_applicability', 'freshness_policy',
  ];
  const present = allowed.filter((f) => f in payload);
  if (present.length === 0) {
    throw new ValidationError('update_atom payload must change at least one field');
  }
  if ('dimension_applicability' in payload) {
    validateDimensionApplicability(payload.dimension_applicability);
  }
  if ('freshness_policy' in payload) {
    validateFreshnessPolicy(payload.freshness_policy);
  }
}

function validateDeprecateAtomPayload(payload: Record<string, unknown>): void {
  if (typeof payload.reason !== 'string' || !payload.reason.trim()) {
    throw new ValidationError('deprecate_atom payload.reason must be non-empty string');
  }
}

// ─────────────────────────────────────────────────────────────────────
// Маппинг
// ─────────────────────────────────────────────────────────────────────

function toProposal(r: CatalogProposalRow): CatalogProposal {
  return {
    id: r.id,
    proposalType: r.proposal_type,
    atomId: r.atom_id,
    payload: r.payload,
    status: r.status,
    reason: r.reason,
    reviewNote: r.review_note,
    createdBy: r.created_by,
    reviewedBy: r.reviewed_by,
    mergedBy: r.merged_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    mergedAt: r.merged_at ? r.merged_at.toISOString() : null,
  };
}

const SELECT_COLS = `
  id, proposal_type, atom_id, payload, status, reason, review_note,
  created_by, reviewed_by, merged_by, created_at, updated_at, merged_at
`;

// ─────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────

export interface CreateProposalInput {
  proposalType: CatalogProposalType;
  atomId?: string | null;
  payload: Record<string, unknown>;
}

export async function createProposal(
  actorId: UUID,
  input: CreateProposalInput,
): Promise<CatalogProposal> {
  if (input.proposalType === 'new_atom') {
    if (input.atomId) {
      throw new ValidationError('new_atom: atomId must be null');
    }
    validateNewAtomPayload(input.payload);
  } else if (input.proposalType === 'update_atom') {
    if (!input.atomId) {
      throw new ValidationError('update_atom: atomId required');
    }
    if (!ATOM_ID_RE.test(input.atomId)) {
      throw new ValidationError('atomId must match CYB.ATOM.NNNN');
    }
    if (!(await atomExists(input.atomId))) {
      throw new NotFoundError('Atom', input.atomId);
    }
    validateUpdateAtomPayload(input.payload);
  } else if (input.proposalType === 'deprecate_atom') {
    if (!input.atomId) {
      throw new ValidationError('deprecate_atom: atomId required');
    }
    if (!ATOM_ID_RE.test(input.atomId)) {
      throw new ValidationError('atomId must match CYB.ATOM.NNNN');
    }
    if (!(await atomExists(input.atomId))) {
      throw new NotFoundError('Atom', input.atomId);
    }
    validateDeprecateAtomPayload(input.payload);
  } else {
    throw new ValidationError(`unknown proposalType '${String(input.proposalType)}'`);
  }

  return transaction(async (client) => {
    const id = newUUID();
    const ins = await client.query<CatalogProposalRow>(
      `INSERT INTO catalog_proposals
         (id, proposal_type, atom_id, payload, status, created_by)
       VALUES ($1,$2,$3,$4::jsonb,'draft',$5)
       RETURNING ${SELECT_COLS}`,
      [id, input.proposalType, input.atomId ?? null,
       JSON.stringify(input.payload), actorId],
    );
    const row = ins.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'catalog_proposal_created', $3::jsonb, $1)`,
      [
        actorId,
        input.atomId ?? null,
        JSON.stringify({
          proposal_id: id,
          proposal_type: input.proposalType,
          atom_id: input.atomId ?? null,
        }),
      ],
    );

    return toProposal(row);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────

export interface ListProposalsFilter {
  status?: CatalogProposalStatus;
  atomId?: string;
  createdBy?: UUID;
  limit?: number;
}

export async function listProposals(
  filter: ListProposalsFilter = {},
): Promise<CatalogProposal[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    cond.push(`status = $${params.length}`);
  }
  if (filter.atomId) {
    params.push(filter.atomId);
    cond.push(`atom_id = $${params.length}`);
  }
  if (filter.createdBy) {
    params.push(filter.createdBy);
    cond.push(`created_by = $${params.length}`);
  }
  const where = cond.length > 0 ? `WHERE ${cond.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  params.push(limit);
  const rows = await query<CatalogProposalRow>(
    `SELECT ${SELECT_COLS}
       FROM catalog_proposals ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(toProposal);
}

export async function getProposal(
  id: UUID,
): Promise<CatalogProposal | null> {
  const row = await queryOne<CatalogProposalRow>(
    `SELECT ${SELECT_COLS} FROM catalog_proposals WHERE id = $1`,
    [id],
  );
  return row ? toProposal(row) : null;
}

// ─────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────

export interface SetProposalStatusInput {
  status: CatalogProposalStatus;
  reason?: string;
  reviewNote?: string;
}

const ALLOWED_TRANSITIONS: Record<CatalogProposalStatus, CatalogProposalStatus[]> = {
  draft: ['submitted', 'rejected'],
  submitted: ['in_review', 'rejected'],
  in_review: ['approved', 'rejected'],
  approved: ['rejected'],           // merged — только через mergeProposal
  rejected: [],                     // финальный
  merged: [],                       // финальный
};

export async function setProposalStatus(
  actorId: UUID,
  proposalId: UUID,
  input: SetProposalStatusInput,
): Promise<CatalogProposal> {
  return transaction(async (client) => {
    const cur = await client.query<CatalogProposalRow>(
      `SELECT ${SELECT_COLS} FROM catalog_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('Proposal', proposalId);}

    // Права:
    //   * → submitted / rejected: автор (draft) ИЛИ reviewer-роль.
    //   in_review / approved: только reviewer-роль.
    const isAuthor = row.created_by === actorId;
    const isReviewer = await hasAnyRole(actorId, REVIEWER_ROLES);

    const wantsReviewAction =
      input.status === 'in_review' || input.status === 'approved';

    if (wantsReviewAction && !isReviewer) {
      throw new ForbiddenError(
        `Only FIRST_ARCHITECT | COUNCIL_MEMBER can transition to '${input.status}'`,
        { allowed_roles: [...REVIEWER_ROLES] },
      );
    }
    if (input.status === 'submitted' && row.status === 'draft' && !isAuthor && !isReviewer) {
      throw new ForbiddenError(
        'Only the author (or reviewer role) can submit a draft',
      );
    }
    if (input.status === 'rejected' && !isReviewer) {
      throw new ForbiddenError(
        'Only FIRST_ARCHITECT | COUNCIL_MEMBER can reject a proposal',
      );
    }

    const allowed = ALLOWED_TRANSITIONS[row.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Transition '${row.status}' → '${input.status}' not allowed`,
        { allowed_from_current: allowed },
      );
    }

    if (input.status === 'rejected' && (!input.reason || !input.reason.trim())) {
      throw new ValidationError('reason is required for rejected status');
    }

    const reviewedBy =
      input.status === 'in_review' || input.status === 'approved' ||
      input.status === 'rejected'
        ? actorId
        : row.reviewed_by;

    const reviewNote =
      input.reviewNote !== undefined ? input.reviewNote : row.review_note;

    const upd = await client.query<CatalogProposalRow>(
      `UPDATE catalog_proposals
          SET status = $2,
              reason = COALESCE($3, reason),
              review_note = $4,
              reviewed_by = $5,
              updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLS}`,
      [
        proposalId,
        input.status,
        input.reason !== undefined ? input.reason.trim() : null,
        reviewNote,
        reviewedBy,
      ],
    );
    return toProposal(upd.rows[0]!);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Merge
// ─────────────────────────────────────────────────────────────────────

async function nextAtomId(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ max: string | null }> }>;
}): Promise<string> {
  // Advisory lock (освобождается в конце транзакции) — защита от race
  // при параллельных merge двух new_atom: иначе оба SELECT MAX
  // вернут одно и то же, второй INSERT упадёт на 23505 (PK).
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext('catalog_atoms_next_id')::bigint)`,
  );
  const r = await client.query(
    `SELECT MAX(atom_id) AS max FROM competency_atoms
      WHERE atom_id ~ '^CYB\\.ATOM\\.[0-9]{4}$'`,
  );
  const maxId = r.rows[0]?.max;
  if (!maxId) {return 'CYB.ATOM.0001';}
  const n = parseInt(maxId.slice('CYB.ATOM.'.length), 10);
  return `CYB.ATOM.${String(n + 1).padStart(4, '0')}`;
}

type BumpKind = 'major' | 'minor' | 'patch';

function bumpVersion(v: string, kind: BumpKind): string {
  // Non-semver ('abc', '0.1') → as-is.
  const parts = v.split('.');
  if (parts.length !== 3) {return v;}
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) {return v;}
  const [maj, min, pat] = nums as [number, number, number];
  if (kind === 'major') {return `${maj + 1}.0.0`;}
  if (kind === 'minor') {return `${maj}.${min + 1}.0`;}
  return `${maj}.${min}.${pat + 1}`;
}

function parseBumpKind(raw: unknown): BumpKind {
  if (raw === 'major' || raw === 'minor' || raw === 'patch') {return raw;}
  return 'minor';  // default: текущее поведение
}

export async function mergeProposal(
  actorId: UUID,
  proposalId: UUID,
): Promise<CatalogProposal> {
  if (!(await hasAnyRole(actorId, REVIEWER_ROLES))) {
    throw new ForbiddenError(
      'Only FIRST_ARCHITECT | COUNCIL_MEMBER can merge proposals',
      { allowed_roles: [...REVIEWER_ROLES] },
    );
  }

  return transaction(async (client) => {
    const cur = await client.query<CatalogProposalRow>(
      `SELECT ${SELECT_COLS} FROM catalog_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const row = cur.rows[0];
    if (!row) {throw new NotFoundError('Proposal', proposalId);}
    if (row.status !== 'approved') {
      throw new ConflictError(
        `Proposal status is '${row.status}', expected 'approved'`,
      );
    }

    let newAtomId: string | null = null;

    if (row.proposal_type === 'new_atom') {
      const p = row.payload;
      newAtomId = await nextAtomId(client);

      await client.query(
        `INSERT INTO competency_atoms
           (atom_id, cluster, name, definition,
            boundary_includes, boundary_excludes,
            context, input, outcome,
            assessment_criteria, assessment_methods,
            dimension_applicability, freshness_policy,
            translations, status, version)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,
                 $10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
                 '{}'::jsonb,'candidate',$14)`,
        [
          newAtomId,
          String(p.cluster),
          String(p.name),
          String(p.definition),
          JSON.stringify(p.boundary_includes ?? []),
          JSON.stringify(p.boundary_excludes ?? []),
          (p.context as string | null | undefined) ?? null,
          (p.input as string | null | undefined) ?? null,
          (p.outcome as string | null | undefined) ?? null,
          JSON.stringify(p.assessment_criteria ?? { status: 'draft' }),
          JSON.stringify(p.assessment_methods ?? []),
          JSON.stringify(p.dimension_applicability ?? {}),
          JSON.stringify(p.freshness_policy ?? {}),
          String(p.version ?? '0.1.0'),
        ],
      );
    } else if (row.proposal_type === 'update_atom') {
      if (!row.atom_id) {
        throw new ValidationError('update_atom: atom_id missing in proposal');
      }
      const atomRow = await client.query<{ version: string }>(
        `SELECT version FROM competency_atoms WHERE atom_id = $1 FOR UPDATE`,
        [row.atom_id],
      );
      const currentVersion = atomRow.rows[0]?.version ?? '0.1.0';
      const bumpKind = parseBumpKind(row.payload.bump);
      const newVersion = bumpVersion(currentVersion, bumpKind);

      const p = row.payload;
      await client.query(
        `UPDATE competency_atoms SET
           name = COALESCE($2, name),
           definition = COALESCE($3, definition),
           boundary_includes = COALESCE($4::jsonb, boundary_includes),
           boundary_excludes = COALESCE($5::jsonb, boundary_excludes),
           context = COALESCE($6, context),
           input = COALESCE($7, input),
           outcome = COALESCE($8, outcome),
           assessment_criteria = COALESCE($9::jsonb, assessment_criteria),
           assessment_methods = COALESCE($10::jsonb, assessment_methods),
           dimension_applicability = COALESCE($11::jsonb, dimension_applicability),
           freshness_policy = COALESCE($12::jsonb, freshness_policy),
           version = $13,
           updated_at = now()
         WHERE atom_id = $1`,
        [
          row.atom_id,
          p.name !== undefined ? String(p.name) : null,
          p.definition !== undefined ? String(p.definition) : null,
          p.boundary_includes !== undefined ? JSON.stringify(p.boundary_includes) : null,
          p.boundary_excludes !== undefined ? JSON.stringify(p.boundary_excludes) : null,
          p.context !== undefined ? (p.context as string | null) : null,
          p.input !== undefined ? (p.input as string | null) : null,
          p.outcome !== undefined ? (p.outcome as string | null) : null,
          p.assessment_criteria !== undefined ? JSON.stringify(p.assessment_criteria) : null,
          p.assessment_methods !== undefined ? JSON.stringify(p.assessment_methods) : null,
          p.dimension_applicability !== undefined ? JSON.stringify(p.dimension_applicability) : null,
          p.freshness_policy !== undefined ? JSON.stringify(p.freshness_policy) : null,
          newVersion,
        ],
      );
    } else if (row.proposal_type === 'deprecate_atom') {
      if (!row.atom_id) {
        throw new ValidationError('deprecate_atom: atom_id missing in proposal');
      }
      await client.query(
        `UPDATE competency_atoms
            SET status = 'deprecated', updated_at = now()
          WHERE atom_id = $1`,
        [row.atom_id],
      );
    } else {
      throw new ValidationError(`unknown proposal_type '${row.proposal_type}'`);
    }

    const upd = await client.query<CatalogProposalRow>(
      `UPDATE catalog_proposals
          SET status = 'merged',
              atom_id = COALESCE($2, atom_id),
              merged_by = $3,
              merged_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLS}`,
      [proposalId, newAtomId, actorId],
    );
    const merged = upd.rows[0]!;

    await client.query(
      `INSERT INTO passport_history_events
         (participant_id, atom_id, event_type, payload, actor_id)
       VALUES ($1, $2, 'catalog_proposal_merged', $3::jsonb, $1)`,
      [
        actorId,
        merged.atom_id,
        JSON.stringify({
          proposal_id: proposalId,
          proposal_type: row.proposal_type,
          merged_atom_id: merged.atom_id,
        }),
      ],
    );

    return toProposal(merged);
  });
}