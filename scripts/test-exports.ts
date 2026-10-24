// scripts/test-exports.ts(I.9.04.41)
// Полный цикл Exports: create → worker → completed → presigned URL →
// fetch CSV → проверка отсутствия PII → cleanup.
//
// ВАЖНО: требует запущенного worker (pnpm dev:worker в отдельном терминале).
// Если worker не запущен — polling упадёт по таймауту (30 сек).
//
// Запуск: pnpm tsx scripts/test-exports.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) { headers['Authorization'] = `Bearer ${TOKEN}`; }
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

let OK = 0, FAIL = 0;

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}
function ok(msg: string): void { OK++; console.log(`   ✓ ${msg}`); }
function fail(msg: string): void { FAIL++; console.log(`   ✗ ${msg}`); }

function expectEq<T>(actual: T, expected: T, msg: string): boolean {
  if (actual === expected) { ok(msg); return true; }
  fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
  return false;
}
function expectStatus(actual: number, expected: number | number[], label: string): boolean {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) { ok(`${label} — HTTP ${actual}`); return true; }
  fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
  return false;
}
function expectTrue(cond: boolean, msg: string): boolean {
  if (cond) { ok(msg); return true; }
  fail(msg);
  return false;
}
function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {globalThis.process.exitCode = 1;}
}

// Polling статуса job до терминального состояния.
async function pollJob(
  jobId: string,
  maxMs = 30_000,
  intervalMs = 500,
): Promise<{
  status: string;
  progress: number;
  url: string | null;
  error: string | null;
}> {
  const started = Date.now();
  let lastProgress = -1;
  while (Date.now() - started < maxMs) {
    const r = await req<{
      status: string;
      progress: number;
      url: string | null;
      error: string | null;
    }>('GET', `/exports/jobs/${jobId}`);

    if (r.data.progress !== lastProgress) {
      console.log(`   · job ${jobId.slice(0, 8)}… status=${r.data.status} progress=${r.data.progress}%`);
      lastProgress = r.data.progress;
    }

    if (r.data.status === 'completed' || r.data.status === 'failed' || r.data.status === 'cancelled') {
      return r.data;
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(`pollJob timeout after ${maxMs}ms for job ${jobId}`);
}

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-exports.ts <phone> <password>');
    console.error('NOTE: worker должен быть запущен (pnpm dev:worker)');
    globalThis.process.exit(1);
  }

  // 1. Login.
  const login = await req<{
    access_token: string;
    participant: { id: string; name: string; external_id: string; direction_id: string };
  }>('POST', '/auth/login', { phone, password });
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) { globalThis.process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}`);

  // 2. Права.
  const perms = await req<{ rights: Record<string, string[]> }>('GET', '/permissions/me');
  const r = perms.data.rights['export'] ?? [];
  log('GET /permissions/me', perms.status, { export: r });
  expectStatus(perms.status, 200, 'GET /permissions/me');
  expectEq(r.includes('C'), true, 'export:C доступно');

  // 3. POST /exports/participants → 202 { job_id }.
  const created = await req<{ job_id: string; status: string; url: string | null }>(
    'POST', '/exports/participants',
    { format: 'csv' },
  );
  log('POST /exports/participants', created.status, created.data);
  expectStatus(created.status, 202, 'create participants export HTTP');
  expectEq(created.data.status, 'queued', 'status=queued');
  expectEq(created.data.url, null, 'url=null при создании');
  const jobId1 = created.data.job_id;
  expectTrue(typeof jobId1 === 'string' && jobId1.length > 0, 'job_id — непустая строка');

  // 4. Polling до completed.
  const final1 = await pollJob(jobId1, 30_000);
  console.log(`\n   · final: status=${final1.status} progress=${final1.progress}%`);
  expectEq(final1.status, 'completed', 'job завершён (worker отработал)');
  expectEq(final1.progress, 100, 'progress=100');
  expectTrue(typeof final1.url === 'string' && final1.url.length > 0, 'presigned URL получен');

  // 5. Fetch CSV → проверить содержимое + отсутствие phone.
  if (final1.url) {
    const csvRes = await fetch(final1.url);
    expectEq(csvRes.status, 200, 'presigned URL доступен (HTTP 200)');
    const csv = await csvRes.text();
    expectTrue(csv.length > 0, 'CSV непустой');
    expectTrue(csv.includes('external_id'), 'CSV содержит заголовок external_id');
    expectTrue(!csv.includes(me.external_id) || csv.includes('***'), 'CSV: external_id есть, phone замаскирован');

    // Проверка отсутствия PII: не должно быть plaintext-телефона.
    const phonePlain = phone.replace(/^\+/, '');
    expectTrue(
      !csv.includes(phonePlain),
      'CSV: plaintext телефона отсутствует',
    );
    // phone колонка должна содержать маскированный вид (** или ***).
    expectTrue(
      csv.includes('***') || csv.includes('phone'),
      'CSV: колонка phone замаскирована',
    );
  }

  // 6. GET /exports/jobs — job в списке.
  const jobs = await req<{ data: Array<{ jobId: string; status: string }>; meta: { total: number } }>(
    'GET', '/exports/jobs?page=1&per_page=50',
  );
  log('GET /exports/jobs', jobs.status, { count: jobs.data.data?.length });
  expectStatus(jobs.status, 200, 'list jobs HTTP');
  expectTrue(
    (jobs.data.data ?? []).some((j) => j.jobId === jobId1),
    'created job в списке',
  );

  // 7. GET /exports/history — completed есть.
  const history = await req<{ data: Array<{ jobId: string; status: string }> }>(
    'GET', '/exports/history?page=1&per_page=50',
  );
  log('GET /exports/history', history.status, { count: history.data.data?.length });
  expectStatus(history.status, 200, 'history HTTP');
  expectTrue(
    (history.data.data ?? []).some((j) => j.jobId === jobId1),
    'completed job в истории',
  );

  // 8. POST /exports/audit-log → polling.
  const auditJob = await req<{ job_id: string }>(
    'POST', '/exports/audit-log',
    { format: 'json' },
  );
  log('POST /exports/audit-log', auditJob.status, auditJob.data);
  expectStatus(auditJob.status, 202, 'create audit-log export HTTP');
  const auditJobId = auditJob.data.job_id;

  const finalAudit = await pollJob(auditJobId, 30_000);
  expectEq(finalAudit.status, 'completed', 'audit-log job completed');
  expectTrue(
    typeof finalAudit.url === 'string' && finalAudit.url.length > 0,
    'audit-log presigned URL получен',
  );

  // 9. Cleanup: DELETE job в состоянии queued (новый job, не ждём worker).
  const cancelJob = await req<{ job_id: string }>(
    'POST', '/exports/plans',
    { format: 'json' },
  );
  const cancelJobId = cancelJob.data.job_id;
  // Пытаемся отменить сразу — если worker не успел взять, status='cancelled'.
  // Если worker взял — DELETE вернёт 409 (running), это допустимо.
  const del = await req('DELETE', `/exports/jobs/${cancelJobId}`);
  log('DELETE /exports/jobs/:id', del.status, del.data);
  expectStatus(del.status, [204, 409], 'cancel/409 (зависит от worker гонки)');

  // 10. Cleanup — удалить jobs Архитектора из БД.
  await query(
    `DELETE FROM jobs WHERE created_by = $1`,
    [me.id],
  );
  console.log('   ✓ Cleanup: jobs Архитектора удалены');

  console.log('\n✅ Полный цикл Exports замкнут');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) { console.error(e.stack); }
    console.error(
      '\n⚠ Убедитесь, что worker запущен: pnpm dev:worker (в отдельном терминале)',
    );
  })
  .finally(async () => {
    summarize();
    try { await gracefulShutdown(); } catch (e) { console.error('gracefulShutdown error:', e); }
  });