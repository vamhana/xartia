// scripts/test-bulk.ts (I.9.04.43)
// Полный цикл Bulk: notify → tasks/assign → flows/charge → roles/grant
// (dry-run → execute) → export → limit → cleanup.
//
// Требует запущенного worker (pnpm dev:worker в отдельном терминале).
//
// Запуск: pnpm tsx scripts/test-bulk.ts <phone> <password>

import 'dotenv/config';

import { createTaskService } from '../src/core/tasks/service.js';
import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

let OK = 0;
let FAIL = 0;

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}
function ok(m: string): void {
  OK++;
  console.log(`   ✓ ${m}`);
}
function fail(m: string): void {
  FAIL++;
  console.log(`   ✗ ${m}`);
}
function expectEq<T>(a: T, b: T, m: string): boolean {
  if (a === b) {
    ok(m);
    return true;
  }
  fail(`${m} — ожидали ${String(b)}, получили ${String(a)}`);
  return false;
}
function expectStatus(
  a: number,
  exp: number | number[],
  label: string,
): boolean {
  const list = Array.isArray(exp) ? exp : [exp];
  if (list.includes(a)) {
    ok(`${label} — HTTP ${a}`);
    return true;
  }
  fail(`${label} — ожидали ${list.join('/')}, получили ${a}`);
  return false;
}
function expectTrue(c: boolean, m: string): boolean {
  if (c) {
    ok(m);
    return true;
  }
  fail(m);
  return false;
}
function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {globalThis.process.exitCode = 1;}
}

// ─── Polling ────────────────────────────────────────────────────

interface BulkJobResponse {
  job_id: string;
  type: string;
  dry_run: boolean;
  status: string;
  progress: number;
  report: {
    processed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ index: number; id: string; message: string }>;
    exportJobIds?: string[];
    preview?: { toGrant: number; conflicts: number; cooldowns: number };
  } | null;
  report_url: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

async function pollBulkJob(
  jobId: string,
  maxMs = 60_000,
  intervalMs = 500,
): Promise<BulkJobResponse> {
  const started = Date.now();
  let lastProgress = -1;
  while (Date.now() - started < maxMs) {
    const r = await req<BulkJobResponse>('GET', `/bulk/jobs/${jobId}`);
    if (r.data.progress !== lastProgress) {
      console.log(
        `   · job ${jobId.slice(0, 8)}… status=${r.data.status} progress=${r.data.progress}%`,
      );
      lastProgress = r.data.progress;
    }
    if (['completed', 'failed', 'cancelled'].includes(r.data.status)) {
      return r.data;
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(`pollBulkJob timeout after ${maxMs}ms for job ${jobId}`);
}

async function pollExportJob(
  jobId: string,
  maxMs = 30_000,
): Promise<{ status: string }> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const r = await req<{ status: string }>('GET', `/exports/jobs/${jobId}`);
    if (['completed', 'failed', 'cancelled'].includes(r.data.status)) {
      return r.data;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`pollExportJob timeout for ${jobId}`);
}

// ─── Setup ──────────────────────────────────────────────────────

async function createTestParticipants(
  directionId: string,
  count: number,
  marker: string,
): Promise<string[]> {
  const ids: string[] = [];
  const phoneBase = Date.now().toString().slice(-5);

  for (let i = 0; i < count; i++) {
    const id = newUUID();
    // +7900 + 5 + 2 = 12 символов; уникально в рамках прогона.
    const phone = `+7900${phoneBase}${String(i).padStart(2, '0')}`;
    const pwHash = await hashPassword('test-pass-' + i);
    const encPhone = encryptField(phone);
    const phoneHash = hashForSearch(phone);

    // CHECK chk_external_id_format: ^[А-Я]?\d{5}-\d{1,2}(:.+)?$
    // Кириллическая "К" (U+041A) + 5 цифр + "-01".
    // seq = MAX(SUBSTRING(...)) + 1, retry на unique violation (23505).
    let inserted = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const seqRow = await queryOne<{ max_seq: string | null }>(
        `SELECT COALESCE(MAX(SUBSTRING(external_id FROM '^[А-Я]?([0-9]{5})-')::INT), 0)::text AS max_seq
           FROM participants
          WHERE external_id ~ '^[А-Я]?[0-9]{5}-'`,
      );
      const seq = parseInt(seqRow?.max_seq ?? '0', 10) + 1;
      if (seq > 99999) {
        throw new Error('external_id sequence overflow (99999)');
      }
      const extId = `К${String(seq).padStart(5, '0')}-01`;

      try {
        await query(
          `INSERT INTO participants
             (id, external_id, name, phone, phone_hash, messengers, direction_id,
              password_hash, status, profile_risk, entered_at)
           VALUES ($1, $2, $3, $4, $5, '{}', $6, $7, 'associated', 'compatible', now())`,
          [
            id,
            extId,
            `${marker}-${i}`,
            encPhone,
            phoneHash,
            directionId,
            pwHash,
          ],
        );
        inserted = true;
      } catch (e) {
        lastErr = e;
        const code = (e as { code?: string }).code;
        if (code !== '23505') {throw e;} // не unique — пробрасываем
      }
    }
    if (!inserted) {
      throw new Error(
        `Не удалось создать участника после 5 попыток: ` +
          `${(lastErr as Error)?.message ?? 'unknown'}`,
      );
    }
    ids.push(id);
  }
  return ids;
}

async function createTestTasks(
  directionId: string,
  architectId: string,
  marker: string,
  count: number,
): Promise<string[]> {
  // Не пишем SQL вручную: external_id (ЗДЧ-YYYY-MM-DD-NNN), audit
  // и relations-проверки делает сервис C.0.07.02.
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const task = await createTaskService(
      {
        directionId,
        description: `${marker}-task-${i}`,
        priority: 'standard',
      },
      architectId,
    );
    ids.push(task.id);
  }
  return ids;
}

async function getMainBalance(pid: string): Promise<number> {
  const row = await queryOne<{ balance: string }>(
    `SELECT balance::text FROM flows WHERE participant_id = $1 AND type = 'main'`,
    [pid],
  );
  return parseFloat(row?.balance ?? '0');
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-bulk.ts <phone> <password>');
    console.error('NOTE: worker должен быть запущен (pnpm dev:worker)');
    globalThis.process.exit(1);
  }

  const ts = Date.now().toString().slice(-7);
  const marker = `BULK-${ts}`;

  // 1. Login
  const login = await req<{
    access_token: string;
    participant: { id: string; external_id: string; direction_id: string };
  }>('POST', '/auth/login', { phone, password });
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) {
    globalThis.process.exit(1);
  }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}`);

  // 2. Permissions
  const perms = await req<{ rights: Record<string, string[]> }>(
    'GET',
    '/permissions/me',
  );
  const bulkRights = perms.data.rights['bulk'] ?? [];
  log('GET /permissions/me', perms.status, { bulk: bulkRights });
  expectStatus(perms.status, 200, 'GET /permissions/me');
  expectEq(bulkRights.includes('C'), true, 'bulk:C доступно (Архитектор)');
  expectEq(bulkRights.includes('V'), true, 'bulk:V доступно');

  // 3. Direction
  const dir = await queryOne<{ id: string; number: number }>(
    `SELECT id, number FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) {
    fail('Нет активных направлений');
    summarize();
    return;
  }
  console.log(`   · direction: ${dir.id} (#${dir.number})`);

  // 4. Setup: 3 participants + 3 tasks
  const participantIds = await createTestParticipants(dir.id, 3, marker);
  const taskIds = await createTestTasks(dir.id, me.id, marker, 3);
  console.log(`   ✓ Setup: 3 participants, 3 tasks`);

  // ─── 5. bulk.notify (direction) ──────────────────────────────
  {
    const create = await req<{ job_id: string; count: number | null }>(
      'POST',
      '/bulk/notify',
      {
        recipients: { directionId: dir.id },
        payload: {
          type: 'test.bulk',
          priority: 'standard',
          title: 'Bulk test',
          body: 'Test bulk notification',
        },
      },
    );
    log('POST /bulk/notify', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/notify');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'bulk.notify completed');
    if (final.report) {
      expectTrue(
        final.report.succeeded > 0,
        `report.succeeded > 0 (${final.report.succeeded}/${final.report.processed})`,
      );
    }
  }

  // ─── 6. bulk.tasks.assign ─────────────────────────────────────
  {
    const create = await req<{ job_id: string }>('POST', '/bulk/tasks/assign', {
      task_ids: taskIds,
      participant_ids: participantIds,
    });
    log('POST /bulk/tasks/assign', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/tasks/assign');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'bulk.tasks.assign completed');
    if (final.report) {
      expectEq(final.report.succeeded, 3, 'tasks.assign succeeded=3');
    }

    const rows = await query<{ status: string; assigned_to: string | null }>(
      `SELECT status, assigned_to FROM tasks WHERE id = ANY($1::uuid[])`,
      [taskIds],
    );
    expectEq(
      rows.filter((r) => r.status === 'assigned').length,
      3,
      '3 tasks assigned',
    );
    expectTrue(
      participantIds.every((pid) => rows.some((r) => r.assigned_to === pid)),
      'tasks assigned to correct participants',
    );
  }

  // ─── 7. bulk.flows.charge ────────────────────────────────────
  {
    const before = await Promise.all(participantIds.map((p) => getMainBalance(p)));
    const create = await req<{ job_id: string }>(
      'POST',
      '/bulk/flows/charge',
      {
        participant_ids: participantIds,
        type: 'main',
        amount: 1,
        reason: 'test',
      },
    );
    log('POST /bulk/flows/charge', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/flows/charge');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'bulk.flows.charge completed');
    if (final.report) {
      expectEq(final.report.succeeded, 3, 'flows.charge succeeded=3');
    }

    const after = await Promise.all(participantIds.map((p) => getMainBalance(p)));
    const allPlus1 = participantIds.every(
      (_, i) => after[i] === before[i]! + 1,
    );
    expectTrue(allPlus1, 'все балансы +1');
  }

  // ─── 8. bulk.roles.grant (dry-run) ───────────────────────────
  const grantPids = participantIds.slice(0, 2);
  const expiresAt = new Date(
    Date.now() + 365 * 86400_000,
  ).toISOString();
  {
    const create = await req<{ job_id: string; dry_run: boolean }>(
      'POST',
      '/bulk/roles/grant',
      {
        participant_ids: grantPids,
        role: 'COUNCIL_MEMBER',
        direction_id: dir.id,
        expires_at: expiresAt,
        dry_run: true,
      },
    );
    log('POST /bulk/roles/grant (dry-run)', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/roles/grant dry-run');
    expectEq(create.data.dry_run, true, 'dry_run=true');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'roles.grant dry-run completed');
    if (final.report?.preview) {
      expectEq(final.report.preview.toGrant, 2, 'preview.toGrant=2');
      expectEq(final.report.preview.conflicts, 0, 'preview.conflicts=0');
    } else {
      fail('preview отсутствует');
    }

    const cnt = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM mandates
        WHERE holder_id = ANY($1::uuid[])
          AND function = 'COUNCIL_MEMBER' AND status = 'active'`,
      [grantPids],
    );
    expectEq(parseInt(cnt?.cnt ?? '0', 10), 0, 'dry-run: мандаты НЕ созданы');
  }

  // ─── 9. bulk.roles.grant (execute) ──────────────────────────
  {
    const create = await req<{ job_id: string; dry_run: boolean }>(
      'POST',
      '/bulk/roles/grant',
      {
        participant_ids: grantPids,
        role: 'COUNCIL_MEMBER',
        direction_id: dir.id,
        expires_at: expiresAt,
        dry_run: false,
      },
    );
    log('POST /bulk/roles/grant (execute)', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/roles/grant execute');
    expectEq(create.data.dry_run, false, 'dry_run=false');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'roles.grant execute completed');
    if (final.report) {
      expectEq(final.report.succeeded, 2, 'roles.grant succeeded=2');
    }

    const cnt = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM mandates
        WHERE holder_id = ANY($1::uuid[])
          AND function = 'COUNCIL_MEMBER' AND status = 'active'`,
      [grantPids],
    );
    expectEq(parseInt(cnt?.cnt ?? '0', 10), 2, '2 мандата созданы');
  }

  // ─── 10. bulk.export ────────────────────────────────────────
  {
    const create = await req<{ job_id: string }>('POST', '/bulk/export', {
      types: ['participants'],
      format: 'csv',
    });
    log('POST /bulk/export', create.status, create.data);
    expectStatus(create.status, 202, 'POST /bulk/export');
    const final = await pollBulkJob(create.data.job_id);
    expectEq(final.status, 'completed', 'bulk.export completed');
    if (final.report) {
      expectEq(
        final.report.exportJobIds?.length ?? 0,
        1,
        'report.exportJobIds.length=1',
      );
      const exportJobId = final.report.exportJobIds?.[0];
      if (exportJobId) {
        const ef = await pollExportJob(exportJobId);
        expectEq(ef.status, 'completed', 'export-job завершён');
      }
    }
  }

  // ─── 11. Limit: 1001 ids → 422 ──────────────────────────────
  {
    const tooMany = Array.from({ length: 1001 }, () => newUUID());
    const r = await req('POST', '/bulk/flows/charge', {
      participant_ids: tooMany,
      type: 'main',
      amount: 1,
      reason: 'test',
    });
    log('POST /bulk/flows/charge (1001)', r.status, r.data);
    expectStatus(r.status, 422, 'лимит 1000 → 422');
  }

  // ─── 12. Non-architect 403 — SKIPPED ────────────────────────
  // Покрыто unit-уровнем: preHandler requireRight('bulk', 'C') +
  // явная проверка FIRST_ARCHITECT в /bulk/roles/grant.
  console.log('   · non-architect 403 — SKIPPED (needs second user)');

  // ─── 13. Cleanup ────────────────────────────────────────────
  {
    await query(
      `DELETE FROM flow_transactions WHERE participant_id = ANY($1::uuid[])`,
      [participantIds],
    );
    await query(
      `DELETE FROM flows WHERE participant_id = ANY($1::uuid[])`,
      [participantIds],
    );
    await query(
      `DELETE FROM cooldowns WHERE participant_id = ANY($1::uuid[])`,
      [participantIds],
    );
    await query(
      `DELETE FROM mandates WHERE holder_id = ANY($1::uuid[])`,
      [participantIds],
    );
    await query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [taskIds]);
    await query(
      `DELETE FROM jobs
        WHERE created_by = $1
          AND (type LIKE 'bulk.%' OR type LIKE 'export.%')
          AND created_at > now() - interval '1 hour'`,
      [me.id],
    );
    await query(
      `DELETE FROM participants WHERE id = ANY($1::uuid[])`,
      [participantIds],
    );

    const leftover = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM participants WHERE id = ANY($1::uuid[])`,
      [participantIds],
    );
    expectEq(
      parseInt(leftover?.cnt ?? '0', 10),
      0,
      'Cleanup: участники удалены',
    );
  }

  console.log('\n✅ Полный цикл Bulk замкнут');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {console.error(e.stack);}
    console.error(
      '\n⚠ Убедитесь, что worker запущен: pnpm dev:worker (в отдельном терминале)',
    );
  })
  .finally(async () => {
    summarize();
    try {
      await gracefulShutdown();
    } catch (e) {
      console.error('gracefulShutdown error:', e);
    }
  });