// scripts/test-connectivity.ts (I.9.04.48) — новый тест
// Полный цикл Connectivity + негатив v0.0.02.
//
// Покрытие:
//   - Happy path: create signal → route (A.1.10.01) → queue → protocol →
//     prefilter → escalate → check-timeouts → stats.
//   - 🆕 Негатив (v0.0.02): 409 на повторный escalate,
//     422 на пустой/битый query/body, 404 на fake item_id.
//   - 🆕 Регрессия на права: помечено (тест с Архитектором проходит
//     через wildcard, но код теперь защищён requireRight).
//
// Cleanup в `finally` — изоляция по TEST_MARKER в description сигнала.
//
// Запуск: pnpm tsx scripts/test-connectivity.ts <phone> <password>

import 'dotenv/config';
import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
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
  console.log(JSON.stringify(data, null, 2).slice(0, 700));
}
function ok(m: string): void { OK++; console.log(`   ✓ ${m}`); }
function fail(m: string): void { FAIL++; console.log(`   ✗ ${m}`); }
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) { ok(msg); return; }
  fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
}
function st(actual: number, expected: number | number[], label: string): void {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) { ok(`${label} — HTTP ${actual}`); return; }
  fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
}
function code(actual: string | undefined, expected: string, label: string): void {
  if (actual === expected) { ok(`${label} — code=${expected}`); return; }
  fail(`${label} — ожидали code=${expected}, получили ${String(actual)}`);
}
function truthy(v: unknown, msg: string): void {
  if (v) { ok(msg); return; }
  fail(`${msg} — получено ${String(v)}`);
}
function summarize(): void {
  console.log(`\n─── Итог: ${OK}/${OK + FAIL} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {process.exitCode = 1;}
}

const TEST_MARKER = `conn-${Date.now()}-`;
let SIGNAL_ID: string | null = null;
let ITEM_ID: string | null = null;

async function cleanup(): Promise<void> {
  try {
    if (ITEM_ID) {
      await query(`DELETE FROM connectivity_items WHERE id = $1`, [ITEM_ID]);
    }
    if (SIGNAL_ID) {
      await query(`DELETE FROM prefilter_results WHERE signal_id = $1`, [SIGNAL_ID]);
      await query(`DELETE FROM connectivity_items WHERE signal_id = $1`, [SIGNAL_ID]);
      await query(`DELETE FROM signals WHERE id = $1`, [SIGNAL_ID]);
    }
    ok('Cleanup выполнен');
  } catch (e) {
    fail(`Cleanup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  const password = process.argv[3];
  if (!phone || !password) {
    console.error('Usage: pnpm tsx scripts/test-connectivity.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{
    access_token: string;
    participant: { id: string; direction_id: string | null };
  }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) { console.error(JSON.stringify(login.data)); process.exit(1); }
  TOKEN = login.data.access_token;
  const meId = login.data.participant.id;
  ok(`login as ${meId}`);

  // 2. Права
  const perms = await req<{ rights: Record<string, string[]> }>('GET', '/permissions/me');
  const conn = perms.data.rights['connectivity'] ?? [];
  log('GET /permissions/me', perms.status, { connectivity: conn });
  st(perms.status, 200, 'permissions HTTP');
  // Архитектор — wildcard; для других ролей может быть меньше. Проверяем
  // только, что ответ 200 и массив (не пустой для Архитектора — не факт).
  truthy(Array.isArray(conn), 'connectivity:array');

  // 3. direction — для route
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) { fail('нет активных направлений'); return; }
  const directionId = dir.id;

  // 4. Create signal (A.1.10.01)
  {
    const r = await req<{ id: string; status: string }>(
      'POST', '/signals', {
        type: 'problem',
        description: `${TEST_MARKER}тестовый сигнал для connectivity`,
        justification: `${TEST_MARKER}обоснование`,
        priority: 'standard',
      },
    );
    log('POST /signals', r.status, { id: r.data.id, status: r.data.status });
    st(r.status, 201, 'create signal HTTP');
    SIGNAL_ID = r.data.id;
  }

  // 5. Route signal (A.1.10.01) — создаёт connectivity_item
  {
    const r = await req<{ id: string; status: string; signalId: string }>(
      'POST', `/signals/${SIGNAL_ID}/route`, {
        target_direction_id: directionId,
        reason: `${TEST_MARKER}маршрутизация в направление`,
      },
    );
    log('POST /signals/:id/route', r.status, r.data);
    st(r.status, 201, 'route HTTP');
    eq(r.data.status, 'routed', 'item status=routed');
    eq(r.data.signalId, SIGNAL_ID, 'signalId совпадает');
    ITEM_ID = r.data.id;
  }

  // 6. GET /connectivity/queue (V; Архитектор — wildcard)
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', '/connectivity/queue',
    );
    log('GET /queue', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'queue HTTP');
    truthy(r.data.data?.some((i) => i.id === ITEM_ID), 'item в очереди');
  }

  // 7. GET /connectivity/queue?status=routed
  {
    const r = await req<{ data: Array<{ id: string; status: string }> }>(
      'GET', '/connectivity/queue?status=routed',
    );
    log('GET /queue?status=routed', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'queue?status HTTP');
    truthy(
      r.data.data?.every((i) => i.status === 'routed'),
      'все элементы status=routed',
    );
  }

  // 8. GET /connectivity/protocol?signal_id=...
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', `/connectivity/protocol?signal_id=${SIGNAL_ID}`,
    );
    log('GET /protocol', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'protocol HTTP');
    eq(r.data.data?.some((i) => i.id === ITEM_ID), true, 'item в protocol');
  }

  // 9. POST /connectivity/prefilter
  {
    const r = await req<{
      signalId: string; formatOk: boolean; etiquetteOk: boolean; violations: unknown[];
    }>('POST', '/connectivity/prefilter', { signal_id: SIGNAL_ID });
    log('POST /prefilter', r.status, r.data);
    st(r.status, 200, 'prefilter HTTP');
    eq(r.data.signalId, SIGNAL_ID, 'signalId совпадает');
    eq(typeof r.data.formatOk, 'boolean', 'formatOk:boolean');
    eq(typeof r.data.etiquetteOk, 'boolean', 'etiquetteOk:boolean');
    truthy(Array.isArray(r.data.violations), 'violations:array');
  }

  // 10. GET /connectivity/overdue
  {
    const r = await req<{ data: unknown[] }>('GET', '/connectivity/overdue');
    log('GET /overdue', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'overdue HTTP');
    truthy(Array.isArray(r.data.data), 'data:array');
  }

  // 11. GET /connectivity/stats
  {
    const r = await req<{
      queued: number; routed: number; overdue: number; escalated: number;
    }>('GET', '/connectivity/stats');
    log('GET /stats', r.status, r.data);
    st(r.status, 200, 'stats HTTP');
    eq(typeof r.data.queued, 'number', 'queued:number');
    eq(typeof r.data.routed, 'number', 'routed:number');
    eq(typeof r.data.overdue, 'number', 'overdue:number');
    eq(typeof r.data.escalated, 'number', 'escalated:number');
  }

  // 12. POST /connectivity/escalate (E; Архитектор — wildcard)
  {
    const r = await req<{ status: string; id: string }>(
      'POST', '/connectivity/escalate',
      { item_id: ITEM_ID, reason: `${TEST_MARKER}эскалация после 3 итераций` },
    );
    log('POST /escalate', r.status, r.data);
    st(r.status, 201, 'escalate HTTP');
    eq(r.data.status, 'escalated', 'item status=escalated');
  }

  // 13. Повторный escalate → 409
  {
    const r = await req<{ code: string }>(
      'POST', '/connectivity/escalate',
      { item_id: ITEM_ID, reason: 'повтор' },
    );
    log('POST /escalate (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный escalate → 409');
    code(r.data.code, 'CONFLICT', 'escalate повтор');
  }

  // 14. POST /connectivity/check-timeouts (Act; Архитектор — wildcard)
  {
    const r = await req<{ overdue: number; escalated: number }>(
      'POST', '/connectivity/check-timeouts', {},
    );
    log('POST /check-timeouts', r.status, r.data);
    st(r.status, 200, 'check-timeouts HTTP');
    eq(typeof r.data.overdue, 'number', 'overdue:number');
    eq(typeof r.data.escalated, 'number', 'escalated:number');
    // 🆕 B1: спека обещает `notified`, сервис — нет. Проверяем отсутствие.
    eq(
      (r.data as Record<string, unknown>).notified,
      undefined,
      'B1: notified отсутствует (спека врёт)',
    );
  }

  // 15. 🆕 Негатив: POST /escalate без reason → 422
  {
    const r = await req<{ code: string }>(
      'POST', '/connectivity/escalate', { item_id: ITEM_ID },
    );
    log('POST /escalate (без reason)', r.status, r.data);
    st(r.status, 422, 'escalate без reason → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'escalate без reason');
  }

  // 16. 🆕 Негатив: escalate с fake item_id → 404
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>(
      'POST', '/connectivity/escalate',
      { item_id: fake, reason: 'x' },
    );
    log('POST /escalate (fake)', r.status, r.data);
    st(r.status, 404, 'escalate fake → 404');
    code(r.data.code, 'NOT_FOUND', 'escalate fake');
  }

  // 17. 🆕 Негатив: GET /queue?status=invalid → 422
  {
    const r = await req<{ code: string }>(
      'GET', '/connectivity/queue?status=invalid',
    );
    log('GET /queue?status=invalid', r.status, r.data);
    st(r.status, 422, 'queue?status=invalid → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'queue?status');
  }

  // 18. 🆕 Негатив: GET /queue?priority=invalid → 422
  {
    const r = await req<{ code: string }>(
      'GET', '/connectivity/queue?priority=invalid',
    );
    log('GET /queue?priority=invalid', r.status, r.data);
    st(r.status, 422, 'queue?priority=invalid → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'queue?priority');
  }

  // 19. 🆕 Негатив: GET /protocol без signal_id → 422
  {
    const r = await req<{ code: string }>('GET', '/connectivity/protocol');
    log('GET /protocol (без signal_id)', r.status, r.data);
    st(r.status, 422, 'protocol без signal_id → 422');
  }

  // 20. 🆕 protocol для fake signal_id → 200 [] (сервис listBySignal не падает)
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ data: unknown[] }>(
      'GET', `/connectivity/protocol?signal_id=${fake}`,
    );
    log('GET /protocol (fake)', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'protocol fake → 200');
    eq(r.data.data?.length, 0, 'protocol fake: data=[]');
  }

  console.log('\n✅ Полный цикл Connectivity замкнут');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {console.error(e.stack);}
  })
  .finally(async () => {
    await cleanup();
    summarize();
    try { await gracefulShutdown(); } catch { /* ignore */ }
  });