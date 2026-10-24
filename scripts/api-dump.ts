// Быстрый API-дампер для проверки ответов backend в консоли.
// Читает токен из .ws-test-env.json, дёргает указанный путь, печатает JSON.
//
// Использование:
//   pnpm tsx scripts/api-dump.ts /tasks/my
//   pnpm tsx scripts/api-dump.ts "/daily-plans?direction_id=43cf..."

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Использование: pnpm tsx scripts/api-dump.ts <path>');
    process.exit(1);
  }

  const envFile = resolve(process.cwd(), '.ws-test-env.json');
  let token: string;
  try {
    const raw = await readFile(envFile, 'utf8');
    const data = JSON.parse(raw) as { WS_TEST_TOKEN: string };
    token = data.WS_TEST_TOKEN;
  } catch {
    console.error('Нет .ws-test-env.json. Запусти: pnpm tsx scripts/get-test-token.ts');
    process.exit(1);
  }

  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  console.log(`▶ ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log(`◀ ${res.status} ${res.statusText}`);
  const text = await res.text();
  try {
    const json = JSON.parse(text) as unknown;
    // Компактно для больших массивов.
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(text);
  }
}

main()
  .then(() => gracefulShutdown())
  .catch(async (e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    try { await gracefulShutdown(); } catch { /* ignore */ }
    process.exit(1);
  });