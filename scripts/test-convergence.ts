// scripts/test-convergence.ts
// I.9.04.38 — Полный цикл Convergence + негативные сценарии v0.0.03.
//
// Покрытие:
//   - Happy path: create → declaration → council → stage 1..5 → conversion
//     (debts/assets/weapons/culture) → audit → validate → complete.
//   - 🆕 Негатив Zod (v0.0.03): council <11, council без role, council 11×SP,
//     debts external+convert, internal+annul, stage/0, stage/6.
//   - 🆕 Регрессия v0.0.03: skip-stage через error-handler (code=CONFLICT,
//     audit_id в теле), повторный stage/5.
//
// Запуск: pnpm tsx scripts/test-convergence.ts <phone> <password>

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

// ─── HTTP-хелпер ─────────────────────────────────────────────────

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

// ─── Отчётность ──────────────────────────────────────────────────

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

function expectStatus(
  actual: number,
  expected: number | number[],
  label: string,
): boolean {
  const list = Array.isArray(expected) ? expected : [expected];
  if (list.includes(actual)) { ok(`${label} — HTTP ${actual}`); return true; }
  fail(`${label} — ожидали ${list.join('/')}, получили ${actual}`);
  return false;
}

function expectTruthy(v: unknown, msg: string): boolean {
  if (v) { ok(msg); return true; }
  fail(`${msg} — получено ${String(v)}`);
  return false;
}

function expectCode(
  actual: string | undefined,
  expected: string,
  label: string,
): boolean {
  if (actual === expected) { ok(`${label} — code=${expected}`); return true; }
  fail(`${label} — ожидали code=${expected}, получили ${String(actual)}`);
  return false;
}

function summarize(): void {
  const total = OK + FAIL;
  console.log(`\n─── Итог: ${OK}/${total} ok, ${FAIL} fail ───`);
  if (FAIL > 0) { globalThis.process.exitCode = 1; }
}

// ─── Cleanup-состояние ───────────────────────────────────────────

let PLAN_ID: string | null = null;
let MARKER = '';

async function cleanup(): Promise<void> {
  if (!PLAN_ID) {return;}
  try {
    await query(`DELETE FROM debt_conversions WHERE plan_id = $1`, [PLAN_ID]);
    await query(`DELETE FROM asset_conversions WHERE plan_id = $1`, [PLAN_ID]);
    await query(`DELETE FROM weapon_conversions WHERE plan_id = $1`, [PLAN_ID]);
    await query(`DELETE FROM cultural_centers WHERE plan_id = $1`, [PLAN_ID]);
    await query(`DELETE FROM convergence_council WHERE plan_id = $1`, [PLAN_ID]);
    await query(`DELETE FROM convergence_plans WHERE id = $1`, [PLAN_ID]);

    const leftover = await queryOne<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM convergence_plans WHERE state_name = $1`,
      [MARKER],
    );
    const cnt = parseInt(leftover?.cnt ?? '0', 10);
    expectEq(cnt, 0, 'Cleanup: тестовый план удалён');
  } catch (e) {
    fail(`Cleanup error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Основной сценарий ───────────────────────────────────────────

async function main(): Promise<void> {
  const phone = globalThis.process.argv[2] ?? '+79001234567';
  const password = globalThis.process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-convergence.ts <phone> <password>');
    globalThis.process.exit(1);
  }

  MARKER = `TestState-${Date.now()}`;

  // ───── 1. Login ──────────────────────────────────────────────
  const login = await req<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  log('POST /auth/login', login.status, { ok: login.status === 200 });
  if (!expectStatus(login.status, 200, 'POST /auth/login')) {
    globalThis.process.exit(1);
  }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}`);

  // ───── 2. Права ──────────────────────────────────────────────
  const perms = await req<{ rights: Record<string, string[]> }>('GET', '/permissions/me');
  const cRights = perms.data.rights['convergence'] ?? [];
  log('GET /permissions/me', perms.status, { convergence: cRights });
  expectStatus(perms.status, 200, 'GET /permissions/me');
  expectEq(cRights.includes('C'), true, 'convergence:C доступно');
  expectEq(cRights.includes('E'), true, 'convergence:E доступно');

  // ───── 3. max-months ─────────────────────────────────────────
  const maxMonths = await req<{ max_months: number }>(
    'GET', '/convergence/max-months',
  );
  log('GET /convergence/max-months', maxMonths.status, maxMonths.data);
  expectStatus(maxMonths.status, 200, 'max-months HTTP');
  expectEq(maxMonths.data.max_months, 60, 'max_months=60 (I.7.2)');

  // ───── 4. Create plan ────────────────────────────────────────
  const create = await req<{ id: string; stage: number; status: string }>(
    'POST', '/convergence/plans', { state_name: MARKER },
  );
  log('POST /convergence/plans', create.status, create.data);
  expectStatus(create.status, 201, 'create HTTP');
  expectEq(create.data.stage, 0, 'stage=0');
  expectEq(create.data.status, 'draft', 'status=draft');
  PLAN_ID = create.data.id;

  // ───── 5. List plans ─────────────────────────────────────────
  const listQ = await req<{ data: Array<{ id: string }> }>(
    'GET', '/convergence/plans?page=1&per_page=100',
  );
  log('GET /convergence/plans', listQ.status, { count: listQ.data.data?.length });
  expectStatus(listQ.status, 200, 'list HTTP');
  expectEq(listQ.data.data.some((p) => p.id === PLAN_ID), true, 'План в списке');

  // ───── 6. Get plan ───────────────────────────────────────────
  const getQ = await req<{ id: string; stateName: string }>(
    'GET', `/convergence/plans/${PLAN_ID}`,
  );
  log('GET /convergence/plans/:id', getQ.status, {
    id: getQ.data.id, stateName: getQ.data.stateName,
  });
  expectStatus(getQ.status, 200, 'get HTTP');

  // ───── 7. Declaration ────────────────────────────────────────
  const decl = await req<{ status: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/declaration`,
    { signed_by: me.id },
  );
  log('POST /declaration', decl.status, decl.data);
  expectStatus(decl.status, 200, 'declaration HTTP');
  expectEq(decl.data.status, 'declared', 'status=declared');

  // ═════════════════════════════════════════════════════════════
  //  🆕 Негатив council — ДО валидного (v0.0.03 superRefine)
  // ═════════════════════════════════════════════════════════════

  // 8a. Council <11 → 422 (Zod: min(11))
  {
    const small = Array.from({ length: 10 }, (_, i) => ({ role: `SP-${i}` }));
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/council`, { members: small },
    );
    log('POST /council (<11)', r.status, r.data);
    expectStatus(r.status, 422, 'council <11 → 422');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'council <11');
  }

  // 8b. Council без role → 422 (superRefine)
  {
    const bogus = Array.from({ length: 11 }, (_, i) => ({ foo: `bar-${i}` }));
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/council`, { members: bogus },
    );
    log('POST /council (без role)', r.status, r.data);
    expectStatus(r.status, 422, 'council без role → 422');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'council без role');
  }

  // 8c. Council 11×SP (нет DIR/STATE/AUDITOR) → 422 (superRefine)
  {
    const wrong = Array.from({ length: 11 }, (_, i) => ({ role: `SP-${i}` }));
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/council`, { members: wrong },
    );
    log('POST /council (11×SP)', r.status, r.data);
    expectStatus(r.status, 422, 'council 11×SP → 422');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'council 11×SP');
  }

  // ───── 9. Council valid (3 SP + 3 DIR + 3 STATE + 2 AUDITOR) ─
  const members = [
    { role: 'SP-1' }, { role: 'SP-2' }, { role: 'SP-3' },
    { role: 'DIR-1' }, { role: 'DIR-2' }, { role: 'DIR-3' },
    { role: 'STATE-1' }, { role: 'STATE-2' }, { role: 'STATE-3' },
    { role: 'AUDITOR-1' }, { role: 'AUDITOR-2' },
  ];
  const council = await req<{ id: string; members: unknown[] }>(
    'POST', `/convergence/plans/${PLAN_ID}/council`, { members },
  );
  log('POST /council', council.status, {
    id: council.data.id, members_count: council.data.members?.length,
  });
  expectStatus(council.status, 201, 'council HTTP');
  expectEq(council.data.members.length, 11, 'members=11');

  // ───── 10. Get council ───────────────────────────────────────
  const councilGet = await req<{ council: { id: string } | null }>(
    'GET', `/convergence/plans/${PLAN_ID}/council`,
  );
  log('GET /council', councilGet.status, { council_id: councilGet.data.council?.id });
  expectStatus(councilGet.status, 200, 'council get HTTP');
  expectEq(councilGet.data.council?.id, council.data.id, 'council.id совпадает');

  // ═════════════════════════════════════════════════════════════
  //  🆕 Негатив stage — v0.0.03 (Zod min/max, error-handler)
  // ═════════════════════════════════════════════════════════════

  // 11. Skip stage/3 (при stage=0, ожидается stage/1) → 409 CONFLICT
  {
    const r = await req<{ code: string; message: string; audit_id: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/stage/3`, {},
    );
    log('POST /stage/3 (skip)', r.status, r.data);
    expectStatus(r.status, 409, 'skip stage/3 → 409');
    expectCode(r.data.code, 'CONFLICT', 'skip stage');
    expectTruthy(
      typeof r.data.audit_id === 'string' && r.data.audit_id.length > 0,
      'skip stage: audit_id присутствует (через error-handler)',
    );
  }

  // 12. stage/0 → 422 (Zod: min(1), было 409 от бизнес-логики)
  {
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/stage/0`, {},
    );
    log('POST /stage/0', r.status, r.data);
    expectStatus(r.status, 422, 'stage/0 → 422 (Zod min(1))');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'stage/0');
  }

  // 13. stage/6 → 422 (Zod: max(5))
  {
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/stage/6`, {},
    );
    log('POST /stage/6', r.status, r.data);
    expectStatus(r.status, 422, 'stage/6 → 422 (Zod max(5))');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'stage/6');
  }

  // ───── 14. Stage 1 → 2 → 3 → 4 ───────────────────────────────
  for (const n of [1, 2, 3, 4]) {
    const r = await req<{ stage: number }>(
      'POST', `/convergence/plans/${PLAN_ID}/stage/${n}`, {},
    );
    log(`POST /stage/${n}`, r.status, r.data);
    expectStatus(r.status, 200, `stage/${n} HTTP`);
    expectEq(r.data.stage, n, `stage=${n}`);
  }

  // ───── 15. Criteria (перед stage 5) ──────────────────────────
  const critQ = await req<{ canAdvance: boolean; nextStage: number }>(
    'GET', `/convergence/plans/${PLAN_ID}/criteria`,
  );
  log('GET /criteria', critQ.status, critQ.data);
  expectStatus(critQ.status, 200, 'criteria HTTP');
  expectEq(critQ.data.nextStage, 5, 'nextStage=5');

  // ═════════════════════════════════════════════════════════════
  //  🆕 Негатив debts — v0.0.03 superRefine (action ↔ type)
  // ═════════════════════════════════════════════════════════════

  // 16a. external + action='convert' → 422 (Zod, было из сервиса)
  {
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/debts`,
      { type: 'external', amount: 100, action: 'convert' },
    );
    log('POST /debts (external+convert)', r.status, r.data);
    expectStatus(r.status, 422, 'debts external+convert → 422');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'debts external+convert');
  }

  // 16b. internal + action='annul' → 422
  {
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/debts`,
      { type: 'internal', amount: 100, action: 'annul' },
    );
    log('POST /debts (internal+annul)', r.status, r.data);
    expectStatus(r.status, 422, 'debts internal+annul → 422');
    expectCode(r.data.code, 'VALIDATION_ERROR', 'debts internal+annul');
  }

  // ───── 17. Debts valid ───────────────────────────────────────
  const debtExt = await req<{ id: string; action: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/debts`,
    { type: 'external', amount: 1000 },
  );
  log('POST /debts (external)', debtExt.status, debtExt.data);
  expectStatus(debtExt.status, 201, 'debt external HTTP');
  expectEq(debtExt.data.action, 'annul', 'action=annul для external');

  const debtInt = await req<{ id: string; action: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/debts`,
    { type: 'internal', amount: 500 },
  );
  log('POST /debts (internal)', debtInt.status, debtInt.data);
  expectStatus(debtInt.status, 201, 'debt internal HTTP');
  expectEq(debtInt.data.action, 'convert', 'action=convert для internal');

  // ───── 18. Debts list ────────────────────────────────────────
  const debtsList = await req<{ data: Array<{ id: string }> }>(
    'GET', `/convergence/plans/${PLAN_ID}/debts`,
  );
  log('GET /debts', debtsList.status, { count: debtsList.data.data?.length });
  expectStatus(debtsList.status, 200, 'debts list HTTP');
  expectEq(
    (debtsList.data.data?.length ?? 0) >= 2,
    true,
    '≥2 конверсии долгов',
  );

  // ───── 19. Assets ────────────────────────────────────────────
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) {
    fail('Нет активных направлений для asset conversion');
  } else {
    const asset = await req<{ id: string; destinationDirectionId: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/assets`,
      { asset_type: 'real_estate', value: 250000, destination_direction_id: dir.id },
    );
    log('POST /assets', asset.status, asset.data);
    expectStatus(asset.status, 201, 'asset HTTP');
    expectEq(asset.data.destinationDirectionId, dir.id, 'destination сохранён');

    const assetsList = await req<{ data: Array<{ id: string }> }>(
      'GET', `/convergence/plans/${PLAN_ID}/assets`,
    );
    log('GET /assets', assetsList.status, { count: assetsList.data.data?.length });
    expectStatus(assetsList.status, 200, 'assets list HTTP');
  }

  // ───── 20. Weapons ───────────────────────────────────────────
  const weapon = await req<{ id: string; action: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/weapons`,
    { weapon_type: 'heavy', action: 'utilize' },
  );
  log('POST /weapons', weapon.status, weapon.data);
  expectStatus(weapon.status, 201, 'weapon HTTP');
  expectEq(weapon.data.action, 'utilize', 'action=utilize');

  const weaponsList = await req<{ data: Array<{ id: string }> }>(
    'GET', `/convergence/plans/${PLAN_ID}/weapons`,
  );
  log('GET /weapons', weaponsList.status, {
    count: weaponsList.data.data?.length,
  });
  expectStatus(weaponsList.status, 200, 'weapons list HTTP');

  // ───── 21. Culture ───────────────────────────────────────────
  const culture = await req<{ id: string; location: { lat: number; lon: number } }>(
    'POST', `/convergence/plans/${PLAN_ID}/culture`,
    { lat: 55.7558, lon: 37.6173 },
  );
  log('POST /culture', culture.status, culture.data);
  expectStatus(culture.status, 201, 'culture HTTP');
  expectEq(typeof culture.data.location?.lat, 'number', 'location.lat');

  const cultureList = await req<{ data: Array<{ id: string }> }>(
    'GET', `/convergence/plans/${PLAN_ID}/culture`,
  );
  log('GET /culture', cultureList.status, {
    count: cultureList.data.data?.length,
  });
  expectStatus(cultureList.status, 200, 'culture list HTTP');

  // ───── 22. Audit ─────────────────────────────────────────────
  const audit = await req<{ findings: string[] }>(
    'POST', `/convergence/plans/${PLAN_ID}/audit`, {},
  );
  log('POST /audit', audit.status, audit.data);
  expectStatus(audit.status, 200, 'audit HTTP');
  expectEq(Array.isArray(audit.data.findings), true, 'findings:array');

  // ───── 23. Stage 5 (финальный → completed) ───────────────────
  const s5 = await req<{ stage: number; status: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/stage/5`, {},
  );
  log('POST /stage/5', s5.status, s5.data);
  expectStatus(s5.status, 200, 'stage/5 HTTP');
  expectEq(s5.data.stage, 5, 'stage=5');
  expectEq(s5.data.status, 'completed', 'status=completed после stage 5');

  // ───── 24. validate-completion ───────────────────────────────
  const validateQ = await req<{ canComplete: boolean }>(
    'GET', `/convergence/plans/${PLAN_ID}/validate-completion`,
  );
  log('GET /validate-completion', validateQ.status, validateQ.data);
  expectStatus(validateQ.status, 200, 'validate HTTP');
  expectEq(validateQ.data.canComplete, true, 'canComplete=true');

  // ───── 25. complete (идемпотентно) ───────────────────────────
  const complete = await req<{ status: string }>(
    'POST', `/convergence/plans/${PLAN_ID}/complete`, {},
  );
  log('POST /complete (идемпотентно)', complete.status, complete.data);
  expectStatus(complete.status, 200, 'complete HTTP');
  expectEq(complete.data.status, 'completed', 'status=completed');

  // ───── 26. stage/5 повторно → 409 CONFLICT ───────────────────
  {
    const r = await req<{ code: string }>(
      'POST', `/convergence/plans/${PLAN_ID}/stage/5`, {},
    );
    log('POST /stage/5 (повтор)', r.status, r.data);
    expectStatus(r.status, 409, 'Повторный stage/5 отклонён');
    expectCode(r.data.code, 'CONFLICT', 'Повторный stage/5');
  }

  console.log('\n✅ Полный цикл Convergence замкнут (26 шагов)');
}

// ─── Entry point ─────────────────────────────────────────────────

main()
  .catch((e) => {
    FAIL++;
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    if (e instanceof Error && e.stack) { console.error(e.stack); }
  })
  .finally(async () => {
    await cleanup();
    summarize();
    try {
      await gracefulShutdown();
    } catch (e) {
      console.error('gracefulShutdown error:', e);
    }
  });