// C.0.06.05 — Дерево работ плана.
//
// «Микрорайон» — это не список домов, а дерево: дом → этаж → работы, и в
// каждой ветке свои люди. Плоский список задач этого не показывает, поэтому
// план отдаётся деревом: можно раскрыть дом, дойти до конкретного человека и
// увидеть, на каком этапе работа.

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';

export interface WorkTreeNode {
  id: UUID;
  externalId: string;
  description: string;
  status: string;
  priority: string;
  deadline: string | null;
  assignedTo: { id: UUID; name: string; externalId: string } | null;
  /** Сколько всего поддереве задач и сколько из них принято. */
  total: number;
  done: number;
  children: WorkTreeNode[];
}

export interface PlanTree {
  planId: UUID;
  roots: WorkTreeNode[];
  total: number;
  done: number;
}

interface TreeRow {
  id: string;
  external_id: string;
  description: string;
  status: string;
  priority: string;
  deadline: Date | null;
  parent_task_id: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  assigned_external_id: string | null;
}

export async function getPlanTree(planId: UUID): Promise<PlanTree> {
  // Один рекурсивный запрос: корни плана + все их потомки (в том числе
  // задачи, у которых plan_id не проставлен, но есть parent_task_id).
  const rows = await query<TreeRow>(
    `WITH RECURSIVE tree AS (
       SELECT t.*, 0 AS depth
         FROM tasks t
        WHERE t.plan_id = $1 AND t.parent_task_id IS NULL
       UNION ALL
       SELECT c.*, tree.depth + 1
         FROM tasks c
         JOIN tree ON c.parent_task_id = tree.id
        WHERE tree.depth < 10
     )
     SELECT tree.id, tree.external_id, tree.description, tree.status,
            tree.priority, tree.deadline, tree.parent_task_id, tree.assigned_to,
            p.name AS assigned_name, p.external_id AS assigned_external_id
       FROM tree
       LEFT JOIN participants p ON p.id = tree.assigned_to
      ORDER BY tree.depth, tree.external_id`,
    [planId],
  );

  const byId = new Map<string, WorkTreeNode>();
  const parentOf = new Map<string, string | null>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id as UUID,
      externalId: r.external_id,
      description: r.description,
      status: r.status,
      priority: r.priority,
      deadline: r.deadline ? r.deadline.toISOString() : null,
      assignedTo: r.assigned_to
        ? {
            id: r.assigned_to as UUID,
            name: r.assigned_name ?? '—',
            externalId: r.assigned_external_id ?? '',
          }
        : null,
      total: 0,
      done: 0,
      children: [],
    });
    parentOf.set(r.id, r.parent_task_id);
  }

  const roots: WorkTreeNode[] = [];
  for (const [id, node] of byId) {
    const parentId = parentOf.get(id) ?? null;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Агрегаты снизу вверх: принято/всего по поддереву.
  const aggregate = (node: WorkTreeNode): { total: number; done: number } => {
    let total = 1;
    let done = node.status === 'accepted' ? 1 : 0;
    for (const child of node.children) {
      const sub = aggregate(child);
      total += sub.total;
      done += sub.done;
    }
    node.total = total;
    node.done = done;
    return { total, done };
  };

  let total = 0;
  let done = 0;
  for (const root of roots) {
    const agg = aggregate(root);
    total += agg.total;
    done += agg.done;
  }

  return { planId, roots, total, done };
}
