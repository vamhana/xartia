// L.0.01.06 — Крипто-утилиты
// Хеши, HMAC, AES-256-GCM, генерация ключей, сравнение за постоянное время.
// Используется для шифрования PII и подписи Хранителя.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

import { AppError } from '../core/errors.js';

// -------- Хеши --------

export function hash(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export function hmac(data: string, key: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

// -------- AES-256-GCM --------
// Формат: enc:v1:<iv_b64>:<ciphertext_b64>:<authTag_b64>

const ENC_PREFIX = 'enc:v1:';
const IV_LENGTH = 12;        // 96-bit IV для GCM
const KEY_LENGTH = 32;       // AES-256
const AUTH_TAG_LENGTH = 16;

function parseKey(key: string): Buffer {
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== KEY_LENGTH) {
    throw new AppError(
      'INVALID_KEY',
      `Encryption key must be ${KEY_LENGTH} bytes (got ${buf.length})`,
      500,
    );
  }
  return buf;
}

export function encrypt(plaintext: string, key: string, context?: string): string {
  const keyBuf = parseKey(key);
  const iv = nodeRandomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  if (context) {cipher.setAAD(Buffer.from(context, 'utf8'));}

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    iv.toString('base64') + ':' +
    ciphertext.toString('base64') + ':' +
    authTag.toString('base64')
  );
}

export function decrypt(ciphertext: string, key: string, context?: string): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) {
    throw new AppError('INVALID_CIPHERTEXT', 'Ciphertext has invalid prefix', 500);
  }
  const parts = ciphertext.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new AppError('INVALID_CIPHERTEXT', 'Ciphertext has invalid structure', 500);
  }
  const [ivB64 = '', ctB64 = '', tagB64 = ''] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new AppError('INVALID_CIPHERTEXT', 'Ciphertext has invalid IV or tag length', 500);
  }

  const keyBuf = parseKey(key);
  const decipher = createDecipheriv('aes-256-gcm', keyBuf, iv);
  if (context) {decipher.setAAD(Buffer.from(context, 'utf8'));}
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError('DECRYPT_FAILED', 'Failed to decrypt (wrong key or tampered data)', 500);
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

// -------- Случайные байты --------

export function randomBytes(length: number): Buffer {
  return nodeRandomBytes(length);
}

export function randomHex(length: number): string {
  return nodeRandomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export function generateKey(): string {
  // 32 байта → base64 (44 символа с padding)
  return nodeRandomBytes(KEY_LENGTH).toString('base64');
}

// -------- Постоянное время сравнения --------

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Сравниваем с самим собой, чтобы не утекала длина
    nodeTimingSafeEqual(bufA, bufA);
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}

// -------- Base64 --------

export function base64Encode(data: string | Buffer): string {
  return Buffer.isBuffer(data) ? data.toString('base64') : Buffer.from(data, 'utf8').toString('base64');
}

export function base64Decode(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

// -------- Маскирование PII --------

export function maskPII(value: string, type: 'phone' | 'email' | 'name'): string {
  if (type === 'phone') {
    // +7***1234
    if (value.length < 8) {return '***';}
    return value.slice(0, 2) + '***' + value.slice(-4);
  }
  if (type === 'email') {
    // a***@example.com
    const at = value.indexOf('@');
    if (at < 1) {return '***';}
    return value[0] + '***' + value.slice(at);
  }
  // Имя: И*** И.
  const parts = value.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {return '***';}
  const first = parts[0][0] ?? '?';
  const last = parts[1]?.[0] ?? '';
  return last ? `${first}*** ${last}.` : `${first}***`;
}

// -------- Пароли: обёртки над argon2 (подключается в S.0.01.02) --------
// Здесь только утилиты. Основная логика — в src/security/password.ts.

// -------- HMAC-подпись для Хранителя --------

export function signContent(content: string, keeperId: string, key: string): string {
  return hmac(`${keeperId}:${content}`, key);
}

export function verifySignature(
  content: string,
  keeperId: string,
  key: string,
  signature: string,
): boolean {
  const expected = signContent(content, keeperId, key);
  return timingSafeEqual(expected, signature);
}