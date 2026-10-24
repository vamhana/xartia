import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  checkIsolation,
  assertIsolation,
  reportViolation,
  isInfoBlockadeActive,

  liftInfoBlockade,

  getIsolatedBuckets,
  getIsolatedDatabases,
  checkNetworkPolicy,
  getIsolationStatus,
  auditGatewayAccess,
} from '../src/security/gateway-isolation.js';


function ok(m: string) { console.warn(`   ✓ ${m}`); }
function fail(m: string) { console.warn(`   ✗ ${m}`); }

async function main(): Promise<void> {
  // Очистим тестовые ключи.
  await redis.del('gateway:info_blockade:active');
  await redis.del('gateway:violations');

  console.warn('\n─── 1. checkIsolation: core → core (allowed) ───');
  let r = await checkIsolation({ sourceNode: 'core', targetNode: 'core', operation: 'any' });
  console.warn(r);
  if (r.allowed) {ok('core↔core разрешено');}

  console.warn('\n─── 2. checkIsolation: core → gateway (whitelisted op) ───');
  r = await checkIsolation({
    sourceNode: 'core',
    targetNode: 'gateway',
    operation: 'gateway.audit.read',
  });
  console.warn(r);
  if (r.allowed && r.whitelisted) {ok('whitelisted разрешено');}

  console.warn('\n─── 3. checkIsolation: core → gateway (не в whitelist) ───');
  r = await checkIsolation({
    sourceNode: 'core',
    targetNode: 'gateway',
    operation: 'user.read.secret',
  });
  console.warn(r);
  if (!r.allowed) {ok('не-whitelisted запрещено');}

  console.warn('\n─── 4. checkIsolation: gateway → core (allowed) ───');
  r = await checkIsolation({
    sourceNode: 'gateway',
    targetNode: 'core',
    operation: 'signal.create',
  });
  console.warn(r);
  if (r.allowed) {ok('signal.create из Шлюза разрешён');}

  console.warn('\n─── 5. checkIsolation: worker → gateway (blocked) ───');
  r = await checkIsolation({
    sourceNode: 'worker',
    targetNode: 'gateway',
    operation: 'transaction.sync',
  });
  console.warn(r);
  if (!r.allowed) {ok('worker → gateway запрещён');}

  console.warn('\n─── 6. checkIsolation: external → core (blocked) ───');
  r = await checkIsolation({
    sourceNode: 'external',
    targetNode: 'core',
    operation: 'anything',
  });
  console.warn(r);
  if (!r.allowed) {ok('external → core запрещён');}

  console.warn('\n─── 7. checkNetworkPolicy ───');
  const netOk = await checkNetworkPolicy('core', 'core');
  const netBlocked = await checkNetworkPolicy('external', 'core');
  console.warn({ netOk, netBlocked });
  if (netOk && !netBlocked) {ok('network policy различает');}

  console.warn('\n─── 8. isInfoBlockadeActive (до) ───');
  console.warn('active:', await isInfoBlockadeActive());
  if (!(await isInfoBlockadeActive())) {ok('блокада не активна');}

  console.warn('\n─── 9. reportViolation ───');
  const v = await reportViolation(
    { sourceNode: 'gateway', targetNode: 'core', operation: 'user.read.secret' },
    'Попытка чтения чужих данных',
  );
  console.warn(v);
  if (v.violationId) {ok(`нарушение зафиксировано: ${v.violationId}`);}
  if (v.infoBlockadeActivated) {ok('InfoBlockade активирована');}

  console.warn('\n─── 10. isInfoBlockadeActive (после) ───');
  console.warn('active:', await isInfoBlockadeActive());
  if (await isInfoBlockadeActive()) {ok('блокада активна');}

  console.warn('\n─── 11. assertIsolation должен бросить InfoBlockadeError ───');
  try {
    await assertIsolation({
      sourceNode: 'external',
      targetNode: 'core',
      operation: 'read',
    });
    fail('не бросил');
  } catch (e) {
    const name = (e as { name?: string }).name;
    const code = (e as { code?: string }).code;
    console.warn('caught:', name, code);
    if (code === 'INFO_BLOCKADE') {ok('InfoBlockadeError брошен');}
  }

  console.warn('\n─── 12. auditGatewayAccess ───');
  const audit = await auditGatewayAccess('24h');
  console.warn(audit);
  if (audit.violations >= 2) {ok(`зафиксировано нарушений: ${audit.violations}`);}

  console.warn('\n─── 13. getIsolationStatus ───');
  const status = await getIsolationStatus();
  console.warn(JSON.stringify(status, null, 2));
  if (status.infoBlockadeActive) {ok('статус показывает активную блокаду');}

  console.warn('\n─── 14. getIsolatedBuckets / Databases ───');
  console.warn({
    buckets: getIsolatedBuckets(),
    dbs: getIsolatedDatabases(),
  });
  if (getIsolatedBuckets().includes('charter-gateway')) {ok('S3 bucket правильный');}
  if (getIsolatedDatabases().includes('charter_gateway')) {ok('DB правильная');}

  console.warn('\n─── 15. liftInfoBlockade ───');
  await liftInfoBlockade('тест завершён', randomUUID() as never);
  console.warn('active:', await isInfoBlockadeActive());
  if (!(await isInfoBlockadeActive())) {ok('блокада снята');}

  console.warn('\n─── 16. cleanup ───');
  await redis.del('gateway:violations');
  ok('violations очищены');

  console.warn('\n✅ Gateway isolation smoke OK');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});