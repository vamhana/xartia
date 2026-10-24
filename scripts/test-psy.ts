// scripts/test-psy.ts
// I.9.04.31 — Psy: сессии, кризисы, разгрузка, wellbeing, гигиена, mood.
//
// Проверки fix'ов A.1.23.01 + C.0.23.02 (v0.0.02/03):
//   - B1: worker без psy_session:V → 403 на 4 GET (sessions/crises/mood/wellbeing).
//   - B3: повторный complete → 409 (atomic).
//   - B4: completeSession не психологом → 403.
//   - B5: observer без PSY-роли → 422.
//   - B6: createSession/startDischarge с fake participant → 404.
//   - B7: второй открытый кризис → 409.
//   - B8: detectSystemicViolence идемпотентен (2 вызова → 1 запись).
//
// Запуск: pnpm tsx scripts/test-psy.ts +79001234567 ChangeMe123456

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'PSY-TEST:';

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
  await query(`DELETE FROM psy_sessions WHERE participant_id = $1 OR psychologist_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM psy_observers WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM psy_crises WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM psy_discharges WHERE participant_id = $1`, [pid]).catch(() => undefined);
  await query(`DELETE FROM wellbeing WHERE participant_id = $1`, [pid]).catch(() => undefined);
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
  const phone = '+79990009986';
  const password = 'TestPsyWorker1234';
  const externalId = 'Т90086-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Psy Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupPsy(archId: string, workerId: string, archDir: string): Promise<void> {
  await query(`DELETE FROM psy_sessions WHERE participant_id = ANY($1::uuid[]) OR psychologist_id = ANY($1::uuid[])`, [[archId, workerId]]).catch(() => undefined);
  await query(`DELETE FROM psy_observers WHERE participant_id = ANY($1::uuid[])`, [[archId, workerId]]).catch(() => undefined);
  await query(`DELETE FROM psy_crises WHERE participant_id = ANY($1::uuid[])`, [[archId, workerId]]).catch(() => undefined);
  await query(`DELETE FROM psy_discharges WHERE participant_id = ANY($1::uuid[])`, [[archId, workerId]]).catch(() => undefined);
  await query(`DELETE FROM wellbeing WHERE participant_id = ANY($1::uuid[])`, [[archId, workerId]]).catch(() => undefined);
  await query(`DELETE FROM hygiene WHERE direction_id = $1`, [archDir]).catch(() => undefined);
  await query(`DELETE FROM systemic_violence_signals WHERE direction_id = $1`, [archDir]).catch(() => undefined);
  console.log('🧹 Cleanup: psy (sessions/observers/crises/discharges/wellbeing/hygiene/svs)');
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
  await cleanupPsy(archInfo.id, workerInfo.id, archInfo.directionId);

  const fakeId = '00000000-0000-0000-0000-000000000000';

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ═══════════ B1: 8 GET без psy_session:V → 403 (worker) ═══════════

    const b1Targets: Array<{ path: string; label: string }> = [
      { path: '/psy/sessions', label: 'GET /psy/sessions' },
      { path: '/psy/crises', label: 'GET /psy/crises' },
      { path: `/psy/mood?direction_id=${worker.directionId}`, label: 'GET /psy/mood' },
      { path: '/psy/wellbeing/aggregate', label: 'GET /psy/wellbeing/aggregate' },
    ];
    let b1Passed = 0;
    for (const t of b1Targets) {
      const r = await req(worker, 'GET', t.path);
      if (r.status === 403) { ok(`B1: worker ${t.label} → 403`); b1Passed++; }
      else {fail(`B1: worker ${t.label} — 403 ожидали, ${r.status}`);}
    }
    // после цикла:
    if (b1Passed === b1Targets.length) {
      ok(`B1: все ${b1Targets.length} GET защищены psy_session:V`);
    } else {
      fail(`B1: ${b1Passed}/${b1Targets.length} GET защищены (частично)`);
    }
    // ═══════════ Arch → 200 на ключевые GET ═══════════

    const archSessions = await req<{ data: unknown[] }>(arch, 'GET', '/psy/sessions');
    if (archSessions.status === 200) {ok('arch GET /psy/sessions → 200');}

    // ═══════════ createSession (arch = psychologist) ═══════════

    const session = await req<{ id: string; status: string; psychologistId: string }>(
      arch, 'POST', '/psy/sessions', {
        participant_id: worker.participantId,
        type: 'onboarding',
        scheduled_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      },
    );
    if (session.status !== 201) { log('createSession', session.status, session.data); throw new Error('createSession failed'); }
    const sessionId = session.data.id;
    ok(`Session: ${sessionId}, status=${session.data.status}, psych=${session.data.psychologistId}`);

    // ═══════════ B6: createSession с fake participant → 404 ═══════════

    const b6Session = await req(arch, 'POST', '/psy/sessions', {
      participant_id: fakeId,
      type: 'onboarding',
      scheduled_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
    log('B6: createSession fake participant', b6Session.status, b6Session.data);
    if (b6Session.status === 404) {ok('B6: createSession fake participant → 404');}
    else {fail(`B6: 404 ожидали, ${b6Session.status}`);}

    // ═══════════ B4: worker (не психолог) completeSession → 403 ═══════════

    const b4Complete = await req(worker, 'POST', `/psy/sessions/${sessionId}/complete`, {
      notes: 'Попытка от worker',
    });
    log('B4: worker completeSession', b4Complete.status, b4Complete.data);
    if (b4Complete.status === 403) {ok('B4: worker (не психолог) complete → 403');}
    else {fail(`B4: 403 ожидали, ${b4Complete.status}`);}

    // ═══════════ Arch (психолог) completeSession → 200 ═══════════

    const archComplete = await req<{ status: string }>(
      arch, 'POST', `/psy/sessions/${sessionId}/complete`, {
        notes: `${MARKER} Сессия завершена`,
      },
    );
    if (archComplete.status === 200 && archComplete.data.status === 'completed') {
      ok('arch complete → 200 (status=completed)');
    } else {
      fail(`arch complete: ${archComplete.status}, status=${archComplete.data.status}`);
    }

    // ═══════════ B3: повторный complete → 409 ═══════════

    const b3 = await req(arch, 'POST', `/psy/sessions/${sessionId}/complete`, {
      notes: 'Повтор',
    });
    log('B3: повторный complete', b3.status, b3.data);
    if (b3.status === 409) {ok('B3: повторный complete → 409');}
    else {fail(`B3: 409 ожидали, ${b3.status}`);}

    // ═══════════ B7: crisis — self-service 201, повтор 409 ═══════════

    const crisis1 = await req<{ id: string; status: string }>(
      worker, 'POST', '/psy/crisis', {
        participant_id: worker.participantId,
        notes: `${MARKER} Первый кризис`,
      },
    );
    if (crisis1.status === 201 && crisis1.data.status === 'open') {
      ok('crisis self-service → 201 (status=open)');
    } else {
      fail(`crisis self-service: ${crisis1.status}, status=${crisis1.data.status}`);
    }

    const b7 = await req(worker, 'POST', '/psy/crisis', {
      participant_id: worker.participantId,
      notes: 'Второй',
    });
    log('B7: второй crisis', b7.status, b7.data);
    if (b7.status === 409) {ok('B7: второй активный crisis → 409');}
    else {fail(`B7: 409 ожидали, ${b7.status}`);}

    // ═══════════ B5: observer без PSY → 422 ═══════════

    const b5 = await req(arch, 'POST', '/psy/observers', {
      participant_id: worker.participantId,
      direction_id: worker.directionId,
    });
    log('B5: observer без PSY', b5.status, b5.data);
    if (b5.status === 422) {ok('B5: observer не-PSY → 422');}
    else {fail(`B5: 422 ожидали, ${b5.status}`);}

    // ═══════════ discharge (arch = psy_session:C) ═══════════

    const discharge = await req<{ id: string; days: number; status: string }>(
      arch, 'POST', '/psy/reflective-discharge', {
        participant_id: worker.participantId,
        days: 3,
      },
    );
    if (discharge.status === 201 && discharge.data.days === 3) {
      ok(`discharge: ${discharge.data.id}, days=3`);
    } else {
      fail(`discharge: ${discharge.status}, days=${discharge.data.days}`);
    }

    // ═══════════ B6: discharge с fake participant → 404 ═══════════

    const b6Discharge = await req(arch, 'POST', '/psy/reflective-discharge', {
      participant_id: fakeId,
      days: 3,
    });
    log('B6: discharge fake participant', b6Discharge.status, b6Discharge.data);
    if (b6Discharge.status === 404) {ok('B6: discharge fake participant → 404');}
    else {fail(`B6: 404 ожидали, ${b6Discharge.status}`);}

    // ═══════════ wellbeing (self-service) ═══════════

    const wellbeing = await req<{ id: string; score: number; trend: string }>(
      worker, 'POST', '/psy/wellbeing', {
        participant_id: worker.participantId,
        score: 7,
      },
    );
    if (wellbeing.status === 201 && wellbeing.data.score === 7) {
      ok(`wellbeing: ${wellbeing.data.id}, score=7, trend=${wellbeing.data.trend}`);
    } else {
      fail(`wellbeing: ${wellbeing.status}`);
    }

    // ═══════════ resonance (self-service) ═══════════

    const resonance = await req<{ id: string; days: number }>(
      worker, 'POST', '/psy/resonance', {
        participant_id: worker.participantId,
      },
    );
    if (resonance.status === 201 && resonance.data.days === 3) {
      ok(`resonance: ${resonance.data.id}, days=3 (по умолчанию)`);
    } else {
      fail(`resonance: ${resonance.status}`);
    }

    // ═══════════ hygiene (psy_session:C) ═══════════

    const hygiene = await req<{ id: string; measure: string; status: string }>(
      arch, 'POST', '/psy/hygiene', {
        direction_id: arch.directionId,
        measure: `${MARKER} Гигиена смыслов`,
      },
    );
    if (hygiene.status === 201) {ok(`hygiene: ${hygiene.data.id}`);}

    // ═══════════ mood aggregate (psy_session:Act, arch = wildcard) ═══════════

    const agg = await req<{ processed: number; created: number; skipped: number }>(
      arch, 'POST', '/psy/mood/aggregate', { period: 'hour' },
    );
    log('POST /psy/mood/aggregate', agg.status, {
      processed: agg.data.processed, created: agg.data.created, skipped: agg.data.skipped,
    });
    if (agg.status === 200) {ok(`mood aggregate: processed=${agg.data.processed}, created=${agg.data.created}`);}

    // ═══════════ B8: systemicViolence идемпотентен ═══════════

    const sv1 = await req<{ signal: boolean; cases: number }>(
      arch, 'GET', `/psy/systemic-violence/${arch.directionId}?year=2026`,
    );
    const sv2 = await req<{ signal: boolean; cases: number }>(
      arch, 'GET', `/psy/systemic-violence/${arch.directionId}?year=2026`,
    );
    log('B8: systemicViolence × 2', sv2.status, { sv1: sv1.data, sv2: sv2.data });
    if (sv1.status === 200 && sv2.status === 200) {ok('B8: systemicViolence × 2 → оба 200 (идемпотентно)');}

    // Проверка «одна запись в БД» — только если есть данные.
    const svRow = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM systemic_violence_signals
        WHERE direction_id = $1 AND year = 2026`,
      [archInfo.directionId],
    );
    const svCnt = parseInt(svRow?.cnt ?? '0', 10);
    if (svCnt <= 1) {ok(`B8: systemic_violence_signals rows=${svCnt} (≤ 1)`);}
    else {fail(`B8: ${svCnt} записей (ожидали ≤ 1)`);}

    console.log('\n✅ Тест Psy завершён');
  } finally {
    try {
      await cleanupPsy(archInfo.id, workerInfo.id, archInfo.directionId);
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: psy + worker ${workerInfo.externalId}`);
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