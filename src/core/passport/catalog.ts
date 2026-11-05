// C.1.02.01 — Каталог атомов: read-only.
// Список, карточка атома (каталожная — без персонализации), связи.

import { query, queryOne } from '../../lib/db.js';
import type {
  AtomCluster,
  AtomStatus,
  CatalogItem,
  CatalogQuery,
  CompetencyAtomRow,
  AtomRelation,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Маппинг сырых строк
// ─────────────────────────────────────────────────────────────────────

interface AtomRowRaw {
  atom_id: string;
  cluster: AtomCluster;
  name: string;
  definition: string;
  boundary_includes: unknown;
  boundary_excludes: unknown;
  context: string | null;
  input: string | null;
  outcome: string | null;
  assessment_criteria: unknown;
  assessment_methods: unknown;
  dimension_applicability: unknown;
  freshness_policy: unknown;
  translations: unknown;
  status: AtomStatus;
  version: string;
  created_at: Date;
  updated_at: Date;
}

function toAtomRow(r: AtomRowRaw): CompetencyAtomRow {
  return {
    atom_id: r.atom_id,
    cluster: r.cluster,
    name: r.name,
    definition: r.definition,
    boundary_includes: (r.boundary_includes as string[]) ?? [],
    boundary_excludes: (r.boundary_excludes as string[]) ?? [],
    context: r.context,
    input: r.input,
    outcome: r.outcome,
    assessment_criteria:
      (r.assessment_criteria as CompetencyAtomRow['assessment_criteria']) ??
      { status: 'draft' },
    assessment_methods: (r.assessment_methods as string[]) ?? [],
    dimension_applicability:
      (r.dimension_applicability as CompetencyAtomRow['dimension_applicability']) ?? {},
    freshness_policy:
      (r.freshness_policy as CompetencyAtomRow['freshness_policy']) ??
      { content_change_rate: 'medium', practice_review_policy: 'to_calibrate' },
    translations: (r.translations as Record<string, unknown>) ?? {},
    status: r.status,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Публичное API
// ─────────────────────────────────────────────────────────────────────

export async function getCatalog(
  q: CatalogQuery,
): Promise<{ items: CatalogItem[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q.query && q.query.trim().length > 0) {
    params.push(`%${q.query.trim()}%`);
    conditions.push(
      `(atom_id ILIKE $${params.length} OR name ILIKE $${params.length} OR definition ILIKE $${params.length})`,
    );
  }
  if (q.cluster) {
    params.push(q.cluster);
    conditions.push(`cluster = $${params.length}`);
  }
  if (q.status) {
    params.push(q.status);
    conditions.push(`status = $${params.length}`);
  }
  if (q.direction !== undefined) {
    // Фильтр по направлению Хартии: атомы, у которых есть запись в
    // atom_direction_map (любая роль: home/main/related).
    params.push(q.direction);
    conditions.push(
      `atom_id IN (
         SELECT m.atom_id
           FROM atom_direction_map m
           JOIN directions d ON d.id = m.direction_id
          WHERE d.number = $${params.length}
       )`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);

  const totalRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM competency_atoms ${where}`,
    params,
  );

  params.push(limit, offset);
  const rows = await query<{
    atom_id: string;
    cluster: AtomCluster;
    name: string;
    definition: string;
    status: AtomStatus;
    version: string;
  }>(
    `SELECT atom_id, cluster, name, definition, status, version
       FROM competency_atoms ${where}
      ORDER BY atom_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    items: rows.map((r) => ({
      atomId: r.atom_id,
      cluster: r.cluster,
      name: r.name,
      definition: r.definition,
      status: r.status,
      version: r.version,
    })),
    total: parseInt(totalRow?.total ?? '0', 10),
  };
}

export async function getAtomById(
  atomId: string,
): Promise<CompetencyAtomRow | null> {
  const raw = await queryOne<AtomRowRaw>(
    `SELECT atom_id, cluster, name, definition,
            boundary_includes, boundary_excludes,
            context, input, outcome,
            assessment_criteria, assessment_methods,
            dimension_applicability, freshness_policy,
            translations, status, version,
            created_at, updated_at
       FROM competency_atoms
      WHERE atom_id = $1`,
    [atomId],
  );
  return raw ? toAtomRow(raw) : null;
}

interface RelationRaw {
  id: string;
  from_atom_id: string;
  to_atom_id: string;
  relation_type: AtomRelation['relationType'];
  note: string | null;
  created_at: Date;
}

export async function getRelationsForAtom(atomId: string): Promise<AtomRelation[]> {
  const rows = await query<RelationRaw>(
    `SELECT id, from_atom_id, to_atom_id, relation_type, note, created_at
       FROM competency_relations
      WHERE from_atom_id = $1 OR to_atom_id = $1
      ORDER BY from_atom_id, to_atom_id, relation_type`,
    [atomId],
  );
  return rows.map((r) => ({
    fromAtomId: r.from_atom_id,
    toAtomId: r.to_atom_id,
    relationType: r.relation_type,
    note: r.note,
  }));
}