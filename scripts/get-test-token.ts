// Получает токен через /auth/login и сохраняет в .ws-test-env.json.
// Тестовые WS-скрипты читают токен из env или из этого файла.

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const ENV_FILE = resolve(process.cwd(), '.ws-test-env.json');

const phone = process.argv[2]
  ?? process.env['ARCHITECT_PHONE']
  ?? '+79000000000';
const password = process.argv[3]
  ?? process.env['ARCHITECT_PASSWORD']
  ?? 'ChangeMe123456';

async function main(): Promise<void> {
  console.log(`▶ API: ${BASE}/auth/login`);
  console.log(`▶ Участник: ${phone}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('');
    console.error('❌ Не удалось подключиться к API.');
    console.error(`   URL:    ${BASE}`);
    console.error(`   Ошибка: ${msg}`);
    console.error('');
    console.error('   Проверь, что API запущен: pnpm dev (в отдельном окне)');
    console.error('   Проверь: curl http://localhost:3000/health');
    process.exit(1);
  }

  if (!res.ok) {
    console.error('');
    console.error(`❌ login failed: HTTP ${res.status}`);
    console.error('   Ответ:', await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    participant: { id: string; direction_id: string; name: string; external_id: string };
  };

  const env = {
    WS_TEST_TOKEN: data.access_token,
    WS_TEST_PID: data.participant.id,
    WS_TEST_DIR: data.participant.direction_id,
    WS_TEST_NAME: data.participant.name,
    WS_TEST_EXTERNAL_ID: data.participant.external_id,
    WS_TEST_EXPIRES_AT: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    WS_TEST_CREATED_AT: new Date().toISOString(),
  };

  await writeFile(ENV_FILE, JSON.stringify(env, null, 2), 'utf8');

  console.log('');
  console.log('✅ Токен сохранён в .ws-test-env.json');
  console.log(`   Участник:     ${env.WS_TEST_NAME} (${env.WS_TEST_EXTERNAL_ID})`);
  console.log(`   PID:          ${env.WS_TEST_PID}`);
  console.log(`   Direction:    ${env.WS_TEST_DIR}`);
  console.log(`   Действует до: ${env.WS_TEST_EXPIRES_AT}`);
  console.log('');
  console.log('Теперь можно запускать WS-тесты без set-команд:');
  console.log('   pnpm tsx scripts/test-ws-crisis.ts');
  console.log('   pnpm tsx scripts/test-ws-regimes.ts');
  console.log('   pnpm tsx scripts/test-ws-notifications.ts');
  console.log('   pnpm tsx scripts/test-ws-tasks.ts');
  console.log('   pnpm tsx scripts/test-ws-signals.ts');
  console.log('   pnpm tsx scripts/test-ws-otc.ts');
}

main()
  .then(() => gracefulShutdown())
  .catch(async (e) => {
    console.error('');
    console.error('❌ Fatal:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {
      console.error(e.stack.split('\n').slice(0, 5).join('\n'));
    }
    try { await gracefulShutdown(); } catch { /* ignore */ }
    process.exit(1);
  });