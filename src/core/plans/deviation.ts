// C.0.06.03 — Отклонения плана.
//
// Зачем: балансировка «видит все индикаторы» и именно она замечает, что один
// участок идёт быстрее другого, и поднимает сигнал направлению. Без расчёта
// отклонения это можно заметить только глазами по списку задач.
//
// Что считаем:
//   - overdue   — задачи с истёкшим сроком и не принятые;
//   - expected  — сколько задач «должно» быть принято по времени (линейно от
//                 создания плана до последнего чекпоинта);
//   - diff      — done − expected (плюс = быстрее, минус = отставание);
//   - breached  — пройденные чекпоинты, к которым задачи не были закрыты.
//
// Статус: behind (есть overdue или пройденный чекпоинт не закрыт),
//         ahead (diff > порога), иначе on_track.

import { query, queryOne } from '../../lib/db.js';
import type { UUID } from '../types.js';

import { getById, listPlans, type PlanFilter } from './service.js';

export type DeviationStatus = 'behind' | 'on_track' | 'ahead';

export interface BreachedCheckpoint {
  at: string;
  description: string;
  expectedDone: number;
  actualDone: number;
}

export interface PlanDeviation {
  planId: UUID;
  externalId: string;
  title: string;
  planStatus: string;
  leadDirectionId: UUID;
  curatorId: UUID | null;
  total: number;
  done: number;
  overdue: number;
  expectedDone: number;
  diff: number;
  status: DeviationStatus;
  breached: BreachedCheckpoint[];
}

interface PlanTaskRow {
  id: string;
  status: string;
  deadline: Date | null;
}

async function loadPlanTasks(planId: UUID): Promise<PlanTaskRow[]> {
  return query<PlanTaskRow>(
    `WITH ids AS (
       SELECT t.id FROM tasks t WHERE t.plan_id = $1
       UNION
       SELECT pt.task_id FROM plan_tasks pt WHERE pt.plan_id = $1
     )
     SELECT t.id, t.status, t.deadline
       FROM tasks t JOIN ids ON ids.id = t.id`,
    [planId],
  );
}

export async function computeDeviation(planId: UUID): Promise<PlanDeviation> {
  const plan = await getById(planId);
  const tasks = await loadPlanTasks(planId);
  const now = Date.now();

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'accepted').length;
  const overdue = tasks.filter(
    (t) => t.deadline !== null && t.deadline.getTime() < now && t.status !== 'accepted',
  ).length;

  // Временное окно: от создания плана до последнего чекпоинта (или 30 дней).
  const created = new Date(plan.createdAt).getTime();
  const lastCheckpoint = plan.checkpoints.reduce<number>(
    (max, c) => Math.max(max, new Date(c.at).getTime()),
    created,
  );
  const windowMs = Math.max(lastCheckpoint - created, 30 * 24 * 3600 * 1000);
  const elapsed = Math.min(Math.max(now - created, 0), windowMs);
  const expectedDone = total === 0 ? 0 : Math.round((total * elapsed) / windowMs);
  const diff = done - expectedDone;

  // Пройденные чекпоинты: сколько задач к этой дате должно было быть принято.
  const breached: BreachedCheckpoint[] = [];
  for (const cp of plan.checkpoints) {
    const at = new Date(cp.at).getTime();
    if (at > now) {continue;}
    const due = tasks.filter((t) => t.deadline !== null && t.deadline.getTime() <= at);
    const closed = due.filter((t) => t.status === 'accepted').length;
    if (due.length > 0 && closed < due.length) {
      breached.push({
        at: cp.at,
        description: cp.description,
        expectedDone: due.length,
        actualDone: closed,
      });
    }
  }

  const threshold = Math.max(1, Math.round(total * 0.2));
  let status: DeviationStatus = 'on_track';
  if (overdue > 0 || breached.length > 0) {
    status = 'behind';
  } else if (diff > threshold) {
    status = 'ahead';
  }

  return {
    planId: plan.id,
    externalId: plan.externalId,
    title: plan.title,
    planStatus: plan.status,
    leadDirectionId: plan.leadDirectionId,
    curatorId: plan.curatorId,
    total,
    done,
    overdue,
    expectedDone,
    diff,
    status,
    breached,
  };
}

export interface DeviationFilter extends PlanFilter {
  onlyBehind?: boolean;
}

/**
 * Отклонения по активным планам. Считаем только планы в работе: черновики и
 * остановленные не «отстают» — они ещё не начались или уже закрыты.
 */
export async function listDeviations(
  filter: DeviationFilter = {},
): Promise<{ data: PlanDeviation[]; total: number }> {
  const plans = await listPlans({
    ...(filter.leadDirectionId ? { leadDirectionId: filter.leadDirectionId } : {}),
    ...(filter.curatorId ? { curatorId: filter.curatorId } : {}),
    ...(filter.signalId ? { signalId: filter.signalId } : {}),
    // «В работе» по схеме планов — in_progress; run/approved ещё не начались.
    status: 'in_progress',
    page: 1,
    perPage: 200,
  });

  const data: PlanDeviation[] = [];
  for (const p of plans.data) {
    data.push(await computeDeviation(p.id));
  }
  const filtered = filter.onlyBehind
    ? data.filter((d) => d.status === 'behind')
    : data;
  // Сначала самые проблемные: больше просрочек — выше.
  filtered.sort((a, b) => b.overdue - a.overdue || a.diff - b.diff);
  return { data: filtered, total: filtered.length };
}

/** Есть ли по плану свежий сигнал об отклонении (защита от спама). */
export async function hasRecentDeviationSignal(
  planId: UUID,
  hours = 24,
): Promise<string | null> {
  const marker = `[план:${planId}]`;
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM signals
      WHERE description LIKE $1
        AND created_at > now() - ($2 || ' hours')::interval
        AND status NOT IN ('completed', 'rejected')
      ORDER BY created_at DESC
      LIMIT 1`,
    [`%${marker}%`, String(hours)],
  );
  return row?.id ?? null;
}
