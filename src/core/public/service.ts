// C.0.43.01 — Публичная витрина: только агрегаты, без авторизации.
//
// Зачем: человек, пришедший по ссылке, должен за 60 секунд увидеть, что
// проект живой (сколько людей, направлений, сколько работы сделано), и подать
// заявку. Здесь нет ни одного персонального поля — только COUNT(*).

import { query } from '../../lib/db.js';

export interface PublicOverview {
  people: number;
  directions: number;
  tasksInWork: number;
  tasksAccepted: number;
  reportsSubmitted: number;
}

export async function getPublicOverview(): Promise<PublicOverview> {
  const rows = await query<{
    people: string;
    directions: string;
    tasks_in_work: string;
    tasks_accepted: string;
    reports: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM participants WHERE deleted_at IS NULL) AS people,
       (SELECT COUNT(*)::text FROM directions) AS directions,
       (SELECT COUNT(*)::text FROM tasks WHERE status IN ('assigned','in_progress')) AS tasks_in_work,
       (SELECT COUNT(*)::text FROM tasks WHERE status = 'accepted') AS tasks_accepted,
       (SELECT COUNT(*)::text FROM reports) AS reports`,
  );

  const r = rows[0];
  return {
    people: parseInt(r?.people ?? '0', 10),
    directions: parseInt(r?.directions ?? '0', 10),
    tasksInWork: parseInt(r?.tasks_in_work ?? '0', 10),
    tasksAccepted: parseInt(r?.tasks_accepted ?? '0', 10),
    reportsSubmitted: parseInt(r?.reports ?? '0', 10),
  };
}
