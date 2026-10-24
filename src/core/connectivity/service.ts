// C.0.34.02 — Сервис Коннективности
// Очередь, маршрутизация, префильтрация, просрочки, эскалации.
//
// Техдолг закрыт (v0.0.01 → v0.0.03):
//   - B3:  routeSignal — проверка статуса сигнала (нельзя для completed/rejected).
//   - B5:  routeSignal — INSERT item + UPDATE signal + lead_direction_id в одной tx.
//   - B17: routeSignal — UPDATE signals.lead_direction_id.
//   - P9:  escalateItem — atomic UPDATE connectivity_items WHERE status <> 'escalated';
//          UPDATE signals выполняется только если item действительно обновлён
//          (rowCount > 0). Иначе — ConflictError (race-safe).

import { query, queryOne, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { redis } from '../../lib/redis.js';
import {
  emitItemRouted,
  emitItemOverdue,
  emitItemEscalated,
} from '../../ws/connectivity.js';
import { emitLeadDirectionSet } from '../../ws/signals.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError } from '../errors.js';
import { getById as getSignalById } from '../signals/service.js';
import type { UUID, Priority } from '../types.js';

import {
  getDeadline, isOverdue, getNotificationTime,
  prefilter as prefilterEntity,
  validateRouting,
  type ConnectivityItem, type ConnStatus, type PrefilterResult,
} from './entity.js';

function toWsItem(item: ConnectivityItem) {
  return {
    id: item.id,
    signalId: item.signalId,
    currentDirectionId: item.currentDirectionId,
    targetDirectionId: item.targetDirectionId,
    priority: item.priority,
    deadline: item.deadline,
    status: item.status,
    iterations: item.iterations,
    createdAt: item.createdAt,
    routedAt: item.routedAt,
    escalatedAt: item.escalatedAt,
  };
}

interface ItemRow {
  id: string;
  signal_id: string;
  current_direction_id: string | null;
  target_direction_id: string | null;
  priority: Priority;
  deadline: Date;
  status: ConnStatus;
  iterations: number;
  created_at: Date;
  routed_at: Date | null;
  escalated_at: Date | null;
}

function rowToItem(row: ItemRow): ConnectivityItem {
  return {
    id: row.id,
    signalId: row.signal_id,
    currentDirectionId: row.current_direction_id,
    targetDirectionId: row.target_direction_id,
    priority: row.priority,
    deadline: row.deadline.toISOString(),
    status: row.status,
    iterations: row.iterations,
    createdAt: row.created_at.toISOString(),
    routedAt: row.routed_at ? row.routed_at.toISOString() : null,
    escalatedAt: row.escalated_at ? row.escalated_at.toISOString() : null,
  };
}

// -------- Очередь (без изменений) --------

export interface QueueFilter {
  priority?: Priority;
  status?: ConnStatus;
  directionId?: UUID;
}

export async function getQueue(filter: QueueFilter = {}): Promise<ConnectivityItem[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.priority) { params.push(filter.priority); conditions.push(`priority = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
  if (filter.directionId) {
    params.push(filter.directionId);
    conditions.push(`(current_direction_id = $${params.length} OR target_direction_id = $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query<ItemRow>(
    `SELECT id, signal_id, current_direction_id, target_direction_id, priority,
            deadline, status, iterations, created_at, routed_at, escalated_at
       FROM connectivity_items
       ${where}
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                      WHEN 'standard' THEN 3 ELSE 4 END,
        deadline ASC
      LIMIT 200`,
    params,
  );
  return rows.map(rowToItem);
}

export async function getById(itemId: UUID): Promise<ConnectivityItem> {
  const row = await queryOne<ItemRow>(
    `SELECT id, signal_id, current_direction_id, target_direction_id, priority,
            deadline, status, iterations, created_at, routed_at, escalated_at
       FROM connectivity_items WHERE id = $1`,
    [itemId],
  );
  if (!row) {throw new NotFoundError('Элемент очереди', itemId);}
  return rowToItem(row);
}

export async function getOverdue(): Promise<ConnectivityItem[]> {
  const rows = await query<ItemRow>(
    `SELECT id, signal_id, current_direction_id, target_direction_id, priority,
            deadline, status, iterations, created_at, routed_at, escalated_at
       FROM connectivity_items
      WHERE status IN ('queued', 'routed') AND deadline < now()
      ORDER BY deadline ASC
      LIMIT 100`,
  );
  return rows.map(rowToItem);
}

// -------- Префильтрация (без изменений) --------

export async function prefilterSignal(signalId: UUID): Promise<PrefilterResult> {
  const signal = await getSignalById(signalId);
  const result = prefilterEntity({
    id: signal.id,
    description: signal.description,
    justification: signal.justification,
    priority: signal.priority,
  });
  await query(
    `INSERT INTO prefilter_results (id, signal_id, format_ok, etiquette_ok, violations)
     VALUES ($1, $2, $3, $4, $5)`,
    [newUUID(), signalId, result.formatOk, result.etiquetteOk, JSON.stringify(result.violations)],
  );
  return result;
}

// -------- Маршрутизация (B3, B5, B17) --------

export interface RouteRequest {
  signalId: UUID;
  targetDirectionId: UUID;
  reason?: string;
}

export async function routeSignal(
  input: RouteRequest,
  requesterId: UUID,
): Promise<ConnectivityItem> {
  const signal = await getSignalById(input.signalId);

  // B3: закрытый сигнал нельзя маршрутизировать.
  if (signal.status === 'completed' || signal.status === 'rejected') {
    throw new ConflictError(`Сигнал ${signal.status} — нельзя маршрутизировать`);
  }

  if (signal.directions.length > 0) {
    validateRouting({
      targetDirectionId: input.targetDirectionId,
      allowedDirections: signal.directions,
    });
  }

  // B5: всё в одной транзакции — item + сигнал (status/lead_direction_id).
  const itemId = newUUID();
  const deadline = getDeadline(signal.priority);

  const created = await transaction(async (client) => {
    // Проверка existing внутри tx (FOR UPDATE — на случай параллельного route).
    const existingRes = await client.query<ItemRow>(
      `SELECT id, signal_id, current_direction_id, target_direction_id, priority,
              deadline, status, iterations, created_at, routed_at, escalated_at
         FROM connectivity_items
        WHERE signal_id = $1 AND status IN ('queued', 'routed')
        LIMIT 1
        FOR UPDATE`,
      [input.signalId],
    );
    const existing = existingRes.rows[0];

    if (existing) {
      // Reroute: обновляем target + status='routed'.
      await client.query(
        `UPDATE connectivity_items
            SET target_direction_id = $1, status = 'routed', routed_at = now()
          WHERE id = $2`,
        [input.targetDirectionId, existing.id],
      );
      // B17: lead_direction_id обновляется на target.
      await client.query(
        `UPDATE signals SET lead_direction_id = $1, updated_at = now() WHERE id = $2`,
        [input.targetDirectionId, input.signalId],
      );
      return { itemId: existing.id, isNew: false };
    }

    // Новый item.
    await client.query(
      `INSERT INTO connectivity_items
         (id, signal_id, current_direction_id, target_direction_id, priority,
          deadline, status, iterations, routed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'routed', 0, now())`,
      [
        itemId, input.signalId,
        signal.leadDirectionId, input.targetDirectionId,
        signal.priority, deadline,
      ],
    );
    // B17: lead_direction_id обновляется на target.
    // Status: new → run (только если new; не трогаем run/connect).
    await client.query(
      `UPDATE signals
          SET status = CASE WHEN status = 'new' THEN 'run' ELSE status END,
              lead_direction_id = $1,
              updated_at = now()
        WHERE id = $2`,
      [input.targetDirectionId, input.signalId],
    );

    return { itemId, isNew: true };
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: created.isNew ? 'connectivity.route' : 'connectivity.reroute',
    entityType: 'connectivity_item', entityId: created.itemId,
    newValue: {
      signal_id: input.signalId,
      target_direction_id: input.targetDirectionId,
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });

  // WS-эмиссия (best-effort — БД уже зафиксирована).
  await emitLeadDirectionSet(input.signalId, input.targetDirectionId);
  const routed = await getById(created.itemId);
  await emitItemRouted(toWsItem(routed));

  return routed;
}

// -------- Эскалация (P9: атомарность) --------

export async function escalateItem(
  itemId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<ConnectivityItem> {
  const item = await getById(itemId);
  if (item.status === 'escalated') {
    throw new ConflictError('Уже эскалирован');
  }

  // P9: atomic UPDATE connectivity_items WHERE status <> 'escalated'.
  // UPDATE signals — только если item действительно переведён (rowCount > 0).
  // Иначе транзакция коммитится «впустую» (или откатывается при конфликте),
  // а мы бросаем ConflictError для клиента.
  const affected = await transaction(async (client) => {
    const res = await client.query<{ id: string }>(
      `UPDATE connectivity_items
          SET status = 'escalated', escalated_at = now()
        WHERE id = $1 AND status <> 'escalated'
        RETURNING id`,
      [itemId],
    );
    if ((res.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE signals SET status = 'connect', updated_at = now()
          WHERE id = $1 AND status NOT IN ('completed', 'rejected')`,
        [item.signalId],
      );
    }
    return res;
  });

  if ((affected.rowCount ?? 0) === 0) {
    throw new ConflictError('Уже эскалирован (race)');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connectivity.escalate', entityType: 'connectivity_item', entityId: itemId,
    newValue: { reason },
  });

  const updated = await getById(itemId);
  await emitItemEscalated(toWsItem(updated), null);
  return updated;
}

// -------- Мониторинг просрочек (без изменений) --------

export async function checkTimeouts(): Promise<{
  overdue: number;
  escalated: number;
}> {
  const overdueItems = await getOverdue();
  let escalatedCount = 0;

  for (const item of overdueItems) {
    if (item.iterations >= 3) {
      await query(
        `UPDATE connectivity_items SET status = 'escalated', escalated_at = now() WHERE id = $1`,
        [item.id],
      );
      const updated = await getById(item.id);
      await emitItemEscalated(toWsItem(updated), null);
      escalatedCount++;
    } else {
      await query(
        `UPDATE connectivity_items SET status = 'overdue' WHERE id = $1 AND status = 'queued'`,
        [item.id],
      );
      const updated = await getById(item.id);
      await emitItemOverdue(toWsItem(updated));
    }
  }

  return { overdue: overdueItems.length, escalated: escalatedCount };
}

export async function shouldNotify(item: ConnectivityItem): Promise<boolean> {
  const notifyAt = getNotificationTime(item);
  const now = Date.now();
  const notifyTime = new Date(notifyAt).getTime();
  if (now < notifyTime) {return false;}

  const key = `connectivity:notified:${item.id}`;
  const already = await redis.get(key);
  if (already) {return false;}
  await redis.set(key, '1', 'EX', 86400);
  return true;
}

export async function getStats(): Promise<{
  queued: number; routed: number; overdue: number; escalated: number;
}> {
  const row = await queryOne<{
    queued: string; routed: string; overdue: string; escalated: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::text AS queued,
       COUNT(*) FILTER (WHERE status = 'routed')::text AS routed,
       COUNT(*) FILTER (WHERE status = 'overdue')::text AS overdue,
       COUNT(*) FILTER (WHERE status = 'escalated')::text AS escalated
     FROM connectivity_items`,
  );
  return {
    queued: parseInt(row?.queued ?? '0', 10),
    routed: parseInt(row?.routed ?? '0', 10),
    overdue: parseInt(row?.overdue ?? '0', 10),
    escalated: parseInt(row?.escalated ?? '0', 10),
  };
}

export async function listBySignal(signalId: UUID): Promise<ConnectivityItem[]> {
  const rows = await query<ItemRow>(
    `SELECT id, signal_id, current_direction_id, target_direction_id, priority,
            deadline, status, iterations, created_at, routed_at, escalated_at
       FROM connectivity_items WHERE signal_id = $1 ORDER BY created_at DESC`,
    [signalId],
  );
  return rows.map(rowToItem);
}

export { isOverdue };