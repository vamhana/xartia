// scripts/test-idempotency.ts
// Проверяет idempotency middleware (A.1.99.08):
//   1. POST с X-Idempotency-Key → 201, сохраняется в Redis.
//   2. Повторный POST с тем же ключом → тот же ответ, в БД один сигнал.
//   3. Другой ключ → создаётся второй сигнал.
//   4. POST без ключа → не идемпотентный, каждый раз новый.
//   5. Параллельные POST с одним ключом → 201 + 409 (или 201 + 201-replayed).
//
// Запуск: pnpm tsx scripts/test-idempotency.ts <phone> <password>

import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'IDEMPOTENCY-TEST:';

interface Client { token: string; participantId: string; directionId: string; }

function ok(m: string) { console.warn(`   ✓ ${m}`); }
function fail(m: string) { console.warn(`   ✗ ${m}`); }
function info(m: string) { console.warn(`   ℹ ${m}`); }

// ─── HTTP ────────────────────────────────────────────────────────

// Всегда читаем text, чтобы не падать на пустом теле (429/500).
async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {return null;}
  try { return JSON.parse(text); } catch { return text; }
}

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(`Login ${phone} failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`Login ${phone}: unexpected body ${JSON.stringify(data)}`);
  }
  const obj = data as { access_token?: string; participant?: { id?: string; direction_id?: string } };
  if (!obj.access_token || !obj.participant?.id || !obj.participant?.direction_id) {
    throw new Error(`Login ${phone}: missing fields ${JSON.stringify(obj)}`);
  }
  return {
    token: obj.access_token,
    participantId: obj.participant.id,
    directionId: obj.participant.direction_id,
  };
}

interface SignalResponse {
  status: number;
  data: unknown;
  replay: boolean;
  idempotencyKeyHeader: string | null;
}

async function postSignal(
  c: Client,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SignalResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.token}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) {headers['X-Idempotency-Key'] = idempotencyKey;}

  const res = await fetch(`${BASE}/signals`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  return {
    status: res.status,
    data,
    replay: res.headers.get('x-idempotency-replayed') === 'true',
    idempotencyKeyHeader: res.headers.get('x-idempotency-key'),
  };
}

function getSignalId(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}

// ─── Очистка ─────────────────────────────────────────────────────

async function clearRedis(pattern: string): Promise<number> {
  const script = `
    local keys = redis.call('KEYS', ARGV[1])
    for i=1,#keys do redis.call('DEL', keys[i]) end
    return #keys
  `;
  const n = await redis.eval(script, 0, pattern) as number;
  return n;
}

async function cleanupDb(): Promise<void> {
  await query(`DELETE FROM signals WHERE description LIKE $1`, [`${MARKER}%`]);
}

// ─── main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 0. Очищаем rate-limit и старые idempotency-ключи —
  //    чтобы тест не падал от накопленных 429.
  const clearedRl = await clearRedis('ratelimit:*');
  const clearedIdem = await clearRedis('idempotency:*');
  info(`Очищено: rate-limit=${clearedRl}, idempotency=${clearedIdem}`);

  const arch = await makeClient(
    process.argv[2] ?? '+79000000000',
    process.argv[3] ?? 'ChangeMe123456',
  );
  console.warn(`✅ Архитектор: ${arch.participantId}`);

  await cleanupDb();

  // Уникальный префикс — чтобы не пересечься с параллельными запусками.
  const runId = Date.now().toString();

  // ─── 1. Первый POST с ключом ──────────────────────────────────
  console.warn('\n─── 1. Первый POST с X-Idempotency-Key ───');
  const key1 = `idem-test-${runId}-1`;
  const r1 = await postSignal(arch, {
    type: 'problem',
    description: `${MARKER} signal 1`,
    justification: 'idempotency test',
    priority: 'standard',
  }, key1);

  if (r1.status === 201) {ok(`POST → 201`);}
  else {fail(`POST: ожидался 201, получено ${r1.status}, тело: ${JSON.stringify(r1.data)}`);}

  if (r1.replay === false) {ok(`X-Idempotency-Replayed отсутствует (первый раз)`);}
  else {fail(`X-Idempotency-Replayed неожиданно true`);}

  if (r1.idempotencyKeyHeader === key1) {ok(`X-Idempotency-Key эхом возвращён`);}
  else {fail(`X-Idempotency-Key: ожидался "${key1}", получен "${r1.idempotencyKeyHeader}"`);}

  const signal1Id = getSignalId(r1.data);
  if (signal1Id) {ok(`signal.id=${signal1Id}`);}
  else {fail(`Не удалось извлечь signal.id из ответа: ${JSON.stringify(r1.data)}`);}

  // ─── 2. Повторный POST с тем же ключом ────────────────────────
  console.warn('\n─── 2. Повторный POST с тем же ключом ───');
  const r2 = await postSignal(arch, {
    type: 'problem',
    description: `${MARKER} signal 1 (same key, other body)`,
    justification: 'idempotency test',
    priority: 'standard',
  }, key1);

  if (r2.status === 201) {ok(`POST → 201 (тот же ответ)`);}
  else {fail(`Повтор: ожидался 201, получено ${r2.status}, тело: ${JSON.stringify(r2.data)}`);}

  if (r2.replay === true) {ok(`X-Idempotency-Replayed=true`);}
  else {fail(`X-Idempotency-Replayed отсутствует`);}

  const signal2Id = getSignalId(r2.data);
  if (signal2Id && signal2Id === signal1Id) {
    ok(`Возвращён тот же signal.id (${signal1Id})`);
  } else {
    fail(`Разные signal.id: ${signal1Id} vs ${signal2Id}`);
  }

  // В БД — ровно один сигнал с этим маркером.
  const cnt1 = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM signals WHERE description LIKE $1`,
    [`${MARKER}%`],
  );
  const c1 = parseInt(cnt1[0]?.c ?? '0', 10);
  if (c1 === 1) {ok(`В БД 1 сигнал (создан однократно)`);}
  else {fail(`В БД ${c1} сигналов (ожидался 1)`);}

  // ─── 3. Другой ключ → новый сигнал ────────────────────────────
  console.warn('\n─── 3. Другой ключ → новый сигнал ───');
  const key2 = `idem-test-${runId}-2`;
  const r3 = await postSignal(arch, {
    type: 'problem',
    description: `${MARKER} signal 2`,
    justification: 'idempotency test',
    priority: 'standard',
  }, key2);

  if (r3.status === 201) {ok(`POST → 201`);}
  else {fail(`POST: ожидался 201, получено ${r3.status}`);}

  if (r3.replay === false) {ok(`Replayed отсутствует (новый ключ)`);}

  const signal3Id = getSignalId(r3.data);
  if (signal3Id && signal3Id !== signal1Id) {
    ok(`Разный signal.id — разные ключи дают разные сигналы`);
  } else {
    fail(`signal.id не отличается: ${signal3Id} vs ${signal1Id}`);
  }

  const cnt2 = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM signals WHERE description LIKE $1`,
    [`${MARKER}%`],
  );
  const c2 = parseInt(cnt2[0]?.c ?? '0', 10);
  if (c2 === 2) {ok(`В БД 2 сигнала (разные ключи = разные запросы)`);}
  else {fail(`В БД ${c2} сигналов (ожидалось 2)`);}

  // ─── 4. Без ключа — не идемпотентно ───────────────────────────
  console.warn('\n─── 4. Без ключа — не идемпотентно ───');
  const r4a = await postSignal(arch, {
    type: 'problem',
    description: `${MARKER} signal 3a`,
    justification: 'idempotency test',
    priority: 'standard',
  });
  const r4b = await postSignal(arch, {
    type: 'problem',
    description: `${MARKER} signal 3b`,
    justification: 'idempotency test',
    priority: 'standard',
  });

  if (r4a.status === 201 && r4b.status === 201) {
    ok(`Оба POST созданы (201, 201)`);
  } else {
    fail(`Ожидались 201/201, получено ${r4a.status}/${r4b.status}`);
  }

  const id4a = getSignalId(r4a.data);
  const id4b = getSignalId(r4b.data);
  if (id4a && id4b && id4a !== id4b) {
    ok(`Разные ID (без ключа каждый запрос — новый)`);
  } else {
    fail(`ID не отличается или не извлечён: ${id4a} vs ${id4b}`);
  }

  // ─── 5. Параллельные POST с одним ключом ──────────────────────
  console.warn('\n─── 5. Параллельные POST с одним ключом ───');
  const key3 = `idem-test-${runId}-3`;
  const [p1, p2] = await Promise.all([
    postSignal(arch, {
      type: 'problem',
      description: `${MARKER} parallel 1`,
      justification: 'idempotency test',
      priority: 'standard',
    }, key3),
    postSignal(arch, {
      type: 'problem',
      description: `${MARKER} parallel 2`,
      justification: 'idempotency test',
      priority: 'standard',
    }, key3),
  ]);

  const statuses = [p1.status, p2.status].sort((a, b) => a - b);

  if (statuses[0] === 201 && statuses[1] === 409) {
    ok(`Параллельные: один 201, второй 409 (зарезервировано)`);
  } else if (statuses[0] === 201 && statuses[1] === 201 && (p1.replay || p2.replay)) {
    ok(`Параллельные: оба 201, второй replayed (первый успел закоммитить)`);
  } else {
    fail(
      `Параллельные: неожиданные статусы ${statuses.join(',')}, ` +
      `replay=${p1.replay}/${p2.replay}`,
    );
  }

  // ─── Очистка ──────────────────────────────────────────────────
  console.warn('\n─── Очистка ───');
  await cleanupDb();

  const clearedKeys = await clearRedis(`idempotency:idem-test-${runId}-*`);
  ok(`Redis-ключи идемпотентности удалены (${clearedKeys})`);

  console.warn('\n✅ Тест idempotency завершён');
  await gracefulShutdown();
  await redis.quit();
}

main().catch(async (e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); await redis.quit(); } catch { /* ignore */ }
  process.exitCode = 1;
});