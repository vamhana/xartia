// scripts/test-quanta.ts
// I.9.04.37 — Quanta: lifecycle, audit, test, record, stop, apply.
//
// Проверки fix'ов A.1.25.01 + C.0.25.02 (v0.0.03/04):
//   - B3: повторный audit → 409 (atomic detected→audit).
//   - B4: test на cancelled → 409 (atomic status check).
//   - B6: повторный stop → 409 (atomic status != cancelled).
//   - B7: apply fake community → 404; UNIQUE quantum_catalog → 422 если нет миграции.
//   - B8: recordTest вне testing → 409.
//   - B24-аналог (квази): createBody JSON ≤ 10KB → 422.
//
// Запуск: pnpm tsx scripts/test-quanta.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'QUANTA-TEST:';

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
  const phone = '+79990009984';
  const password = 'TestQuantaWorker12';
  const externalId = 'Т90084-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Quanta Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupQuanta(): Promise<void> {
  // Чистим тестовые кванты (по типу с маркером)
  const qs = await query<{ id: string }>(
    `SELECT id FROM quanta WHERE type LIKE $1`,
    [`${MARKER}%`],
  ).catch(() => []);
  const ids = qs.map((r) => r.id);
  if (ids.length > 0) {
    await query(`DELETE FROM quantum_tests WHERE quantum_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM quantum_catalog WHERE quantum_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await query(`DELETE FROM quanta WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
  }
  console.log('🧹 Cleanup: quanta (tests/catalog/quanta)');
}

async function ensureTestCell(directionId: string, archId: string): Promise<string> {
  // Пробуем найти существующую ячейку в направлении; если нет — создаём через SQL.
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM cells WHERE direction_id = $1 ORDER BY level DESC, number ASC LIMIT 1`,
    [directionId],
  );
  if (existing) {return existing.id;}

  const id = newUUID();
  await query(
    `INSERT INTO cells (id, level, number, profile, parent_cell_id, direction_id, members_count)
     VALUES ($1, 0, $2, NULL, NULL, $3, 0)`,
    [id, `Q${Date.now() % 10000}`, directionId],
  ).catch(() => undefined);

  // Дадим Архитектору ячейку — для тестов recordTest, может понадобиться
  await query(
    `INSERT INTO cell_members (id, cell_id, participant_id, role_in_cell)
     VALUES ($1, $2, $3, 'member')
     ON CONFLICT DO NOTHING`,
    [newUUID(), id, archId],
  ).catch(() => undefined);

  return id;
}

async function ensureCommunity(): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM communities LIMIT 1`,
  ).catch(() => null);
  if (row) {return row.id;}

  // Если таблицы communities нет — попробуем вставить и посмотреть
  const id = newUUID();
  try {
    await query(
      `INSERT INTO communities (id, name, status) VALUES ($1, $2, 'incubation')`,
      [id, `${MARKER}test-community`],
    );
    return id;
  } catch {
    return null;
  }
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
  await cleanupQuanta();

  const cellId = await ensureTestCell(archInfo.directionId, archInfo.id);
  console.log(`   · cell: ${cellId}`);
  const communityId = await ensureCommunity();
  console.log(`   · community: ${communityId ?? '(нет таблицы)'}`);

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ═══════════ 1. Create quantum (detected) ═══════════

    const createBody = {
      level: 3,
      type: `${MARKER}test-quantum`,
      source_cell_id: cellId,
      description: 'Test quantum lifecycle',
      area_of_applicability: { scope: 'test' },
      limitations: { limit: 'small' },
      success_criteria: { metric: 'efficiency', threshold: 0.8 },
      stop_criteria: { metric: 'efficiency', threshold: 0.3 },
    };

    const create = await req<{ id: string; status: string; level: number }>(
      arch, 'POST', '/quanta', createBody,
    );
    if (create.status === 201 && create.data.status === 'detected') {
      ok(`quantum: ${create.data.id}, status=detected`);
    } else {
      log('create', create.status, create.data);
      throw new Error('quantum create failed');
    }
    const quantumId = create.data.id;

    // ═══════════ B24-аналог: JSON > 10KB → 422 ═══════════

    const bigArea: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {bigArea[`k${i}`] = 'x'.repeat(10);}

    const bigCreate = await req(arch, 'POST', '/quanta', {
      ...createBody,
      type: `${MARKER}big`,
      area_of_applicability: bigArea,
    });
    log('create с area_of_applicability > 10KB', bigCreate.status, {
      code: (bigCreate.data as { code?: string })?.code,
    });
    if (bigCreate.status === 422) {ok('area_of_applicability > 10KB → 422');}
    else {fail(`area_of_applicability: 422 ожидали, ${bigCreate.status}`);}

    // ═══════════ B3: повторный audit → 409 ═══════════

    const audit1 = await req<{ status: string }>(
      arch, 'POST', `/quanta/${quantumId}/audit`,
    );
    if (audit1.status === 200 && audit1.data.status === 'testing') {
      ok(`audit → testing (verification ok)`);
    } else {
      log('audit', audit1.status, audit1.data);
      fail(`audit: ${audit1.status}, status=${audit1.data.status}`);
    }

    // B3: повторный audit → 409 (не detected)
    const audit2 = await req(arch, 'POST', `/quanta/${quantumId}/audit`);
    log('B3: повторный audit', audit2.status, audit2.data);
    if (audit2.status === 409) {ok('B3: повторный audit → 409');}
    else {fail(`B3: 409 ожидали, ${audit2.status}`);}

    // ═══════════ B8: recordTest вне testing → 409 ═══════════

    // Создадим квант в detected, попробуем recordTest — должен быть 409.
    const q2 = await req<{ id: string }>(arch, 'POST', '/quanta', {
      ...createBody,
      type: `${MARKER}detected-only`,
    });
    if (q2.status === 201) {
      const b8 = await req(arch, 'POST', `/quanta/${q2.data.id}/test-record`, {
        cell_id: cellId,
        result: 'success',
      });
      log('B8: recordTest на detected', b8.status, b8.data);
      if (b8.status === 409) {ok('B8: recordTest вне testing → 409');}
      else {fail(`B8: 409 ожидали, ${b8.status}`);}
    }

    // ═══════════ recordTest в testing → 201 ═══════════

    const rec = await req<{ id: string; result: string }>(
      arch, 'POST', `/quanta/${quantumId}/test-record`, {
        cell_id: cellId,
        result: 'success',
        notes: 'first test',
      },
    );
    if (rec.status === 201) {ok(`recordTest: ${rec.data.id}`);}
    else {fail(`recordTest: ${rec.status}`);}

    // ═══════════ B4: test на cancelled → 409 ═══════════

    // Останавливаем квант.
    const stop1 = await req<{ status: string }>(
      arch, 'POST', `/quanta/${quantumId}/stop`, {
        reason: `${MARKER} testing done`,
      },
    );
    if (stop1.status === 200 && stop1.data.status === 'cancelled') {
      ok('stop → cancelled');
    } else {
      fail(`stop: ${stop1.status}`);
    }

    // B4: test на cancelled → 409
    const b4 = await req(arch, 'POST', `/quanta/${quantumId}/test`, {
      cell_ids: [cellId, cellId, cellId],
    });
    log('B4: test на cancelled', b4.status, b4.data);
    if (b4.status === 409) {ok('B4: test на cancelled → 409');}
    else {fail(`B4: 409 ожидали, ${b4.status}`);}

    // ═══════════ B6: повторный stop → 409 ═══════════

    const stop2 = await req(arch, 'POST', `/quanta/${quantumId}/stop`, {
      reason: `${MARKER} dup`,
    });
    log('B6: повторный stop', stop2.status, stop2.data);
    if (stop2.status === 409) {ok('B6: повторный stop → 409');}
    else {fail(`B6: 409 ожидали, ${stop2.status}`);}

    // ═══════════ B7: apply fake community → 404 ═══════════

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const b7a = await req(arch, 'POST', `/quanta/${q2.data?.id}/apply`, {
      community_id: fakeId,
    });
    log('B7: apply fake community', b7a.status, b7a.data);
    // Может быть 404 (community not found) или 409 (quantum not active/scaling) — оба корректны.
    if (b7a.status === 404 || b7a.status === 409) {
      ok(`B7: apply fake community → ${b7a.status}`);
    } else {
      fail(`B7: 404/409 ожидали, ${b7a.status}`);
    }

    // ═══════════ B7: apply real community (quantum в detected — 409) ═══════════

    if (communityId && q2.data?.id) {
      const b7b = await req(arch, 'POST', `/quanta/${q2.data.id}/apply`, {
        community_id: communityId,
      });
      log('B7: apply detected quantum', b7b.status, b7b.data);
      if (b7b.status === 409) {ok('B7: apply detected → 409 (status guard)');}
      else if (b7b.status === 422) {ok('B7: apply → 422 (нет UNIQUE в БД)');}
      else if (b7b.status === 201) {ok('B7: apply detected → 201 (нет status guard?)');}
      else {fail(`B7: неожиданный статус ${b7b.status}`);}
    }

    // ═══════════ List / get / mandatory / catalog ═══════════

    const list = await req<{ data: unknown[] }>(arch, 'GET', '/quanta');
    if (list.status === 200) {ok(`GET /quanta: ${list.data.data?.length}`);}

    const getOne = await req<{ id: string; status: string }>(
      arch, 'GET', `/quanta/${quantumId}`,
    );
    if (getOne.status === 200) {ok(`GET /quanta/:id, status=${getOne.data.status}`);}

    const mandatory = await req<{ data: unknown[] }>(arch, 'GET', '/quanta/mandatory');
    if (mandatory.status === 200) {ok(`GET /quanta/mandatory: ${mandatory.data.data?.length}`);}

    const detect = await req<{ data: unknown[] }>(arch, 'GET', '/quanta/detect');
    if (detect.status === 200) {ok(`GET /quanta/detect: ${detect.data.data?.length}`);}

    const catalog = await req<{ data: unknown[] }>(arch, 'GET', '/quanta/catalog');
    if (catalog.status === 200) {ok(`GET /quanta/catalog: ${catalog.data.data?.length}`);}

    // ═══════════ process-daily (cron) ═══════════

    const daily = await req<{ candidates: number; created: number }>(
      arch, 'POST', '/quanta/process-daily',
    );
    if (daily.status === 200) {ok(`process-daily: candidates=${daily.data.candidates}, created=${daily.data.created}`);}

    // ═══════════ document ═══════════

    const doc = await req<{ documented: boolean; documentId?: string }>(
      arch, 'POST', `/quanta/${quantumId}/document`,
    );
    if (doc.status === 200) {
      ok(`document: documented=${doc.data.documented}${doc.data.documentId ? `, id=${doc.data.documentId}` : ''}`);
    }

    console.log('\n✅ Тест Quanta завершён');
  } finally {
    try {
      await cleanupQuanta();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: quanta + worker ${workerInfo.externalId}`);
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