// C.0.12.02 — Сервис Арбитража
// Подача, обработка, решение. Срок 3 часа. Промежуточное при задержке.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: escalateToJuryService(arbitrationId, reason, requesterId) —
//     reason в audit_log (entity не принимает reason — TODO для миграции).
//   - B2: submitArbitrationService — проверка connection ДО INSERT.
//   - B3: startProcessingService — atomic UPDATE ... WHERE status = $orig.
//   - B4: decideService — atomic UPDATE ... WHERE status = $orig.
//   - B5: escalateToJuryService — atomic UPDATE ... WHERE status = $orig.
//   - B6: publishInterimService — atomic UPDATE ... WHERE status = $orig.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - reason в escalateToJury — только audit_log; в БД не сохраняется
//     (нужна миграция arbitrations.escalation_reason + правка entity).
//   - publishInterim deadline — «новый deadline» = old + ? (entity скрывает).
//   - canDecide в service — roadmap (реализовано в entity.decide).

import { query, queryOne } from '../../lib/db.js';
import { logAction } from '../audit.js';
import { getById as getConnectionById } from '../connections/service.js';
import { NotFoundError, ConflictError } from '../errors.js';
import type { UUID } from '../types.js';

import {
  createArbitration, startProcessing, decide, escalateToJury,
  publishInterim, isOverdue,
  type Arbitration, type ArbitrationType, type ArbitrationStatus,
} from './entity.js';

interface ArbitrationRow {
  id: string;
  type: ArbitrationType;
  connection_id: string | null;
  signal_id: string | null;
  parties: UUID[] | null;
  question: string;
  decision: string | null;
  status: ArbitrationStatus;
  deadline: Date;
  decided_at: Date | null;
  created_at: Date;
}

function rowToArbitration(row: ArbitrationRow): Arbitration {
  return {
    id: row.id,
    type: row.type,
    connectionId: row.connection_id,
    signalId: row.signal_id,
    parties: row.parties ?? [],
    question: row.question,
    decision: row.decision,
    status: row.status,
    deadline: row.deadline.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getById(id: UUID): Promise<Arbitration> {
  const row = await queryOne<ArbitrationRow>(
    `SELECT id, type, connection_id, signal_id, parties, question, decision,
            status, deadline, decided_at, created_at
       FROM arbitrations WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Арбитраж', id);}
  return rowToArbitration(row);
}

export interface ArbitrationFilter {
  type?: ArbitrationType;
  status?: ArbitrationStatus;
  page?: number;
  perPage?: number;
}

export async function listArbitrations(
  filter: ArbitrationFilter = {},
): Promise<{ data: Arbitration[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.type) { params.push(filter.type); conditions.push(`type = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM arbitrations ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<ArbitrationRow>(
    `SELECT id, type, connection_id, signal_id, parties, question, decision,
            status, deadline, decided_at, created_at
       FROM arbitrations
       ${where}
      ORDER BY deadline ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToArbitration), total };
}

export interface SubmitArbitrationRequest {
  type: ArbitrationType;
  connectionId?: UUID;
  signalId?: UUID;
  parties?: UUID[];
  question: string;
}

export async function submitArbitrationService(
  input: SubmitArbitrationRequest,
  requesterId: UUID,
): Promise<Arbitration> {
  // B2: проверка connection ДО INSERT — иначе висячий арбитраж
  // при невалидном connectionId.
  if (input.connectionId) {
    await getConnectionById(input.connectionId);
  }

  const entity = createArbitration({
    type: input.type,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.signalId ? { signalId: input.signalId } : {}),
    ...(input.parties ? { parties: input.parties } : {}),
    question: input.question,
  });

  await query(
    `INSERT INTO arbitrations
       (id, type, connection_id, signal_id, parties, question, status, deadline)
     VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7)`,
    [
      entity.id, entity.type, entity.connectionId, entity.signalId,
      JSON.stringify(entity.parties), entity.question, entity.deadline,
    ],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'arbitrations.submit', entityType: 'arbitration', entityId: entity.id,
    newValue: { type: entity.type, question: entity.question },
  });

  return entity;
}

// -------- Обработка (B3: atomic) --------

export async function startProcessingService(
  arbitrationId: UUID,
  requesterId: UUID,
): Promise<Arbitration> {
  const a = await getById(arbitrationId);
  startProcessing(a);  // entity-validate (throws на invalid transition)

  const result = await query<{ id: string }>(
    `UPDATE arbitrations SET status = 'in_progress'
      WHERE id = $1 AND status = $2
      RETURNING id`,
    [arbitrationId, a.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Арбитраж изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'arbitrations.start', entityType: 'arbitration', entityId: arbitrationId,
  });

  return getById(arbitrationId);
}

// -------- Решение (B4: atomic) --------

export async function decideService(
  arbitrationId: UUID,
  decisionText: string,
  requesterId: UUID,
): Promise<Arbitration> {
  const a = await getById(arbitrationId);
  decide(a, decisionText);  // entity-validate

  const result = await query<{ id: string }>(
    `UPDATE arbitrations
        SET status = 'decided', decision = $1, decided_at = now()
      WHERE id = $2 AND status = $3
      RETURNING id`,
    [decisionText, arbitrationId, a.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Арбитраж изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'arbitrations.decide', entityType: 'arbitration', entityId: arbitrationId,
    newValue: { decision: decisionText },
  });

  return getById(arbitrationId);
}

// -------- Эскалация в Жюри (B1 + B5: atomic + reason) --------

export async function escalateToJuryService(
  arbitrationId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<Arbitration> {
  const a = await getById(arbitrationId);
  escalateToJury(a);  // entity-validate: type='ownership' обязателен, status не decided/escalated

  const result = await query<{ id: string }>(
    `UPDATE arbitrations SET status = 'escalated_to_jury'
      WHERE id = $1 AND status = $2
      RETURNING id`,
    [arbitrationId, a.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Арбитраж изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'arbitrations.escalate_to_jury', entityType: 'arbitration', entityId: arbitrationId,
    // B1: reason в audit (в БД — TODO для миграции).
    newValue: { reason },
  });

  return getById(arbitrationId);
}

// -------- Промежуточное заключение (B6: atomic) --------

export async function publishInterimService(
  arbitrationId: UUID,
  requesterId: UUID,
): Promise<{ arbitration: Arbitration; interim: string }> {
  const a = await getById(arbitrationId);
  if (a.status === 'decided' || a.status === 'escalated_to_jury') {
    throw new ConflictError('Промежуточное заключение только для активного арбитража (I.3.7)');
  }
  if (!isOverdue(a)) {
    throw new ConflictError('Промежуточное заключение только при задержке > 3ч (I.3.7)');
  }
  const { arbitration, interim } = publishInterim(a);

  const result = await query<{ id: string }>(
    `UPDATE arbitrations SET deadline = $1
      WHERE id = $2 AND status = $3
      RETURNING id`,
    [arbitration.deadline, arbitrationId, a.status],
  );
  if (result.length === 0) {
    throw new ConflictError('Арбитраж изменён параллельным запросом');
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'arbitrations.publish_interim', entityType: 'arbitration', entityId: arbitrationId,
    newValue: { new_deadline: arbitration.deadline },
  });

  return { arbitration: await getById(arbitrationId), interim };
}

export async function listOverdue(): Promise<Arbitration[]> {
  const rows = await query<ArbitrationRow>(
    `SELECT id, type, connection_id, signal_id, parties, question, decision,
            status, deadline, decided_at, created_at
       FROM arbitrations
      WHERE status IN ('submitted', 'in_progress') AND deadline < now()
      ORDER BY deadline ASC
      LIMIT 100`,
  );
  return rows.map(rowToArbitration);
}

export async function getPrecedents(type?: ArbitrationType): Promise<Arbitration[]> {
  const params: unknown[] = [];
  const whereType = type
    ? (params.push(type), `AND type = $${params.length}`)
    : '';
  const rows = await query<ArbitrationRow>(
    `SELECT id, type, connection_id, signal_id, parties, question, decision,
            status, deadline, decided_at, created_at
       FROM arbitrations
      WHERE status = 'decided' ${whereType}
      ORDER BY decided_at DESC
      LIMIT 100`,
    params,
  );
  return rows.map(rowToArbitration);
}

export { isOverdue };