// L.0.01.05 — Логгер
// Структурированные логи в JSON. Correlation ID, уровни, контекст.
// Pino для производительности. PII маскируются.

import { pino, type Logger as PinoLogger } from 'pino';

import { isAppError } from '../core/errors.js';
import type { UUID } from '../core/types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerContext {
  requestId?: string;
  actorId?: UUID | null;
  actorType?: 'participant' | 'ai' | 'system';
  entityType?: string;
  entityId?: UUID;
  ip?: string;
}

// -------- Инициализация --------

const level = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase() as LogLevel;
const isDev = process.env['NODE_ENV'] !== 'production';

const baseLogger: PinoLogger = isDev
  ? pino({
      level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    })
  : pino({ level });

export const logger: PinoLogger = baseLogger;

// -------- Дочерний логгер с контекстом --------

export function childLogger(context: LoggerContext): PinoLogger {
  return baseLogger.child(context as Record<string, unknown>);
}

// -------- AsyncLocalStorage не нужен пока — упростим через явный контекст --------

export async function withContext<T>(
  context: LoggerContext,
  fn: (log: PinoLogger) => Promise<T>,
): Promise<T> {
  const log = childLogger(context);
  return fn(log);
}

// -------- Управление уровнем --------

export function setLogLevel(newLevel: LogLevel): void {
  baseLogger.level = newLevel;
}

export function getLogLevel(): string {
  return baseLogger.level;
}

// -------- Flush (для тестов и graceful shutdown) --------

export async function flush(): Promise<void> {
  return new Promise((resolve) => {
    baseLogger.flush(() => resolve());
  });
}

// -------- Сериализация ошибок --------

export function serializeError(e: unknown): Record<string, unknown> {
  if (isAppError(e)) {
    return {
      name: e.name,
      code: e.code,
      statusCode: e.statusCode,
      message: e.message,
      ...(e.details ? { details: e.details } : {}),
      ...(e.stack ? { stack: e.stack } : {}),
    };
  }
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      ...(e.stack ? { stack: e.stack } : {}),
    };
  }
  return { message: String(e) };
}