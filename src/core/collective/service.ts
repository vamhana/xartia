// C.0.40.01 — «Коллектив»: кто есть, кто и что происходит.
//
// Зачем: приглашённый человек должен за 30 секунд понять, куда он попал —
// кто здесь работает, на каких направлениях, какие роли заняты и что
// происходило в последние дни. Без этого продукт выглядит мёртвым, даже если
// внутри всё работает.
//
// Принципы:
//   - только чтение, без побочных эффектов;
//   - в ленту не попадают телефоны, мессенджеры, IP и payload'ы аудита:
//     видно «кто», «что» и «когда», но не персональные данные;
//   - лимиты жёсткие (200 человек, 60 событий) — это экран, а не выгрузка.

import { query } from '../../lib/db.js';
import type { UUID } from '../types.js';

export interface CollectivePerson {
  id: UUID;
  externalId: string;
  name: string;
  pseudonym: string | null;
  status: string;
  direction: { number: number; name: string } | null;
  roles: Array<{ name: string; validTo: string | null }>;
}

export interface CollectiveDirection {
  number: number;
  name: string;
  people: number;
}

export interface CollectiveRole {
  name: string;
  holders: number;
}

export interface CollectiveActivityItem {
  id: string;
  at: string;
  actor: { externalId: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string;
}

export interface CollectiveOverview {
  totals: {
    people: number;
    directions: number;
    tasksInWork: number;
    reportsWaitingOtc: number;
  };
  people: CollectivePerson[];
  directions: CollectiveDirection[];
  roles: CollectiveRole[];
  activity: CollectiveActivityItem[];
}

export async function getOverview(activityLimit = 40): Promise<CollectiveOverview> {
  const limit = Math.min(60, Math.max(1, activityLimit));

  const peopleRows = await query<{
    id: string;
    external_id: string;
    name: string;
    pseudonym: string | null;
    status: string;
    direction_number: number | null;
    direction_name: string | null;
    roles: Array<{ name: string; validTo: string | null }> | null;
  }>(
    `SELECT p.id, p.external_id, p.name, p.pseudonym, p.status,
            d.number AS direction_number, d.name AS direction_name,
            COALESCE(
              json_agg(
                DISTINCT jsonb_build_object('name', r.name, 'validTo', pr.valid_to)
              ) FILTER (WHERE pr.id IS NOT NULL),
              '[]'
            ) AS roles
       FROM participants p
       LEFT JOIN directions d ON d.id = p.direction_id
       LEFT JOIN participant_roles pr
              ON pr.participant_id = p.id
             AND pr.status = 'active'
             AND (pr.valid_to IS NULL OR pr.valid_to > now())
       LEFT JOIN roles r ON r.id = pr.role_id
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, d.number, d.name
      ORDER BY p.external_id
      LIMIT 200`,
  );

  const directionRows = await query<{
    number: number;
    name: string;
    people: string;
  }>(
    `SELECT d.number, d.name, COUNT(p.id)::text AS people
       FROM directions d
       LEFT JOIN participants p
              ON p.direction_id = d.id AND p.deleted_at IS NULL
      GROUP BY d.number, d.name
      ORDER BY d.number`,
  );

  const roleRows = await query<{ name: string; holders: string }>(
    `SELECT r.name, COUNT(DISTINCT pr.participant_id)::text AS holders
       FROM roles r
       JOIN participant_roles pr
         ON pr.role_id = r.id
        AND pr.status = 'active'
        AND (pr.valid_to IS NULL OR pr.valid_to > now())
      GROUP BY r.name
      ORDER BY COUNT(DISTINCT pr.participant_id) DESC, r.name
      LIMIT 30`,
  );

  const activityRows = await query<{
    id: string;
    created_at: Date;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_external_id: string | null;
    actor_name: string | null;
  }>(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id,
            p.external_id AS actor_external_id, p.name AS actor_name
       FROM audit_log a
       LEFT JOIN participants p ON p.id = a.actor_id
      ORDER BY a.created_at DESC
      LIMIT $1`,
    [limit],
  );

  const counts = await query<{
    people: string;
    directions: string;
    tasks_in_work: string;
    reports_waiting: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM participants WHERE deleted_at IS NULL) AS people,
       (SELECT COUNT(*)::text FROM directions) AS directions,
       (SELECT COUNT(*)::text FROM tasks WHERE status IN ('assigned','in_progress')) AS tasks_in_work,
       (SELECT COUNT(*)::text FROM tasks WHERE status = 'submitted') AS reports_waiting`,
  );

  const c = counts[0];

  return {
    totals: {
      people: parseInt(c?.people ?? '0', 10),
      directions: parseInt(c?.directions ?? '0', 10),
      tasksInWork: parseInt(c?.tasks_in_work ?? '0', 10),
      reportsWaitingOtc: parseInt(c?.reports_waiting ?? '0', 10),
    },
    people: peopleRows.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      name: row.name,
      pseudonym: row.pseudonym,
      status: row.status,
      direction:
        row.direction_number !== null && row.direction_name !== null
          ? { number: row.direction_number, name: row.direction_name }
          : null,
      roles: (row.roles ?? []).map((r) => ({
        name: r.name,
        validTo: r.validTo ?? null,
      })),
    })),
    directions: directionRows.map((row) => ({
      number: row.number,
      name: row.name,
      people: parseInt(row.people, 10),
    })),
    roles: roleRows.map((row) => ({
      name: row.name,
      holders: parseInt(row.holders, 10),
    })),
    activity: activityRows.map((row) => ({
      id: row.id,
      at: row.created_at.toISOString(),
      actor:
        row.actor_external_id !== null && row.actor_name !== null
          ? { externalId: row.actor_external_id, name: row.actor_name }
          : null,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
    })),
  };
}
