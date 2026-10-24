// scripts/test-verification.ts
// I.9.04.24 — Verification: аудит → finding → close → recheck → code-audit → integrity.
//
// Проверки fix'ов C.0.19.02 (v0.0.02):
//   - B1: finding после close → 409 (транзакция + FOR UPDATE).
//   - B2: повторный close → 409 (atomic UPDATE).
//   - B3: повторный recheck тем же verifier → 409.
//   - B6: worker без audit:V → 403 на GET.
//
// Запуск: pnpm tsx scripts/test-verification.ts [+79001234567 ChangeMe123456]

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const MARKER = 'VERIFY-TEST:';

interface Client { token: string; participantId: string; directionId: string; }
interface WorkerInfo { id: string; externalId: string; phone: string; password: string; directionId: string; }

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
  const phone = '+79990009989';
  const password = 'TestVerifyWorker12';
  const externalId = 'Т90089-01';
  const phoneHash = hashForSearch(phone);
  const passwordHash = await hashPassword(password);

  await cleanupWorkerByExternalId(externalId);

  const id = newUUID();
  await query(
    `INSERT INTO participants
       (id, external_id, name, phone, phone_hash, messengers, direction_id,
        password_hash, status, profile_risk, entered_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, 'associated', 'compatible', now())`,
    [id, externalId, 'Test Verify Worker', encryptField(phone), phoneHash, directionId, passwordHash],
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

async function cleanupVerification(): Promise<void> {
  await query(
    `DELETE FROM audit_findings WHERE audit_id IN (SELECT id FROM audits WHERE subject LIKE $1)`,
    [`${MARKER}%`],
  );
  await query(`DELETE FROM audits WHERE subject LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM verification_rechecks WHERE comment LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM code_audits WHERE version LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM integrity_alerts WHERE system LIKE $1`, [`${MARKER}%`]);
  // Тестовые OTC-решения (создавались напрямую)
  await query(
    `DELETE FROM otc_decisions WHERE comment LIKE $1`,
    [`${MARKER}%`],
  );
  console.log('🧹 Cleanup: audits/findings/rechecks/code-audits/alerts/otc');
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
  await cleanupVerification();

  try {
    const arch = await makeClient(archPhone, archPassword);
    console.log(`✅ Архитектор: ${arch.participantId}`);
    const worker = await makeClient(workerInfo.phone, workerInfo.password);
    console.log(`✅ Worker: ${worker.participantId}`);

    // ─── 1. Создать аудит ─────────────────────────────────
    const audit = await req<{ id: string; type: string; status: string }>(
      arch, 'POST', '/verification/audits', {
        type: 'planned',
        subject: `${MARKER}goods`,
      },
    );
    if (audit.status !== 201) { log('audit', audit.status, audit.data); throw new Error('audit create failed'); }
    const auditId = audit.data.id;
    ok(`Аудит: ${auditId}, status=${audit.data.status}`);

    // ─── 2. Finding ───────────────────────────────────────
    const finding = await req<{ id: string; severity: number }>(
      arch, 'POST', `/verification/audits/${auditId}/finding`, {
        finding: 'Обнаружено несоответствие протокола',
        severity: 7,
        recommendation: 'Пересмотреть процедуру',
      },
    );
    if (finding.status === 201) {ok(`finding: ${finding.data.id}, severity=7`);}
    else {fail(`finding: ${finding.status}`);}

    // ─── 3. severity=15 → 422 ──────────────────────────────
    const badSev = await req(arch, 'POST', `/verification/audits/${auditId}/finding`, {
      finding: 'x', severity: 15, recommendation: 'x',
    });
    if (badSev.status === 422) {ok('severity=15 → 422');}
    else {fail(`severity=15: 422 ожидали, ${badSev.status}`);}

    // ─── 4. status → in_progress ──────────────────────────
    const afterFinding = await req<{ status: string }>(
      arch, 'GET', `/verification/audits/${auditId}`,
    );
    if (afterFinding.data.status === 'in_progress') {ok('status=in_progress (после finding)');}

    // ─── 5. Close ─────────────────────────────────────────
    const closed = await req<{ status: string; result: string }>(
      arch, 'POST', `/verification/audits/${auditId}/close`, {
        result: 'Нарушений не выявлено, процедура пересмотрена',
      },
    );
    if (closed.data.status === 'finished') {ok('close → status=finished');}

    // ─── 6. B1-TEST: finding после close → 409 ───────────
    const b1 = await req(arch, 'POST', `/verification/audits/${auditId}/finding`, {
      finding: 'B1-test: finding после close',
      severity: 5,
      recommendation: 'x',
    });
    log('B1: finding после close', b1.status, b1.data);
    if (b1.status === 409) {ok('B1: finding после close → 409');}
    else {fail(`B1: 409 ожидали, ${b1.status}`);}

    // ─── 7. B2-TEST: повторный close → 409 ──────────────
    const b2 = await req(arch, 'POST', `/verification/audits/${auditId}/close`, {
      result: 'x',
    });
    if (b2.status === 409) {ok('B2: повторный close → 409');}
    else {fail(`B2: 409 ожидали, ${b2.status}`);}

    // ─── 8. Список аудитов ───────────────────────────────
    const list = await req<{ data: unknown[]; meta: { total: number } }>(
      arch, 'GET', `/verification/audits?subject=${MARKER}goods`,
    );
    if ((list.data.data?.length ?? 0) >= 1) {ok('аудит в списке');}

    // ─── 9. OTC-решение (прямой SQL) ────────────────────
    // Создаём план → задачу → отчёт → OTC decision (напрямую).
    const plan = await req<{ id: string }>(arch, 'POST', '/plans', {
      type: 'standard',
      title: `${MARKER} план`,
      expected_result: 'ok',
      lead_direction_id: arch.directionId,
    });
    await req(arch, 'POST', `/plans/${plan.data.id}/approve`);
    await req(arch, 'POST', `/plans/${plan.data.id}/activate`);

    const task = await req<{ id: string }>(arch, 'POST', '/tasks', {
      direction_id: arch.directionId,
      description: `${MARKER} задача для перепроверки`,
      priority: 'standard',
    });
    await req(arch, 'POST', `/tasks/${task.data.id}/assign`, { participant_id: arch.participantId });
    await req(arch, 'POST', `/tasks/${task.data.id}/take`);
    const report = await req<{ id: string }>(arch, 'POST', `/tasks/${task.data.id}/reports`, {
      type: 'text', comment: 'текст',
    });
    await req(arch, 'POST', `/tasks/${task.data.id}/submit`);

    const decisionId = randomUUID();
    await query(
      `INSERT INTO otc_decisions (id, report_id, otc_id, verdict, comment, criteria_version, crisis_protocol)
       VALUES ($1, $2, $3, 'accepted', $4, 1, false)`,
      [decisionId, report.data.id, arch.participantId, `${MARKER}тестовое решение`],
    );
    ok(`OTC decision (прямой SQL): ${decisionId}`);

    // ─── 10. Recheck (mismatch) ───────────────────────────
    // Worker делает recheck, не arch (arch = otc_id решения → I.2.2).
    // Но у worker нет audit:C — вернёт 403. Дадим worker'у временную роль через
    // мандат? Проще: используем arch, но создадим decision с другим otc_id.
    // Используем worker.participantId как otc_id — тогда arch ≠ otc → recheck разрешён.
    await query(
      `UPDATE otc_decisions SET otc_id = $1 WHERE id = $2`,
      [worker.participantId, decisionId],
    );

    const recheck = await req<{ id: string; result: string }>(
      arch, 'POST', `/verification/rechecks/${decisionId}`, {
        matches: false,
        comment: `${MARKER} Несоответствие`,
      },
    );
    if (recheck.status === 201 && recheck.data.result === 'mismatch') {ok('recheck: mismatch');}
    else {fail(`recheck: ${recheck.status} ${JSON.stringify(recheck.data)}`);}

    // ─── 11. B3-TEST: повторный recheck тем же verifier → 409 ─
    const b3 = await req(arch, 'POST', `/verification/rechecks/${decisionId}`, {
      matches: true,
      comment: `${MARKER} повтор`,
    });
    log('B3: повторный recheck', b3.status, b3.data);
    if (b3.status === 409) {ok('B3: повторный recheck → 409');}
    else {fail(`B3: 409 ожидали, ${b3.status}`);}

    // ─── 12. Stats ────────────────────────────────────────
    const stats = await req<{ matchRate: number; mismatches: number }>(
      arch, 'GET', '/verification/rechecks/stats',
    );
    if (stats.data.mismatches >= 1) {ok(`mismatches=${stats.data.mismatches}`);}

    // ─── 13. Code-audit ───────────────────────────────────
    const codeAudit = await req<{ id: string; system: string }>(
      arch, 'POST', '/verification/code-audits', {
        system: 'balance',
        version: `${MARKER}v1.0`,
        findings: { issues: 0, notes: 'Всё чисто' },
      },
    );
    if (codeAudit.status === 201) {ok('code-audit создан');}

    // ─── 14. B8-TEST: findings > 100KB → 422 ─────────────
    const bigFindings: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {bigFindings[`k${i}`] = 'x'.repeat(100);}
    const b8 = await req(arch, 'POST', '/verification/code-audits', {
      system: 'balance',
      version: `${MARKER}big`,
      findings: bigFindings,
    });
    log('B8: findings > 100KB', b8.status, { error: b8.data });
    if (b8.status === 422) {ok('B8: findings > 100KB → 422');}
    else {fail(`B8: 422 ожидали, ${b8.status}`);}

    // ─── 15. Integrity alert ─────────────────────────────
    const alert = await req<{ id: string; action: string }>(
      arch, 'POST', '/verification/integrity-alerts', {
        system: `${MARKER}balance-algo`,
        source_node: 'node-1',
        action: 'modification_attempt',
        details: { hash_before: 'abc', hash_after: 'xyz' },
      },
    );
    if (alert.status === 201 && alert.data.action === 'modification_attempt') {ok('integrity alert создан');}

    // ─── 16. Список alerts ───────────────────────────────
    const alertsList = await req<{ data: unknown[] }>(arch, 'GET', '/verification/integrity-alerts');
    if ((alertsList.data.data?.length ?? 0) >= 1) {ok('alert в списке');}

    // ─── 17. B6-TEST: worker (ASSOCIATED, без audit:V) → 403 ──
    const b6 = await req(worker, 'GET', '/verification/audits');
    log('B6: worker GET /audits', b6.status, b6.data);
    if (b6.status === 403) {ok('B6: worker без audit:V → 403');}
    else {fail(`B6: 403 ожидали, ${b6.status}`);}

    // ─── 18. Gateway suspend ─────────────────────────────
    const susp = await req<{ suspended: number }>(arch, 'POST', '/verification/gateway-suspend');
    if (susp.status === 200) {ok(`gateway-suspend: suspended=${susp.data.suspended}`);}

    console.log('\n✅ Тест Verification завершён');
  } finally {
    try {
      await cleanupVerification();
      await cleanupWorkerByExternalId(workerInfo.externalId);
      console.log(`🧹 Cleanup: verification + worker ${workerInfo.externalId}`);
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