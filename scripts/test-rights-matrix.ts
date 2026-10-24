// scripts/test-rights-matrix.ts
import 'dotenv/config';
import {
  checkRight,
  invalidateRightsMatrixCache,
} from '../src/core/rights.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { loadWsEnv } from './lib/ws-env.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

function ok(m: string) { console.log(`  ✓ ${m}`); }
function fail(m: string) { console.error(`  ✗ ${m}`); process.exitCode = 1; }

async function main() {
  console.log('▶ C.0.01.06 rights_matrix smoke test\n');

  const env = await loadWsEnv();
  const pid = env.participantId;

  // 1. Матрица из БД должна быть засеяна
  const cnt = await redis.del('rights:matrix:v1');
  console.log(`  cleared cache: ${cnt} key(s)\n`);

  // 2. Архитектор имеет wildcard '*'
  const r1 = await checkRight({
    participantId: pid,
    resource: 'good',
    action: 'D',
  });
  console.log(`  architect good:D → ${r1.allowed} (${r1.reason})`);
  if (r1.allowed) {ok('FIRST_ARCHITECT wildcard * → allowed');}
  else {fail('FIRST_ARCHITECT должен иметь wildcard');}

  const r2 = await checkRight({
    participantId: pid,
    resource: 'standard',
    action: 'C',
  });
  console.log(`  architect standard:C → ${r2.allowed}`);
  if (r2.allowed) {ok('FIRST_ARCHITECT standard:C');}
  else {fail('FIRST_ARCHITECT должен уметь создавать стандарт');}

  const r3 = await checkRight({
    participantId: pid,
    resource: 'audit',
    action: 'C',
  });
  console.log(`  architect audit:C → ${r3.allowed}`);
  if (r3.allowed) {ok('FIRST_ARCHITECT audit:C');}
  else {fail('FIRST_ARCHITECT должен уметь создавать аудит');}

  const r4 = await checkRight({
    participantId: pid,
    resource: 'archive',
    action: 'S',
  });
  console.log(`  architect archive:S → ${r4.allowed}`);
  if (r4.allowed) {ok('FIRST_ARCHITECT archive:S');}
  else {fail('FIRST_ARCHITECT должен подписывать архив');}

  const r5 = await checkRight({
    participantId: pid,
    resource: 'any_nonexistent_resource',
    action: 'V',
  });
  console.log(`  architect fake_resource:V → ${r5.allowed}`);
  if (r5.allowed) {ok('FIRST_ARCHITECT wildcard работает для любого ресурса');}
  else {fail('FIRST_ARCHITECT wildcard должен покрывать все ресурсы');}

  // 3. Проверка кэша
  const beforeCache = await redis.get('rights:matrix:v1');
  if (beforeCache) {ok('кэш rights:matrix:v1 заполнен после checkRight');}
  else {fail('кэш не заполнился');}

  await invalidateRightsMatrixCache();
  const afterInvalidate = await redis.get('rights:matrix:v1');
  if (!afterInvalidate) {ok('invalidateRightsMatrixCache очистил кэш');}
  else {fail('кэш не сбросился');}

  // 4. Проверка через API — requireRight на /goods
  console.log('');
  const res = await fetch(`${BASE}/goods`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `RIGHTS-TEST: ${Date.now()}`,
      type: 'material',
      producer_direction_id: env.directionId,
    }),
  });
  console.log(`  POST /goods → ${res.status}`);
  if (res.status === 201) {ok('requireRight("good","C") пропустил Архитектора');}
  else if (res.status === 403) {
    // У Архитектора wildcard — должно быть 201
    fail('Архитектор получил 403 — матрица не читается');
  } else {
    console.log(`  body: ${(await res.text()).slice(0, 200)}`);
  }

  // 5. Direct-check: несуществующий участник
  const fakeUuid = crypto.randomUUID();
  const r6 = await checkRight({
    participantId: fakeUuid,
    resource: 'good',
    action: 'C',
  });
  console.log(`  unknown participant good:C → ${r6.allowed}`);
  if (!r6.allowed) {ok('несуществующий участник получает deny');}
  else {fail('несуществующий участник не должен иметь прав');}

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());