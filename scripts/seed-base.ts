// scripts/seed-base.ts
// Доборка справочников после bootstrap Архитектора (C.0.35.02).
//
// Зачем отдельный шаг: миграции создают схему и панели, но библиотека
// виджетов требует существующего участника (017_seed_widgets). Поэтому на
// чистой базе после `ensure-architect` нужно явно вызвать POST /admin/seed —
// иначе виджеты, роли ASSOCIATED и содержимое панелей не появятся.
//
// Идемпотентно: повторный запуск возвращает нули, ничего не дублируя.
//
// Запуск: pnpm tsx scripts/seed-base.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

interface SeedResult {
  templates: Record<string, number>;
  totalInserted: number;
}

async function main(): Promise<void> {
  console.log('▶ Базовые справочники (admin/seed)\n');

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (!login.ok) {
    console.error(`   ✗ login → ${login.status}`);
    process.exitCode = 1;
    return;
  }
  const auth = await login.json() as { access_token: string };

  const res = await fetch(`${BASE}/admin/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.access_token}`,
    },
    body: JSON.stringify({ templates: ['all'] }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`   ✗ seed → ${res.status}: ${text}`);
    process.exitCode = 1;
    return;
  }

  const result = JSON.parse(text) as SeedResult;
  for (const [name, count] of Object.entries(result.templates)) {
    if (name === 'all') {continue;}
    console.log(`   · ${name}: ${count}`);
  }
  console.log(`   ✓ всего добавлено: ${result.totalInserted}`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
