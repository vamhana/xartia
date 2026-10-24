// C.0.08.01 — Доменная сущность Отчёт
// Фото, видео или текст. Медиа в S3, метаданные в БД.

import { ValidationError } from '../errors.js';
import type { UUID, ISODateTime } from '../types.js';

export type ReportType = 'photo' | 'video' | 'text';

export interface Report {
  id: UUID;
  taskId: UUID;
  participantId: UUID;
  type: ReportType;
  mediaUrl: string | null;
  mediaSize: number | null;
  comment: string | null;
  /** Ссылка на PR/коммит/документ — результат работы, а не «медиа». */
  artifactUrl: string | null;
  geolocation: { lat: number; lon: number } | null;
  createdAt: ISODateTime;
}

export interface CreateReportInput {
  id: UUID;
  taskId: UUID;
  participantId: UUID;
  type: ReportType;
  comment?: string;
  mediaUrl?: string;
  artifactUrl?: string;
  geolocation?: { lat: number; lon: number };
}

export function createReport(input: CreateReportInput): Report {
  if (input.type === 'text' && !input.comment?.trim()) {
    throw new ValidationError('Текстовый отчёт требует комментарий');
  }
  if ((input.type === 'photo' || input.type === 'video') && !input.mediaUrl) {
    throw new ValidationError(`Отчёт типа ${input.type} требует медиа-файл`);
  }
  return {
    id: input.id,
    taskId: input.taskId,
    participantId: input.participantId,
    type: input.type,
    mediaUrl: input.mediaUrl ?? null,
    mediaSize: null,
    comment: input.comment ?? null,
    artifactUrl: input.artifactUrl?.trim() ? input.artifactUrl.trim() : null,
    geolocation: input.geolocation ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function canBeSubmittedBy(r: Report, participantId: UUID): boolean {
  return r.participantId === participantId;
}

export function getMediaKey(taskId: UUID, reportId: UUID, extension: string): string {
  const ext = extension.replace(/^\./, '');
  return `media/${taskId}/${reportId}.${ext}`;
}