// L.0.01.01 — Генерация и парсинг ID всех сущностей
// Единый источник форматов: участник, ячейка, задача, сигнал, план,
// эксперимент, отчёт, медиа-ключ, глобальный ID.
// Без побочных эффектов.

import { randomUUID } from 'node:crypto';

import { ValidationError } from '../core/errors.js';
import type { UUID } from '../core/types.js';

// -------- UUID --------

export function newUUID(): UUID {
  return randomUUID();
}

// -------- Участник --------
// Формат: <буква волны><5 цифр>-<направление>[:<поднаправление>]
// Пример: А00001-1, Б12345-14, В98765-6:3

const PARTICIPANT_ID_RE = /^([А-Я]?)(\d{5})-(\d{1,2})(?::(.+))?$/;

const WAVE_LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ';

export function generateWaveLetter(index: number): string {
  if (index < 0) {throw new ValidationError('Wave index must be >= 0');}
  const letter = WAVE_LETTERS[index % WAVE_LETTERS.length];
  if (!letter) {
    throw new ValidationError('Wave letter index out of range');
  }
  return letter;
}

export function formatParticipantId(
  wave: string,
  number: number,
  directionNumber: number,
  subdirection?: string,
): string {
  if (number < 0 || number > 99999) {
    throw new ValidationError('Participant number must be 0–99999');
  }
  if (directionNumber < 1 || directionNumber > 99) {
    throw new ValidationError('Direction number must be 1–99');
  }
  const num = String(number).padStart(5, '0');
  const base = `${wave}${num}-${directionNumber}`;
  return subdirection ? `${base}:${subdirection}` : base;
}

export interface ParsedParticipantId {
  wave: string;
  number: number;
  direction: number;
  subdirection?: string;
}

export function parseParticipantId(externalId: string): ParsedParticipantId {
  const m = PARTICIPANT_ID_RE.exec(externalId);
  if (!m) {throw new ValidationError(`Invalid participant ID: ${externalId}`);}
  const [, wave = '', numStr = '', dirStr = '', sub] = m;
  return {
    wave,
    number: parseInt(numStr, 10),
    direction: parseInt(dirStr, 10),
    ...(sub ? { subdirection: sub } : {}),
  };
}

// -------- Ячейка --------
// Формат: <уровень>×5-<номер>[-<профиль>]
// Пример: 1×5-042, 4×5-017-строители

export function formatCellId(level: number, number: string, profile?: string): string {
  if (level < 0 || level > 11) {
    throw new ValidationError('Cell level must be 0–11');
  }
  const base = `${level}×5-${number}`;
  return profile ? `${base}-${profile}` : base;
}

export interface ParsedCellId {
  level: number;
  number: string;
  profile?: string;
}

export function parseCellId(cellId: string): ParsedCellId {
  const m = /^(\d+)×5-([^-]+)(?:-(.+))?$/.exec(cellId);
  if (!m) {throw new ValidationError(`Invalid cell ID: ${cellId}`);}
  const [, levelStr = '', number = '', profile] = m;
  return {
    level: parseInt(levelStr, 10),
    number,
    ...(profile ? { profile } : {}),
  };
}

// -------- Дата-строка --------

function datePart(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function seqPart(seq: number): string {
  if (seq < 0 || seq > 999) {
    throw new ValidationError('Sequence must be 0–999');
  }
  return String(seq).padStart(3, '0');
}

// -------- Задача --------
// Формат: <ТИП>-<YYYY-MM-DD>-<NNN>, ТИП — 3 заглавные кириллические буквы
// Пример: СТР-2026-08-13-042

export function formatTaskId(type: string, date: Date, sequence: number): string {
  if (!/^[А-Я]{3}$/.test(type)) {
    throw new ValidationError('Task type must be 3 Cyrillic uppercase letters');
  }
  return `${type}-${datePart(date)}-${seqPart(sequence)}`;
}

export interface ParsedTaskId {
  type: string;
  date: string;
  sequence: number;
}

export function parseTaskId(taskId: string): ParsedTaskId {
  const m = /^([А-Я]{3})-(\d{4}-\d{2}-\d{2})-(\d{3})$/.exec(taskId);
  if (!m) {throw new ValidationError(`Invalid task ID: ${taskId}`);}
  const [, type = '', date = '', seqStr = ''] = m;
  return { type, date, sequence: parseInt(seqStr, 10) };
}

// -------- Сигнал --------
// Формат: SIG-<YYYY-MM-DD>-<NNN>

export function formatSignalId(date: Date, sequence: number): string {
  return `SIG-${datePart(date)}-${seqPart(sequence)}`;
}

export function parseSignalId(signalId: string): { date: string; sequence: number } {
  const m = /^SIG-(\d{4}-\d{2}-\d{2})-(\d{3})$/.exec(signalId);
  if (!m) {throw new ValidationError(`Invalid signal ID: ${signalId}`);}
  const [, date = '', seqStr = ''] = m;
  return { date, sequence: parseInt(seqStr, 10) };
}

// -------- План --------
// Формат: PLAN-<YYYY-MM-DD>-<NNN>

export function formatPlanId(date: Date, sequence: number): string {
  return `PLAN-${datePart(date)}-${seqPart(sequence)}`;
}

export function parsePlanId(planId: string): { date: string; sequence: number } {
  const m = /^PLAN-(\d{4}-\d{2}-\d{2})-(\d{3})$/.exec(planId);
  if (!m) {throw new ValidationError(`Invalid plan ID: ${planId}`);}
  const [, date = '', seqStr = ''] = m;
  return { date, sequence: parseInt(seqStr, 10) };
}

// -------- Эксперимент --------
// Формат: EXP-<num>-<year>

export function formatExperimentId(number: number, year: number): string {
  if (number < 0) {throw new ValidationError('Experiment number must be >= 0');}
  return `EXP-${number}-${year}`;
}

export function parseExperimentId(expId: string): { number: number; year: number } {
  const m = /^EXP-(\d+)-(\d{4})$/.exec(expId);
  if (!m) {throw new ValidationError(`Invalid experiment ID: ${expId}`);}
  const [, numStr = '', yearStr = ''] = m;
  return { number: parseInt(numStr, 10), year: parseInt(yearStr, 10) };
}

// -------- Медиа-ключ для S3 --------
// Формат: media/<taskId>/<reportId>.<ext>

export function formatReportMediaKey(taskId: UUID, reportId: UUID, extension: string): string {
  const ext = extension.replace(/^\./, '');
  if (!/^[a-z0-9]+$/i.test(ext)) {
    throw new ValidationError(`Invalid file extension: ${extension}`);
  }
  return `media/${taskId}/${reportId}.${ext}`;
}

// -------- Глобальный ID (при множественности общин) --------
// Формат: <communityCode>-<internalId>

export function formatGlobalId(communityCode: string, internalId: string): string {
  if (!/^[А-Я]{2}$/.test(communityCode)) {
    throw new ValidationError('Community code must be 2 Cyrillic uppercase letters');
  }
  return `${communityCode}-${internalId}`;
}

export function parseGlobalId(globalId: string): { communityCode: string; internalId: string } {
  const m = /^([А-Я]{2})-(.+)$/.exec(globalId);
  if (!m) {throw new ValidationError(`Invalid global ID: ${globalId}`);}
  const [, communityCode = '', internalId = ''] = m;
  return { communityCode, internalId };
}