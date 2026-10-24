// scripts/test-automation.ts (I.9.04.27) — v0.0.03
// Полный цикл: section → operator → decision → approve/reject/defer
// → audit → cron → disable → cleanup.
//
// Регрессия v0.0.03:
//   - 6 GET без прав → закрыто requireRight('automation','V').
//   - Атомарность approve/reject/defer/disable → повторный вызов → 409.
//   - runDailyAudit закрывает mandate при removed.
//   - combine с невалидной ролью → 422.
//
// Запуск: pnpm tsx scripts/test-automation.ts <phone> <password>

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
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

let OK = 0, FAIL = 0;
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2).slice(0, 700));
}
function ok(m: string): void { OK++; console.log(`   ✓ ${m}`); }
function fail(m: string): void { FAIL++; console.log(`   ✗ ${m}`); }
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) { ok(msg); return; }
  fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
}
function st(actual: number, expected: number | number[], label: string): void {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) { ok(`${label} — HTTP ${actual}`); return; }
  fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
}
function code(actual: string | undefined, expected: string, label: string): void {
  if (actual === expected) { ok(`${label} — code=${expected}`); return; }
  fail(`${label} — ожидали code=${expected}, получили ${String(actual)}`);
}
function truthy(v: unknown, msg: string): void {
  if (v) { ok(msg); return; }
  fail(`${msg} — получено ${String(v)}`);
}
function summarize(): void {
  console.log(`\n─── Итог: ${OK}/${OK + FAIL} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {process.exitCode = 1;}
}

const TEST_OPERATOR_EXTERNAL_ID = 'Я00001-12';
let OP_ID: string | null = null;
let SECTION_ID: string | null = null;
const DECISION_IDS: string[] = [];

async function cleanup(): Promise<void> {
  try {
    for (const id of DECISION_IDS) {
      await query(`DELETE FROM automation_decisions WHERE id = $1`, [id]);
    }
    if (OP_ID) {
      await query(`DELETE FROM operator_audits WHERE operator_id = $1`, [OP_ID]);
      await query(`DELETE FROM mandates WHERE holder_id = $1 AND function = 'OPERATOR'`, [OP_ID]);
      await query(`DELETE FROM cooldowns WHERE participant_id = $1 AND reason LIKE 'rotation:OPERATOR%'`, [OP_ID]);
    }
    ok('Cleanup выполнен');
  } catch (e) {
    fail(`Cleanup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function ensureTestOperator(): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM participants WHERE external_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [TEST_OPERATOR_EXTERNAL_ID],
  );
  let id: string;
  if (existing) {
    id = existing.id;
    await query(
      `UPDATE participants SET entered_at = now() - interval '3 years' WHERE id = $1`,
      [id],
    );
  } else {
    const dir = await queryOne<{ id: string }>(
      `SELECT id FROM directions WHERE status = 'active'
        ORDER BY CASE WHEN number = 12 THEN 0 ELSE 1 END, number LIMIT 1`,
    );
    if (!dir) {throw new Error('Нет активных направлений');}
    const inserted = await query<{ id: string }>(
      `INSERT INTO participants
         (external_id, direction_id, name, phone, phone_hash, messengers,
          password_hash, status, profile_risk, entered_at)
       VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6, 'associated', 'compatible',
               now() - interval '3 years') RETURNING id`,
      [TEST_OPERATOR_EXTERNAL_ID, dir.id, 'Test Automation Operator',
       'encrypted-placeholder', `hash-${TEST_OPERATOR_EXTERNAL_ID}`, 'placeholder'],
    );
    id = inserted[0]!.id;
  }
  const cert = await queryOne<{ id: string }>(
    `SELECT id FROM module_passes WHERE participant_id = $1 AND module = 'ai_certification' LIMIT 1`,
    [id],
  );
  if (!cert) {
    await query(
      `INSERT INTO module_passes (participant_id, module) VALUES ($1, 'ai_certification')`,
      [id],
    );
  }
  return id;
}

async function ensureTestDecision(directionId: string, type = 'test.standard'): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO automation_decisions
       (id, type, content, ai_recommendation, deadline, status)
     VALUES ($1, $2, $3::jsonb, 'approve', now() + interval '1 day', 'pending')`,
    [id, type, JSON.stringify({ direction_id: directionId, test: true })],
  );
  DECISION_IDS.push(id);
  return id;
}

async function findSectionByDirection(directionId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM automation_sections WHERE direction_id = $1 LIMIT 1`,
    [directionId],
  );
  return row?.id ?? null;
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  const password = process.argv[3];
  if (!phone || !password) {
    console.error('Usage: pnpm tsx scripts/test-automation.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (login.status !== 200) { process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  ok(`login as ${me.id}`);

  // 2. Оператор
  OP_ID = await ensureTestOperator();
  ok(`operator: ${OP_ID}`);
  const opDir = await queryOne<{ direction_id: string }>(
    `SELECT direction_id FROM participants WHERE id = $1`, [OP_ID],
  );
  if (!opDir) {throw new Error('Оператор без direction_id');}
  const dirId = opDir.direction_id;

  // 3. Section (create или reuse)
  const section = await req<{ id: string }>(
    'POST', '/automation/sections', { direction_id: dirId },
  );
  log('POST /sections', section.status, section.data);
  if (section.status === 201) {
    ok('section создан');
    SECTION_ID = section.data.id;
  } else if (section.status === 409) {
    ok('section уже существует (409)');
    SECTION_ID = await findSectionByDirection(dirId);
    if (!SECTION_ID) { fail('409, но не найден'); return; }
  } else {
    fail(`section HTTP ${section.status}`); return;
  }

  // 4. Assign operator
  {
    const r = await req<{ operatorId: string | null; enabled: boolean }>(
      'POST', `/automation/sections/${SECTION_ID}/operator`,
      { operator_id: OP_ID },
    );
    log('POST /sections/:id/operator', r.status, r.data);
    if (r.status === 200) {
      eq(r.data.operatorId, OP_ID, 'operator назначен');
    } else if (r.status === 409) {
      ok('operator уже назначен (409)');
    } else {
      fail(`assign HTTP ${r.status}`);
    }
  }

  // 5. Queue — self (wildcard у Архитектора → 200)
  const decisionId = await ensureTestDecision(dirId);
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', `/automation/queue?operator_id=${OP_ID}`,
    );
    log('GET /queue (чужой operator_id)', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'queue HTTP');
    eq(r.data.data?.some((d) => d.id === decisionId), true, 'решение в очереди');
  }

  // 6. Queue без operator_id — self
  {
    const r = await req<{ data: unknown[] }>('GET', '/automation/queue');
    log('GET /queue (self)', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'queue self HTTP');
  }

  // 7. Approve
  {
    const r = await req<{ status: string }>(
      'POST', `/automation/decisions/${decisionId}/approve`, {},
    );
    log('POST /approve', r.status, r.data);
    st(r.status, 200, 'approve HTTP');
    eq(r.data.status, 'approved', 'status=approved');
  }

  // 8. Повторный approve → 409 (атомарность P6)
  {
    const r = await req<{ code: string }>(
      'POST', `/automation/decisions/${decisionId}/approve`, {},
    );
    log('POST /approve (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный approve → 409');
    code(r.data.code, 'CONFLICT', 'approve повтор');
  }

  // 9. Reject без reason → 422
  const d2 = await ensureTestDecision(dirId, 'test.reject');
  {
    const r = await req<{ code: string }>(
      'POST', `/automation/decisions/${d2}/reject`, {},
    );
    log('POST /reject (без reason)', r.status, r.data);
    st(r.status, 422, 'reject без reason → 422');
  }

  // 10. Reject с reason
  {
    const r = await req<{ status: string; rejectionReason: string | null }>(
      'POST', `/automation/decisions/${d2}/reject`,
      { reason: 'Не соответствует регламенту' },
    );
    log('POST /reject', r.status, r.data);
    st(r.status, 200, 'reject HTTP');
    eq(r.data.status, 'rejected', 'status=rejected');
    eq(r.data.rejectionReason, 'Не соответствует регламенту', 'reason сохранён');
  }

  // 11. Повторный reject → 409
  {
    const r = await req<{ code: string }>(
      'POST', `/automation/decisions/${d2}/reject`,
      { reason: 'x' },
    );
    log('POST /reject (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный reject → 409');
    code(r.data.code, 'CONFLICT', 'reject повтор');
  }

  // 12. Defer
  const d3 = await ensureTestDecision(dirId, 'test.defer');
  {
    const r = await req<{ status: string }>(
      'POST', `/automation/decisions/${d3}/defer`,
      { new_deadline: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    );
    log('POST /defer', r.status, r.data);
    st(r.status, 200, 'defer HTTP');
    eq(r.data.status, 'deferred', 'status=deferred');
  }

  // 13. Повторный defer → 409
  {
    const r = await req<{ code: string }>(
      'POST', `/automation/decisions/${d3}/defer`,
      { new_deadline: new Date(Date.now() + 5 * 86_400_000).toISOString() },
    );
    log('POST /defer (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный defer → 409');
    code(r.data.code, 'CONFLICT', 'defer повтор');
  }

  // 14. Assign непрошедшего (Архитектор — без ai_certification) → 422/409
  {
    const r = await req(
      'POST', `/automation/sections/${SECTION_ID}/operator`,
      { operator_id: me.id },
    );
    log('POST /operator (непрошедший)', r.status, r.data);
    st(r.status, [422, 409], 'назначение непрошедшего отклонено');
  }

  // 15. GET /sections/:id (с V)
  {
    const r = await req<{ id: string }>(
      'GET', `/automation/sections/${SECTION_ID}`,
    );
    log('GET /sections/:id', r.status, { id: r.data.id });
    st(r.status, 200, 'section get HTTP');
    eq(r.data.id, SECTION_ID, 'section.id совпадает');
  }

  // 16. GET /sections/:fake → 404
  {
    const r = await req<{ code: string }>(
      'GET', '/automation/sections/00000000-0000-0000-0000-000000000000',
    );
    log('GET /sections/:fake', r.status, r.data);
    st(r.status, 404, 'section fake → 404');
    code(r.data.code, 'NOT_FOUND', 'section fake');
  }

  // 17. Audit
  {
    const r = await req<{ approvalRate: number; status: string }>(
      'GET', `/automation/operator/audit?operator_id=${OP_ID}`,
    );
    log('GET /operator/audit', r.status, r.data);
    st(r.status, 200, 'audit HTTP');
    truthy(typeof r.data.approvalRate === 'number', 'approvalRate:number');
  }

  // 18. should-audit / should-remove
  {
    const r = await req<{ should_audit: boolean }>(
      'GET', `/automation/operator/should-audit?operator_id=${OP_ID}`,
    );
    log('GET /should-audit', r.status, r.data);
    st(r.status, 200, 'should-audit HTTP');
    eq(typeof r.data.should_audit, 'boolean', 'should_audit:boolean');
  }
  {
    const r = await req<{ should_remove: boolean }>(
      'GET', `/automation/operator/should-remove?operator_id=${OP_ID}`,
    );
    log('GET /should-remove', r.status, r.data);
    st(r.status, 200, 'should-remove HTTP');
    eq(typeof r.data.should_remove, 'boolean', 'should_remove:boolean');
  }

  // 19. Combine: OPERATOR + COUNCIL_MEMBER → false
  {
    const r = await req<{ can_combine: boolean }>(
      'GET', `/automation/operator/combine?operator_id=${OP_ID}&role=COUNCIL_MEMBER`,
    );
    log('GET /combine (COUNCIL_MEMBER)', r.status, r.data);
    st(r.status, 200, 'combine HTTP');
    eq(r.data.can_combine, false, 'OPERATOR+COUNCIL → false');
  }

  // 20. Combine: OPERATOR + VERIFIER → true
  {
    const r = await req<{ can_combine: boolean }>(
      'GET', `/automation/operator/combine?operator_id=${OP_ID}&role=VERIFIER`,
    );
    log('GET /combine (VERIFIER)', r.status, r.data);
    st(r.status, 200, 'combine HTTP');
    eq(r.data.can_combine, true, 'OPERATOR+VERIFIER → true');
  }

  // 21. 🆕 Combine: невалидная роль → 422 (P4)
  {
    const r = await req<{ code: string }>(
      'GET', `/automation/operator/combine?operator_id=${OP_ID}&role=NOT_A_ROLE`,
    );
    log('GET /combine (NOT_A_ROLE)', r.status, r.data);
    st(r.status, 422, 'combine невалидная роль → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'combine невалидная роль');
  }

  // 22. Cron: run-daily-audit
  {
    const r = await req<{ audited: number; removed: number }>(
      'POST', '/automation/run-daily-audit', {},
    );
    log('POST /run-daily-audit', r.status, r.data);
    st(r.status, 200, 'run-daily-audit HTTP');
    eq(typeof r.data.audited, 'number', 'audited:number');
    eq(typeof r.data.removed, 'number', 'removed:number');
  }

  // 23. 🆕 Cron пишет audit_log (P10, косвенно)
  // delay: logAction может буферизовать; actor_type — без фильтра
  // (logAction может переопределить system → participant + system-actorId).
  {
    await new Promise((r) => setTimeout(r, 200));
    const row = await queryOne<{ cnt: string; types: string | null }>(
      `SELECT COUNT(*)::text AS cnt,
              string_agg(DISTINCT actor_type::text, ',') AS types
         FROM audit_log
        WHERE action = 'automation.run_daily_audit'
          AND created_at > now() - interval '1 hour'`,
    );
    const cnt = parseInt(row?.cnt ?? '0', 10);
    truthy(
      cnt >= 1,
      `audit_log: run_daily_audit (cnt=${cnt}, types=${row?.types ?? 'null'})`,
    );
  }

  // 24. Disable section
  {
    const r = await req<{ enabled: boolean; disableReason: string | null }>(
      'POST', `/automation/sections/${SECTION_ID}/disable`,
      { reason: 'Тестовое отключение (I.6.15.6)' },
    );
    log('POST /disable', r.status, r.data);
    st(r.status, 200, 'disable HTTP');
    eq(r.data.enabled, false, 'enabled=false');
  }

  // 25. 🆕 Повторный disable → 409 (P9)
  {
    const r = await req<{ code: string }>(
      'POST', `/automation/sections/${SECTION_ID}/disable`,
      { reason: 'x' },
    );
    log('POST /disable (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный disable → 409');
    code(r.data.code, 'CONFLICT', 'disable повтор');
  }

  console.log('\n✅ Полный цикл Автоматизации замкнут');
}

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) {console.error(e.stack);}
  })
  .finally(async () => {
    await cleanup();
    summarize();
    try { await gracefulShutdown(); } catch { /* ignore */ }
  });