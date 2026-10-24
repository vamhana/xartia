// scripts/test-admin.ts
// Ручной интеграционный тест Admin (A.1.35.01 + C.0.35.02).
//
// Покрытие:
//   - auth guards (401 без токена)
//   - dashboard, mandates map, regimes, recovery queue
//   - logs + logs/export (S3 presigned)
//   - can-delegate, system-status, invalidate-caches
//   - rotate (POST /admin/rotate) и delegate (POST /admin/delegate)
//   - seed (POST /admin/seed)
//   - заглушка bootstrap (404 — роут не зарегистрирован)
//   - B1/B6: non-Architect → 403 на admin-эндпоинты + access_log
//   - B2: recovery statuses=invalid → 422
//   - B3/B4: participants status=invalid → 422 (Zod вместо сервиса)
//
// Preflight (SQL): очищает mandates/cooldowns/rotations/delegations для
// Архитектора и worker'а — чтобы тест был идемпотентен при повторных
// прогонах (rotate создаёт cooldown, который блокирует повторную выдачу
// той же роли). НЕ использовать на prod-БД.
//
// Запуск:  pnpm tsx scripts/test-admin.ts [+79…] [пароль] [worker-phone] [worker-pass]
// Дефолты: из env ARCHITECT_PHONE / ARCHITECT_PASSWORD, worker — необязателен.

import 'dotenv/config';

import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Client {
  token: string;
  participantId: string;
  directionId: string;
  name: string;
  phone: string;
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Client / fetch
// ─────────────────────────────────────────────────────────────────

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`login failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as {
    access_token: string;
    participant: {
      id: string;
      direction_id: string;
      name: string;
      phone?: string;
    };
  };
  return {
    token: data.access_token,
    participantId: data.participant.id,
    directionId: data.participant.direction_id,
    name: data.participant.name,
    // Backend может не отдавать phone в participant — фолбэк на введённый.
    phone: data.participant.phone ?? phone,
  };
}

async function raw(
  c: Client | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<RawResponse> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  if (c) {headers['Authorization'] = `Bearer ${c.token}`;}

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {parsed = text ? JSON.parse(text) : null;} catch {parsed = text;}
  return { status: res.status, headers: res.headers, body: parsed };
}

// ─────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────

let failures = 0;

function log(label: string, status: number, data: unknown): void {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const trimmed = json && json.length > 300 ? `${json.slice(0, 300)}…` : json;
  console.warn(`[${status}] ${label} → ${trimmed}`);
}

function ok(msg: string): void {console.warn(`  ✓ ${msg}`);}
function fail(msg: string): void {
  console.error(`  ✗ ${msg}`);
  failures++;
}

function expectStatus(label: string, r: RawResponse, expected: number): boolean {
  if (r.status !== expected) {
    fail(`${label}: ожидался ${expected}, получен ${r.status}`);
    return false;
  }
  ok(`${label}: ${expected}`);
  return true;
}

function expectAuditId(label: string, body: unknown): boolean {
  if (!body || typeof body !== 'object' || !('audit_id' in body)) {
    fail(`${label}: нет audit_id в ответе`);
    return false;
  }
  ok(`${label}: audit_id присутствует`);
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Preflight
// ─────────────────────────────────────────────────────────────────

/**
 * Очистка mutable-таблиц перед прогоном. Идемпотентность.
 * Удаляет ТОЛЬКО mandates/cooldowns/rotations/delegations. participant_roles
 * (permanent-роли) не трогает — они не мешают тесту.
 *
 * NB: опасно на prod. Используется только в scripts/test-*.ts.
 */
async function preflight(arch: Client, worker: Client | null): Promise<void> {
  const { query } = await import('../src/lib/db.js');
  const pids: string[] = [arch.participantId];
  if (worker) {pids.push(worker.participantId);}

  // 1. SQL-cleanup mandates/cooldowns/rotations/delegations.
  await query(
    `DELETE FROM cooldowns WHERE participant_id = ANY($1::uuid[])`,
    [pids],
  );
  await query(
    `DELETE FROM rotations WHERE mandate_id IN (
       SELECT id FROM mandates WHERE holder_id = ANY($1::uuid[])
     )`,
    [pids],
  );
  await query(
    `DELETE FROM delegations WHERE from_id = ANY($1::uuid[]) OR to_id = ANY($1::uuid[])`,
    [pids],
  );
  await query(
    `DELETE FROM mandates WHERE holder_id = ANY($1::uuid[])`,
    [pids],
  );

  // 2. Redis-cleanup rate-limit на auth.login/register. Иначе при частых
  //    прогонах теста (5+ раз за 15 минут) worker не залогинится — 429.
  for (const pattern of ['ratelimit:auth.login:*', 'ratelimit:auth.register:*']) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {await redis.del(...keys);}
    } while (cursor !== '0');
  }

  console.warn(`→ Preflight: mandates/cooldowns/rotations/delegations + ratelimit:auth.* очищены`);
}

// ─────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────

async function sectionAuthGuards(): Promise<void> {
  console.warn('\n=== Auth guards ===');

  const unauth = await raw(null, 'GET', '/admin/dashboard');
  log('GET /admin/dashboard (no auth)', unauth.status, unauth.body);
  expectStatus('unauth /admin/dashboard', unauth, 401);
}

async function sectionDashboard(arch: Client): Promise<void> {
  console.warn('\n=== Dashboard ===');

  const r = await raw(arch, 'GET', '/admin/dashboard');
  log('GET /admin/dashboard', r.status, r.body);
  if (!expectStatus('dashboard', r, 200)) {return;}
  expectAuditId('dashboard', r.body);

  const b = r.body as Record<string, unknown>;
  const required = [
    'participantsTotal', 'directionsTotal', 'activeMandates',
    'openSignals', 'activeRegimes', 'recoveryPending', 'updatedAt',
  ];
  for (const key of required) {
    if (key in b) {
      ok(`dashboard.${key} = ${String(b[key])}`);
    } else {
      fail(`dashboard: нет поля ${key}`);
    }
  }
}

async function sectionMandatesMap(arch: Client): Promise<void> {
  console.warn('\n=== Mandates map ===');

  const r = await raw(arch, 'GET', '/admin/mandates/map');
  log('GET /admin/mandates/map', r.status, r.body);
  if (!expectStatus('mandates/map', r, 200)) {return;}
  expectAuditId('mandates/map', r.body);

  const b = r.body as Record<string, unknown>;
  if (!Array.isArray(b['directions'])) {fail('mandates/map: directions не массив');}
  else {ok(`mandates/map.directions: ${(b['directions'] as unknown[]).length}`);}

  if (!Array.isArray(b['heldByArchitect'])) {fail('mandates/map: heldByArchitect не массив');}
  else {ok(`mandates/map.heldByArchitect: ${(b['heldByArchitect'] as unknown[]).length}`);}

  if (!Array.isArray(b['delegated'])) {fail('mandates/map: delegated не массив');}
  else {ok(`mandates/map.delegated: ${(b['delegated'] as unknown[]).length}`);}
}

async function sectionRegimes(arch: Client): Promise<void> {
  console.warn('\n=== Regimes ===');

  const r = await raw(arch, 'GET', '/admin/regimes');
  log('GET /admin/regimes', r.status, r.body);
  if (!expectStatus('admin/regimes', r, 200)) {return;}
  expectAuditId('admin/regimes', r.body);

  const b = r.body as Record<string, unknown>;
  if (!Array.isArray(b['data'])) {fail('admin/regimes: data не массив');}
  else {ok(`admin/regimes.data: ${(b['data'] as unknown[]).length}`);}
}

async function sectionRecoveryQueue(arch: Client): Promise<void> {
  console.warn('\n=== Recovery queue ===');

  const r1 = await raw(arch, 'GET', '/admin/recovery/queue');
  log('GET /admin/recovery/queue', r1.status, r1.body);
  if (!expectStatus('recovery/queue (default)', r1, 200)) {return;}
  expectAuditId('recovery/queue', r1.body);

  const b1 = r1.body as { data: unknown[]; meta: { total: number; page: number; per_page: number } };
  if (!Array.isArray(b1.data)) {fail('recovery/queue: data не массив');}
  else {ok(`recovery/queue.data: ${b1.data.length}, total=${b1.meta?.total}`);}

  const r2 = await raw(arch, 'GET', '/admin/recovery/queue?statuses=pending&page=1&per_page=10');
  log('GET /admin/recovery/queue?statuses=pending', r2.status, r2.body);
  expectStatus('recovery/queue (pending)', r2, 200);

  const r3 = await raw(
    arch, 'GET',
    '/admin/recovery/queue?statuses=pending,approved,used,rejected,expired&per_page=5',
  );
  log('GET /admin/recovery/queue?statuses=all', r3.status, r3.body);
  expectStatus('recovery/queue (all)', r3, 200);

  const r4 = await raw(arch, 'GET', '/admin/recovery/queue?per_page=999');
  log('GET /admin/recovery/queue?per_page=999', r4.status, r4.body);
  expectStatus('recovery/queue (per_page>200 → 422)', r4, 422);

  // 🆕 B2: невалидный статус → 422 (было: 200 с [])
  const r5 = await raw(arch, 'GET', '/admin/recovery/queue?statuses=invalid_status');
  log('GET /admin/recovery/queue?statuses=invalid', r5.status, r5.body);
  expectStatus('recovery/queue statuses=invalid → 422 (B2)', r5, 422);

  // 🆕 B2: смесь валидных и невалидных → 422
  const r6 = await raw(arch, 'GET', '/admin/recovery/queue?statuses=pending,invalid');
  log('GET /admin/recovery/queue?statuses=pending,invalid', r6.status, r6.body);
  expectStatus('recovery/queue смесь → 422 (B2)', r6, 422);
}

async function sectionLogs(arch: Client): Promise<void> {
  console.warn('\n=== Logs ===');

  const r1 = await raw(arch, 'GET', '/admin/logs');
  log('GET /admin/logs', r1.status, r1.body);
  if (!expectStatus('admin/logs', r1, 200)) {return;}
  expectAuditId('admin/logs', r1.body);

  const b1 = r1.body as { data: Array<Record<string, unknown>>; meta: { total: number } };
  if (!Array.isArray(b1.data)) {fail('admin/logs: data не массив');}
  else {ok(`admin/logs.data: ${b1.data.length}, total=${b1.meta?.total}`);}

  // Проверка human-readable полей (новые поля от listLogsRich).
  if (b1.data.length > 0) {
    const row = b1.data[0]!;
    for (const key of ['actorName','actorExternalId','entityName','entityExternalId','ip']) {
      if (key in row) {ok(`log.${key}: ${String(row[key]).slice(0, 60)}`);}
      else {fail(`log: нет поля ${key}`);}
    }
  }

  const r2 = await raw(arch, 'GET', '/admin/logs?entity_type=participant&per_page=5');
  log('GET /admin/logs?entity_type=participant', r2.status, r2.body);
  expectStatus('admin/logs (filter entity_type)', r2, 200);

  const longType = 'x'.repeat(100);
  const r3 = await raw(arch, 'GET', `/admin/logs?entity_type=${longType}`);
  log('GET /admin/logs?entity_type=<long>', r3.status, r3.body);
  expectStatus('admin/logs (entity_type > 64 → 422)', r3, 422);
}

async function sectionLogsExport(arch: Client): Promise<void> {
  console.warn('\n=== Logs export ===');

  const r = await raw(arch, 'GET', '/admin/logs/export?format=json');
  log('GET /admin/logs/export?format=json', r.status, r.body);

  if (r.status === 404) {
    ok('export: 404 (нет записей за 24ч) — валидный кейс');
  } else if (r.status === 200) {
    expectAuditId('export json', r.body);
    const b = r.body as Record<string, unknown>;
    for (const key of ['key', 'url', 'format', 'rows', 'bytes']) {
      if (key in b) {ok(`export.${key}: ${String(b[key]).slice(0, 80)}`);}
      else {fail(`export: нет поля ${key}`);}
    }
  } else {
    fail(`export: неожиданный статус ${r.status}`);
  }

  const bad = await raw(arch, 'GET', '/admin/logs/export?format=xml');
  log('GET /admin/logs/export?format=xml', bad.status, bad.body);
  expectStatus('export (format=xml → 422)', bad, 422);
}

async function sectionCanDelegate(arch: Client): Promise<void> {
  console.warn('\n=== Can-delegate ===');

  const r = await raw(arch, 'GET', '/admin/can-delegate?function=COUNCIL_MEMBER');
  log('GET /admin/can-delegate', r.status, r.body);
  if (!expectStatus('can-delegate', r, 200)) {return;}
  expectAuditId('can-delegate', r.body);

  const b = r.body as { can_delegate: boolean };
  if (typeof b.can_delegate === 'boolean') {
    ok(`can-delegate: ${b.can_delegate} (Архитектор должен дать true)`);
    if (b.can_delegate !== true) {fail('can-delegate: ожидался true для Архитектора');}
  } else {
    fail('can-delegate: нет поля can_delegate');
  }

  const bad = await raw(arch, 'GET', '/admin/can-delegate');
  log('GET /admin/can-delegate (no function)', bad.status, bad.body);
  expectStatus('can-delegate (no function → 422)', bad, 422);
}

async function sectionSystemStatus(arch: Client): Promise<void> {
  console.warn('\n=== System status ===');

  const r = await raw(arch, 'GET', '/admin/system-status');
  log('GET /admin/system-status', r.status, r.body);
  if (!expectStatus('system-status', r, 200)) {return;}
  expectAuditId('system-status', r.body);

  const b = r.body as Record<string, unknown>;
  for (const key of ['healthy', 'services', 'uptimeSec', 'version']) {
    if (key in b) {ok(`system-status.${key}: ${JSON.stringify(b[key]).slice(0, 80)}`);}
    else {fail(`system-status: нет поля ${key}`);}
  }

  if (typeof b['healthy'] !== 'boolean') {fail('system-status.healthy не boolean');}
  if (typeof b['uptimeSec'] !== 'number') {fail('system-status.uptimeSec не number');}
  if (typeof b['version'] !== 'string') {fail('system-status.version не string');}
  if (b['services'] && typeof b['services'] === 'object') {
    const svc = b['services'] as Record<string, string>;
    for (const [name, status] of Object.entries(svc)) {
      ok(`system-status.services.${name}: ${status}`);
      if (status !== 'ok' && status !== 'fail') {
        fail(`system-status.services.${name}: неожиданный статус '${status}'`);
      }
    }
  }
}

async function sectionInvalidateCaches(arch: Client): Promise<void> {
  console.warn('\n=== Invalidate caches ===');

  const r = await raw(arch, 'POST', '/admin/invalidate-caches');
  log('POST /admin/invalidate-caches', r.status, r.body);
  if (!expectStatus('invalidate-caches', r, 200)) {return;}
  expectAuditId('invalidate-caches', r.body);

  const b = r.body as { invalidated: number };
  if (typeof b.invalidated === 'number' && b.invalidated >= 0) {
    ok(`invalidate-caches.invalidated: ${b.invalidated}`);
  } else {
    fail('invalidate-caches: нет поля invalidated (число)');
  }

  const r2 = await raw(arch, 'POST', '/admin/invalidate-caches');
  log('POST /admin/invalidate-caches (повтор)', r2.status, r2.body);
  expectStatus('invalidate-caches (повтор)', r2, 200);
}

async function sectionRotate(arch: Client, worker: Client): Promise<void> {
  console.warn('\n=== POST /admin/rotate ===');

  // 1. Создать VERIFIER-мандат Архитектору через обычный POST /mandates.
  const createResp = await raw(arch, 'POST', '/mandates', {
    function: 'VERIFIER',
    holder_id: arch.participantId,
    direction_id: arch.directionId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /mandates (VERIFIER на Архитектора)', createResp.status, createResp.body);
  if (!expectStatus('create mandate', createResp, 201)) {return;}
  const mandateId = (createResp.body as { id: string }).id;

  // 2. Rotate через /admin/rotate.
  const rotateResp = await raw(arch, 'POST', '/admin/rotate', {
    mandate_id: mandateId,
    successor_id: worker.participantId,
  });
  log('POST /admin/rotate', rotateResp.status, rotateResp.body);
  if (!expectStatus('admin/rotate', rotateResp, 200)) {return;}
  expectAuditId('admin/rotate', rotateResp.body);

  const r = rotateResp.body as {
    old: { id: string; status: string };
    next: { id: string; holderId: string; status: string };
  };

  if (r.old?.status === 'expired') {ok('rotate: old.status=expired');}
  else {fail(`rotate: old.status=${r.old?.status}, ожидался 'expired'`);}

  if (r.next?.holderId === worker.participantId) {
    ok(`rotate: next.holderId=${worker.participantId.slice(0, 8)}…`);
  } else {
    fail(`rotate: next.holderId=${r.next?.holderId}`);
  }

  if (r.next?.status === 'active') {ok('rotate: next.status=active');}
  else {fail(`rotate: next.status=${r.next?.status}`);}

  // 3. Cooldown у старого holder.
  const cdResp = await raw(
    arch, 'GET',
    `/cooldowns?participant_id=${arch.participantId}`,
  );
  log('GET /cooldowns (arch)', cdResp.status, cdResp.body);
  expectStatus('cooldowns', cdResp, 200);
  const cds = (cdResp.body as { data: Array<{ reason: string }> }).data;
  const verifierCd = cds.find((c) => c.reason === 'rotation:VERIFIER');
  if (verifierCd) {ok(`cooldown: '${verifierCd.reason}' найден`);}
  else {fail(`cooldown: не найден 'rotation:VERIFIER'`);}

  // 4. Fake mandate_id → 404.
  const notFound = await raw(arch, 'POST', '/admin/rotate', {
    mandate_id: '00000000-0000-0000-0000-000000000000',
    successor_id: worker.participantId,
  });
  log('POST /admin/rotate (fake mandate)', notFound.status, notFound.body);
  expectStatus('rotate (fake mandate → 404)', notFound, 404);

  // 5. Self-rotate: KEEPER (без cooldown в ROLE_MAX_TERMS), holder = successor.
  const keeperCreate = await raw(arch, 'POST', '/mandates', {
    function: 'KEEPER',
    holder_id: arch.participantId,
    direction_id: arch.directionId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /mandates (KEEPER на Архитектора)', keeperCreate.status, keeperCreate.body);
  if (keeperCreate.status === 201) {
    const keeperId = (keeperCreate.body as { id: string }).id;
    const selfRotate = await raw(arch, 'POST', '/admin/rotate', {
      mandate_id: keeperId,
      successor_id: arch.participantId,
    });
    log('POST /admin/rotate (self)', selfRotate.status, selfRotate.body);
    expectStatus('rotate (self → 409)', selfRotate, 409);
  } else {
    fail(`KEEPER-мандат не создан: ${keeperCreate.status}`);
  }

  // 6. Bad body → 422.
  const badBody = await raw(arch, 'POST', '/admin/rotate', {
    mandate_id: 'not-uuid',
    successor_id: worker.participantId,
  });
  log('POST /admin/rotate (bad body)', badBody.status, badBody.body);
  expectStatus('rotate (bad body → 422)', badBody, 422);
}

async function sectionDelegate(arch: Client, worker: Client): Promise<void> {
  console.warn('\n=== POST /admin/delegate ===');

  // 1. Успешное делегирование LIAISON worker'у.
  const r1 = await raw(arch, 'POST', '/admin/delegate', {
    function: 'LIAISON',
    holder_id: worker.participantId,
    direction_id: worker.directionId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /admin/delegate (LIAISON)', r1.status, r1.body);
  if (!expectStatus('admin/delegate', r1, 201)) {return;}
  expectAuditId('admin/delegate', r1.body);

  const m = r1.body as {
    id: string;
    function: string;
    holderId: string;
    directionId: string;
    status: string;
  };

  if (m.function === 'LIAISON') {ok('delegate: function=LIAISON');}
  else {fail(`function=${m.function}`);}

  if (m.holderId === worker.participantId) {ok('delegate: holderId=worker');}
  else {fail(`holderId=${m.holderId}`);}

  if (m.status === 'active') {ok('delegate: status=active');}
  else {fail(`status=${m.status}`);}

  // 2. Self-delegate (holder = Архитектор) → 409.
  const r2 = await raw(arch, 'POST', '/admin/delegate', {
    function: 'OTC',
    holder_id: arch.participantId,
    direction_id: arch.directionId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /admin/delegate (self)', r2.status, r2.body);
  expectStatus('delegate (self → 409)', r2, 409);

  // 3. Bad body → 422.
  const r3 = await raw(arch, 'POST', '/admin/delegate', {
    function: '',
    holder_id: 'not-uuid',
    expires_at: 'not-iso',
  });
  log('POST /admin/delegate (bad body)', r3.status, r3.body);
  expectStatus('delegate (bad body → 422)', r3, 422);

  // 4. Без auth → 401.
  const r4 = await raw(null, 'POST', '/admin/delegate', {
    function: 'LIAISON',
    holder_id: worker.participantId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /admin/delegate (no auth)', r4.status, r4.body);
  expectStatus('delegate (no auth → 401)', r4, 401);
}

async function sectionSeed(arch: Client): Promise<void> {
  console.warn('\n=== POST /admin/seed ===');

  // 1. Дефолтный вызов (all). На уже засеянной БД — нули (идемпотентность).
  const r1 = await raw(arch, 'POST', '/admin/seed', {});
  log('POST /admin/seed (all)', r1.status, r1.body);
  if (!expectStatus('admin/seed (all)', r1, 200)) {return;}
  expectAuditId('admin/seed (all)', r1.body);

  const b1 = r1.body as { templates: Record<string, number>; totalInserted: number };
  if (typeof b1.totalInserted === 'number') {
    ok(`seed: totalInserted=${b1.totalInserted}`);
  } else {
    fail('seed: нет поля totalInserted');
  }
  if (b1.templates && typeof b1.templates === 'object') {
    for (const [name, count] of Object.entries(b1.templates)) {
      ok(`seed.${name} = ${count}`);
    }
  } else {
    fail('seed: нет поля templates');
  }

  // 2. Точечный вызов — только directions.
  const r2 = await raw(arch, 'POST', '/admin/seed', { templates: ['directions'] });
  log('POST /admin/seed (directions)', r2.status, r2.body);
  expectStatus('admin/seed (directions)', r2, 200);

  // 3. Невалидный шаблон → 422.
  const r3 = await raw(arch, 'POST', '/admin/seed', { templates: ['nonexistent'] });
  log('POST /admin/seed (bad template)', r3.status, r3.body);
  expectStatus('admin/seed (bad template → 422)', r3, 422);

  // 4. Без auth → 401.
  const r4 = await raw(null, 'POST', '/admin/seed', {});
  log('POST /admin/seed (no auth)', r4.status, r4.body);
  expectStatus('admin/seed (no auth → 401)', r4, 401);
}

async function sectionBootstrapRemoved(arch: Client): Promise<void> {
  console.warn('\n=== POST /admin/bootstrap (удалён из API) ===');

  // АРХИТЕКТУРНОЕ РЕШЕНИЕ (см. A.1.35.01, C.0.35.02):
  // bootstrap доступен ТОЛЬКО через CLI-скрипт scripts/bootstrap-architect.ts
  // (pnpm ensure:architect). Причины:
  //   1. Курица-яйцо: bootstrap нужен ДО появления первого Архитектора,
  //      но /admin/* требует requireArchitect (hasRole('FIRST_ARCHITECT')).
  //   2. Пароль не ходит по HTTP / не попадает в access_log / audit_log.
  //   3. UI не может вызвать — нет логина до bootstrap.
  //
  // Роут НЕ зарегистрирован → Fastify возвращает 404 Not Found.

  const r = await raw(arch, 'POST', '/admin/bootstrap', {});
  log('POST /admin/bootstrap', r.status, r.body);

  if (r.status === 404) {
    ok('bootstrap: 404 (роут не зарегистрирован)');
  } else {
    fail(`bootstrap: ожидался 404, получен ${r.status}`);
  }

  // Sanity-check: остальные /admin/* роуты живы.
  const dashboard = await raw(arch, 'GET', '/admin/dashboard');
  if (dashboard.status === 200) {
    ok('dashboard: 200 (остальные роуты работают)');
  } else {
    fail(`dashboard: ожидался 200, получен ${dashboard.status}`);
  }
}

async function sectionParticipants(arch: Client): Promise<void> {
  console.warn('\n=== Admin: участники ===');

  // 1. Список всех
  const r1 = await raw(arch, 'GET', '/admin/participants');
  log('GET /admin/participants', r1.status, r1.body);
  if (!expectStatus('participants list', r1, 200)) {return;}
  expectAuditId('participants list', r1.body);
  const list = (r1.body as { data: unknown[]; meta: { total: number } });
  ok(`participants list: ${list.data.length}, total=${list.meta.total}`);

  // 2. Фильтр по search
  const r2 = await raw(arch, 'GET', '/admin/participants?search=Test');
  log('GET /admin/participants?search=Test', r2.status, r2.body);
  expectStatus('participants search', r2, 200);

  // 3. Фильтр по status
  const r3 = await raw(arch, 'GET', '/admin/participants?status=associated');
  log('GET /admin/participants?status=associated', r3.status, r3.body);
  expectStatus('participants status', r3, 200);

  // 4. Карточка Архитектора
  const archCard = await raw(arch, 'GET', `/admin/participants/${arch.participantId}`);
  log(`GET /admin/participants/${arch.participantId.slice(0, 8)}…`, archCard.status, archCard.body);
  if (expectStatus('participant get', archCard, 200)) {
    const b = archCard.body as { isFirstArchitect?: boolean; externalId?: string };
    if (b.isFirstArchitect === true) {ok('participant: isFirstArchitect=true');}
    else {fail(`participant: isFirstArchitect=${b.isFirstArchitect}`);}
  }

  // 5. PATCH Архитектора → 409 (запрещено менять через admin)
  const r5 = await raw(arch, 'PATCH', `/admin/participants/${arch.participantId}`, {
    name: 'Новое имя',
  });
  log(`PATCH Архитектор`, r5.status, r5.body);
  expectStatus('participant patch architect → 409', r5, 409);

  // 6. PATCH несуществующего → 404
  const r6 = await raw(arch, 'PATCH', '/admin/participants/00000000-0000-0000-0000-000000000000', {
    name: 'X',
  });
  log(`PATCH fake`, r6.status, r6.body);
  expectStatus('participant patch fake → 404', r6, 404);

  // 7. 🆕 B4: невалидный status в query → 422 (было: 200 с 0 строк)
  const rBadList = await raw(arch, 'GET', '/admin/participants?status=invalid_status');
  log('GET /admin/participants?status=invalid', rBadList.status, rBadList.body);
  expectStatus('participants status=invalid → 422 (B4)', rBadList, 422);

  // 8. 🆕 B3: невалидный status в PATCH → 422 из Zod (было: 409 из сервиса)
  //    Найдём не-Архитектора
  const workerCard = list.data.find(
    (p) => (p as { isFirstArchitect?: boolean }).isFirstArchitect === false,
  ) as { id: string } | undefined;
  if (workerCard) {
    const r7 = await raw(arch, 'PATCH', `/admin/participants/${workerCard.id}`, {
      status: 'invalid_status',
    });
    log(`PATCH (bad status)`, r7.status, r7.body);
    expectStatus('participant patch bad status → 422 (B3)', r7, 422);
  } else {
    console.warn('   ⚠ нет не-Архитектора в списке — B3 пропущен');
  }
}

async function sectionMandatesList(arch: Client): Promise<void> {
  console.warn('\n=== Admin: мандаты (список) ===');

  const r1 = await raw(arch, 'GET', '/admin/mandates');
  log('GET /admin/mandates', r1.status, r1.body);
  if (!expectStatus('mandates list', r1, 200)) {return;}
  expectAuditId('mandates list', r1.body);

  const b1 = r1.body as { data: Array<Record<string, unknown>>; meta: { total: number } };
  ok(`mandates list: ${b1.data.length}, total=${b1.meta.total}`);

  if (b1.data.length > 0) {
    const m = b1.data[0]!;
    for (const key of ['id','function','holderId','holderName','holderExternalId','grantedAt','expiresAt','status']) {
      if (key in m) {ok(`mandate.${key}: ${String(m[key]).slice(0, 60)}`);}
      else {fail(`mandate: нет поля ${key}`);}
    }
  }

  // Фильтр по статусу
  const r2 = await raw(arch, 'GET', '/admin/mandates?status=active');
  log('GET /admin/mandates?status=active', r2.status, r2.body);
  expectStatus('mandates filter status', r2, 200);

  // Невалидный статус → 422
  const r3 = await raw(arch, 'GET', '/admin/mandates?status=invalid');
  log('GET /admin/mandates?status=invalid', r3.status, r3.body);
  expectStatus('mandates invalid status → 422', r3, 422);

  // Невалидный page → 422
  const r4 = await raw(arch, 'GET', '/admin/mandates?page=0');
  log('GET /admin/mandates?page=0', r4.status, r4.body);
  expectStatus('mandates page=0 → 422', r4, 422);
}

async function sectionRecoveryActions(arch: Client, worker: Client): Promise<void> {
  console.warn('\n=== Admin: recovery actions ===');
  console.warn(`→ Worker phone: ${worker.phone}`);

  // 1. Создаём pending-заявку на телефон worker'а.
  const create = await raw(null, 'POST', '/auth/recover/request', {
    phone: worker.phone,
  });
  log('POST /auth/recover/request', create.status, create.body);
  if (!expectStatus('recover request', create, 201)) {return;}
  const requestId = (create.body as { request_id: string }).request_id;

  // 2. Список содержит её
  const list = await raw(arch, 'GET', '/admin/recovery/queue?statuses=pending');
  log('GET /admin/recovery/queue?statuses=pending', list.status, list.body);
  expectStatus('recovery list (pending)', list, 200);

  // 3. Approve
  const approve = await raw(arch, 'POST', `/admin/recovery/${requestId}/approve`, {});
  log('POST /admin/recovery/:id/approve', approve.status, approve.body);
  if (expectStatus('recovery approve', approve, 200)) {
    const b = approve.body as { request_id: string; expires_at: string; delivered_via: string[]; dev_token?: string };
    if (b.request_id === requestId) {ok('approve: request_id matches');}
    if (b.expires_at) {ok(`approve: expires_at=${b.expires_at}`);}
    if (Array.isArray(b.delivered_via)) {ok(`approve: delivered_via=[${b.delivered_via.join(',')}]`);}
    if (b.dev_token) {ok(`approve: dev_token (${b.dev_token.length} chars)`);}
  }

  // 4. Повторный approve → 409
  const dup = await raw(arch, 'POST', `/admin/recovery/${requestId}/approve`, {});
  log('POST /admin/recovery/:id/approve (dup)', dup.status, dup.body);
  expectStatus('recovery approve dup → 409', dup, 409);

  // 5. Reject на фиктивном UUID → 404.
  const fakeReject = await raw(arch, 'POST', '/admin/recovery/00000000-0000-0000-0000-000000000000/reject', {
    reason: 'test',
  });
  log('POST /admin/recovery/:id/reject (fake)', fakeReject.status, fakeReject.body);
  expectStatus('recovery reject fake → 404', fakeReject, 404);

  // 6. Reject без reason → 422
  const badBody = await raw(arch, 'POST', `/admin/recovery/${requestId}/reject`, {});
  log('POST /admin/recovery/:id/reject (no reason)', badBody.status, badBody.body);
  expectStatus('recovery reject no reason → 422', badBody, 422);

  // Cleanup: удалить заявку через SQL, чтобы не мешала следующему прогону.
  const { query } = await import('../src/lib/db.js');
  await query(`DELETE FROM recovery_requests WHERE id = $1`, [requestId]);
  ok('cleanup: заявка удалена');
}

/**
 * B1/B6: worker без FIRST_ARCHITECT/COUNCIL_MEMBER должен получать 403
 * от всех admin-эндпоинтов, и отказ должен писаться в access_log.
 */
async function sectionNonArchitectForbidden(worker: Client): Promise<void> {
  console.warn('\n=== Non-Architect: 403 на admin-эндпоинты ===');

  const endpoints: Array<[string, string, unknown?]> = [
    ['GET',  '/admin/dashboard'],
    ['GET',  '/admin/logs'],
    ['GET',  '/admin/participants'],
    ['GET',  '/admin/mandates'],
    ['GET',  '/admin/system-status'],
    ['POST', '/admin/seed', {}],
    ['POST', '/admin/invalidate-caches'],
  ];

  for (const [method, path, body] of endpoints) {
    const r = await raw(worker, method, path, body);
    log(`${method} ${path} (worker)`, r.status, r.body);
    expectStatus(`${method} ${path} (worker → 403)`, r, 403);
  }

  // B6: access_log должен содержать записи об отказах от worker'а.
  const { queryOne } = await import('../src/lib/db.js');
  const row = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM access_log
      WHERE participant_id = $1
        AND resource = 'admin'
        AND granted = false
        AND created_at > now() - interval '1 minute'`,
    [worker.participantId],
  );
  const cnt = parseInt(row?.cnt ?? '0', 10);
  if (cnt >= 3) {
    ok(`access_log: ${cnt} записей об отказе (B1/B6)`);
  } else {
    fail(`access_log: ожидалось >= 3 записей, найдено ${cnt}`);
  }

  // Recovery queue доступна COUNCIL_MEMBER, но worker — не Совет.
  // Проверим отдельно: worker → 403 на recovery queue.
  const rq = await raw(worker, 'GET', '/admin/recovery/queue');
  log('GET /admin/recovery/queue (worker)', rq.status, rq.body);
  expectStatus('recovery/queue (worker → 403)', rq, 403);
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const archPhone = process.argv[2]
    ?? process.env['ARCHITECT_PHONE']
    ?? '+79000000000';
  const archPassword = process.argv[3]
    ?? process.env['ARCHITECT_PASSWORD']
    ?? 'ChangeMe123456';
  const workerPhone = process.argv[4] ?? '';
  const workerPassword = process.argv[5] ?? '';

  console.warn(`→ Base: ${BASE}`);
  console.warn(`→ Arch login: ${archPhone}`);

  const arch = await makeClient(archPhone, archPassword);
  console.warn(`→ Architect: ${arch.name} (${arch.participantId.slice(0, 8)}…)`);

  let worker: Client | null = null;
  if (workerPhone) {
    try {
      worker = await makeClient(workerPhone, workerPassword);
      console.warn(`→ Worker: ${worker.name} (${worker.participantId.slice(0, 8)}…)`);
    } catch (e) {
      console.warn(`   ⚠ Worker (${workerPhone}) недоступен: ${(e as Error).message}`);
      console.warn(`     Для rotate/delegate: создай worker через scripts/bootstrap-participant.ts`);
    }
  } else {
    console.warn('   ⚠ Worker не указан — секции rotate/delegate/recovery-actions будут пропущены');
  }

  // Preflight — идемпотентность перед прогоном.
  try {
    await preflight(arch, worker);
  } catch (e) {
    console.warn(`   ⚠ Preflight failed: ${(e as Error).message}`);
    console.warn('     Тест продолжит, но rotate/delegate могут упасть на cooldown/unique.');
  }

  await sectionAuthGuards();
  await sectionDashboard(arch);
  await sectionMandatesMap(arch);
  await sectionRegimes(arch);
  await sectionRecoveryQueue(arch);
  await sectionLogs(arch);
  await sectionLogsExport(arch);
  await sectionCanDelegate(arch);

  await sectionParticipants(arch);
  await sectionMandatesList(arch);
  await sectionSystemStatus(arch);

  await sectionInvalidateCaches(arch);

  if (worker) {
    // B1/B6: до мутаций — проверка 403 для не-Архитектора.
    await sectionNonArchitectForbidden(worker);
    await sectionRotate(arch, worker);
    await sectionDelegate(arch, worker);
    await sectionRecoveryActions(arch, worker);
  }

  await sectionSeed(arch);
  await sectionBootstrapRemoved(arch);

  console.warn('\n═══════════════════════════════════════');
  if (failures === 0) {
    console.warn('✓ Все проверки прошли');
  } else {
    console.error(`✗ Провалов: ${failures}`);
    process.exitCode = 1;
  }
  console.warn('═══════════════════════════════════════\n');
}

main()
  .then(() => gracefulShutdown())
  .catch(async (e) => {
    const err = e as Error & { cause?: unknown };
    console.error('\n❌ Ошибка:', err.message);
    if (err.cause) {
      console.error('   cause:', err.cause);
    }
    try {await gracefulShutdown();} catch {/* ignore */}
    process.exit(1);
  });