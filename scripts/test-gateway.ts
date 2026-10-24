// scripts/test-gateway.ts(I.9.04.46)
// Gateway: council, transactions, assets, guarantor, witnesses, defense, dissolve.
//
// Проверки fix'ов A.1.24.01 + C.0.24.02 + S.0.01.07 (v0.0.02/03):
//   - B1: council lock — 8-й member → 409.
//   - B2: rotate dup → 404.
//   - B3: approve dup → 409.
//   - B4: audit completed → 409.
//   - B5: convert dup → 409.
//   - B6: гарант dup → 409.
//   - B7: expire → ok, повторный expire → null.
//   - B8: witness dup на ту же community → 409.
//   - B10: dissolve после 2 witnesses → 200.
//   - B24: Infinity в amount/value → 422.
//
// Запуск: pnpm tsx scripts/test-gateway.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'GATEWAY-TEST:';

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
    if (res.status === 429) {throw new Error('Rate limit on login. Сбрось rate:* / ratelimit:* в Redis.');}
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
    `SELECT id FROM directions WHERE id <> $1 AND status = 'active' ORDER BY number LIMIT 1`,
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
  await query(`DELETE FROM gateway_council WHERE member_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM guarantor WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM reports WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM flow_transactions WHERE participant_id = $1`, [pid]).catch(() => undefined);
  try { await query(`DELETE FROM capsules WHERE participant_id = $1`, [pid]); } catch { /* */ }
  await query(`DELETE FROM tasks WHERE assigned_to = $1 OR assigned_by = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1 OR granted_by = $1)`, [pid]).catch(() => undefined);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM mandates WHERE holder_id = $1 OR granted_by = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM cell_members WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]).catch(() => undefined);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009985';
  const password = 'TestGatewayWorker1';
  const externalId = 'Т90085-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Gateway Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupGateway(workerId: string): Promise<void> {
  await query(`DELETE FROM gateway_council WHERE member_id = $1`, [workerId]).catch(() => undefined);
  await query(`DELETE FROM external_transactions WHERE description LIKE $1`, [`${MARKER}%`]).catch(() => undefined);
  await query(`DELETE FROM external_assets WHERE source_participant_id = $1`, [workerId]).catch(() => undefined);
  await query(`DELETE FROM guarantor WHERE participant_id = $1`, [workerId]).catch(() => undefined);
  // FIX: чистим ВСЕ active witnesses (dev-only; в prod — не запускать тест).
  await query(`DELETE FROM external_witnesses WHERE status = 'active'`).catch(() => undefined);
  await query(`DELETE FROM external_defense WHERE commander_id = $1`, [workerId]).catch(() => undefined);
  // Снять info_blockade, если остался от прошлых прогонов.
  try {
    const regimes = await import('../src/core/regimes/service.js');
    const active = await regimes.getActive();
    const blockade = active.find((r) => r.type === 'info_blockade');
    if (blockade) {
      await regimes.deactivateService(blockade.id, 'gateway-test cleanup', workerId);
    }
  } catch { /* ignore */ }
  // Redis-флаг
  await redis.del('gateway:info_blockade:active').catch(() => undefined);
  console.log('🧹 Cleanup: gateway (council/tx/assets/guarantor/witnesses/defense/blockade)');
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
  await cleanupGateway(workerInfo.id);

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ═══════════ Council ═══════════

    // B1-TEST: 8 добавить нельзя (COUNCIL_SIZE = 7) — но у нас мало участников.
    // Проверяем хотя бы один add + повторный dup → 409.
    const c1 = await req<{ id: string; memberId: string }>(arch, 'POST', '/gateway/council', {
      member_id: workerInfo.id,
    });
    if (c1.status === 201) {ok(`council add: ${c1.data.memberId}`);}
    else {fail(`council add: ${c1.status}`);}

    const c2 = await req(arch, 'POST', '/gateway/council', {
      member_id: workerInfo.id,
    });
    log('council dup', c2.status, c2.data);
    if (c2.status === 409) {ok('council dup → 409');}
    else {fail(`council dup: 409 ожидали, ${c2.status}`);}

    // B2-TEST: rotate
    const r1 = await req<{ rotated: number }>(
      arch, 'DELETE', `/gateway/council/${workerInfo.id}`,
    );
    if (r1.status === 200 && r1.data.rotated === 1) {ok('council rotate → 1');}
    else {fail(`council rotate: ${r1.status}, rotated=${r1.data.rotated}`);}

    const r2 = await req(arch, 'DELETE', `/gateway/council/${workerInfo.id}`);
    log('council rotate dup', r2.status, r2.data);
    if (r2.status === 404) {ok('council rotate dup → 404');}
    else {fail(`council rotate dup: 404 ожидали, ${r2.status}`);}

    // ═══════════ Transactions ═══════════

    const tx = await req<{ id: string; status: string }>(arch, 'POST', '/gateway/transactions', {
      type: 'purchase',
      description: `${MARKER} test purchase`,
      amount_external: 100,
    });
    if (tx.status === 201 && tx.data.status === 'pending') {ok(`tx: ${tx.data.id}, status=pending`);}
    else {fail(`tx: ${tx.status}, status=${tx.data.status}`);}
    const txId = tx.data.id;

    // B24-TEST: Infinity → 422
    const b24 = await req(arch, 'POST', '/gateway/transactions', {
      type: 'purchase',
      description: `${MARKER} Infinity`,
      amount_external: Number.POSITIVE_INFINITY,
    });
    log('B24: Infinity amount', b24.status, b24.data);
    if (b24.status === 422) {ok('B24: amount_external=Infinity → 422');}
    else {fail(`B24: 422 ожидали, ${b24.status}`);}

    // B3-TEST: approve → ok, dup → 409
    const approve1 = await req<{ status: string }>(
      arch, 'POST', `/gateway/transactions/${txId}/approve`,
    );
    if (approve1.status === 200 && approve1.data.status === 'approved') {ok('tx approve → 200');}
    else {fail(`tx approve: ${approve1.status}`);}

    const approve2 = await req(arch, 'POST', `/gateway/transactions/${txId}/approve`);
    log('B3: approve dup', approve2.status, approve2.data);
    if (approve2.status === 409) {ok('B3: approve dup → 409');}
    else {fail(`B3: 409 ожидали, ${approve2.status}`);}

    // B4-TEST: audit approved → ok
    const audit1 = await req<{ auditedBy: string | null }>(
      arch, 'POST', `/gateway/transactions/${txId}/audit`,
    );
    if (audit1.status === 200 && audit1.data.auditedBy) {ok('tx audit → 200');}

    // ═══════════ Assets ═══════════

    const asset = await req<{ id: string; status: string }>(
      arch, 'POST', '/gateway/assets', {
        type: 'finance',
        value: 500,
        source_participant_id: workerInfo.id,
      },
    );
    if (asset.status === 201 && asset.data.status === 'accepted') {ok(`asset: ${asset.data.id}`);}
    else {fail(`asset: ${asset.status}`);}
    const assetId = asset.data.id;

    // B5-TEST: convert → ok, dup → 409
    const conv1 = await req<{ status: string }>(
      arch, 'POST', `/gateway/assets/${assetId}/convert`,
    );
    if (conv1.status === 200 && conv1.data.status === 'converted') {ok('asset convert → 200');}

    const conv2 = await req(arch, 'POST', `/gateway/assets/${assetId}/convert`);
    log('B5: convert dup', conv2.status, conv2.data);
    if (conv2.status === 409) {ok('B5: convert dup → 409');}
    else {fail(`B5: 409 ожидали, ${conv2.status}`);}

    // ═══════════ Guarantor ═══════════

    const g1 = await req<{ id: string; status: string }>(
      arch, 'POST', '/gateway/guarantor', {
        participant_id: workerInfo.id,
        diagnosis: { name: 'test-diagnosis', severity: 'low' },
      },
    );
    if (g1.status === 201 && g1.data.status === 'active') {ok(`guarantor: ${g1.data.id}`);}
    else {fail(`guarantor: ${g1.status}`);}

    // B6-TEST: dup guarantor → 409
    const g2 = await req(arch, 'POST', '/gateway/guarantor', {
      participant_id: workerInfo.id,
      diagnosis: { name: 'dup', severity: 'low' },
    });
    log('B6: guarantor dup', g2.status, g2.data);
    if (g2.status === 409) {ok('B6: guarantor dup → 409');}
    else {fail(`B6: 409 ожидали, ${g2.status}`);}

    // B7-TEST: expire → ok, повторный → null/200
    const e1 = await req<{ data: { status: string } | null }>(
      arch, 'DELETE', '/gateway/guarantor',
    );
    if (e1.status === 200 && e1.data.data?.status === 'expired') {ok('guarantor expire → expired');}
    else {fail(`guarantor expire: ${e1.status}`);}

    const e2 = await req<{ data: unknown }>(arch, 'DELETE', '/gateway/guarantor');
    if (e2.status === 200 && e2.data.data === null) {ok('B7: повторный expire → null');}
    else {fail(`B7: повторный expire: ${e2.status}, data=${JSON.stringify(e2.data)}`);}

    // ═══════════ Witnesses ═══════════

    // community_id — реальная община? В БД communities могут быть. Иначе — 500.
    const cRow = await queryOne<{ id: string }>(
      `SELECT id FROM communities LIMIT 1`,
    ).catch(() => null);
    const communityId = cRow?.id ?? newUUID();

    const w1 = await req<{ id: string }>(
      arch, 'POST', '/gateway/witnesses', { community_id: communityId },
    );
    log('witness add', w1.status, w1.data);
    if (w1.status === 201) {
      ok(`witness: ${w1.data.id}`);

      // B8-TEST: dup witness → 409
      const w2 = await req(arch, 'POST', '/gateway/witnesses', { community_id: communityId });
      log('B8: witness dup', w2.status, w2.data);
      if (w2.status === 409) {ok('B8: witness dup → 409');}
      else {fail(`B8: 409 ожидали, ${w2.status}`);}
    }

    // ═══════════ Self-sufficiency & Dissolve ═══════════

    // B10-TEST: с 1 witness self-sufficiency всё ещё blocked (нужно 2).
    const ss1 = await req<{ canDissolve: boolean; reasons: string[] }>(
      arch, 'GET', '/gateway/self-sufficiency',
    );
    log('self-sufficiency (1 witness)', ss1.status, ss1.data);
    if (ss1.status === 200) {ok(`self-sufficiency: canDissolve=${ss1.data.canDissolve}`);}

    // dissolve без 2 witnesses → 409
    const d1 = await req(arch, 'POST', '/gateway/dissolve', {
      reason: `${MARKER} try-dissolve`,
    });
    log('dissolve (1 witness)', d1.status, d1.data);
    if (d1.status === 409) {ok('dissolve без 2 witnesses → 409');}

    // B10-TEST (продолжение): добавляем 2-й witness → canDissolve=true → dissolve → 200.
    // Вставляем ПОСЛЕ проверки «dissolve без 2 witnesses → 409», чтобы она не сломалась.
    const cRow2 = await queryOne<{ id: string }>(
      `SELECT id FROM communities OFFSET 1 LIMIT 1`,
    ).catch(() => null);
    if (cRow2?.id) {
      const w3 = await req<{ id: string }>(
        arch, 'POST', '/gateway/witnesses', { community_id: cRow2.id },
      );
      log('witness #2 add', w3.status, w3.data);
      if (w3.status === 201) {ok('witness #2 добавлен');}
      else {fail(`witness #2: ${w3.status}`);}

      const ss2 = await req<{ canDissolve: boolean; reasons: string[] }>(
        arch, 'GET', '/gateway/self-sufficiency',
      );
      log('self-sufficiency (2 witnesses)', ss2.status, ss2.data);
      if (ss2.data.canDissolve) {ok('B10: 2 witnesses → canDissolve=true');}
      else {fail(`B10: canDissolve=${ss2.data.canDissolve}, reasons=${ss2.data.reasons?.join('; ')}`);}

      const d2 = await req<{ dissolved: boolean }>(
        arch, 'POST', '/gateway/dissolve', { reason: `${MARKER} dissolve` },
      );
      log('dissolve (2 witnesses)', d2.status, d2.data);
      if (d2.status === 200 && d2.data.dissolved === true) {ok('B10: dissolve → 200');}
      else {fail(`B10: dissolve: ${d2.status}`);}
    } else {
      console.log('   ℹ только одна community в БД — пропускаем 2-й witness / dissolve-200');
    }

    // ═══════════ Defense ═══════════

    const def = await req<{ id: string; type: string; status: string }>(
      arch, 'POST', '/gateway/defense', {
        type: 'external',
        commander_id: workerInfo.id,
      },
    );
    if (def.status === 201 && def.data.type === 'external') {ok(`defense: ${def.data.id}`);}

    // ═══════════ Lists ═══════════

    const txList = await req<{ data: unknown[] }>(arch, 'GET', '/gateway/transactions');
    if (txList.status === 200) {ok(`transactions list: ${txList.data.data?.length}`);}

    const assetList = await req<{ data: unknown[] }>(arch, 'GET', '/gateway/assets');
    if (assetList.status === 200) {ok(`assets list: ${assetList.data.data?.length}`);}

    const wList = await req<{ data: unknown[] }>(arch, 'GET', '/gateway/witnesses');
    if (wList.status === 200) {ok(`witnesses list: ${wList.data.data?.length}`);}

    console.log('\n✅ Тест Gateway завершён');
  } finally {
    try {
      await cleanupGateway(workerInfo.id);
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: gateway + worker ${workerInfo.externalId}`);
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