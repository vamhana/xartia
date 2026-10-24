// C.0.01.03 — Глобальные константы системы
// Единственный источник истины. Дублирование запрещено.
// Изменение значений — только через процедуру пересмотра Хартии.

import type { Priority, FlowType, RegimeType } from './types.js';

// Точность
export const PRECISION = 1e18;
export const BASIS_POINTS = 10000;

// Уровни ячеек
export const MAX_LEVELS = 11;

// Потоки (I.1.6)
export const CAPSULE_MAX = 180;
export const WELCOME_PACK = 200;
export const RETURN_RATE = 30;              // 1/30 стандарт
export const RETURN_RATE_GENTLE = 60;       // 1/60 щадящий
export const GENTLE_PERIOD_DAYS = 180;
export const DEFERRED_FLOW_PCT = 7;         // Отложенный Поток
export const FREEDOM_RESERVE_PCT = 2;       // Резерв свободы
export const PLANETARY_RESERVE_PCT = 3;     // Планетарный резерв

// Дедлайны по приоритетам (I.1.4.1)
export const PRIORITY_DEADLINES_MS: Readonly<Record<Priority, number>> = {
  critical:   60_000,        // 1 минута
  high:       3_600_000,     // 1 час
  standard:   10_800_000,    // 3 часа
  background: 86_400_000,    // 1 сутки
};

// Квант ускорения (I.2.3.1)
export const QUANTUM_ACCELERATION = 10;

// Мобилизация (I.1.8.11)
export const MOBILIZATION_REFUSAL_MAX_PCT = 10;

// Режимы (VI.1, VI.2)
export const STEEL_BELL_MAX_DAYS = 90;
export const PTT_MAX_DAYS = 90;
export const PTT_MIN_INTERVAL_DAYS = 1825;    // 5 лет
export const RED_CIRCUIT_AUDIT_DAYS = 14;
export const INFO_BLOCKADE_TIMEOUT_MIN = 60;  // 1 час
export const INFO_BLOCKADE_SIGNAL_WINDOW_MIN = 180; // 3 часа

// Шлюз (I.1.10.8)
export const GATEWAY_DISSOLVE_REFERENDUM_PCT = 60;
export const GATEWAY_DISSOLVE_MAX_YEARS = 50;
export const GATEWAY_IMPORT_DEPENDENCY_PCT = 5;
export const GATEWAY_IMPORT_DEPENDENCY_YEARS = 3;

// Конвергенция (V.7)
export const CONVERGENCE_MAX_MONTHS = 60;

// Хартия
export const CORE_REVISION_YEARS = 25;
export const CHARTER_REVISION_YEARS = 5;
export const HORIZON_RULE_YEARS = 50;

// Семантический Страж (I.4.6)
export const SEMANTIC_ALARM_RESPONSE_HOURS = 3;
export const SEMANTIC_VETO_DAYS = 3;

// Диссидентские проекты (I.1.8.10)
export const DISSIDENT_PETITION_PCT = 1;
export const DISSIDENT_REPORT_INTERVAL_DAYS = 60;
export const DISSIDENT_REVIEW_YEARS = 2;

// JWT (I.1.4)
export const JWT_ACCESS_TTL_SEC = 15 * 60;         // 15 минут
export const JWT_REFRESH_TTL_SEC = 30 * 24 * 3600; // 30 дней

// Категории Потоков — список для итерации
export const FLOW_TYPES: readonly FlowType[] = [
  'main', 'reflective', 'council', 'mentoring', 'creation', 'cross_direction',
];

// Типы режимов — список для итерации
export const REGIME_TYPES: readonly RegimeType[] = [
  'red_circuit', 'steel_bell', 'ptt', 'info_blockade',
  'quantum_acceleration', 'global_red_circuit',
];

// HTTP-коды (для унификации)
export const HTTP = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  LOCKED: 423,
  TOO_MANY: 429,
  INFO_BLOCKADE: 451,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;