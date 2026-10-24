// scripts/test-search.ts
// Полный цикл Search: создание данных → универсальный поиск → по типам
// → suggestions → проверка отсутствия PII → 422 на короткий запрос → cleanup.
//
// Запуск: pnpm tsx scripts/test-search.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) { headers['Authorization'] = `Bearer ${TOKEN}`; }
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

let OK = 0, FAIL = 0;

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}
function ok(msg: string): void { OK++; console.log(`   ✓ ${msg}`); }
function fail(msg: string): void { FAIL++; console.log(`   ✗ ${msg}`); }

function expectEq<T>(actual: T, expected: T, msg: string): boolean {
  if (actual === expected) { ok(msg); return true; }
  fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
  return false;
}
function expectStatus(actual: number, expected: number | number[], label: string): boolean {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) { ok(`${label} — HTTP ${actual}`); return true; }
  fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
  return false;
}
function expectTrue(cond: boolean, msg: string): boolean {
  if (cond) { ok(msg); return true; }
  fail(msg);
  return false;
}
function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {globalThis.process.exitCode = 1;}
}

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-search.ts <phone> <password>');
    globalThis.process.exit(1);
  }

  // Уникальный маркер для поиска (латиница в FTS работает через simple-парсер).
  const marker = `QRY${Date.now().toString().slice(-8)}`;

  // 1. Login.
  const login = await req<{
    access_token: string;
    participant: { id: string; name: string; direction_id: string };
  }>('POST', '/auth/login', { phone, password });
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) { globalThis.process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}, direction=${me.direction_id}`);

  // 2. Проверка /search без авторизации — должна быть 401.
  const noAuth = await fetch(`${BASE}/search?q=test`, {
    headers: { Authorization: '' },
  });
  expectEq(noAuth.status, 401, 'GET /search без токена → 401');

  // 3. Валидация: q.min(2) — 422 на 1 символ.
  const tooShort = await req('GET', '/search?q=X');
  log('GET /search?q=X (1 символ)', tooShort.status, tooShort.data);
  expectStatus(tooShort.status, 422, 'Короткий q → 422');

  // 4. Создать 3 сигнала с маркером.
  const signalIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await req<{ id: string }>('POST', '/signals', {
      type: 'problem',
      description: `${marker} test signal number ${i}`,
      justification: `${marker} justification ${i}`,
      priority: 'standard',
    });
    if (r.status === 201) {
      signalIds.push(r.data.id);
    } else {
      fail(`signal ${i} creation failed: HTTP ${r.status}`);
    }
  }
  if (signalIds.length === 3) {ok(`Создано 3 сигнала с маркером ${marker}`);}

  // 5. Создать 1 задачу с маркером.
  const taskResp = await req<{ id: string }>('POST', '/tasks', {
    direction_id: me.direction_id,
    description: `${marker} test task description`,
    priority: 'standard',
  });
  log('POST /tasks', taskResp.status, { ok: taskResp.status === 201 });
  if (taskResp.status !== 201) {
    fail(`task creation failed: HTTP ${taskResp.status}`);
  } else {
    ok(`Задача создана: ${taskResp.data.id}`);
  }

  // 6. Попробовать создать good и archive (best-effort).
  const goodResp = await req<{ id: string }>('POST', '/goods', {
    name: `${marker} Test Good`,
    type: 'nonmaterial',
    producer_direction_id: me.direction_id,
    description: `${marker} good description`,
  });
  log('POST /goods (best-effort)', goodResp.status, { ok: goodResp.status === 201 });

  const archiveResp = await req<{ id: string }>('POST', '/archive/documents', {
    type: 'report',
    direction_id: me.direction_id,
    subject: `${marker} archive subject`,
    content: { marker },
  });
  log('POST /archive/documents (best-effort)', archiveResp.status, {
    ok: archiveResp.status === 201,
  });

  // Дать Postgres GIN-индексам «увидеть» новые строки (транзакция закоммичена).
  // TRUNCATE не нужен — новые строки сразу видны.

  // 7. GET /search?q=<marker> — универсальный.
  const all = await req<{
    results: Array<{ type: string; id: string; title: string; snippet: string; url: string; relevance: number }>;
    total: number;
  }>('GET', `/search?q=${encodeURIComponent(marker)}&per_page=50`);
  log('GET /search?q=<marker>', all.status, {
    total: all.data.total,
    types: [...new Set((all.data.results ?? []).map((r) => r.type))],
    count: all.data.results?.length,
  });
  expectStatus(all.status, 200, 'searchAll HTTP');
  expectTrue((all.data.results?.length ?? 0) >= 3, 'Найдено >= 3 результата');

  // Каждый результат имеет нужные поля.
  const firstResult = all.data.results?.[0];
  if (firstResult) {
    expectTrue(typeof firstResult.type === 'string', 'result.type: string');
    expectTrue(typeof firstResult.url === 'string', 'result.url: string');
    expectTrue(typeof firstResult.relevance === 'number', 'result.relevance: number');
  }

  // 8. GET /search/signals?q=<marker>.
  const signals = await req<{ data: Array<{ id: string }> }>(
    'GET', `/search/signals?q=${encodeURIComponent(marker)}`,
  );
  log('GET /search/signals', signals.status, { count: signals.data.data?.length });
  expectStatus(signals.status, 200, 'searchSignals HTTP');
  expectTrue((signals.data.data?.length ?? 0) >= 3, '>= 3 сигнала');

  // 9. GET /search/tasks?q=<marker>.
  const tasks = await req<{ data: Array<{ id: string }> }>(
    'GET', `/search/tasks?q=${encodeURIComponent(marker)}`,
  );
  log('GET /search/tasks', tasks.status, { count: tasks.data.data?.length });
  expectStatus(tasks.status, 200, 'searchTasks HTTP');
  expectTrue((tasks.data.data?.length ?? 0) >= 1, '>= 1 задача');

  // 10. GET /search/goods?q=<marker> (best-effort, если good создался).
  if (goodResp.status === 201) {
    const goods = await req<{ data: Array<{ id: string }> }>(
      'GET', `/search/goods?q=${encodeURIComponent(marker)}`,
    );
    log('GET /search/goods', goods.status, { count: goods.data.data?.length });
    expectStatus(goods.status, 200, 'searchGoods HTTP');
    expectTrue((goods.data.data?.length ?? 0) >= 1, '>= 1 благо');
  }

  // 11. GET /search/archive?q=<marker> (best-effort).
  if (archiveResp.status === 201) {
    const archive = await req<{ data: Array<{ id: string }> }>(
      'GET', `/search/archive?q=${encodeURIComponent(marker)}`,
    );
    log('GET /search/archive', archive.status, { count: archive.data.data?.length });
    expectStatus(archive.status, 200, 'searchArchive HTTP');
    expectTrue((archive.data.data?.length ?? 0) >= 1, '>= 1 документ');
  }

  // 12. GET /search/participants?q=<имя Архитектора>.
  //     Проверяем отсутствие PII в ответе.
  const participants = await req<{
    data: Array<Record<string, unknown>>;
  }>('GET', `/search/participants?q=${encodeURIComponent(me.name)}`);
  log('GET /search/participants', participants.status, {
    count: participants.data.data?.length,
  });
  expectStatus(participants.status, 200, 'searchParticipants HTTP');
  const firstParticipant = participants.data.data?.[0];
  if (firstParticipant) {
    expectTrue(
      !('phone' in firstParticipant),
      'participant не содержит phone (PII)',
    );
    expectTrue(
      !('messengers' in firstParticipant),
      'participant не содержит messengers (PII)',
    );
    expectTrue(
      !('password_hash' in firstParticipant) &&
        !('passwordHash' in firstParticipant),
      'participant не содержит password_hash (PII)',
    );
    expectTrue(
      typeof firstParticipant['status'] === 'string',
      'participant.status: string',
    );
    expectTrue(
      typeof firstParticipant['directionName'] !== 'undefined',
      'participant.directionName присутствует',
    );
  }

  // 13. GET /search/suggestions?q=<маркер_префикс>.
  const suggestions = await req<{ data: string[] }>(
    'GET', `/search/suggestions?q=${encodeURIComponent(marker.slice(0, 5))}`,
  );
  log('GET /search/suggestions', suggestions.status, {
    count: suggestions.data.data?.length,
  });
  expectStatus(suggestions.status, 200, 'suggestions HTTP');
  expectTrue(Array.isArray(suggestions.data.data), 'suggestions: array');

  // 14. Поиск по participants: by=external_id.
  const byExt = await req<{ data: Array<{ externalId: string }> }>(
    'GET', `/search/participants?q=${encodeURIComponent(me.externalId)}&by=external_id`,
  );
  log('GET /search/participants?by=external_id', byExt.status, {
    count: byExt.data.data?.length,
  });
  expectStatus(byExt.status, 200, 'by=external_id HTTP');

  // 15. Cleanup — удалить созданные сущности.
  if (signalIds.length > 0) {
    await query(
      `DELETE FROM signals WHERE description LIKE $1`,
      [`%${marker}%`],
    );
  }
  if (taskResp.status === 201) {
    await query(
      `DELETE FROM tasks WHERE description LIKE $1`,
      [`%${marker}%`],
    );
  }
  if (goodResp.status === 201) {
    await query(`DELETE FROM goods WHERE name LIKE $1`, [`%${marker}%`]);
  }
  if (archiveResp.status === 201) {
    await query(
      `DELETE FROM archive_documents WHERE subject LIKE $1`,
      [`%${marker}%`],
    );
  }

  // Проверить, что cleanup прошёл.
  const leftover = await req<{ total: number }>(
    'GET', `/search?q=${encodeURIComponent(marker)}`,
  );
  expectEq(
    leftover.data.total,
    0,
    'Cleanup: маркер больше не находится',
  );

  console.log('\n✅ Полный цикл Search замкнут');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) { console.error(e.stack); }
  })
  .finally(async () => {
    summarize();
    try { await gracefulShutdown(); } catch (e) { console.error('gracefulShutdown error:', e); }
  });