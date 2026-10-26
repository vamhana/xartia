// scripts/test-plan-versions.ts
// Версионирование плана: v1 при создании, новая версия, восстановление.
//
// Запуск: pnpm tsx scripts/test-plan-versions.ts <phone> <password>

import 'dotenv/config';

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

async function main(): Promise<void> {
  console.log('▶ Версионирование плана\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const dirId = login.data.participant.direction_id;

  const plan = await req<{ id: string; title: string }>('POST', '/plans', {
    type: 'standard',
    title: 'План v1',
    expected_result: 'Первый результат',
    lead_direction_id: dirId,
  });
  if (plan.status !== 201) {fail(`plan → ${plan.status}: ${JSON.stringify(plan.data)}`); return;}
  const planId = plan.data.id;

  const v1 = await req<{ data: Array<{ version: number; reason: string }> }>(
    'GET', `/plans/${planId}/versions`,
  );
  if (v1.status === 200 && v1.data.data.length === 1 && v1.data.data[0]?.version === 1) {
    ok('При создании записана v1');
  } else {
    fail(`v1 → ${v1.status}: ${JSON.stringify(v1.data)}`);
  }

  const v2 = await req<{ version: number }>('POST', `/plans/${planId}/versions`, {
    reason: 'Уточнили результат по итогам прогона',
    patch: { title: 'План v2', expected_result: 'Второй результат' },
  });
  if (v2.status === 201 && v2.data.version === 2) {ok('Создана v2 с патчем');}
  else {fail(`v2 → ${v2.status}: ${JSON.stringify(v2.data)}`);}

  const current = await req<{ title: string; expectedResult: string }>('GET', `/plans/${planId}`);
  if (current.data.title === 'План v2' && current.data.expectedResult === 'Второй результат') {
    ok('План обновлён до v2');
  } else {
    fail(`текущий план: ${JSON.stringify(current.data)}`);
  }

  // Восстановление v1 как новой версии.
  const restored = await req<{ version: number; snapshot: { title?: string } }>(
    'POST', `/plans/${planId}/versions/1/restore`, { reason: 'Возврат к первому варианту' },
  );
  if (restored.status === 201 && restored.data.version === 3
      && restored.data.snapshot.title === 'План v1') {
    ok('v1 восстановлена как v3');
  } else {
    fail(`restore → ${restored.status}: ${JSON.stringify(restored.data)}`);
  }

  const after = await req<{ title: string }>('GET', `/plans/${planId}`);
  if (after.data.title === 'План v1') {ok('Текущий план = v1');}
  else {fail(`после restore title=${after.data.title}`);}

  const list = await req<{ data: Array<{ version: number }> }>('GET', `/plans/${planId}/versions`);
  const versions = list.data.data.map((v) => v.version);
  if (versions.join(',') === '3,2,1') {ok('История версий: 3, 2, 1');}
  else {fail(`история: ${versions.join(',')}`);}

  const short = await req('POST', `/plans/${planId}/versions`, { reason: 'мало' });
  if (short.status === 422 || short.status === 400) {ok('Короткая причина отклонена');}
  else {fail(`short reason → ${short.status}`);}

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
