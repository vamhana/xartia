// scripts/test-jury.ts
// I.9.04.11 — UniversalRuns + Jury.
//
// UniversalRuns (v0.0.02) — B1/B6/B8 (как было).
// Jury (A.1.22.01 + C.0.22.01/02 v0.0.02):
//   - B1: worker без jury:V → 403 (3 GET).
//   - B2: worker (не модератор) голосует за другого → 403.
//   - B4: повторный голос → 409.
//   - B5: worker (не модератор) decision → 403.
//   - B8: createAppeal с fake session_id → 404.
//   - B9: assignOutsideTrust с fake participant → 404.
//
// Запуск: pnpm tsx scripts/test-jury.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { transaction, query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

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
      throw new Error('Rate limit on login (429). Сбрось rate:* / ratelimit:* в Redis.');
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

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

// ─── Worker ─────────────────────────────────────────────────────

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

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009996';
  const password = 'TestJuryWorker12345';
  const externalId = 'Т90096-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`, [externalId],
  );
  if (existing) {
    const pid = existing.id;
    await query(`DELETE FROM outside_trust_network WHERE participant_id = $1`, [pid]);
    await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]);
    await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1)`, [pid]);
    await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]);
    await query(`DELETE FROM mandates WHERE holder_id = $1`, [pid]);
    await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]);
    await query(`DELETE FROM participants WHERE id = $1`, [pid]);
  }

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Jury Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupWorkerByExternalId(externalId: string): Promise<void> {
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`, [externalId],
  );
  if (!p) {return;}
  const pid = p.id;
  await query(`DELETE FROM outside_trust_network WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1)`, [pid]);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]);
  await query(`DELETE FROM mandates WHERE holder_id = $1`, [pid]);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]);
}

// 2 паттерна: rate:* и ratelimit:* (реальный префикс в проекте).
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

// ─── 12 временных участников для Жюри ───────────────────────────

async function ensure12Participants(): Promise<string[]> {
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM participants
      WHERE deleted_at IS NULL AND status NOT IN ('excluded', 'outside_trust_network')`,
  );
  const existing = parseInt(row?.cnt ?? '0', 10);
  console.log(`   Существующих участников: ${existing}`);

  const needed = Math.max(0, 12 - existing);
  if (needed === 0) {return [];}

  const dirRow = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE number = 3 LIMIT 1`,
  );
  if (!dirRow) {throw new Error('Направление №3 не найдено');}
  const directionId = dirRow.id;

  const passwordHash = await hashPassword('TempPassword123!');
  const createdIds: string[] = [];

  for (let i = 0; i < needed; i++) {
    const id = newUUID();
    const phone = `+7999000${String(2000 + i).padStart(4, '0')}`;
    const phoneHash = hashForSearch(phone);
    const externalId = `Т${String(200 + i).padStart(5, '0')}-3`;

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO participants
           (id, external_id, wave_letter, wave_number, direction_id, name,
            phone, phone_hash, messengers, password_hash, status, profile_risk)
         VALUES ($1, $2, 'Т', $3, $4, $5, $6, $7, '{}'::jsonb, $8, 'associated', 'compatible')`,
        [id, externalId, 200 + i, directionId, `Тестовый Жюри ${i + 1}`,
         encryptField(phone), phoneHash, passwordHash],
      );
    });
    createdIds.push(id);
  }
  console.log(`   Создано временных: ${createdIds.length}`);
  return createdIds;
}

async function cleanupTempParticipants(ids: string[]): Promise<void> {
  if (ids.length === 0) {return;}
  console.log(`\n🧹 Удаляем ${ids.length} временных участников...`);
  for (const t of ['jury_votes', 'votes', 'participant_roles', 'cooldowns', 'cell_members', 'mandates']) {
    try {
      await query(`DELETE FROM ${t} WHERE participant_id = ANY($1::uuid[])`, [ids]);
    } catch { /* таблицы нет — ignore */ }
  }
  try {
    await query(
      `DELETE FROM delegations WHERE from_id = ANY($1::uuid[]) OR to_id = ANY($1::uuid[])`,
      [ids],
    );
  } catch { /* ignore */ }
  await query(`DELETE FROM participants WHERE id = ANY($1::uuid[])`, [ids]);
}

// Cleanup Jury-сущностей по signalId + worker.
async function cleanupJury(signalId: string | null, workerId: string): Promise<void> {
  if (signalId) {
    // FK-порядок: appeals → jury_sessions → signal
    await query(`DELETE FROM appeals WHERE subject_id = $1`, [signalId]).catch(() => undefined);
    await query(`DELETE FROM jury_sessions WHERE subject_id = $1`, [signalId]).catch(() => undefined);
  }
  await query(`DELETE FROM outside_trust_network WHERE participant_id = $1`, [workerId]).catch(() => undefined);
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

  const tempIds = await ensure12Participants();
  let signalId: string | null = null;

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    // ════════════ UniversalRuns (без изменений) ════════════

    const signal = await req<{ id: string }>(arch, 'POST', '/signals', {
      type: 'idea',
      description: 'Предложение по улучшению маршрутизации',
      justification: 'Снижает время отклика на 30%',
      priority: 'standard',
    });
    if (signal.status !== 201) {throw new Error('signal create failed');}
    signalId = signal.data.id;
    ok(`Сигнал: ${signalId}`);

    const run = await req<{ id: string; totalDirections: number }>(
      arch, 'POST', '/universal-runs', { signal_id: signalId, type: 'sequential' },
    );
    if (run.status !== 201) {throw new Error('run failed');}
    const runId = run.data.id;
    ok(`Прогон: ${runId}, totalDirections=${run.data.totalDirections}`);

    const resp1 = await req<{ run: { respondedDirections: number } }>(
      arch, 'POST', `/universal-runs/${runId}/responses`, {
        direction_id: arch.directionId,
        response: 'support',
        justification: 'Согласен',
      },
    );
    if (resp1.status === 201 && resp1.data.run?.respondedDirections === 1) {
      ok('Ответ 1 (support)');
    }

    const resp2 = await req(worker, 'POST', `/universal-runs/${runId}/responses`, {
      direction_id: worker.directionId,
      response: 'support',
      justification: 'Поддерживаю',
    });
    if (resp2.status === 201) {ok('Ответ 2 (support)');}

    // B1 UniversalRuns: чужой dir → 403
    const b1run = await req(worker, 'POST', `/universal-runs/${runId}/responses`, {
      direction_id: arch.directionId, response: 'object', justification: 'чужой dir',
    });
    if (b1run.status === 403) {ok('UR-B1: 403 за чужой dir');}

    // ════════════ Jury ════════════

    // 1. Создать сессию (arch = модератор)
    const session = await req<{ id: string; type: string; participants: string[]; moderatorId: string }>(
      arch, 'POST', '/jury/sessions', { type: 'normal_12', subject_id: signalId },
    );
    if (session.status !== 201) {
      log('session', session.status, session.data);
      throw new Error('jury session failed');
    }
    const sessionId = session.data.id;
    const participants = session.data.participants;
    log('POST /jury/sessions { normal_12 }', session.status, {
      id: sessionId, participantsCount: participants?.length,
    });
    if (participants.length === 12) {ok('Сессия: 12 участников');}

    // 2. B1-TEST: worker без jury:V → 403 (3 GET)
    const b1a = await req(worker, 'GET', `/jury/sessions/${sessionId}`);
    log('B1a: worker GET /jury/sessions/:id', b1a.status, b1a.data);
    if (b1a.status === 403) {ok('B1a: worker без jury:V → 403 (sessions/:id)');}
    else {fail(`B1a: 403 ожидали, ${b1a.status}`);}

    const b1b = await req(worker, 'GET', `/jury/sessions/${sessionId}/votes`);
    log('B1b: worker GET /jury/sessions/:id/votes', b1b.status, b1b.data);
    if (b1b.status === 403) {ok('B1b: worker без jury:V → 403 (votes)');}
    else {fail(`B1b: 403 ожидали, ${b1b.status}`);}

    const b1c = await req(worker, 'GET', `/jury/outside-trust-network/${worker.participantId}`);
    log('B1c: worker GET /outside-trust-network/:pid', b1c.status, b1c.data);
    if (b1c.status === 403) {ok('B1c: worker без jury:V → 403 (outside-trust)');}
    else {fail(`B1c: 403 ожидали, ${b1c.status}`);}

    // 3. B2-TEST: worker (не модератор) голосует за другого → 403
    const otherPid = participants.find((p) => p !== worker.participantId) ?? participants[0]!;
    const b2 = await req(worker, 'POST', `/jury/sessions/${sessionId}/vote`, {
      participant_id: otherPid, vote: 'yes',
    });
    log('B2: worker голосует за другого (не модератор)', b2.status, b2.data);
    if (b2.status === 403) {ok('B2: worker (не модератор) за другого → 403');}
    else {fail(`B2: 403 ожидали, ${b2.status}`);}

    // 4. Arch (модератор) голосует 9 yes + 2 no
    for (let i = 0; i < 9; i++) {
      await req(arch, 'POST', `/jury/sessions/${sessionId}/vote`, {
        participant_id: participants[i], vote: 'yes',
      });
    }
    for (let i = 9; i < 11; i++) {
      await req(arch, 'POST', `/jury/sessions/${sessionId}/vote`, {
        participant_id: participants[i], vote: 'no',
      });
    }
    ok('Arch (модератор): 9 yes + 2 no');

    // 5. B4-TEST: повторный голос arch за participants[0] → 409
    const b4 = await req(arch, 'POST', `/jury/sessions/${sessionId}/vote`, {
      participant_id: participants[0], vote: 'no',
    });
    log('B4: повторный голос за participants[0]', b4.status, b4.data);
    if (b4.status === 409) {ok('B4: повторный голос → 409');}
    else {fail(`B4: 409 ожидали, ${b4.status}`);}

    // 6. B5-TEST: worker (не модератор) decision → 403
    const b5 = await req(worker, 'POST', `/jury/sessions/${sessionId}/decision`, {
      decision: 'Попытка от worker',
    });
    log('B5: worker decision (не модератор)', b5.status, b5.data);
    if (b5.status === 403) {ok('B5: worker (не модератор) decision → 403');}
    else {fail(`B5: 403 ожидали, ${b5.status}`);}

    // 7. Подсчёт + decision (arch = модератор)
    const counts = await req<{ yes: number; no: number }>(
      arch, 'GET', `/jury/sessions/${sessionId}/votes`,
    );
    if (counts.data.yes === 9) {ok('Подсчёт: 9 yes');}

    const decision = await req(arch, 'POST', `/jury/sessions/${sessionId}/decision`, {
      decision: 'Внедрить предложение с пилотом',
    });
    if (decision.status === 200) {ok('Decision → 200 (9/12)');}
    else {fail(`decision: ${decision.status}`);}

    const repeat = await req(arch, 'POST', `/jury/sessions/${sessionId}/decision`, {
      decision: 'Другое',
    });
    if (repeat.status === 409) {ok('Повторное decision → 409');}

    // 8. Insufficient votes (новая сессия)
    const session2 = await req<{ id: string; participants: string[] }>(
      arch, 'POST', '/jury/sessions', { type: 'normal_12', subject_id: signalId },
    );
    for (let i = 0; i < 3; i++) {
      await req(arch, 'POST', `/jury/sessions/${session2.data.id}/vote`, {
        participant_id: session2.data.participants[i], vote: 'yes',
      });
    }
    const badDecision = await req(arch, 'POST', `/jury/sessions/${session2.data.id}/decision`, {
      decision: 'Раннее',
    });
    if (badDecision.status === 409) {ok('Без кворума → 409');}

    // 9. B8-TEST: createAppeal с fake session_id → 404
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const b8 = await req(arch, 'POST', '/jury/appeals', {
      jury_session_id: fakeId, council_type: 'APPELLATE', subject_id: signalId,
    });
    log('B8: createAppeal fake session_id', b8.status, b8.data);
    if (b8.status === 404) {ok('B8: fake session_id → 404');}
    else {fail(`B8: 404 ожидали, ${b8.status}`);}

    // 10. Валидная апелляция
    const appeal = await req(arch, 'POST', '/jury/appeals', {
      jury_session_id: sessionId, council_type: 'APPELLATE', subject_id: signalId,
    });
    if (appeal.status === 201) {ok('Валидная апелляция → 201');}

    // 11. B9-TEST: assignOutsideTrust с fake participant → 404
    const b9 = await req(arch, 'POST', '/jury/outside-trust-network', {
      participant_id: fakeId, reason: 'fake',
    });
    log('B9: assignOutsideTrust fake participant', b9.status, b9.data);
    if (b9.status === 404) {ok('B9: fake participant → 404');}
    else {fail(`B9: 404 ожидали, ${b9.status}`);}

    // 12. Outside Trust: assign → 201, dup → 409, ранний review → 409
    const ot = await req(arch, 'POST', '/jury/outside-trust-network', {
      participant_id: worker.participantId, reason: 'Тестовое исключение',
    });
    if (ot.status === 201) {ok('Outside trust назначен');}

    const otDup = await req(arch, 'POST', '/jury/outside-trust-network', {
      participant_id: worker.participantId, reason: 'Ещё раз',
    });
    if (otDup.status === 409) {ok('Повторный outside_trust → 409');}

    const review = await req(arch, 'POST', `/jury/outside-trust-network/${worker.participantId}/review`);
    if (review.status === 409) {ok('Ранний review → 409');}

    console.log('\n✅ Тест UniversalRuns + Jury завершён');
  } finally {
    try {
      await cleanupJury(signalId, workerInfo.id);
      await cleanupTempParticipants(tempIds);
      if (signalId) {
        await query(`DELETE FROM responses WHERE signal_id = $1`, [signalId]);
        await query(`DELETE FROM universal_runs WHERE signal_id = $1`, [signalId]);
        await query(`DELETE FROM signals WHERE id = $1`, [signalId]);
      }
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: jury + runs + signals + worker`);
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