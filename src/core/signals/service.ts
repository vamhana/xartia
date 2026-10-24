// C.0.10.02 — Сервис сигналов
// Создание, ответы, эскалация. Маршрутизация — в connectivity.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: markAsEscalated меняет статус сигнала на 'connect' (было: только лог).
//   - B4: clarify при iterations >= 3 → 409 (было: без границы).
//   - B12: now внутри retry-цикла (было: вне — баг через полночь).
//   - B2: respondService принимает requesterDirectionId, проверяет
//         directionId === requesterDirectionId (кроме null-case).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - B6: respondService — нет UNIQUE(direction_id, signal_id) — дубли для support.
//   - listSignals без фильтра initiatorId (нельзя получить «мои сигналы»).
//   - respondService не проверяет, что direction_id ∈ signal.directions
//     (если инициатор ограничил аудиторию).

import { query, queryOne, transaction, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import {
  emitSignalCreated,
  emitResponseAdded,
} from '../../ws/signals.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { Role } from '../roles.js';
import type {
  UUID, Priority, SignalStatus, SignalType, SignalResponseType,
} from '../types.js';
import { logger } from '../../lib/logger.js';
import { send as sendNotification, sendToRole } from '../../lib/notifications.js';

import {
  createSignal, changeStatus, incrementIteration, canEscalate,
  formatSignalExternalId, validateResponse, type Signal, type SignalResponse,
} from './entity.js';

interface SignalRow {
  id: string;
  external_id: string;
  initiator_id: string;
  type: SignalType;
  description: string;
  justification: string;
  directions: UUID[] | null;
  desired_deadline: Date | null;
  priority: Priority;
  status: SignalStatus;
  iterations: number;
  lead_direction_id: string | null;
  subject_plan_id: string | null;
  subject_task_id: string | null;
  subject_cell_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    externalId: row.external_id,
    initiatorId: row.initiator_id,
    type: row.type,
    description: row.description,
    justification: row.justification,
    directions: row.directions ?? [],
    desiredDeadline: row.desired_deadline ? row.desired_deadline.toISOString() : null,
    priority: row.priority,
    status: row.status,
    iterations: row.iterations,
    leadDirectionId: row.lead_direction_id,
    subjectPlanId: row.subject_plan_id,
    subjectTaskId: row.subject_task_id,
    subjectCellId: row.subject_cell_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ResponseRow {
  id: string;
  signal_id: string;
  direction_id: string;
  response: SignalResponseType;
  justification: string | null;
  data: Record<string, unknown> | null;
  consequences: string | null;
  needs: string | null;
  created_at: Date;
}

function rowToResponse(row: ResponseRow): SignalResponse {
  return {
    id: row.id,
    signalId: row.signal_id,
    directionId: row.direction_id,
    response: row.response,
    justification: row.justification ?? '',
    data: row.data,
    consequences: row.consequences,
    needs: row.needs,
    createdAt: row.created_at.toISOString(),
  };
}

// -------- Чтение --------

export interface SignalFilter {
  priority?: Priority;
  status?: SignalStatus;
  type?: SignalType;
  initiatorId?: UUID;
  leadDirectionId?: UUID;
  page?: number;
  perPage?: number;
}

export async function listSignals(
  filter: SignalFilter = {},
): Promise<{ data: Signal[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 20));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.priority) { params.push(filter.priority); conditions.push(`priority = $${params.length}`); }
  if (filter.status) { params.push(filter.status); conditions.push(`status = $${params.length}`); }
  if (filter.type) { params.push(filter.type); conditions.push(`type = $${params.length}`); }
  if (filter.initiatorId) { params.push(filter.initiatorId); conditions.push(`initiator_id = $${params.length}`); }
  if (filter.leadDirectionId) { params.push(filter.leadDirectionId); conditions.push(`lead_direction_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM signals ${where}`, params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<SignalRow>(
    `SELECT id, external_id, initiator_id, type, description, justification,
            directions, desired_deadline, priority, status, iterations,
            lead_direction_id, created_at, updated_at
       FROM signals
       ${where}
      ORDER BY
        CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                      WHEN 'standard' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.map(rowToSignal), total };
}

export async function getById(signalId: UUID): Promise<Signal> {
  const row = await queryOne<SignalRow>(
    `SELECT id, external_id, initiator_id, type, description, justification,
            directions, desired_deadline, priority, status, iterations,
            lead_direction_id, created_at, updated_at
       FROM signals WHERE id = $1`,
    [signalId],
  );
  if (!row) {throw new NotFoundError('Сигнал', signalId);}
  return rowToSignal(row);
}

// -------- Создание --------

/**
 * Уведомление — побочный эффект. Падение отправки (мессенджер/Redis) не
 * должно отменять создание сигнала или ответ на него.
 */
async function notifySafely(
  recipientId: UUID,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sendNotification({
      recipientId,
      type,
      priority: 'standard',
      title,
      body,
      data,
    });
  } catch (e) {
    logger.warn({ err: e, recipientId, type }, 'signal notification failed');
  }
}

async function notifyRoleSafely(
  role: Role,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  directionId?: UUID,
): Promise<void> {
  try {
    const res = await sendToRole(
      role,
      { type, priority: 'standard', title, body, data },
      directionId,
    );
    // В направлении может не быть Совета (ещё не избран). Сигнал не должен
    // уходить «в никуда»: функция ложится на Архитектора (Хартия: если
    // опытного участника нет, ответственность на Архитекторе).
    if (res.delivered === 0) {
      const { queryOne } = await import('../../lib/db.js');
      const arch = await queryOne<{ id: string }>(
        `SELECT id FROM participants
          WHERE is_first_architect = true AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`,
      );
      if (arch) {
        await sendNotification({
          recipientId: arch.id as UUID,
          type,
          priority: 'standard',
          title,
          body,
          data,
        });
      }
    }
  } catch (e) {
    logger.warn({ err: e, role, type }, 'signal role notification failed');
  }
}

export interface CreateSignalRequest {
  type: SignalType;
  description: string;
  justification: string;
  priority: Priority;
  directions?: UUID[];
  desiredDeadline?: string;
  leadDirectionId?: UUID;
  subjectPlanId?: UUID;
  subjectTaskId?: UUID;
  subjectCellId?: UUID;
}

export async function createSignalService(
  input: CreateSignalRequest,
  initiatorId: UUID,
): Promise<Signal> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();   // ← B12: внутри цикла (retry через полночь)
    const dateStr = now.toISOString().slice(0, 10);
    const row = await queryOne<{ max_seq: string | null }>(
      `SELECT COALESCE(MAX(SUBSTRING(external_id FROM '([0-9]{3})$')::INT), 0)::text AS max_seq
         FROM signals
        WHERE external_id LIKE $1`,
      [`SIG-${dateStr}-%`],
    );
    const nextSeq = parseInt(row?.max_seq ?? '0', 10) + 1;
    if (nextSeq > 999) {
      throw new ConflictError('Достигнут дневной лимит сигналов (999)');
    }

    const externalId = formatSignalExternalId(now, nextSeq);

    const entity = createSignal({
      id: newUUID(),
      externalId,
      initiatorId,
      type: input.type,
      description: input.description,
      justification: input.justification,
      priority: input.priority,
      ...(input.directions ? { directions: input.directions } : {}),
      ...(input.desiredDeadline ? { desiredDeadline: input.desiredDeadline } : {}),
      ...(input.leadDirectionId ? { leadDirectionId: input.leadDirectionId } : {}),
      ...(input.subjectPlanId ? { subjectPlanId: input.subjectPlanId } : {}),
      ...(input.subjectTaskId ? { subjectTaskId: input.subjectTaskId } : {}),
      ...(input.subjectCellId ? { subjectCellId: input.subjectCellId } : {}),
    });

    try {
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO signals
             (id, external_id, initiator_id, type, description, justification,
              directions, desired_deadline, priority, status, iterations, lead_direction_id,
              subject_plan_id, subject_task_id, subject_cell_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', 0, $10, $11, $12, $13)`,
          [
            entity.id, entity.externalId, entity.initiatorId, entity.type,
            entity.description, entity.justification,
            JSON.stringify(entity.directions), entity.desiredDeadline,
            entity.priority, entity.leadDirectionId,
            entity.subjectPlanId ?? null,
            entity.subjectTaskId ?? null,
            entity.subjectCellId ?? null,
          ],
        );
        await client.query(
          `INSERT INTO signal_attributes (id, signal_id) VALUES ($1, $2)`,
          [newUUID(), entity.id],
        );
        await client.query(
          `INSERT INTO meta_flows (id, signal_id, format_ok, etiquette_ok, priority_ok, returns_count)
           VALUES ($1, $2, true, true, true, 0)`,
          [newUUID(), entity.id],
        );
      });

      await logAction({
        actorId: initiatorId, actorType: 'participant',
        action: 'signals.create', entityType: 'signal', entityId: entity.id,
        newValue: { external_id: entity.externalId, type: entity.type, priority: entity.priority },
      });

      await emitSignalCreated({
        id: entity.id,
        externalId: entity.externalId,
        initiatorId: entity.initiatorId,
        type: entity.type,
        description: entity.description,
        justification: entity.justification,
        directions: entity.directions,
        priority: entity.priority,
        status: entity.status,
        iterations: entity.iterations,
        leadDirectionId: entity.leadDirectionId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      });

      // Совет направления должен узнать о сигнале, не открывая /signals.
      await notifyRoleSafely(
        Role.COUNCIL_MEMBER,
        'signal.created',
        'Новый сигнал',
        `${entity.externalId}: ${entity.description.slice(0, 160)}`,
        { signalId: entity.id, link: '/signals' },
        entity.leadDirectionId ?? entity.directions[0],
      );

      return entity;
    } catch (e) {
      if (isUniqueViolation(e)) {continue;}
      throw e;
    }
  }

  throw new ConflictError('Не удалось сгенерировать уникальный external_id для сигнала');
}

// -------- Ответы --------

export interface CreateResponseRequest {
  response: SignalResponseType;
  justification: string;
  data?: Record<string, unknown>;
  consequences?: string;
  needs?: string;
}

export async function respondService(
  signalId: UUID,
  directionId: UUID,
  input: CreateResponseRequest,
  requesterId: UUID,
  requesterDirectionId: UUID | null,
): Promise<SignalResponse> {
  // B2: направление ответа — только своё. requesterDirectionId === null
  // (архитектор без направления) — разрешено (системная роль).
  // Тест-signals: Архитектор с направлением — отвечает за своё; пройдёт.
  if (requesterDirectionId !== null && directionId !== requesterDirectionId) {
    throw new ForbiddenError('Отвечать можно только за своё направление');
  }

  const signal = await getById(signalId);
  if (signal.status === 'completed' || signal.status === 'rejected') {
    throw new ConflictError(`Сигнал ${signal.status} — нельзя ответить`);
  }

  // B4: clarify при iterations >= 3 — 409 (было: без границы → iterations ∞)
  if (input.response === 'clarify' && signal.iterations >= 3) {
    throw new ConflictError(
      `Лимит уточнений (3) достигнут — эскалируйте сигнал`,
    );
  }

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

  const id = newUUID();
  await query(
    `INSERT INTO responses
       (id, signal_id, run_id, direction_id, response, justification, data, consequences, needs)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)`,
    [
      id, signalId, directionId, input.response, input.justification,
      input.data ? JSON.stringify(input.data) : null,
      input.consequences ?? null, input.needs ?? null,
    ],
  );

  if (input.response === 'clarify') {
    const updated = incrementIteration(signal);
    await query(
      `UPDATE signals SET iterations = $1, updated_at = now() WHERE id = $2`,
      [updated.iterations, signalId],
    );
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'signals.respond', entityType: 'signal', entityId: signalId,
    newValue: { direction_id: directionId, response: input.response },
  });

  const result: SignalResponse = {
    id,
    signalId,
    directionId,
    response: input.response,
    justification: input.justification,
    data: input.data ?? null,
    consequences: input.consequences ?? null,
    needs: input.needs ?? null,
    createdAt: new Date().toISOString(),
  };

  await emitResponseAdded({
    id: result.id,
    signalId: result.signalId,
    directionId: result.directionId,
    response: result.response,
    justification: result.justification,
    createdAt: result.createdAt,
  });

  // Автор сигнала должен узнать об ответе — иначе решение повисает.
  await notifySafely(
    signal.initiatorId,
    'signal.response_added',
    'Ответ на ваш сигнал',
    `${signal.externalId}: ${input.response}`,
    { signalId, link: '/signals' },
  );

  return result;
}

export async function listResponses(signalId: UUID): Promise<SignalResponse[]> {
  const rows = await query<ResponseRow>(
    `SELECT id, signal_id, direction_id, response, justification, data,
            consequences, needs, created_at
       FROM responses WHERE signal_id = $1 ORDER BY created_at`,
    [signalId],
  );
  return rows.map(rowToResponse);
}

// -------- Эскалация --------

export async function markAsEscalated(
  signalId: UUID,
  reason: string,
  requesterId: UUID,
): Promise<Signal> {
  const signal = await getById(signalId);
  if (!canEscalate(signal)) {
    throw new ConflictError(`Лимит итераций не достигнут (${signal.iterations}/3)`);
  }

  // B1: статус сигнала — 'connect' (ожидание Арбитража). Было: только лог.
  // Идемпотентно с escalateItem в C.0.34.02 (тоже ставит 'connect').
  await query(
    `UPDATE signals SET status = 'connect', updated_at = now()
      WHERE id = $1 AND status NOT IN ('completed', 'rejected')`,
    [signalId],
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'signals.escalated', entityType: 'signal', entityId: signalId,
    newValue: { iterations: signal.iterations, reason },
  });

  // Эскалация — повод позвать Совет: локально вопрос не решился.
  await notifyRoleSafely(
    Role.COUNCIL_MEMBER,
    'signal.escalated',
    'Сигнал эскалирован',
    `${signal.externalId}: ${reason.slice(0, 160)}`,
    { signalId, link: '/signals' },
    signal.leadDirectionId ?? signal.directions[0],
  );

  return getById(signalId);
}

export async function assertInitiator(signalId: UUID, participantId: UUID): Promise<void> {
  const signal = await getById(signalId);
  if (signal.initiatorId !== participantId) {
    throw new ConflictError('Только инициатор может выполнить это действие');
  }
}

export { changeStatus };