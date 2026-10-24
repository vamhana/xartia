// scripts/reset.ts — DANGEROUS.
// Дропает public-схему и заново накатывает все миграции.
// Использовать только на dev.

import { spawn } from 'node:child_process';

import { Client } from 'pg';

import { loadEnvIfNeeded } from './_env.js';

async function main(): Promise<void> {
  await loadEnvIfNeeded();
  const url = process.env.DATABASE_URL;
  if (!url) {throw new Error('DATABASE_URL не задан');}

  if (process.env.CONFIRM_RESET !== 'yes') {
    console.error(
      'Отказ: установите CONFIRM_RESET=yes, чтобы действительно сбросить БД',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log('  → DROP SCHEMA public CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    console.log('  → CREATE SCHEMA public');
    await client.query('CREATE SCHEMA public');
    // Восстанавливаем дефолтные гранты (иначе миграции не пройдут под non-superuser)
    await client.query('GRANT ALL ON SCHEMA public TO public');
  } finally {
    await client.end();
  }

  console.log('  → migrate');
  const child = spawn(
    process.execPath.includes('node') ? 'npx' : 'pnpm',
    ['tsx', 'scripts/migrate.ts'],
    { stdio: 'inherit' },
  );
  await new Promise<void>((resolve, reject) => {
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`migrate exited ${code}`)),
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});