// C.1.02.02 — Лента истории паспорта: чтение (append-only).
// В Фазе 1 — только своя история (participantId = auth.participantId).
// Чужая история — через GET /passport/people/:id (шаг 5, с visibility).

import { query, queryOne } from '../../lib/db.js';
import type { HistoryEventType, HistoryItem } from './types.js';
import type { UUID } from '../types.js';

interface HistoryRaw {
  id: string;
  atom_id: string | null;
  event_type: HistoryEventType;
  payload: Record<string, unknown>;
  actor_id: string | null;
  created_at: Date;
}

export interface HistoryOptions {
  participantId: UUID;
  atomId?: string;
  /** ISO-8601. Вернёт события с created_at >= since. */
  since?: string;
  limit?: number;
  offset?: number;
}

export async function getHistory(
  opts: HistoryOptions,
): Promise<{ items: HistoryItem[]; total: number }> {
  const cond: string[] = ['participant_id = $1'];
  const params: unknown[] = [opts.participantId];

  if (opts.atomId) {
    params.push(opts.atomId);
    cond.push(`atom_id = $${params.length}`);
  }
  if (opts.since) {
    params.push(opts.since);
    cond.push(`created_at >= $${params.length}::timestamptz`);
  }

  const where = `WHERE ${cond.join(' AND ')}`;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const totalRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM passport_history_events ${where}`,
    params,
  );

  params.push(limit, offset);
  const rows = await query<HistoryRaw>(
    `SELECT id, atom_id, event_type, payload, actor_id, created_at
       FROM passport_history_events ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      atomId: r.atom_id,
      eventType: r.event_type,
      payload: r.payload,
      actorId: r.actor_id,
      createdAt: r.created_at.toISOString(),
    })),
    total: parseInt(totalRow?.total ?? '0', 10),
  };
}