// src/security/integrity.ts
/**
 * S.0.01.08 — Integrity
 *
 * HMAC-подписи критичных файлов + мониторинг изменений.
 * Хартия III.1.11 — детект цифровой атаки, созыв Жюри, изоляция сегмента.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logAction } from '../core/audit.js';
import { AppError } from '../core/errors.js';
import type { UUID, ISODateTime } from '../core/types.js';
import { hmac, timingSafeEqual } from '../lib/crypto.js';
import { newUUID } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

import {
  activateInfoBlockade,
  isInfoBlockadeActive,
} from './gateway-isolation.js';

// ─── Конфигурация ────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const SIG_PATH =
  process.env['INTEGRITY_SIG_PATH'] ??
  resolve(PROJECT_ROOT, '.integrity', 'signatures.json');

const EXPLICIT_HMAC_KEY = process.env['INTEGRITY_HMAC_KEY'];
const FALLBACK_ENCRYPTION_KEY = process.env['ENCRYPTION_KEY'];
const FALLBACK_JWT_SECRET = process.env['JWT_SECRET'];

const HMAC_KEY =
  EXPLICIT_HMAC_KEY ??
  FALLBACK_ENCRYPTION_KEY ??
  FALLBACK_JWT_SECRET ??
  '';

if (HMAC_KEY.length < 32) {
  // Слабый/пустой ключ: integrity-подписи будут детектироваться как
  // подделанные при любой попытке верификации. Fail-closed на старте
  // лучше, чем тихо подписывать файлы известным публике ключом.
  throw new AppError(
    'CONFIG',
    'INTEGRITY_HMAC_KEY (or fallback) must be at least 32 characters',
    500,
  );
}

if (!EXPLICIT_HMAC_KEY) {
  if (HMAC_KEY === FALLBACK_ENCRYPTION_KEY) {
    logger.warn(
      'integrity: INTEGRITY_HMAC_KEY not set — falling back to ENCRYPTION_KEY. ' +
        'This is key reuse (AES + HMAC). Set a separate key in production.',
    );
  } else if (HMAC_KEY === FALLBACK_JWT_SECRET) {
    logger.warn(
      'integrity: INTEGRITY_HMAC_KEY not set — falling back to JWT_SECRET. ' +
        'This is key reuse (JWS + HMAC). Set a separate key in production.',
    );
  }
}

const ALERTS_KEY = 'integrity:alerts';
const ALERTS_TTL_SEC = 30 * 24 * 3600;
const MAX_ALERTS = 1000;

const DEFAULT_WATCHED_FILES = [
  'src/core/rights.ts',
  'src/core/roles.ts',
  'src/core/errors.ts',
  'src/core/constants.ts',
  'src/security/jwt.ts',
  'src/security/password.ts',
  'src/security/rbac.ts',
  'src/security/encryption.ts',
  'src/security/gateway-isolation.ts',
  'src/security/rate-limit.ts',
  'src/security/integrity.ts',
  'src/api/middleware/auth.ts',
  'src/api/middleware/rights.ts',
  'src/api/middleware/regime.ts',
  'src/api/middleware/error-handler.ts',
  'src/api/middleware/idempotency.ts',
] as const;

// INTEGRITY_WATCHED_FILES — comma-separated relative paths.
// Если задан — заменяет список целиком (не merge).
const WATCHED_FILES: readonly string[] = (() => {
  const env = process.env['INTEGRITY_WATCHED_FILES'];
  if (!env) {
    return DEFAULT_WATCHED_FILES;
  }
  const parsed = env
    .split(',')
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter((s) => s.length > 0);
  if (parsed.length === 0) {
    logger.warn(
      'integrity: INTEGRITY_WATCHED_FILES is empty; using defaults',
    );
    return DEFAULT_WATCHED_FILES;
  }
  return parsed;
})();

// ─── Типы ────────────────────────────────────────────────────────

export interface IntegritySignature {
  path: string;
  hash: string;
  hmac: string;
  signedAt: ISODateTime;
  signedBy: UUID | null;
}

export interface IntegrityAlert {
  id: UUID;
  path: string;
  kind: 'modified' | 'missing' | 'added' | 'signature_mismatch';
  expectedHash: string | null;
  actualHash: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  detectedAt: ISODateTime;
  handled: boolean;
  handledAt: ISODateTime | null;
  handledBy: UUID | null;
  resolution: string | null;
}

interface SignatureStore {
  version: 1;
  signatures: Record<string, IntegritySignature>;
}

// ─── Приватные утилиты ───────────────────────────────────────────

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function relPath(absoluteOrRelative: string): string {
  if (absoluteOrRelative.startsWith(PROJECT_ROOT)) {
    return absoluteOrRelative.slice(PROJECT_ROOT.length + 1).replace(/\\/g, '/');
  }
  return absoluteOrRelative.replace(/\\/g, '/');
}

function absPath(rel: string): string {
  return resolve(PROJECT_ROOT, rel);
}

function computeHmac(rel: string, fileHash: string): string {
  return hmac(`${rel}:${fileHash}`, HMAC_KEY);
}

// ─── Хранилище подписей ──────────────────────────────────────────

export function getWatchedFiles(): readonly string[] {
  return WATCHED_FILES;
}

export async function loadSignatures(): Promise<Map<string, IntegritySignature>> {
  try {
    if (!existsSync(SIG_PATH)) {return new Map();}
    const raw = await readFile(SIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as SignatureStore;
    const map = new Map<string, IntegritySignature>();
    for (const [k, v] of Object.entries(parsed.signatures ?? {})) {
      map.set(k, v);
    }
    return map;
  } catch (e) {
    logger.warn({ err: e }, 'integrity: failed to load signatures');
    return new Map();
  }
}

export async function saveSignatures(
  map: Map<string, IntegritySignature>,
): Promise<void> {
  await mkdir(dirname(SIG_PATH), { recursive: true });
  const store: SignatureStore = {
    version: 1,
    signatures: Object.fromEntries(map),
  };
  await writeFile(SIG_PATH, JSON.stringify(store, null, 2), 'utf8');
}

// ─── Подпись и верификация ───────────────────────────────────────

export async function signFile(
  path: string,
  signedBy: UUID | null = null,
): Promise<IntegritySignature> {
  const rel = relPath(path);
  const abs = absPath(rel);
  const content = await readFile(abs);
  const fileHash = sha256Hex(content);
  const sig: IntegritySignature = {
    path: rel,
    hash: fileHash,
    hmac: computeHmac(rel, fileHash),
    signedAt: new Date().toISOString() as ISODateTime,
    signedBy,
  };
  const map = await loadSignatures();
  map.set(rel, sig);
  await saveSignatures(map);
  return sig;
}

export async function signAll(
  signedBy: UUID | null = null,
): Promise<{ signed: number }> {
  const map = await loadSignatures();
  let signed = 0;
  for (const rel of WATCHED_FILES) {
    try {
      const content = await readFile(absPath(rel));
      const fileHash = sha256Hex(content);
      map.set(rel, {
        path: rel,
        hash: fileHash,
        hmac: computeHmac(rel, fileHash),
        signedAt: new Date().toISOString() as ISODateTime,
        signedBy,
      });
      signed += 1;
    } catch (e) {
      logger.warn({ err: e, path: rel }, 'integrity: signAll skipped file');
    }
  }
  await saveSignatures(map);
  return { signed };
}

export async function verifyFile(
  path: string,
): Promise<{ valid: boolean; reason?: string; expected?: string; actual?: string }> {
  const rel = relPath(path);
  const map = await loadSignatures();
  const expected = map.get(rel);
  if (!expected) {
    return { valid: false, reason: 'no_signature' };
  }
  const abs = absPath(rel);
  if (!existsSync(abs)) {
    return { valid: false, reason: 'missing', expected: expected.hash };
  }
  const content = await readFile(abs);
  const actualHash = sha256Hex(content);
  const expectedHmac = computeHmac(rel, expected.hash);
  if (!timingSafeEqual(expectedHmac, expected.hmac)) {
    return {
      valid: false,
      reason: 'signature_mismatch',
      expected: expected.hash,
      actual: actualHash,
    };
  }
  if (actualHash !== expected.hash) {
    return {
      valid: false,
      reason: 'modified',
      expected: expected.hash,
      actual: actualHash,
    };
  }
  return { valid: true };
}

// ─── Alerts ──────────────────────────────────────────────────────

export async function reportIntegrityAlert(
  input: Omit<
    IntegrityAlert,
    'id' | 'detectedAt' | 'handled' | 'handledAt' | 'handledBy' | 'resolution'
  >,
): Promise<IntegrityAlert> {
  const alert: IntegrityAlert = {
    id: newUUID(),
    detectedAt: new Date().toISOString() as ISODateTime,
    handled: false,
    handledAt: null,
    handledBy: null,
    resolution: null,
    ...input,
  };
  try {
    await redis
      .multi()
      .lpush(ALERTS_KEY, JSON.stringify(alert))
      .ltrim(ALERTS_KEY, 0, MAX_ALERTS - 1)
      .expire(ALERTS_KEY, ALERTS_TTL_SEC)
      .exec();
  } catch (e) {
    logger.error({ err: e }, 'integrity: failed to persist alert');
  }
  logger.error(
    { path: alert.path, kind: alert.kind, severity: alert.severity },
    'integrity: ALERT',
  );

  // TECHDEBT: при severity === 'critical' или 'high' нужно отправить
  // уведомление ролям VERIFIER + FIRST_ARCHITECT через L.0.01.10 send.
  // Отложено: notifications.ts уже содержит 'integrity.alert' в
  // CRITICAL_TYPES и TEMPLATES, интеграция — задача Фазы 2.
  // Текущее поведение: алерт виден в Redis и логах, но не пушится.

  return alert;
}

export async function getAllAlerts(limit = 200): Promise<IntegrityAlert[]> {
  try {
    const raw = await redis.lrange(ALERTS_KEY, 0, limit - 1);
    const alerts: IntegrityAlert[] = [];
    let corrupted = 0;
    for (const r of raw) {
      try {
        alerts.push(JSON.parse(r) as IntegrityAlert);
      } catch {
        corrupted += 1;
      }
    }
    if (corrupted > 0) {
      logger.warn(
        { corrupted, total: raw.length },
        'integrity: some alert records are corrupted and skipped',
      );
    }
    return alerts;
  } catch (e) {
    logger.warn({ err: e }, 'integrity: failed to read alerts');
    return [];
  }
}

export async function getActiveAlerts(): Promise<IntegrityAlert[]> {
  const all = await getAllAlerts(MAX_ALERTS);
  return all.filter((a) => !a.handled);
}

// Атомарная замена одной записи в Redis-списке через Lua.
// Старая реализация (LRANGE → map → DEL+RPUSH) не атомарна: параллельные
// markHandled теряли апдейты друг друга и могли уронить ALERTS_KEY
// при ошибке между DEL и RPUSH.
//
// Скрипт находит элемент по id, мутирует JSON in-place и делает LSET.
// Возвращает 1 — обновлено, 0 — не найдено.
const MARK_HANDLED_SCRIPT = `
local alerts = redis.call('LRANGE', KEYS[1], 0, -1)
for i = 1, #alerts do
  local ok, parsed = pcall(cjson.decode, alerts[i])
  if ok and parsed.id == ARGV[1] then
    parsed.handled   = true
    parsed.handledAt = ARGV[2]
    parsed.handledBy = ARGV[3]
    parsed.resolution = ARGV[4]
    redis.call('LSET', KEYS[1], i - 1, cjson.encode(parsed))
    return 1
  end
end
return 0
`;

export async function markHandled(
  alertId: UUID,
  resolution: string,
  by: UUID,
): Promise<void> {
  try {
    const handledAt = new Date().toISOString() as ISODateTime;
    const result = (await redis.eval(
      MARK_HANDLED_SCRIPT,
      1,
      ALERTS_KEY,
      alertId,
      handledAt,
      by,
      resolution,
    )) as number;

    if (result === 0) {
      throw new AppError(
        'NOT_FOUND',
        `integrity alert ${alertId} not found`,
        404,
      );
    }
  } catch (e) {
    if (e instanceof AppError) {
      throw e;
    }
    logger.error({ err: e, alertId }, 'integrity: failed to mark handled');
    throw new AppError('INTERNAL_ERROR', 'markHandled failed', 500);
  }
}

// ─── Мониторинг ──────────────────────────────────────────────────

export async function monitorFiles(): Promise<{
  scanned: number;
  alerts: IntegrityAlert[];
}> {
  const alerts: IntegrityAlert[] = [];
  let scanned = 0;
  for (const rel of WATCHED_FILES) {
    scanned += 1;
    const r = await verifyFile(rel);
    if (r.valid) {continue;}
    const kind: IntegrityAlert['kind'] =
      r.reason === 'missing'
        ? 'missing'
        : r.reason === 'signature_mismatch'
          ? 'signature_mismatch'
          : r.reason === 'modified'
            ? 'modified'
            : 'added';
    const severity: IntegrityAlert['severity'] =
      kind === 'missing' || kind === 'signature_mismatch'
        ? 'critical'
        : kind === 'modified'
          ? 'high'
          : 'low';
    const alert = await reportIntegrityAlert({
      path: rel,
      kind,
      expectedHash: r.expected ?? null,
      actualHash: r.actual ?? null,
      severity,
      message: `File ${rel}: ${r.reason ?? 'unknown'}`,
    });
    alerts.push(alert);
  }
  return { scanned, alerts };
}

// ─── Изоляция и Жюри ─────────────────────────────────────────────

export async function isolateSegment(
  reason: string,
  by: UUID,
): Promise<{ regimeId: UUID | null }> {
  if (await isInfoBlockadeActive()) {
    logger.info('integrity: info_blockade already active');
    return { regimeId: null };
  }
  const result = await activateInfoBlockade(`integrity: ${reason}`);
  await logAction({
    actorId: by,
    actorType: 'system',
    action: 'integrity.isolate_segment',
    entityType: 'regime',
    entityId: result.regimeId ?? newUUID(),
    newValue: { reason },
  });
  return result;
}

export async function conveneJury(
  reason: string,
  by: UUID,
): Promise<UUID | null> {
  try {
    const { createSession } = await import('../core/jury/service.js');
    const session = await createSession(
      {
        type: 'extended_24',
        subjectId: newUUID(),
        excludeIds: [],
      },
      by,
    );
    await logAction({
      actorId: by,
      actorType: 'system',
      action: 'integrity.convene_jury',
      entityType: 'jury_session',
      entityId: session.id,
      newValue: { reason },
    });
    return session.id;
  } catch (e) {
    logger.error({ err: e, reason }, 'integrity: conveneJury failed');
    return null;
  }
}

// ─── Доменные проверки ───────────────────────────────────────────

export async function verifyBalanceAlgorithm(): Promise<{
  ok: boolean;
  details: string[];
}> {
  const files = [
    'src/core/balance/service.ts',
    'src/core/balance/entity.ts',
    'src/ai/anomaly.ts',
  ];
  const details: string[] = [];
  let ok = true;
  for (const f of files) {
    const r = await verifyFile(f);
    if (!r.valid) {
      ok = false;
      details.push(`${f}: ${r.reason ?? 'unknown'}`);
    }
  }
  return { ok, details };
}

export async function verifyRightsMatrix(): Promise<{
  ok: boolean;
  details: string[];
}> {
  const files = [
    'src/core/rights.ts',
    'src/core/roles.ts',
    'src/api/middleware/rights.ts',
  ];
  const details: string[] = [];
  let ok = true;
  for (const f of files) {
    const r = await verifyFile(f);
    if (!r.valid) {
      ok = false;
      details.push(`${f}: ${r.reason ?? 'unknown'}`);
    }
  }
  return { ok, details };
}

// ─── Статистика ──────────────────────────────────────────────────

export async function getStats(): Promise<{
  watched: number;
  signed: number;
  activeAlerts: number;
  criticalAlerts: number;
}> {
  const map = await loadSignatures();
  const active = await getActiveAlerts();
  return {
    watched: WATCHED_FILES.length,
    signed: map.size,
    activeAlerts: active.length,
    criticalAlerts: active.filter((a) => a.severity === 'critical').length,
  };
}