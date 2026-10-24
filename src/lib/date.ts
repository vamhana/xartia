// L.0.01.02 — Работа с датами
// Все функции иммутабельны: не мутируют исходный Date, возвращают новый.
// Часовой пояс всегда UTC. Локальный только для отображения.

import type { ISODateTime } from '../core/types.js';

// -------- Создание --------

export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

export function toISO(date: Date): ISODateTime {
  return date.toISOString();
}

export function fromISO(iso: ISODateTime): Date {
  return new Date(iso);
}

// -------- Форматирование --------

export function formatDate(date: Date, fmt = 'YYYY-MM-DD'): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return fmt.replace('YYYY', String(y)).replace('MM', m).replace('DD', d);
}

export function formatTime(date: Date, fmt = 'HH:mm:ss'): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return fmt.replace('HH', h).replace('mm', m).replace('ss', s);
}

export function toISODateString(date: Date): string {
  return date.toISOString();
}

// -------- Смещения --------

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

// -------- Разница --------

export function diffMs(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function diffDays(a: Date, b: Date): number {
  return Math.floor(diffMs(a, b) / 86_400_000);
}

export function diffHours(a: Date, b: Date): number {
  return Math.floor(diffMs(a, b) / 3_600_000);
}

export function diffMinutes(a: Date, b: Date): number {
  return Math.floor(diffMs(a, b) / 60_000);
}

// -------- Сравнения --------

export function isPast(date: Date, base: Date = new Date()): boolean {
  return date.getTime() < base.getTime();
}

export function isFuture(date: Date, base: Date = new Date()): boolean {
  return date.getTime() > base.getTime();
}

export function isBetween(date: Date, from: Date, to: Date): boolean {
  const t = date.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

// -------- Границы --------

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function getCurrentQuarter(date: Date): number {
  return Math.floor(date.getUTCMonth() / 3) + 1;
}

// -------- Длительности --------

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  mo: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

export function parseDuration(str: string): number {
  const m = /^(\d+)(ms|s|m|h|d|w|mo|y)$/.exec(str.trim());
  if (!m) {throw new Error(`Invalid duration: ${str}`);}
  const [, numStr = '0', unit = 'ms'] = m;
  return parseInt(numStr, 10) * (DURATION_UNITS[unit] ?? 1);
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {return `${ms} мс`;}
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) {return `${sec} сек`;}
  const min = Math.floor(sec / 60);
  if (min < 60) {return `${min} мин`;}
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) {return remMin ? `${hours} ч ${remMin} мин` : `${hours} ч`;}
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days} д ${remH} ч` : `${days} д`;
}

export function formatRelative(date: Date, base: Date = new Date()): string {
  const delta = date.getTime() - base.getTime();
  const abs = Math.abs(delta);
  const suffix = delta < 0 ? 'назад' : 'через';

  if (abs < 60_000) {return delta < 0 ? 'только что' : 'через минуту';}
  if (abs < 3_600_000) {return `${suffix} ${Math.floor(abs / 60_000)} мин`;}
  if (abs < 86_400_000) {return `${suffix} ${Math.floor(abs / 3_600_000)} ч`;}
  return `${suffix} ${Math.floor(abs / 86_400_000)} д`;
}