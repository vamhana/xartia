// C.0.06.06 — Дерево надзора для балансировки.
//
// Балансировка видит не «плоский список отстающих планов», а дерево:
//   микрорайон (план) → дом (ветка) → ячейка → человек.
// На каждом уровне: сколько задач, что просрочено, что сдано раньше срока,
// кто координатор и есть ли сигналы. Совет направления смотрит то же дерево,
// поэтому может связаться с координатором ячейки или напрямую с исполнителем.

import { query, queryOne } from '../../lib/db.js';
import type { UUID } from '../types.js';

export type OversightKind = 'plan' | 'branch' | 'cell' | 'person';

export interface OversightSignal {
  id: UUID;
  externalId: string;
  status: string;
  description: string;
  createdAt: string;
}

export interface OversightNode {
  kind: OversightKind;
  id: UUID;
  title: string;
  subtitle: string;
  coordinator: string | null;
  /** Направление, которому принадлежит план (для сигналов из узла). */
  directionId: UUID | null;
  /** План, к которому относится узел (для привязки сигнала). */
  planId: UUID;
  total: number;
  done: number;
  overdue: number;
  early: number;
  /** Сколько разных людей задействовано на уровне. */
  people: number;
  signals: OversightSignal[];
  children: OversightNode[];
}

interface PlanRow {
  id: string;
  external_id: string;
  title: string;
  status: string;
  curator_id: string | null;
  curator_name: string | null;
  lead_direction_id: string | null;
}

interface TaskRow {
  id: string;
  external_id: string;
  description: string;
  status: string;
  deadline: Date | null;
  updated_at: Date;
  parent_task_id: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
}

interface SignalRow {
  id: string;
  external_id: string;
  status: string;
  description: string;
  created_at: Date;
  subject_plan_id: string | null;
  subject_task_id: string | null;
  subject_cell_id: string | null;
}

interface CellOfPerson {
  participant_id: string;
  cell_id: string;
  cell_number: string;
  cell_level: number;
  role_in_cell: string;
  coordinator_name: string | null;
}

function toSignal(r: SignalRow): OversightSignal {
  return {
    id: r.id as UUID,
    externalId: r.external_id,
    status: r.status,
    description: r.description,
    createdAt: r.created_at.toISOString(),
  };
}

async function loadPlanTasks(planId: UUID): Promise<TaskRow[]> {
  return query<TaskRow>(
    `WITH RECURSIVE tree AS (
       SELECT t.*, 0 AS depth FROM tasks t
        WHERE t.plan_id = $1 AND t.parent_task_id IS NULL
       UNION ALL
       SELECT c.*, tree.depth + 1 FROM tasks c
         JOIN tree ON c.parent_task_id = tree.id
        WHERE tree.depth < 10
     )
     SELECT tree.id, tree.external_id, tree.description, tree.status,
            tree.deadline, tree.updated_at, tree.parent_task_id,
            tree.assigned_to, p.name AS assigned_name
       FROM tree
       LEFT JOIN participants p ON p.id = tree.assigned_to`,
    [planId],
  );
}

async function loadCellsForParticipants(ids: string[]): Promise<Map<string, CellOfPerson>> {
  const map = new Map<string, CellOfPerson>();
  if (ids.length === 0) {return map;}
  const rows = await query<CellOfPerson>(
    `SELECT cm.participant_id, cm.cell_id, c.number AS cell_number,
            c.level AS cell_level, cm.role_in_cell,
            (SELECT p2.name FROM cell_members cm2
               JOIN participants p2 ON p2.id = cm2.participant_id
              WHERE cm2.cell_id = c.id AND cm2.role_in_cell = 'coordinator'
                AND (cm2.valid_to IS NULL OR cm2.valid_to > now())
              LIMIT 1) AS coordinator_name
       FROM cell_members cm
       JOIN cells c ON c.id = cm.cell_id
      WHERE cm.participant_id = ANY($1::uuid[])
        AND (cm.valid_to IS NULL OR cm.valid_to > now())`,
    [ids],
  );
  for (const r of rows) {map.set(r.participant_id, r);}
  return map;
}

async function loadSignals(planId: UUID, taskIds: string[], cellIds: string[]): Promise<SignalRow[]> {
  return query<SignalRow>(
    `SELECT id, external_id, status, description, created_at,
            subject_plan_id, subject_task_id, subject_cell_id
       FROM signals
      WHERE status NOT IN ('completed', 'rejected')
        AND (
          subject_plan_id = $1
          OR (array_length($2::uuid[], 1) IS NOT NULL AND subject_task_id = ANY($2::uuid[]))
          OR (array_length($3::uuid[], 1) IS NOT NULL AND subject_cell_id = ANY($3::uuid[]))
          OR description LIKE $4
        )
      ORDER BY created_at DESC
      LIMIT 200`,
    [planId, taskIds, cellIds, `%[план:${planId}]%`],
  );
}

export async function getOversightTree(
  directionId?: UUID,
): Promise<OversightNode[]> {
  const params: unknown[] = [];
  const where = directionId
    ? (params.push(directionId), 'AND p.lead_direction_id = $1')
    : '';
  const plans = await query<PlanRow>(
    `SELECT p.id, p.external_id, p.title, p.status, p.curator_id,
            p.lead_direction_id, curator.name AS curator_name
       FROM plans p
       LEFT JOIN participants curator ON curator.id = p.curator_id
      WHERE p.status = 'in_progress' ${where}
      ORDER BY p.created_at DESC
      LIMIT 50`,
    params,
  );

  const now = Date.now();
  const result: OversightNode[] = [];

  for (const plan of plans) {
    const tasks = await loadPlanTasks(plan.id as UUID);
    if (tasks.length === 0) {continue;}

    const byId = new Map(tasks.map((t) => [t.id, t]));
    const parentOf = new Map(tasks.map((t) => [t.id, t.parent_task_id]));
    const rootOf = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 12; i += 1) {
        const parent = parentOf.get(cur);
        if (!parent || !byId.has(parent)) {return cur;}
        cur = parent;
      }
      return cur;
    };

    const assigneeIds = [...new Set(tasks.map((t) => t.assigned_to).filter(Boolean))] as string[];
    const cellsOf = await loadCellsForParticipants(assigneeIds);
    const cellIds = [...new Set([...cellsOf.values()].map((c) => c.cell_id))];
    const signals = await loadSignals(
      plan.id as UUID,
      tasks.map((t) => t.id),
      cellIds,
    );

    const signalsFor = (pred: (s: SignalRow) => boolean): OversightSignal[] =>
      signals.filter(pred).map(toSignal);

    const stat = (list: TaskRow[]): {
      total: number; done: number; overdue: number; early: number; people: number;
    } => {
      let done = 0;
      let overdue = 0;
      let early = 0;
      const people = new Set<string>();
      for (const t of list) {
        if (t.assigned_to) {people.add(t.assigned_to);}
        const accepted = t.status === 'accepted';
        if (accepted) {
          done += 1;
          if (t.deadline && t.updated_at.getTime() <= t.deadline.getTime()) {early += 1;}
        } else if (t.deadline && t.deadline.getTime() < now) {
          overdue += 1;
        }
      }
      return { total: list.length, done, overdue, early, people: people.size };
    };

    const roots = tasks.filter((t) => !t.parent_task_id || !byId.has(t.parent_task_id));
    const planStats = stat(tasks);
    const planSignals = signalsFor(
      (s) => s.subject_plan_id === plan.id || s.description.includes(`[план:${plan.id}]`),
    );

    const branchNodes: OversightNode[] = [];
    for (const root of roots) {
      const subtree = tasks.filter((t) => rootOf(t.id) === root.id);
      const branchStats = stat(subtree);
      const branchSignals = signalsFor(
        (s) => s.subject_task_id === root.id || s.subject_task_id === null && s.subject_plan_id === plan.id,
      );

      // Группируем задачи ветки по ячейкам исполнителей.
      const byCell = new Map<string, TaskRow[]>();
      const unassigned: TaskRow[] = [];
      for (const t of subtree) {
        const cell = t.assigned_to ? cellsOf.get(t.assigned_to) : undefined;
        if (!cell) {unassigned.push(t); continue;}
        const list = byCell.get(cell.cell_id) ?? [];
        list.push(t);
        byCell.set(cell.cell_id, list);
      }

      const cellNodes: OversightNode[] = [];
      for (const [cellId, cellTasks] of byCell) {
        const first = cellTasks
          .map((t) => (t.assigned_to ? cellsOf.get(t.assigned_to) : undefined))
          .find(Boolean) as CellOfPerson | undefined;
        const cellStats = stat(cellTasks);
        const cellSignals = signalsFor((s) => s.subject_cell_id === cellId);

        // Люди внутри ячейки: по исполнителю.
        const byPerson = new Map<string, TaskRow[]>();
        for (const t of cellTasks) {
          if (!t.assigned_to) {continue;}
          const list = byPerson.get(t.assigned_to) ?? [];
          list.push(t);
          byPerson.set(t.assigned_to, list);
        }
        const personNodes: OversightNode[] = [];
        for (const [personId, personTasks] of byPerson) {
          const personStats = stat(personTasks);
          const personName = personTasks[0]?.assigned_name ?? personId.slice(0, 8);
          personNodes.push({
            kind: 'person',
            id: personId as UUID,
            title: personName,
            subtitle: `задач: ${personStats.total}`,
            coordinator: null,
            directionId: (plan.lead_direction_id as UUID | null) ?? null,
            planId: plan.id as UUID,
            ...personStats,
            signals: signalsFor((s) => s.subject_task_id === personTasks[0]?.id),
            children: [],
          });
        }

        cellNodes.push({
          kind: 'cell',
          id: cellId as UUID,
          title: `Ячейка ${first?.cell_level ?? '?'}·${first?.cell_number ?? '?'}`,
          subtitle: `задач: ${cellStats.total}, людей: ${personNodes.length}`,
          coordinator: first?.coordinator_name ?? null,
          directionId: (plan.lead_direction_id as UUID | null) ?? null,
          planId: plan.id as UUID,
          ...cellStats,
          signals: cellSignals,
          children: personNodes,
        });
      }

      if (unassigned.length > 0) {
        const unassignedStats = stat(unassigned);
        cellNodes.push({
          kind: 'cell',
          id: `unassigned-${root.id}` as UUID,
          title: 'Без ячейки',
          subtitle: 'исполнители не привязаны к ячейкам',
          coordinator: null,
          directionId: (plan.lead_direction_id as UUID | null) ?? null,
          planId: plan.id as UUID,
          ...unassignedStats,
          signals: [],
          children: unassigned.map((t) => ({
            kind: 'person' as const,
            id: t.id as UUID,
            title: t.assigned_name ?? 'не назначено',
            subtitle: t.description.slice(0, 80),
            coordinator: null,
            directionId: (plan.lead_direction_id as UUID | null) ?? null,
            planId: plan.id as UUID,
            total: 1,
            people: t.assigned_to ? 1 : 0,
            done: t.status === 'accepted' ? 1 : 0,
            overdue: t.status !== 'accepted' && t.deadline && t.deadline.getTime() < now ? 1 : 0,
            early: 0,
            signals: [],
            children: [],
          })),
        });
      }

      branchNodes.push({
        kind: 'branch',
        id: root.id as UUID,
        title: root.description,
        subtitle: `${root.external_id} · ячеек: ${cellNodes.length}`,
        coordinator: cellNodes[0]?.coordinator ?? null,
        directionId: (plan.lead_direction_id as UUID | null) ?? null,
        planId: plan.id as UUID,
        ...branchStats,
        signals: branchSignals,
        children: cellNodes,
      });
    }

    result.push({
      kind: 'plan',
      id: plan.id as UUID,
      title: plan.title,
      subtitle: `${plan.external_id} · веток: ${branchNodes.length}`,
      coordinator: plan.curator_name,
      directionId: (plan.lead_direction_id as UUID | null) ?? null,
      planId: plan.id as UUID,
      ...planStats,
      signals: planSignals,
      children: branchNodes,
    });
  }

  return result;
}

/** Кто сегодня сигналил по объекту — для карточки узла. */
export async function getSignalCountForPlan(planId: UUID): Promise<number> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM signals
      WHERE subject_plan_id = $1 AND status NOT IN ('completed', 'rejected')`,
    [planId],
  );
  return parseInt(row?.c ?? '0', 10);
}
