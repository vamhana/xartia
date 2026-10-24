// I.9.04.05 scripts/test-connections.ts
// Полный цикл: сигнал → Коннект → позиции → диагностика → результат →
// протокол → Арбитраж.
//
// Worker создаётся автоматически (ASSOCIATED), затем ему выдаётся мандат
// COUNCIL_MEMBER на 1 час (даёт connection:C). В finally — полный cleanup.
//
// Проверки (I.9.04.05 + наши fix'ы):
//   - B1: signals.run → connect после startConnection (транзакция)
//   - B3: позиция за чужое направление → 403
//   - B2: 2 позиции → status='diagnostics'
//   - entity: дубль позиции от того же dir → 409
//   - B4: повторная diagnostic → 409
//   - B5: setResult → status='finished'
//   - B6: protocol только для finished
//   - Arbitrations (A.1.12.01) — submit → start → decision → escalate
//
// Запуск: pnpm tsx scripts/test-connections.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';
import { invalidateCache as invalidateRbacCache } from '../src/security/rbac.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Client {
  token: string;
  participantId: string;
  directionId: string;
}

interface WorkerInfo {
  id: string;
  externalId: string;
  phone: string;
  password: string;
  directionId: string;
}

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
    if (res.status === 429) {
      throw new Error(
        `Rate limit on login (429). Сбрось: docker compose -f docker/docker-compose.yml ` +
        `exec redis redis-cli --scan --pattern "rate:*" | xargs -r docker compose -f ` +
        `docker/docker-compose.yml exec -T redis redis-cli DEL`,
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
  // FK-зависимости (без ON DELETE CASCADE).
  await query(`DELETE FROM cooldowns WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM rotations WHERE mandate_id IN (SELECT id FROM mandates WHERE holder_id = $1)`, [pid]);
  await query(`DELETE FROM delegations WHERE from_id = $1 OR to_id = $1`, [pid]);
  await query(`DELETE FROM mandates WHERE holder_id = $1`, [pid]);
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM cell_members WHERE participant_id = $1`, [pid]);
  await query(`DELETE FROM participants WHERE id = $1`, [pid]);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009998';
  const password = 'TestConnWorker123';
  const externalId = 'Т90098-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);   // следы прошлого прогона

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Connections Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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
  let cursor = '0';
  let count = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
      count += keys.length;
    }
  } while (cursor !== '0');
  if (count > 0) {console.log(`   · rate-limit: очищено ${count} ключей (dev)`);}
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
  console.log(`     phone=${workerInfo.phone}, password=${workerInfo.password}`);

  await resetRateLimit();

  let workerMandateId: string | null = null;

  try {
    // ─── Логин ────────────────────────────────────────────────
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId} (dir=${arch.directionId})`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    if (arch.directionId === worker.directionId) {
      throw new Error('Arch и Worker в одном направлении — B3-тест невозможен');
    }

    // ─── Мандат COUNCIL_MEMBER для worker (даёт connection:C) ─
    const workerMandate = await req<{ id: string; function: string }>(
      arch, 'POST', '/mandates', {
        function: 'COUNCIL_MEMBER',
        holder_id: worker.participantId,
        direction_id: worker.directionId,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
    );
    if (workerMandate.status !== 201) {
      fail(`Не выдан мандат: ${workerMandate.status} ${JSON.stringify(workerMandate.data)}`);
      throw new Error('mandate creation failed');
    }
    workerMandateId = workerMandate.data.id;
    ok(`Worker получил мандат COUNCIL_MEMBER: ${workerMandateId}`);

    // Сброс RBAC-кэша — requireRight должен увидеть новую роль.
    await invalidateRbacCache(worker.participantId);
    await new Promise((r) => setTimeout(r, 100));

    // ─── 1. Сигнал + route ────────────────────────────────────
    const signal = await req<{ id: string }>(arch, 'POST', '/signals', {
      type: 'problem',
      description: 'Разногласие по узлу A',
      justification: 'Два направления расходятся в оценке',
      priority: 'standard',
    });
    if (signal.status !== 201) { log('signal', signal.status, signal.data); throw new Error('signal failed'); }
    const signalId = signal.data.id;
    ok(`Сигнал создан: ${signalId}`);

    await req(arch, 'POST', `/signals/${signalId}/route`, { target_direction_id: arch.directionId });
    ok('Сигнал маршрутизирован');

    // ─── 2. Start connection ──────────────────────────────────
    const conn = await req<{ id: string; status: string }>(
      arch, 'POST', '/connections',
      { signal_id: signalId, moderator_id: arch.participantId },
    );
    log('POST /connections', conn.status, conn.data);
    if (conn.status !== 201) { fail('start failed'); throw new Error('connection start failed'); }
    const connectionId = conn.data.id;
    ok(`Коннект запущен: ${connectionId}, status=${conn.data.status}`);

    // ─── 3. signals.run → connect (B1) ────────────────────────
    const sigAfter = await req<{ status: string }>(arch, 'GET', `/signals/${signalId}`);
    if (sigAfter.data.status === 'connect') { ok('B1: signals.run → connect'); }
    else { fail(`B1: signals.status=${sigAfter.data.status}, ожидали 'connect'`); }

    // ─── 4. Position #1 от arch (свой dir) ────────────────────
    const pos1 = await req<{ status: string; positions: unknown[] }>(
      arch, 'POST', `/connections/${connectionId}/position`, {
        direction_id: arch.directionId,
        claim: 'Узел A требует детали B',
        data: 'Нагрузка 500 Н, деталь C не подходит',
        cause: 'Проектная ошибка в спецификации',
        needs: 'Пересмотр спецификации',
      },
    );
    log('POST /position #1 (arch, свой dir)', pos1.status, {
      status: pos1.data.status, positionsCount: pos1.data.positions?.length,
    });
    if (pos1.status === 200) { ok('Позиция #1 добавлена'); }
    if (pos1.data.status === 'started') { ok('status=started (нужна 2-я позиция)'); }

    // ─── 5. B3-TEST: worker пишет за ЧУЖОЕ направление → 403 ──
    const posB3 = await req(worker, 'POST', `/connections/${connectionId}/position`, {
      direction_id: arch.directionId,   // ← чужое
      claim: 'x', data: 'x', cause: 'x', needs: 'x',
    });
    log('POST /position { чужой dir } (B3-test)', posB3.status, posB3.data);
    if (posB3.status === 403) { ok('B3: 403 за чужое направление'); }
    else { fail(`B3: 403 ожидали, ${posB3.status} получили`); }

    // ─── 6. Position #2 от worker (свой dir) → diagnostics ───
    const pos2 = await req<{ status: string; positions: unknown[] }>(
      worker, 'POST', `/connections/${connectionId}/position`, {
        direction_id: worker.directionId,
        claim: 'Узел A работает с деталью C',
        data: 'Проверено на стенде — держит 500 Н',
        cause: 'Разница в методике испытаний',
        needs: 'Единая методика',
      },
    );
    log('POST /position #2 (worker, свой dir)', pos2.status, {
      status: pos2.data.status, positionsCount: pos2.data.positions?.length,
    });
    if (pos2.status === 200) { ok('Позиция #2 добавлена'); }
    if (pos2.data.status === 'diagnostics') { ok('B2: status → diagnostics (2 позиции)'); }

    // ─── 7. Дубль позиции от arch → 409 (entity) ─────────────
    const posDup = await req(arch, 'POST', `/connections/${connectionId}/position`, {
      direction_id: arch.directionId,
      claim: 'x', data: 'x', cause: 'x', needs: 'x',
    });
    log('POST /position (дубль arch)', posDup.status, posDup.data);
    if (posDup.status === 409) { ok('Дубль позиции → 409'); }
    else { fail(`Дубль: 409 ожидали, ${posDup.status} получили`); }

    // ─── 8. finishDiagnostics → finished ─────────────────────
    const fin = await req<{ status: string; cause: string }>(
      arch, 'POST', `/connections/${connectionId}/diagnostic`,
      { cause: 'Разница в методике испытаний — единая методика отсутствует' },
    );
    log('POST /diagnostic', fin.status, fin.data);
    if (fin.data.status === 'finished') { ok('status=finished'); }

    // ─── 9. setResult='incompatible' → finished (B5) ─────────
    const res = await req<{ result: string; status: string }>(
      arch, 'POST', `/connections/${connectionId}/result`,
      { result: 'incompatible' },
    );
    log('POST /result { incompatible }', res.status, res.data);
    if (res.data.result === 'incompatible') { ok('result=incompatible'); }
    if (res.data.status === 'finished') { ok('B5: setResult → status=finished'); }

    // ─── 10. attachProtocol (finished + result) ─────────────
    const proto = await req(
      arch, 'POST', `/connections/${connectionId}/protocol`,
      { protocol: { methodology: 'ISO-XXX', findings: ['причина 1', 'причина 2'] } },
    );
    log('POST /protocol', proto.status, proto.data);
    if (proto.status === 200) { ok('Протокол прикреплён'); }

    // ─── 11. Повторная diagnostic → 409 (B4) ────────────────
    const repeatDiag = await req(arch, 'POST', `/connections/${connectionId}/diagnostic`, { cause: 'x' });
    if (repeatDiag.status === 409) { ok('B4: повторная diagnostic → 409'); }
    else { fail(`B4: 409 ожидали, ${repeatDiag.status} получили`); }

    // ─── 12. Арбитраж: submit ───────────────────────────────
    const arb = await req<{ id: string; type: string; status: string; deadline: string }>(
      arch, 'POST', '/arbitrations', {
        type: 'procedural',
        connection_id: connectionId,
        signal_id: signalId,
        parties: [arch.directionId, worker.directionId],
        question: 'Чья методика испытаний применяется к узлу A?',
      },
    );
    log('POST /arbitrations', arb.status, arb.data);
    if (arb.status !== 201) { fail('arbitration failed'); throw new Error('arbitration failed'); }
    const arbId = arb.data.id;
    ok(`Арбитраж подан: ${arbId}, status=${arb.data.status}`);

    // ─── 13. Deadline = +3ч ─────────────────────────────────
    const deadlineMs = new Date(arb.data.deadline).getTime();
    const diffHours = (deadlineMs - Date.now()) / 3_600_000;
    if (diffHours > 2.9 && diffHours <= 3.0) { ok(`Deadline = +${diffHours.toFixed(2)}ч`); }
    else { fail(`Deadline: ${diffHours.toFixed(2)}ч, ожидали ~3`); }

    // ─── 14. start → in_progress ────────────────────────────
    const start = await req<{ status: string }>(arch, 'POST', `/arbitrations/${arbId}/start`);
    if (start.data.status === 'in_progress') { ok('Арбитраж в работе'); }

    // ─── 15. decision → decided ─────────────────────────────
    const decided = await req<{ status: string; decision: string | null }>(
      arch, 'POST', `/arbitrations/${arbId}/decision`,
      { decision: 'Применяется методика ISO-XXX.' },
    );
    log('POST /arbitrations/:id/decision', decided.status, decided.data);
    if (decided.data.status === 'decided') { ok('status=decided'); }

    // ─── 16. Повторное decision → 409 ───────────────────────
    const repeat = await req(arch, 'POST', `/arbitrations/${arbId}/decision`, { decision: 'Другое' });
    if (repeat.status === 409) { ok('Повторное decision → 409'); }

    // ─── 17. precedents ─────────────────────────────────────
    const prec = await req<{ data: unknown[] }>(arch, 'GET', '/arbitrations/precedents');
    log('GET /arbitrations/precedents', prec.status, { count: prec.data.data?.length });
    if ((prec.data.data?.length ?? 0) >= 1) { ok('Прецедент зафиксирован'); }

    // ─── 18. overdue (пусто) ────────────────────────────────
    const overdue = await req<{ data: unknown[] }>(arch, 'GET', '/arbitrations/overdue');
    if ((overdue.data.data?.length ?? 0) === 0) { ok('Просроченных нет'); }

    // ─── 19. ownership → jury escalate ──────────────────────
    const arb2 = await req<{ id: string; type: string }>(arch, 'POST', '/arbitrations', {
      type: 'ownership',
      signal_id: signalId,
      question: 'Чья компетенция — узел A?',
    });
    const juryEsc = await req<{ arbitration: { status: string } }>(
      arch, 'POST', `/arbitrations/${arb2.data.id}/escalate`, { reason: 'Требуется Жюри' },
    );
    log('POST /arbitrations/:id/escalate (ownership)', juryEsc.status, juryEsc.data);
    if (juryEsc.data.arbitration.status === 'escalated_to_jury') {
      ok('ownership → escalated_to_jury');
    }

    // ─── 20. procedural → jury escalate → 409 ───────────────
    const arb3 = await req<{ id: string }>(arch, 'POST', '/arbitrations', {
      type: 'procedural',
      connection_id: connectionId,   // ← обязательно (refine)
      question: 'Процедурный вопрос',
    });
    if (arb3.status !== 201) {
      fail(`arb3 create: ${arb3.status} ${JSON.stringify(arb3.data)}`);
    } else {
      const badEsc = await req(arch, 'POST', `/arbitrations/${arb3.data.id}/escalate`, { reason: 'x' });
      if (badEsc.status === 409) { ok('procedural → Жюри отклонено (409)'); }
      else { fail(`procedural escalate: 409 ожидали, ${badEsc.status} получили`); }
    }

    // ─── 20a. procedural без connection_id → 422 (refine) ────
    const arbBad = await req(arch, 'POST', '/arbitrations', {
      type: 'procedural',
      question: 'Процедурный без connection',
    });
    if (arbBad.status === 422) { ok('refine: procedural без connection_id → 422'); }
    else { fail(`refine: 422 ожидали, ${arbBad.status} получили`); }


    // ─── 21. interim на решённом → 409 ─────────────────────
    const interim = await req(arch, 'POST', `/arbitrations/${arbId}/interim`);
    log('POST /arbitrations/:id/interim (на решённом)', interim.status, interim.data);
    if (interim.status === 409) { ok('interim на решённом → 409'); }

    console.log('\n✅ Тест Connections + Arbitrations завершён');
  } finally {
    // Отзываем мандат worker'а (до cleanup — иначе FK).
    try {
      if (workerMandateId) {
        const arch = await makeClient(archPhone, archPassword);
        await req(arch, 'DELETE', `/mandates/${workerMandateId}?reason=${encodeURIComponent('cleanup')}`);
        console.log(`\n🧹 Мандат worker'а отозван`);
      }
    } catch (e) {
      console.error('Ошибка отзыва мандата:', e);
    }
    try {
      await cleanupWorkerByExternalId(workerInfo.externalId);
      await invalidateRbacCache(workerInfo.id);
      console.log(`   · cleanup: worker ${workerInfo.externalId} удалён`);
    } catch (e) {
      console.error('Cleanup worker failed:', e);
    }
    await gracefulShutdown();
  }
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});