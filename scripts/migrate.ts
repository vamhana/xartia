// scripts/migrate.ts — идемпотентный раннер миграций.
//
// Использование:
//   pnpm db:migrate               — применить все неприменённые
//   pnpm db:migrate -- --dry-run  — показать, что будет применено
//   pnpm db:migrate -- 005        — применить начиная с 005 (включительно)
//
// Учёт применённых версий — в таблице schema_migrations.
// Каждая миграция — в отдельной транзакции.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { loadEnvIfNeeded } from './_env.js';

const log = {
  info: (m: string) => console.log(m),
  ok:   (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`),
  skip: (m: string) => console.log(`  \x1b[90m·\x1b[0m ${m}`),
  warn: (m: string) => console.warn(`  \x1b[33m!\x1b[0m ${m}`),
  err:  (m: string) => console.error(`  \x1b[31m✗\x1b[0m ${m}`),
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const fromArg = argv.find((a) => /^\d{3}$/.test(a));

  await loadEnvIfNeeded();

  const url = process.env.DATABASE_URL;
  if (!url) {
    log.err('DATABASE_URL не задан ни в окружении, ни в .env');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'db', 'migrations');

  const allFiles = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (allFiles.length === 0) {
    log.err(`Не найдено .sql в ${dir}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.version));

    let startIdx = 0;
    if (fromArg) {
      const idx = allFiles.findIndex((f) => f.startsWith(fromArg));
      if (idx === -1) {
        log.err(`Версия "${fromArg}" не найдена среди файлов`);
        process.exit(1);
      }
      startIdx = idx;
    }

    const relevant = allFiles.slice(startIdx);
    const pending = relevant.filter((f) => !applied.has(f));

    log.info(
      `Миграции: ${allFiles.length} всего, ${applied.size} применено, ` +
        `${pending.length} в очереди`,
    );

    if (dryRun) {
      for (const f of pending) {log.info(`  → ${f}`);}
      return;
    }
    if (pending.length === 0) {
      log.ok('Нет неприменённых миграций');
      return;
    }

    let done = 0;
    for (const file of relevant) {
      if (applied.has(file)) {
        log.skip(`${file} (уже применена)`);
        continue;
      }
      const sql = await readFile(join(dir, file), 'utf8');
      process.stdout.write(`  → ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(version) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        process.stdout.write('\x1b[32mok\x1b[0m\n');
        done++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        process.stdout.write('\x1b[31mFAIL\x1b[0m\n');
        const msg = e instanceof Error ? e.message : String(e);
        log.err(msg);

        // Особый случай — 017 при отсутствии participant
        if (file.includes('017') && /Нет активных участников/.test(msg)) {
          log.warn(
            'Сначала запусти bootstrap-architect (I.9.02.02), затем повтори db:migrate',
          );
        }
        process.exit(1);
      }
    }

    log.info('');
    log.ok(`Готово. Применено в этот прогон: ${done}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});