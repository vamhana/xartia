// scripts/test-regimes.ts
// I.9.04.17 — Полный цикл: steel_bell → quantum auto → mobilize → deactivate
// → red_circuit → B4 cross-checks.
//
// Запуск: pnpm tsx scripts/test-regimes.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'REGIMES-TEST:';

interface Client { token: string; participantId: string; directionId: string; }
interface WorkerInfo { id: string; externalId: string; phone: string; password: string; directionId: string; }

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json() as {
    access_token: string;
    participant: { id: string; direction_id: string };
  };
  if (!res.ok) {
    if (res.status === 429) {throw new Error('Rate limit on login. Сбрось rate:* в Redis.');}
    throw new Error(`Login ${phone}: ${JSON.stringify(data)}`);
  }
  return { token: data.access_token, participantId: data.participant.id, directionId: data.participant.direction_id };
}

async function req<T = unknown>(
  c: Client, method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${c.token}` };
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

// Счётчик провалов: без него fail() — мёртвый код, а тест всегда «зелёный».
let failed = 0;
function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); failed += 1; }

async function findArch(phone: string) {
  const phoneHash = hashForSearch(phone);
  const row = await queryOne<{ id: string; external_id: string; direction_id: string }>(
    `SELECT id, external_id, direction_id FROM participants
     WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [phoneHash],
  );
  if (!row) {throw new Error(`Architect ${phone} not found`);}
  return { id: row.id, externalId: row.external_id, directionId: row.direction_id };
}

async function findOtherDirection(excludeId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE id <> $1 AND status = 'active' LIMIT 1`,
    [excludeId],
  );
  if (!row) {throw new Error('No other active direction');}
  return row.id;
}

async function cleanupWorkerByExternalId(externalId: string): Promise<void> {
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`, [externalId],
  );
  if (!p) {return;}
  const pid = p.id;
  await query(`DELETE FROM reports WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM flow_transactions WHERE participant_id = $1`, [pid]);
  try { await query(`DELETE FROM capsules WHERE participant_id = $1`, [pid]); } catch { /* */ }
  await query(`DELETE FROM tasks WHERE assigned_to = $1 OR assigned_by = $1`, [pid]);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1 OR granted_by = $1)`, [pid]);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]);
  await query(`DELETE FROM mandates WHERE holder_id = $1 OR granted_by = $1`, [pid]);
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM cell_members WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009991';
  const password = 'TestRegimeWorker1';
  const externalId = 'Т90091-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Regime Worker', encryptField(phone), phoneHash, directionId, passwordHash],
  );

  const roleRow = await queryOne<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'ASSOCIATED' LIMIT 1`,
  );
  if (!roleRow) {throw new Error('Role ASSOCIATED not found');}
  await query(
    `INSERT INTO participant_roles (id, participant_id, role_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [newUUID(), id, roleRow.id],
  );

  return { id, externalId, phone, password, directionId };
}

async function resetRateLimit(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {return;}
  let count = 0;
  for (const pattern of ['rate:*', 'ratelimit:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) { await redis.del(...keys); count += keys.length; }
    } while (cursor !== '0');
  }
  if (count > 0) {console.log(`   · rate-limit: очищено ${count} ключей`);}
}

async function cleanupRegimes(): Promise<void> {
  // Закрыть все тестовые активные режимы
  await query(
    `UPDATE regimes SET status = 'finished', deactivated_at = now()
      WHERE status = 'active' AND reason LIKE $1`,
    [`${MARKER}%`],
  );
  // Отменить активные мобилизации тестовых режимов
  await query(
    `UPDATE crisis_mobilizations SET status = 'cancelled', completed_at = now()
      WHERE status = 'active'
        AND regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1)`,
    [`${MARKER}%`],
  );
  // Удалить confirmations/refusals тестовых мобилизаций
  await query(
    `DELETE FROM crisis_confirmations WHERE mobilization_id IN (
      SELECT id FROM crisis_mobilizations
      WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1))`,
    [`${MARKER}%`],
  );
  await query(
    `DELETE FROM crisis_refusals WHERE mobilization_id IN (
      SELECT id FROM crisis_mobilizations
      WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1))`,
    [`${MARKER}%`],
  );
  await query(
    `DELETE FROM crisis_mobilizations
      WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1)`,
    [`${MARKER}%`],
  );
  await query(`DELETE FROM regimes WHERE reason LIKE $1`, [`${MARKER}%`]);
  console.log('🧹 Cleanup: regimes + mobilizations + confirmations');
}

async function main(): Promise<void> {
  const archPhone = process.argv[2] ?? '+79001234567';
  const archPassword = process.argv[3] ?? 'ChangeMe123456';

  console.log('── Подготовка ──────────────────────────────────────────');
  const archInfo = await findArch(archPhone);
  console.log(`   · Архитектор: ${archInfo.externalId} (dir=${archInfo.directionId})`);

  const workerDir = await findOtherDirection(archInfo.directionId);
  const workerInfo = await ensureWorker(workerDir);
  console.log(`   · Worker: ${workerInfo.externalId} (dir=${workerDir})`);

  await resetRateLimit();
  await cleanupRegimes();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 0. Проверка: нет активных ─────────────────────
    const before = await req<{ data: unknown[] }>(arch, 'GET', '/regimes/active');
    if (before.status !== 200) {
      fail(`GET /regimes/active: ${before.status}`);
    } else if ((before.data.data?.length ?? 0) === 0) {
      ok('активных режимов нет');
    } else {
      fail(`активных режимов ${before.data.data?.length}: cleanup не сработал`);
    }

    // ─── 1. Дедлайны до Кванта ────────────────────────
    const dBefore = await req<Record<string, number>>(arch, 'GET', '/regimes/current-deadlines');
    const criticalBefore = dBefore.data.critical;
    const standardBefore = dBefore.data.standard;
    console.log(`   critical=${criticalBefore}ms, standard=${standardBefore}ms`);

    // ─── 2. Активировать steel_bell ────────────────────
    const steelBell = await req<{ id: string; type: string }>(arch, 'POST', '/regimes', {
      type: 'steel_bell',
      reason: `${MARKER} Тестовая угроза > 10%`,
      context: { hasThreatAboveTenPercent: true },
    });
    if (steelBell.status !== 201) {
      log('steel_bell', steelBell.status, steelBell.data);
      throw new Error('steel_bell failed');
    }
    const steelBellId = steelBell.data.id;
    ok(`steel_bell: ${steelBellId}`);

    // ─── 3. Квант ускорения авто-активирован ───────────
    const activeAfter = await req<{ data: Array<{ type: string }> }>(arch, 'GET', '/regimes/active');
    const hasQuantum = activeAfter.data.data?.some((r) => r.type === 'quantum_acceleration');
    if (hasQuantum) {ok('quantum_acceleration авто-активирован');}
    else {fail('quantum_acceleration НЕ активирован');}

    // ─── 4. Дедлайны ÷ 10 ──────────────────────────────
    const dAfter = await req<Record<string, number>>(arch, 'GET', '/regimes/current-deadlines');
    if (dAfter.data.critical === criticalBefore / 10) {ok(`critical: ${criticalBefore} → ${dAfter.data.critical}`);}
    else {fail(`critical: ${dAfter.data.critical}, ожидали ${criticalBefore / 10}`);}
    if (dAfter.data.standard === standardBefore / 10) {ok(`standard: ${standardBefore} → ${dAfter.data.standard}`);}
    else {fail(`standard: ${dAfter.data.standard}, ожидали ${standardBefore / 10}`);}

    // ─── 5. B1-TEST: повторный steel_bell → 409 ────────
    const steelAgain = await req(arch, 'POST', '/regimes', {
      type: 'steel_bell',
      reason: `${MARKER} повтор`,
      context: { hasThreatAboveTenPercent: true },
    });
    if (steelAgain.status === 409) {ok('B1: повторный steel_bell → 409');}
    else {fail(`B1: 409 ожидали, ${steelAgain.status}`);}

    // ─── 6. Мобилизация ───────────────────────────────
    const mob = await req<{ id: string; requiredCount: number }>(
      arch, 'POST', `/regimes/${steelBellId}/mobilization`,
      { required_count: 5, threshold_percent: 60 },
    );
    if (mob.status !== 201) {throw new Error('mobilization failed');}
    const mobId = mob.data.id;
    ok(`Мобилизация: ${mobId} (5, 60%)`);

    // ─── 7. Arch confirm → 200, confirmed=1 ──────────
    const c1 = await req<{ confirmedCount: number }>(arch, 'POST', `/regimes/mobilization/${mobId}/confirm`);
    if (c1.data.confirmedCount === 1) {ok('arch confirm → confirmed=1');}
    else {fail(`arch confirm: ${c1.data.confirmedCount}, ожидали 1`);}

    // ─── 8. Worker refuse → 201 ──────────────────────
    const r1 = await req(worker, 'POST', `/regimes/mobilization/${mobId}/refuse`, {
      reason: 'Не могу прибыть',
    });
    if (r1.status === 201) {ok('worker refuse → 201 (I.1.8.11, без санкций)');}
    else {fail(`worker refuse: 201 ожидали, ${r1.status}`);}

    // ─── 9. Share: confirmed=1, refused=1 ───────────
    const share = await req<{ confirmed: number; refused: number }>(
      arch, 'GET', `/regimes/mobilization/${mobId}/share`,
    );
    if (share.data.confirmed === 1 && share.data.refused === 1) {ok('share: 1 confirm, 1 refuse');}
    else {fail(`share: ${JSON.stringify(share.data)}`);}

    // ─── 10. B4-TEST: arch refuse после confirm → 409 ─
    const b4a = await req(arch, 'POST', `/regimes/mobilization/${mobId}/refuse`, { reason: 'b4' });
    log('B4: arch refuse (уже confirm)', b4a.status, b4a.data);
    if (b4a.status === 409) {ok('B4: refuse после confirm → 409');}
    else {fail(`B4: 409 ожидали, ${b4a.status}`);}

    // ─── 11. B4-TEST: worker confirm после refuse → 409 ─
    const b4b = await req(worker, 'POST', `/regimes/mobilization/${mobId}/confirm`);
    log('B4: worker confirm (уже refuse)', b4b.status, b4b.data);
    if (b4b.status === 409) {ok('B4: confirm после refuse → 409');}
    else {fail(`B4: 409 ожидали, ${b4b.status}`);}

    // ─── 12. B4-TEST: arch confirm dup → 409 ─────────
    const cDup = await req(arch, 'POST', `/regimes/mobilization/${mobId}/confirm`);
    if (cDup.status === 409) {ok('dedup: arch confirm dup → 409');}
    else {fail(`dedup: 409 ожидали, ${cDup.status}`);}

    // ─── 13. Аудит ────────────────────────────────────
    const audit = await req<{ findings: string[] }>(arch, 'POST', `/regimes/${steelBellId}/audit`);
    if (audit.status === 200) {ok('audit → 200');}
    else {fail(`audit: 200 ожидали, ${audit.status}`);}

    // ─── 14. Деактивация ─────────────────────────────
    const deact = await req<{ status: string }>(arch, 'POST', `/regimes/${steelBellId}/deactivate`, {
      reason: `${MARKER} Угроза снята`,
    });
    if (deact.data.status === 'finished') {ok('steel_bell → finished');}
    else {fail(`steel_bell status: ${deact.data.status}`);}

    // ─── 15. Квант тоже отключён ─────────────────────
    const afterDeact = await req<{ data: Array<{ type: string }> }>(arch, 'GET', '/regimes/active');
    if (!afterDeact.data.data?.some((r) => r.type === 'quantum_acceleration')) {
      ok('quantum auto-off после steel_bell deactivate');
    } else {
      fail('quantum всё ещё active');
    }

    // ─── 16. Дедлайны вернулись ──────────────────────
    const dFinal = await req<Record<string, number>>(arch, 'GET', '/regimes/current-deadlines');
    if (dFinal.data.critical === criticalBefore) {ok(`critical вернулся: ${criticalBefore}`);}
    else {fail(`critical: ${dFinal.data.critical}, ожидали ${criticalBefore}`);}
    if (dFinal.data.standard === standardBefore) {ok(`standard вернулся: ${standardBefore}`);}
    else {fail(`standard: ${dFinal.data.standard}, ожидали ${standardBefore}`);}

    // ─── 17. Red_circuit (глобальный) ─────────────────
    const red = await req<{ id: string }>(arch, 'POST', '/regimes', {
      type: 'red_circuit',
      reason: `${MARKER} Угроза жизни участника`,
      context: { isRedCircuitRequested: true },
    });
    if (red.status === 201) {ok('red_circuit → 201');}
    else {fail(`red_circuit: 201 ожидали, ${red.status}`);}

    // ─── 18. B3-TEST: второй global red_circuit → 409 ─
    const redDup = await req(arch, 'POST', '/regimes', {
      type: 'red_circuit',
      reason: `${MARKER} повтор глобального`,
      context: { isRedCircuitRequested: true },
    });
    if (redDup.status === 409) {ok('B3: второй global red_circuit → 409');}
    else {fail(`B3: 409 ожидали, ${redDup.status}`);}

    // ─── 19. red_circuit без контекста → 409 ─────────
    const redBad = await req(arch, 'POST', '/regimes', {
      type: 'red_circuit',
      reason: `${MARKER} без контекста`,
    });
    if (redBad.status === 409) {ok('red_circuit без context → 409');}
    else {fail(`red без context: 409 ожидали, ${redBad.status}`);}

    // ─── 20. global_red_circuit без угрозы → 409 ─────
    const globalBad = await req(arch, 'POST', '/regimes', {
      type: 'global_red_circuit',
      reason: `${MARKER} глобально`,
    });
    if (globalBad.status === 409) {ok('global_red_circuit без threat → 409');}
    else {fail(`global без threat: 409 ожидали, ${globalBad.status}`);}

    // ─── 21. Список ──────────────────────────────────
    const listAll = await req<{ data: unknown[] }>(arch, 'GET', '/regimes');
    ok(`GET /regimes: ${listAll.data.data?.length ?? 0} записей`);

    if (failed > 0) {
      console.error(`\n❌ Тест Regimes завершён: ${failed} провалов`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ Тест Regimes завершён');
    }
  } finally {
    try {
      await cleanupRegimes();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: regimes + worker ${workerInfo.externalId}`);
    } catch (e) {
      console.error('Cleanup failed:', e);
    }
    await gracefulShutdown();
  }
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});