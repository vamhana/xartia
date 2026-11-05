// C.1.07.01 — Чтение 17 направлений Хартии и привязок атомов (Фаза 3a, §14).
//
// Сид atom_direction_map уже прошёл (шаг 2). Здесь — read-only.

import { query, queryOne } from '../../lib/db.js';
import type {
  AtomDirection,
  AtomDirectionRole,
  AtomDirections,
  DirectionRef,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// 17 направлений (справочник)
// ─────────────────────────────────────────────────────────────────────

interface DirectionRow {
  id: string;
  number: number;
  name: string;
  type: string;
  status: string;
}

function toDirectionRef(r: DirectionRow): DirectionRef {
  return {
    id: r.id,
    number: r.number,
    name: r.name,
    type: r.type as 'permanent' | 'temporary',
    status: r.status,
  };
}

export async function getDirections(): Promise<DirectionRef[]> {
  const rows = await query<DirectionRow>(
    `SELECT id, number, name, type::text AS type, status::text AS status
       FROM directions
      ORDER BY number`,
  );
  return rows.map(toDirectionRef);
}

export async function getDirectionByNumber(n: number): Promise<DirectionRef | null> {
  const row = await queryOne<DirectionRow>(
    `SELECT id, number, name, type::text AS type, status::text AS status
       FROM directions WHERE number = $1 LIMIT 1`,
    [n],
  );
  return row ? toDirectionRef(row) : null;
}

// ─────────────────────────────────────────────────────────────────────
// Направления атома: home / main / related
// ─────────────────────────────────────────────────────────────────────

interface AtomDirectionRow {
  direction_id: string;
  direction_number: number;
  direction_name: string;
  role: AtomDirectionRole;
  note: string | null;
}

export async function getAtomDirections(atomId: string): Promise<AtomDirections> {
  const rows = await query<AtomDirectionRow>(
    `SELECT m.direction_id,
            d.number AS direction_number,
            d.name   AS direction_name,
            m.role,
            m.note
       FROM atom_direction_map m
       JOIN directions d ON d.id = m.direction_id
      WHERE m.atom_id = $1
      ORDER BY m.role, d.number`,
    [atomId],
  );

  let home: AtomDirection | null = null;
  let main: AtomDirection | null = null;
  const related: AtomDirection[] = [];

  for (const r of rows) {
    const item: AtomDirection = {
      directionId: r.direction_id,
      directionNumber: r.direction_number,
      directionName: r.direction_name,
      role: r.role,
      note: r.note,
    };
    if (r.role === 'home') home = item;
    else if (r.role === 'main') main = item;
    else related.push(item);
  }

  return { home, main, related };
}