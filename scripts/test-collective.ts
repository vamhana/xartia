// scripts/test-collective.ts
// Smoke-тест экрана «Коллектив» (A.1.40.01): GET /collective.
//
// Запуск: pnpm tsx scripts/test-collective.ts <phone> <password>
// Без аргументов берёт ARCHITECT_PHONE / ARCHITECT_PASSWORD.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

interface Overview {
  totals?: {
    people?: number;
    directions?: number;
    tasksInWork?: number;
    reportsWaitingOtc?: number;
  };
  people?: unknown[];
  directions?: unknown[];
  roles?: unknown[];
  activity?: unknown[];
  audit_id?: string;
}

function ok(msg: string): void {
  console.log(`   ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`   ✗ ${msg}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log('▶ Коллектив: GET /collective\n');

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!loginRes.ok) {
    fail(`login → ${loginRes.status}`);
    return;
  }
  const login = (await loginRes.json()) as { access_token: string };

  const res = await fetch(`${BASE}/collective`, {
    headers: { Authorization: `Bearer ${login.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as Overview;
  console.log(`   status: ${res.status}, totals: ${JSON.stringify(body.totals)}`);

  if (res.status === 200) { ok('GET /collective → 200'); }
  else { fail(`GET /collective → ${res.status}`); return; }

  if ((body.totals?.people ?? 0) > 0) { ok(`в коллективе ${body.totals?.people} участников`); }
  else { fail('в коллективе нет людей'); }

  // /collective отдаёт первых 200 человек, totals.people — всех.
  if (
    Array.isArray(body.people) &&
    body.people.length > 0 &&
    body.people.length <= (body.totals?.people ?? 0)
  ) {
    ok(`people: ${body.people.length} из ${body.totals?.people} (список ограничен 200)`);
  } else {
    fail('people не совпадает с totals.people');
  }

  if (Array.isArray(body.directions) && body.directions.length === 17) {
    ok('17 направлений');
  } else {
    fail(`направлений: ${body.directions?.length ?? 0}, ожидалось 17`);
  }

  if (Array.isArray(body.activity) && body.activity.length > 0) {
    ok(`лента событий: ${body.activity.length}`);
  } else {
    fail('лента событий пуста');
  }

  // Приватность: в ответе не должно быть телефонов и мессенджеров.
  const raw = JSON.stringify(body);
  if (/phone|messengers/i.test(raw)) { fail('в ответе есть персональные поля'); }
  else { ok('персональных полей нет'); }

  if (typeof body.audit_id === 'string' && body.audit_id.length > 0) { ok('audit_id есть'); }
  else { fail('audit_id отсутствует'); }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
