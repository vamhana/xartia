// scripts/test-archive.ts
// I.9.04.01 — Archive: документ → sign → search → chains → ids → cross-check → pressure.
//
// Проверки fix'ов C.0.20.02 (v0.0.02):
//   - B1: signBody.strict — keeper_id в body → 422 (signer = auth).
//   - B2: cross-check с переупорядоченными ключами → 0 discrepancies.
//   - B4: повторная подпись → 409.
//   - B5: дубль external_id → 409.
//   - B6: дубль global_id → 409.
//
// Запуск: pnpm tsx scripts/test-archive.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'ARCH-TEST:';

interface Client { token: string; participantId: string; directionId: string; }
interface WorkerInfo { id: string; externalId: string; phone: string; password: string; directionId: string; }

// ─── HTTP ───────────────────────────────────────────────────────

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
  const phone = '+79990009988';
  const password = 'TestArchiveWorker1';
  const externalId = 'Т90088-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Archive Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupArchive(marker: string): Promise<void> {
  await query(
    `DELETE FROM cross_checks
      WHERE document_a_id IN (SELECT id FROM archive_documents WHERE subject LIKE $1)`,
    [`${marker}%`],
  );
  await query(`DELETE FROM decision_chains WHERE description LIKE $1`, [`${marker}%`]);
  await query(`DELETE FROM archive_documents WHERE subject LIKE $1`, [`${marker}%`]);
  // Cleanup id_registry по external_id с маркером (external_id начинается с MARKER)
  await query(`DELETE FROM id_registry WHERE external_id LIKE $1`, [`${marker}%`]);
  console.log('🧹 Cleanup: documents/chains/cross-checks/id_registry');
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

  // Уникальные ID для этого прогона (B5, B6) — иначе дубли.
  const runId = randomUUID().slice(0, 8);
  const externalId = `${MARKER}${runId}`;
  const globalId = `${MARKER}G-${runId}`;

  await resetRateLimit();
  await cleanupArchive(MARKER);

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 1. Создать документ ─────────────────────────────
    const doc = await req<{ id: string; type: string; version: number; signedBy: string | null }>(
      arch, 'POST', '/archive', {
        type: 'protocol',
        direction_id: arch.directionId,
        subject: `${MARKER}Протокол заседания`,
        content: { attendees: 5, decisions: ['решение A', 'решение B'] },
      },
    );
    if (doc.status !== 201) { log('doc', doc.status, doc.data); throw new Error('create doc failed'); }
    const docId = doc.data.id;
    ok(`Документ: ${docId}, version=${doc.data.version}, signedBy=${doc.data.signedBy}`);

    // ─── 2. B1-TEST: signBody с keeper_id → 422 (strict) ──
    const b1 = await req(arch, 'POST', `/archive/${docId}/sign`, {
      keeper_id: arch.participantId,   // ← старое поле
    });
    log('B1: sign с keeper_id в body', b1.status, b1.data);
    if (b1.status === 422) {ok('B1: signBody.strict — keeper_id → 422');}
    else {fail(`B1: 422 ожидали, ${b1.status}`);}

    // ─── 3. Подписать (без body) ──────────────────────────
    const signed = await req<{ document: { signedBy: string | null }; signature: string }>(
      arch, 'POST', `/archive/${docId}/sign`, {},
    );
    log('POST /archive/:id/sign {}', signed.status, {
      signedBy: signed.data.document?.signedBy,
      signatureLength: signed.data.signature?.length,
    });
    if (signed.status === 200 && signed.data.document.signedBy === arch.participantId) {
      ok('Документ подписан (signer = auth.participantId)');
    }
    if ((signed.data.signature?.length ?? 0) > 10) {
      ok(`HMAC (${signed.data.signature.length} символов)`);
    }

    // ─── 4. B4-TEST: повторная подпись → 409 ─────────────
    const b4 = await req(arch, 'POST', `/archive/${docId}/sign`, {});
    log('B4: повторная подпись', b4.status, b4.data);
    if (b4.status === 409) {ok('B4: повторная подпись → 409');}
    else {fail(`B4: 409 ожидали, ${b4.status}`);}

    // ─── 5. Список ────────────────────────────────────────
    const list = await req<{ data: unknown[]; meta: { total: number } }>(arch, 'GET', '/archive');
    log('GET /archive', list.status, { count: list.data.data?.length, total: list.data.meta?.total });

    // ─── 6. Поиск FTS ────────────────────────────────────
    const search = await req<{ data: unknown[] }>(
      arch, 'GET', `/archive/search?q=${encodeURIComponent('заседания')}`,
    );
    if ((search.data.data?.length ?? 0) >= 1) {ok('FTS-поиск работает');}

    // ─── 7. Второй документ для cross-check ──────────────
    const doc2 = await req<{ id: string }>(arch, 'POST', '/archive', {
      type: 'act',
      direction_id: arch.directionId,
      subject: `${MARKER}Акт сверки`,
      content: { attendees: 4, decisions: ['решение A', 'решение C'] },
    });
    const doc2Id = doc2.data.id;

    // ─── 8. B2-TEST: cross-check с переупорядоченными ключами ─
    // Документ с тем же content, но другой порядок ключей.
    const doc3 = await req<{ id: string }>(arch, 'POST', '/archive', {
      type: 'act',
      direction_id: arch.directionId,
      subject: `${MARKER}Акт сверки`,
      content: { decisions: ['решение A', 'решение C'], attendees: 4 },   // ← другой порядок
    });
    const doc3Id = doc3.data.id;

    const b2 = await req<{ discrepancies: Record<string, unknown> }>(
      arch, 'POST', '/archive/cross-check', {
        document_a_id: doc2Id,
        document_b_id: doc3Id,
      },
    );
    log('B2: cross-check (переупорядоченные ключи)', b2.status, b2.data);
    if (b2.status === 201 && Object.keys(b2.data.discrepancies ?? {}).length === 0) {
      ok('B2: stableStringify — 0 discrepancies (порядок ключей не влияет)');
    } else {
      fail(`B2: ${JSON.stringify(b2.data.discrepancies)}`);
    }

    // ─── 9. Cross-check с РАЗНЫМ content ────────────────
    const crossDiff = await req<{ discrepancies: Record<string, unknown> }>(
      arch, 'POST', '/archive/cross-check', {
        document_a_id: docId,
        document_b_id: doc2Id,
      },
    );
    log('cross-check (разный content)', crossDiff.status, crossDiff.data);
    if (crossDiff.status === 201 && Object.keys(crossDiff.data.discrepancies ?? {}).length > 0) {
      ok(`расхождения: ${Object.keys(crossDiff.data.discrepancies).join(', ')}`);
    }

    // ─── 10. Self cross-check → 422 ─────────────────────
    const selfCheck = await req(arch, 'POST', '/archive/cross-check', {
      document_a_id: docId,
      document_b_id: docId,
    });
    if (selfCheck.status === 422) {ok('cross-check doc↔doc → 422');}

    // ─── 11. Цепочка ─────────────────────────────────────
    const chainId = randomUUID();
    for (let i = 1; i <= 3; i++) {
      const r = await req<{ step: number; type: string }>(arch, 'POST', '/archive/chains', {
        chain_id: chainId,
        type: ['problem', 'decision', 'result'][i - 1],
        ref_id: docId,
        description: `${MARKER}шаг ${i}`,
      });
      if (r.data.step === i) {ok(`chain step ${i} → step=${r.data.step}`);}
      else {fail(`chain step ${i}: получили step=${r.data.step}`);}
    }

    const chain = await req<{ data: Array<{ step: number }> }>(
      arch, 'GET', `/archive/chains/${chainId}`,
    );
    if (chain.data.data?.length === 3) {ok('GET chains: 3 шага');}

    const rebuild = await req<{ valid: boolean; gaps: number[] }>(
      arch, 'GET', `/archive/chains/${chainId}/rebuild`,
    );
    if (rebuild.data.valid) {ok('rebuild: цепочка непрерывна');}

    // ─── 12. Реестр ID ───────────────────────────────────
    const entry = await req<{ id: string; externalId: string }>(
      arch, 'POST', '/archive/ids', {
        participant_id: arch.participantId,
        external_id: externalId,   // ← уникальный per-run
      },
    );
    log('POST /archive/ids', entry.status, entry.data);
    if (entry.status === 201) {ok(`ID: ${entry.data.externalId}`);}

    // ─── 13. B5-TEST: дубль external_id → 409 ────────────
    const b5 = await req(arch, 'POST', '/archive/ids', {
      participant_id: arch.participantId,
      external_id: externalId,
    });
    log('B5: дубль external_id', b5.status, b5.data);
    if (b5.status === 409) {ok('B5: дубль external_id → 409');}
    else {fail(`B5: 409 ожидали, ${b5.status}`);}

    // ─── 14. Привязка global_id ──────────────────────────
    const linked = await req<{ communityCode: string | null; globalId: string | null }>(
      arch, 'POST', `/archive/ids/${entry.data.id}/link-global`, {
        community_code: 'АБ',
        global_id: globalId,   // ← уникальный per-run
      },
    );
    if (linked.data.communityCode === 'АБ' && linked.data.globalId === globalId) {
      ok(`global_id привязан: ${globalId}`);
    }

    // ─── 15. B6-TEST: дубль global_id (на другой записи) → 409 ─
    const entry2 = await req<{ id: string }>(arch, 'POST', '/archive/ids', {
      participant_id: worker.participantId,
      external_id: `${MARKER}W-${runId}`,   // ← уникальный для worker
    });
    if (entry2.status === 201) {
      const b6 = await req(arch, 'POST', `/archive/ids/${entry2.data.id}/link-global`, {
        community_code: 'АБ',
        global_id: globalId,   // ← тот же global_id
      });
      log('B6: дубль global_id', b6.status, b6.data);
      if (b6.status === 409) {ok('B6: дубль global_id → 409');}
      else {fail(`B6: 409 ожидали, ${b6.status}`);}
    }

    // ─── 16. Латинский community_code → 422 ─────────────
    const badCode = await req(arch, 'POST', `/archive/ids/${entry.data.id}/link-global`, {
      community_code: 'AB',   // латиница
      global_id: `${MARKER}BAD`,
    });
    if (badCode.status === 422) {ok('латинский community_code → 422');}

    // ─── 17. Pressure signal ─────────────────────────────
    const pressure = await req<{ signalId: string }>(
      arch, 'POST', '/archive/pressure', {
        description: `${MARKER}Попытка повлиять на Хранителя`,
      },
    );
    if (pressure.status === 201 && pressure.data.signalId) {
      ok(`pressure signal: ${pressure.data.signalId}`);
    }

    // ─── 18. Список реестра ──────────────────────────────
    const ids = await req<{ data: unknown[] }>(arch, 'GET', '/archive/ids');
    if ((ids.data.data?.length ?? 0) >= 1) {ok(`GET /archive/ids: ${ids.data.data?.length}`);}

    console.log('\n✅ Тест Archive завершён');
  } finally {
    try {
      await cleanupArchive(MARKER);
      // Удалить pressure signal
      await query(
        `DELETE FROM responses WHERE signal_id IN (
          SELECT id FROM signals WHERE description LIKE 'Сигнал давления на Хранителя: ARCH-TEST:%'
        )`,
      ).catch(() => undefined);
      await query(
        `DELETE FROM signals WHERE description LIKE 'Сигнал давления на Хранителя: ARCH-TEST:%'`,
      ).catch(() => undefined);
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: archive + worker ${workerInfo.externalId}`);
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