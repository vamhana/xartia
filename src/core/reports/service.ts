// C.0.08.02 — Сервис отчётов
// Создание, чтение. Отчёт immutable после создания.
//
// Техдолг закрыт (v0.0.01 → v0.0.02):
//   - B1: явная валидация type↔comment/media_url до INSERT (было: 500 из DB CHECK).
//   - B2: task.assignedTo !== requesterId → ForbiddenError (было ConflictError).
//   - B3: emitReportSubmitted — try/catch (best-effort, не блокирует ответ).
//
// ОСТАЁТСЯ ТЕХДОЛГ:
//   - listByTask/listByParticipant — без пагинации.
//   - Отчёт immutable — только конвенция, БД не enforced (нет trigger'а).

import { query, queryOne } from '../../lib/db.js';
import { newUUID } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { emitReportSubmitted } from '../../ws/otc.js';
import { logAction } from '../audit.js';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../errors.js';
import { getById as getTaskById } from '../tasks/service.js';
import type { UUID } from '../types.js';

import { createReport, type Report, type ReportType } from './entity.js';

interface ReportRow {
  id: string;
  task_id: string;
  participant_id: string;
  type: ReportType;
  media_url: string | null;
  media_size: string | null;
  comment: string | null;
  artifact_url: string | null;
  geolocation: { coordinates: [number, number] } | null;
  created_at: Date;
}

function rowToReport(row: ReportRow): Report {
  let geolocation: { lat: number; lon: number } | null = null;
  const coords = row.geolocation?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const [lon, lat] = coords;
    if (typeof lon === 'number' && typeof lat === 'number') {
      geolocation = { lon, lat };
    }
  }
  return {
    id: row.id,
    taskId: row.task_id,
    participantId: row.participant_id,
    type: row.type,
    mediaUrl: row.media_url,
    mediaSize: row.media_size ? parseInt(row.media_size, 10) : null,
    comment: row.comment,
    artifactUrl: row.artifact_url,
    geolocation,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateReportRequest {
  taskId: UUID;
  type: ReportType;
  comment?: string;
  mediaUrl?: string;
  artifactUrl?: string;
  geolocation?: { lat: number; lon: number };
}

export async function createReportService(
  input: CreateReportRequest,
  requesterId: UUID,
): Promise<Report> {
  // B1: валидация type↔comment/media_url до INSERT.
  // DB CHECK (chk_report_type_media) остаётся последней линией обороны,
  // но клиент должен получать 422, а не 500.
  if (input.type === 'text') {
    if (!input.comment || input.comment.trim().length === 0) {
      throw new ValidationError('Для отчёта типа text требуется непустой comment');
    }
    if (input.mediaUrl) {
      throw new ValidationError('Для отчёта типа text не указывается media_url');
    }
  } else {
    if (!input.mediaUrl) {
      throw new ValidationError(`Для отчёта типа ${input.type} требуется media_url`);
    }
  }

  // 1. Проверяем задачу
  const task = await getTaskById(input.taskId);
  // B2: ForbiddenError (403), не ConflictError (409) — идентичность, не состояние.
  if (task.assignedTo !== requesterId) {
    throw new ForbiddenError('Отчёт может подать только назначенный исполнитель');
  }
  if (task.status !== 'in_progress' && task.status !== 'submitted') {
    throw new ConflictError(`Задача в статусе ${task.status} — нельзя подать отчёт`);
  }

  // 2. Создаём отчёт
  const entity = createReport({
    id: newUUID(),
    taskId: input.taskId,
    participantId: requesterId,
    type: input.type,
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
    ...(input.artifactUrl ? { artifactUrl: input.artifactUrl } : {}),
    ...(input.geolocation ? { geolocation: input.geolocation } : {}),
  });

  // Плейсхолдеры считаем от фактического массива: раньше гео-координаты
  // были захардкожены как $11/$12 и разъезжались с числом параметров.
  const values: unknown[] = [
    entity.id, entity.taskId, entity.participantId, entity.type,
    entity.mediaUrl, entity.comment, entity.artifactUrl,
  ];
  let geoSql = 'NULL';
  const geo = entity.geolocation;
  if (geo) {
    values.push(geo.lon, geo.lat);
    geoSql = `ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`;
  }
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  await query(
    `INSERT INTO reports
       (id, task_id, participant_id, type, media_url, comment, artifact_url, geolocation)
     VALUES (${placeholders}, ${geoSql})`,
    values,
  );

  await logAction({
    actorId: requesterId, actorType: 'participant',
    action: 'reports.create', entityType: 'report', entityId: entity.id,
    newValue: { task_id: entity.taskId, type: entity.type },
  });

  // B3: WS-эмиссия best-effort. Отчёт уже в БД — клиент не должен получать
  // 500 из-за того, что WS-брокер лёг.
  try {
    await emitReportSubmitted({
      reportId: entity.id,
      taskId: entity.taskId,
      taskExternalId: task.externalId,
      directionId: task.directionId,
      authorId: entity.participantId,
      type: entity.type,
      createdAt: entity.createdAt,
    });
  } catch (e) {
    logger.warn(
      { err: e, reportId: entity.id, taskId: entity.taskId },
      'reports: WS emitReportSubmitted failed (report persisted)',
    );
  }

  return entity;
}

export async function getById(reportId: UUID): Promise<Report> {
  const row = await queryOne<ReportRow>(
    `SELECT id, task_id, participant_id, type, media_url,
            media_size::text AS media_size, comment, artifact_url,
            ST_AsGeoJSON(geolocation)::json AS geolocation,
            created_at
       FROM reports WHERE id = $1`,
    [reportId],
  );
  if (!row) {throw new NotFoundError('Отчёт', reportId);}
  return rowToReport(row);
}

export async function listByTask(taskId: UUID): Promise<Report[]> {
  const rows = await query<ReportRow>(
    `SELECT id, task_id, participant_id, type, media_url,
            media_size::text AS media_size, comment, artifact_url,
            ST_AsGeoJSON(geolocation)::json AS geolocation,
            created_at
       FROM reports WHERE task_id = $1 ORDER BY created_at DESC`,
    [taskId],
  );
  return rows.map(rowToReport);
}

export async function listByParticipant(participantId: UUID): Promise<Report[]> {
  const rows = await query<ReportRow>(
    `SELECT id, task_id, participant_id, type, media_url,
            media_size::text AS media_size, comment, artifact_url,
            ST_AsGeoJSON(geolocation)::json AS geolocation,
            created_at
       FROM reports WHERE participant_id = $1 ORDER BY created_at DESC`,
    [participantId],
  );
  return rows.map(rowToReport);
}