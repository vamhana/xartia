// scripts/test-crisis-confirm-dedup.ts
// I.9.04.07 — Дедупликация confirm/refuse + B4 cross-checks:
//   - arch confirm → 200, arch confirm dup → 409
//   - worker refuse → 201, worker refuse dup → 409
//   - B4: arch refuse после confirm → 409
//   - B4: worker confirm после refuse → 409
//
// Запуск: pnpm tsx scripts/test-crisis-confirm-dedup.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'TEST-CONFIRM-DEDUP:';

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
function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

// ─── Setup ──────────────────────────────────────────────────────

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
  const phone = '+79990009992';
  const password = 'TestDedupWorker123';
  const externalId = 'Т90092-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Dedup Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupDedup(): Promise<void> {
  await query(
    `DELETE FROM crisis_confirmations
      WHERE mobilization_id IN (
        SELECT id FROM crisis_mobilizations
        WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1)
      )`,
    [`${MARKER}%`],
  );
  await query(
    `DELETE FROM crisis_refusals
      WHERE mobilization_id IN (
        SELECT id FROM crisis_mobilizations
        WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1)
      )`,
    [`${MARKER}%`],
  );
  await query(
    `DELETE FROM crisis_mobilizations
      WHERE regime_id IN (SELECT id FROM regimes WHERE reason LIKE $1)`,
    [`${MARKER}%`],
  );
  await query(`DELETE FROM regimes WHERE reason LIKE $1`, [`${MARKER}%`]);
  console.log('🧹 Cleanup: regimes + mobilizations + confirmations + refusals');
}

// ─── Main ───────────────────────────────────────────────────────

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
  await cleanupDedup();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 1. Активировать red_circuit ────────────────────
    const regime = await req<{ id: string }>(arch, 'POST', '/regimes', {
      type: 'red_circuit',
      reason: `${MARKER} активация для теста дедупликации`,
      context: { isRedCircuitRequested: true },
    });
    if (regime.status !== 201) {
      log('regime', regime.status, regime.data);
      throw new Error('regime activate failed');
    }
    ok(`red_circuit: ${regime.data.id}`);

    // ─── 2. Мобилизация (10, threshold 90%) ─────────────
    const mob = await req<{ id: string; confirmedCount: number }>(
      arch, 'POST', `/regimes/${regime.data.id}/mobilization`,
      { required_count: 10, threshold_percent: 90 },
    );
    if (mob.status !== 201) {throw new Error('mobilization failed');}
    const mobId = mob.data.id;
    ok(`Мобилизация: ${mobId} (threshold 90%, чтобы 1 confirm не завершил)`);

    // ─── 3. Arch confirm → 200, confirmed=1 ────────────
    const c1 = await req<{ confirmedCount: number }>(
      arch, 'POST', `/regimes/mobilization/${mobId}/confirm`,
    );
    if (c1.status === 200 && c1.data.confirmedCount === 1) {
      ok('arch confirm → 200, confirmed=1');
    } else {
      fail(`arch confirm: ${c1.status}, confirmed=${c1.data?.confirmedCount}`);
    }

    // ─── 4. Arch confirm dup → 409 ─────────────────────
    const c2 = await req(arch, 'POST', `/regimes/mobilization/${mobId}/confirm`);
    if (c2.status === 409) {ok('arch confirm dup → 409');}
    else {fail(`arch confirm dup: 409 ожидали, ${c2.status}`);}

    // ─── 5. Share: confirmed=1, refused=0 ──────────────
    const share1 = await req<{ confirmed: number; refused: number }>(
      arch, 'GET', `/regimes/mobilization/${mobId}/share`,
    );
    if (share1.data.confirmed === 1 && share1.data.refused === 0) {
      ok('share: confirmed=1, refused=0');
    } else {
      fail(`share: ${JSON.stringify(share1.data)}`);
    }

    // ─── 6. Worker refuse → 201 ────────────────────────
    const r1 = await req(
      worker, 'POST', `/regimes/mobilization/${mobId}/refuse`,
      { reason: 'тестовый отказ' },
    );
    if (r1.status === 201) {ok('worker refuse → 201');}
    else {fail(`worker refuse: 201 ожидали, ${r1.status}`);}

    // ─── 7. Worker refuse dup → 409 ────────────────────
    const r2 = await req(
      worker, 'POST', `/regimes/mobilization/${mobId}/refuse`,
      { reason: 'повторный отказ' },
    );
    if (r2.status === 409) {ok('worker refuse dup → 409');}
    else {fail(`worker refuse dup: 409 ожидали, ${r2.status}`);}

    // ─── 8. B4-TEST: arch refuse после confirm → 409 ───
    const b4a = await req(
      arch, 'POST', `/regimes/mobilization/${mobId}/refuse`,
      { reason: 'B4-test: arch уже confirmed' },
    );
    log('B4: arch refuse (уже confirmed)', b4a.status, b4a.data);
    if (b4a.status === 409) {ok('B4: refuse после confirm → 409');}
    else {fail(`B4: 409 ожидали, ${b4a.status}`);}

    // ─── 9. B4-TEST: worker confirm после refuse → 409 ─
    const b4b = await req(
      worker, 'POST', `/regimes/mobilization/${mobId}/confirm`,
    );
    log('B4: worker confirm (уже refused)', b4b.status, b4b.data);
    if (b4b.status === 409) {ok('B4: confirm после refuse → 409');}
    else {fail(`B4: 409 ожидали, ${b4b.status}`);}

    // ─── 10. Final share: confirmed=1, refused=1 ──────
    const share2 = await req<{ confirmed: number; refused: number }>(
      arch, 'GET', `/regimes/mobilization/${mobId}/share`,
    );
    if (share2.data.confirmed === 1 && share2.data.refused === 1) {
      ok('final share: confirmed=1, refused=1 (нет накрутки)');
    } else {
      fail(`final share: ${JSON.stringify(share2.data)}`);
    }

    // ─── 11. DB: crisis_confirmations = 1 ──────────────
    const cnt = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM crisis_confirmations WHERE mobilization_id = $1`,
      [mobId],
    );
    if (parseInt(cnt?.cnt ?? '0', 10) === 1) {ok('DB: crisis_confirmations = 1');}
    else {fail(`DB: ${cnt?.cnt} записей (ожидали 1)`);}

    // ─── 12. DB: crisis_refusals = 1 ──────────────────
    const refCnt = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM crisis_refusals WHERE mobilization_id = $1`,
      [mobId],
    );
    if (parseInt(refCnt?.cnt ?? '0', 10) === 1) {ok('DB: crisis_refusals = 1');}
    else {fail(`DB: ${refCnt?.cnt} отказов (ожидали 1)`);}

    console.log('\n✅ Тест дедупликации мобилизации завершён');
  } finally {
    try {
      await cleanupDedup();
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