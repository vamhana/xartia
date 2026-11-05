// C.1.14.01 — Граф паспорта (Фаза 3d, §8.4).
//
// Возвращает узлы (54 атома) + рёбра (133 связи) + метаданные для viewer'а:
// dimensions (U/X/D/P/E), directions (home/main/related), width/depth-флаги.
//
// Один запрос на узлы-атомы + один на directions + один на states +
// один на рёбра. Для 54 узлов — O(270) строк, приемлемо.

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';
import type {
  AtomCluster,
  AtomDirection,
  AtomDirections,
  AtomDirectionRole,
  CompetencyAtomRow,
  GraphEdge,
  GraphNode,
  GraphNodeDimension,
  GraphPayload,
  PersonAtomStateRow,
  RelationType,
} from './types.js';
import {
  DIMENSIONS,
  atomCountsForDepthExecution,
  atomCountsForDepthUnderstanding,
  atomCountsForWidth,
  isDimensionApplicable,
} from './types.js';

export interface GraphOptions {
  /** Фильтр по кластеру. */
  cluster?: AtomCluster;
  /** Фильтр по направлению Хартии (number 1..17). */
  direction?: number;
  /** Фильтр по статусу viewer'а: только с оценкой / только без. */
  filter?: 'all' | 'assessed' | 'not_assessed';
}

// ─────────────────────────────────────────────────────────────────────
// Batch для directions
// ─────────────────────────────────────────────────────────────────────

interface DirectionBatchRow {
  atom_id: string;
  direction_id: string;
  direction_number: number;
  direction_name: string;
  role: AtomDirectionRole;
  note: string | null;
}

async function getDirectionsByAtomBatch(
  atomIds: string[],
): Promise<Map<string, AtomDirections>> {
  const map = new Map<string, AtomDirections>();
  for (const id of atomIds) {
    map.set(id, { home: null, main: null, related: [] });
  }
  if (atomIds.length === 0) return map;

  const rows = await query<DirectionBatchRow>(
    `SELECT m.atom_id,
            d.id AS direction_id,
            d.number AS direction_number,
            d.name AS direction_name,
            m.role,
            m.note
       FROM atom_direction_map m
       JOIN directions d ON d.id = m.direction_id
      WHERE m.atom_id = ANY($1::text[])
      ORDER BY m.atom_id, m.role, d.number`,
    [atomIds],
  );

  for (const r of rows) {
    const entry = map.get(r.atom_id);
    if (!entry) continue;
    const item: AtomDirection = {
      directionId: r.direction_id,
      directionNumber: r.direction_number,
      directionName: r.direction_name,
      role: r.role,
      note: r.note,
    };
    if (r.role === 'home') entry.home = item;
    else if (r.role === 'main') entry.main = item;
    else entry.related.push(item);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────
// getGraph
// ─────────────────────────────────────────────────────────────────────

export async function getGraph(
  viewerId: UUID,
  opts: GraphOptions = {},
): Promise<GraphPayload> {
  // 1. Узлы: 54 атома с фильтром по кластеру/направлению.
  const cond: string[] = [`status <> 'deprecated'`];   // deprecated — вне обзора
  const params: unknown[] = [];

  if (opts.cluster) {
    params.push(opts.cluster);
    cond.push(`cluster = $${params.length}`);
  }
  if (opts.direction !== undefined) {
    params.push(opts.direction);
    cond.push(
      `atom_id IN (
         SELECT m.atom_id FROM atom_direction_map m
           JOIN directions d ON d.id = m.direction_id
          WHERE d.number = $${params.length}
       )`,
    );
  }

  const where = `WHERE ${cond.join(' AND ')}`;

  const atoms = await query<
    Pick<CompetencyAtomRow, 'atom_id' | 'name' | 'cluster' | 'dimension_applicability'>
  >(
    `SELECT atom_id, name, cluster, dimension_applicability
       FROM competency_atoms ${where}
      ORDER BY atom_id`,
    params,
  );

  const atomIds = atoms.map((a) => a.atom_id);

  if (atomIds.length === 0) {
    return {
      nodes: [],
      edges: [],
      meta: {
        totalNodes: 0,
        totalEdges: 0,
        filter: {
          cluster: opts.cluster ?? null,
          direction: opts.direction ?? null,
          status: opts.filter ?? 'all',
        },
      },
    };
  }

  // 2. Directions (batch).
  const directionsByAtom = await getDirectionsByAtomBatch(atomIds);

  // 3. States viewer'а (batch).
  const states = await query<PersonAtomStateRow>(
    `SELECT participant_id, atom_id, dimension, level, status, updated_at
       FROM person_atom_states
      WHERE participant_id = $1 AND atom_id = ANY($2::text[])`,
    [viewerId, atomIds],
  );
  const statesByAtom = new Map<string, PersonAtomStateRow[]>();
  for (const s of states) {
    const arr = statesByAtom.get(s.atom_id) ?? [];
    arr.push(s);
    statesByAtom.set(s.atom_id, arr);
  }

  // 4. Строим узлы.
  const nodes: GraphNode[] = [];
  for (const atom of atoms) {
    const atomStates = statesByAtom.get(atom.atom_id) ?? [];
    const applicability = atom.dimension_applicability ?? {};
    const applicable = DIMENSIONS.filter((d) => isDimensionApplicable(applicability, d));

    const dimensions: GraphNodeDimension[] = DIMENSIONS.map((d) => {
      const s = atomStates.find((x) => x.dimension === d);
      if (!isDimensionApplicable(applicability, d)) {
        return {
          dimension: d,
          level: null,
          status: 'not_applicable',
        };
      }
      if (!s) {
        return {
          dimension: d,
          level: null,
          status: 'not_assessed',
        };
      }
      return {
        dimension: d,
        level: s.level,
        status: s.status,
      };
    });

    const isWidth = atomCountsForWidth(atomStates, applicability);
    const isDepthExecution = atomCountsForDepthExecution(atomStates, applicability);
    const isDepthUnderstanding = atomCountsForDepthUnderstanding(
      atomStates,
      applicability,
    );
    const isDepthFull = isDepthExecution && isDepthUnderstanding;

    // Фильтр по статусу viewer'а.
    if (opts.filter === 'assessed') {
      const hasConfirmed = applicable.some((d) => {
        const s = atomStates.find((x) => x.dimension === d);
        return s?.status === 'confirmed';
      });
      if (!hasConfirmed) continue;
    } else if (opts.filter === 'not_assessed') {
      const anyAssessed = applicable.some((d) => {
        const s = atomStates.find((x) => x.dimension === d);
        return s !== undefined && s.status !== 'not_assessed' && s.status !== 'not_applicable';
      });
      if (anyAssessed) continue;
    }

    const dirs = directionsByAtom.get(atom.atom_id) ?? {
      home: null,
      main: null,
      related: [],
    };

    nodes.push({
      atomId: atom.atom_id,
      name: atom.name,
      cluster: atom.cluster,
      dimensions,
      directions: dirs,
      isWidth,
      isDepthExecution,
      isDepthUnderstanding,
      isDepthFull,
    });
  }

  // 5. Рёбра: только между узлами, попавшими в фильтр.
  const included = new Set(nodes.map((n) => n.atomId));
  let edges: GraphEdge[] = [];
  if (included.size > 0) {
    const relRows = await query<{
      from_atom_id: string;
      to_atom_id: string;
      relation_type: RelationType;
    }>(
      `SELECT from_atom_id, to_atom_id, relation_type
         FROM competency_relations
        WHERE from_atom_id = ANY($1::text[])
          AND to_atom_id = ANY($1::text[])
        ORDER BY from_atom_id, to_atom_id, relation_type`,
      [Array.from(included)],
    );
    edges = relRows.map((r) => ({
      fromAtomId: r.from_atom_id,
      toAtomId: r.to_atom_id,
      relationType: r.relation_type,
    }));
  }

  return {
    nodes,
    edges,
    meta: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      filter: {
        cluster: opts.cluster ?? null,
        direction: opts.direction ?? null,
        status: opts.filter ?? 'all',
      },
    },
  };
}