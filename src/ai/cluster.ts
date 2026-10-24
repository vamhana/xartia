// N.0.01.03 — ИИ-кластеризация сигналов (лексическая эвристика).
// Без ML (TF-IDF + cosine + agglomerative). Интерфейс сохранён для
// будущей замены на ML (embeddings, HDBSCAN, LLM).
//
// Консистентно с N.0.01.04 anomaly.ts — только эвристики.
//
// Pipeline:
//   1. Загрузка текстов сигналов через C.0.10.02.
//   2. Токенизация (lowercase, split по \W+, стоп-слова).
//   3. TF-IDF по всем сигналам.
//   4. Cosine similarity между парами.
//   5. Agglomerative (union-find по threshold).

import { getById as getSignalById } from '../core/signals/service.js';
import type { UUID } from '../core/types.js';
import { query, queryOne } from '../lib/db.js';
import { logger } from '../lib/logger.js';

// ─── Типы ────────────────────────────────────────────────────────

export interface SignalCluster {
  signalIds: UUID[];
  pattern: string;
  relevance: number;
  /** Лексический вектор (TF-IDF), не семантический. */
  centroidEmbedding: number[];
}

export interface ClusteringResult {
  clusters: SignalCluster[];
  unclustered: UUID[];
  totalProcessed: number;
}

// ─── Константы ───────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.75;

/** Минимальный набор русских служебных слов. Расширять осторожно. */
const STOPWORDS = new Set<string>([
  'и', 'в', 'во', 'на', 'с', 'со', 'по', 'для', 'не', 'но', 'а', 'или',
  'что', 'как', 'это', 'из', 'у', 'к', 'о', 'от', 'до', 'при', 'над',
  'под', 'за', 'же', 'бы', 'ли', 'то', 'так', 'все', 'всё', 'его',
  'её', 'их', 'мы', 'вы', 'он', 'она', 'они', 'я', 'ты', 'быть',
  'был', 'была', 'было', 'были', 'есть', 'нет',
]);

// ─── Приватные helpers ───────────────────────────────────────────

function tokenize(text: string): string[] {
  if (!text) {return [];}
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function buildTfIdf(texts: string[]): Array<Map<string, number>> {
  const tokenized = texts.map(tokenize);
  const docCount = tokenized.length;
  if (docCount === 0) {return [];}

  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    const unique = new Set(tokens);
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  return tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    const vec = new Map<string, number>();
    const len = Math.max(1, tokens.length);
    for (const [term, freq] of tf) {
      const idf = Math.log((docCount + 1) / ((df.get(term) ?? 0) + 1)) + 1;
      vec.set(term, (freq / len) * idf);
    }
    return vec;
  });
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) {return 0;}
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv !== undefined) {dot += v * bv;}
  }
  for (const v of b.values()) {
    normB += v * v;
  }
  if (normA === 0 || normB === 0) {return 0;}
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Union-find по парам с cosine >= threshold. */
function connectedComponents(
  n: number,
  similar: (i: number, j: number) => boolean,
): number[][] {
  const parent: number[] = Array.from({ length: n }, (_, i) => i);

  const find = (x: number): number => {
    let root = x;
    let p = parent[root];
    while (p !== undefined && p !== root) {
      root = p;
      p = parent[root];
    }
    // path compression
    let cur = x;
    let c = parent[cur];
    while (c !== undefined && c !== root) {
      parent[cur] = root;
      cur = c;
      c = parent[cur];
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {parent[ra] = rb;}
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (similar(i, j)) {union(i, j);}
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) {list.push(i);}
    else {groups.set(root, [i]);}
  }
  return Array.from(groups.values());
}

/** Средний TF-IDF вектор кластера — топ-30 токенов по среднему весу. */
function centroidOf(vectors: Array<Map<string, number>>): number[] {
  const sum = new Map<string, number>();
  for (const v of vectors) {
    for (const [k, val] of v) {
      sum.set(k, (sum.get(k) ?? 0) + val);
    }
  }
  const sorted = [...sum.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  return sorted.map(([, v]) => v);
}

/** Топ-3 токена кластера через " · ". */
function patternOf(vectors: Array<Map<string, number>>): string {
  const sum = new Map<string, number>();
  for (const v of vectors) {
    for (const [k, val] of v) {
      sum.set(k, (sum.get(k) ?? 0) + val);
    }
  }
  const top = [...sum.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  return top.length > 0 ? top.join(' · ') : '(без темы)';
}

/** Средняя внутренняя similarity кластера. */
function meanSimilarity(vectors: Array<Map<string, number>>): number {
  if (vectors.length < 2) {return 0;}
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < vectors.length; i++) {
    const vi = vectors[i];
    if (vi === undefined) {continue;}
    for (let j = i + 1; j < vectors.length; j++) {
      const vj = vectors[j];
      if (vj === undefined) {continue;}
      sum += cosine(vi, vj);
      cnt++;
    }
  }
  return cnt > 0 ? sum / cnt : 0;
}

// ─── Публичный API ───────────────────────────────────────────────

export async function clusterSignals(
  signalIds: UUID[],
): Promise<ClusteringResult> {
  if (signalIds.length < 2) {
    return {
      clusters: [],
      unclustered: [...signalIds],
      totalProcessed: signalIds.length,
    };
  }

  // 1. Загрузка текстов сигналов.
  const texts: string[] = [];
  const validIds: UUID[] = [];
  for (const id of signalIds) {
    try {
      const s = await getSignalById(id);
      texts.push(`${s.description} ${s.justification}`);
      validIds.push(id);
    } catch (e) {
      logger.warn({ err: e, signalId: id }, 'clusterSignals: skip missing signal');
    }
  }

  if (validIds.length < 2) {
    return {
      clusters: [],
      unclustered: [...signalIds],
      totalProcessed: signalIds.length,
    };
  }

  // 2. TF-IDF.
  const vectors = buildTfIdf(texts);

  // 3. Agglomerative по threshold.
  const groups = connectedComponents(validIds.length, (i, j) => {
    const vi = vectors[i];
    const vj = vectors[j];
    return vi !== undefined && vj !== undefined &&
      cosine(vi, vj) >= SIMILARITY_THRESHOLD;
  });

  // 4. Формирование clusters + unclustered.
  const clusters: SignalCluster[] = [];
  const unclustered: UUID[] = [];

  for (const group of groups) {
    if (group.length < 2) {
      for (const idx of group) {
        const id = validIds[idx];
        if (id !== undefined) {unclustered.push(id);}
      }
      continue;
    }
    const memberVectors: Array<Map<string, number>> = [];
    const memberIds: UUID[] = [];
    for (const i of group) {
      const v = vectors[i];
      const id = validIds[i];
      if (v !== undefined) {memberVectors.push(v);}
      if (id !== undefined) {memberIds.push(id);}
    }
    clusters.push({
      signalIds: memberIds,
      pattern: patternOf(memberVectors),
      relevance: meanSimilarity(memberVectors),
      centroidEmbedding: centroidOf(memberVectors),
    });
  }

  // Сигналы, которые не удалось загрузить, тоже в unclustered.
  for (const id of signalIds) {
    if (!validIds.includes(id)) {unclustered.push(id);}
  }

  return {
    clusters,
    unclustered,
    totalProcessed: signalIds.length,
  };
}

export async function findSimilarSignals(
  signalId: UUID,
  threshold: number = SIMILARITY_THRESHOLD,
): Promise<UUID[]> {
  const base = await getSignalById(signalId);
  const baseText = `${base.description} ${base.justification}`;

  const rows = await query<{ id: string; description: string; justification: string }>(
    `SELECT id, description, justification FROM signals
      WHERE id <> $1 AND created_at > now() - interval '90 days'
      ORDER BY created_at DESC LIMIT 500`,
    [signalId],
  );
  if (rows.length === 0) {return [];}

  const allTexts = [baseText, ...rows.map((r) => `${r.description} ${r.justification}`)];
  const vectors = buildTfIdf(allTexts);
  const baseVec = vectors[0];
  if (baseVec === undefined) {return [];}

  const similar: UUID[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = vectors[i + 1];
    const row = rows[i];
    if (v === undefined || row === undefined) {continue;}
    if (cosine(baseVec, v) >= threshold) {
      similar.push(row.id);
    }
  }
  return similar;
}

export async function updateCluster(
  newSignalId: UUID,
): Promise<{ clusterId: UUID | null; isNew: boolean }> {
  const rows = await query<{
    id: string;
    signal_ids: string[];
    pattern: string;
  }>(
    `SELECT id, signal_ids, pattern FROM aggregator_clusters
      WHERE status = 'new'
      ORDER BY created_at DESC LIMIT 200`,
  );
  if (rows.length === 0) {
    return { clusterId: null, isNew: true };
  }

  const signal = await getSignalById(newSignalId);
  const newText = `${signal.description} ${signal.justification}`;

  const allClusterSignals: UUID[] = [];
  for (const r of rows) {
    const ids = Array.isArray(r.signal_ids) ? r.signal_ids : [];
    for (const id of ids) {allClusterSignals.push(id);}
  }
  if (allClusterSignals.length === 0) {
    return { clusterId: null, isNew: true };
  }

  const clusterTexts: string[] = [];
  const flatMap: number[] = [];
  for (let ci = 0; ci < rows.length; ci++) {
    const r = rows[ci];
    if (r === undefined) {continue;}
    const ids = Array.isArray(r.signal_ids) ? r.signal_ids : [];
    for (const id of ids) {
      try {
        const s = await getSignalById(id);
        clusterTexts.push(`${s.description} ${s.justification}`);
        flatMap.push(ci);
      } catch {
        // пропускаем удалённые
      }
    }
  }

  const allTexts = [newText, ...clusterTexts];
  const vectors = buildTfIdf(allTexts);
  const newVec = vectors[0];
  if (newVec === undefined) {
    return { clusterId: null, isNew: true };
  }

  let bestClusterId: UUID | null = null;
  let bestScore = 0;

  for (let ci = 0; ci < rows.length; ci++) {
    const memberIdxs: number[] = [];
    for (let i = 0; i < flatMap.length; i++) {
      if (flatMap[i] === ci) {memberIdxs.push(i + 1);}
    }
    if (memberIdxs.length === 0) {continue;}

    let sum = 0;
    let counted = 0;
    for (const mi of memberIdxs) {
      const v = vectors[mi];
      if (v === undefined) {continue;}
      sum += cosine(newVec, v);
      counted++;
    }
    if (counted === 0) {continue;}
    const avg = sum / counted;
    if (avg >= SIMILARITY_THRESHOLD && avg > bestScore) {
      bestScore = avg;
      const r = rows[ci];
      if (r !== undefined) {bestClusterId = r.id;}
    }
  }

  return {
    clusterId: bestClusterId,
    isNew: bestClusterId === null,
  };
}

export async function suggestPattern(
  signalIds: UUID[],
): Promise<{ pattern: string; confidence: number }> {
  if (signalIds.length < 2) {
    return { pattern: '(мало сигналов)', confidence: 0 };
  }

  const texts: string[] = [];
  for (const id of signalIds) {
    try {
      const s = await getSignalById(id);
      texts.push(`${s.description} ${s.justification}`);
    } catch {
      // skip
    }
  }

  if (texts.length < 2) {
    return { pattern: '(мало сигналов)', confidence: 0 };
  }

  const vectors = buildTfIdf(texts);
  return {
    pattern: patternOf(vectors),
    confidence: meanSimilarity(vectors),
  };
}

export async function autoClusterDaily(): Promise<{
  clustersCreated: number;
  signalsClustered: number;
}> {
  const rows = await query<{
    id: string;
    source_id: string;
  }>(
    `SELECT id, source_id FROM aggregator_signals
      WHERE cluster_id IS NULL
        AND received_at > now() - interval '7 days'
      ORDER BY received_at ASC
      LIMIT 500`,
  );

  if (rows.length < 2) {
    return { clustersCreated: 0, signalsClustered: 0 };
  }

  const sourceIds = rows.map((r) => r.source_id);
  const result = await clusterSignals(sourceIds);

  let signalsClustered = 0;
  for (const cluster of result.clusters) {
    signalsClustered += cluster.signalIds.length;
  }

  return {
    clustersCreated: result.clusters.length,
    signalsClustered,
  };
}

export async function getClusterStats(): Promise<{
  total: number;
  avg_size: number;
  avg_relevance: number;
}> {
  const row = await queryOne<{
    total: string;
    avg_size: string | null;
    avg_relevance: string | null;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       AVG(jsonb_array_length(signal_ids))::text AS avg_size,
       AVG(relevance)::text AS avg_relevance
     FROM aggregator_clusters`,
  );
  return {
    total: parseInt(row?.total ?? '0', 10),
    avg_size: parseFloat(row?.avg_size ?? '0'),
    avg_relevance: parseFloat(row?.avg_relevance ?? '0'),
  };
}

export async function detectEmergingThemes(
  period: 'day' | 'week' | 'month' = 'week',
): Promise<Array<{ theme: string; growth: number }>> {
  const interval = period === 'day'
    ? "1 day"
    : period === 'month'
      ? "30 days"
      : "7 days";

  const rows = await query<{ description: string; justification: string }>(
    `SELECT description, justification FROM signals
      WHERE created_at > now() - interval '${interval}'::interval * 2
      LIMIT 5000`,
  );

  const current = new Map<string, number>();

  for (const r of rows) {
    const tokens = tokenize(`${r.description} ${r.justification}`);
    for (const t of tokens) {
      current.set(t, (current.get(t) ?? 0) + 1);
    }
  }

  const result = [...current.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([theme, freq]) => ({ theme, growth: freq }));

  return result;
}