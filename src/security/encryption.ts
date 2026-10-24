// S.0.01.04 — Шифрование персональных данных
// AES-256-GCM. Ключи из env (в prod — из Vault).
// Полевое шифрование для PII (телефоны, email, мессенджеры).
// Поиск по хешу.

import { AppError } from '../core/errors.js';
import { encrypt, decrypt, isEncrypted, hmac } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

// -------- Ключи --------

function parseKey(raw: string | undefined, name: string): string {
  if (!raw || raw.length < 32) {
    throw new AppError('CONFIG', `${name} must be set (base64, 32 bytes)`, 500);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    throw new AppError('CONFIG', `${name} is not valid base64`, 500);
  }
  if (bytes.length !== 32) {
    throw new AppError(
      'CONFIG',
      `${name} must decode to exactly 32 bytes (got ${bytes.length})`,
      500,
    );
  }
  return raw;
}

const ENCRYPTION_KEY = parseKey(process.env['ENCRYPTION_KEY'], 'ENCRYPTION_KEY');

// PHONE_HASH_KEY — отдельный секрет для HMAC. Fallback на ENCRYPTION_KEY
// допустим в dev, но небезопасен (key reuse для AES и HMAC) — логируем.
const PHONE_HASH_KEY_RAW = process.env['PHONE_HASH_KEY'];
if (!PHONE_HASH_KEY_RAW) {
  logger.warn(
    'encryption: PHONE_HASH_KEY is not set — falling back to ENCRYPTION_KEY. ' +
      'Set a separate key in production.',
  );
}
const PHONE_HASH_KEY = parseKey(PHONE_HASH_KEY_RAW ?? ENCRYPTION_KEY, 'PHONE_HASH_KEY');

// -------- Полевое шифрование --------

export function encryptField(plaintext: string, context?: string): string {
  return encrypt(plaintext, ENCRYPTION_KEY, context);
}
export function decryptField(ciphertext: string, context?: string): string {
  return decrypt(ciphertext, ENCRYPTION_KEY, context);
}

// Нормализация перед HMAC: телефоны «+7 999 123-45-67», «+7-999-123-45-67»
// и «+79991234567» должны давать одинаковый хеш — иначе поиск по PII сломан.
// Email — приводим к нижнему регистру.
function normalizeForHash(input: string): string {
  return input.trim().toLowerCase().replace(/[\s\-()]/g, '');
}

export function hashForSearch(plaintext: string): string {
  return hmac(normalizeForHash(plaintext), PHONE_HASH_KEY);
}

// -------- Объекты --------

export function encryptObject<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly string[],
  context?: string,
): T {
  const result: Record<string, unknown> = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && !isEncrypted(value)) {
      result[field] = encryptField(value, context);
    }
  }
  return result as T;
}

export function decryptObject<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly string[],
  context?: string,
): T {
  const result: Record<string, unknown> = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && isEncrypted(value)) {
      result[field] = decryptField(value, context);
    }
  }
  return result as T;
}

// -------- Утилиты --------

export function isEncryptedValue(value: string): boolean {
  return isEncrypted(value);
}

export function maskEncrypted(value: string): string {
  if (!isEncrypted(value)) {return '***';}
  return 'enc:...' + value.slice(-8);
}

// -------- Ротация ключей (заглушка, TTL 90 дней) --------

export async function rotateKeys(): Promise<{ rotated: number }> {
  // Безопасная ротация требует versioned keys (поле key_version в БД,
  // двойное чтение, фоновая перешифровка). Сейчас ENCRYPTION_KEY —
  // единственный ключ, смена сломает расшифровку существующих полей.
  logger.warn(
    'encryption.rotateKeys: not implemented — requires key versioning and data migration',
  );
  return { rotated: 0 };
}