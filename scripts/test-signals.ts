// I.9.04.20 scripts/test-signals.ts
// Полный цикл сигнала с автосозданием тестового worker'а.
//
// Что тестируется (I.9.04.20 + наши fix'ы):
//   - POST /signals → создать сигнал
//   - POST /signals/:id/responses { support/object } — разные направления
//   - B2-fix: ответ за чужое направление → 403
//   - POST /signals/:id/route → status='run', lead_direction_id обновлён (B17)
//   - 3 clarify → iterations=3
//   - B4-fix: 4-я clarify → 409 (было: iterations уходил в бесконечность)
//   - POST /signals/:id/escalate → status='connect' (B1-fix)
//
// Worker создаётся автоматически (SQL: participants + participant_roles)
// и чистится в finally. Rate-limit сбрасывается в dev через Redis SCAN.
//
// Запуск: pnpm tsx scripts/test-signals.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

// ─── Типы ───────────────────────────────────────────────────────

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
      const d = data as unknown as { details?: { retry_after_sec?: number } };
      throw new Error(
        `Rate limit on login (retry_after=${d.details?.retry_after_sec ?? '?'}s). ` +
        `Сбрось вручную: docker compose -f docker/docker-compose.yml exec redis ` +
        `redis-cli --scan --pattern "rate:*" | xargs -r docker compose -f docker/docker-compose.yml exec -T redis redis-cli DEL`,
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

// ─── Worker setup ───────────────────────────────────────────────

async function findArch(phone: string): Promise<{ id: string; externalId: string; directionId: string }> {
  const phoneHash = hashForSearch(phone);
  const row = await queryOne<{ id: string; external_id: string; direction_id: string }>(
    `SELECT id, external_id, direction_id FROM participants
     WHERE phone_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [phoneHash],
  );
  if (!row) {throw new Error(`Architect ${phone} not found in DB (phone_hash mismatch?)`);}
  return { id: row.id, externalId: row.external_id, directionId: row.direction_id };
}

async function findOtherDirection(excludeId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM directions
      WHERE id <> $1 AND status = 'active'
      LIMIT 1`,
    [excludeId],
  );
  if (!row) {throw new Error('No other active direction found (seeds D.2.01.07?)');}
  return row.id;
}

async function cleanupWorkerByExternalId(externalId: string): Promise<void> {
  const p = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1`,
    [externalId],
  );
  if (!p) {return;}
  // Явное удаление зависимых строк (FK без CASCADE).
  await query(`DELETE FROM participant_roles WHERE participant_id = $1`, [p.id]);
  await query(`DELETE FROM cell_members     WHERE participant_id = $1`, [p.id]);
  await query(`DELETE FROM participants     WHERE id = $1`,            [p.id]);
}

async function ensureWorker(directionId: string): Promise<WorkerInfo> {
  const phone = '+79990009999';
  const password = 'TestWorker123456';
  const externalId = 'Т90099-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  // Cleanup предыдущего запуска (если упал до finally).
  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Worker', encryptField(phone), phoneHash, directionId, passwordHash],
  );

  const roleRow = await queryOne<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'ASSOCIATED' LIMIT 1`,
  );
  if (!roleRow) {throw new Error('Role ASSOCIATED not found (seed D.2.01.07?)');}
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

  const workerDirectionId = await findOtherDirection(archInfo.directionId);
  const workerInfo = await ensureWorker(workerDirectionId);
  console.log(`   · Worker создан: ${workerInfo.externalId} (dir=${workerDirectionId})`);
  console.log(`     phone=${workerInfo.phone}, password=${workerInfo.password}`);

  await resetRateLimit();

  let worker: Client | null = null;
  try {
    // ─── Логин ────────────────────────────────────────────────
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId} (dir=${arch.directionId})`);
    worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId} (dir=${worker.directionId})`);

    if (arch.directionId === worker.directionId) {
      throw new Error('Arch и Worker в одном направлении — B2-тест невозможен');
    }

    // ─── 1. Создать сигнал ────────────────────────────────────
    const signal = await req<{ id: string; externalId: string; status: string }>(
      arch, 'POST', '/signals', {
        type: 'problem',
        description: 'Не хватает деталей для сборки узла A',
        justification: 'Сборка стоит уже 2 дня, поставка задерживается',
        priority: 'high',
      },
    );
    log('POST /signals', signal.status, signal.data);
    if (signal.status !== 201) { fail('create failed'); return; }
    const signalId = signal.data.id;
    ok(`Сигнал создан: ${signal.data.externalId}, status=${signal.data.status}`);

    // ─── 2. Список ────────────────────────────────────────────
    const list = await req<{ data: unknown[]; meta: { total: number } }>(arch, 'GET', '/signals');
    log('GET /signals', list.status, {
      count: list.data.data?.length,
      total: list.data.meta?.total,
    });

    // ─── 3. Worker: support (за свой dir) ─────────────────────
    const resp1 = await req(worker, 'POST', `/signals/${signalId}/responses`, {
      direction_id: worker.directionId,
      response: 'support',
      justification: 'Согласен, детали критичны',
    });
    log('POST /responses { support } (worker, свой dir)', resp1.status, resp1.data);
    if (resp1.status === 201) { ok('worker: support за свой dir'); }
    else { fail(`worker support: 201 ожидали, ${resp1.status} получили`); }

    // ─── 4. Arch: object (за свой dir) ────────────────────────
    const resp2 = await req(arch, 'POST', `/signals/${signalId}/responses`, {
      direction_id: arch.directionId,
      response: 'object',
      justification: 'Есть альтернативный поставщик, нужно проверить',
    });
    log('POST /responses { object } (arch, свой dir)', resp2.status, resp2.data);
    if (resp2.status === 201) { ok('arch: object за свой dir'); }
    else { fail(`arch object: 201 ожидали, ${resp2.status} получили`); }

    // ─── 5. B2-TEST: arch отвечает за ЧУЖОЕ направление → 403 ─
    const respB2 = await req(arch, 'POST', `/signals/${signalId}/responses`, {
      direction_id: worker.directionId,
      response: 'support',
      justification: 'Попытка ответить за чужое направление',
    });
    log('POST /responses { чужой dir } (B2-test)', respB2.status, respB2.data);
    if (respB2.status === 403) { ok('B2: 403 за чужое направление (fix)'); }
    else { fail(`B2: 403 ожидали, ${respB2.status} получили`); }

    // ─── 6. Список ответов ────────────────────────────────────
    const responses = await req<{ data: unknown[] }>(arch, 'GET', `/signals/${signalId}/responses`);
    log('GET /responses', responses.status, { count: responses.data.data?.length });
    if (responses.data.data?.length === 2) {
      ok('2 ответа (B2-отказ не записался)');
    }

    // ─── 7. Route ────────────────────────────────────────────
    const route = await req<{ id: string; targetDirectionId: string; status: string }>(
      arch, 'POST', `/signals/${signalId}/route`, {
        target_direction_id: worker.directionId,
        reason: 'Профильная компетенция',
      },
    );
    log('POST /signals/:id/route', route.status, route.data);
    if (route.status === 201) { ok('Сигнал маршрутизирован'); }
    if (route.data.status === 'routed') { ok('connectivity item: status=routed'); }

    // ─── 8. Проверка status='run' + lead_direction_id (B17) ──
    const afterRoute = await req<{ status: string; leadDirectionId: string }>(
      arch, 'GET', `/signals/${signalId}`,
    );
    log('GET /signals/:id (после route)', afterRoute.status, afterRoute.data);
    if (afterRoute.data.status === 'run') { ok('сигнал: new → run'); }
    else { fail(`status: 'run' ожидали, '${afterRoute.data.status}' получили`); }
    if (afterRoute.data.leadDirectionId === worker.directionId) {
      ok('B17: lead_direction_id = target');
    } else {
      fail(`B17: lead_direction_id=${afterRoute.data.leadDirectionId}, ожидали ${worker.directionId}`);
    }

    // ─── 9. 3 clarify (worker, свой dir) ──────────────────────
    for (let i = 1; i <= 3; i++) {
      const r = await req(worker, 'POST', `/signals/${signalId}/responses`, {
        direction_id: worker.directionId,
        response: 'clarify',
        justification: `Уточнение #${i}`,
        data: { need: `more_info_${i}` },   // ← обязательно для clarify
      });
      if (r.status === 201) { ok(`clarify #${i}: 201`); }
      else { fail(`clarify #${i}: ${r.status}`); }
    }

    const afterClarify = await req<{ iterations: number }>(arch, 'GET', `/signals/${signalId}`);
    log('GET /signals/:id (после 3 clarify)', afterClarify.status, {
      iterations: afterClarify.data.iterations,
    });
    if (afterClarify.data.iterations >= 3) {
      ok(`iterations=${afterClarify.data.iterations}`);
    } else {
      fail(`iterations=${afterClarify.data.iterations}, ожидали >= 3`);
    }

    // ─── 10. B4-TEST: 4-я clarify → 409 ──────────────────────
    const clarify4 = await req(worker, 'POST', `/signals/${signalId}/responses`, {
      direction_id: worker.directionId,
      response: 'clarify',
      justification: 'Уточнение #4 (должно быть отклонено)',
      data: { need: 'more_info_4' },   // ← чтобы поймать 409, а не 422
    });
    log('POST /responses { clarify #4 } (B4-test)', clarify4.status, clarify4.data);
    if (clarify4.status === 409) { ok('B4: 409 при clarify при iterations >= 3'); }
    else { fail(`B4: 409 ожидали, ${clarify4.status} получили`); }

    // ─── 11. Escalate ────────────────────────────────────────
    const escalate = await req<{ id: string; status: string }>(
      arch, 'POST', `/signals/${signalId}/escalate`,
    );
    log('POST /signals/:id/escalate', escalate.status, escalate.data);
    if (escalate.status === 201) { ok('escalate: 201'); }

    // ─── 12. B1-TEST: status='connect' ────────────────────────
    const final = await req<{ status: string }>(arch, 'GET', `/signals/${signalId}`);
    log('GET /signals/:id (финал)', final.status, { status: final.data.status });
    if (final.data.status === 'connect') {
      ok('B1: статус → connect (ожидает Арбитраж)');
    } else {
      fail(`B1: статус=${final.data.status}, ожидали 'connect'`);
    }

    console.log('\n✅ Тест Signals завершён');
  } finally {
    try {
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`   · cleanup: worker ${workerInfo.externalId} удалён`);
    } catch (e) {
      console.error('   · cleanup failed:', e);
    }
    await gracefulShutdown();
  }
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});