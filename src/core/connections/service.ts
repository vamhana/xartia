// C.0.11.02 — Сервис Коннекта
// Запуск, диагностика, сбор позиций, фиксация результата, протокол.
// Диагностика — 1 час (I.3.2). Протокол обязателен (I.3.6).
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: startConnectionService — транзакция (INSERT connection + UPDATE signals).
//   - B2: recordPositionService — atomic UPDATE ... WHERE status = $orig
//         (было: getById → addPosition → UPDATE без WHERE → race).
//   - B3: recordPositionService — проверка directionId === requesterDirectionId
//         (было: любая direction пишет позицию за любую).
//   - B4: finishDiagnosticsService — atomic UPDATE ... WHERE status.
//   - B5: setResultService — UPDATE ставит status = 'finished' (было: только result;
//         спека: «результат переводит в finished»).
//   - B6: attachProtocolService — проверка status = 'finished' (было: только result).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - moderatorId из body — любой connection:C назначает любого модератора.
//     Проверка «модератор существует и имеет connection:E» — roadmap.
//   - Валидация «1 час или явное завершение» (finishDiagnostics) — в entity (не проверено).

import { query, queryOne, transaction } from '../../lib/db.js';
import { emitConnectionStarted } from '../../ws/signals.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../errors.js';
import { getById as getSignalById } from '../signals/service.js';
import type { UUID } from '../types.js';

import {
  startConnection, addPosition, validatePosition, finishDiagnostics, setResult,
  type Connection, type ConnectionPosition, type ConnectionResult,
} from './entity.js';

interface ConnectionRow {
  id: string;
  signal_id: string;
  moderator_id: string;
  status: string;
  positions: ConnectionPosition[] | null;
  cause: string | null;
  result: ConnectionResult | null;
  protocol: Record<string, unknown> | null;
  started_at: Date;
  finished_at: Date | null;
  diagnostic_deadline: Date;
}

function rowToConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    signalId: row.signal_id,
    moderatorId: row.moderator_id,
    status: row.status as Connection['status'],
    positions: row.positions ?? [],
    cause: row.cause,
    result: row.result,
    protocol: row.protocol,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    diagnosticDeadline: row.diagnostic_deadline.toISOString(),
  };
}

// -------- Чтение --------

export async function getById(connectionId: UUID): Promise<Connection> {
  const row = await queryOne<ConnectionRow>(
    `SELECT id, signal_id, moderator_id, status, positions, cause, result, protocol,
            started_at, finished_at, diagnostic_deadline
       FROM connections WHERE id = $1`,
    [connectionId],
  );
  if (!row) {throw new NotFoundError('Коннект', connectionId);}
  return rowToConnection(row);
}

export async function getBySignal(signalId: UUID): Promise<Connection | null> {
  const row = await queryOne<ConnectionRow>(
    `SELECT id, signal_id, moderator_id, status, positions, cause, result, protocol,
            started_at, finished_at, diagnostic_deadline
       FROM connections
      WHERE signal_id = $1
      ORDER BY started_at DESC LIMIT 1`,
    [signalId],
  );
  return row ? rowToConnection(row) : null;
}

// -------- Запуск (B1: транзакция) --------

export interface StartConnectionRequest {
  signalId: UUID;
  moderatorId: UUID;
}

export async function startConnectionService(
  input: StartConnectionRequest,
  requesterId: UUID,
): Promise<Connection> {
  await getSignalById(input.signalId);  // NotFoundError если сигнала нет

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM connections
      WHERE signal_id = $1 AND status <> 'finished'
      LIMIT 1`,
    [input.signalId],
  );
  if (existing) {throw new ConflictError('Активный Коннект уже существует');}

  const entity = startConnection(input.signalId, input.moderatorId);

  // B1: INSERT connection + UPDATE signal — атомарно.
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO connections
         (id, signal_id, moderator_id, status, positions, diagnostic_deadline)
       VALUES ($1, $2, $3, 'started', '[]'::jsonb, $4)`,
      [entity.id, entity.signalId, entity.moderatorId, entity.diagnosticDeadline],
    );
    // run → connect (только если run; новые сигналы — не трогаем).
    await client.query(
      `UPDATE signals SET status = 'connect', updated_at = now()
        WHERE id = $1 AND status = 'run'`,
      [input.signalId],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connections.start', entityType: 'connection', entityId: entity.id,
    newValue: { signal_id: input.signalId, moderator_id: input.moderatorId },
  });

  try {
    await emitConnectionStarted(input.signalId, entity.id, input.moderatorId);
  } catch {
    // best-effort: БД уже зафиксирована
  }

  return entity;
}

// -------- Позиции (B2, B3) --------

export interface PositionRequest {
  directionId: UUID;
  claim: string;
  data: string;
  cause: string;
  needs: string;
}

export async function recordPositionService(
  connectionId: UUID,
  input: PositionRequest,
  requesterId: UUID,
  requesterDirectionId: UUID | null,
): Promise<Connection> {
  // B3: позиция — только за своё направление. requesterDirectionId === null
  // (архитектор без направления) — разрешено (системная роль).
  if (requesterDirectionId !== null && input.directionId !== requesterDirectionId) {
    throw new ForbiddenError('Позицию можно записать только за своё направление');
  }

  validatePosition(input);
  const connection = await getById(connectionId);
  if (connection.status === 'finished') {
    throw new ConflictError('Коннект завершён');
  }

  const position: ConnectionPosition = {
    directionId: input.directionId,
    claim: input.claim.trim(),
    data: input.data.trim(),
    cause: input.cause.trim(),
    needs: input.needs.trim(),
    recordedAt: new Date().toISOString(),
  };
  const updated = addPosition(connection, position);

  // B2: atomic UPDATE ... WHERE status = $orig + jsonb merge через ||
  // (было: last-write-wins для параллельных позиций).
  // positions || jsonb_build_array($new_position) — атомарный append.
  const result = await query<{ id: string }>(
    `UPDATE connections
        SET positions = positions || jsonb_build_array($1::jsonb),
            status = $2
      WHERE id = $3 AND status = $4
      RETURNING id`,
    [JSON.stringify(position), updated.status, connectionId, connection.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Коннект изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connections.position', entityType: 'connection', entityId: connectionId,
    newValue: { direction_id: input.directionId },
  });

  return getById(connectionId);
}

// -------- Диагностика (B4) --------

export async function finishDiagnosticsService(
  connectionId: UUID,
  cause: string,
  requesterId: UUID,
): Promise<Connection> {
  const connection = await getById(connectionId);
  finishDiagnostics(connection, cause);  // entity-validate (проверка статуса)

  // B4: atomic UPDATE ... WHERE status = $orig.
  const result = await query<{ id: string }>(
    `UPDATE connections
        SET status = 'finished', cause = $1, finished_at = now()
      WHERE id = $2 AND status = $3
      RETURNING id`,
    [cause, connectionId, connection.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Коннект изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connections.finish_diagnostics', entityType: 'connection', entityId: connectionId,
    newValue: { cause },
  });

  return getById(connectionId);
}

// -------- Результат (B5) --------

export async function setResultService(
  connectionId: UUID,
  result: ConnectionResult,
  requesterId: UUID,
): Promise<Connection> {
  const connection = await getById(connectionId);
  if (connection.status === 'finished' && connection.result !== null) {
    throw new ConflictError('Результат уже установлен');
  }
  setResult(connection, result);  // entity-validate

  // B5: спека — «результат переводит connection в finished».
  // Было: UPDATE только result (без status).
  const upd = await query<{ id: string }>(
    `UPDATE connections
        SET result = $1, status = 'finished', finished_at = now()
      WHERE id = $2 AND status <> 'finished'
      RETURNING id`,
    [result, connectionId],
  );
  if (upd.length === 0) {
    // Уже finished с result = NULL? Значит finishDiagnostics прошёл, ставим result.
    const upd2 = await query<{ id: string }>(
      `UPDATE connections SET result = $1 WHERE id = $2 AND result IS NULL RETURNING id`,
      [result, connectionId],
    );
    if (upd2.length === 0) {
      throw new ConflictError('Коннект изменён параллельным запросом');
    }
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connections.set_result', entityType: 'connection', entityId: connectionId,
    newValue: { result },
  });

  return getById(connectionId);
}

// -------- Протокол (B6) --------

export async function attachProtocolService(
  connectionId: UUID,
  protocol: Record<string, unknown>,
  requesterId: UUID,
): Promise<Connection> {
  const connection = await getById(connectionId);

  // B6: протокол — только для finished (спека I.3.6).
  if (connection.status !== 'finished') {
    throw new ConflictError('Протокол можно приложить только к завершённому Коннекту');
  }
  if (!connection.result) {
    throw new ValidationError('Сначала установите результат (I.3.6)');
  }

  await query(
    `UPDATE connections SET protocol = $1::jsonb WHERE id = $2`,
    [JSON.stringify(protocol), connectionId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'connections.attach_protocol', entityType: 'connection', entityId: connectionId,
  });

  return getById(connectionId);
}

// -------- Список --------

export async function listByDirection(directionId: UUID): Promise<Connection[]> {
  const rows = await query<ConnectionRow>(
    `SELECT id, signal_id, moderator_id, status, positions, cause, result, protocol,
            started_at, finished_at, diagnostic_deadline
       FROM connections
      WHERE positions @> $1::jsonb OR moderator_id = $2
      ORDER BY started_at DESC LIMIT 100`,
    [JSON.stringify([{ directionId }]), directionId],
  );
  return rows.map(rowToConnection);
}

export async function listAll(): Promise<Connection[]> {
  const rows = await query<ConnectionRow>(
    `SELECT id, signal_id, moderator_id, status, positions, cause, result, protocol,
            started_at, finished_at, diagnostic_deadline
       FROM connections
      ORDER BY started_at DESC LIMIT 100`,
  );
  return rows.map(rowToConnection);
}

export { getSignalById };