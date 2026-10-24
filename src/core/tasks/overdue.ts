// C.0.07.04 — Просроченные задачи, не сданные в ОТК.
//
// «Отчёт не сдан — работа не проверена» — это не вина ОТК, а разрыв в контуре:
// задача идёт по сроку, но исполнитель не передал её на проверку. Такой разрыв
// должен видеть не только куратор направления, но и балансировка: она держит
// индикаторы и поднимает сигнал направлению.
//
// Критерий: срок истёк, статус created/assigned/in_progress (то есть работа
// либо не начата, либо не доведена до submitted). ОТК тут ни при чём — ему
// нечего проверять, пока отчёт не сдан.

import { query, queryOne } from '../../lib/db.js';
import type { UUID } from '../types.js';

export interface UnsubmittedTask {
  id: UUID;
  externalId: string;
  description: string;
  directionId: UUID;
  directionNumber: number | null;
  status: string;
  deadline: string | null;
  daysLate: number;
  assignedTo: UUID | null;
}

export async function listUnsubmittedTasks(
  directionId?: UUID,
): Promise<UnsubmittedTask[]> {
  const params: unknown[] = [];
  const where = directionId
    ? (params.push(directionId), 'AND t.direction_id = $1')
    : '';
  const rows = await query<{
    id: string;
    external_id: string;
    description: string;
    direction_id: string;
    direction_number: number | null;
    status: string;
    deadline: Date | null;
    assigned_to: string | null;
  }>(
    `SELECT t.id, t.external_id, t.description, t.direction_id,
            d.number AS direction_number, t.status, t.deadline, t.assigned_to
       FROM tasks t
       LEFT JOIN directions d ON d.id = t.direction_id
      WHERE t.status IN ('created', 'assigned', 'in_progress')
        AND t.deadline IS NOT NULL
        AND t.deadline < now()
        ${where}
      ORDER BY t.deadline
      LIMIT 200`,
    params,
  );

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id as UUID,
    externalId: r.external_id,
    description: r.description,
    directionId: r.direction_id as UUID,
    directionNumber: r.direction_number,
    status: r.status,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    daysLate: r.deadline
      ? Math.max(0, Math.floor((now - r.deadline.getTime()) / (24 * 3600 * 1000)))
      : 0,
    assignedTo: (r.assigned_to as UUID | null) ?? null,
  }));
}

/**
 * Есть ли свежий сигнал о просрочке по направлению (защита от спама).
 * Маркер в описании: [просрочка:<directionId>].
 */
export async function hasRecentOverdueSignal(
  directionId: UUID,
  hours = 24,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM signals
      WHERE description LIKE $1
        AND created_at > now() - ($2 || ' hours')::interval
        AND status NOT IN ('completed', 'rejected')
      ORDER BY created_at DESC
      LIMIT 1`,
    [`%[просрочка:${directionId}]%`, String(hours)],
  );
  return row?.id ?? null;
}
