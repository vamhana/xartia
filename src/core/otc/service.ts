// C.0.09.02 — Сервис ОТК
// Приёмка, возврат, статистика. Начисление Потока +1 при accept.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: убран Architect override в decide(). I.2.12 без исключений.
//         I.2.12 → ForbiddenError (403), было ConflictError (409).
//   - B2: crisisDecide() — добавлена I.2.12-проверка (не было).
//   - B3: crisisDecide() — assignedTo === null → понятный ConflictError.
//   - B5: appeal() — identity check → ForbiddenError (403), было ConflictError.
//   - B7: WS-эмиссии — try/catch (best-effort). Не блокируют ответ.
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - B4: INSERT решения + accept/return — не в одной транзакции.
//     При сбое шага 2 — решение в БД, задача submitted.
//   - B6: appeal() передаёт фиктивный OtcDecision в canBeAppealed.
//     Проверка works, но хрупкая. Требует изменения signature в C.0.09.01.
//   - B8: getStats().avgCheckHours — всегда null (не реализовано).
//   - canBeAppealed для accepted-решений — возможно (spec I.2.13 не запрещает).

import { query, queryOne } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import {
  emitDecisionMade,
  emitCrisisDecisionMade,
  emitAppealFiled,
  emitQueueUpdated,
} from '../../ws/otc.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../errors.js';
import { awardForAcceptedTask } from '../flows/service.js';
import { getById as getReportById } from '../reports/service.js';
import { getById as getTaskById, acceptTaskService, returnTaskService } from '../tasks/service.js';
import type { UUID } from '../types.js';

import {
  createDecision,
  createCrisisDecision,
  createAppeal,
  canBeAppealed,
  type OtcDecision,
  type OtcVerdict,
  type OtcAppeal,
  type OtcAppealStatus,
} from './entity.js';

export interface OtcQueueItem {
  reportId: UUID;
  taskId: UUID;
  taskExternalId: string;
  taskDescription: string;
  directionId: UUID;
  authorId: UUID;
  authorName: string;
  type: string;
  comment: string | null;
  mediaUrl: string | null;
  artifactUrl: string | null;
  geolocation: { lat: number; lon: number } | null;
  createdAt: string;
  hoursWaiting: number;
}

export async function getQueue(directionId?: UUID): Promise<OtcQueueItem[]> {
  const params: unknown[] = [];
  const whereDir = directionId
    ? (params.push(directionId), `AND t.direction_id = $${params.length}`)
    : '';

  const rows = await query<{
    report_id: string;
    task_id: string;
    task_external_id: string;
    task_description: string;
    direction_id: string;
    participant_id: string;
    participant_name: string;
    type: string;
    comment: string | null;
    media_url: string | null;
    artifact_url: string | null;
    geolocation: { coordinates: [number, number] } | null;
    created_at: Date;
    hours_waiting: string;
  }>(
    `SELECT r.id AS report_id, t.id AS task_id, t.external_id AS task_external_id,
            t.description AS task_description,
            t.direction_id, r.participant_id, p.name AS participant_name,
            r.type, r.comment, r.media_url, r.artifact_url,
            ST_AsGeoJSON(r.geolocation)::json AS geolocation,
            r.created_at,
            EXTRACT(EPOCH FROM (now() - r.created_at))/3600 AS hours_waiting
       FROM reports r
       JOIN tasks t ON t.id = r.task_id
       JOIN participants p ON p.id = r.participant_id
      WHERE t.status = 'submitted' ${whereDir}
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                        WHEN 'standard' THEN 3 ELSE 4 END,
        r.created_at ASC
      LIMIT 100`,
    params,
  );

  return rows.map((row) => {
    let geolocation: { lat: number; lon: number } | null = null;
    const coords = row.geolocation?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lon, lat] = coords;
      if (typeof lon === 'number' && typeof lat === 'number') {
        geolocation = { lon, lat };
      }
    }
    return {
      reportId: row.report_id,
      taskId: row.task_id,
      taskExternalId: row.task_external_id,
      taskDescription: row.task_description,
      directionId: row.direction_id,
      authorId: row.participant_id,
      authorName: row.participant_name,
      type: row.type,
      comment: row.comment,
      mediaUrl: row.media_url,
    artifactUrl: row.artifact_url,
      geolocation,
      createdAt: row.created_at.toISOString(),
      hoursWaiting: Math.round(parseFloat(row.hours_waiting)),
    };
  });
}

export interface DecideRequest {
  reportId: UUID;
  verdict: OtcVerdict;
  comment?: string;
}

export async function decide(
  input: DecideRequest,
  otcId: UUID,
): Promise<OtcDecision> {
  const report = await getReportById(input.reportId);
  const task = await getTaskById(report.taskId);

  if (task.status !== 'submitted') {
    throw new ConflictError(`Задача в статусе ${task.status} — нельзя вынести решение`);
  }

  // B1: I.2.12 без исключений. ForbiddenError (403), не ConflictError (409).
  // Override для Architect убран: I.2.12 не содержит исключений, а I.1.10
  // в проекте не задокументирован. Если понадобится — отдельное право.
  if (task.assignedTo === otcId) {
    throw new ForbiddenError('ОТК не может проверять свою работу (I.2.12)');
  }

  const entity = createDecision(
    input.reportId,
    otcId,
    input.verdict,
    input.comment ?? null,
  );

  // TODO(techdebt, B4): INSERT + accept/return + award — не атомарны.
  // При сбое шага 2/3 — решение в БД, задача в submitted. Нужна транзакция,
  // но acceptTaskService/returnTaskService работают с query напрямую.
  await query(
    `INSERT INTO otc_decisions
       (id, report_id, otc_id, verdict, comment, criteria_version, crisis_protocol)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entity.id, entity.reportId, entity.otcId, entity.verdict,
     entity.comment, entity.criteriaVersion, entity.crisisProtocol],
  );

  if (input.verdict === 'accepted' || input.verdict === 'crisis_protocol') {
    await acceptTaskService(report.taskId, otcId);
    if (task.assignedTo) {
      await awardForAcceptedTask(task.assignedTo, report.taskId, otcId);
    }
  } else {
    await returnTaskService(report.taskId, input.comment ?? 'Возвращено ОТК', otcId);
  }

  await logAction({
    actorId: otcId, actorType: 'participant',
    action: 'otc.decide', entityType: 'otc_decision', entityId: entity.id,
    newValue: { verdict: entity.verdict, report_id: entity.reportId },
  });

  // B7: WS-эмиссия best-effort — решение уже в БД.
  try {
    await emitDecisionMade({
      decisionId: entity.id,
      reportId: entity.reportId,
      taskId: report.taskId,
      taskExternalId: task.externalId,
      directionId: task.directionId,
      otcId,
      verdict: entity.verdict,
      comment: entity.comment,
      assignedTo: task.assignedTo,
      decidedAt: entity.createdAt,
    });
    const queue = await getQueue(task.directionId);
    await emitQueueUpdated(task.directionId, queue.length);
  } catch (e) {
    logger.warn({ err: e, decisionId: entity.id }, 'otc: WS emitDecisionMade failed');
  }

  return entity;
}

export interface CrisisDecideRequest {
  reportId: UUID;
  functionalityOk: boolean;
  safetyOk: boolean;
  comment?: string;
}

export async function crisisDecide(
  input: CrisisDecideRequest,
  otcId: UUID,
): Promise<OtcDecision> {
  const report = await getReportById(input.reportId);
  const task = await getTaskById(report.taskId);

  if (task.priority !== 'critical') {
    throw new ConflictError('Кризисный протокол — только для Критического приоритета');
  }
  if (task.status !== 'submitted') {
    throw new ConflictError(`Задача в статусе ${task.status}`);
  }

  // B3: assignedTo === null — задача не назначена; acceptTaskService упадёт
  // с misleading-сообщением. Проверяем явно.
  if (!task.assignedTo) {
    throw new ConflictError('Задача не назначена исполнителю — кризисная приёмка невозможна');
  }

  // B2: I.2.12 в crisisDecide — не было. Добавлено.
  if (task.assignedTo === otcId) {
    throw new ForbiddenError('ОТК не может проверять свою работу (I.2.12)');
  }

  const entity = createCrisisDecision(
    input.reportId, otcId, input.functionalityOk, input.safetyOk,
  );

  await query(
    `INSERT INTO otc_decisions
       (id, report_id, otc_id, verdict, comment, criteria_version, crisis_protocol)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entity.id, entity.reportId, entity.otcId, entity.verdict,
     entity.comment, entity.criteriaVersion, entity.crisisProtocol],
  );

  if (entity.verdict === 'crisis_protocol') {
    await acceptTaskService(report.taskId, otcId);
    if (task.assignedTo) {
      await awardForAcceptedTask(task.assignedTo, report.taskId, otcId);
    }
  } else {
    await returnTaskService(report.taskId, 'Кризисная проверка не пройдена', otcId);
  }

  await logAction({
    actorId: otcId, actorType: 'participant',
    action: 'otc.crisis_decide', entityType: 'otc_decision', entityId: entity.id,
    newValue: { verdict: entity.verdict },
  });

  try {
    await emitCrisisDecisionMade({
      decisionId: entity.id,
      reportId: entity.reportId,
      taskId: report.taskId,
      taskExternalId: task.externalId,
      directionId: task.directionId,
      otcId,
      verdict: entity.verdict,
      comment: entity.comment,
      assignedTo: task.assignedTo,
      decidedAt: entity.createdAt,
    });
    const queue = await getQueue(task.directionId);
    await emitQueueUpdated(task.directionId, queue.length);
  } catch (e) {
    logger.warn({ err: e, decisionId: entity.id }, 'otc: WS emitCrisisDecisionMade failed');
  }

  return entity;
}

// -------- Апелляции --------

interface AppealRow {
  id: string;
  decision_id: string;
  participant_id: string;
  reason: string;
  status: OtcAppealStatus;
  reviewed_by: string | null;
  result: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

function rowToAppeal(row: AppealRow): OtcAppeal {
  return {
    id: row.id,
    decisionId: row.decision_id,
    participantId: row.participant_id,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

export async function appeal(
  decisionId: UUID,
  participantId: UUID,
  reason: string,
): Promise<OtcAppeal> {
  const row = await queryOne<{
    id: string;
    crisis_protocol: boolean;
    report_id: string;
    task_id: string;
    task_direction_id: string;
    report_participant_id: string;
  }>(
    `SELECT d.id,
            d.crisis_protocol,
            d.report_id,
            r.task_id,
            t.direction_id AS task_direction_id,
            r.participant_id AS report_participant_id
       FROM otc_decisions d
       JOIN reports r ON r.id = d.report_id
       JOIN tasks t ON t.id = r.task_id
      WHERE d.id = $1
      LIMIT 1`,
    [decisionId],
  );
  if (!row) {throw new NotFoundError('Решение ОТК', decisionId);}

  // B5: identity → ForbiddenError (403), было ConflictError (409).
  if (row.report_participant_id !== participantId) {
    throw new ForbiddenError('Только автор отчёта может подать апелляцию');
  }

  const activeAppeal = await queryOne<{ id: string }>(
    `SELECT id FROM otc_appeals
      WHERE decision_id = $1 AND status IN ('filed', 'reviewed')
      LIMIT 1`,
    [decisionId],
  );

  // TODO(techdebt, B6): canBeAppealed получает фиктивный OtcDecision
  // (otcId='', verdict, comment, criteriaVersion — фикции). Работает, но
  // хрупко. Требуется изменение signature в C.0.09.01 —
  // canBeAppealed({ crisisProtocol, hasActiveAppeal }).
  const check = canBeAppealed(
    {
      id: row.id,
      reportId: row.report_id,
      otcId: '',
      verdict: row.crisis_protocol ? 'crisis_protocol' : 'returned',
      comment: null,
      criteriaVersion: 1,
      crisisProtocol: row.crisis_protocol,
      createdAt: '',
    },
    activeAppeal !== null,
  );
  if (!check.allowed) {
    throw new ConflictError(check.reason ?? 'Апелляция невозможна');
  }

  const entity = createAppeal(decisionId, participantId, reason);

  await query(
    `INSERT INTO otc_appeals
       (id, decision_id, participant_id, reason, status)
     VALUES ($1, $2, $3, $4, 'filed')`,
    [entity.id, entity.decisionId, entity.participantId, entity.reason],
  );

  await logAction({
    actorId: participantId,
    actorType: 'participant',
    action: 'otc.appeal',
    entityType: 'otc_appeal',
    entityId: entity.id,
    newValue: { decision_id: decisionId, reason: entity.reason.slice(0, 200) },
  });

  // B7: WS best-effort.
  try {
    await emitAppealFiled({
      appealId: entity.id,
      decisionId: entity.decisionId,
      participantId: entity.participantId,
      directionId: row.task_direction_id,
      reason: entity.reason,
      filedAt: entity.createdAt,
    });
  } catch (e) {
    logger.warn({ err: e, appealId: entity.id }, 'otc: WS emitAppealFiled failed');
  }

  return entity;
}

export async function getAppeal(appealId: UUID): Promise<OtcAppeal> {
  const row = await queryOne<AppealRow>(
    `SELECT id, decision_id, participant_id, reason, status,
            reviewed_by, result, created_at, resolved_at
       FROM otc_appeals WHERE id = $1`,
    [appealId],
  );
  if (!row) {throw new NotFoundError('Апелляция', appealId);}
  return rowToAppeal(row);
}

export async function listAppealsByDecision(decisionId: UUID): Promise<OtcAppeal[]> {
  const rows = await query<AppealRow>(
    `SELECT id, decision_id, participant_id, reason, status,
            reviewed_by, result, created_at, resolved_at
       FROM otc_appeals
      WHERE decision_id = $1
      ORDER BY created_at DESC`,
    [decisionId],
  );
  return rows.map(rowToAppeal);
}

export interface OtcStats {
  totalDecisions: number;
  accepted: number;
  returned: number;
  crisisProtocol: number;
  avgCheckHours: number | null;
}

export async function getStats(directionId?: UUID): Promise<OtcStats> {
  const params: unknown[] = [];
  const joinDir = directionId
    ? `JOIN reports r ON r.id = d.report_id JOIN tasks t ON t.id = r.task_id`
    : '';
  const whereDir = directionId
    ? (params.push(directionId), `WHERE t.direction_id = $1`)
    : '';

  const row = await queryOne<{
    total: string;
    accepted: string;
    returned: string;
    crisis: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE d.verdict = 'accepted')::text AS accepted,
       COUNT(*) FILTER (WHERE d.verdict = 'returned')::text AS returned,
       COUNT(*) FILTER (WHERE d.verdict = 'crisis_protocol')::text AS crisis
     FROM otc_decisions d ${joinDir} ${whereDir}`,
    params,
  );

  return {
    totalDecisions: parseInt(row?.total ?? '0', 10),
    accepted: parseInt(row?.accepted ?? '0', 10),
    returned: parseInt(row?.returned ?? '0', 10),
    crisisProtocol: parseInt(row?.crisis ?? '0', 10),
    // TODO(techdebt, B8): avgCheckHours — всегда null. Нужен JOIN
    // reports.created_at → decisions.created_at, AVG(EXTRACT EPOCH) / 3600.
    avgCheckHours: null,
  };
}