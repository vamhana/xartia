// scripts/test-standards.ts
// I.9.04.21 — Standards + Modifiers.
// Auto-worker (ASSOCIATED) для B-теста: POST /modifiers без standard:C → 403.
//
// Проверки:
//   - create standard → norm=-5 → 422
//   - calculate без модификаторов = 2000
//   - modifier +0.1 → pending (не влияет)
//   - modifier -0.2 → pending
//   - approve ×2 → calculate = 2000 * 1.1 * 0.8 = 1760
//   - reject modifier
//   - фильтр по категории
//   - B: worker без standard:C → 403 на POST /modifiers
//
// Запуск: pnpm tsx scripts/test-standards.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'STD-TEST-';

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
    if (res.status === 429) {
      throw new Error('Rate limit on login (429). Сбрось rate:* в Redis.');
    }
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

// ─── Worker setup/cleanup ───────────────────────────────────────

async function findArch(phone: string): Promise<{ id: string; externalId: string; directionId: string }> {
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
  const phone = '+79990009993';
  const password = 'TestStdWorker12345';
  const externalId = 'Т90093-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Standards Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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
  // Префикс может быть rate: или ratelimit: — сбрасываем оба.
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

async function cleanupStandards(): Promise<void> {
  await query(`DELETE FROM standards WHERE category LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM modifiers WHERE name LIKE $1`, [`${MARKER}%`]);
  console.log('🧹 Cleanup: standards + modifiers');
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
  console.log(`   · Worker создан: ${workerInfo.externalId} (dir=${workerDir})`);

  await resetRateLimit();
  await cleanupStandards();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    // ─── 1. Создать стандарт ────────────────────────────
    const std = await req<{ id: string; category: string; norm: number; version: number }>(
      arch, 'POST', '/standards', {
        category: `${MARKER}food`,
        norm: 2000,
      },
    );
    if (std.status !== 201) { log('std', std.status, std.data); throw new Error('create failed'); }
    const stdId = std.data.id;
    ok(`Стандарт: ${stdId}, norm=${std.data.norm}`);

    // ─── 2. norm=-5 → 422 ──────────────────────────────
    const bad = await req(arch, 'POST', '/standards', { category: `${MARKER}bad`, norm: -5 });
    if (bad.status === 422) {ok('norm=-5 → 422');}

    // ─── 3. Расчёт без модификаторов = 2000 ────────────
    const calc1 = await req<{ norm: number }>(
      arch, 'GET', `/standards/calculate?standard_id=${stdId}`,
    );
    if (calc1.data.norm === 2000) {ok('calculate без модификаторов = 2000');}

    // ─── 4. Модификатор +0.1 ───────────────────────────
    const mod1 = await req<{ id: string; status: string; coefficient: number }>(
      arch, 'POST', '/modifiers', {
        name: `${MARKER}climate`,
        condition: { climate: 'arctic' },
        coefficient: 0.1,
      },
    );
    if (mod1.status !== 201) { log('mod1', mod1.status, mod1.data); throw new Error('mod1 failed'); }
    const mod1Id = mod1.data.id;
    if (mod1.data.status === 'pending') {ok(`mod1 ${mod1Id}, coeff=0.1, pending`);}

    // ─── 5. coefficient=100 → 422 ─────────────────────
    const badMod = await req(arch, 'POST', '/modifiers', {
      name: `${MARKER}bad`, condition: { x: 1 }, coefficient: 100,
    });
    if (badMod.status === 422) {ok('coefficient=100 → 422');}

    // ─── 6. Модификатор -0.2 ───────────────────────────
    const mod2 = await req<{ id: string }>(arch, 'POST', '/modifiers', {
      name: `${MARKER}health`, condition: { health: 'chronic' }, coefficient: -0.2,
    });
    const mod2Id = mod2.data.id;
    ok(`mod2 ${mod2Id}, coeff=-0.2`);

    // ─── 7. Pending — норма не меняется ────────────────
    const calcPending = await req<{ norm: number }>(
      arch, 'GET', `/standards/calculate?standard_id=${stdId}&modifier_ids=${mod1Id},${mod2Id}`,
    );
    if (calcPending.data.norm === 2000) {ok('pending модификаторы не влияют');}

    // ─── 8. Approve ×2 ─────────────────────────────────
    const a1 = await req(arch, 'POST', `/modifiers/${mod1Id}/approve`);
    const a2 = await req(arch, 'POST', `/modifiers/${mod2Id}/approve`);
    if (a1.status === 200 && a2.status === 200) {ok('оба модификатора active');}

    // ─── 9. Повторный approve → 409 (atomic) ───────────
    const aRepeat = await req(arch, 'POST', `/modifiers/${mod1Id}/approve`);
    log('повторный approve', aRepeat.status, aRepeat.data);
    if (aRepeat.status === 409) {ok('повторный approve → 409');}
    else {fail(`повторный approve: 409 ожидали, ${aRepeat.status}`);}

    // ─── 10. Расчёт: 2000 * 1.1 * 0.8 = 1760 ───────────
    const calc2 = await req<{ norm: number }>(
      arch, 'GET', `/standards/calculate?standard_id=${stdId}&modifier_ids=${mod1Id},${mod2Id}`,
    );
    log('calculate (active)', calc2.status, calc2.data);
    if (calc2.data.norm === 1760) {ok(`2000 * 1.1 * 0.8 = 1760`);}
    else {fail(`Ожидали 1760, получили ${calc2.data.norm}`);}

    // ─── 11. Reject modifier ───────────────────────────
    const mod3 = await req<{ id: string }>(arch, 'POST', '/modifiers', {
      name: `${MARKER}reject-me`, condition: { test: true }, coefficient: 0.5,
    });
    const rejected = await req<{ status: string; reasonRejected: string | null }>(
      arch, 'POST', `/modifiers/${mod3.data.id}/reject`, {
        reason: 'Не обосновано',
      },
    );
    if (rejected.data.status === 'rejected' && rejected.data.reasonRejected === 'Не обосновано') {
      ok('модификатор отклонён');
    }

    // ─── 12. B-TEST: worker (ASSOCIATED) POST /modifiers → 403 ─
    //     worker без standard:C — middleware отклонит.
    const bTest = await req(worker, 'POST', '/modifiers', {
      name: `${MARKER}worker-attempt`,
      condition: { x: 1 },
      coefficient: 0.1,
    });
    log('POST /modifiers worker (B-test)', bTest.status, bTest.data);
    if (bTest.status === 403) {ok('B: worker без standard:C → 403');}
    else {fail(`B: 403 ожидали, ${bTest.status}`);}

    // ─── 13. Список стандартов с фильтром ──────────────
    const filtered = await req<{ data: unknown[] }>(
      arch, 'GET', `/standards?category=${MARKER}food`,
    );
    if ((filtered.data.data?.length ?? 0) === 1) {ok('фильтр по категории');}

    // ─── 14. Revision due ──────────────────────────────
    const revDue = await req<{ data: unknown[] }>(arch, 'GET', '/standards/revision-due');
    ok(`revision-due: ${revDue.data.data?.length ?? 0} (все свежие)`);

    // ─── 15. B-TEST calc: невалидный UUID в modifier_ids → 422 ─
    const badCalc = await req(
      arch, 'GET', `/standards/calculate?standard_id=${stdId}&modifier_ids=bogus`,
    );
    log('calculate с bogus modifier_id (B-test)', badCalc.status, badCalc.data);
    if (badCalc.status === 422) {ok('B: невалидный UUID в modifier_ids → 422');}
    else {fail(`B: 422 ожидали, ${badCalc.status}`);}

    // ─── 16. B-TEST calc: несуществующий UUID → 404 ────
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const missingCalc = await req(
      arch, 'GET', `/standards/calculate?standard_id=${stdId}&modifier_ids=${fakeId}`,
    );
    log('calculate с missing modifier_id (B-test)', missingCalc.status, missingCalc.data);
    if (missingCalc.status === 404) {ok('B: несуществующий modifier_id → 404');}
    else {fail(`B: 404 ожидали, ${missingCalc.status}`);}

    console.log('\n✅ Тест Standards завершён');
  } finally {
    try {
      await cleanupStandards();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: standards + worker ${workerInfo.externalId}`);
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