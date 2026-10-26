// C.0.04.15 — Карточки ячейки и человека.
//
// Ячейка: состав, общий план (может быть долгим), дневной план.
// Человек: паспорт, текущие задачи с автором назначения, наставник и
// ученики, дневной план на сегодня.

import { query, queryOne } from '../../lib/db.js';
import { getById as getCell, getMembers } from '../cells/service.js';
import { getCellDailyPlan } from '../cells/daily.js';
import { getById as getParticipant } from '../participants/service.js';
import type { UUID } from '../types.js';

export interface CellCard {
  cell: {
    id: string;
    number: string;
    level: number;
    profile: string | null;
    status: string;
    directionId: string;
    membersCount: number;
  };
  members: Array<{
    participantId: string;
    name: string;
    roleInCell: string;
    status: string;
  }>;
  plans: Array<{ id: string; title: string; status: string; version: number }>;
  dailyPlan: Awaited<ReturnType<typeof getCellDailyPlan>>;
}

export async function getCellCard(cellId: UUID): Promise<CellCard> {
  const cell = await getCell(cellId);
  const statusRow = await queryOne<{ status: string }>(
    `SELECT status FROM cells WHERE id = $1`, [cellId],
  );
  const membersRaw = await getMembers(cellId);

  const ids = membersRaw.map((m) => m.participantId);
  const people = ids.length > 0
    ? await query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM participants WHERE id = ANY($1::uuid[])`,
        [ids],
      )
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  const plans = await query<{ id: string; title: string; status: string; version: number }>(
    `SELECT id, title, status, version
       FROM plans WHERE cell_id = $1 ORDER BY version DESC`,
    [cellId],
  );

  const today = new Date().toISOString().slice(0, 10);
  const dailyPlan = await getCellDailyPlan(cellId, today);

  return {
    cell: {
      id: cell.id,
      number: cell.number,
      level: cell.level,
      profile: cell.profile,
      status: statusRow?.status ?? 'forming',
      directionId: cell.directionId,
      membersCount: cell.membersCount,
    },
    members: membersRaw.map((m) => ({
      participantId: m.participantId,
      name: byId.get(m.participantId)?.name ?? '—',
      roleInCell: m.roleInCell,
      status: byId.get(m.participantId)?.status ?? '—',
    })),
    plans,
    dailyPlan,
  };
}

export interface PersonCard {
  participant: {
    id: string;
    name: string;
    status: string;
    directionId: string | null;
    cellId: string | null;
    cellNumber: string | null;
  };
  tasks: Array<{
    id: string;
    externalId: string;
    description: string;
    status: string;
    priority: string;
    deadline: string | null;
    assignedBy: { id: string; name: string } | null;
  }>;
  mentor: { id: string; name: string } | null;
  mentees: Array<{ id: string; name: string }>;
  dailyPlan: Array<{
    id: string;
    externalId: string;
    description: string;
    status: string;
    priority: string;
  }>;
}

async function namesByIds(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) {return new Map();}
  const rows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM participants WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function getPersonCard(participantId: UUID): Promise<PersonCard> {
  const p = await getParticipant(participantId);

  const cellRow = p.cellId
    ? await queryOne<{ number: string }>(`SELECT number FROM cells WHERE id = $1`, [p.cellId])
    : null;

  const tasksRaw = await query<{
    id: string; external_id: string; description: string; status: string;
    priority: string; deadline: Date | null; assigned_by: string | null;
  }>(
    `SELECT id, external_id, description, status, priority, deadline, assigned_by
       FROM tasks
      WHERE assigned_to = $1 AND status NOT IN ('accepted')
      ORDER BY created_at DESC
      LIMIT 20`,
    [participantId],
  );
  const assigners = await namesByIds(
    tasksRaw.map((t) => t.assigned_by).filter((x): x is string => Boolean(x)),
  );

  // Наставник: строка integrator_mentors, где ученик входит в mentees.
  const mentorRow = await queryOne<{ mentor_id: string }>(
    `SELECT mentor_id FROM integrator_mentors
      WHERE mentees @> jsonb_build_array($1::text)
      LIMIT 1`,
    [participantId],
  );
  const mentorName = mentorRow
    ? (await namesByIds([mentorRow.mentor_id])).get(mentorRow.mentor_id) ?? '—'
    : null;

  // Ученики: все mentees у этого наставника.
  const menteeRows = await query<{ mentee: string }>(
    `SELECT jsonb_array_elements_text(mentees) AS mentee
       FROM integrator_mentors WHERE mentor_id = $1`,
    [participantId],
  );
  const menteeIds = menteeRows.map((r) => r.mentee);
  const menteeNames = await namesByIds(menteeIds);

  const dailyRaw = p.directionId
    ? await query<{
        id: string; external_id: string; description: string; status: string; priority: string;
      }>(
        `SELECT t.id, t.external_id, t.description, t.status, t.priority
           FROM daily_plans dp
           JOIN daily_plan_tasks dpt ON dpt.daily_plan_id = dp.id
           JOIN tasks t ON t.id = dpt.task_id
          WHERE dp.direction_id = $1
            AND dp.date = CURRENT_DATE
            AND t.assigned_to = $2
          ORDER BY dpt.position`,
        [p.directionId, participantId],
      )
    : [];

  return {
    participant: {
      id: p.id,
      name: p.name,
      status: p.status,
      directionId: p.directionId,
      cellId: p.cellId,
      cellNumber: cellRow?.number ?? null,
    },
    tasks: tasksRaw.map((t) => ({
      id: t.id,
      externalId: t.external_id,
      description: t.description,
      status: t.status,
      priority: t.priority,
      deadline: t.deadline ? t.deadline.toISOString() : null,
      assignedBy: t.assigned_by
        ? { id: t.assigned_by, name: assigners.get(t.assigned_by) ?? '—' }
        : null,
    })),
    mentor: mentorRow
      ? { id: mentorRow.mentor_id, name: mentorName ?? '—' }
      : null,
    mentees: menteeIds.map((id) => ({ id, name: menteeNames.get(id) ?? '—' })),
    dailyPlan: dailyRaw.map((t) => ({
      id: t.id,
      externalId: t.external_id,
      description: t.description,
      status: t.status,
      priority: t.priority,
    })),
  };
}
