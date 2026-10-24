// C.0.23.02 — Сервис Психоэкологии.
// Сессии, наблюдатели, кризисы, разгрузка, настроения, резонанс,
// благополучие, гигиена смыслов, детект систематического насилия.
//
// Психоэкология не лечит (I.4.12). Работает на уровне гигиены смыслов.
// Наблюдатели во всех направлениях. Рефлексивная разгрузка 3–5 дней.
// Систематическое насилие (> 3 случаев за год в одном направлении) → сигнал (I.4.8).
//
// Кросс-доменные вызовы (Justice, Semantic) — через dynamic import
// (паттерн из C.0.21.02 justice/service.ts).
//
// Техдолг закрыт (v0.0.02):
//   - B3: completeSession — atomic UPDATE WHERE status NOT IN ('completed','cancelled').
//   - B4: completeSession — только назначенный психолог.
//   - B5: createObserver — наблюдатель должен иметь роль PSY.
//   - B6: existence checks в createSession/startCrisis/startDischarge/
//         recordWellbeing/proposeHygiene.
//   - B7: startCrisis — один активный кризис на участника.
//   - B8: detectSystemicViolence — transaction + advisory lock, idempotent.
//   - B9: все WS-эмиты обёрнуты в bestEffort.

import { query, queryOne, isUniqueViolation, transaction } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import {
  emitPsySessionScheduled,
  emitPsySessionCompleted,
  emitPsyObserverAssigned,
  emitPsyObserverRemoved,
  emitPsyCrisisStarted,
  emitPsyDischargeStarted,
  emitPsyWellbeingRecorded,
  emitPsyHygieneProposed,
  emitPsyMoodUpdated,
  emitPsySystemicViolenceDetected,
} from '../../ws/psy.js';
import { logAction } from '../audit.js';
import {
  ConflictError, NotFoundError, ForbiddenError, ValidationError,
} from '../errors.js';
import type { UUID, ISODateTime, PsySessionType } from '../types.js';

import {
  createSession as entityCreateSession,
  completeSession as entityCompleteSession,
  assignObserver as entityAssignObserver,
  startCrisis as entityStartCrisis,
  startDischarge as entityStartDischarge,
  recordWellbeing as entityRecordWellbeing,
  proposeHygiene as entityProposeHygiene,
  calculateWellbeingTrend,
  PSY_SYSTEMIC_VIOLENCE_THRESHOLD,
  type PsySession,
  type PsyObserver,
  type PsyCrisis,
  type PsyDischarge,
  type MoodMetric,
  type Wellbeing,
  type Hygiene,
  type HygieneStatus,
  type WellbeingTrend,
  type PsyCrisisStatus,
  type PsyDischargeStatus,
} from './entity.js';

// ─── Фильтры ─────────────────────────────────────────────────────

export interface PsyCrisisFilter {
  status?: PsyCrisisStatus;
  participantId?: UUID;
  page?: number;
  perPage?: number;
}

export interface PsyDischargeFilter {
  status?: PsyDischargeStatus;
  participantId?: UUID;
  page?: number;
  perPage?: number;
}

export interface PsySessionFilter {
  type?: PsySessionType;
  status?: string;
  participantId?: UUID;
  psychologistId?: UUID;
  page?: number;
  perPage?: number;
}

export interface PsySessionCreate {
  participantId: UUID;
  psychologistId?: UUID;
  type: PsySessionType;
  scheduledAt: ISODateTime;
}

export interface PsyObserverCreate {
  participantId: UUID;
  directionId: UUID;
}

export interface WellbeingFilter {
  directionId?: UUID;
  periodFrom?: ISODateTime;
  periodTo?: ISODateTime;
}

export interface SystemViolenceResult {
  signal: boolean;
  cases: number;
}

// ─── Маппинг строк ───────────────────────────────────────────────

interface SessionRow {
  id: string;
  participant_id: string;
  psychologist_id: string;
  type: PsySessionType;
  notes: string | null;
  status: PsySession['status'];
  scheduled_at: Date;
  completed_at: Date | null;
  created_at: Date;
}

function rowToSession(r: SessionRow): PsySession {
  return {
    id: r.id,
    participantId: r.participant_id,
    psychologistId: r.psychologist_id,
    type: r.type,
    notes: r.notes,
    status: r.status,
    scheduledAt: r.scheduled_at.toISOString(),
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

interface ObserverRow {
  id: string;
  participant_id: string;
  direction_id: string;
  valid_from: Date;
  valid_to: Date | null;
}

function rowToObserver(r: ObserverRow): PsyObserver {
  return {
    id: r.id,
    participantId: r.participant_id,
    directionId: r.direction_id,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to ? r.valid_to.toISOString() : null,
  };
}

interface CrisisRow {
  id: string;
  participant_id: string;
  status: PsyCrisisStatus;
  notes: string | null;
  created_at: Date;
  closed_at: Date | null;
}

function rowToCrisis(r: CrisisRow): PsyCrisis {
  return {
    id: r.id,
    participantId: r.participant_id,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
  };
}

interface DischargeRow {
  id: string;
  participant_id: string;
  days: number;
  status: PsyDischargeStatus;
  created_at: Date;
  completed_at: Date | null;
}

function rowToDischarge(r: DischargeRow): PsyDischarge {
  return {
    id: r.id,
    participantId: r.participant_id,
    days: r.days,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  };
}

interface MoodRow {
  id: string;
  direction_id: string;
  metric: string;
  value: string | number;
  period: string;
  created_at: Date;
}

function rowToMood(r: MoodRow): MoodMetric {
  return {
    id: r.id,
    directionId: r.direction_id,
    metric: r.metric,
    value: Number(r.value),
    period: r.period,
    hasData: true,
    createdAt: r.created_at.toISOString(),
  };
}

interface HygieneRow {
  id: string;
  direction_id: string;
  measure: string;
  status: HygieneStatus;
  created_at: Date;
  applied_at: Date | null;
}

function rowToHygiene(r: HygieneRow): Hygiene {
  return {
    id: r.id,
    directionId: r.direction_id,
    measure: r.measure,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    appliedAt: r.applied_at ? r.applied_at.toISOString() : null,
  };
}

async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `psy service: ${label} failed`);
  }
}

// ─── Сессии ──────────────────────────────────────────────────────

export async function listSessions(
  filter: PsySessionFilter,
  _requesterId: UUID,
): Promise<PsySession[]> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.type) {
    params.push(filter.type);
    conditions.push(`type = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.participantId) {
    params.push(filter.participantId);
    conditions.push(`participant_id = $${params.length}`);
  }
  if (filter.psychologistId) {
    params.push(filter.psychologistId);
    conditions.push(`psychologist_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(perPage, offset);
  const rows = await query<SessionRow>(
    `SELECT id, participant_id, psychologist_id, type, notes, status,
            scheduled_at, completed_at, created_at
       FROM psy_sessions
       ${where}
      ORDER BY scheduled_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToSession);
}

export async function createSession(
  input: PsySessionCreate,
  requesterId: UUID,
): Promise<PsySession> {
  const psychologistId = input.psychologistId ?? requesterId;

  if (psychologistId === input.participantId) {
    throw new ValidationError(
      'Психолог не может совпадать с участником — укажите psychologist_id другого участника',
    );
  }

  // B6: участник и психолог должны существовать.
  const found = await query<{ id: string }>(
    `SELECT id FROM participants
      WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [[input.participantId, psychologistId]],
  );
  const foundIds = new Set(found.map((r) => r.id));
  if (!foundIds.has(input.participantId)) {
    throw new NotFoundError('Участник', input.participantId);
  }
  if (!foundIds.has(psychologistId)) {
    throw new NotFoundError('Психолог', psychologistId);
  }

  const entity = entityCreateSession({
    id: newUUID(),
    participantId: input.participantId,
    psychologistId,
    type: input.type,
    scheduledAt: input.scheduledAt,
  });

  await query(
    `INSERT INTO psy_sessions
       (id, participant_id, psychologist_id, type, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entity.id,
      entity.participantId,
      entity.psychologistId,
      entity.type,
      entity.status,
      entity.scheduledAt,
    ],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.session.create',
    entityType: 'psy_session',
    entityId: entity.id,
    newValue: { type: entity.type, participantId: entity.participantId },
  });

  await bestEffort('emitPsySessionScheduled', () =>
    emitPsySessionScheduled({
      id: entity.id,
      participantId: entity.participantId,
      psychologistId: entity.psychologistId,
      type: entity.type,
      status: entity.status,
      scheduledAt: entity.scheduledAt,
      completedAt: entity.completedAt,
    }),
  );

  return entity;
}

// B3: atomic UPDATE — WHERE status NOT IN ('completed','cancelled').
// B4: завершает только назначенный психолог.
export async function completeSession(
  sessionId: UUID,
  notes: string,
  requesterId: UUID,
): Promise<PsySession> {
  const row = await queryOne<SessionRow>(
    `SELECT id, participant_id, psychologist_id, type, notes, status,
            scheduled_at, completed_at, created_at
       FROM psy_sessions WHERE id = $1`,
    [sessionId],
  );
  if (!row) { throw new NotFoundError('Сессия', sessionId); }

  // B4: только назначенный психолог может завершить.
  if (row.psychologist_id !== requesterId) {
    throw new ForbiddenError('Сессию завершает только назначенный психолог');
  }

  const updated = entityCompleteSession(rowToSession(row), notes);

  // B3: atomic UPDATE.
  const res = await query<{ id: string }>(
    `UPDATE psy_sessions
        SET status = $2, notes = $3, completed_at = $4
      WHERE id = $1
        AND status NOT IN ('completed', 'cancelled')
      RETURNING id`,
    [sessionId, updated.status, updated.notes, updated.completedAt],
  );
  if (res.length === 0) {
    throw new ConflictError('Сессия уже завершена параллельным запросом');
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.session.complete',
    entityType: 'psy_session',
    entityId: sessionId,
  });

  await bestEffort('emitPsySessionCompleted', () =>
    emitPsySessionCompleted({
      id: updated.id,
      participantId: updated.participantId,
      psychologistId: updated.psychologistId,
      type: updated.type,
      status: updated.status,
      scheduledAt: updated.scheduledAt,
      completedAt: updated.completedAt,
    }),
  );

  return updated;
}

// ─── Наблюдатели ─────────────────────────────────────────────────

export async function listObservers(
  directionId?: UUID,
  _requesterId?: UUID,
): Promise<PsyObserver[]> {
  const params: unknown[] = [];
  let where = `WHERE valid_to IS NULL`;
  if (directionId) {
    params.push(directionId);
    where += ` AND direction_id = $${params.length}`;
  }
  const rows = await query<ObserverRow>(
    `SELECT id, participant_id, direction_id, valid_from, valid_to
       FROM psy_observers
       ${where}
      ORDER BY valid_from DESC`,
    params,
  );
  return rows.map(rowToObserver);
}

// B5: наблюдателем может быть только PSY.
export async function createObserver(
  input: PsyObserverCreate,
  requesterId: UUID,
): Promise<PsyObserver> {
  const { hasRole } = await import('../../security/rbac.js');
  const { Role } = await import('../roles.js');
  if (!(await hasRole(input.participantId, Role.PSY))) {
    throw new ValidationError(
      'Наблюдателем может быть только участник с ролью PSY (I.4.12)',
    );
  }

  const entity = entityAssignObserver({
    id: newUUID(),
    participantId: input.participantId,
    directionId: input.directionId,
  });

  try {
    await query(
      `INSERT INTO psy_observers (id, participant_id, direction_id, valid_from)
       VALUES ($1, $2, $3, $4)`,
      [entity.id, entity.participantId, entity.directionId, entity.validFrom],
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError(
        'В направлении уже есть активный наблюдатель (I.4.12)',
      );
    }
    throw e;
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.observer.assign',
    entityType: 'psy_observer',
    entityId: entity.id,
    newValue: { participantId: entity.participantId, directionId: entity.directionId },
  });

  await bestEffort('emitPsyObserverAssigned', () =>
    emitPsyObserverAssigned({
      id: entity.id,
      participantId: entity.participantId,
      directionId: entity.directionId,
      validFrom: entity.validFrom,
    }),
  );

  return entity;
}

export async function removeObserver(
  observerId: UUID,
  requesterId: UUID,
): Promise<void> {
  const rows = await query<{ id: string; direction_id: string }>(
    `UPDATE psy_observers
        SET valid_to = now()
      WHERE id = $1 AND valid_to IS NULL
      RETURNING id, direction_id`,
    [observerId],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Активный наблюдатель', observerId);
  }
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.observer.remove',
    entityType: 'psy_observer',
    entityId: observerId,
  });
  await bestEffort('emitPsyObserverRemoved', () =>
    emitPsyObserverRemoved(observerId, row.direction_id, requesterId),
  );
}

// ─── Кризисы ─────────────────────────────────────────────────────

// B6: participant existence.
// B7: один активный кризис на участника.
export async function startCrisis(
  participantId: UUID,
  notes: string | undefined,
  requesterId: UUID,
): Promise<PsyCrisis> {
  // B6: participant должен существовать.
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!p) { throw new NotFoundError('Участник', participantId); }

  // B7: один открытый кризис.
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM psy_crises
      WHERE participant_id = $1 AND status != 'closed' LIMIT 1`,
    [participantId],
  );
  if (existing) { throw new ConflictError('Активный кризис уже открыт'); }

  const entity = entityStartCrisis({
    id: newUUID(),
    participantId,
    notes: notes ?? null,
  });

  await query(
    `INSERT INTO psy_crises (id, participant_id, status, notes, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.id, entity.participantId, entity.status, entity.notes, entity.createdAt],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.crisis.start',
    entityType: 'psy_crisis',
    entityId: entity.id,
    newValue: { participantId },
  });

  await bestEffort('emitPsyCrisisStarted', () =>
    emitPsyCrisisStarted({
      id: entity.id,
      participantId: entity.participantId,
      status: entity.status,
      createdAt: entity.createdAt,
    }),
  );

  return entity;
}

// ─── Разгрузка / резонанс ────────────────────────────────────────

// B6: participant existence.
export async function startDischarge(
  participantId: UUID,
  days: number,
  requesterId: UUID,
): Promise<PsyDischarge> {
  // B6: participant должен существовать.
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!p) { throw new NotFoundError('Участник', participantId); }

  const entity = entityStartDischarge({
    id: newUUID(),
    participantId,
    days,
  });

  await query(
    `INSERT INTO psy_discharges (id, participant_id, days, status, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.id, entity.participantId, entity.days, entity.status, entity.createdAt],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.discharge.start',
    entityType: 'psy_discharge',
    entityId: entity.id,
    newValue: { participantId, days },
  });

  await bestEffort('emitPsyDischargeStarted', () =>
    emitPsyDischargeStarted({
      id: entity.id,
      participantId: entity.participantId,
      days: entity.days,
      status: entity.status,
      createdAt: entity.createdAt,
    }),
  );

  return entity;
}

// Резонанс — программа для участников на базовом поддерживающем уровне (V.1.6.2).
// По структуре совпадает с разгрузкой на минимальный срок (3 дня).
export async function startResonance(
  participantId: UUID,
  requesterId: UUID,
): Promise<PsyDischarge> {
  const d = await startDischarge(participantId, 3, requesterId);
  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.resonance.start',
    entityType: 'psy_discharge',
    entityId: d.id,
    newValue: { participantId },
  });
  return d;
}

// ─── Список кризисов ─────────────────────────────────────────────

export async function listCrises(
  filter: PsyCrisisFilter,
  _requesterId: UUID,
): Promise<PsyCrisis[]> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.participantId) {
    params.push(filter.participantId);
    conditions.push(`participant_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(perPage, offset);
  const rows = await query<CrisisRow>(
    `SELECT id, participant_id, status, notes, created_at, closed_at
       FROM psy_crises
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToCrisis);
}

// ─── Список разгрузок ────────────────────────────────────────────

export async function listDischarges(
  filter: PsyDischargeFilter,
  _requesterId: UUID,
): Promise<PsyDischarge[]> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.participantId) {
    params.push(filter.participantId);
    conditions.push(`participant_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(perPage, offset);
  const rows = await query<DischargeRow>(
    `SELECT id, participant_id, days, status, created_at, completed_at
       FROM psy_discharges
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToDischarge);
}

// ─── Настроения ──────────────────────────────────────────────────
export async function getMood(
  directionId: UUID,
  _requesterId: UUID,
): Promise<MoodMetric> {
  const row = await queryOne<MoodRow>(
    `SELECT id, direction_id, metric, value, period::text AS period, created_at
       FROM mood_metrics
      WHERE direction_id = $1
      ORDER BY upper(period) DESC, created_at DESC
      LIMIT 1`,
    [directionId],
  );
  if (row) { return rowToMood(row); }

  return {
    id: newUUID(),
    directionId,
    metric: 'collective_mood',
    value: 0.5,
    period: 'нет данных',
    hasData: false,
    createdAt: new Date().toISOString(),
  };
}

// ─── Персистентный пересчёт mood_metrics ─────────────────────────
//
// getMood() отдаёт «свежую» метрику (считает на лету, если в mood_metrics
// нет записи за последние 24 часа). recalcAllMoodMetrics() — cron-задача:
// проходит по всем directions, считает средний wellbeing за окно,
// нормализует 1..10 → 0..1, пишет в mood_metrics и эмитит psy.mood.updated.
//
// Запуск: cron k8s (I.3.05.*) раз в сутки, либо вручную через API
// POST /psy/mood/recalc (см. патч контроллера ниже).

const MOOD_METRIC_NAME = 'collective_mood';

export interface MoodRecalcResult {
  computed: number;
  skipped: number;
  errors: number;
}

// ─── Персистентная агрегация mood_metrics ────────────────────────
//
// Вызывается HTTP-эндпоинтом POST /psy/mood/aggregate (cron-задача
// через K8s CronJob I.3.05.06 — ежечасно).
//
// Логика:
//   1. Определяем окно: [period_start, period_end) по date_trunc.
//   2. Для каждого направления считаем AVG(wellbeing.score) в окне.
//   3. Нормализуем 1..10 → 0..1.
//   4. UPSERT по (direction_id, metric, lower(period), upper(period)):
//      нет UNIQUE-констрейнта в БД — используем SELECT FOR UPDATE + INSERT/UPDATE.
//   5. Эмитим psy.mood.updated по каждому обработанному направлению.
//
// Идемпотентность: повторный запуск в тот же период обновляет существующую
// запись (не плодит дубликаты).

export type MoodAggregatePeriod = 'hour' | 'day';

export interface AggregateMoodResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  period: { start: ISODateTime; end: ISODateTime; kind: MoodAggregatePeriod };
}

function periodBounds(
  kind: MoodAggregatePeriod,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  if (kind === 'day') { start.setUTCHours(0, 0, 0, 0); }

  const end = new Date(start);
  if (kind === 'day') { end.setUTCDate(end.getUTCDate() + 1); }
  else                { end.setUTCHours(end.getUTCHours() + 1); }

  return { start, end };
}

async function upsertMoodMetric(input: {
  directionId: UUID;
  metric: string;
  value: number;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{ id: UUID; created: boolean }> {
  return transaction(async (client) => {
    // SELECT ... FOR UPDATE + явное сравнение границ диапазона.
    // tstzrange в БД нет UNIQUE, поэтому ON CONFLICT неприменим.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM mood_metrics
        WHERE direction_id = $1
          AND metric = $2
          AND lower(period) = $3::timestamptz
          AND upper(period) = $4::timestamptz
        FOR UPDATE`,
      [input.directionId, input.metric, input.periodStart, input.periodEnd],
    );
    const row = existing.rows[0];
    if (row) {
      await client.query(
        `UPDATE mood_metrics SET value = $2 WHERE id = $1`,
        [row.id, input.value],
      );
      return { id: row.id, created: false };
    }
    const id = newUUID();
    await client.query(
      `INSERT INTO mood_metrics (id, direction_id, metric, value, period)
       VALUES ($1, $2, $3, $4, tstzrange($5::timestamptz, $6::timestamptz))`,
      [
        id,
        input.directionId,
        input.metric,
        input.value,
        input.periodStart,
        input.periodEnd,
      ],
    );
    return { id, created: true };
  });
}

export async function aggregateMoodMetrics(
  period: MoodAggregatePeriod,
): Promise<AggregateMoodResult> {
  const { start, end } = periodBounds(period);

  const directions = await query<{ id: string }>(
    `SELECT id FROM directions WHERE status <> 'abolished'`,
  );

  const result: AggregateMoodResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    period: { start: start.toISOString(), end: end.toISOString(), kind: period },
  };

  for (const d of directions) {
    try {
      const agg = await queryOne<{ avg_score: string | null; cnt: string }>(
        `SELECT AVG(w.score)::text AS avg_score, COUNT(*)::text AS cnt
           FROM wellbeing w
           JOIN participants p ON p.id = w.participant_id
          WHERE p.direction_id = $1
            AND w.created_at >= $2
            AND w.created_at <  $3`,
        [d.id, start, end],
      );
      const cnt = parseInt(agg?.cnt ?? '0', 10);
      if (cnt === 0) {
        result.skipped += 1;
        continue;
      }

      const avg = Number(agg?.avg_score ?? '5');
      // 1..10 → 0..1
      const normalized = Math.max(0, Math.min(1, (avg - 1) / 9));

      const up = await upsertMoodMetric({
        directionId: d.id,
        metric: MOOD_METRIC_NAME,
        value: normalized,
        periodStart: start,
        periodEnd: end,
      });
      if (up.created) { result.created += 1; } else { result.updated += 1; }
      result.processed += 1;

      await emitPsyMoodUpdated({
        directionId: d.id,
        metric: MOOD_METRIC_NAME,
        value: normalized,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        kind: period,
      });
    } catch (e) {
      result.errors += 1;
      logger.warn(
        { err: e, directionId: d.id, period },
        'psy mood: aggregate failed',
      );
    }
  }

  await logAction({
    actorId: null,
    actorType: 'system',
    action: 'psy.mood.aggregate',
    entityType: 'mood_metrics',
    entityId: '00000000-0000-0000-0000-000000000000',
    newValue: {
      processed: result.processed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      period: result.period,
    },
  });

  return result;
}

export async function getCollectiveMood(_requesterId: UUID): Promise<MoodMetric[]> {
  const rows = await query<MoodRow>(
    `SELECT DISTINCT ON (direction_id)
            id, direction_id, metric, value, period::text AS period, created_at
       FROM mood_metrics
      ORDER BY direction_id, created_at DESC`,
  );
  return rows.map(rowToMood);
}

// ─── Благополучие ────────────────────────────────────────────────

// B6: participant existence.
export async function recordWellbeing(
  participantId: UUID,
  score: number,
  requesterId: UUID,
): Promise<Wellbeing> {
  // B6: participant должен существовать.
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [participantId],
  );
  if (!p) { throw new NotFoundError('Участник', participantId); }

  const entity = entityRecordWellbeing({
    id: newUUID(),
    participantId,
    score,
  });

  // Считаем тренд по последним 5 записям.
  const recent = await query<{ score: number }>(
    `SELECT score FROM wellbeing
      WHERE participant_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
    [participantId],
  );
  const scores = recent.map((r) => r.score).reverse();
  scores.push(score);
  const trend = calculateWellbeingTrend(scores);

  await query(
    `INSERT INTO wellbeing (id, participant_id, score, trend, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.id, entity.participantId, score, trend, entity.createdAt],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.wellbeing.record',
    entityType: 'wellbeing',
    entityId: entity.id,
    newValue: { participantId, score, trend },
  });

  await bestEffort('emitPsyWellbeingRecorded', () =>
    emitPsyWellbeingRecorded({
      id: entity.id,
      participantId: entity.participantId,
      score,
      trend,
    }),
  );

  return { ...entity, trend };
}

// Агрегат благополучия за окно.
//
// Тренд считается сравнением двух окон одинаковой ширины:
//   current  = [currentStart, currentEnd)
//   previous = [prevStart, prevEnd), где prevEnd = currentStart
//
// Окна:
//   - Если periodFrom/To заданы — берём их (ширина = To - From).
//   - Иначе — текущее окно [now-7d, now), предыдущее [now-14d, now-7d).
//
// Тренд: дельта средних ±0.5 балла.
export async function getAggregatedWellbeing(
  filter: WellbeingFilter,
): Promise<Wellbeing> {
  const now = new Date();
  const currentEnd = filter.periodTo ? new Date(filter.periodTo) : now;
  const currentStart = filter.periodFrom
    ? new Date(filter.periodFrom)
    : new Date(currentEnd.getTime() - 7 * 86_400_000);

  const windowMs = currentEnd.getTime() - currentStart.getTime();
  const prevEnd = currentStart;
  const prevStart = new Date(currentStart.getTime() - windowMs);

  const baseParams: unknown[] = [];
  const baseConditions: string[] = [];
  if (filter.directionId) {
    baseParams.push(filter.directionId);
    baseConditions.push(`p.direction_id = $${baseParams.length}`);
  }
  const baseWhere = baseConditions.length > 0
    ? `AND ${baseConditions.join(' AND ')}`
    : '';

  async function avgFor(
    start: Date,
    end: Date,
  ): Promise<{ avg: number | null; cnt: number }> {
    const params = [...baseParams, start, end];
    const row = await queryOne<{ avg_score: string | null; cnt: string }>(
      `SELECT AVG(w.score)::text AS avg_score, COUNT(*)::text AS cnt
         FROM wellbeing w
         JOIN participants p ON p.id = w.participant_id
        WHERE w.created_at >= $${baseParams.length + 1}
          AND w.created_at <  $${baseParams.length + 2}
          ${baseWhere}`,
      params,
    );
    const cnt = parseInt(row?.cnt ?? '0', 10);
    const avg = cnt > 0 ? Number(row?.avg_score ?? '0') : null;
    return { avg, cnt };
  }

  const [current, previous] = await Promise.all([
    avgFor(currentStart, currentEnd),
    avgFor(prevStart, prevEnd),
  ]);

  // score: среднее текущего окна, округлённое. Если нет данных — нейтральное 5.
  const score = current.avg !== null ? Math.round(current.avg) : 5;

  // trend: сравнение средних двух окон, дельта ±0.5.
  let trend: WellbeingTrend = 'stable';
  if (current.avg !== null && previous.avg !== null) {
    const delta = current.avg - previous.avg;
    if (delta > 0.5)       { trend = 'up'; }
    else if (delta < -0.5) { trend = 'down'; }
  }

  return {
    id: newUUID(),
    participantId:
      filter.directionId ?? '00000000-0000-0000-0000-000000000000',
    score,
    trend,
    createdAt: new Date().toISOString(),
  };
}

// ─── Гигиена смыслов ─────────────────────────────────────────────

// B6: direction existence.
export async function proposeHygiene(
  directionId: UUID,
  measure: string,
  requesterId: UUID,
): Promise<Hygiene> {
  // B6: direction должен существовать.
  const d = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id = $1`,
    [directionId],
  );
  if (!d) { throw new NotFoundError('Направление', directionId); }

  const entity = entityProposeHygiene({
    id: newUUID(),
    directionId,
    measure,
  });

  await query(
    `INSERT INTO hygiene (id, direction_id, measure, status, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.id, entity.directionId, entity.measure, entity.status, entity.createdAt],
  );

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.hygiene.propose',
    entityType: 'hygiene',
    entityId: entity.id,
    newValue: { directionId, measure: entity.measure },
  });

  await bestEffort('emitPsyHygieneProposed', () =>
    emitPsyHygieneProposed({
      id: entity.id,
      directionId: entity.directionId,
      measure: entity.measure,
      status: entity.status,
    }),
  );

  return entity;
}

export async function listHygiene(directionId?: UUID): Promise<Hygiene[]> {
  const params: unknown[] = [];
  let where = '';
  if (directionId) {
    params.push(directionId);
    where = `WHERE direction_id = $1`;
  }
  const rows = await query<HygieneRow>(
    `SELECT id, direction_id, measure, status, created_at, applied_at
       FROM hygiene
       ${where}
      ORDER BY created_at DESC
      LIMIT 200`,
    params,
  );
  return rows.map(rowToHygiene);
}

// ─── Систематическое насилие (I.4.8) ─────────────────────────────

// B8: транзакция + advisory lock по (direction, year), idempotent UPSERT.
export async function detectSystemicViolence(
  directionId: UUID,
  year: number,
  requesterId: UUID,
): Promise<SystemViolenceResult> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError('year вне допустимого диапазона');
  }

  // Считаем случаи насилия: complaints type='violence' от участников направления.
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM complaints c
       JOIN participants p ON p.id = c.applicant_id
      WHERE p.direction_id = $1
        AND c.type = 'violence'
        AND EXTRACT(YEAR FROM c.created_at) = $2`,
    [directionId, year],
  );
  const cases = parseInt(row?.cnt ?? '0', 10);
  const signal = cases > PSY_SYSTEMIC_VIOLENCE_THRESHOLD;

  if (signal) {
    // B8: транзакция + advisory lock на (direction, year).
    await transaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`psy:sv:${directionId}:${year}`],
      );
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM systemic_violence_signals
          WHERE direction_id = $1 AND year = $2 LIMIT 1`,
        [directionId, year],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE systemic_violence_signals SET cases_count = $2 WHERE id = $1`,
          [existing.rows[0].id, cases],
        );
      } else {
        await client.query(
          `INSERT INTO systemic_violence_signals (direction_id, cases_count, year)
           VALUES ($1, $2, $3)`,
          [directionId, cases, year],
        );
      }
    });

    // B10: WS-эмиссия best-effort.
    await bestEffort('emitPsySystemicViolenceDetected', () =>
      emitPsySystemicViolenceDetected({ directionId, year, cases, signal: true }),
    );

    // justice.fileComplaint — уже в bestEffort.
    await bestEffort('justice.fileComplaint', async () => {
      const { fileComplaint } = await import('../justice/service.js');
      await fileComplaint(
        {
          type: 'violence',
          description:
            `Систематическое насилие: ${cases} случаев за ${year} ` +
            `в направлении ${directionId} (I.4.8)`,
          anonymous: false,
        },
        requesterId,
      );
    });
  }

  await logAction({
    actorId: requesterId,
    actorType: 'participant',
    action: 'psy.systemic_violence.detect',
    entityType: 'direction',
    entityId: directionId,
    newValue: { year, cases, signal },
  });

  return { signal, cases };
}