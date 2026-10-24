// S.0.01.02 — Хеширование пароля
// Argon2id. Валидация сложности. Проверка на утечки (опционально).
// Защита от timing-атак (встроена в argon2).

import argon2 from 'argon2';

import { ValidationError, AppError } from '../core/errors.js';

// -------- Политика --------

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigits: boolean;
  requireSpecial: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigits: true,
  requireSpecial: false,  // спецсимволы не обязательны — можно длинную фразу
};

// OWASP-рекомендации для argon2id
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 МБ
  timeCost: 3,
  parallelism: 4,
};

// -------- Хеширование --------

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// -------- Валидация --------

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

// Контекстные данные: пароль не должен содержать телефон/имя/externalId.
export interface PasswordContext {
  phone?: string;
  name?: string;
  externalId?: string;
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY,
  context?: PasswordContext,
): PasswordValidation {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Пароль должен быть не менее ${policy.minLength} символов`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Пароль должен быть не более ${policy.maxLength} символов`);
  }
  if (policy.requireUppercase && !/[A-ZА-Я]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну заглавную букву');
  }
  if (policy.requireLowercase && !/[a-zа-я]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну строчную букву');
  }
  if (policy.requireDigits && !/\d/.test(password)) {
    errors.push('Пароль должен содержать хотя бы одну цифру');
  }
  if (policy.requireSpecial && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Пароль должен содержать хотя бы один спецсимвол');
  }

  if (context) {
    const lower = password.toLowerCase();

    if (context.phone) {
      const digits = context.phone.replace(/\D/g, '');
      if (digits.length >= 6 && password.includes(digits)) {
        errors.push('Пароль не должен содержать номер телефона');
      }
    }

    if (context.name) {
      const nameParts = context.name
        .toLowerCase()
        .split(/\s+/)
        .filter((p) => p.length >= 3);
      for (const part of nameParts) {
        if (lower.includes(part)) {
          errors.push('Пароль не должен содержать имя');
          break;
        }
      }
    }

    if (context.externalId && lower.includes(context.externalId.toLowerCase())) {
      errors.push('Пароль не должен содержать ID участника');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validatePasswordOrThrow(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY,
  context?: PasswordContext,
): void {
  const result = validatePassword(password, policy, context);
  if (!result.valid) {
    throw new ValidationError(
      'Пароль не соответствует политике',
      result.errors.map((e) => ({ path: 'password', message: e })),
    );
  }
}

// -------- Проверка на утечки (HIBP) --------
// Опционально: если HIBP_ENABLED=true — проверяем через k-anonymity.
// При недоступности API — fail-open (пропускаем).

export async function isCompromised(password: string): Promise<boolean> {
  if (process.env['HIBP_ENABLED'] !== 'true') {return false;}

  try {
    const sha1 = await sha1Hex(password);
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5).toUpperCase();

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {return false;}

    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        const count = parseInt(countStr ?? '0', 10);
        if (count > 0) {return true;}
      }
    }
    return false;
  } catch {
    return false; // fail-open
  }
}

async function sha1Hex(input: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha1').update(input, 'utf8').digest('hex').toUpperCase();
}

// -------- Rehash при смене параметров --------

export function needsRehash(hash: string): boolean {
  // PHC-формат: $argon2id$v=19$m=65536,t=3,p=4$...
  const m = /\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  if (!m) {return true;}
  const [, , mCost = '0', tCost = '0', p = '0'] = m;
  return (
    parseInt(mCost, 10) < ARGON2_OPTIONS.memoryCost ||
    parseInt(tCost, 10) < ARGON2_OPTIONS.timeCost ||
    parseInt(p, 10) < ARGON2_OPTIONS.parallelism
  );
}

export async function rehashPassword(password: string, oldHash: string): Promise<string> {
  const ok = await verifyPassword(password, oldHash);
  if (!ok) {
    throw new AppError('INVALID_PASSWORD', 'Cannot rehash: wrong password', 401);
  }
  return hashPassword(password);
}