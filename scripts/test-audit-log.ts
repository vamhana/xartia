import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  logAction,
  withAudit,
  listEntries,
  countEntries,
  exportEntries,
  getQueueSize,
  flush,
  healthCheck,
} from '../src/security/audit-log.js';

const MARKER = 'AUDIT-TEST:';

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

async function main(): Promise<void> {
  const systemId = randomUUID() as never;

  console.log('\n─── 1. healthCheck ───');
  const h = await healthCheck();
  console.log(h);
  if (h.writable) {ok('audit_log доступен для записи');}

  console.log('\n─── 2. logAction (×3) ───');
  const entityId = randomUUID();
  for (let i = 0; i < 3; i++) {
    await logAction({
      actorId: systemId,
      actorType: 'system',
      action: `${MARKER}do_something`,
      entityType: 'test_entity',
      entityId,
      newValue: { iteration: i, marker: MARKER },
    });
  }
  console.log('queueSize:', getQueueSize());
  await flush();
  console.log('after flush, queueSize:', getQueueSize());
  ok('записи отправлены');

  console.log('\n─── 3. withAudit ───');
  await withAudit(
    `${MARKER}with_audit`,
    'test_entity',
    async () => ({ result: 'ok' }),
    {
      actorId: systemId,
      entityId,
      newValue: { kind: 'withAudit' },
    },
  );
  await flush();
  ok('withAudit выполнен');

  console.log('\n─── 4. listEntries (по action) ───');
  const list = await listEntries({
    action: `${MARKER}do_something`,
    perPage: 10,
  });
  console.log({ count: list.data.length, total: list.total });
  if (list.total === 3) {ok('найдено 3 записи');}

  console.log('\n─── 5. listEntries (по entityId) ───');
  const byEntity = await listEntries({ entityId, perPage: 100 });
  console.log({ count: byEntity.data.length, total: byEntity.total });
  if (byEntity.total >= 4) {ok(`найдено >= 4 записи для entity`);}

  console.log('\n─── 6. countEntries ───');
  const cnt = await countEntries({ action: `${MARKER}do_something` });
  console.log('count:', cnt);
  if (cnt === 3) {ok('countEntries корректно');}

  console.log('\n─── 7. exportEntries (JSON) ───');
  const jsonExp = await exportEntries({ action: `${MARKER}do_something` }, 'json');
  console.log({
    key: jsonExp.key,
    rows: jsonExp.rows,
    bytes: jsonExp.bytes,
    urlPrefix: jsonExp.url.slice(0, 60) + '...',
  });
  if (jsonExp.rows === 3) {ok('JSON экспорт: 3 строки');}
  if (jsonExp.bytes > 0) {ok(`JSON файл: ${jsonExp.bytes} байт`);}

  console.log('\n─── 8. exportEntries (CSV) ───');
  const csvExp = await exportEntries({ action: `${MARKER}do_something` }, 'csv');
  console.log({
    key: csvExp.key,
    rows: csvExp.rows,
    bytes: csvExp.bytes,
  });
  if (csvExp.format === 'csv') {ok('CSV экспорт готов');}

  console.log('\n─── 9. exportEntries: пустой результат → 404 ───');
  try {
    await exportEntries({ action: `${MARKER}nonexistent` }, 'json');
    fail('не бросил 404');
  } catch (e) {
    const code = (e as { code?: string }).code;
    console.log('caught code:', code);
    if (code === 'NOT_FOUND') {ok('404 при пустом результате');}
  }

  console.log('\n─── 10. immutability: DELETE отклонён триггером ───');
  const { query } = await import('../src/lib/db.js');
  try {
    await query(
      `DELETE FROM audit_log WHERE action LIKE $1`,
      [`${MARKER}%`],
    );
    fail('триггер не сработал — DELETE прошёл!');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('caught:', msg);
    if (msg.includes('immutable')) {
      ok('audit_log защищён триггером — DELETE отклонён');
    } else {
      fail(`неожиданная ошибка: ${msg}`);
    }
  }

  console.log('\n─── 11. immutability: UPDATE отклонён триггером ───');
  try {
    await query(
      `UPDATE audit_log SET reason = 'tampered' WHERE action LIKE $1`,
      [`${MARKER}%`],
    );
    fail('триггер не сработал — UPDATE прошёл!');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('caught:', msg);
    if (msg.includes('immutable')) {
      ok('audit_log защищён триггером — UPDATE отклонён');
    } else {
      fail(`неожиданная ошибка: ${msg}`);
    }
  }

  console.log('\n─── 12. cleanup: помечаем как оставленные ───');
  console.log(`   ℹ️  Тестовые записи (${MARKER}*) остаются в audit_log.`);
  console.log(`   ℹ️  Retention: партиция audit_log_2026_10 уйдёт в архив через год.`);
  ok('cleanup намеренно пропущен — audit_log append-only');

  console.log('\n✅ Audit-log smoke OK');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});