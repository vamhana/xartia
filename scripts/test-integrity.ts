// scripts/test-integrity.ts
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  signAll,
  verifyFile,
  monitorFiles,
  getActiveAlerts,
  markHandled,
  getStats,
} from '../src/security/integrity.js';

const TARGET = 'src/core/constants.ts';

function ok(m: string) {
  console.log(`  ✓ ${m}`);
}
function fail(m: string) {
  console.error(`  ✗ ${m}`);
  process.exitCode = 1;
}

async function main() {
  console.log('▶ S.0.01.08 integrity smoke test\n');

  // 1. signAll
  const { signed } = await signAll();
  console.log(`  signed: ${signed}`);
  if (signed > 0) {ok('signAll');}
  else {fail('signAll вернул 0');}

  // 2. verifyFile на неизменённом файле
  const v1 = await verifyFile(TARGET);
  if (v1.valid) {ok(`verifyFile(${TARGET}) → valid`);}
  else {fail(`verifyFile → ${v1.reason}`);}

  // 3. Tamper: читаем → модифицируем → проверяем → восстанавливаем
  const abs = resolve(process.cwd(), TARGET);
  const original = await readFile(abs, 'utf8');
  try {
    await writeFile(abs, original + '\n// tampered by test\n', 'utf8');
    const v2 = await verifyFile(TARGET);
    if (!v2.valid && v2.reason === 'modified') {ok('tamper detected');}
    else {fail(`tamper NOT detected (reason=${v2.reason})`);}
  } finally {
    await writeFile(abs, original, 'utf8');
  }

  // 4. monitorFiles
  const mon = await monitorFiles();
  console.log(`  scanned: ${mon.scanned}, alerts: ${mon.alerts.length}`);
  if (mon.scanned > 0) {ok('monitorFiles');}

  // 5. getActiveAlerts
  const active = await getActiveAlerts();
  console.log(`  active alerts: ${active.length}`);
  ok('getActiveAlerts');

  // 6. markHandled
  if (active.length > 0) {
    const first = active[0]!;
    await markHandled(first.id, 'test resolution', first.id);
    const after = await getActiveAlerts();
    if (after.find((a) => a.id === first.id) === undefined) {
      ok('markHandled');
    } else {
      fail('markHandled: alert всё ещё active');
    }
  }

  // 7. getStats
  const stats = await getStats();
  console.log(`  stats: ${JSON.stringify(stats)}`);
  ok('getStats');

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());