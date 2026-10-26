// C.0.28.07 — Готовность ячейки.
//
// Ячейка без общего плана, координатора, ОТК или полного состава
// не получает наряд. Проверка возвращает конкретные причины.

import { query } from '../../lib/db.js';
import { getById, getMembers } from './service.js';
import { queryOne } from '../../lib/db.js';
import { getSize } from './entity.js';
import type { UUID } from '../types.js';

export interface ReadinessCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export interface CellReadiness {
  cellId: UUID;
  ready: boolean;
  status: string;
  checks: ReadinessCheck[];
  members: number;
  requiredMembers: number;
  planId: string | null;
}

export async function getCellReadiness(cellId: UUID): Promise<CellReadiness> {
  const cell = await getById(cellId);
  const statusRow = await queryOne<{ status: string }>(
    `SELECT status FROM cells WHERE id = $1`,
    [cellId],
  );
  const members = await getMembers(cellId);
  const requiredMembers = getSize(cell.level);

  const coordinators = members.filter((m) => m.roleInCell === 'coordinator');
  const otc = members.filter((m) => m.roleInCell === 'otc');

  const plan = await query<{ id: string; status: string }>(
    `SELECT id, status
       FROM plans
      WHERE cell_id = $1 AND status IN ('run', 'approved', 'in_progress')
      ORDER BY created_at DESC
      LIMIT 1`,
    [cellId],
  );

  const checks: ReadinessCheck[] = [
    {
      id: 'staffed',
      title: 'Полный состав',
      passed: members.length >= requiredMembers,
      detail: `${members.length} из ${requiredMembers}`,
    },
    {
      id: 'coordinator',
      title: 'Координатор ячейки',
      passed: coordinators.length >= 1,
      detail: coordinators.length > 0 ? 'назначен' : 'не назначен',
    },
    {
      id: 'otc',
      title: 'Внешний ОТК',
      passed: otc.length >= 1,
      detail: otc.length > 0 ? 'назначен' : 'не назначен',
    },
    {
      id: 'plan',
      title: 'Общий план ячейки',
      passed: plan.length > 0,
      detail: plan[0] ? `план ${plan[0].id.slice(0, 8)} (${plan[0].status})` : 'нет плана',
    },
  ];

  return {
    cellId,
    ready: checks.every((c) => c.passed),
    status: statusRow?.status ?? 'forming',
    checks,
    members: members.length,
    requiredMembers,
    planId: plan[0]?.id ?? null,
  };
}

/** Перевести ячейку в ready, если чек-лист пройден (иначе 409 на уровне API). */
export async function markCellReady(cellId: UUID): Promise<CellReadiness> {
  const readiness = await getCellReadiness(cellId);
  if (!readiness.ready) {return readiness;}
  await query(`UPDATE cells SET status = 'ready' WHERE id = $1 AND status = 'forming'`, [cellId]);
  return { ...readiness, status: 'ready' };
}
