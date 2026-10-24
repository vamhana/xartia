// F.4.99.12 — API-клиент.src\web\api\client.ts
// Обёртка над fetch. Автоматическая авторизация, refresh 401, idempotency key
// для POST. Единый формат ошибок ApiError.

import type { UUID } from '../types';

// -------- Типы --------

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  auditId?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  auth?: boolean;         // default: true
  idempotency?: boolean;  // default: true для POST
  signal?: AbortSignal;
}

// -------- Конфиг --------

const BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '/__api';

// -------- Токены --------

const STORAGE_KEY = 'xartia.auth';

interface AuthStorage {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let accessExpiresAt = 0;

// Callback на окончательный 401 — App может зарегистрировать logout.
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

export function setTokens(auth: AuthStorage | null): void {
  if (!auth) {
    accessToken = null;
    refreshToken = null;
    accessExpiresAt = 0;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return;
  }
  accessToken = auth.accessToken;
  refreshToken = auth.refreshToken;
  accessExpiresAt = auth.expiresAt;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch { /* ignore */ }
}

export function loadTokensFromStorage(): AuthStorage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {return null;}
    const parsed = JSON.parse(raw) as AuthStorage;
    if (!parsed.accessToken) {return null;}
    accessToken = parsed.accessToken;
    refreshToken = parsed.refreshToken;
    accessExpiresAt = parsed.expiresAt;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Проверяет, истекает ли access-токен в ближайшие 30 секунд.
 * Используется WS-клиентом, чтобы не подключаться с просроченным токеном.
 */
export function isAccessTokenExpired(): boolean {
  if (!accessToken) {return true;}
  return accessExpiresAt < Date.now() + 30_000;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// -------- Вспомогательные --------

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  if (!query) {return base;}
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) {parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);}
  }
  return parts.length > 0 ? `${base}${base.includes('?') ? '&' : '?'}${parts.join('&')}` : base;
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function parseError(res: Response): Promise<ApiError> {
  const text = await res.text();
  let body: { code?: string; message?: string; details?: Record<string, unknown>; audit_id?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = { message: text || res.statusText };
  }
  return {
    status: res.status,
    code: body.code ?? 'UNKNOWN',
    message: body.message ?? res.statusText,
    ...(body.details ? { details: body.details } : {}),
    ...(body.audit_id ? { auditId: body.audit_id } : {}),
  };
}

// -------- Refresh --------

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Обновляет access-токен через refresh. Возвращает true при успехе.
 * Используется в API-клиенте при 401 и в WS-клиенте перед reconnect.
 */
export async function refreshAccessToken(): Promise<boolean> {
  return tryRefresh();
}

/**
 * Полный сброс авторизации — токены удаляются, `onUnauthorized` вызывается.
 * Используется из WS-клиента при неудачном refresh.
 */
export function handleUnauthorized(): void {
  setTokens(null);
  onUnauthorized?.();
}

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) {return refreshInFlight;}
  if (!refreshToken) {return false;}

  refreshInFlight = (async () => {
    try {
      const res = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {return false;}
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      setTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      });
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// -------- Основной запрос --------

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    headers = {},
    auth = true,
    idempotency,
    signal,
  } = opts;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth && accessToken) {
    finalHeaders['Authorization'] = `Bearer ${accessToken}`;
  }
  const useIdempotency = idempotency ?? (method === 'POST');
  if (useIdempotency) {
    finalHeaders['X-Idempotency-Key'] = newIdempotencyKey();
  }

  const doFetch = async (): Promise<Response> =>
    fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });

  let res = await doFetch();

  if (res.status === 401 && auth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      if (accessToken) {finalHeaders['Authorization'] = `Bearer ${accessToken}`;}
      res = await doFetch();
    } else {
      setTokens(null);
      onUnauthorized?.();
      throw await parseError(res);
    }
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) {return undefined as T;}
  return JSON.parse(text) as T;
}

// -------- Публичный API --------

export async function apiGet<T>(path: string, query?: RequestOptions['query']): Promise<T> {
  return request<T>(path, { method: 'GET', ...(query ? { query } : {}) });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body });
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'DELETE', body });
}

// -------- Специальные: login / logout --------

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  participant: {
    id: UUID;
    external_id: string;
    name: string;
    direction_id: UUID;
  };
}

export async function loginRequest(phone: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { phone, password },
    auth: false,
    idempotency: false,
  });
}

export async function logoutRequest(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST', idempotency: false });
  } catch {
    // best-effort
  }
}

// ─────────────────────────────────────────────────────────────────
// F.4.99.12 (extension) — file uploads (S3 presigned POST).
// ─────────────────────────────────────────────────────────────────

export interface UploadResult {
  /** S3-ключ (URI-safe) для последующей передачи в attachment. */
  key: string;
  /** Оригинальное имя файла (для отображения в UI). */
  name: string;
  /** Размер в байтах (снимок с клиента). */
  size: number;
  /** Content-Type, с которым файл был подписан и загружен. */
  mime: string;
}

interface PresignResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
  content_type: string;
  expires_in: number;
}

// Маппинг mime → extension (обратный к тому, что в A.1.91.01).
// Нужен, когда у File.type что-то экзотическое, а расширение имени понятное.
function extensionFromName(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(name);
  if (!m || !m[1]) {return 'bin';}
  return m[1].toLowerCase();
}

/**
 * Загружает файл в S3 через presigned POST.
 *
 * Шаги:
 *   1. POST /files/upload-url { type: 'chat', extension, content_type } →
 *      { url, fields, key, content_type, expires_in }.
 *   2. FormData: fields + file (file — ПОСЛЕДНИМ, требование S3).
 *   3. POST на presigned URL БЕЗ Authorization (S3 принимает по подписи).
 *
 * Возвращает UploadResult, который кладётся в message.attachments.
 *
 * Оговорки:
 *   - Прогресс не отдаётся (fetch не умеет). Если понадобится — XHR с onprogress.
 *   - Content-Type файла должен совпадать с тем, что ушёл в presign,
 *     иначе S3 вернёт 403 SignatureDoesNotMatch.
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const extension = extensionFromName(file.name);
  const contentType = file.type && file.type.length > 0
    ? file.type
    : 'application/octet-stream';

  const presign = await apiPost<PresignResponse>('/files/upload-url', {
    type: 'chat',
    extension,
    content_type: contentType,
  });

  const form = new FormData();
  for (const [k, v] of Object.entries(presign.fields)) {
    form.append(k, v);
  }
  // ВАЖНО: file строго последним — этого требует AWS S3 POST policy.
  form.append('file', file, file.name);

  const uploadRes = await fetch(presign.url, {
    method: 'POST',
    body: form,
    // Authorization отсутствует намеренно: URL уже подписан.
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(
      `S3 upload failed: HTTP ${uploadRes.status} ${text.slice(0, 200)}`,
    );
  }

  return {
    key: presign.key,
    name: file.name,
    size: file.size,
    mime: presign.content_type,
  };
}

// ─────────────────────────────────────────────────────────────────
// F.4.99.12 (extension) — file metadata + download URL.
// ─────────────────────────────────────────────────────────────────

export interface FileMeta {
  key: string;
  size: number;
  content_type: string;
  uploaded_at: string;
  url: string;
  expires_in: number;
}

/**
 * Метаданные файла + presigned download URL.
 * Требует Authorization (Bearer), отправляется через apiGet.
 */
export async function getFileMeta(key: string): Promise<FileMeta> {
  return apiGet<FileMeta>(`/files/${encodeURIComponent(key)}/meta`);
}