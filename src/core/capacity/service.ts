// C.0.28.05 — Ёмкость: спрос на компетенции против наличия людей.
//
// Спрос: открытые задачи (не accepted/cancelled) с required_competencies.
// Наличие: participant_competencies (уровень 1..5).
// Дефицит = max(0, нужно − есть).

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';

export interface CapacityRow {
  competency: string;
  tasks: number;
  needed: number;
  available: number;
  gap: number;
  avgLevel: number;
}

export interface CapacityReport {
  scope: { directionId: UUID | null; planId: UUID | null };
  demand: Array<{ competency: string; tasks: number; needed: number }>;
  supply: Array<{ competency: string; people: number; avgLevel: number }>;
  rows: CapacityRow[];
  totals: { tasks: number; needed: number; available: number; gap: number };
}

export async function getCapacity(input: {
  directionId?: UUID | null;
  planId?: UUID | null;
}): Promise<CapacityReport> {
  const taskParams: unknown[] = [];
  const conditions: string[] = [
    `status <> 'accepted'`,
    `jsonb_array_length(required_competencies) > 0`,
  ];
  if (input.directionId) {
    taskParams.push(input.directionId);
    conditions.push(`direction_id = $${taskParams.length}`);
  }
  if (input.planId) {
    taskParams.push(input.planId);
    conditions.push(`plan_id = $${taskParams.length}`);
  }

  const demandRows = await query<{ competency: string; tasks: string }>(
    `SELECT c.competency, COUNT(*)::text AS tasks
       FROM tasks t
       CROSS JOIN LATERAL jsonb_array_elements_text(t.required_competencies) AS c(competency)
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.competency
      ORDER BY c.competency`,
    taskParams,
  );

  const supplyParams: unknown[] = [];
  const supplyWhere = input.directionId
    ? (supplyParams.push(input.directionId), `AND p.direction_id = $1`)
    : '';
  const supplyRows = await query<{ competency: string; people: string; avg_level: string }>(
    `SELECT pc.competency, COUNT(DISTINCT pc.participant_id)::text AS people,
            AVG(pc.level)::text AS avg_level
       FROM participant_competencies pc
       JOIN participants p ON p.id = pc.participant_id AND p.deleted_at IS NULL
      WHERE true ${supplyWhere}
      GROUP BY pc.competency
      ORDER BY pc.competency`,
    supplyParams,
  );

  const supplyMap = new Map(
    supplyRows.map((r) => [r.competency, {
      people: parseInt(r.people, 10),
      avgLevel: Math.round(parseFloat(r.avg_level) * 10) / 10,
    }]),
  );

  const demand = demandRows.map((r) => ({
    competency: r.competency,
    tasks: parseInt(r.tasks, 10),
    needed: parseInt(r.tasks, 10),
  }));

  const rows: CapacityRow[] = demand.map((d) => {
    const supply = supplyMap.get(d.competency);
    const available = supply?.people ?? 0;
    return {
      competency: d.competency,
      tasks: d.tasks,
      needed: d.needed,
      available,
      gap: Math.max(0, d.needed - available),
      avgLevel: supply?.avgLevel ?? 0,
    };
  });

  // Компетенции, которые есть у людей, но не нужны задачам — тоже полезны.
  for (const [competency, supply] of supplyMap) {
    if (!rows.some((r) => r.competency === competency)) {
      rows.push({
        competency,
        tasks: 0,
        needed: 0,
        available: supply.people,
        gap: 0,
        avgLevel: supply.avgLevel,
      });
    }
  }

  rows.sort((a, b) => b.gap - a.gap || a.competency.localeCompare(b.competency));

  const sum = (key: 'needed' | 'available') =>
    rows.reduce((acc, r) => acc + r[key], 0);

  return {
    scope: { directionId: input.directionId ?? null, planId: input.planId ?? null },
    demand,
    supply: Array.from(supplyMap, ([competency, s]) => ({
      competency,
      people: s.people,
      avgLevel: s.avgLevel,
    })),
    rows,
    totals: {
      tasks: demand.reduce((a, d) => a + d.tasks, 0),
      needed: sum('needed'),
      available: sum('available'),
      gap: rows.reduce((a, r) => a + r.gap, 0),
    },
  };
}
