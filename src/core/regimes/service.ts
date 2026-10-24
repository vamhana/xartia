// C.0.17.02 — Сервис режимов
// Активация, деактивация, аудит, мобилизация.
// Автоматическая активация Стального Колокола и Инфоблокады.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: activateService — advisory lock + INSERT в одной транзакции;
//         tryActivateQuantumAcceleration — под advisory lock.
//   - B2: deactivateService — atomic UPDATE ... WHERE status='active' + ConflictError.
//   - B3: activateService — проверка уникальности red_circuit корректно
//         различает undefined/null directionId (было: `input.directionId === null`).
//   - B4: confirmMobilization — отказ «уже отказался» блокирует подтверждение.
//   - B5: refuseMobilization — проверка «уже подтвердил» + возврат refusedCount/percent
//         из транзакции (было: getMobilization(mobId) с неверным аргументом).
//   - B6: startMobilization — advisory lock против параллельных вставок.
//   - B7/B9: checkAutoActivation — эмитит WS, возвращает фактически деактивированные.

import { query, queryOne, transaction, isUniqueViolation } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { send } from '../../lib/notifications.js';
import { invalidateRegimeCache } from '../../lib/regime-cache.js';
import { listParticipantsWithRole } from '../../security/rbac.js';
import {
  emitMobilizationStarted,
  emitMobilizationConfirmed,
  emitMobilizationRefused,
  emitMobilizationCompleted,
} from '../../ws/crisis.js';
import {
  emitRegimeActivated,
  emitRegimeDeactivated,
  emitRegimeAudited,
  emitQuantumAccelerationActivated,
  emitInfoBlockadeActivated,
  emitInfoBlockadeLifted,
} from '../../ws/regimes.js';
import { logAction } from '../audit.js';
import { PRIORITY_DEADLINES_MS } from '../constants.js';
import { NotFoundError, ConflictError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID, Priority, RegimeType } from '../types.js';

import {
  activateRegime, deactivateRegime, canActivate, getMobilizationPercent,
  calculateAcceleratedDeadline, canRefuseMobilization, isExpired, getMaxDuration,
  type Regime, type RegimeStatus,
  type CrisisMobilization, type MobilizationStatus, type CrisisRefusal,
  type ActivationContext,
} from './entity.js';

// WS-эмиссии и уведомления — best-effort: падение не должно ломать
// основной сценарий активации/деактивации режима.
async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.warn({ err: e }, `regime service: ${label} failed`);
  }
}

interface RegimeRow {
  id: string;
  type: RegimeType;
  direction_id: string | null;
  activated_by: string;
  activated_at: Date;
  deactivated_at: Date | null;
  status: RegimeStatus;
  conditions: Record<string, unknown>;
  audit_schedule: string | null;
  max_duration: string | null;
  reason: string | null;
}

function normalizeInterval(v: unknown): string | null {
  if (v === null || v === undefined) {return null;}
  if (typeof v === 'string') {return v;}
  if (typeof v === 'object') {
    const o = v as Record<string, number | undefined>;
    const parts: string[] = [];
    if (o['years'])   {parts.push(`${o['years']} years`);}
    if (o['months'])  {parts.push(`${o['months']} months`);}
    if (o['days'])    {parts.push(`${o['days']} days`);}
    if (o['hours'])   {parts.push(`${o['hours']} hours`);}
    if (o['minutes']) {parts.push(`${o['minutes']} minutes`);}
    if (o['seconds']) {parts.push(`${o['seconds']} seconds`);}
    return parts.join(' ') || null;
  }
  return String(v);
}

function rowToRegime(row: RegimeRow): Regime {
  return {
    id: row.id,
    type: row.type,
    directionId: row.direction_id,
    activatedBy: row.activated_by,
    activatedAt: row.activated_at.toISOString(),
    deactivatedAt: row.deactivated_at ? row.deactivated_at.toISOString() : null,
    status: row.status,
    conditions: row.conditions ?? {},
    auditSchedule: normalizeInterval(row.audit_schedule),
    maxDuration: normalizeInterval(row.max_duration),
    reason: row.reason,
  };
}

// -------- Чтение --------

export async function list(): Promise<Regime[]> {
  const rows = await query<RegimeRow>(
    `SELECT id, type, direction_id, activated_by, activated_at, deactivated_at,
            status, conditions, audit_schedule, max_duration, reason
       FROM regimes
      ORDER BY
        CASE status WHEN 'active' THEN 1 ELSE 2 END,
        activated_at DESC
      LIMIT 200`,
  );
  return rows.map(rowToRegime);
}

export async function getById(id: UUID): Promise<Regime> {
  const row = await queryOne<RegimeRow>(
    `SELECT id, type, direction_id, activated_by, activated_at, deactivated_at,
            status, conditions, audit_schedule, max_duration, reason
       FROM regimes WHERE id = $1`,
    [id],
  );
  if (!row) {throw new NotFoundError('Режим', id);}
  return rowToRegime(row);
}

export async function getActive(): Promise<Regime[]> {
  const rows = await query<RegimeRow>(
    `SELECT id, type, direction_id, activated_by, activated_at, deactivated_at,
            status, conditions, audit_schedule, max_duration, reason
       FROM regimes WHERE status = 'active' ORDER BY activated_at DESC`,
  );
  return rows.map(rowToRegime);
}

export async function isActive(type: RegimeType): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM regimes WHERE type = $1 AND status = 'active' LIMIT 1`,
    [type],
  );
  return row !== null;
}

export async function isInfoBlockadeActive(): Promise<boolean> {
  return isActive('info_blockade');
}

export async function isQuantumAccelerationActive(): Promise<boolean> {
  return isActive('quantum_acceleration');
}

// -------- Активация --------

export interface ActivateRequest {
  type: RegimeType;
  reason: string;
  directionId?: UUID;
  conditions?: Record<string, unknown>;
  context: ActivationContext;
}

export async function activateService(
  input: ActivateRequest,
  requesterId: UUID,
): Promise<Regime> {
  const check = canActivate(input.type, input.context);
  if (!check.allowed) {
    throw new ConflictError(check.reason ?? 'Нельзя активировать режим');
  }

  const entity = activateRegime({
    id: newUUID(),
    type: input.type,
    activatedBy: requesterId,
    ...(input.directionId ? { directionId: input.directionId } : {}),
    reason: input.reason,
    ...(input.conditions ? { conditions: input.conditions } : {}),
  });

  // B1 (race) + B3 (undefined directionId) — всё в одной транзакции с
  // pg_advisory_xact_lock. Ключ включает type и (для red_circuit) global/направление.
  await transaction(async (client) => {
    // Advisory lock по ключу (type, scope). Scope: 'global' или `dir:<uuid>`.
    const scope = input.directionId ? `dir:${input.directionId}` : 'global';
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`regime:activate:${input.type}:${scope}`],
    );

    // B3: проверка уникальности с корректной семантикой для undefined.
    if (input.type === 'red_circuit') {
      if (!input.directionId) {
        // Глобальный RC — только один.
        const exists = await client.query<{ id: string }>(
          `SELECT id FROM regimes
            WHERE type = 'red_circuit' AND status = 'active' AND direction_id IS NULL
            LIMIT 1`,
        );
        if (exists.rows.length > 0) {
          throw new ConflictError('Глобальный Красный Контур уже активен');
        }
      } else {
        // Тот же direction уже имеет активный red_circuit?
        const exists = await client.query<{ id: string }>(
          `SELECT id FROM regimes
            WHERE type = 'red_circuit' AND status = 'active' AND direction_id = $1
            LIMIT 1`,
          [input.directionId],
        );
        if (exists.rows.length > 0) {
          throw new ConflictError(`Красный Контур уже активен для направления ${input.directionId}`);
        }
      }
    } else if (input.type !== 'quantum_acceleration') {
      // Для всех остальных (кроме quantum) — только один активный.
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM regimes WHERE type = $1 AND status = 'active' LIMIT 1`,
        [input.type],
      );
      if (exists.rows.length > 0) {
        throw new ConflictError(`Режим ${input.type} уже активен`);
      }
    }

    await client.query(
      `INSERT INTO regimes
         (id, type, direction_id, activated_by, status, conditions,
          audit_schedule, max_duration, reason)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8)`,
      [
        entity.id, entity.type, entity.directionId, entity.activatedBy,
        JSON.stringify(entity.conditions),
        entity.auditSchedule, entity.maxDuration, entity.reason,
      ],
    );
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'regimes.activate', entityType: 'regime', entityId: entity.id,
    newValue: { type: entity.type, reason: entity.reason },
  });

  await invalidateRegimeCache();

  // Автоматически активируем Квант ускорения при Стальном Колоколе.
  if (input.type === 'steel_bell') {
    await tryActivateQuantumAcceleration(requesterId);
  }

  // WS-эмиссии: broadcast всем. Best-effort, не блокируют.
  await bestEffort('emitRegimeActivated', () =>
    emitRegimeActivated({
      id: entity.id,
      type: entity.type,
      directionId: entity.directionId,
      activatedBy: entity.activatedBy,
      activatedAt: entity.activatedAt,
      status: entity.status,
      reason: entity.reason,
      auditSchedule: entity.auditSchedule,
      maxDuration: entity.maxDuration,
    }),
  );

  if (input.type === 'info_blockade') {
    await bestEffort('emitInfoBlockadeActivated', () =>
      emitInfoBlockadeActivated({
        id: entity.id,
        type: entity.type,
        activatedAt: entity.activatedAt,
        status: entity.status,
        reason: entity.reason,
      }),
    );
  }

  if (input.type === 'steel_bell') {
    // Квант ускорения мог только что активироваться — считаем дедлайны /10.
    await bestEffort('emitQuantumAccelerationActivated', () =>
      emitQuantumAccelerationActivated(PRIORITY_DEADLINES_MS),
    );
  }

  // Уведомление членов Совета. Best-effort.
  await bestEffort('notifyCouncil', async () => {
    const councils = await listParticipantsWithRole(Role.COUNCIL_MEMBER);

    const payload = {
      type: `regime.${entity.type}.activated`,
      priority: 'critical' as const,
      title: `🚨 Активирован режим: ${entity.type}`,
      body: (entity.reason ?? '').slice(0, 200),
      data: { regimeId: entity.id, regimeType: entity.type },
    };

    const results = await Promise.allSettled(
      councils.map((pid) => send({ ...payload, recipientId: pid })),
    );

    const failedRecipients = councils.filter(
      (_, i) => results[i]?.status === 'rejected',
    );

    if (failedRecipients.length > 0) {
      logger.warn(
        {
          regimeId: entity.id,
          regimeType: entity.type,
          total: councils.length,
          failed: failedRecipients.length,
          failedRecipients,
        },
        'regime activate: some council notifications failed',
      );
    }
  });

  // Webhook: best-effort, после успешной активации.
  try {
    const { dispatch } = await import('../webhooks/service.js');
    await dispatch('regime.activated', {
      regimeId: entity.id,
      type: entity.type,
      directionId: entity.directionId,
      activatedBy: entity.activatedBy,
      activatedAt: entity.activatedAt,
    });
  } catch (e) {
    logger.warn({ err: e, event: 'regime.activated' }, 'webhook dispatch failed');
  }

  return entity;
}

// B1: под advisory lock, чтобы параллельные steel_bell не создали дубль quantum_acceleration.
async function tryActivateQuantumAcceleration(requesterId: UUID): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      ['regime:activate:quantum_acceleration:global'],
    );
    const exists = await client.query<{ id: string }>(
      `SELECT id FROM regimes WHERE type = 'quantum_acceleration' AND status = 'active' LIMIT 1`,
    );
    if (exists.rows.length > 0) {return;}

    const entity = activateRegime({
      id: newUUID(),
      type: 'quantum_acceleration',
      activatedBy: requesterId,
      reason: 'Автоматически при Стальном Колоколе',
    });
    await client.query(
      `INSERT INTO regimes
         (id, type, activated_by, status, conditions, max_duration, reason)
       VALUES ($1, 'quantum_acceleration', $2, 'active', '{}'::jsonb, NULL, $3)`,
      [entity.id, requesterId, entity.reason],
    );
  });
}

// -------- Деактивация --------

// B2: atomic UPDATE ... WHERE status='active'.
export async function deactivateService(
  regimeId: UUID, reason: string, requesterId: UUID,
): Promise<Regime> {
  const regime = await getById(regimeId);
  const updated = deactivateRegime(regime, reason);

  await transaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE regimes
          SET status = 'finished', deactivated_at = now()
        WHERE id = $1 AND status = 'active'
        RETURNING id`,
      [regimeId],
    );
    if (result.rows.length === 0) {
      throw new ConflictError('Режим уже деактивирован параллельным запросом');
    }

    // Если деактивируется Стальной Колокол — деактивируем Квант ускорения.
    if (regime.type === 'steel_bell') {
      await client.query(
        `UPDATE regimes SET status = 'finished', deactivated_at = now()
          WHERE type = 'quantum_acceleration' AND status = 'active'`,
      );
    }
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'regimes.deactivate', entityType: 'regime', entityId: regimeId,
    newValue: { reason },
  });

  await invalidateRegimeCache();

  await bestEffort('emitRegimeDeactivated', () =>
    emitRegimeDeactivated(regime.id, regime.type, reason),
  );

  if (regime.type === 'info_blockade') {
    await bestEffort('emitInfoBlockadeLifted', () =>
      emitInfoBlockadeLifted(regime.id, reason),
    );
  }

  return updated;
}

// -------- Аудит --------

export async function auditService(
  regimeId: UUID, requesterId: UUID,
): Promise<{ regime: Regime; findings: string[] }> {
  const regime = await getById(regimeId);
  if (regime.status !== 'active') {throw new ConflictError('Режим не активен');}

  const findings: string[] = [];
  if (isExpired(regime)) {
    findings.push(`Срок режима истёк (max ${getMaxDuration(regime.type)})`);
  }

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'regimes.audit', entityType: 'regime', entityId: regimeId,
    newValue: { findings },
  });

  await bestEffort('emitRegimeAudited', () =>
    emitRegimeAudited({
      regimeId: regime.id,
      type: regime.type,
      findings,
      auditedAt: new Date().toISOString(),
      nextAuditAt: null,
    }),
  );

  return { regime, findings };
}

// -------- Утилита: ускоренный дедлайн --------

export async function getAcceleratedDeadline(baseMs: number): Promise<number> {
  if (await isQuantumAccelerationActive()) {
    return calculateAcceleratedDeadline(baseMs);
  }
  return baseMs;
}

export async function getCurrentDeadlines(): Promise<Record<Priority, number>> {
  const accelerated = await isQuantumAccelerationActive();
  const result: Record<Priority, number> = { ...PRIORITY_DEADLINES_MS } as Record<Priority, number>;
  if (accelerated) {
    for (const p of ['critical', 'high', 'standard', 'background'] as Priority[]) {
      result[p] = calculateAcceleratedDeadline(PRIORITY_DEADLINES_MS[p]);
    }
  }
  return result;
}

// -------- Мобилизация --------

interface MobRow {
  id: string;
  regime_id: string;
  required_count: number;
  confirmed_count: number;
  refused_count: number;
  threshold_percent: string;
  status: MobilizationStatus;
  created_at: Date;
  completed_at: Date | null;
}

function rowToMob(row: MobRow): CrisisMobilization {
  return {
    id: row.id,
    regimeId: row.regime_id,
    requiredCount: row.required_count,
    confirmedCount: row.confirmed_count,
    refusedCount: row.refused_count,
    thresholdPercent: parseFloat(row.threshold_percent),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

export async function getMobilization(regimeId: UUID): Promise<CrisisMobilization | null> {
  const row = await queryOne<MobRow>(
    `SELECT id, regime_id, required_count, confirmed_count, refused_count,
            threshold_percent::text AS threshold_percent, status, created_at, completed_at
       FROM crisis_mobilizations WHERE regime_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [regimeId],
  );
  return row ? rowToMob(row) : null;
}

// B6: advisory lock по regimeId, чтобы два параллельных startMobilization
// не создали две active-строки.
export async function startMobilization(
  regimeId: UUID, requiredCount: number, thresholdPercent: number, requesterId: UUID,
): Promise<CrisisMobilization> {
  const regime = await getById(regimeId);
  if (regime.status !== 'active') {throw new ConflictError('Режим не активен');}
  if (regime.type !== 'steel_bell' && regime.type !== 'red_circuit') {
    throw new ConflictError('Мобилизация только для Стального Колокола / Красного Контура');
  }
  if (requiredCount <= 0) {throw new ConflictError('required_count > 0');}

  const id = await transaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`regime:mobilization:${regimeId}`],
    );
    const active = await client.query<{ id: string }>(
      `SELECT id FROM crisis_mobilizations
        WHERE regime_id = $1 AND status = 'active' LIMIT 1`,
      [regimeId],
    );
    if (active.rows.length > 0) {
      throw new ConflictError('Активная мобилизация для этого режима уже существует');
    }
    const mobId = newUUID();
    await client.query(
      `INSERT INTO crisis_mobilizations (id, regime_id, required_count, threshold_percent, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [mobId, regimeId, requiredCount, thresholdPercent],
    );
    return mobId;
  });

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'regimes.mobilization_start', entityType: 'crisis_mobilization', entityId: id,
    newValue: { required_count: requiredCount },
  });

  const m = await getMobilization(regimeId);
  if (!m) {throw new Error('mobilization not found after insert');}

  await bestEffort('emitMobilizationStarted', () =>
    emitMobilizationStarted(
      {
        id: m.id,
        regimeId: m.regimeId,
        requiredCount: m.requiredCount,
        confirmedCount: m.confirmedCount,
        refusedCount: m.refusedCount,
        thresholdPercent: m.thresholdPercent,
        status: m.status,
        createdAt: m.createdAt,
        completedAt: m.completedAt,
      },
      {
        planId: regimeId, // placeholder — C.0.06.02 может дать настоящий plan.id
        title: regime.reason ?? 'Мобилизация',
        points: [],
      },
    ),
  );

  return m;
}

// B4: если участник уже отказался — подтверждение невозможно.
export async function confirmMobilization(
  mobilizationId: UUID, participantId: UUID,
): Promise<CrisisMobilization> {
  const updated = await transaction(async (client) => {
    const rowRes = await client.query<MobRow>(
      `SELECT id, regime_id, required_count, confirmed_count, refused_count,
              threshold_percent::text AS threshold_percent, status, created_at, completed_at
         FROM crisis_mobilizations
        WHERE id = $1
        FOR UPDATE`,
      [mobilizationId],
    );
    const row = rowRes.rows[0];
    if (!row) {throw new NotFoundError('Мобилизация', mobilizationId);}
    if (row.status !== 'active') {throw new ConflictError('Мобилизация не активна');}

    // B4: уже отказался — подтвердить нельзя.
    const existingRefusal = await client.query<{ id: string }>(
      `SELECT id FROM crisis_refusals
        WHERE mobilization_id = $1 AND participant_id = $2
        LIMIT 1`,
      [mobilizationId, participantId],
    );
    if (existingRefusal.rowCount && existingRefusal.rowCount > 0) {
      throw new ConflictError('Вы уже отказались от этой мобилизации — подтверждение невозможно');
    }

    // Явная проверка: участник уже подтверждал?
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM crisis_confirmations
        WHERE mobilization_id = $1 AND participant_id = $2
        LIMIT 1`,
      [mobilizationId, participantId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictError('Вы уже подтвердили участие в этой мобилизации');
    }

    // INSERT — защита от гонки через UNIQUE.
    try {
      await client.query(
        `INSERT INTO crisis_confirmations (id, mobilization_id, participant_id)
         VALUES ($1, $2, $3)`,
        [newUUID(), mobilizationId, participantId],
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError('Вы уже подтвердили участие в этой мобилизации');
      }
      throw e;
    }

    await client.query(
      `UPDATE crisis_mobilizations
          SET confirmed_count = confirmed_count + 1
        WHERE id = $1`,
      [mobilizationId],
    );

    const updatedRes = await client.query<MobRow>(
      `SELECT id, regime_id, required_count, confirmed_count, refused_count,
              threshold_percent::text AS threshold_percent, status, created_at, completed_at
         FROM crisis_mobilizations WHERE id = $1`,
      [mobilizationId],
    );
    const updated = updatedRes.rows[0];
    if (!updated) {
      throw new Error('mobilization disappeared inside transaction');
    }

    const pct = (updated.confirmed_count / updated.required_count) * 100;
    const threshold = parseFloat(updated.threshold_percent);
    if (pct >= threshold && updated.status === 'active') {
      await client.query(
        `UPDATE crisis_mobilizations
            SET status = 'completed', completed_at = now()
          WHERE id = $1`,
        [mobilizationId],
      );
      updated.status = 'completed';
      updated.completed_at = new Date();
    }

    return updated;
  });

  await logAction({
    actorId: participantId, actorType: 'participant',
    action: 'regimes.mobilization_confirm',
    entityType: 'crisis_mobilization', entityId: mobilizationId,
    newValue: { confirmed_count: updated.confirmed_count },
  });

  const percent = Math.round((updated.confirmed_count / updated.required_count) * 10000) / 100;
  await bestEffort('emitMobilizationConfirmed', () =>
    emitMobilizationConfirmed(
      mobilizationId,
      updated.confirmed_count,
      updated.required_count,
      percent,
    ),
  );

  if (updated.status === 'completed') {
    await bestEffort('emitMobilizationCompleted', () =>
      emitMobilizationCompleted(mobilizationId, {
        confirmedCount: updated.confirmed_count,
        refusedCount: updated.refused_count,
        totalParticipants: updated.required_count,
      }),
    );
  }

  return rowToMob(updated);
}

// B5: если участник уже подтвердил — отказ невозможен; refusedCount/percent
// берём из транзакции (было: getMobilization(mobId) — с неверным аргументом).
export async function refuseMobilization(
  mobilizationId: UUID, participantId: UUID, reason: string | null,
): Promise<CrisisRefusal> {
  const { refusal, percent, refusedCount } = await transaction(async (client) => {
    const rowRes = await client.query<MobRow>(
      `SELECT id, regime_id, required_count, confirmed_count, refused_count,
              threshold_percent::text AS threshold_percent, status, created_at, completed_at
         FROM crisis_mobilizations
        WHERE id = $1
        FOR UPDATE`,
      [mobilizationId],
    );
    const row = rowRes.rows[0];
    if (!row) {throw new NotFoundError('Мобилизация', mobilizationId);}
    if (row.status !== 'active') {throw new ConflictError('Мобилизация не активна');}

    // B4-симметрия: нельзя отказаться, если уже подтвердил.
    const existingConfirm = await client.query<{ id: string }>(
      `SELECT id FROM crisis_confirmations
        WHERE mobilization_id = $1 AND participant_id = $2
        LIMIT 1`,
      [mobilizationId, participantId],
    );
    if (existingConfirm.rowCount && existingConfirm.rowCount > 0) {
      throw new ConflictError('Вы уже подтвердили участие — отказ невозможен');
    }

    // Проверка: уже отказывался?
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM crisis_refusals
        WHERE mobilization_id = $1 AND participant_id = $2
        LIMIT 1`,
      [mobilizationId, participantId],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ConflictError('Вы уже отказались от участия в этой мобилизации');
    }

    const id = newUUID();

    try {
      await client.query(
        `INSERT INTO crisis_refusals (id, mobilization_id, participant_id, reason)
         VALUES ($1, $2, $3, $4)`,
        [id, mobilizationId, participantId, reason],
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictError('Вы уже отказались от участия в этой мобилизации');
      }
      throw e;
    }

    const upd = await client.query<{ refused_count: number; required_count: number }>(
      `UPDATE crisis_mobilizations
          SET refused_count = refused_count + 1
        WHERE id = $1
        RETURNING refused_count, required_count`,
      [mobilizationId],
    );
    const r = upd.rows[0];
    if (!r) {
      throw new Error('mobilization disappeared inside transaction');
    }

    return {
      refusal: {
        id,
        mobilizationId,
        participantId,
        reason,
        createdAt: new Date().toISOString(),
      },
      refusedCount: r.refused_count,
      percent: Math.round((r.refused_count / r.required_count) * 10000) / 100,
    };
  });

  await logAction({
    actorId: participantId, actorType: 'participant',
    action: 'regimes.mobilization_refuse',
    entityType: 'crisis_mobilization', entityId: mobilizationId,
    newValue: { reason: reason ?? null },
  });

  // B5: используем refusedCount/percent из транзакции, не getMobilization(mobId).
  await bestEffort('emitMobilizationRefused', () =>
    emitMobilizationRefused(mobilizationId, refusedCount, percent),
  );

  return refusal;
}

export async function getMobilizationShare(
  mobilizationId: UUID,
): Promise<{ confirmed: number; refused: number; percent: number }> {
  const row = await queryOne<MobRow>(
    `SELECT id, regime_id, required_count, confirmed_count, refused_count,
            threshold_percent::text AS threshold_percent, status, created_at, completed_at
       FROM crisis_mobilizations WHERE id = $1`,
    [mobilizationId],
  );
  if (!row) {throw new NotFoundError('Мобилизация', mobilizationId);}
  const m = rowToMob(row);
  return {
    confirmed: m.confirmedCount,
    refused: m.refusedCount,
    percent: getMobilizationPercent(m),
  };
}

// -------- Cron: проверка автоактивации --------

// B7: эмитим WS для деактивации; B9: возвращаем фактически деактивированные.
export async function checkAutoActivation(): Promise<Regime[]> {
  const deactivated: Regime[] = [];
  const active = await getActive();
  for (const r of active) {
    if (!isExpired(r)) {continue;}

    let didDeactivate = false;
    await transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE regimes
            SET status = 'finished', deactivated_at = now()
          WHERE id = $1 AND status = 'active'
          RETURNING id`,
        [r.id],
      );
      if (result.rows.length === 0) {return;} // другой cron уже
      didDeactivate = true;

      if (r.type === 'steel_bell') {
        await client.query(
          `UPDATE regimes SET status = 'finished', deactivated_at = now()
            WHERE type = 'quantum_acceleration' AND status = 'active'`,
        );
      }
    });

    if (!didDeactivate) {continue;}

    deactivated.push(r);

    // B7/B24: эмитим WS для деактивации.
    await bestEffort('emitRegimeDeactivated', () =>
      emitRegimeDeactivated(r.id, r.type, 'Auto-deactivated (expired)'),
    );
    if (r.type === 'info_blockade') {
      await bestEffort('emitInfoBlockadeLifted', () =>
        emitInfoBlockadeLifted(r.id, 'Auto-deactivated (expired)'),
      );
    }
  }

  await invalidateRegimeCache();
  // B9: возвращаем фактически деактивированные (было: пустой массив activated).
  return deactivated;
}

// Реэкспорт для контроллера
export { canRefuseMobilization };