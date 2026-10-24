// scripts/test-public.ts
// Smoke-тест публичной витрины (A.1.38.01): GET /public/overview без токена.
//
// Запуск: pnpm tsx scripts/test-public.ts
// Проверяет: 200 без авторизации, все поля — числа, персональных данных нет.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Overview {
  people?: unknown;
  directions?: unknown;
  tasksInWork?: unknown;
  tasksAccepted?: unknown;
  reportsSubmitted?: unknown;
}

function ok(msg: string): void {
  console.log(`   ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`   ✗ ${msg}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log('▶ Витрина: GET /public/overview без авторизации\n');

  const res = await fetch(`${BASE}/public/overview`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as Overview;
  console.log(`   status: ${res.status}, body: ${JSON.stringify(body)}`);

  if (res.status === 200) { ok('доступно без токена'); }
  else { fail(`GET /public/overview → ${res.status}`); return; }

  for (const key of ['people', 'directions', 'tasksInWork', 'tasksAccepted', 'reportsSubmitted'] as const) {
    if (typeof body[key] === 'number') { ok(`${key}: ${body[key]}`); }
    else { fail(`${key} не число`); }
  }

  if (body.directions === 17) { ok('17 направлений'); }
  else { fail(`directions=${body.directions}, ожидалось 17`); }

  // На витрине не должно быть персональных данных — только агрегаты.
  const raw = JSON.stringify(body);
  if (/phone|name|messenger|email/i.test(raw)) { fail('в ответе есть персональные поля'); }
  else { ok('только агрегаты, персональных полей нет'); }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
