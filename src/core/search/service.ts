// |C.0.38.01|Core|Common|TypeScript|src/core/search/service.ts
// Универсальный поиск по всем сущностям (I.1.10).
//
// Тонкий слой над существующими таблицами. Нет своего entity, нет таблиц,
// нет cron/WS. Только сервис + кэш Redis TTL 30 сек.
//
// Интеграции:
//   - C.0.10.02 (signals)  — getById для searchSignals.
//   - C.0.15.02 (goods)    — getById для searchGoods.
//   - C.0.20.02 (archive)  — getDocument для searchArchive.
//   - C.0.07.02 (tasks)    — getById для searchTasks.
//
// Приватность: в /search/participants — ParticipantBrief (без PII:
// phone, messengers, password_hash). Для остальных типов — публичные поля.
//
// FTS на русском: plainto_tsquery('russian', q) @@ to_tsvector('russian', field).
// Для participants — ILIKE + trgm (имена не проза).

import { hash } from '../../lib/crypto.js';
import { query } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import type { ArchiveDocument } from '../archive/entity.js';
import { getDocument as getArchiveDoc } from '../archive/service.js';
import type { Good } from '../goods/entity.js';
import { getById as getGoodById } from '../goods/service.js';
import type { Signal } from '../signals/entity.js';
import { getById as getSignalById } from '../signals/service.js';
import type { Task } from '../tasks/entity.js';
import { getById as getTaskById } from '../tasks/service.js';
import type {
  UUID,
  Priority,
  TaskStatus,
  GoodType,
  ParticipantStatus,
} from '../types.js';

// ─── Публичные типы ─────────────────────────────────────────────

export type SearchType =
  | 'participant'
  | 'signal'
  | 'good'
  | 'archive'
  | 'task';

export interface SearchResult {
  type: SearchType;
  id: UUID;
  title: string;
  snippet: string; // может содержать <mark>...</mark> (экранированный HTML)
  url: string;
  relevance: number;
}

export interface SearchOptions {
  types?: SearchType[];
  directionId?: UUID;
  page?: number;
  perPage?: number;
}

export interface ParticipantBrief {
  id: UUID;
  name: string;
  externalId: string;
  directionId: UUID;
  directionName: string | null;
  status: ParticipantStatus;
}

// ─── Константы ───────────────────────────────────────────────────

const CACHE_PREFIX = 'search:v1:';
const CACHE_TTL_SEC = 30;
const MAX_SNIPPET_LEN = 200;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 60;

const ALL_TYPES: readonly SearchType[] = [
  'participant',
  'signal',
  'good',
  'archive',
  'task',
];

// ─── Приватные helpers ──────────────────────────────────────────

/**
 * Экранирование HTML. Применяется к тексту до вставки <mark>,
 * чтобы snippet был безопасен для dangerouslySetInnerHTML.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Снипет: обрезает текст вокруг первого вхождения q и оборачивает
 * найденное в <mark>. Текст предварительно экранируется.
 *
 *   - до 40 символов перед вхождением;
 *   - после — 60 символов;
 *   - если q нет — просто первые maxLen символов.
 */
export function buildSnippet(text: string, q: string, maxLen = MAX_SNIPPET_LEN): string {
  if (!text) {return '';}
  const source = text.slice(0, maxLen * 4); // защита от гигантских текстов
  const lower = source.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);

  if (idx === -1) {
    return escapeHtml(source.slice(0, maxLen));
  }

  const start = Math.max(0, idx - SNIPPET_BEFORE);
  const end = Math.min(source.length, idx + needle.length + SNIPPET_AFTER);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';

  const before = escapeHtml(source.slice(start, idx));
  const match = escapeHtml(source.slice(idx, idx + needle.length));
  const after = escapeHtml(source.slice(idx + needle.length, end));

  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`;
}

/**
 * Нормализация ts_rank в 0..1.
 * ts_rank возвращает float4; в большинстве случаев 0.01–0.5.
 * Обрезаем в 0..1, чтобы UI мог показать полоску.
 */
export function relevanceToNumber(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) {return 0;}
  return Math.min(1, Math.max(0, rank));
}

function cacheKey(
  q: string,
  options: SearchOptions | undefined,
  requesterId: UUID,
): string {
  const payload = JSON.stringify({
    q,
    types: options?.types ?? null,
    directionId: options?.directionId ?? null,
    page: options?.page ?? 1,
    perPage: options?.perPage ?? 20,
    requesterId,
  });
  return `${CACHE_PREFIX}${hash(payload)}`;
}

async function withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (e) {
    logger.warn({ err: e, key }, 'search: cache read failed');
  }

  const fresh = await fn();

  try {
    await redis.set(key, JSON.stringify(fresh), 'EX', CACHE_TTL_SEC);
  } catch (e) {
    logger.warn({ err: e, key }, 'search: cache write failed');
  }

  return fresh;
}

// ─── searchOneType ──────────────────────────────────────────────

interface ParticipantSearchRow {
  id: string;
  name: string;
  external_id: string;
  prefix_match: boolean;
}

interface SignalSearchRow {
  id: string;
  external_id: string;
  description: string;
  rank: string;
}

interface GoodSearchRow {
  id: string;
  name: string;
  description: string | null;
  rank: string;
}

interface ArchiveSearchRow {
  id: string;
  subject: string;
  type: string;
  rank: string;
}

interface TaskSearchRow {
  id: string;
  external_id: string;
  description: string;
  rank: string;
}

/**
 * Поиск по одному типу. Возвращает SearchResult[] (без полных объектов,
 * без N+1). Для получения полных объектов — searchSignals / searchGoods /
 * searchArchive / searchTasks (отдельно, через getById).
 */
async function searchOneType(
  type: SearchType,
  q: string,
  options: SearchOptions,
  limit: number,
): Promise<SearchResult[]> {
  const directionId = options.directionId;

  switch (type) {
    case 'participant': {
      const params: unknown[] = [`%${q}%`];
      let directionWhere = '';
      if (directionId) {
        params.push(directionId);
        directionWhere = ` AND p.direction_id = $${params.length}`;
      }
      params.push(limit);
      const rows = await query<ParticipantSearchRow>(
        `SELECT p.id, p.name, p.external_id,
                (p.name ILIKE $1 || '%') AS prefix_match
           FROM participants p
          WHERE p.deleted_at IS NULL
            AND (p.name ILIKE $1 OR p.external_id ILIKE $1)
            ${directionWhere}
          ORDER BY (p.name ILIKE $1 || '%') DESC, p.name ASC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        type: 'participant' as const,
        id: r.id,
        title: r.name,
        snippet: escapeHtml(r.external_id),
        url: `/admin/participants?selected=${r.id}`,
        // Точное совпадение префикса → выше relevance.
        relevance: r.prefix_match ? 0.9 : 0.5,
      }));
    }

    case 'signal': {
      const params: unknown[] = [q];
      let directionWhere = '';
      if (directionId) {
        params.push(directionId);
        directionWhere = ` AND lead_direction_id = $${params.length}`;
      }
      params.push(limit);
      const rows = await query<SignalSearchRow>(
        `SELECT id, external_id, description,
                ts_rank(
                  to_tsvector('russian', description || ' ' || justification),
                  plainto_tsquery('russian', $1)
                ) AS rank
           FROM signals
          WHERE to_tsvector('russian', description || ' ' || justification)
                @@ plainto_tsquery('russian', $1)
            ${directionWhere}
          ORDER BY rank DESC, created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        type: 'signal' as const,
        id: r.id,
        title: r.external_id,
        snippet: buildSnippet(r.description, q),
        url: `/signals?selected=${r.id}`,
        relevance: relevanceToNumber(parseFloat(r.rank)),
      }));
    }

    case 'good': {
      const params: unknown[] = [q];
      let directionWhere = '';
      if (directionId) {
        params.push(directionId);
        directionWhere = ` AND producer_direction_id = $${params.length}`;
      }
      params.push(limit);
      const rows = await query<GoodSearchRow>(
        `SELECT id, name, description,
                ts_rank(
                  to_tsvector('russian', name || ' ' || COALESCE(description, '')),
                  plainto_tsquery('russian', $1)
                ) AS rank
           FROM goods
          WHERE to_tsvector('russian', name || ' ' || COALESCE(description, ''))
                @@ plainto_tsquery('russian', $1)
            ${directionWhere}
          ORDER BY rank DESC, updated_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        type: 'good' as const,
        id: r.id,
        title: r.name,
        snippet: buildSnippet(r.description ?? '', q),
        url: `/goods?selected=${r.id}`,
        relevance: relevanceToNumber(parseFloat(r.rank)),
      }));
    }

    case 'archive': {
      const params: unknown[] = [q];
      let directionWhere = '';
      if (directionId) {
        params.push(directionId);
        directionWhere = ` AND direction_id = $${params.length}`;
      }
      params.push(limit);
      const rows = await query<ArchiveSearchRow>(
        `SELECT id, subject, type,
                ts_rank(
                  to_tsvector('russian', subject),
                  plainto_tsquery('russian', $1)
                ) AS rank
           FROM archive_documents
          WHERE to_tsvector('russian', subject) @@ plainto_tsquery('russian', $1)
            ${directionWhere}
          ORDER BY rank DESC, archived_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        type: 'archive' as const,
        id: r.id,
        title: r.subject,
        snippet: escapeHtml(r.type),
        url: `/archive?selected=${r.id}`,
        relevance: relevanceToNumber(parseFloat(r.rank)),
      }));
    }

    case 'task': {
      const params: unknown[] = [q];
      let directionWhere = '';
      if (directionId) {
        params.push(directionId);
        directionWhere = ` AND direction_id = $${params.length}`;
      }
      params.push(limit);
      const rows = await query<TaskSearchRow>(
        `SELECT id, external_id, description,
                ts_rank(
                  to_tsvector('russian', description),
                  plainto_tsquery('russian', $1)
                ) AS rank
           FROM tasks
          WHERE to_tsvector('russian', description) @@ plainto_tsquery('russian', $1)
            ${directionWhere}
          ORDER BY rank DESC, created_at DESC
          LIMIT $${params.length}`,
        params,
      );
      return rows.map((r) => ({
        type: 'task' as const,
        id: r.id,
        title: r.external_id,
        snippet: buildSnippet(r.description, q),
        url: `/tasks?selected=${r.id}`,
        relevance: relevanceToNumber(parseFloat(r.rank)),
      }));
    }
  }
}

// ─── searchAll ─────────────────────────────────────────────────

export async function searchAll(
  q: string,
  options: SearchOptions = {},
  requesterId: UUID,
): Promise<{ results: SearchResult[]; total: number }> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return { results: [], total: 0 };
  }

  const key = cacheKey(trimmed, options, requesterId);

  return withCache(key, async () => {
    const types = options.types && options.types.length > 0
      ? options.types
      : [...ALL_TYPES];

    const page = Math.max(1, options.page ?? 1);
    const perPage = Math.min(50, Math.max(1, options.perPage ?? 20));
    const offset = (page - 1) * perPage;
    // Берём с запасом для последующей сортировки: 5 типов × perPage.
    const perTypeLimit = Math.min(50, perPage * 2);

    // Параллельный опрос всех типов. Ошибка одного не ломает остальные.
    const settled = await Promise.allSettled(
      types.map((t) => searchOneType(t, trimmed, options, perTypeLimit)),
    );

    const merged: SearchResult[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        merged.push(...s.value);
      } else {
        logger.warn({ err: s.reason }, 'search: type search failed');
      }
    }

    merged.sort((a, b) => b.relevance - a.relevance);

    const total = merged.length;
    const sliced = merged.slice(offset, offset + perPage);

    return { results: sliced, total };
  });
}

// ─── searchParticipants ────────────────────────────────────────

export type ParticipantSearchBy = 'id' | 'name' | 'external_id';

interface ParticipantBriefRow {
  id: string;
  name: string;
  external_id: string;
  direction_id: string;
  direction_name: string | null;
  status: ParticipantStatus;
}

export async function searchParticipants(
  q: string,
  by: ParticipantSearchBy | undefined,
  _requesterId: UUID,
): Promise<ParticipantBrief[]> {
  const trimmed = q.trim();
  if (trimmed.length < 1) {return [];}

  const conditions: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];

  const mode = by ?? 'name';

  if (mode === 'id') {
    // Поиск по UUID (если q — валидный UUID). Иначе — пусто.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      return [];
    }
    params.push(trimmed);
    conditions.push(`p.id = $${params.length}`);
  } else if (mode === 'external_id') {
    params.push(`%${trimmed}%`);
    conditions.push(`p.external_id ILIKE $${params.length}`);
  } else {
    // by='name' (default) — ищем и по name, и по external_id.
    params.push(`%${trimmed}%`);
    conditions.push(
      `(p.name ILIKE $${params.length} OR p.external_id ILIKE $${params.length})`,
    );
  }

  params.push(50);
  const rows = await query<ParticipantBriefRow>(
    `SELECT p.id, p.name, p.external_id, p.direction_id, p.status,
            d.name AS direction_name
       FROM participants p
       LEFT JOIN directions d ON d.id = p.direction_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY (p.name ILIKE $${mode === 'name' || mode === 'external_id' ? 1 : 999}::text || '%') DESC,
               p.name ASC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    externalId: r.external_id,
    directionId: r.direction_id,
    directionName: r.direction_name,
    status: r.status,
  }));
}

// ─── searchSignals ──────────────────────────────────────────────

export async function searchSignals(
  q: string,
  priority: Priority | undefined,
  _requesterId: UUID,
): Promise<Signal[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {return [];}

  const params: unknown[] = [trimmed];
  let priorityWhere = '';
  if (priority) {
    params.push(priority);
    priorityWhere = ` AND priority = $${params.length}`;
  }
  params.push(50);

  const rows = await query<{ id: string; rank: string }>(
    `SELECT id, ts_rank(
              to_tsvector('russian', description || ' ' || justification),
              plainto_tsquery('russian', $1)
            ) AS rank
       FROM signals
      WHERE to_tsvector('russian', description || ' ' || justification)
            @@ plainto_tsquery('russian', $1)
        ${priorityWhere}
      ORDER BY rank DESC, created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const results = await Promise.allSettled(
    rows.map((r) => getSignalById(r.id)),
  );
  const signals: Signal[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {signals.push(r.value);}
  }
  return signals;
}

// ─── searchGoods ────────────────────────────────────────────────

export async function searchGoods(
  q: string,
  type: GoodType | undefined,
  _requesterId: UUID,
): Promise<Good[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {return [];}

  const params: unknown[] = [trimmed];
  let typeWhere = '';
  if (type) {
    params.push(type);
    typeWhere = ` AND type = $${params.length}`;
  }
  params.push(50);

  const rows = await query<{ id: string; rank: string }>(
    `SELECT id, ts_rank(
              to_tsvector('russian', name || ' ' || COALESCE(description, '')),
              plainto_tsquery('russian', $1)
            ) AS rank
       FROM goods
      WHERE to_tsvector('russian', name || ' ' || COALESCE(description, ''))
            @@ plainto_tsquery('russian', $1)
        ${typeWhere}
      ORDER BY rank DESC, updated_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const results = await Promise.allSettled(
    rows.map((r) => getGoodById(r.id)),
  );
  const goods: Good[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {goods.push(r.value);}
  }
  return goods;
}

// ─── searchArchive ─────────────────────────────────────────────

export async function searchArchive(
  q: string,
  directionId: UUID | undefined,
  _requesterId: UUID,
): Promise<ArchiveDocument[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {return [];}

  const params: unknown[] = [trimmed];
  let dirWhere = '';
  if (directionId) {
    params.push(directionId);
    dirWhere = ` AND direction_id = $${params.length}`;
  }
  params.push(50);

  const rows = await query<{ id: string; rank: string }>(
    `SELECT id, ts_rank(
              to_tsvector('russian', subject),
              plainto_tsquery('russian', $1)
            ) AS rank
       FROM archive_documents
      WHERE to_tsvector('russian', subject) @@ plainto_tsquery('russian', $1)
        ${dirWhere}
      ORDER BY rank DESC, archived_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const results = await Promise.allSettled(
    rows.map((r) => getArchiveDoc(r.id)),
  );
  const docs: ArchiveDocument[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {docs.push(r.value);}
  }
  return docs;
}

// ─── searchTasks ────────────────────────────────────────────────

export async function searchTasks(
  q: string,
  status: TaskStatus | undefined,
  _requesterId: UUID,
): Promise<Task[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {return [];}

  const params: unknown[] = [trimmed];
  let statusWhere = '';
  if (status) {
    params.push(status);
    statusWhere = ` AND status = $${params.length}`;
  }
  params.push(50);

  const rows = await query<{ id: string; rank: string }>(
    `SELECT id, ts_rank(
              to_tsvector('russian', description),
              plainto_tsquery('russian', $1)
            ) AS rank
       FROM tasks
      WHERE to_tsvector('russian', description) @@ plainto_tsquery('russian', $1)
        ${statusWhere}
      ORDER BY rank DESC, created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const results = await Promise.allSettled(
    rows.map((r) => getTaskById(r.id)),
  );
  const tasks: Task[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {tasks.push(r.value);}
  }
  return tasks;
}

// ─── getSuggestions ────────────────────────────────────────────

export async function getSuggestions(
  q: string,
  _requesterId: UUID,
): Promise<string[]> {
  const trimmed = q.trim();
  if (trimmed.length < 1) {return [];}

  // Три параллельных запроса на префикс. Разные лимиты:
  // участники — 5 (чаще всего ищут людей), signals — 3, goods — 3.
  const [participants, signals, goods] = await Promise.allSettled([
    query<{ value: string }>(
      `SELECT name AS value
         FROM participants
        WHERE deleted_at IS NULL AND name ILIKE $1 || '%'
        ORDER BY name ASC
        LIMIT 5`,
      [trimmed],
    ),
    query<{ value: string }>(
      `SELECT external_id AS value
         FROM signals
        WHERE external_id ILIKE $1 || '%'
        ORDER BY created_at DESC
        LIMIT 3`,
      [trimmed],
    ),
    query<{ value: string }>(
      `SELECT name AS value
         FROM goods
        WHERE name ILIKE $1 || '%'
        ORDER BY name ASC
        LIMIT 3`,
      [trimmed],
    ),
  ]);

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (values: { value: string }[]): void => {
    for (const v of values) {
      if (v.value && !seen.has(v.value)) {
        seen.add(v.value);
        out.push(v.value);
      }
    }
  };

  if (participants.status === 'fulfilled') {push(participants.value);}
  if (signals.status === 'fulfilled') {push(signals.value);}
  if (goods.status === 'fulfilled') {push(goods.value);}

  return out.slice(0, 10);
}