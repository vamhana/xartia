// scripts/test-imports.ts(I.9.04.42)
// Полный цикл Imports: upload CSV → dry-run → preview → confirm →
// execute → report → проверка БД → повторный dry-run (toSkip) →
// templates → cleanup.
//
// ВАЖНО: требует запущенного worker (pnpm dev:worker).
// Если worker не запущен — polling упадёт по таймауту (30 сек).
//
// Запуск: pnpm tsx scripts/test-imports.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { upload } from '../src/lib/s3.js';
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

// Polling до терминального статуса.
interface ImportJobResponse {
  job_id: string;
  type: string;
  dry_run: boolean;
  status: string;
  progress: number;
  preview: {
    toCreate: number;
    toSkip: number;
    errors: Array<{ row: number; field: string; message: string }>;
    totalRows: number;
  } | null;
  report: {
    created: number;
    skipped: number;
    errors: Array<{ row: number; field: string; message: string }>;
    totalRows: number;
  } | null;
  url: string | null;
  error: string | null;
}

async function pollJob(
  jobId: string,
  maxMs = 30_000,
  intervalMs = 500,
): Promise<ImportJobResponse> {
  const started = Date.now();
  let lastProgress = -1;
  while (Date.now() - started < maxMs) {
    const r = await req<ImportJobResponse>('GET', `/imports/jobs/${jobId}`);

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
    console.error('Usage: pnpm tsx scripts/test-imports.ts <phone> <password>');
    console.error('NOTE: worker должен быть запущен (pnpm dev:worker)');
    globalThis.process.exit(1);
  }

  // Уникальный маркер для cleanup.
  const ts = Date.now().toString().slice(-7);
  const marker = `IMP-TEST-${ts}`;

  // 1. Login.
  const login = await req<{
    access_token: string;
    participant: { id: string };
  }>('POST', '/auth/login', { phone, password });
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) { globalThis.process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}`);

  // 2. Права.
  const perms = await req<{ rights: Record<string, string[]> }>('GET', '/permissions/me');
  const r = perms.data.rights['import'] ?? [];
  log('GET /permissions/me', perms.status, { import: r });
  expectStatus(perms.status, 200, 'GET /permissions/me');
  expectEq(r.includes('C'), true, 'import:C доступно (Архитектор)');
  expectEq(r.includes('V'), true, 'import:V доступно');

  // 3. Найти direction_number 1 и direction_id.
  const dir = await queryOne<{ id: string; number: number }>(
    `SELECT id, number FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) {
    fail('Нет активных направлений');
    summarize();
    await gracefulShutdown();
    return;
  }
  console.log(`   · direction: ${dir.id} (#${dir.number})`);

  // 4. Сформировать CSV участников.
  // external_id генерируется worker'ом (formatParticipantId), оставляем пустым.
  // phone — уникальные, E.164, с маркером (tail = ts).
  const phones = [
    `+7900${ts}1`,
    `+7900${ts}2`,
    `+7900${ts}3`,
  ];
  const csvLines = [
    'external_id,name,phone,messengers_json,direction_number,wave_letter,wave_number',
    `,${marker}-1,${phones[0]},{},"${dir.number}",А,1`,
    `,${marker}-2,${phones[1]},{},"${dir.number}",А,2`,
    `,${marker}-3,${phones[2]},{},"${dir.number}",А,3`,
  ];
  const csv = csvLines.join('\n') + '\n';

  // 5. Upload CSV в S3 (bucket 'archive' — используется handler'ом).
  const fileKey = `test/imports-participants-${ts}.csv`;
  await upload(
    fileKey,
    Buffer.from(csv, 'utf8'),
    'text/csv; charset=utf-8',
    'archive',
  );
  console.log(`   ✓ CSV загружен в S3: ${fileKey}`);

  // 6. Dry-run import participants.
  const dryRun = await req<{ job_id: string; dry_run: boolean; status: string }>(
    'POST', '/imports/participants',
    { file_url: fileKey, dry_run: true },
  );
  log('POST /imports/participants (dry-run)', dryRun.status, dryRun.data);
  expectStatus(dryRun.status, 202, 'create dry-run HTTP');
  expectEq(dryRun.data.dry_run, true, 'dry_run=true');
  const dryJobId = dryRun.data.job_id;

  // 7. Polling dry-run → completed.
  const dryFinal = await pollJob(dryJobId, 30_000);
  expectEq(dryFinal.status, 'completed', 'dry-run job completed');
  expectTrue(dryFinal.preview !== null, 'preview получен');
  if (dryFinal.preview) {
    expectEq(dryFinal.preview.toCreate, 3, 'preview.toCreate=3');
    expectEq(dryFinal.preview.toSkip, 0, 'preview.toSkip=0');
    expectEq(dryFinal.preview.errors.length, 0, 'preview.errors пусто');
    expectEq(dryFinal.preview.totalRows, 3, 'preview.totalRows=3');
  }

  // 8. Confirm → execute job.
  const confirm = await req<{ job_id: string; dry_run: boolean; status: string }>(
    'POST', `/imports/jobs/${dryJobId}/confirm`, {},
  );
  log('POST /imports/jobs/:id/confirm', confirm.status, confirm.data);
  expectStatus(confirm.status, 200, 'confirm HTTP');
  expectEq(confirm.data.dry_run, false, 'новый job dry_run=false');
  const execJobId = confirm.data.job_id;
  expectTrue(execJobId !== dryJobId, 'exec job_id отличается от dry-run');

  // 9. Polling execute → completed.
  const execFinal = await pollJob(execJobId, 30_000);
  expectEq(execFinal.status, 'completed', 'execute job completed');
  expectTrue(execFinal.report !== null, 'report получен');
  if (execFinal.report) {
    expectEq(execFinal.report.created, 3, 'report.created=3');
    expectEq(execFinal.report.skipped, 0, 'report.skipped=0');
    expectEq(execFinal.report.errors.length, 0, 'report.errors пусто');
  }

  // 10. Проверка БД.
  const dbCount = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM participants
      WHERE name LIKE $1 AND deleted_at IS NULL`,
    [`${marker}%`],
  );
  expectEq(parseInt(dbCount[0]?.cnt ?? '0', 10), 3, 'В БД 3 участника');

  // Проверка шифрования: phone_hash должен быть 64-символьным hex.
  const dbRow = await queryOne<{ phone: string; phone_hash: string }>(
    `SELECT phone, phone_hash FROM participants
      WHERE name LIKE $1 AND deleted_at IS NULL
      LIMIT 1`,
    [`${marker}%`],
  );
  if (dbRow) {
    expectTrue(dbRow.phone.startsWith('enc:v1:'), 'phone зашифрован (enc:v1:)');
    expectTrue(/^[0-9a-f]{64}$/.test(dbRow.phone_hash), 'phone_hash — 64 hex');
  }

  // 11. Повторный dry-run → toCreate=0, toSkip=3.
  const dryRun2 = await req<{ job_id: string }>(
    'POST', '/imports/participants',
    { file_url: fileKey, dry_run: true },
  );
  log('POST /imports/participants (dry-run #2)', dryRun2.status, dryRun2.data);
  expectStatus(dryRun2.status, 202, 'dry-run #2 HTTP');
  const dry2Final = await pollJob(dryRun2.data.job_id, 30_000);
  expectEq(dry2Final.status, 'completed', 'dry-run #2 completed');
  if (dry2Final.preview) {
    expectEq(dry2Final.preview.toCreate, 0, 'dry-run #2: toCreate=0');
    expectEq(dry2Final.preview.toSkip, 3, 'dry-run #2: toSkip=3');
  }

  // 12. GET /imports/templates/participants → CSV.
  const tpl = await fetch(`${BASE}/imports/templates/participants`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  expectEq(tpl.status, 200, 'GET templates/participants — HTTP 200');
  expectTrue(
    (tpl.headers.get('content-type') ?? '').includes('text/csv'),
    'Content-Type: text/csv',
  );
  const tplText = await tpl.text();
  expectTrue(tplText.includes('external_id'), 'Шаблон содержит external_id');
  expectTrue(tplText.includes('phone'), 'Шаблон содержит phone');
  expectTrue(tplText.includes('direction_number'), 'Шаблон содержит direction_number');

  // 13. Cleanup.
  await query(
    `DELETE FROM participants WHERE name LIKE $1`,
    [`${marker}%`],
  );
  const leftover = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM participants WHERE name LIKE $1`,
    [`${marker}%`],
  );
  expectEq(parseInt(leftover[0]?.cnt ?? '0', 10), 0, 'Cleanup: участники удалены');

  // Cleanup jobs Архитектора.
  await query(
    `DELETE FROM jobs WHERE created_by = $1 AND type LIKE 'import.%'`,
    [me.id],
  );
  console.log('   ✓ Cleanup: import-jobs удалены');

  console.log('\n✅ Полный цикл Imports замкнут');
}

// Мини-queryOne для теста (не тянем L.0.01.09 ради одной строки).
async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
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