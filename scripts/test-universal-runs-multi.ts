// scripts/test-universal-runs-multi.ts
// I.9.04.23 — 2 прогона на одном сигнале, изоляция ответов по run_id.
// + наши fix'ы C.0.13.02: B1 (403 чужой dir), B6 (clarify без data → 422),
// B8 (полные поля responses), B4/B5 (signal.directions ограничивает run).
//
// Запуск: pnpm tsx scripts/test-universal-runs-multi.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
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
      throw new Error(
        'Rate limit on login (429). Сбрось: docker compose -f docker/docker-compose.yml ' +
        'exec redis redis-cli --scan --pattern "rate:*" | xargs -r docker compose -f ' +
        'docker/docker-compose.yml exec -T redis redis-cli DEL',
      );
    }
    throw new Error(`Login ${phone}: ${JSON.stringify(data)}`);
  }
  return {
    token: data.access_token,
    participantId: data.participant.id,
    directionId: data.participant.direction_id,
  };
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
  if (res.status === 500) {
    console.error('[500]', path, JSON.stringify(data));
  }
  return { status: res.status, data: data as T };
}

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

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
  if (!row) {throw new Error('No other active direction found');}
  return row.id;
}

async function cleanupWorkerByExternalId(externalId: string): Promise<void> {
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`,
    [externalId],
  );
  if (!p) {return;}
  const pid = p.id;
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1)`, [pid]);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]);
  await query(`DELETE FROM mandates WHERE holder_id = $1`, [pid]);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM cell_members WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009997';
  const password = 'TestMultiRunWorker1';
  const externalId = 'Т90097-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test MultiRun Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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
  let cursor = '0'; let count = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) { await redis.del(...keys); count += keys.length; }
  } while (cursor !== '0');
  if (count > 0) {console.log(`   · rate-limit: очищено ${count} ключей`);}
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

  let signalId: string | null = null;
  let runIds: string[] = [];

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId} (dir=${arch.directionId})`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    // ─── 1. Сигнал без ограничения аудитории ─────────────────
    const sig = await req<{ id: string }>(arch, 'POST', '/signals', {
      type: 'problem',
      description: 'MULTI-RUN TEST: сигнал для проверки двух прогонов',
      justification: 'Проверка run_id в responses',
      priority: 'standard',
    });
    if (sig.status !== 201) {throw new Error('signal create failed');}
    signalId = sig.data.id;
    ok(`Сигнал создан: ${signalId}`);

    // ─── 2. Прогон 1 ────────────────────────────────────────
    const run1 = await req<{ id: string; totalDirections: number }>(
      arch, 'POST', '/universal-runs', { signal_id: signalId, type: 'sequential' },
    );
    if (run1.status !== 201) {throw new Error('run1 failed');}
    runIds.push(run1.data.id);
    ok(`Прогон 1: ${run1.data.id} (total=${run1.data.totalDirections})`);

    // ─── 3. Arch отвечает (свой dir) ────────────────────────
    const r1 = await req(arch, 'POST', `/universal-runs/${run1.data.id}/responses`, {
      direction_id: arch.directionId,
      response: 'support',
      justification: 'Первый прогон: поддержка',
    });
    if (r1.status === 201) {ok('Ответ 1.1 (support)');}
    else {fail(`Ответ 1.1: ${r1.status}`);}

    // ─── 4. Дубль от arch → 409 ─────────────────────────────
    const r1dup = await req(arch, 'POST', `/universal-runs/${run1.data.id}/responses`, {
      direction_id: arch.directionId,
      response: 'object',
      justification: 'Дубль',
    });
    if (r1dup.status === 409) {ok('Дубль в том же прогоне → 409');}
    else {fail(`Дубль: 409 ожидали, ${r1dup.status} получили`);}

    // ─── 5. B1-TEST: worker за чужой dir → 403 ─────────────
    const b1 = await req(worker, 'POST', `/universal-runs/${run1.data.id}/responses`, {
      direction_id: arch.directionId,   // чужой
      response: 'support',
      justification: 'Попытка за чужое направление',
    });
    log('POST /responses { чужой dir } (B1-test)', b1.status, b1.data);
    if (b1.status === 403) {ok('B1: 403 за чужое направление');}
    else {fail(`B1: 403 ожидали, ${b1.status} получили`);}

    // ─── 6. B6-TEST: clarify без data → 422 ────────────────
    const b6 = await req(worker, 'POST', `/universal-runs/${run1.data.id}/responses`, {
      direction_id: worker.directionId,
      response: 'clarify',
      justification: 'Уточнение без data',
    });
    log('POST /responses { clarify без data } (B6-test)', b6.status, b6.data);
    if (b6.status === 422) {ok('B6: clarify без data → 422');}
    else {fail(`B6: 422 ожидали, ${b6.status} получили`);}

    // ─── 7. Прогон 2 (тот же сигнал) ───────────────────────
    const run2 = await req<{ id: string; totalDirections: number }>(
      arch, 'POST', '/universal-runs', { signal_id: signalId, type: 'sequential' },
    );
    if (run2.status !== 201) {throw new Error('run2 failed');}
    runIds.push(run2.data.id);
    ok(`Прогон 2: ${run2.data.id}`);

    // ─── 8. Arch отвечает и во 2-м прогоне (run_id работает) ─
    const r2 = await req(arch, 'POST', `/universal-runs/${run2.data.id}/responses`, {
      direction_id: arch.directionId,
      response: 'object',
      justification: 'Второй прогон: возражение',
    });
    if (r2.status === 201) {ok('Тот же direction_id во 2-м прогоне → 201 (run_id работает)');}
    else {fail(`Ожидался 201, получено ${r2.status}`);}

    // ─── 9. Агрегация изолирована ───────────────────────────
    const agg1 = await req<{ support: number; object: number; total: number }>(
      arch, 'GET', `/universal-runs/${run1.data.id}/aggregate`,
    );
    const agg2 = await req<{ support: number; object: number; total: number }>(
      arch, 'GET', `/universal-runs/${run2.data.id}/aggregate`,
    );
    if (agg1.data.total === 1 && agg1.data.support === 1 && agg1.data.object === 0) {
      ok('Агрегация прогона 1 изолирована (support=1)');
    } else { fail(`Агрегация прогона 1: ${JSON.stringify(agg1.data)}`); }
    if (agg2.data.total === 1 && agg2.data.support === 0 && agg2.data.object === 1) {
      ok('Агрегация прогона 2 изолирована (object=1)');
    } else { fail(`Агрегация прогона 2: ${JSON.stringify(agg2.data)}`); }

    // ─── 10. B8-TEST: listRunResponses — полные поля ───────
    const list1 = await req<{ data: Array<{ data?: unknown; consequences?: unknown; needs?: unknown }> }>(
      arch, 'GET', `/universal-runs/${run1.data.id}/responses`,
    );
    if (list1.data.data?.length === 1) {
      const first = list1.data.data[0]!;
      if ('data' in first && 'consequences' in first && 'needs' in first) {
        ok('B8: listRunResponses возвращает полные поля (data/consequences/needs)');
      } else { fail('B8: неполные поля в listRunResponses'); }
    } else { fail(`listRunResponses: ${list1.data.data?.length} элементов`); }

    // ─── 11. B4/B5-TEST: ограниченная аудитория ─────────────
    //     Сигнал с directions=[arch.directionId] → total=1, worker → 403
    const sig2 = await req<{ id: string }>(arch, 'POST', '/signals', {
      type: 'problem',
      description: 'MULTI-RUN TEST: ограниченная аудитория',
      justification: 'Проверка signal.directions',
      priority: 'standard',
      directions: [arch.directionId],
    });
    if (sig2.status !== 201) {throw new Error('signal 2 failed');}
    const sig2Id = sig2.data.id;

    const run3 = await req<{ id: string; totalDirections: number }>(
      arch, 'POST', '/universal-runs', { signal_id: sig2Id, type: 'sequential' },
    );
    if (run3.status !== 201) {throw new Error('run3 failed');}
    runIds.push(run3.data.id);
    log('POST /universal-runs (limited directions)', run3.status, {
      id: run3.data.id, totalDirections: run3.data.totalDirections,
    });
    if (run3.data.totalDirections === 1) {
      ok('B4: totalDirections=1 (уважает signal.directions)');
    } else {
      fail(`B4: totalDirections=${run3.data.totalDirections}, ожидали 1`);
    }

    const b5 = await req(worker, 'POST', `/universal-runs/${run3.data.id}/responses`, {
      direction_id: worker.directionId,   // свой, но вне аудитории
      response: 'support',
      justification: 'Попытка ответить вне аудитории',
    });
    log('POST /responses (вне аудитории) (B5-test)', b5.status, b5.data);
    if (b5.status === 403) {ok('B5: 403 вне аудитории signal.directions');}
    else {fail(`B5: 403 ожидали, ${b5.status} получили`);}

    // ─── 12. Cleanup сигналов через БД ──────────────────────
    //     (в finally, чтобы не оставлять мусор)

    console.log('\n✅ Тест multi-run завершён');
  } finally {
    // ─── Cleanup ────────────────────────────────────────────
    try {
      if (runIds.length > 0) {
        await query(`DELETE FROM responses WHERE run_id = ANY($1::uuid[])`, [runIds]);
        await query(`DELETE FROM universal_runs WHERE id = ANY($1::uuid[])`, [runIds]);
      }
      if (signalId) {
        await query(`DELETE FROM signals WHERE id = $1`, [signalId]);
      }
      // Сигнал 2 (limited) не сохраняем в переменную — удалим по description.
      await query(`DELETE FROM responses WHERE signal_id IN (
        SELECT id FROM signals WHERE description LIKE 'MULTI-RUN TEST%'
      )`);
      await query(`DELETE FROM universal_runs WHERE signal_id IN (
        SELECT id FROM signals WHERE description LIKE 'MULTI-RUN TEST%'
      )`);
      await query(`DELETE FROM signals WHERE description LIKE 'MULTI-RUN TEST%'`);

      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: signals/runs/responses + worker ${workerInfo.externalId}`);
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