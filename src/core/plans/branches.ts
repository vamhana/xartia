// C.0.06.04 — Ветки плана (параллельные участки).
//
// «Строим 20 одинаковых домов»: у плана есть корневые задачи-ветки (дом №1,
// дом №2 …), у каждой — свои подзадачи (фундамент, стены, крыша). Общий счётчик
// «принято 40 из 200» не показывает, что дом №3 уже на крыше, а дом №11 стоит
// на фундаменте. Балансировка должна видеть именно ветки.

import { query, queryOne } from '../../lib/db.js';
import type { UUID } from '../types.js';

export interface BranchProgress {
  taskId: UUID;
  externalId: string;
  title: string;
  total: number;
  done: number;
  overdue: number;
  status: 'behind' | 'on_track' | 'ahead';
}

export interface PlanBranches {
  planId: UUID;
  branches: BranchProgress[];
  behindCount: number;
}

interface BranchRow {
  root_id: string;
  root_external_id: string;
  root_description: string;
  total: string;
  done: string;
  overdue: string;
}

/**
 * Ветки плана: корневые задачи с подзадачами.
 * Статус ветки считается по её собственным подзадачам — так «дом №11 отстаёт»
 * видно отдельно от общего прогресса плана.
 */
export async function computePlanBranches(planId: UUID): Promise<PlanBranches> {
  const rows = await query<BranchRow>(
    `SELECT root.id AS root_id,
            root.external_id AS root_external_id,
            root.description AS root_description,
            COUNT(child.id)::text AS total,
            COUNT(child.id) FILTER (WHERE child.status = 'accepted')::text AS done,
            COUNT(child.id) FILTER (
              WHERE child.deadline < now() AND child.status <> 'accepted'
            )::text AS overdue
       FROM tasks root
       JOIN tasks child ON child.parent_task_id = root.id
      WHERE root.plan_id = $1
      GROUP BY root.id, root.external_id, root.description
      ORDER BY root.external_id`,
    [planId],
  );

  const branches: BranchProgress[] = rows.map((r) => {
    const total = parseInt(r.total, 10);
    const done = parseInt(r.done, 10);
    const overdue = parseInt(r.overdue, 10);
    const share = total === 0 ? 0 : done / total;
    let status: BranchProgress['status'] = 'on_track';
    if (overdue > 0) {status = 'behind';}
    else if (share >= 0.999) {status = 'ahead';}
    return {
      taskId: r.root_id as UUID,
      externalId: r.root_external_id,
      title: r.root_description,
      total,
      done,
      overdue,
      status,
    };
  });

  return {
    planId,
    branches,
    behindCount: branches.filter((b) => b.status === 'behind').length,
  };
}

/** Ветки по всем активным планам направления (для панели балансировки). */
export async function listPlanBranches(
  directionId?: UUID,
): Promise<Array<PlanBranches & { planExternalId: string; planTitle: string }>> {
  const params: unknown[] = [];
  const where = directionId
    ? (params.push(directionId), 'AND p.lead_direction_id = $1')
    : '';
  const plans = await query<{ id: string; external_id: string; title: string }>(
    `SELECT p.id, p.external_id, p.title
       FROM plans p
      WHERE p.status = 'in_progress'
        AND EXISTS (
          SELECT 1 FROM tasks r
            JOIN tasks c ON c.parent_task_id = r.id
           WHERE r.plan_id = p.id
        )
        ${where}
      ORDER BY p.created_at DESC
      LIMIT 100`,
    params,
  );

  const result: Array<PlanBranches & { planExternalId: string; planTitle: string }> = [];
  for (const p of plans) {
    const branches = await computePlanBranches(p.id as UUID);
    if (branches.branches.length === 0) {continue;}
    result.push({
      ...branches,
      planExternalId: p.external_id,
      planTitle: p.title,
    });
  }
  return result;
}

/** Сколько веток плана отстаёт (для сводки отклонений). */
export async function countBehindBranches(planId: UUID): Promise<number> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c
       FROM (
         SELECT root.id
           FROM tasks root
           JOIN tasks child ON child.parent_task_id = root.id
          WHERE root.plan_id = $1
          GROUP BY root.id
         HAVING COUNT(child.id) FILTER (
           WHERE child.deadline < now() AND child.status <> 'accepted'
         ) > 0
       ) x`,
    [planId],
  );
  return parseInt(row?.c ?? '0', 10);
}
