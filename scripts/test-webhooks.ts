// scripts/test-webhooks.ts
// Полный цикл Webhooks: create → list → patch → test → deliveries → retry
// → events → process-retries → delete + cleanup.
//
// Запуск: pnpm tsx scripts/test-webhooks.ts <phone> <password>
//
// Требует: ALLOW_PRIVATE_WEBHOOKS=true в .env (иначе 127.0.0.1 не пройдёт
// SSRF-защиту, и тестовый webhook не создастся).
//
// NB: globalThis.process.env — обход бага tsx/esbuild (process2 TDZ).

import 'dotenv/config';

import { hmac } from '../src/lib/crypto.js';
import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

// ─── HTTP-хелпер ─────────────────────────────────────────────────

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

// ─── Отчётность ──────────────────────────────────────────────────

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
function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {globalThis.process.exitCode = 1;}
}

// ─── Основной сценарий ───────────────────────────────────────────

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-webhooks.ts <phone> <password>');
    globalThis.process.exit(1);
  }

  // 0. Проверка env.
  if (env['ALLOW_PRIVATE_WEBHOOKS'] !== 'true') {
    console.error(
      '⚠ ALLOW_PRIVATE_WEBHOOKS=true должен быть установлен в .env\n' +
      '  (иначе 127.0.0.1 не пройдёт SSRF-защиту и webhook не создастся).',
    );
    globalThis.process.exit(1);
  }

  // 1. Login.
  const login = await req<{
    access_token: string;
    participant: { id: string };
  }>('POST', '/auth/login', { phone, password });
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) { globalThis.process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}`);

  // 2. Список событий.
  const events = await req<{ data: string[] }>('GET', '/webhooks/events');
  log('GET /webhooks/events', events.status, events.data);
  expectStatus(events.status, 200, 'GET /webhooks/events');
  expectEq(events.data.data.length, 6, 'Событий ровно 6');

  // 3. Create webhook.
  const create = await req<{
    id: string; url: string; events: string[]; active: boolean;
  }>(
    'POST',
    '/webhooks',
    {
      url: 'https://127.0.0.1:19999/hook',
      events: ['regime.activated', 'semantic.alarm'],
    },
  );
  log('POST /webhooks', create.status, create.data);
  expectStatus(create.status, 201, 'POST /webhooks');
  const webhookId = create.data.id;
  expectEq(create.data.active, true, 'active=true');
  expectEq(create.data.events.length, 2, '2 события сохранены');

  // 4. Список.
  const list = await req<{ data: Array<{ id: string }> }>('GET', '/webhooks');
  log('GET /webhooks', list.status, { count: list.data.data.length });
  expectStatus(list.status, 200, 'GET /webhooks');
  expectEq(list.data.data.some((w) => w.id === webhookId), true, 'Webhook в списке');

  // 5. PATCH — обновить events.
  const patch = await req<{ events: string[] }>(
    'PATCH',
    `/webhooks/${webhookId}`,
    { events: ['gateway.transaction'] },
  );
  log('PATCH /webhooks/:id', patch.status, patch.data);
  expectStatus(patch.status, 200, 'PATCH /webhooks/:id');
  expectEq(patch.data.events.length, 1, 'events обновлены на 1');

  // 6. Test — тест-доставка.
  const test = await req<{ sent: boolean }>(
    'POST',
    `/webhooks/${webhookId}/test`,
    {},
  );
  log('POST /webhooks/:id/test', test.status, test.data);
  expectStatus(test.status, 200, 'POST /webhooks/:id/test');
  expectEq(test.data.sent, true, 'test sent=true');

  // 7. Deliveries.
  const deliveries = await req<{
    data: Array<{
      id: string; attempts: number; status: string; nextRetryAt: string | null;
    }>;
    meta: { total: number };
  }>('GET', `/webhooks/${webhookId}/deliveries?page=1&per_page=20`);
  log('GET /webhooks/:id/deliveries', deliveries.status, {
    total: deliveries.data.meta.total,
    first: deliveries.data.data[0],
  });
  expectStatus(deliveries.status, 200, 'GET /webhooks/:id/deliveries');
  expectEq(deliveries.data.meta.total >= 1, true, 'Есть минимум 1 delivery');

  const first = deliveries.data.data[0];
  if (first) {
    expectEq(first.attempts >= 1, true, 'attempts >= 1');
    expectEq(first.status, 'pending', 'status=pending (retry scheduled)');
    expectEq(typeof first.nextRetryAt, 'string', 'nextRetryAt установлен');
  }

  // 8. Retry вручную.
  if (first) {
    const retry = await req<{ delivered: boolean }>(
      'POST',
      `/webhooks/${webhookId}/retry/${first.id}`,
      {},
    );
    log('POST /webhooks/:id/retry/:delivery_id', retry.status, retry.data);
    expectStatus(retry.status, 200, 'POST retry');
    expectEq(retry.data.delivered, false, 'retry delivered=false (порт закрыт)');
  }

  // 9. Process-retries.
  const process = await req<{ processed: number; delivered: number; failed: number }>(
    'POST',
    '/webhooks/process-retries',
    {},
  );
  log('POST /webhooks/process-retries', process.status, process.data);
  expectStatus(process.status, 200, 'POST /webhooks/process-retries');
  expectEq(typeof process.data.processed, 'number', 'processed:number');
  expectEq(typeof process.data.delivered, 'number', 'delivered:number');
  expectEq(typeof process.data.failed, 'number', 'failed:number');

  // 10. DELETE → 204.
  const del = await req('DELETE', `/webhooks/${webhookId}`);
  log('DELETE /webhooks/:id', del.status, {});
  expectStatus(del.status, 204, 'DELETE /webhooks/:id');

  // 11. HMAC — unit-check (без импорта service.js).
  const payload = { test: 'value', nested: { a: 1 } };
  const secret = 'unit-test-secret-32-chars-long-xyz';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const expected = hmac(`${timestamp}.${JSON.stringify(payload)}`, secret);
  expectEq(expected.length, 64, 'HMAC — 64-символьный hex');
  expectEq(/^[0-9a-f]+$/.test(expected), true, 'HMAC — только hex-символы');

  // 12. Cleanup.
  await query(
    `DELETE FROM webhooks WHERE created_by = $1 AND url LIKE 'https://127.0.0.1:%'`,
    [me.id],
  );
  await query(
    `DELETE FROM webhook_deliveries
      WHERE webhook_id NOT IN (SELECT id FROM webhooks)`,
  );
  const leftover = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM webhooks
      WHERE created_by = $1 AND url LIKE 'https://127.0.0.1:%'`,
    [me.id],
  );
  expectEq(parseInt(leftover?.cnt ?? '0', 10), 0, 'Cleanup: нет тестовых webhooks');

  console.log('\n✅ Полный цикл Webhooks замкнут');
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