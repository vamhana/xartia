// L.0.01.04 — Форматирование данных для отображения
// Числа, Потоки, проценты, размеры, длительности, статусы.
// Локализация на русский.

import { Role } from '../core/roles.js';
import type { Priority } from '../core/types.js';

// -------- Числа --------

export function formatNumber(n: number, decimals = 0): string {
  const fixed = n.toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fracPart ? `${withSpaces},${fracPart}` : withSpaces;
}

export function formatFlow(n: number): string {
  return `${formatNumber(n, 0)} П`;
}

export function formatPercent(n: number, decimals = 1): string {
  return `${formatNumber(n, decimals)}%`;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes < 1024) {return `${bytes} Б`;}
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(decimals)} ${units[i]}`;
}

// -------- Списки --------

export function formatList(items: string[], max?: number): string {
  if (max !== undefined && items.length > max) {
    return items.slice(0, max).join(', ') + ` и ещё ${items.length - max}`;
  }
  return items.join(', ');
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) {return str;}
  return str.slice(0, max - 1) + '…';
}

// -------- Склонения --------

export function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) {return forms[2];}
  if (n1 > 1 && n1 < 5) {return forms[1];}
  if (n1 === 1) {return forms[0];}
  return forms[2];
}

// -------- Статусы --------

const STATUS_LABELS: Record<string, string> = {
  // Участник
  compatible: 'Совместим',
  conditionally_compatible: 'Условно совместим',
  associated: 'Ассоциирован',
  full: 'Полный',
  paused: 'На паузе',
  outside_trust_network: 'Вне сети доверия',
  master: 'Мастер',
  integrator: 'Интегратор',
  pioneer: 'Пионер',
  excluded: 'Отчуждён',
  // Задачи
  created: 'Создана',
  assigned: 'Назначена',
  in_progress: 'В работе',
  submitted: 'Сдана',
  accepted: 'Принята',
  returned: 'Возвращена',
  // Планы
  draft: 'Черновик',
  run: 'Прогон',
  approved: 'Утверждён',
  completed: 'Завершён',
  cancelled: 'Отменён',
  // Сигналы
  new: 'Новый',
  connect: 'Коннект',
  plan: 'План',
  rejected: 'Отклонён',
  // Блага
  test: 'Тест',
  active: 'Активно',
  obsolete: 'Устарело',
  liquidated: 'Ликвидировано',
  // Направления
  empty: 'Пусто',
  delegated: 'Делегировано',
  blocked: 'Заблокировано',
  abolished: 'Упразднено',
  // Мандаты
  expired: 'Истёк',
  revoked: 'Отозван',
  // Кванты
  detected: 'Обнаружен',
  audit: 'Аудит',
  testing: 'Тестирование',
  scaling: 'Масштабирование',
  // Общины
  incubation: 'Инкубация',
  node: 'Узел',
  center: 'Центр',
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  standard: 'Стандартный',
  background: 'Фоновый',
};

export function formatPriority(p: Priority): string {
  return PRIORITY_LABELS[p];
}

const ROLE_LABELS: Record<Role, string> = {
  [Role.FIRST_ARCHITECT]: 'Первый Архитектор',
  [Role.COUNCIL_MEMBER]: 'Совет направления',
  [Role.OTC]: 'ОТК',
  [Role.KEEPER]: 'Хранитель',
  [Role.LIAISON]: 'Связной',
  [Role.BALANCER]: 'Балансировщик',
  [Role.VERIFIER]: 'Верификатор',
  [Role.PSY]: 'Психоэколог',
  [Role.JUSTICE]: 'Правозащита',
  [Role.OBLIVION]: 'Инженерия Обнуления',
  [Role.NOOLOG]: 'Ноолог',
  [Role.SEMANTIC_GUARDIAN]: 'Семантический Страж',
  [Role.OPERATOR]: 'Оператор',
  [Role.AGGREGATOR]: 'Агрегатор',
  [Role.GATEWAY_COUNCIL]: 'Совет Шлюза',
  [Role.GUARANTOR]: 'Гарант Перехода',
  [Role.PROTOCOL_COUNCIL]: 'Совет Протоколов',
  [Role.EXTERNAL_WITNESS]: 'Внешний Свидетель',
  [Role.JURY]: 'Жюри',
  [Role.ARBITRATOR]: 'Арбитр',
  [Role.MASTER]: 'Мастер',
  [Role.INTEGRATOR]: 'Интегратор',
  [Role.PIONEER]: 'Пионер',
  [Role.EXPANSIONIST]: 'Экспансионист',
  [Role.OUTSIDE_TRUST]: 'Вне сети доверия',
  [Role.ASSOCIATED]: 'Ассоциирован',
  [Role.PAUSED]: 'На паузе',
  [Role.REMOTE]: 'Удалённый',
};

export function formatRole(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

// -------- Направления --------

const DIRECTION_NAMES: Record<number, string> = {
  1:  'Жизнеобеспечение',
  2:  'Здравие',
  3:  'Энергия и Среда',
  4:  'Трансляция Контекста',
  5:  'Когнитивная Логистика',
  6:  'Ноология',
  7:  'Инженерия Обнуления',
  8:  'Балансировка',
  9:  'Кибернетика и Протокол',
  10: 'Искусство и Резонанс',
  11: 'Социальная Инкубация',
  12: 'Психоэкология',
  13: 'Верификация и Надёжность',
  14: 'Знание и Образование',
  15: 'Внешний шлюз',
  16: 'Сетевая экосистема',
  17: 'Правозащита и Восстановление',
};

export function formatDirectionName(n: number): string {
  return DIRECTION_NAMES[n] ?? `Направление ${n}`;
}

// -------- Диапазоны --------

export function formatRange(from: number, to: number, unit = ''): string {
  const suffix = unit ? ` ${unit}` : '';
  return `${formatNumber(from)}–${formatNumber(to)}${suffix}`;
}