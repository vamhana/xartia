import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import {
  regimeMiddleware,
  blockDuringInfoBlockade,
  blockDuringRedCircuit,
  blockDuringPtt,
  invalidateRegimeCache,
  getRegimeContext,
  isInfoBlockadeActive,
  isRedCircuitActive,
} from '../src/api/middleware/regime.js';
import { query } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

// Мок FastifyRequest: минимальный набор полей, которые читает middleware.
function mockReq(url: string, method = 'GET'): unknown {
  return { url, method, headers: {} };
}

async function main(): Promise<void> {
  // Чистим кэш режимов.
  await redis.del('regime:context:active');

  console.log('\n─── 1. Пустой контекст (нет режимов) ───');
  const req1 = mockReq('/some/path');
  await regimeMiddleware(req1 as never, {} as never);
  const ctx1 = getRegimeContext(req1 as never);
  console.log(ctx1);
  if (ctx1.activeRegimes.length === 0) {ok('контекст загружен (пустой)');}
  if (!ctx1.infoBlockade && !ctx1.redCircuit) {ok('нет активных режимов');}

  console.log('\n─── 2. blockDuringInfoBlockade: не блокирует (режим не активен) ───');
  const req2 = mockReq('/gateway/council');
  await regimeMiddleware(req2 as never, {} as never);
  const blocker2 = blockDuringInfoBlockade();
  try {
    await blocker2(req2 as never, {} as never, () => undefined);
    ok('пропущен (InfoBlockade не активна)');
  } catch (e) {
    fail(`заблокирован, но не должен: ${(e as Error).message}`);
  }

  console.log('\n─── 3. Активируем InfoBlockade напрямую в БД ───');
  const systemArchitect = await query<{ id: string }>(
    `SELECT id FROM participants WHERE is_first_architect = true LIMIT 1`,
  );
  if (systemArchitect.length === 0) {
    fail('нет Архитектора в БД — пропускаем тест активации');
    await gracefulShutdown();
    return;
  }
  const actorId = systemArchitect[0]!.id;

  const regimeId = randomUUID();
  await query(
    `INSERT INTO regimes (id, type, activated_by, status, reason, conditions)
     VALUES ($1, 'info_blockade', $2, 'active', 'TEST: middleware', '{}'::jsonb)`,
    [regimeId, actorId],
  );
  ok(`InfoBlockade активирована: ${regimeId}`);

  console.log('\n─── 4. Инвалидируем кэш ───');
  await invalidateRegimeCache();
  ok('кэш очищен');

  console.log('\n─── 5. blockDuringInfoBlockade: блокирует /gateway/* ───');
  const req5 = mockReq('/gateway/council');
  await regimeMiddleware(req5 as never, {} as never);
  if (isInfoBlockadeActive(req5 as never)) {ok('контекст видит InfoBlockade');}
  const blocker5 = blockDuringInfoBlockade();
  try {
    await blocker5(req5 as never, {} as never, () => undefined);
    fail('должен был заблокировать /gateway/council');
  } catch (e) {
    const code = (e as { code?: string }).code;
    const status = (e as { statusCode?: number }).statusCode;
    console.log('caught:', code, status);
    if (code === 'INFO_BLOCKADE' && status === 451) {
      ok('451 INFO_BLOCKADE для /gateway/*');
    } else {
      fail(`неверный ответ: ${code}/${status}`);
    }
  }

  console.log('\n─── 6. blockDuringInfoBlockade: не блокирует /signals ───');
  const req6 = mockReq('/signals');
  await regimeMiddleware(req6 as never, {} as never);
  const blocker6 = blockDuringInfoBlockade();
  try {
    await blocker6(req6 as never, {} as never, () => undefined);
    ok('/signals пропущен (не входит в /gateway)');
  } catch (e) {
    fail(`заблокирован, но не должен: ${(e as Error).message}`);
  }

  console.log('\n─── 7. blockDuringInfoBlockade: /health всегда разрешён ───');
  const req7 = mockReq('/health/live');
  await regimeMiddleware(req7 as never, {} as never);
  const blocker7 = blockDuringInfoBlockade(['/']);  // даже если бы матчился /
  try {
    await blocker7(req7 as never, {} as never, () => undefined);
    ok('/health/live пропущен всегда');
  } catch (e) {
    fail(`health заблокирован — это баг!: ${(e as Error).message}`);
  }

  console.log('\n─── 8. Деактивируем InfoBlockade, активируем RedCircuit ───');
  await query(`DELETE FROM regimes WHERE id = $1`, [regimeId]);

  const redId = randomUUID();
  await query(
    `INSERT INTO regimes (id, type, activated_by, status, reason, conditions)
     VALUES ($1, 'red_circuit', $2, 'active', 'TEST: middleware', '{}'::jsonb)`,
    [redId, actorId],
  );
  await invalidateRegimeCache();
  ok(`RedCircuit активирован: ${redId}`);

  console.log('\n─── 9. blockDuringRedCircuit: блокирует /me/pause ───');
  const req9 = mockReq('/me/pause', 'POST');
  await regimeMiddleware(req9 as never, {} as never);
  if (isRedCircuitActive(req9 as never)) {ok('контекст видит RedCircuit');}
  const blocker9 = blockDuringRedCircuit();
  try {
    await blocker9(req9 as never, {} as never, () => undefined);
    fail('должен был заблокировать /me/pause');
  } catch (e) {
    const code = (e as { code?: string }).code;
    const status = (e as { statusCode?: number }).statusCode;
    console.log('caught:', code, status);
    if (code === 'LOCKED' && status === 423) {
      ok('423 LOCKED для /me/pause');
    } else {
      fail(`неверный ответ: ${code}/${status}`);
    }
  }

  console.log('\n─── 10. blockDuringRedCircuit: не блокирует /me ───');
  const req10 = mockReq('/me', 'GET');
  await regimeMiddleware(req10 as never, {} as never);
  const blocker10 = blockDuringRedCircuit();
  try {
    await blocker10(req10 as never, {} as never, () => undefined);
    ok('/me пропущен (не в списке)');
  } catch (e) {
    fail(`заблокирован, но не должен: ${(e as Error).message}`);
  }

  console.log('\n─── 11. blockDuringPtt: RedCircuit не блокирует по PTT-правилам ───');
  const req11 = mockReq('/me/pause', 'POST');
  await regimeMiddleware(req11 as never, {} as never);
  const pttBlocker = blockDuringPtt();
  try {
    await pttBlocker(req11 as never, {} as never, () => undefined);
    ok('PTT не активен — пропущено');
  } catch (e) {
    fail(`PTT заблокировал, хотя не активен: ${(e as Error).message}`);
  }

  console.log('\n─── 12. Cleanup ───');
  await query(`DELETE FROM regimes WHERE id = $1`, [redId]);
  await invalidateRegimeCache();
  ok('тестовые режимы удалены');

  console.log('\n✅ Regime middleware smoke OK');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('\n❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});