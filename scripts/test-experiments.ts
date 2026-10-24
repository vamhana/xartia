// scripts/test-experiments.ts
// I.9.04.39 — Experiments + Dissident Projects + негатив v0.0.04.
//
// Покрытие:
//   - Happy path: create → approve ×2 (idempotent) → leave → join →
//     recordResults → getResults → my → complete.
//   - Dissident: create → petition → report → resource-source →
//     process-suspensions (без просрочки) → SQL-просрочка →
//     process-suspensions (с suspend) → report (реактивация) → SQL-aged review.
//   - 🆕 Негатив: 404 для несуществующего, 409 для completed, 422 для Zod
//     (пустой criteria, goal >5000, term_days=0/1826), approve при малом
//     support → approved:false.
//
// Запуск: pnpm tsx scripts/test-experiments.ts <phone> <password>

import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
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
function ok(m: string): void { OK++; console.log(`   ✓ ${m}`); }
function fail(m: string): void { FAIL++; console.log(`   ✗ ${m}`); }
function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2).slice(0, 800));
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (actual === expected) {
    ok(msg);
  } else {
    fail(`${msg} — ожидали ${String(expected)}, получили ${String(actual)}`);
  }
}

function st(actual: number, expected: number | number[], label: string): void {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) {
    ok(`${label} — HTTP ${actual}`);
  } else {
    fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
  }
}

function code(actual: string | undefined, expected: string, label: string): void {
  if (actual === expected) {
    ok(`${label} — code=${expected}`);
  } else {
    fail(`${label} — ожидали code=${expected}, получили ${String(actual)}`);
  }
}

function summarize(): void {
  console.log(`\n─── Итог: ${OK}/${OK + FAIL} ok, ${FAIL} fail ───`);
  if (FAIL > 0) {process.exitCode = 1;}
}

let EXP_ID: string | null = null;
let DISS_ID: string | null = null;

async function cleanup(): Promise<void> {
  try {
    if (EXP_ID) {
      await query(`DELETE FROM experiment_results WHERE protocol_id = $1`, [EXP_ID]);
      await query(`DELETE FROM experimental_protocols WHERE id = $1`, [EXP_ID]);
    }
    if (DISS_ID) {
      await query(`DELETE FROM dissident_projects WHERE id = $1`, [DISS_ID]);
    }
    ok('Cleanup выполнен');
  } catch (e) {
    fail(`Cleanup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main(): Promise<void> {
  const phone = process.argv[2];
  const password = process.argv[3];
  if (!phone || !password) {
    console.error('Usage: pnpm tsx scripts/test-experiments.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {
    console.error(`Login failed: ${JSON.stringify(login.data)}`);
    process.exit(1);
  }
  TOKEN = login.data.access_token;
  const meId = login.data.participant.id;
  ok(`login as ${meId}`);

  // 2. Permissions
  const perms = await req<{ rights: Record<string, string[]> }>(
    'GET', '/permissions/me',
  );
  const expRights = perms.data.rights['experiment'] ?? [];
  log('GET /permissions/me', perms.status, { experiment: expRights });
  st(perms.status, 200, 'permissions HTTP');
  eq(expRights.includes('C'), true, 'experiment:C');
  eq(expRights.includes('E'), true, 'experiment:E');
  eq(expRights.includes('A'), true, 'experiment:A');
  eq(expRights.includes('Act'), true, 'experiment:Act');

  // ═══════════════════════════════════════════════════════════
  //  🆕 Негатив Zod (v0.0.04) — createExperiment
  // ═══════════════════════════════════════════════════════════

  // 3. criteria={} → 422 (P1)
  {
    const r = await req<{ code: string }>('POST', '/experiments', {
      goal: 'Test', term_days: 30, criteria: {},
    });
    log('POST /experiments (criteria={})', r.status, r.data);
    st(r.status, 422, 'criteria={} → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'criteria={}');
  }

  // 4. goal >5000 → 422
  {
    const r = await req<{ code: string }>('POST', '/experiments', {
      goal: 'a'.repeat(5001), term_days: 30, criteria: { k: 1 },
    });
    log('POST /experiments (goal>5000)', r.status, r.data);
    st(r.status, 422, 'goal>5000 → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'goal>5000');
  }

  // 5. term_days=0 → 422
  {
    const r = await req<{ code: string }>('POST', '/experiments', {
      goal: 'Test', term_days: 0, criteria: { k: 1 },
    });
    log('POST /experiments (term_days=0)', r.status, r.data);
    st(r.status, 422, 'term_days=0 → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'term_days=0');
  }

  // 6. term_days=1826 → 422
  {
    const r = await req<{ code: string }>('POST', '/experiments', {
      goal: 'Test', term_days: 1826, criteria: { k: 1 },
    });
    log('POST /experiments (term_days=1826)', r.status, r.data);
    st(r.status, 422, 'term_days=1826 → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'term_days=1826');
  }

  // ═══════════════════════════════════════════════════════════
  //  Happy path
  // ═══════════════════════════════════════════════════════════

  // 7. Create experiment
  const create = await req<{ id: string; externalId: string; status: string; termDays: number }>(
    'POST', '/experiments', {
      goal: `Test experiment ${Date.now()}`,
      term_days: 30,
      criteria: { test: true, sample: 100 },
    },
  );
  log('POST /experiments', create.status, create.data);
  st(create.status, 201, 'create HTTP');
  eq(create.data.status, 'filed', 'status=filed');
  eq(create.data.termDays, 30, 'termDays=30');
  EXP_ID = create.data.id;

  // 8. GET /experiments (list)
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', '/experiments?page=1&per_page=100',
    );
    log('GET /experiments', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'list HTTP');
    eq(r.data.data?.some((x) => x.id === EXP_ID), true, 'Эксперимент в списке');
  }

  // 9. approve ×2 (idempotent) + 🆕 проверка approved:false при малом support
  {
    const a1 = await req<{
      experiment: { status: string };
      approved: boolean;
      progress: { responded: number; total: number; percent: number; required: number };
    }>('POST', `/experiments/${EXP_ID}/approve`, {});
    log('POST /approve (1)', a1.status, a1.data);
    st(a1.status, 200, 'approve #1 HTTP');
    eq(typeof a1.data.progress?.responded, 'number', 'progress.responded:number');
    eq(typeof a1.data.progress?.total, 'number', 'progress.total:number');
    eq(typeof a1.data.progress?.required, 'number', 'progress.required:number');
    eq(typeof a1.data.approved, 'boolean', 'approved:boolean');
    // 1 участник vs 75% от активных направлений: approve маловероятен
    // (при 14+ направлениях). Но approved:false — ожидаем.
    // Если направлений мало — approve может пройти. Проверяем когерентность:
    if (a1.data.approved) {
      eq(a1.data.experiment.status, 'active', 'approved → status=active');
      eq(a1.data.progress.responded >= a1.data.progress.required, true,
        'approved → responded ≥ required');
    } else {
      eq(a1.data.experiment.status, 'filed', 'not approved → status=filed');
      eq(a1.data.progress.responded < a1.data.progress.required, true,
        'not approved → responded < required');
    }
  }

  // Idempotency: повторный вызов — 200, тот же approved
  {
    const a2 = await req<{ approved: boolean }>(
      'POST', `/experiments/${EXP_ID}/approve`, {},
    );
    log('POST /approve (2, idempotent)', a2.status, a2.data);
    st(a2.status, 200, 'approve #2 HTTP');
  }

  // 10. leave (self) → 200, потом join (self) → 200
  {
    const r = await req<{ participants: string[] }>(
      'POST', `/experiments/${EXP_ID}/leave`, {},
    );
    log('POST /leave (self)', r.status, { count: r.data.participants?.length });
    st(r.status, 200, 'leave HTTP');
  }
  {
    const r = await req<{ participants: string[] }>(
      'POST', `/experiments/${EXP_ID}/join`, {},
    );
    log('POST /join (self)', r.status, { count: r.data.participants?.length });
    st(r.status, 200, 'join HTTP');
    eq(r.data.participants?.includes(meId) ?? false, true, 'я в participants');
  }

  // 11. 🆕 Повторный join (self) → 409 (entity: уже в participants)
  {
    const r = await req<{ code: string }>(
      'POST', `/experiments/${EXP_ID}/join`, {},
    );
    log('POST /join (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный join → 409');
    code(r.data.code, 'CONFLICT', 'повторный join');
  }

  // 12. recordResults
  const results = await req<{
    id: string; successes: string[]; failures: string[];
  }>('POST', `/experiments/${EXP_ID}/results`, {
    successes: ['test passed', 'metric improved'],
    failures: ['edge case failed'],
    stats: { sample_size: 100 },
  });
  log('POST /results', results.status, {
    id: results.data.id,
    s: results.data.successes?.length,
    f: results.data.failures?.length,
  });
  st(results.status, 201, 'recordResults HTTP');
  eq(results.data.successes?.length, 2, '2 successes');
  eq(results.data.failures?.length, 1, '1 failure');

  // 13. GET /results
  {
    const r = await req<{ results: { id: string } | null }>(
      'GET', `/experiments/${EXP_ID}/results`,
    );
    log('GET /results', r.status, { id: r.data.results?.id });
    st(r.status, 200, 'getResults HTTP');
    eq(r.data.results?.id, results.data.id, 'results.id совпадает');
  }

  // 14. GET /experiments/my
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', '/experiments/my',
    );
    log('GET /experiments/my', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'my HTTP');
    eq(r.data.data?.some((x) => x.id === EXP_ID), true, 'Эксперимент в моих');
  }

  // 15. complete
  {
    const r = await req<{ status: string; finishedAt: string | null }>(
      'POST', `/experiments/${EXP_ID}/complete`, {},
    );
    log('POST /complete', r.status, r.data);
    st(r.status, 200, 'complete HTTP');
    eq(r.data.status, 'completed', 'status=completed');
    eq(typeof r.data.finishedAt, 'string', 'finishedAt установлен');
  }

  // 16. 🆕 complete повторно → 409 (entity: уже completed)
  {
    const r = await req<{ code: string }>(
      'POST', `/experiments/${EXP_ID}/complete`, {},
    );
    log('POST /complete (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный complete → 409');
    code(r.data.code, 'CONFLICT', 'повторный complete');
  }

  // 17. 🆕 join для completed → 409
  {
    const r = await req<{ code: string }>(
      'POST', `/experiments/${EXP_ID}/join`, {},
    );
    log('POST /join (completed)', r.status, r.data);
    st(r.status, 409, 'join для completed → 409');
    code(r.data.code, 'CONFLICT', 'join для completed');
  }

  // ═══════════════════════════════════════════════════════════
  //  🆕 404-негатив
  // ═══════════════════════════════════════════════════════════

  const fake = '00000000-0000-0000-0000-000000000000';

  // 18. GET /experiments/:id (fake) → 404
  {
    const r = await req<{ code: string }>('GET', `/experiments/${fake}`);
    log('GET /experiments/:fake', r.status, r.data);
    st(r.status, 404, 'get fake → 404');
    code(r.data.code, 'NOT_FOUND', 'get fake');
  }

  // 19. POST /experiments/:fake/approve → 404
  {
    const r = await req<{ code: string }>('POST', `/experiments/${fake}/approve`, {});
    log('POST /experiments/:fake/approve', r.status, r.data);
    st(r.status, 404, 'approve fake → 404');
    code(r.data.code, 'NOT_FOUND', 'approve fake');
  }

  // ═══════════════════════════════════════════════════════════
  //  Диссидентские проекты
  // ═══════════════════════════════════════════════════════════

  // 20. create dissident
  const diss = await req<{ id: string; status: string; resourceSource: string }>(
    'POST', '/dissident-projects', {
      description: `Test dissident ${Date.now()}`,
    },
  );
  log('POST /dissident-projects', diss.status, diss.data);
  st(diss.status, 201, 'create diss HTTP');
  eq(diss.data.status, 'filed', 'status=filed');
  eq(diss.data.resourceSource, 'deferred_flow', 'resourceSource=deferred_flow');
  DISS_ID = diss.data.id;

  // 21. petition
  {
    const r = await req<{ petitionCount: number; status: string; resourceSource: string }>(
      'POST', `/dissident-projects/${DISS_ID}/petition`, {},
    );
    log('POST /petition', r.status, {
      count: r.data.petitionCount,
      status: r.data.status,
      source: r.data.resourceSource,
    });
    st(r.status, 200, 'petition HTTP');
    eq(r.data.petitionCount >= 1, true, 'petitionCount ≥ 1');
  }

  // 22. report
  {
    const r = await req<{ lastReportAt: string | null; status: string }>(
      'POST', `/dissident-projects/${DISS_ID}/report`,
      { content: 'Тестовый отчёт' },
    );
    log('POST /report', r.status, r.data);
    st(r.status, 200, 'report HTTP');
    eq(typeof r.data.lastReportAt, 'string', 'lastReportAt установлен');
  }

  // 23. resource-source
  {
    const r = await req<{ source: string }>(
      'GET', `/dissident-projects/${DISS_ID}/resource-source`,
    );
    log('GET /resource-source', r.status, r.data);
    st(r.status, 200, 'resource-source HTTP');
    eq(
      ['deferred_flow', 'freedom_reserve'].includes(r.data.source),
      true,
      'source валиден',
    );
  }

  // 24. process-suspensions (свежий проект не suspend)
  {
    const r = await req<{ suspended: number; checked: number }>(
      'POST', '/dissident-projects/process-suspensions', {},
    );
    log('POST /process-suspensions', r.status, r.data);
    st(r.status, 200, 'process-suspensions HTTP');
    eq(typeof r.data.suspended, 'number', 'suspended:number');
    eq(typeof r.data.checked, 'number', 'checked:number');
  }
  {
    const r = await req<{ status: string }>(
      'GET', `/dissident-projects/${DISS_ID}`,
    );
    eq(r.data.status !== 'suspended', true, 'свежий проект не suspended');
  }

  // 25. SQL-просрочка → suspend
  await query(
    `UPDATE dissident_projects SET last_report_at = now() - interval '90 days' WHERE id = $1`,
    [DISS_ID],
  );
  {
    const r = await req<{ suspended: number }>(
      'POST', '/dissident-projects/process-suspensions', {},
    );
    log('POST /process-suspensions (после просрочки)', r.status, r.data);
    st(r.status, 200, 'process-suspensions #2 HTTP');
    eq(r.data.suspended >= 1, true, 'suspended ≥ 1');
  }
  {
    const r = await req<{ status: string }>(
      'GET', `/dissident-projects/${DISS_ID}`,
    );
    eq(r.data.status, 'suspended', 'Проект suspended');
  }

  // 26. report → реактивация
  await req('POST', `/dissident-projects/${DISS_ID}/report`, {
    content: 'Отчёт после приостановки',
  });
  {
    const r = await req<{ status: string }>(
      'GET', `/dissident-projects/${DISS_ID}`,
    );
    eq(r.data.status, 'active', 'Проект вернулся в active');
  }

  // 27. review (через 2 года — SQL-age)
  await query(
    `UPDATE dissident_projects SET created_at = now() - interval '3 years' WHERE id = $1`,
    [DISS_ID],
  );
  {
    const r = await req<{ status: string }>(
      'POST', `/dissident-projects/${DISS_ID}/review`, {},
    );
    log('POST /review', r.status, r.data);
    st(r.status, 200, 'review HTTP');
    eq(r.data.status, 'reviewed', 'status=reviewed');
  }

  // 28. 🆕 review на свежий проект (без age) → 409
  //     Создаём новый проект и пробуем review сразу.
  {
    const fresh = await req<{ id: string }>(
      'POST', '/dissident-projects', {
        description: `Fresh project ${Date.now()}`,
      },
    );
    const r = await req<{ code: string }>(
      'POST', `/dissident-projects/${fresh.data.id}/review`, {},
    );
    log('POST /review (свежий)', r.status, r.data);
    st(r.status, 409, 'review свежего → 409');
    code(r.data.code, 'CONFLICT', 'review свежего');
    // Cleanup этого проекта
    await query(`DELETE FROM dissident_projects WHERE id = $1`, [fresh.data.id]);
  }

  console.log('\n✅ Полный цикл Experiments + Dissident замкнут');
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