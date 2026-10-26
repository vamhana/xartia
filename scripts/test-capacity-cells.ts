// scripts/test-capacity-cells.ts
// Инкремент «муравейник»: компетенции → ёмкость → готовность ячейки.
//
// Запуск: pnpm tsx scripts/test-capacity-cells.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function createWorker(dirId: string, dirNumber: number, tag: string): Promise<string> {
  const suffix = String(Date.now()).slice(-6) + tag;
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7991${suffix}`,
    messengers: { telegram: `@cap_${suffix}` },
    password: `Capacity${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) {throw new Error(`register → ${reg.status}`);}
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dirId, name: `Ёмкость ${tag}`, direction_number: dirNumber },
  );
  if (acc.status !== 201) {throw new Error(`accept → ${acc.status}`);}
  return acc.data.participant.id;
}

async function main(): Promise<void> {
  console.log('▶ Ёмкость и готовность ячеек\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const me = login.data.participant;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === me.direction_id);
  if (!dir) {fail('направление не найдено'); return;}

  const workers = [
    await createWorker(dir.id, dir.number, '1'),
    await createWorker(dir.id, dir.number, '2'),
    await createWorker(dir.id, dir.number, '3'),
    await createWorker(dir.id, dir.number, '4'),
    await createWorker(dir.id, dir.number, '5'),
  ];

  const uniq = String(Date.now()).slice(-5);
  const compA = `parser_${uniq}`;
  const compB = `runtime_${uniq}`;

  // 1. Компетенции (уникальные на прогон — ёмкость не зависит от старых задач).
  for (const [pid, competency, level] of [
    [me.id, compA, 5],
    [workers[0]!, compA, 3],
    [workers[1]!, compB, 2],
  ] as const) {
    const r = await req('PUT', `/participants/${pid}/competencies`, { competency, level });
    if (r.status === 200) {ok(`компетенция ${competency} L${level} записана`);}
    else {fail(`competency → ${r.status}: ${JSON.stringify(r.data)}`);}
  }

  // 2. Задачи формируют спрос.
  for (const comp of [compA, compA, compB]) {
    const t = await req('POST', '/tasks', {
      direction_id: dir.id,
      description: `Ёмкость: ${comp}`,
      priority: 'standard',
      required_competencies: [comp],
    });
    if (t.status !== 201) {fail(`task(${comp}) → ${t.status}`);}
  }

  const cap1 = await req<{
    rows: Array<{ competency: string; needed: number; available: number; gap: number }>;
    totals: { needed: number; available: number; gap: number };
  }>('GET', `/capacity?direction_id=${dir.id}`);
  if (cap1.status === 200) {
    const parser = cap1.data.rows.find((r) => r.competency === compA);
    const runtime = cap1.data.rows.find((r) => r.competency === compB);
    if (parser?.needed === 2 && parser.available === 2 && runtime?.needed === 1 && runtime.available === 1) {
      ok('ёмкость: спрос 2+1, наличие 2+1, дефицита нет');
    } else {
      fail(`ёмкость неверна: ${JSON.stringify(cap1.data.rows)}`);
    }
  } else {
    fail(`GET /capacity → ${cap1.status}: ${JSON.stringify(cap1.data)}`);
  }

  // Третья parser-задача создаёт дефицит.
  await req('POST', '/tasks', {
    direction_id: dir.id,
    description: 'Ёмкость: parser 3',
    priority: 'standard',
    required_competencies: [compA],
  });
  const cap2 = await req<{ rows: Array<{ competency: string; gap: number }> }>(
    'GET', `/capacity?direction_id=${dir.id}`,
  );
  const parserGap = cap2.data.rows.find((r) => r.competency === compA)?.gap;
  if (parserGap === 1) {ok('дефицит parser = 1 (3 нужно / 2 есть)');}
  else {fail(`дефицит parser = ${parserGap}, ожидали 1`);}

  // 3. Ячейка и готовность.
  const cell = await req<{ id: string }>('POST', '/cells', {
    level: 0,
    number: `C${String(Date.now()).slice(-5)}`,
    direction_id: dir.id,
    profile: 'capacity-test',
  });
  if (cell.status !== 201) {fail(`cell → ${cell.status}: ${JSON.stringify(cell.data)}`); return;}

  await req('POST', `/cells/${cell.data.id}/members`, {
    participant_id: workers[0]!, role_in_cell: 'coordinator',
  });

  const early = await req<{
    ready: boolean;
    checks: Array<{ id: string; passed: boolean }>;
  }>('GET', `/cells/${cell.data.id}/readiness`);
  const issueIds = early.data.checks.filter((c) => !c.passed).map((c) => c.id);
  if (early.status === 200 && early.data.ready === false
      && issueIds.includes('staffed') && issueIds.includes('plan')) {
    ok('неготовая ячейка: нет состава и плана');
  } else {
    fail(`readiness early → ${early.status}: ${JSON.stringify(early.data)}`);
  }

  // Доукомплектуем: координатор + ОТК + трое исполнителей.
  await req('POST', `/cells/${cell.data.id}/members`, {
    participant_id: workers[1]!, role_in_cell: 'otc',
  });
  for (const pid of workers.slice(2)) {
    await req('POST', `/cells/${cell.data.id}/members`, { participant_id: pid });
  }

  const plan = await req<{ id: string }>('POST', '/plans', {
    type: 'standard',
    title: 'План ячейки (ёмкость)',
    expected_result: 'Готовность',
    lead_direction_id: dir.id,
    cell_id: cell.data.id,
  });
  if (plan.status !== 201) {fail(`plan → ${plan.status}: ${JSON.stringify(plan.data)}`);}

  // План должен быть активным, иначе ячейка не готова.
  await query(`UPDATE plans SET status = 'in_progress' WHERE id = $1`, [plan.data.id]);

  const ready = await req<{
    ready: boolean;
    checks: Array<{ id: string; passed: boolean }>;
  }>('GET', `/cells/${cell.data.id}/readiness`);
  if (ready.status === 200 && ready.data.ready === true) {
    ok('ячейка готова: состав, координатор, ОТК, план');
  } else {
    fail(`readiness → ${ready.status}: ${JSON.stringify(ready.data)}`);
  }

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
