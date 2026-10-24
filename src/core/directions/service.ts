// C.0.03.02 — Сервис направлений
// Список, карточка, создание. ЗПО, профессии, роли, Советы — в следующих срезах.

import { query, queryOne } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { NotFoundError } from '../errors.js';
import type { UUID, DirectionType, DirectionStatus } from '../types.js';

import type { Direction, Zones } from './entity.js';

const CACHE_KEY = 'directions:all';
const CACHE_TTL = 300; // 5 минут

interface DirectionRow {
  id: string;
  number: number;
  name: string;
  type: DirectionType;
  status: DirectionStatus;
  zone_exclusive: string[] | null;
  zone_shared: string[] | null;
  zone_adjacent: string[] | null;
  council_id: string | null;
  created_at: Date;
  abolished_at: Date | null;
}

function rowToDirection(row: DirectionRow): Direction {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    type: row.type,
    status: row.status,
    zones: {
      exclusive: row.zone_exclusive ?? [],
      shared: row.zone_shared ?? [],
      adjacent: row.zone_adjacent ?? [],
    },
    councilId: row.council_id,
    createdAt: row.created_at.toISOString(),
    abolishedAt: row.abolished_at ? row.abolished_at.toISOString() : null,
  };
}

export async function list(): Promise<Direction[]> {
  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as Direction[];
    } catch {
      // ignore
    }
  }

  const rows = await query<DirectionRow>(
    `SELECT id, number, name, type, status,
            zone_exclusive, zone_shared, zone_adjacent,
            council_id, created_at, abolished_at
       FROM directions
      WHERE status <> 'abolished'
      ORDER BY number`,
  );

  const result = rows.map(rowToDirection);
  await redis.set(CACHE_KEY, JSON.stringify(result), 'EX', CACHE_TTL);
  return result;
}

export async function getById(directionId: UUID): Promise<Direction> {
  const row = await queryOne<DirectionRow>(
    `SELECT id, number, name, type, status,
            zone_exclusive, zone_shared, zone_adjacent,
            council_id, created_at, abolished_at
       FROM directions
      WHERE id = $1`,
    [directionId],
  );
  if (!row) {throw new NotFoundError('Направление', directionId);}
  return rowToDirection(row);
}

export async function getByNumber(number: number): Promise<Direction> {
  const row = await queryOne<DirectionRow>(
    `SELECT id, number, name, type, status,
            zone_exclusive, zone_shared, zone_adjacent,
            council_id, created_at, abolished_at
       FROM directions
      WHERE number = $1`,
    [number],
  );
  if (!row) {throw new NotFoundError('Направление', String(number));}
  return rowToDirection(row);
}

export async function getZones(directionId: UUID): Promise<Zones> {
  const d = await getById(directionId);
  return d.zones;
}

export async function invalidateCache(): Promise<void> {
  await redis.del(CACHE_KEY);
}

export interface RoleListItem {
  id: string;
  directionId: string;
  directionName: string;
  name: string;
  type: string;
}

export async function listRoles(directionId?: string): Promise<RoleListItem[]> {
  const params: unknown[] = [];
  let where = 'WHERE r.active = true';
  if (directionId) {
    params.push(directionId);
    where += ` AND r.direction_id = $${params.length}`;
  }
  const rows = await query<{
    id: string;
    direction_id: string;
    direction_name: string;
    name: string;
    type: string;
  }>(
    `SELECT r.id, r.direction_id, d.name AS direction_name, r.name, r.type
       FROM roles r
       JOIN directions d ON d.id = r.direction_id
       ${where}
      ORDER BY d.number, r.name`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    directionId: r.direction_id,
    directionName: r.direction_name,
    name: r.name,
    type: r.type,
  }));
}