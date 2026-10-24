// scripts/test-goods.ts
// I.9.04.09 — Полный цикл: create → components → test → approve → liquidate
// → history → project-resource → triple-sign.
//
// Проверки fix'ов C.0.15.02 (v0.0.02):
//   - B1: signProjectResource — signer = auth.participantId (body.signer_id удалён).
//   - B2: good_history пишется на каждой мутации; version инкрементится.
//   - B5: liquidate — verifier_id должен иметь VERIFIER/FIRST_ARCHITECT.
//   - B6: sign role='council' требует COUNCIL_MEMBER (или FIRST_ARCHITECT).
//   - B4: addComponent — atomic (проверяется неявно, 2 компонента).
//
// Запуск: pnpm tsx scripts/test-goods.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'GOODS-TEST:';

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
  const phone = '+79990009994';
  const password = 'TestGoodsWorker123';
  const externalId = 'Т90094-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Goods Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

// ─── Cleanup goods ──────────────────────────────────────────────

async function cleanupGoods(): Promise<void> {
  await query(
    `DELETE FROM good_history WHERE good_id IN (SELECT id FROM goods WHERE name LIKE $1)`,
    [`${MARKER}%`],
  );
  try {
    await query(
      `DELETE FROM good_requests WHERE good_id IN (SELECT id FROM goods WHERE name LIKE $1)`,
      [`${MARKER}%`],
    );
  } catch { /* таблицы может не быть */ }
  await query(`DELETE FROM goods WHERE name LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM project_resources WHERE resource->>'marker' = $1`, [MARKER]);
  try {
    await query(`DELETE FROM plans WHERE title LIKE $1`, [`${MARKER}%`]);
  } catch { /* */ }
  console.log('🧹 Cleanup: goods/plans/project-resources');
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
  await cleanupGoods();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    // ─── 1. Создать благо ────────────────────────────────
    const good = await req<{ id: string; status: string; version: number }>(
      arch, 'POST', '/goods', {
        name: `${MARKER} Тестовый модуль`,
        type: 'material',
        producer_direction_id: arch.directionId,
        description: 'Модуль для тестирования Goods',
      },
    );
    if (good.status !== 201) { log('goods', good.status, good.data); throw new Error('goods create failed'); }
    const goodId = good.data.id;
    ok(`Благо создано: ${goodId}, status=${good.data.status}, version=${good.data.version}`);
    if (good.data.status === 'draft' && good.data.version === 1) {ok('draft, version=1');}

    // ─── 2. B2-TEST: history после create ────────────────
    const h1 = await req<{ data: Array<{ version: number; changes: Record<string, unknown> }> }>(
      arch, 'GET', `/goods/${goodId}/history`,
    );
    log('GET /history (после create)', h1.status, { count: h1.data.data?.length });
    if (h1.data.data?.length >= 1 && h1.data.data[0]?.changes?.['created']) {
      ok('B2: history[0] = created');
    } else {
      fail(`B2: history пуста после create (count=${h1.data.data?.length})`);
    }

    // ─── 3. Компонент 1 ──────────────────────────────────
    const c1 = await req<{ components: unknown[]; version: number }>(
      arch, 'POST', `/goods/${goodId}/component`, {
        part: 'Корпус', description: 'Алюминиевый, 3 мм',
      },
    );
    if (c1.data.components?.length === 1 && c1.data.version === 2) {
      ok(`B4: компонент #1, version=2`);
    } else {
      fail(`B4: components=${c1.data.components?.length}, version=${c1.data.version}`);
    }

    // ─── 4. Компонент 2 ──────────────────────────────────
    const c2 = await req<{ components: unknown[]; version: number }>(
      arch, 'POST', `/goods/${goodId}/component`, {
        part: 'Плата управления', description: 'STM32',
      },
    );
    if (c2.data.components?.length === 2 && c2.data.version === 3) {
      ok(`B4: компонент #2, version=3`);
    }

    // ─── 5. Approve на draft → 409 ──────────────────────
    const badApprove = await req(arch, 'POST', `/goods/${goodId}/approve`);
    if (badApprove.status === 409) {ok('Approve на draft → 409');}

    // ─── 6. Test ────────────────────────────────────────
    const tested = await req<{ status: string; version: number }>(
      arch, 'POST', `/goods/${goodId}/test`,
    );
    if (tested.data.status === 'test' && tested.data.version === 4) {
      ok(`test → status=test, version=4`);
    }

    // ─── 7. Approve ─────────────────────────────────────
    const approved = await req<{ status: string; version: number }>(
      arch, 'POST', `/goods/${goodId}/approve`,
    );
    if (approved.data.status === 'active' && approved.data.version === 5) {
      ok(`approve → status=active, version=5`);
    }

    // ─── 8. Повторный test → 409 ────────────────────────
    const reTest = await req(arch, 'POST', `/goods/${goodId}/test`);
    if (reTest.status === 409) {ok('повторный test на active → 409');}

    // ─── 9. B2-TEST: history после 4 мутаций ────────────
    const h2 = await req<{ data: unknown[] }>(arch, 'GET', `/goods/${goodId}/history`);
    log('GET /history (после 4 мутаций)', h2.status, { count: h2.data.data?.length });
    if ((h2.data.data?.length ?? 0) >= 5) {
      ok(`B2: history содержит ${h2.data.data?.length} записей (versions 1..5)`);
    } else {
      fail(`B2: history содержит ${h2.data.data?.length}, ожидали >= 5`);
    }

    // ─── 10. Список ─────────────────────────────────────
    const list = await req<{ data: unknown[]; meta: { total: number } }>(arch, 'GET', '/goods');
    if ((list.data.data?.length ?? 0) >= 1) {ok(`В списке ${list.data.data?.length} благ`);}

    // ─── 11. Liquidate с arch как verifier (FIRST_ARCHITECT — ок) ─
    const liquidated = await req<{ status: string }>(
      arch, 'POST', `/goods/${goodId}/liquidate`, {
        reason: 'Тестовая ликвидация',
        verifier_id: arch.participantId,
      },
    );
    if (liquidated.data.status === 'liquidated') {
      ok('liquidate с arch (FIRST_ARCHITECT) → 200, status=liquidated');
    }

    // ─── 12. B5-TEST: liquidate с worker (без VERIFIER) → 422 ─
    //     Создадим второе благо и попробуем ликвидировать с worker.
    const good2 = await req<{ id: string }>(arch, 'POST', '/goods', {
      name: `${MARKER} Модуль для B5`,
      type: 'material',
      producer_direction_id: arch.directionId,
    });
    if (good2.status === 201) {
      const b5 = await req(arch, 'POST', `/goods/${good2.data.id}/liquidate`, {
        reason: 'b5-test',
        verifier_id: worker.participantId,   // ← worker не VERIFIER
      });
      log('liquidate с worker-as-verifier (B5-test)', b5.status, b5.data);
      if (b5.status === 422) {ok('B5: worker без VERIFIER → 422');}
      else {fail(`B5: 422 ожидали, ${b5.status} получили`);}
    }

    // ─── 13. Компонент в liquidated → 409 ───────────────
    const badComp = await req(arch, 'POST', `/goods/${goodId}/component`, {
      part: 'x', description: 'x',
    });
    if (badComp.status === 409) {ok('компонент в liquidated → 409');}

    // ─── 14. Проектный ресурс ───────────────────────────
    const plan = await req<{ id: string }>(arch, 'POST', '/plans', {
      type: 'standard',
      title: `${MARKER} план`,
      expected_result: 'ok',
      lead_direction_id: arch.directionId,
    });
    if (plan.status !== 201) { log('plan', plan.status, plan.data); throw new Error('plan failed'); }

    const pr = await req<{ id: string; status: string }>(
      arch, 'POST', '/project-resources', {
        plan_id: plan.data.id,
        resource: { marker: MARKER, name: 'Стальной лист 10м²', amount: 100 },
      },
    );
    if (pr.status !== 201) {throw new Error('pr create failed');}
    const prId = pr.data.id;
    ok(`Проектный ресурс: ${prId}, status=${pr.data.status}`);

    // ─── 15. B6-TEST: sign role='council' worker'ом → 403 ─
    const b6 = await req(worker, 'POST', `/project-resources/${prId}/sign`, {
      role: 'council',   // ← worker без COUNCIL_MEMBER
    });
    log('sign council worker (B6-test)', b6.status, b6.data);
    if (b6.status === 403) {ok('B6: worker без COUNCIL_MEMBER → 403');}
    else {fail(`B6: 403 ожидали, ${b6.status} получили`);}

    // ─── 16. B1-TEST: signer_id в body больше не работает ─
    //     Отправим signer_id как extra-key — Zod его strip'нет, signer = auth.
    //     Проверим: council_sign будет = arch.participantId, НЕ worker.id.
    const s1 = await req<{ councilSign: string | null; status: string }>(
      arch, 'POST', `/project-resources/${prId}/sign`, {
        role: 'council',
        signer_id: worker.participantId,   // ← попытка подписать за другого
      },
    );
    log('sign council с fake signer_id (B1-test)', s1.status, {
      councilSign: s1.data.councilSign,
      status: s1.data.status,
    });
    if (s1.data.councilSign === arch.participantId) {
      ok('B1: signer_id из body проигнорирован (подписал auth.participantId)');
    } else {
      fail(`B1: councilSign=${s1.data.councilSign}, ожидали ${arch.participantId}`);
    }

    // ─── 17. Подпись 2: balance ─────────────────────────
    const s2 = await req<{ status: string }>(
      arch, 'POST', `/project-resources/${prId}/sign`, { role: 'balance' },
    );
    if (s2.data.status === 'pending') {ok('подпись balance, status=pending');}

    // ─── 18. Подпись 3: verifier → signed ───────────────
    const s3 = await req<{ status: string; verifierSign: string | null }>(
      arch, 'POST', `/project-resources/${prId}/sign`, { role: 'verifier' },
    );
    if (s3.data.status === 'signed') {ok('тройная подпись → status=signed');}

    // ─── 19. Повторная подпись council → 409 (status уже signed) ─
    const sRepeat = await req(arch, 'POST', `/project-resources/${prId}/sign`, { role: 'council' });
    log('повторная council sign', sRepeat.status, sRepeat.data);
    if (sRepeat.status === 409) {ok('повторная подпись → 409 (status=signed)');}
    else {fail(`повторная: 409 ожидали, ${sRepeat.status}`);}

    console.log('\n✅ Тест Goods завершён');
  } finally {
    try {
      await cleanupGoods();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: goods/plans/pr + worker ${workerInfo.externalId}`);
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