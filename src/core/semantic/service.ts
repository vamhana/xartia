// C.0.29.02 — Сервис Семантического Стража.src\core\semantic\service.ts
// Дрейф, тревога, вето, словарь, перевод. Игнорирование 3 часа → Форум.
// Вето 3 дня → референдум. Давление = узурпация → InfoBlockade. Страж не отстраняется.
//
// v0.0.02:
//   - P3: checkTranslationService — logAction после INSERT (III.5).
//   - P4: reportPressureService — ValidationError вместо ConflictError;
//         signal создаётся ДО InfoBlockade (атомарность side-effects);
//         signal — обязательный (throw при ошибке), InfoBlockade — best-effort.
//   - P5: acknowledge/escalate/liftVeto — атомарные UPDATE с проверкой
//         status и RETURNING; после — перечитываем из БД.

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { sendToRole } from '../../lib/notifications.js';
import {
  emitDriftDetected,
  emitAlarmRaised,
  emitAlarmEscalated,
  emitVetoImposed,
  emitVetoLifted,
  emitReportPublished,
  emitPressureReported,
} from '../../ws/semantic.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ValidationError } from '../errors.js';
import { Role } from '../roles.js';
import type { UUID } from '../types.js';

import {
  createDrift, raiseAlarm, acknowledgeAlarm, escalateAlarm,
  shouldEscalateToForum,
  imposeVeto, liftVeto, isVetoExpired,
  createDictionaryTerm, updateDictionaryTerm,
  checkTranslation as checkTranslationEntity,
  canRemoveGuardian as canRemoveGuardianEntity,
  type SemanticDrift, type SemanticAlarm, type Veto,
  type DictionaryTerm, type TranslationCheck,
  type DriftStatus, type AlarmStatus, type AlarmEscalation, type VetoType,
} from './entity.js';


// -------- Ряды --------

interface DriftRow {
  id: string; term: string; original_meaning: string; detected_meaning: string;
  severity: number; detected_by: string; status: DriftStatus;
  created_at: Date; resolved_at: Date | null;
}
interface AlarmRow {
  id: string; drift_id: string | null; priority: number; raised_by: string;
  status: AlarmStatus; escalated_to: AlarmEscalation | null;
  created_at: Date; acknowledged_at: Date | null; acknowledged_by: string | null;
  escalated_at: Date | null; resolved_at: Date | null;
}
interface VetoRow {
  id: string; type: VetoType; decision_ref: string; reason: string;
  valid_from: Date; valid_to: Date; status: 'active' | 'lifted' | 'expired';
  lifted_at: Date | null; lift_reason: string | null;
}
interface DictRow {
  id: string; term: string; definition: string; version: number;
  created_at: Date; updated_at: Date;
}
interface TransRow {
  id: string; original: string; translated: string; language: string;
  ok: boolean; drift: Array<{ term: string; delta: string }>;
  recommendation: string | null; created_at: Date;
}

function rowToDrift(r: DriftRow): SemanticDrift {
  return {
    id: r.id, term: r.term,
    originalMeaning: r.original_meaning, detectedMeaning: r.detected_meaning,
    severity: r.severity, detectedBy: r.detected_by, status: r.status,
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
  };
}
function rowToAlarm(r: AlarmRow): SemanticAlarm {
  return {
    id: r.id, driftId: r.drift_id, priority: r.priority, raisedBy: r.raised_by,
    status: r.status, escalatedTo: r.escalated_to,
    createdAt: r.created_at.toISOString(),
    acknowledgedAt: r.acknowledged_at ? r.acknowledged_at.toISOString() : null,
    acknowledgedBy: r.acknowledged_by,
    escalatedAt: r.escalated_at ? r.escalated_at.toISOString() : null,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
  };
}
function rowToVeto(r: VetoRow): Veto {
  return {
    id: r.id, type: r.type, decisionRef: r.decision_ref, reason: r.reason,
    validFrom: r.valid_from.toISOString(),
    validTo: r.valid_to.toISOString(),
    status: r.status,
    liftedAt: r.lifted_at ? r.lifted_at.toISOString() : null,
    liftReason: r.lift_reason,
  };
}
function rowToDict(r: DictRow): DictionaryTerm {
  return {
    id: r.id, term: r.term, definition: r.definition, version: r.version,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
export function rowToTrans(r: TransRow): TranslationCheck {
  return {
    id: r.id, original: r.original, translated: r.translated,
    language: r.language, ok: r.ok, drift: r.drift,
    recommendation: r.recommendation,
    createdAt: r.created_at.toISOString(),
  };
}

// -------- Drift --------

export interface DriftFilter {
  term?: string;
  status?: DriftStatus;
  minSeverity?: number;
  page?: number;
  perPage?: number;
}

export async function listDrift(
  filter: DriftFilter = {},
): Promise<{ data: SemanticDrift[]; total: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filter.perPage ?? 50));
  const offset = (page - 1) * perPage;

  const cond: string[] = [];
  const params: unknown[] = [];
  if (filter.term) {
    params.push(`%${filter.term}%`);
    cond.push(`term ILIKE $${params.length}`);
  }
  if (filter.status) { params.push(filter.status); cond.push(`status = $${params.length}`); }
  if (filter.minSeverity !== undefined) {
    params.push(filter.minSeverity);
    cond.push(`severity >= $${params.length}`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM semantic_drift ${where}`,
    params,
  );
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(perPage, offset);
  const rows = await query<DriftRow>(
    `SELECT id, term, original_meaning, detected_meaning, severity,
            detected_by, status, created_at, resolved_at
       FROM semantic_drift
       ${where}
      ORDER BY severity DESC, created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows.map(rowToDrift), total };
}

export async function createDriftService(input: {
  term: string;
  originalMeaning: string;
  detectedMeaning: string;
  severity: number;
  detectedBy: UUID;
}): Promise<SemanticDrift> {
  const entity = createDrift({
    id: newUUID(),
    term: input.term,
    originalMeaning: input.originalMeaning,
    detectedMeaning: input.detectedMeaning,
    severity: input.severity,
    detectedBy: input.detectedBy,
  });

  await query(
    `INSERT INTO semantic_drift
       (id, term, original_meaning, detected_meaning, severity, detected_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'new')`,
    [
      entity.id, entity.term, entity.originalMeaning,
      entity.detectedMeaning, entity.severity, entity.detectedBy,
    ],
  );

  await logAction({
    actorId: input.detectedBy, actorType: 'participant',
    action: 'semantic.drift', entityType: 'semantic_drift', entityId: entity.id,
    newValue: { term: entity.term, severity: entity.severity },
  });

  await emitDriftDetected({
    id: entity.id,
    term: entity.term,
    severity: entity.severity,
    originalMeaning: entity.originalMeaning,
    detectedMeaning: entity.detectedMeaning,
    detectedAt: entity.createdAt,
  });

  return entity;
}

// -------- Alarm --------

export async function getAlarm(alarmId: UUID): Promise<SemanticAlarm> {
  const row = await queryOne<AlarmRow>(
    `SELECT id, drift_id, priority, raised_by, status, escalated_to,
            created_at, acknowledged_at, acknowledged_by, escalated_at, resolved_at
       FROM semantic_alarms WHERE id = $1`,
    [alarmId],
  );
  if (!row) {throw new NotFoundError('Тревога', alarmId);}
  return rowToAlarm(row);
}

export async function listAlarms(
  status?: AlarmStatus,
): Promise<SemanticAlarm[]> {
  const params: unknown[] = [];
  const where = status
    ? (params.push(status), `WHERE status = $${params.length}`)
    : '';
  const rows = await query<AlarmRow>(
    `SELECT id, drift_id, priority, raised_by, status, escalated_to,
            created_at, acknowledged_at, acknowledged_by, escalated_at, resolved_at
       FROM semantic_alarms
       ${where}
      ORDER BY priority DESC, created_at DESC
      LIMIT 200`,
    params,
  );
  return rows.map(rowToAlarm);
}

export interface CreateAlarmOptions {
  /** Пропустить рассылку ролевых уведомлений (для составных сценариев, где
   *  уведомление шлётся отдельно). */
  silent?: boolean;
}

export async function createAlarmService(
  driftId: UUID | null,
  raisedBy: UUID,
  options: CreateAlarmOptions = {},
): Promise<SemanticAlarm> {
  if (driftId) {
    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM semantic_drift WHERE id = $1`,
      [driftId],
    );
    if (!exists) {throw new NotFoundError('Дрейф', driftId);}
  }

  const entity = raiseAlarm({ id: newUUID(), driftId, raisedBy });

  await query(
    `INSERT INTO semantic_alarms
       (id, drift_id, priority, raised_by, status)
     VALUES ($1, $2, $3, $4, 'raised')`,
    [entity.id, entity.driftId, entity.priority, entity.raisedBy],
  );

  await logAction({
    actorId: raisedBy, actorType: 'participant',
    action: 'semantic.alarm', entityType: 'semantic_alarm', entityId: entity.id,
    newValue: { drift_id: driftId, priority: entity.priority },
  });

  // Broadcast critical notification to all relevant roles.
  // Best-effort: не падаем, если notification subsystem недоступен.
  // Пропускается, если silent=true (составные сценарии шлют своё уведомление).
  if (!options.silent) {
    void Promise.all([
      sendToRole(Role.FIRST_ARCHITECT, {
        type: 'semantic.alarm',
        priority: 'critical',
        title: '🔮 Семантическая тревога',
        body: `Тревога создана (priority ${entity.priority}). ID: ${entity.id.slice(0, 8)}…`,
        data: { alarmId: entity.id, driftId: entity.driftId ?? null },
      }),
      sendToRole(Role.COUNCIL_MEMBER, {
        type: 'semantic.alarm',
        priority: 'critical',
        title: '🔮 Семантическая тревога',
        body: `Тревога создана (priority ${entity.priority}). ID: ${entity.id.slice(0, 8)}…`,
        data: { alarmId: entity.id, driftId: entity.driftId ?? null },
      }),
      sendToRole(Role.VERIFIER, {
        type: 'semantic.alarm',
        priority: 'critical',
        title: '🔮 Семантическая тревога',
        body: `Тревога создана (priority ${entity.priority}). ID: ${entity.id.slice(0, 8)}…`,
        data: { alarmId: entity.id, driftId: entity.driftId ?? null },
      }),
    ]).catch((e) => {
      // best-effort — не срывать создание тревоги из-за notification subsystem
      logger.warn({ err: e }, 'semantic alarm notification failed');
    });
  }

  await emitAlarmRaised({
    id: entity.id,
    driftId: entity.driftId,
    priority: entity.priority,
    raisedBy: entity.raisedBy,
    raisedAt: entity.createdAt,
  });

  try {
    const { dispatch } = await import('../webhooks/service.js');
    await dispatch('semantic.alarm', {
      alarmId: entity.id,
      driftId: entity.driftId,
      priority: entity.priority,
      raisedBy: entity.raisedBy,
      raisedAt: entity.createdAt,
    });
  } catch (e) {
    logger.warn({ err: e, event: 'semantic.alarm' }, 'webhook dispatch failed');
  }

  return entity;
}

// P5: атомарный UPDATE с проверкой status. 0 rows → 409 (race-safe).
export async function acknowledgeAlarmService(
  alarmId: UUID,
  by: UUID,
): Promise<SemanticAlarm> {
  const a = await getAlarm(alarmId);
  acknowledgeAlarm(a, by); // entity: throws ConflictError если !raised

  const affected = await query<{ id: string }>(
    `UPDATE semantic_alarms
        SET status = 'acknowledged',
            acknowledged_at = now(),
            acknowledged_by = $1
      WHERE id = $2 AND status = 'raised'
      RETURNING id`,
    [by, alarmId],
  );
  if (affected.length === 0) {
    throw new ConflictError('Тревога уже не в статусе raised');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.alarm.ack', entityType: 'semantic_alarm', entityId: alarmId,
  });

  return getAlarm(alarmId);
}

// P5: атомарный UPDATE с проверкой status. 0 rows → 409 (race-safe).
export async function escalateAlarmService(
  alarmId: UUID,
  to: AlarmEscalation,
  by: UUID,
): Promise<SemanticAlarm> {
  const a = await getAlarm(alarmId);
  escalateAlarm(a, to); // entity-валидация переходов

  const affected = await query<{ id: string; escalated_at: Date }>(
    `UPDATE semantic_alarms
        SET status = 'escalated', escalated_to = $1, escalated_at = now()
      WHERE id = $2 AND status <> 'resolved'
      RETURNING id, escalated_at`,
    [to, alarmId],
  );
  const row = affected[0];
  if (!row) {
    throw new ConflictError('Тревога уже разрешена');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.alarm.escalate', entityType: 'semantic_alarm', entityId: alarmId,
    newValue: { to },
  });

  await emitAlarmEscalated(alarmId, to, row.escalated_at.toISOString());

  return getAlarm(alarmId);
}

export async function checkAlarmTimeouts(): Promise<{ escalated: number }> {
  const rows = await query<AlarmRow>(
    `SELECT id, drift_id, priority, raised_by, status, escalated_to,
            created_at, acknowledged_at, acknowledged_by, escalated_at, resolved_at
       FROM semantic_alarms
      WHERE status = 'raised'
        AND created_at <= now() - interval '3 hours'
      LIMIT 100`,
  );
  let count = 0;
  for (const r of rows) {
    const a = rowToAlarm(r);
    if (shouldEscalateToForum(a)) {
      await escalateAlarmService(a.id, 'forum', a.raisedBy);
      count++;
    }
  }
  return { escalated: count };
}

// -------- Veto --------

export async function getVeto(vetoId: UUID): Promise<Veto> {
  const row = await queryOne<VetoRow>(
    `SELECT id, type, decision_ref, reason, valid_from, valid_to,
            status, lifted_at, lift_reason
       FROM vetoes WHERE id = $1`,
    [vetoId],
  );
  if (!row) {throw new NotFoundError('Вето', vetoId);}
  return rowToVeto(row);
}

export async function createVetoService(input: {
  type: VetoType;
  decisionRef: UUID;
  reason: string;
  imposedBy: UUID;
}): Promise<Veto> {
  const entity = imposeVeto({
    id: newUUID(),
    type: input.type,
    decisionRef: input.decisionRef,
    reason: input.reason,
  });

  await query(
    `INSERT INTO vetoes
       (id, type, decision_ref, reason, valid_from, valid_to, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [
      entity.id, entity.type, entity.decisionRef, entity.reason,
      entity.validFrom, entity.validTo,
    ],
  );

  await logAction({
    actorId: input.imposedBy, actorType: 'participant',
    action: 'semantic.veto', entityType: 'veto', entityId: entity.id,
    newValue: { decision_ref: entity.decisionRef, type: entity.type },
  });

  await emitVetoImposed({
    id: entity.id,
    type: entity.type,
    decisionRef: entity.decisionRef,
    reason: entity.reason,
    validFrom: entity.validFrom,
    validTo: entity.validTo,
  });

  return entity;
}

// P5: атомарный UPDATE с проверкой status. 0 rows → 409 (race-safe).
export async function liftVetoService(
  vetoId: UUID,
  reason: string,
  by: UUID,
): Promise<Veto> {
  const v = await getVeto(vetoId);
  liftVeto(v, reason); // entity: throws ConflictError если status !== 'active'

  const affected = await query<{ id: string; lifted_at: Date }>(
    `UPDATE vetoes
        SET status = 'lifted', lifted_at = now(), lift_reason = $1
      WHERE id = $2 AND status = 'active'
      RETURNING id, lifted_at`,
    [reason, vetoId],
  );
  const row = affected[0];
  if (!row) {
    throw new ConflictError('Вето уже не активно');
  }

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.veto.lift', entityType: 'veto', entityId: vetoId,
    newValue: { reason },
  });

  await emitVetoLifted(vetoId, reason, row.lifted_at.toISOString());

  return getVeto(vetoId);
}

export async function checkVetoExpiry(): Promise<{ expired: number }> {
  const rows = await query<VetoRow>(
    `SELECT id, type, decision_ref, reason, valid_from, valid_to,
            status, lifted_at, lift_reason
       FROM vetoes
      WHERE status = 'active' AND valid_to <= now()
      LIMIT 100`,
  );
  for (const r of rows) {
    if (isVetoExpired(rowToVeto(r))) {
      await query(
        `UPDATE vetoes SET status = 'expired' WHERE id = $1`,
        [r.id],
      );
    }
  }
  return { expired: rows.length };
}

// -------- Dictionary --------

export async function listDictionary(): Promise<DictionaryTerm[]> {
  const rows = await query<DictRow>(
    `SELECT id, term, definition, version, created_at, updated_at
       FROM dictionary_terms ORDER BY term`,
  );
  return rows.map(rowToDict);
}

export async function createTermService(input: {
  term: string;
  definition: string;
  by: UUID;
}): Promise<DictionaryTerm> {
  const entity = createDictionaryTerm({
    id: newUUID(),
    term: input.term,
    definition: input.definition,
  });

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM dictionary_terms WHERE term = $1`,
    [entity.term],
  );
  if (existing) {throw new ConflictError('Термин уже существует');}

  await query(
    `INSERT INTO dictionary_terms (id, term, definition, version)
     VALUES ($1, $2, $3, 1)`,
    [entity.id, entity.term, entity.definition],
  );

  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'semantic.dictionary.create', entityType: 'dictionary_term', entityId: entity.id,
    newValue: { term: entity.term },
  });

  return entity;
}

export async function updateTermService(
  termId: UUID,
  definition: string,
  by: UUID,
): Promise<DictionaryTerm> {
  const row = await queryOne<DictRow>(
    `SELECT id, term, definition, version, created_at, updated_at
       FROM dictionary_terms WHERE id = $1`,
    [termId],
  );
  if (!row) {throw new NotFoundError('Термин', termId);}

  const updated = updateDictionaryTerm(rowToDict(row), definition);

  await query(
    `UPDATE dictionary_terms
        SET definition = $1, version = $2, updated_at = now()
      WHERE id = $3`,
    [updated.definition, updated.version, termId],
  );

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.dictionary.update', entityType: 'dictionary_term', entityId: termId,
    newValue: { version: updated.version },
  });

  return updated;
}

// -------- Translation --------

// P3: logAction после INSERT (III.5 — аудит мутирующих вызовов).
export async function checkTranslationService(input: {
  original: string;
  translated: string;
  language: string;
  by: UUID;
}): Promise<TranslationCheck> {
  const entity = checkTranslationEntity({
    id: newUUID(),
    original: input.original,
    translated: input.translated,
    language: input.language,
  });

  await query(
    `INSERT INTO translation_checks
       (id, original, translated, language, ok, drift, recommendation)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      entity.id, entity.original, entity.translated, entity.language,
      entity.ok, JSON.stringify(entity.drift), entity.recommendation,
    ],
  );

  // III.5: аудит мутирующих вызовов.
  await logAction({
    actorId: input.by, actorType: 'participant',
    action: 'semantic.translation.check',
    entityType: 'translation_check', entityId: entity.id,
    newValue: {
      language: entity.language,
      ok: entity.ok,
      drift_count: entity.drift.length,
    },
  });

  return entity;
}

// -------- Report --------

export async function getReport(
  year: number,
  by: UUID,
): Promise<{ year: number; drifts: number; alarms: number; vetoes: number; dictionaryTerms: number; generatedAt: string }> {
  const [d, a, v, t] = await Promise.all([
    queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM semantic_drift
        WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year],
    ),
    queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM semantic_alarms
        WHERE EXTRACT(YEAR FROM created_at) = $1`,
      [year],
    ),
    queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM vetoes
        WHERE EXTRACT(YEAR FROM valid_from) = $1`,
      [year],
    ),
    queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM dictionary_terms`,
    ),
  ]);

  const report = {
    year,
    drifts: parseInt(d?.c ?? '0', 10),
    alarms: parseInt(a?.c ?? '0', 10),
    vetoes: parseInt(v?.c ?? '0', 10),
    dictionaryTerms: parseInt(t?.c ?? '0', 10),
    generatedAt: new Date().toISOString(),
  };

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.report', entityType: 'semantic_report', entityId: newUUID(),
    newValue: report,
  });

  await emitReportPublished(year, report.generatedAt);

  return report;
}

// -------- Pressure (узурпация) --------

// P4: signal создаётся ДО InfoBlockade (атомарность side-effects).
// Signal — обязательный (throw при ошибке). InfoBlockade — best-effort.
export async function reportPressureService(
  description: string,
  by: UUID,
): Promise<{ signalId: UUID; alarmId: UUID; infoBlockadeActivated: boolean }> {
  if (!description.trim()) {throw new ValidationError('Описание обязательно');}

  // 1. Тревога высшего приоритета.
  //    silent=true — общие ролевые уведомления не шлём, потому что ниже
  //    идёт отдельный emitPressureReported с более точным текстом.
  const alarm = await createAlarmService(null, by, { silent: true });

  await logAction({
    actorId: by, actorType: 'participant',
    action: 'semantic.pressure', entityType: 'semantic_alarm', entityId: alarm.id,
    newValue: { description: description.slice(0, 200) },
  });

  await emitPressureReported(description, alarm.id, by);

  // 2. Сигнал — ДО InfoBlockade. Если createSignalService упадёт,
  //    не активируем блокировку без тревоги (атомарность side-effects).
  let signalId: UUID;
  try {
    const { createSignalService } = await import('../signals/service.js');
    const signal = await createSignalService({
      type: 'problem',
      description: `Давление на Семантического Стража: ${description}`,
      justification: 'Защита Стража — I.4.6.4',
      priority: 'critical',
    }, by);
    signalId = signal.id;
  } catch (e) {
    logger.error({ err: e }, 'semantic pressure: createSignalService failed');
    throw e;
  }

  // 3. InfoBlockade — best-effort. Если не активируется, ответ 201
  //    с infoBlockadeActivated=false (клиент видит, что блокировка не встала).
  let infoBlockadeActivated = false;
  try {
    const { activateInfoBlockade } = await import('../../security/gateway-isolation.js');
    await activateInfoBlockade(`Давление на Стража: ${description}`);
    infoBlockadeActivated = true;
  } catch (e) {
    logger.warn({ err: e }, 'semantic pressure: activateInfoBlockade failed');
  }

  return { signalId, alarmId: alarm.id, infoBlockadeActivated };
}

// -------- Guardian removal --------

export async function canRemoveGuardian(by: UUID): Promise<boolean> {
  // В текущей реализации процедура 1.10.3 не автоматизирована.
  // Стража нельзя отстранить через API — только через Совет Протоколов
  // с квалифицированным большинством 2/3 и 6-дневным обсуждением (I.4.6.4).
  void canRemoveGuardianEntity;
  void by;
  return false;
}