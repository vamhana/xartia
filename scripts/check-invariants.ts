// scripts/check-invariants.ts
// Проверка реестра инвариантов: у каждого есть существующий тест.
//
// Запуск: pnpm tsx scripts/check-invariants.ts

import 'dotenv/config';

import { existsSync } from 'node:fs';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const REQUIRED = 12;

async function main(): Promise<void> {
  console.log('▶ Проверка реестра инвариантов\n');

  const rows = await query<{ id: string; test_path: string; statement: string }>(
    `SELECT id, test_path, statement FROM invariants WHERE status = 'active' ORDER BY id`,
  );

  if (rows.length < REQUIRED) {
    console.error(`   ✗ инвариантов ${rows.length}, ожидалось минимум ${REQUIRED}`);
    process.exitCode = 1;
  } else {
    console.log(`   ✓ инвариантов: ${rows.length}`);
  }

  let missing = 0;
  for (const row of rows) {
    if (!existsSync(row.test_path)) {
      missing += 1;
      console.error(`   ✗ ${row.id}: нет файла ${row.test_path}`);
    }
  }
  if (missing === 0) {console.log('   ✓ у каждого инварианта существует тест');}
  else {process.exitCode = 1;}

  const untested = rows.filter((r) => !r.statement.trim());
  if (untested.length > 0) {
    console.error(`   ✗ пустые формулировки: ${untested.map((r) => r.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('   ✓ формулировки заполнены');
  }

  console.log(process.exitCode ? '\n❌ есть проблемы' : '\n✅ реестр в порядке');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
