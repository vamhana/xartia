// scripts/test-aggregator.ts (I.9.04.36) — v0.0.03
// Полный цикл Aggregator + негатив v0.0.03.
//
// Покрытие:
//   - Happy path: signals → cluster → validate → route → can-validate-today
//     → validated-today → stats → auto-cluster → process-daily.
//   - 🆕 Негатив (v0.0.03): 422 signal_ids=[id1,id1], 422 target_direction_id=fake,
//     404 на cluster/:fake, 200 на ?cluster_id=null (B7).
//
// Cleanup в `finally` — изоляция по TEST_MARKER в pattern.
//
// Запуск: pnpm tsx scripts/test-aggregator.ts <phone> <password>

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

const TEST_MARKER = `agg-${Date.now()}-`;
const CLUSTER_IDS: string[] = [];
const SIGNAL_IDS: string[] = [];

interface CreatedSignal { id: string; externalId: string; }

async function createTestSignals(count: number): Promise<CreatedSignal[]> {
  const result: CreatedSignal[] = [];
  const texts = [
    'Утечка воды в распределительной сети жилого сектора',
    'Перебои водоснабжения в квартале — давление падает',
    'Износ водопроводных труб в северном микрорайоне',
    'Качество воды снизилось, жалобы жителей растут',
    'Ремонт насосной станции требует отключения воды',
  ];
  for (let i = 0; i < count; i++) {
    const text = texts[i % texts.length] ?? `Сигнал ${i}`;
    const r = await req<CreatedSignal>('POST', '/signals', {
      type: 'problem',
      description: `${TEST_MARKER}${text}`,
      justification: `${TEST_MARKER}коллективная жалоба направления`,
      priority: 'standard',
    });
    if (r.status === 201) {result.push({ id: r.data.id, externalId: r.data.externalId });}
  }
  return result;
}

async function seedAggregatorSignals(signalIds: string[]): Promise<void> {
  for (const sid of signalIds) {
    await query(
      `INSERT INTO aggregator_signals (id, theme, source_id, priority, received_at)
       VALUES (gen_random_uuid(), $1, $2, 'standard', now())`,
      [`${TEST_MARKER}theme`, sid],
    );
  }
}

async function cleanup(): Promise<void> {
  try {
    for (const id of CLUSTER_IDS) {
      await query(`UPDATE aggregator_signals SET cluster_id = NULL WHERE cluster_id = $1`, [id]);
      await query(`DELETE FROM aggregator_clusters WHERE id = $1`, [id]);
    }
    // На случай, если кластер не попал в CLUSTER_IDS (упал до push)
    await query(
      `DELETE FROM aggregator_clusters WHERE pattern LIKE $1`,
      [`%${TEST_MARKER}%`],
    );
    for (const sid of SIGNAL_IDS) {
      await query(`DELETE FROM aggregator_signals WHERE source_id = $1`, [sid]);
    }
    if (SIGNAL_IDS.length > 0) {
      await query(
        `DELETE FROM signals WHERE id = ANY($1::uuid[])`,
        [SIGNAL_IDS],
      );
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
    console.error('Usage: pnpm tsx scripts/test-aggregator.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { console.error(JSON.stringify(login.data)); process.exit(1); }
  TOKEN = login.data.access_token;
  const meId = login.data.participant.id;
  ok(`login as ${meId}`);

  // 2. Права
  const perms = await req<{ rights: Record<string, string[]> }>('GET', '/permissions/me');
  const agg = perms.data.rights['aggregator'] ?? [];
  log('GET /permissions/me', perms.status, { aggregator: agg });
  st(perms.status, 200, 'permissions HTTP');
  truthy(agg.includes('C'), 'aggregator:C');
  truthy(agg.includes('E'), 'aggregator:E');
  truthy(agg.includes('Act'), 'aggregator:Act');

  // 3. Signals
  const signals = await createTestSignals(5);
  truthy(signals.length >= 2, `создано ${signals.length} сигналов`);
  for (const s of signals) {SIGNAL_IDS.push(s.id);}
  await seedAggregatorSignals(signals.map((s) => s.id));
  ok('aggregator_signals заполнено');

  // 4. 🆕 GET /signals?cluster_id=null (B7)
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', '/aggregator/signals?cluster_id=null&page=1&per_page=100',
    );
    log('GET /signals?cluster_id=null', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'signals?cluster_id=null HTTP (B7)');
  }

  // 5. can-validate-today (до)
  const can1 = await req<{ can_validate: boolean; remaining: number; validatedToday: number }>(
    'GET', '/aggregator/can-validate-today',
  );
  log('GET /can-validate-today (до)', can1.status, can1.data);
  st(can1.status, 200, 'can-validate HTTP');
  eq(typeof can1.data.can_validate, 'boolean', 'can_validate:boolean');

  // 6. Create cluster (happy)
  let clusterId = '';
  {
    const signalIds = signals.slice(0, 3).map((s) => s.id);
    const r = await req<{ id: string; status: string; signalIds: string[] }>(
      'POST', '/aggregator/clusters', {
        signal_ids: signalIds,
        pattern: `${TEST_MARKER}водоснабжение · утечка · сеть`,
        relevance: 0.85,
      },
    );
    log('POST /clusters', r.status, r.data);
    st(r.status, 201, 'create cluster HTTP');
    eq(r.data.status, 'new', 'status=new');
    eq(r.data.signalIds.length, 3, 'signalIds=3');
    clusterId = r.data.id;
    CLUSTER_IDS.push(clusterId);
  }

  // 7. 🆕 422 — signal_ids с дубликатом (B1)
  {
    const r = await req<{ code: string }>(
      'POST', '/aggregator/clusters', {
        signal_ids: [signals[0]!.id, signals[0]!.id],
        pattern: 'дубликат',
      },
    );
    log('POST /clusters (дубль)', r.status, r.data);
    st(r.status, 422, 'signal_ids с дублем → 422 (B1)');
    code(r.data.code, 'VALIDATION_ERROR', 'дубль signal_ids');
  }

  // 8. 🆕 422 — target_direction_id не существует (B3)
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>(
      'POST', '/aggregator/clusters', {
        signal_ids: signals.slice(0, 2).map((s) => s.id),
        pattern: 'фейк-направление',
        target_direction_id: fake,
      },
    );
    log('POST /clusters (fake dir)', r.status, r.data);
    st(r.status, 422, 'fake target_direction_id → 422 (B3)');
    code(r.data.code, 'VALIDATION_ERROR', 'fake target');
  }

  // 9. GET /clusters/:id
  {
    const r = await req<{ id: string; status: string }>(
      'GET', `/aggregator/clusters/${clusterId}`,
    );
    log('GET /clusters/:id', r.status, { id: r.data.id, status: r.data.status });
    st(r.status, 200, 'cluster get HTTP');
    eq(r.data.id, clusterId, 'id совпадает');
  }

  // 10. 🆕 404 — fake cluster
  {
    const r = await req<{ code: string }>(
      'GET', '/aggregator/clusters/00000000-0000-0000-0000-000000000000',
    );
    log('GET /clusters/:fake', r.status, r.data);
    st(r.status, 404, 'cluster fake → 404');
    code(r.data.code, 'NOT_FOUND', 'cluster fake');
  }

  // 11. GET /clusters?status=new
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', '/aggregator/clusters?status=new',
    );
    log('GET /clusters (new)', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'clusters list HTTP');
    truthy(r.data.data?.some((c) => c.id === clusterId), 'cluster в списке new');
  }

  // 12. Validate
  {
    const r = await req<{ status: string }>(
      'POST', `/aggregator/clusters/${clusterId}/validate`,
      { valid: true, comment: 'Корректно' },
    );
    log('POST /validate', r.status, r.data);
    st(r.status, 200, 'validate HTTP');
    eq(r.data.status, 'validated', 'status=validated');
  }

  // 13. Повторный validate → 409 (entity)
  {
    const r = await req<{ code: string }>(
      'POST', `/aggregator/clusters/${clusterId}/validate`,
      { valid: true },
    );
    log('POST /validate (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный validate → 409');
    code(r.data.code, 'CONFLICT', 'validate повтор');
  }

  // 14. validated-today
  {
    const r = await req<{ count: number }>('GET', '/aggregator/validated-today');
    log('GET /validated-today', r.status, r.data);
    st(r.status, 200, 'validated-today HTTP');
    truthy(r.data.count >= 1, `count>=1 (${r.data.count})`);
  }

  // 15. Route
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) { fail('нет активных направлений'); return; }
  {
    const r = await req<{ status: string; targetDirectionId: string | null }>(
      'POST', `/aggregator/clusters/${clusterId}/route`,
      { target_direction_id: dir.id, justification: 'Передать направлению' },
    );
    log('POST /route', r.status, r.data);
    st(r.status, 200, 'route HTTP');
    eq(r.data.status, 'routed', 'status=routed');
    eq(r.data.targetDirectionId, dir.id, 'target сохранён');
  }

  // 16. Повторный route → 409
  {
    const r = await req<{ code: string }>(
      'POST', `/aggregator/clusters/${clusterId}/route`,
      { target_direction_id: dir.id, justification: 'x' },
    );
    log('POST /route (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный route → 409');
    code(r.data.code, 'CONFLICT', 'route повтор');
  }

  // 17. auto-cluster
  {
    const r = await req<{ clustersCreated: number; signalsClustered: number }>(
      'POST', '/aggregator/auto-cluster', {},
    );
    log('POST /auto-cluster', r.status, r.data);
    st(r.status, 200, 'auto-cluster HTTP');
    eq(typeof r.data.clustersCreated, 'number', 'clustersCreated:number');
  }

  // 18. process-daily
  {
    const r = await req<{ processed: number; clustersCreated: number }>(
      'POST', '/aggregator/process-daily', {},
    );
    log('POST /process-daily', r.status, r.data);
    st(r.status, 200, 'process-daily HTTP');
    eq(typeof r.data.processed, 'number', 'processed:number');
  }

  // 19. stats
  {
    const r = await req<{
      accepted: number; clustered: number; validated: number; routed: number;
    }>('GET', '/aggregator/stats');
    log('GET /stats', r.status, r.data);
    st(r.status, 200, 'stats HTTP');
    eq(typeof r.data.validated, 'number', 'validated:number');
    eq(typeof r.data.routed, 'number', 'routed:number');
  }

  // 20. 422 — 1 signal_id
  {
    const r = await req<{ code: string }>(
      'POST', '/aggregator/clusters',
      { signal_ids: [signals[0]!.id], pattern: 'один' },
    );
    log('POST /clusters (1 signal)', r.status, r.data);
    st(r.status, 422, '1 signal → 422');
  }

  console.log('\n✅ Полный цикл Aggregator замкнут');
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