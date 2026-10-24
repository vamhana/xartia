// C.0.13.02 — Сервис Всеобщего прогона
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: submitRunResponse проверяет directionId === requesterDirectionId.
//   - B2: INSERT с catch isUniqueViolation → 409 (было: 500 при race).
//   - B3: atomic UPDATE responded_directions = responded_directions + 1
//         (было: last-write-wins на in-memory increment).
//   - B4: totalDirections уважает signal.directions (было: count(ALL active),
//         run никогда не завершался при ограниченной аудитории).
//   - B5: submitRunResponse проверяет signal.directions.
//   - B6: submitRunResponse — validateResponse (clarify без data → 422).
//   - B8: listRunResponses возвращает полные поля (data/consequences/needs).
//   - B9: checkTimeouts — atomic UPDATE ... WHERE status IN (...).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - checkTimeouts: 24h vs PRIORITY_DEADLINES_MS (spec-fix).
//   - signal.status не обновляется при timeout (I.2.3 «отсутствие = не согласие»
//     — нужна семантика «signal остаётся в текущем статусе или move в connect»).

import { query, queryOne, transaction, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { isQuantumAccelerationActive } from '../regimes/service.js';
import { validateResponse } from '../signals/entity.js';
import { getById as getSignalById } from '../signals/service.js';
import type { UUID, SignalResponseType } from '../types.js';

import {
  startRun, aggregate, getResponseProgress, canProceedToPlan,
  getDeadlineForRun, getAcceleratedDeadline,
  type UniversalRun, type RunType, type RunStatus, type RunSummary,
} from './entity.js';

interface RunRow {
  id: string;
  signal_id: string;
  type: RunType;
  started_at: Date;
  finished_at: Date | null;
  status: RunStatus;
  total_directions: number;
  responded_directions: number;
}

function rowToRun(row: RunRow): UniversalRun {
  return {
    id: row.id,
    signalId: row.signal_id,
    type: row.type,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status,
    totalDirections: row.total_directions,
    respondedDirections: row.responded_directions,
  };
}

export async function getById(id: UUID): Promise<UniversalRun> {
  const row = await queryOne<RunRow>(
    `SELECT id, signal_id, type, started_at, finished_at, status,
            total_directions, responded_directions
       FROM universal_runs WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Прогон', id);}
  return rowToRun(row);
}

export async function listBySignal(signalId: UUID): Promise<UniversalRun[]> {
  const rows = await query<RunRow>(
    `SELECT id, signal_id, type, started_at, finished_at, status,
            total_directions, responded_directions
       FROM universal_runs WHERE signal_id = $1 ORDER BY started_at DESC`,
    [signalId],
  );
  return rows.map(rowToRun);
}

// -------- Запуск (B4: signal.directions) --------

export interface RunRequest {
  signalId: UUID;
  type: RunType;
}

export async function runService(
  input: RunRequest,
  requesterId: UUID,
): Promise<UniversalRun> {
  const signal = await getSignalById(input.signalId);
  if (signal.status === 'completed' || signal.status === 'rejected') {
    throw new ConflictError(`Сигнал ${signal.status} — нельзя запустить прогон`);
  }

  // B4: signal.directions — ограничение аудитории. Если задано — только эти
  // направления участвуют в прогоне (только активные).
  let totalDirections: number;
  if (signal.directions.length > 0) {
    const activeRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM directions
        WHERE status = 'active' AND id = ANY($1::uuid[])`,
      [signal.directions],
    );
    totalDirections = parseInt(activeRow?.cnt ?? '0', 10);
    if (totalDirections === 0) {
      throw new ConflictError('Нет активных направлений среди указанных в сигнале');
    }
  } else {
    const countRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM directions WHERE status = 'active'`,
    );
    totalDirections = parseInt(countRow?.cnt ?? '0', 10);
    if (totalDirections === 0) {throw new ConflictError('Нет активных направлений');}
  }

  const entity = startRun({
    id: newUUID(),
    signalId: input.signalId,
    type: input.type,
    totalDirections,
  });

  await query(
    `INSERT INTO universal_runs
       (id, signal_id, type, status, total_directions, responded_directions)
     VALUES ($1, $2, $3, 'started', $4, 0)`,
    [entity.id, entity.signalId, entity.type, entity.totalDirections],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'universal_runs.run', entityType: 'universal_run', entityId: entity.id,
    newValue: { signal_id: input.signalId, type: input.type, total_directions: totalDirections },
  });

  const accelerated = await isQuantumAccelerationActive();
  void getDeadlineForRun(input.type, signal.priority);
  void getAcceleratedDeadline(input.type, signal.priority, accelerated);

  return entity;
}

// -------- Ответы (B1, B2, B3, B5, B6) --------

export interface RunResponseRequest {
  directionId: UUID;
  response: SignalResponseType;
  justification: string;
  data?: Record<string, unknown>;
  consequences?: string;
  needs?: string;
}

export async function submitRunResponse(
  runId: UUID,
  input: RunResponseRequest,
  requesterId: UUID,
  requesterDirectionId: UUID | null,
): Promise<{ run: UniversalRun; responseId: UUID }> {
  // B1: направление ответа — только своё.
  if (requesterDirectionId !== null && input.directionId !== requesterDirectionId) {
    throw new ForbiddenError('Отвечать можно только за своё направление');
  }

  const run = await getById(runId);
  if (run.status === 'aggregated' || run.status === 'finished') {
    throw new ConflictError(`Прогон ${run.status} — ответы не принимаются`);
  }

  // B5: signal.directions — ограничение аудитории.
  const signal = await getSignalById(run.signalId);
  if (signal.directions.length > 0 && !signal.directions.includes(input.directionId)) {
    throw new ForbiddenError('Направление не входит в аудиторию сигнала');
  }

  // B6: валидация clarify (requires data) — консистентно с A.1.10.01.
  const validation = validateResponse({
    response: input.response,
    justification: input.justification,
    data: input.data,
    consequences: input.consequences,
  });
  if (!validation.valid) {
    throw new ValidationError('Неверный ответ', validation.errors.map((e) => ({
      path: 'response', message: e,
    })));
  }

  const responseId = newUUID();

  await transaction(async (client) => {
    // B2: INSERT + catch unique → 409 (было: 500 при race).
    try {
      await client.query(
        `INSERT INTO responses
           (id, signal_id, run_id, direction_id, response, justification, data, consequences, needs)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          responseId, run.signalId, runId, input.directionId,
          input.response, input.justification,
          input.data ? JSON.stringify(input.data) : null,
          input.consequences ?? null, input.needs ?? null,
        ],
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError('Направление уже ответило в этом прогоне');
      }
      throw e;
    }

    // B3: atomic UPDATE — increment через SQL, статус computed на сервере.
    // CASE возвращает text → нужен явный каст к run_status_enum,
    // иначе PG: "column status is of type run_status_enum but expression is of type text".
    const upd = await client.query<{ responded_directions: number; status: string }>(
      `UPDATE universal_runs
          SET responded_directions = responded_directions + 1,
              status = (
                CASE WHEN responded_directions + 1 >= total_directions
                     THEN 'aggregated'
                     ELSE 'collecting'
                END
              )::run_status_enum,
              finished_at = CASE WHEN responded_directions + 1 >= total_directions
                                 THEN now() ELSE finished_at END
        WHERE id = $1 AND status IN ('started', 'collecting')
        RETURNING responded_directions, status`,
      [runId],
    );
    if (upd.rows.length === 0) {
      throw new ConflictError('Прогон изменён параллельным запросом');
    }
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'universal_runs.response', entityType: 'universal_run', entityId: runId,
    newValue: { direction_id: input.directionId, response: input.response },
  });

  return { run: await getById(runId), responseId };
}

// -------- Чтение ответов (B8: full fields) --------

export async function listRunResponses(runId: UUID): Promise<Array<{
  id: UUID;
  directionId: UUID;
  response: SignalResponseType;
  justification: string;
  data: Record<string, unknown> | null;
  consequences: string | null;
  needs: string | null;
  createdAt: string;
}>> {
  await getById(runId);  // NotFoundError если нет

  const rows = await query<{
    id: string;
    direction_id: string;
    response: SignalResponseType;
    justification: string | null;
    data: Record<string, unknown> | null;
    consequences: string | null;
    needs: string | null;
    created_at: Date;
  }>(
    `SELECT id, direction_id, response, justification, data, consequences, needs, created_at
       FROM responses
      WHERE run_id = $1
      ORDER BY created_at`,
    [runId],
  );
  return rows.map((r) => ({
    id: r.id,
    directionId: r.direction_id,
    response: r.response,
    justification: r.justification ?? '',
    data: r.data,
    consequences: r.consequences,
    needs: r.needs,
    createdAt: r.created_at.toISOString(),
  }));
}

// -------- Агрегация / progress / canProceed (без изменений) --------

export async function aggregateRun(runId: UUID): Promise<RunSummary> {
  const responses = await listRunResponses(runId);
  return aggregate(responses.map((r) => ({
    directionId: r.directionId,
    response: r.response,
  })));
}

export async function getProgress(runId: UUID): Promise<{
  responded: number;
  total: number;
  percent: number;
}> {
  const run = await getById(runId);
  return {
    responded: run.respondedDirections,
    total: run.totalDirections,
    percent: getResponseProgress(run),
  };
}

export async function canProceed(runId: UUID): Promise<{ allowed: boolean; reason?: string }> {
  const responses = await listRunResponses(runId);
  return canProceedToPlan(responses.map((r) => ({ response: r.response })));
}

// -------- Cron (B9: atomic) --------

export async function checkTimeouts(): Promise<{ timedOut: number }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM universal_runs
      WHERE status IN ('started', 'collecting')
        AND started_at < now() - interval '24 hours'
      LIMIT 100`,
  );

  let timedOut = 0;
  for (const row of rows) {
    // B9: atomic — если другой cron уже finished, UPDATE вернёт 0 строк.
    const upd = await query<{ id: string }>(
      `UPDATE universal_runs
          SET status = 'finished', finished_at = now()
        WHERE id = $1 AND status IN ('started', 'collecting')
        RETURNING id`,
      [row.id],
    );
    if (upd.length > 0) {timedOut++;}
  }

  return { timedOut };
}