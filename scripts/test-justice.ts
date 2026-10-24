// scripts/test-justice.ts(I.9.04.45)
// Тест Justice: complaints → investigations → isolation → sanctions →
// red-circuit → victim-rights → validate-collective.
//
// Проверки fix'ов A.1.21.01 + C.0.21.02 (v0.0.02):
//   - B1: worker (ASSOCIATED) без justice:V → 403 на GET /complaints.
//   - B2: повторный close investigation → 409 (atomic).
//   - B4: isolation с несуществующим target → 404.
//   - B5: sanction с несуществующим target → 404.
//   - B6: sanctionBody.type='not_imputable' → 422 (только через /not-imputable).
//   - B7: DELETE /justice/isolation/:id?reason=... → 204 (reason в query).
//   - B8: validate-collective { relatives: 'not-array' } → 422.
//
// Запуск: pnpm tsx scripts/test-justice.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'JUSTICE-TEST:';

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
  const phone = '+79990009987';
  const password = 'TestJusticeWorker1';
  const externalId = 'Т90087-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Justice Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupJustice(pids: string[]): Promise<void> {
  // Red circuits активированные justice-тестом
  await query(
    `UPDATE regimes SET status = 'finished', deactivated_at = now()
     WHERE type = 'red_circuit' AND status = 'active' AND reason LIKE $1`,
    [`justice: ${MARKER}%`],
  );
  // Юстиция: FK-порядок — sanctions/isolation/resocialization/investigations/complaints
  for (const table of ['sanctions', 'isolation', 'resocialization', 'investigations']) {
    try {
      await query(`DELETE FROM ${table} WHERE target_id = ANY($1::uuid[])`, [pids]);
    } catch { /* ignore — нет таблицы/колонки */ }
  }
  await query(`DELETE FROM complaints WHERE applicant_id = ANY($1::uuid[])`, [pids]);
  console.log('🧹 Cleanup: justice (complaints/investigations/isolation/sanctions/resocialization/regimes)');
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
  await cleanupJustice([archInfo.id, workerInfo.id]);

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 1. Подать жалобу (self-service) ─────────────────
    const complaint = await req<{ id: string; status: string }>(
      worker, 'POST', '/justice/complaints', {
        type: 'harassment',
        description: `${MARKER} Тестовая жалоба`,
        anonymous: false,
      },
    );
    if (complaint.status !== 201) { log('complaint', complaint.status, complaint.data); throw new Error('complaint failed'); }
    const complaintId = complaint.data.id;
    ok(`Жалоба (self-service): ${complaintId}, status=${complaint.data.status}`);

    // ─── 2. B1-TEST: worker без justice:V → 403 ──────────
    const b1 = await req(worker, 'GET', '/justice/complaints');
    log('B1: worker GET /complaints', b1.status, b1.data);
    if (b1.status === 403) {ok('B1: worker без justice:V → 403');}
    else {fail(`B1: 403 ожидали, ${b1.status}`);}

    // ─── 3. Arch → GET /complaints → 200 ─────────────────
    const list = await req<{ data: unknown[] }>(arch, 'GET', '/justice/complaints');
    if (list.status === 200) {ok(`arch GET /complaints: ${list.data.data?.length}`);}
    else {fail(`arch GET: ${list.status}`);}

    // ─── 4. Arch → GET /complaints/:id ───────────────────
    const getCompl = await req<{ id: string; type: string }>(
      arch, 'GET', `/justice/complaints/${complaintId}`,
    );
    if (getCompl.status === 200) {ok(`arch GET /complaints/:id, type=${getCompl.data.type}`);}
    else {fail(`GET /:id: ${getCompl.status}`);}

    // ─── 5. Start investigation ──────────────────────────
    const inv = await req<{ id: string; status: string; targetId: string }>(
      arch, 'POST', '/justice/investigations', {
        complaint_id: complaintId,
        target_id: worker.participantId,
        investigator_ids: [arch.participantId],
      },
    );
    if (inv.status !== 201) { log('inv', inv.status, inv.data); throw new Error('investigation failed'); }
    const invId = inv.data.id;
    ok(`Расследование: ${invId}, status=${inv.data.status}`);

    // ─── 6. B8-TEST: validate-collective с relatives='not-array' → 422 ─
    const b8 = await req(arch, 'POST', `/justice/investigations/${invId}/validate-collective`, {
      relatives: 'not-array',
    });
    log('B8: validate-collective {relatives: "not-array"}', b8.status, b8.data);
    if (b8.status === 422) {ok('B8: relatives="not-array" → 422');}
    else {fail(`B8: 422 ожидали, ${b8.status}`);}

    // ─── 7. validate-collective { relatives: [] } → 200 ─
    const valOk = await req<{ valid: boolean; violations: string[] }>(
      arch, 'POST', `/justice/investigations/${invId}/validate-collective`, {
        relatives: [],
      },
    );
    if (valOk.status === 200 && valOk.data.valid === true) {
      ok('validate-collective {relatives: []} → valid=true');
    } else {
      fail(`validate-collective: ${valOk.status}, valid=${valOk.data.valid}`);
    }

    // ─── 8. Close investigation ──────────────────────────
    const close1 = await req<{ id: string; status: string }>(
      arch, 'POST', `/justice/investigations/${invId}/close`, {
        result: `${MARKER} Расследование завершено`,
      },
    );
    if (close1.status === 200 && close1.data.status === 'closed') {
      ok('close → status=closed');
    } else {
      fail(`close: ${close1.status}, status=${close1.data.status}`);
    }

    // ─── 9. B2-TEST: повторный close → 409 ──────────────
    const b2 = await req(arch, 'POST', `/justice/investigations/${invId}/close`, {
      result: 'повтор',
    });
    log('B2: повторный close', b2.status, b2.data);
    if (b2.status === 409) {ok('B2: повторный close → 409');}
    else {fail(`B2: 409 ожидали, ${b2.status}`);}

    // ─── 10. B4-TEST: isolation с fake target → 404 ──────
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const b4 = await req(arch, 'POST', '/justice/isolation', {
      target_id: fakeId,
      valid_to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      conditions: { reason: 'test' },
    });
    log('B4: isolation с fake target', b4.status, b4.data);
    if (b4.status === 404) {ok('B4: isolation fake target → 404');}
    else {fail(`B4: 404 ожидали, ${b4.status}`);}

    // ─── 11. Валидная isolation ──────────────────────────
    const isolation = await req<{ id: string; targetId: string }>(
      arch, 'POST', '/justice/isolation', {
        target_id: worker.participantId,
        valid_to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        conditions: { reason: 'временная изоляция' },
      },
    );
    if (isolation.status === 201) {ok(`isolation: ${isolation.data.id}`);}
    else {throw new Error(`isolation failed: ${isolation.status}`);}
    const isolationId = isolation.data.id;

    // ─── 12. B7-TEST: DELETE isolation?reason=... → 204 ─
    const b7 = await req(
      arch, 'DELETE', `/justice/isolation/${isolationId}?reason=${encodeURIComponent('освобождён')}`,
    );
    log('B7: DELETE isolation?reason=...', b7.status, b7.data);
    if (b7.status === 204) {ok('B7: DELETE isolation → 204');}
    else {fail(`B7: 204 ожидали, ${b7.status}`);}

    // ─── 13. B5-TEST: sanction с fake target → 404 ───────
    const b5 = await req(arch, 'POST', '/justice/sanctions', {
      target_id: fakeId,
      type: 'restorative_talk',
      basis: 'test',
    });
    log('B5: sanction с fake target', b5.status, b5.data);
    if (b5.status === 404) {ok('B5: sanction fake target → 404');}
    else {fail(`B5: 404 ожидали, ${b5.status}`);}

    // ─── 14. B6-TEST: sanctionBody.type='not_imputable' → 422 ─
    const b6 = await req(arch, 'POST', '/justice/sanctions', {
      target_id: worker.participantId,
      type: 'not_imputable',
      basis: 'test',
    });
    log('B6: sanction type=not_imputable', b6.status, b6.data);
    if (b6.status === 422) {ok('B6: type=not_imputable в /sanctions → 422');}
    else {fail(`B6: 422 ожидали, ${b6.status}`);}

    // ─── 15. Валидная sanction ───────────────────────────
    const sanction = await req<{ id: string; type: string }>(
      arch, 'POST', '/justice/sanctions', {
        target_id: worker.participantId,
        type: 'restorative_talk',
        basis: `${MARKER} Восстановительный разговор`,
      },
    );
    if (sanction.status === 201) {ok(`sanction: ${sanction.data.id}, type=${sanction.data.type}`);}
    else {fail(`sanction: ${sanction.status}`);}

    // ─── 16. not-imputable без Жюри → 404/403 ────────────
    const notImp = await req(arch, 'POST', '/justice/not-imputable', {
      target_id: worker.participantId,
      decision_ref: fakeId,   // нет такой сессии Жюри
    });
    log('not-imputable без сессии Жюри', notImp.status, notImp.data);
    if (notImp.status === 404 || notImp.status === 403) {
      ok(`not-imputable без Жюри → ${notImp.status}`);
    } else {
      fail(`not-imputable: 403/404 ожидали, ${notImp.status}`);
    }

    // ─── 17. Red-circuit ─────────────────────────────────
    const red = await req<{ regimeId: string }>(arch, 'POST', '/justice/red-circuit', {
      reason: `${MARKER} Угроза жизни`,
    });
    log('POST /justice/red-circuit', red.status, red.data);
    if (red.status === 201 && red.data.regimeId) {ok(`red_circuit: ${red.data.regimeId}`);}
    else {fail(`red-circuit: ${red.status}`);}

    // ─── 18. Victim rights ──────────────────────────────
    const vr = await req<{ anonymity: boolean; participation: boolean }>(
      arch, 'GET', `/justice/victim-rights/${worker.participantId}`,
    );
    if (vr.status === 200) {
      ok(`victim-rights: anonymity=${vr.data.anonymity}, participation=${vr.data.participation}`);
    } else {
      fail(`victim-rights: ${vr.status}`);
    }

    // ─── 19. Overdue investigations ─────────────────────
    const overdue = await req<{ data: unknown[] }>(
      arch, 'GET', '/justice/investigations/overdue',
    );
    if (overdue.status === 200) {ok(`overdue investigations: ${overdue.data.data?.length}`);}
    else {fail(`overdue: ${overdue.status}`);}

    // ─── 20. Resocialization ────────────────────────────
    const resoc = await req<{ id: string; status: string }>(
      arch, 'POST', '/justice/resocialization', {
        target_id: worker.participantId,
        program: { name: 'resocialization', weeks: 8 },
      },
    );
    if (resoc.status === 201) {ok(`resocialization: ${resoc.data.id}`);}
    else {fail(`resocialization: ${resoc.status}`);}

    console.log('\n✅ Тест Justice завершён');
  } finally {
    try {
      await cleanupJustice([archInfo.id, workerInfo.id]);
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: justice + worker ${workerInfo.externalId}`);
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