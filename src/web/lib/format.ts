// |F.4.99.22|Frontend|Lib|TypeScript|src/web/lib/format.ts

import type { ISODateTime,   SignalPriority, SignalType, SignalStatus, SignalResponseType } from '../types';

// -------- Приоритет --------

export type Priority = 'critical' | 'high' | 'standard' | 'background';
export type PriorityTone = 'critical' | 'high' | 'standard' | 'background';

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  standard: 'Стандартный',
  background: 'Фоновый',
};

export const PRIORITY_TONE: Record<Priority, PriorityTone> = {
  critical: 'critical',
  high: 'high',
  standard: 'standard',
  background: 'background',
};

// -------- Статус задачи --------

export type TaskStatus =
  | 'created' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'returned';

export type TaskStatusTone = 'default' | 'info' | 'warning' | 'success' | 'danger';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  created: 'Создана',
  assigned: 'Назначена',
  in_progress: 'В работе',
  submitted: 'Сдана',
  accepted: 'Принята',
  returned: 'Возвращена',
};

export const TASK_STATUS_TONE: Record<TaskStatus, TaskStatusTone> = {
  created: 'default',
  assigned: 'info',
  in_progress: 'info',
  submitted: 'warning',
  accepted: 'success',
  returned: 'danger',
};

// -------- Даты --------

export function formatDate(iso: ISODateTime): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = d.getUTCFullYear();
  return `${dd}.${mm}.${yy}`;
}

export function formatTime(iso: ISODateTime): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

export function formatDateTime(iso: ISODateTime): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/**
 * Сколько осталось до дедлайна в человекочитаемом виде.
 * Отрицательное → просрочка.
 */
export interface DeadlineInfo {
  isOverdue: boolean;
  isUrgent: boolean; // осталось < 1 часа
  label: string;
}

export function describeDeadline(deadline: ISODateTime | null, now = Date.now()): DeadlineInfo {
  if (!deadline) {
    return { isOverdue: false, isUrgent: false, label: '—' };
  }
  const t = new Date(deadline).getTime();
  const diff = t - now;
  const isOverdue = diff < 0;
  const isUrgent = !isOverdue && diff < 60 * 60 * 1000;

  if (isOverdue) {
    return { isOverdue: true, isUrgent: false, label: `просрочено на ${formatDuration(-diff)}` };
  }
  return { isOverdue, isUrgent, label: `через ${formatDuration(diff)}` };
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) {return `${sec}с`;}
  const min = Math.floor(sec / 60);
  if (min < 60) {return `${min}м`;}
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  if (h < 24) {return remMin > 0 ? `${h}ч ${remMin}м` : `${h}ч`;}
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}д ${remH}ч` : `${d}д`;
}

export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) {return dateStr;}
  return `${d}.${m}.${y}`;
}
// -------- Signals --------



export const SIGNAL_PRIORITY_LABEL: Record<SignalPriority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  standard: 'Стандартный',
  background: 'Фоновый',
};

export const SIGNAL_PRIORITY_TONE: Record<SignalPriority, 'critical' | 'high' | 'standard' | 'background'> = {
  critical: 'critical',
  high: 'high',
  standard: 'standard',
  background: 'background',
};

export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  need: 'Потребность',
  problem: 'Проблема',
  idea: 'Идея',
  failure: 'Сбой',
};

export const SIGNAL_STATUS_LABEL: Record<SignalStatus, string> = {
  new: 'Новый',
  run: 'Прогон',
  connect: 'Коннект',
  plan: 'План',
  completed: 'Завершён',
  rejected: 'Отклонён',
};

export const SIGNAL_STATUS_TONE: Record<SignalStatus, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  new: 'info',
  run: 'info',
  connect: 'warning',
  plan: 'warning',
  completed: 'success',
  rejected: 'danger',
};

export const SIGNAL_RESPONSE_LABEL: Record<SignalResponseType, string> = {
  support: 'Поддерживаю',
  object: 'Возражаю',
  clarify: 'Требую уточнения',
  amend: 'Требую поправок',
  no_influence: 'Вне моей компетенции',
};

export const SIGNAL_RESPONSE_TONE: Record<SignalResponseType, 'success' | 'danger' | 'warning' | 'info' | 'default'> = {
  support: 'success',
  object: 'danger',
  clarify: 'warning',
  amend: 'warning',
  no_influence: 'default',
};

/** Описание сигнала: «Приоритет → Статус» в одну строку. */
export function describeSignal(s: { priority: SignalPriority; status: SignalStatus }): string {
  return `${SIGNAL_PRIORITY_LABEL[s.priority]} · ${SIGNAL_STATUS_LABEL[s.status]}`;
}

// ─────────────────────────────────────────────────────────────────
// F.4.99.22 (extension) — chat helpers.
// ─────────────────────────────────────────────────────────────────

export interface TextToken {
  text: string;
  isMention: boolean;
}

// Упоминания в тексте сообщения — plain-подстроки вида @Name.
// Бэкенд хранит в content обычный текст, отдельный массив UUID — в mentions.
// Разметки (типа <@uuid>) нет, поэтому вычленяем по регексу.
const MENTION_RE_SOURCE = '@[A-Za-zА-Яа-яЁё0-9_\\-]+';

/**
 * Разбивает текст на токены: обычный текст и упоминания (@Name).
 * Порядок сохраняется. Пустые фрагменты не возвращаются.
 *
 * Используется в MessageBubble для подсветки упоминаний.
 * Определение «это упомянули меня» — на стороне компонента: сравнить
 * token.text с @<currentUserName>.
 */
export function splitMentions(content: string): TextToken[] {
  if (!content) {return [];}
  const tokens: TextToken[] = [];
  const re = new RegExp(MENTION_RE_SOURCE, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: content.slice(lastIndex, match.index), isMention: false });
    }
    tokens.push({ text: match[0], isMention: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < content.length) {
    tokens.push({ text: content.slice(lastIndex), isMention: false });
  }
  return tokens;
}

/**
 * Человекочитаемый размер файла: 512 Б, 4.2 КБ, 3.1 МБ, 1.25 ГБ.
 * До 10 единиц — одна цифра после точки, иначе округление до целого.
 * Невалидные значения → «—».
 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {return '—';}
  if (size < 1024) {return `${size} Б`;}
  const kb = size / 1024;
  if (kb < 1024) {return `${kb.toFixed(kb < 10 ? 1 : 0)} КБ`;}
  const mb = kb / 1024;
  if (mb < 1024) {return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;}
  const gb = mb / 1024;
  return `${gb.toFixed(2)} ГБ`;
}