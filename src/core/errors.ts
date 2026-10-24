// C.0.01.02 — Единый реестр ошибок.src\core\errors.ts
// Классы для всех типов ошибок, HTTP-коды, поддержка details.
// Используется во всех сервисах, middleware и обработчиках.

import type { UUID } from './types.js';

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Unauthorized',
    code: 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'REVOKED' | 'NO_TOKEN' = 'NO_TOKEN',
  ) {
    super(code, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super('FORBIDDEN', message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', id?: UUID) {
    super('NOT_FOUND', `${resource} not found`, 404, id ? { id } : undefined);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Validation failed',
    details?: Array<{ path: string; message: string }>,
  ) {
    super('VALIDATION_ERROR', message, 422, details ? { fields: details } : undefined);
    this.name = 'ValidationError';
  }
}

export class LockedError extends AppError {
  constructor(message = 'Operation is locked by active regime', details?: Record<string, unknown>) {
    super('LOCKED', message, 423, details);
    this.name = 'LockedError';
  }
}

export class InfoBlockadeError extends AppError {
  constructor(message = 'Gateway is isolated (Information Blockade active)') {
    super('INFO_BLOCKADE', message, 451);
    this.name = 'InfoBlockadeError';
  }
}

export class RotationError extends AppError {
  constructor(message = 'Rotation not allowed', details?: Record<string, unknown>) {
    super('ROTATION_ERROR', message, 409, details);
    this.name = 'RotationError';
  }
}

export class CooldownError extends AppError {
  constructor(message = 'Participant is in cooldown', details?: Record<string, unknown>) {
    super('COOLDOWN', message, 403, details);
    this.name = 'CooldownError';
  }
}

export class MandateExpiredError extends AppError {
  constructor(message = 'Mandate has expired') {
    super('MANDATE_EXPIRED', message, 403);
    this.name = 'MandateExpiredError';
  }
}

export class RegimeConflictError extends AppError {
  constructor(message = 'Regime conflict', details?: Record<string, unknown>) {
    super('REGIME_CONFLICT', message, 409, details);
    this.name = 'RegimeConflictError';
  }
}

export class IsolationError extends AppError {
  constructor(message = 'Isolation violation') {
    super('ISOLATION_VIOLATION', message, 403);
    this.name = 'IsolationError';
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message = 'Rate limit exceeded') {
    super('RATE_LIMIT', message, 429, { retry_after_sec: retryAfterSec });
    this.name = 'RateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

// -------- Утилиты --------

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export interface HttpErrorResponse {
  statusCode: number;
  body: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    audit_id?: UUID;
  };
}

export function toHttpResponse(e: unknown, auditId?: UUID): HttpErrorResponse {
  if (isAppError(e)) {
    return {
      statusCode: e.statusCode,
      body: {
        code: e.code,
        message: e.message,
        ...(e.details ? { details: e.details } : {}),
        ...(auditId ? { audit_id: auditId } : {}),
      },
    };
  }

  // Неизвестная ошибка — не раскрываем детали в prod
  return {
    statusCode: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      ...(auditId ? { audit_id: auditId } : {}),
    },
  };
}