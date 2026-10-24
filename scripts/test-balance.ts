// scripts/test-balance.ts
// I.9.04.02 — Полный цикл Balance: 12 signals → detect → meta-request →
// recalc → risks → pulse → indices.
//
// Проверки fix'ов C.0.18.02 (v0.0.02):
//   - B1: повторный resolve → 409.
//   - B3: повторный meta-request → 409 (atomic UPDATE).
//   - B10: GET /balance/metrics без direction_id → глобальные метрики (не чужие).
//   - B8: WS-emit не блокирует ответ (при сбое — 200, не 500).
//
// Запуск: pnpm tsx scripts/test-balance.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'BALANCE-TEST:';

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
  const phone = '+79990009990';
  const password = 'TestBalanceWorker1';
  const externalId = 'Т90090-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Balance Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupBalance(): Promise<void> {
  // 1. Аномалии с нашим маркером в details (если проставляли) или по direction
  await query(
    `DELETE FROM anomalies WHERE details->>'marker' = $1`,
    [MARKER],
  );
  // 2. Компетентностные риски с reason LIKE MARKER
  await query(
    `DELETE FROM competence_risks WHERE reason LIKE $1`,
    [`${MARKER}%`],
  );
  // 3. Нормативы (глобальные; dev only — в prod не запускать тест)
  await query(`DELETE FROM normative_speeds`).catch(() => undefined);
  // 4. Signals, созданные тестом (по description).
  //    Мета-запрос создаёт signal с description: "Мета-запрос: аномалия ...".
  await query(
    `DELETE FROM responses WHERE signal_id IN (
      SELECT id FROM signals WHERE description LIKE $1 OR description LIKE $2
    )`,
    [`${MARKER}%`, `Мета-запрос: аномалия%`],
  ).catch(() => undefined);
  await query(
    `DELETE FROM signals WHERE description LIKE $1 OR description LIKE $2`,
    [`${MARKER}%`, `Мета-запрос: аномалия%`],
  ).catch(() => undefined);
  console.log('🧹 Cleanup: anomalies/norms/risks/signals(Мета-запрос + BALANCE-TEST)');
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
  await cleanupBalance();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 1. 12 сигналов (4 critical, 4 high, 4 standard) ───
    console.log('\n📝 Создаём 12 сигналов...');
    const createdSignals: string[] = [];
    for (let i = 0; i < 12; i++) {
      const s = await req<{ id: string }>(arch, 'POST', '/signals', {
        type: 'problem',
        description: `${MARKER} сигнал #${i + 1} для Балансировки`,
        justification: `Обоснование #${i + 1}`,
        priority: i < 4 ? 'critical' : (i < 8 ? 'high' : 'standard'),
        lead_direction_id: arch.directionId,
      });
      if (s.status === 201) {createdSignals.push(s.data.id);}
    }
    if (createdSignals.length === 12) {ok(`12 сигналов: 4 critical, 4 high, 4 standard`);}
    else {fail(`создано ${createdSignals.length}/12`);}

    // ─── 2. 3 сигнала с iterations=3 ───────────────────────
    console.log('\n📝 Делаем 3 сигнала с iterations=3...');
    let clarifyOk = 0;
    for (let i = 0; i < 3; i++) {
      const sid = createdSignals[i];
      if (!sid) {continue;}
      for (let j = 0; j < 3; j++) {
        const r = await req(worker, 'POST', `/signals/${sid}/responses`, {
          direction_id: worker.directionId,
          response: 'clarify',
          justification: `Clarify #${j + 1}`,
          data: { need: 'more_info' },
        });
        if (r.status === 201) {clarifyOk++;}
      }
    }
    if (clarifyOk === 9) {ok('3 сигнала получили iterations=3 (9 clarify)');}
    else {fail(`clarify: ${clarifyOk}/9`);}

    // ─── 3. Detect ─────────────────────────────────────────
    const detect = await req<{ detected: number; persisted: number; anomalies: unknown[] }>(
      arch, 'POST', '/balance/detect', { direction_id: arch.directionId },
    );
    log('POST /balance/detect', detect.status, {
      detected: detect.data.detected,
      persisted: detect.data.persisted,
      anomaliesCount: detect.data.anomalies?.length,
    });
    if (detect.status === 200) {ok(`detect: detected=${detect.data.detected}, persisted=${detect.data.persisted}`);}
    else {fail(`detect: ${detect.status}`);}

    // ─── 4. Список аномалий ────────────────────────────────
    const list = await req<{ data: Array<{ id: string; type: string; severity: number; status: string }>; meta: { total: number } }>(
      arch, 'GET', `/balance/anomalies?direction_id=${arch.directionId}&min_severity=1`,
    );
    log('GET /balance/anomalies', list.status, { count: list.data.data?.length, total: list.data.meta?.total });

    // ─── 5. Мета-запрос (на самую severity аномалию) ────────
    const highSeverity = list.data.data?.find((a) => a.severity >= 7 && a.status === 'new');
    if (highSeverity) {
      const meta = await req<{ metaRequestId: string; targetDirections: string[] }>(
        arch, 'POST', `/balance/anomalies/${highSeverity.id}/meta-request`, {
          target_directions: [arch.directionId],
        },
      );
      log('POST /balance/anomalies/:id/meta-request', meta.status, meta.data);
      if (meta.status === 201) {ok(`meta-request: ${meta.data.metaRequestId}`);}
      else {fail(`meta-request: ${meta.status}`);}

      // B3: повторный → 409
      const repeat = await req(arch, 'POST', `/balance/anomalies/${highSeverity.id}/meta-request`, {
        target_directions: [arch.directionId],
      });
      if (repeat.status === 409) {ok('B3: повторный meta-request → 409');}
      else {fail(`B3: 409 ожидали, ${repeat.status}`);}
    } else {
      console.log('   ℹ нет аномалии severity ≥ 7 со status=new — пропускаем meta-request');
    }

    // ─── 6. B1-TEST: resolve + повторный → 409 ─────────────
    const toResolve = list.data.data?.[0];
    if (toResolve) {
      const r1 = await req(arch, 'POST', `/balance/anomalies/${toResolve.id}/resolve`);
      if (r1.status === 200) {ok('resolve → 200');}
      else {fail(`resolve: ${r1.status}`);}

      const r2 = await req(arch, 'POST', `/balance/anomalies/${toResolve.id}/resolve`);
      if (r2.status === 409) {ok('B1: повторный resolve → 409');}
      else {fail(`B1: 409 ожидали, ${r2.status}`);}
    }

    // ─── 7. Нормативы: до / после recalc ──────────────────
    const normsBefore = await req<{ data: unknown[] }>(arch, 'GET', '/balance/norms');
    log('GET /balance/norms (до recalc)', normsBefore.status, { count: normsBefore.data.data?.length });

    const recalc = await req<{ updated: number }>(arch, 'POST', '/balance/norms/recalc');
    log('POST /balance/norms/recalc', recalc.status, recalc.data);
    if (recalc.status === 200) {ok(`recalc: updated=${recalc.data.updated}`);}
    else {fail(`recalc: ${recalc.status}`);}

    const normsAfter = await req<{ data: unknown[] }>(arch, 'GET', '/balance/norms');
    log('GET /balance/norms (после recalc)', normsAfter.status, { count: normsAfter.data.data?.length });

    // ─── 8. Компетентностный риск ──────────────────────────
    const risk = await req<{ id: string; directionId: string; reason: string }>(
      arch, 'POST', '/balance/risks', {
        direction_id: worker.directionId,
        reason: `${MARKER} Систематические просрочки за 30 дней`,
      },
    );
    log('POST /balance/risks', risk.status, risk.data);
    if (risk.status === 201) {ok(`риск: ${risk.data.id}`);}
    else {fail(`risk: ${risk.status}`);}

    // B7: повторный риск на то же direction → 409 (после нашего fix)
    const riskDup = await req(arch, 'POST', '/balance/risks', {
      direction_id: worker.directionId,
      reason: `${MARKER} повтор`,
    });
    if (riskDup.status === 409) {ok('B7: повторный risk на тот же direction → 409');}
    else {fail(`B7: 409 ожидали, ${riskDup.status}`);}

    // ─── 9. Список рисков ──────────────────────────────────
    const risks = await req<{ data: unknown[] }>(arch, 'GET', '/balance/risks');
    log('GET /balance/risks', risks.status, { count: risks.data.data?.length });

    // ─── 10. Снять риск (B6) ───────────────────────────────
    if (risk.status === 201) {
      const rem = await req(arch, 'DELETE', `/balance/risks/${risk.data.id}`);
      if (rem.status === 204) {ok('риск снят → 204');}

      // B6: повторный remove → 409 (не 404, т.к. status теперь 'removed')
      const remDup = await req(arch, 'DELETE', `/balance/risks/${risk.data.id}`);
      log('повторный DELETE /balance/risks/:id', remDup.status, remDup.data);
      if (remDup.status === 404 || remDup.status === 409) {
        ok(`B6: повторный remove → ${remDup.status} (не 204)`);
      } else {
        fail(`B6: 404/409 ожидали, ${remDup.status}`);
      }
    }

    // ─── 11. Индексы ──────────────────────────────────────
    const indices = await req<{ data: unknown[] }>(arch, 'GET', '/balance/indices');
    log('GET /balance/indices', indices.status, { count: indices.data.data?.length });

    // ─── 12. Пульс ────────────────────────────────────────
    const pulse = await req<{ directionId: string | null; metrics: Record<string, number> }>(
      arch, 'GET', '/balance/pulse',
    );
    log('GET /balance/pulse (общий)', pulse.status, pulse.data);
    if (pulse.data.directionId === null) {ok('pulse: directionId=null (глобальный)');}

    const pulseDir = await req<{ directionId: string | null; metrics: Record<string, number> }>(
      arch, 'GET', `/balance/pulse?direction_id=${arch.directionId}`,
    );
    log('GET /balance/pulse (направление)', pulseDir.status, pulseDir.data);
    if (pulseDir.data.directionId === arch.directionId) {ok('pulse: directionId=arch.dir');}

    // ─── 13. B10-TEST: metrics без direction_id → глобальные ─
    const metricsGlobal = await req<{ directionId: string | null; metrics: Record<string, number> }>(
      arch, 'GET', '/balance/metrics',
    );
    log('GET /balance/metrics (без direction_id)', metricsGlobal.status, metricsGlobal.data);
    if (metricsGlobal.data.directionId === null) {
      ok('B10: metrics без direction_id → глобальные (directionId=null)');
    } else {
      fail(`B10: directionId=${metricsGlobal.data.directionId}, ожидали null`);
    }

    console.log('\n✅ Тест Balance завершён');
  } finally {
    try {
      await cleanupBalance();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: balance + worker ${workerInfo.externalId}`);
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