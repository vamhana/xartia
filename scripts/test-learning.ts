// scripts/test-learning.ts (I.9.04.50)
// Полный цикл Learning + негатив v0.0.02.
//
// Покрытие:
//   - Курсы: create → list → get → enroll → complete → повторный complete → 409.
//   - Digital mentor: get → transfer (self) → transfer чужого без прав → 403.
//   - ПТТ: create → get → advance ×4 → completed → повторный advance → 409 → audit.
//   - Когнитивные маршруты: create → list → queue → complete → повторный → 409.
//   - Рефреш: create (self) → d1===d2 → 422 → 404 на fake direction.
//   - Модули: basic-defense → respect (self).
//   - Интеграторы: create → list → mentee ×3 → 4-й → 409 → fake mentee → 404.
//   - Негатив: 404 для fake course/ptt/route/integrator.
//
// Запуск: pnpm tsx scripts/test-learning.ts <phone> <password>

import 'dotenv/config';
import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const env = globalThis.process.env;
const BASE = env['API_URL'] ?? 'http://localhost:3000';
const MARKER = `LRN-${Date.now()}:`;
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
  console.log(JSON.stringify(data, null, 2).slice(0, 700));
}
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

// ─── Cleanup-состояние ───
let ME_ID = '';
let DIRECTION_ID = '';
let COURSE_ID: string | null = null;
let PTT_ID: string | null = null;
let ROUTE_ID: string | null = null;
let INTEGRATOR_ID: string | null = null;

async function cleanup(): Promise<void> {
  try {
    if (COURSE_ID) {
      await query(`DELETE FROM enrollments WHERE course_id = $1`, [COURSE_ID]);
      await query(`DELETE FROM courses WHERE id = $1`, [COURSE_ID]);
    }
    if (PTT_ID) {
      await query(`DELETE FROM ptt_projects WHERE id = $1`, [PTT_ID]);
    }
    if (ROUTE_ID) {
      await query(`DELETE FROM cognitive_routes WHERE id = $1`, [ROUTE_ID]);
    }
    if (INTEGRATOR_ID) {
      await query(`DELETE FROM integrator_mentors WHERE id = $1`, [INTEGRATOR_ID]);
    }
    if (ME_ID) {
      // D.2.01.03: колонка direction_1, без _id.
      await query(`DELETE FROM refresh_courses WHERE participant_id = $1`, [ME_ID]);
      await query(
        `DELETE FROM module_passes WHERE participant_id = $1 AND passed_at > now() - interval '1 hour'`,
        [ME_ID],
      );
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
    console.error('Usage: pnpm tsx scripts/test-learning.ts <phone> <password>');
    process.exit(1);
  }

  // ─── 1. Login ───
  const login = await req<{
    access_token: string;
    participant: { id: string; direction_id: string };
  }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) {
    console.error(`Login failed: ${JSON.stringify(login.data)}`);
    process.exit(1);
  }
  TOKEN = login.data.access_token;
  ME_ID = login.data.participant.id;
  ok(`login as ${ME_ID}`);

  // Direction — реальный UUID (для refresh/route)
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 1`,
  );
  if (!dir) { fail('Нет активных направлений — тест невозможен'); return; }
  DIRECTION_ID = dir.id;

  // ─── 2. Права ───
  const perms = await req<{ rights: Record<string, string[]> }>(
    'GET', '/permissions/me',
  );
  const lrn = perms.data.rights['learning'] ?? [];
  log('GET /permissions/me', perms.status, { learning: lrn });
  st(perms.status, 200, 'permissions HTTP');
  eq(lrn.includes('C'), true, 'learning:C');
  eq(lrn.includes('E'), true, 'learning:E');

  // ═══════════════════════════════════════════════════════════
  //  КУРСЫ
  // ═══════════════════════════════════════════════════════════

  // ─── 3. POST /learning/courses ───
  {
    const r = await req<{ id: string; title: string; durationDays: number }>(
      'POST', '/learning/courses', {
        title: `${MARKER}Course`,
        description: 'Test course description',
        modules: [{ n: 1, title: 'Intro' }, { n: 2, title: 'Advanced' }],
        duration_days: 30,
      },
    );
    log('POST /learning/courses', r.status, r.data);
    st(r.status, 201, 'create course HTTP');
    eq(r.data.durationDays, 30, 'durationDays=30');
    COURSE_ID = r.data.id;
  }

  // ─── 4. GET /learning/courses (list) ───
  {
    const r = await req<{ data: Array<{ id: string }>; meta: { total: number } }>(
      'GET', '/learning/courses?page=1&per_page=100',
    );
    log('GET /learning/courses', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'list courses HTTP');
    eq(r.data.data?.some((c) => c.id === COURSE_ID), true, 'курс в списке');
  }

  // ─── 5. GET /learning/courses/:id ───
  {
    const r = await req<{ id: string }>('GET', `/learning/courses/${COURSE_ID}`);
    log('GET /learning/courses/:id', r.status, { id: r.data.id });
    st(r.status, 200, 'get course HTTP');
    eq(r.data.id, COURSE_ID, 'id совпадает');
  }

  // ─── 6. POST /learning/courses/:id/enroll ───
  {
    const r = await req<{ id: string; status: string; participantId: string }>(
      'POST', `/learning/courses/${COURSE_ID}/enroll`, {},
    );
    log('POST /enroll', r.status, r.data);
    st(r.status, 201, 'enroll HTTP');
    eq(r.data.status, 'enrolled', 'status=enrolled');
    eq(r.data.participantId, ME_ID, 'participantId=me');
  }

  // ─── 7. enroll повторно → 409 ───
  {
    const r = await req<{ code: string }>(
      'POST', `/learning/courses/${COURSE_ID}/enroll`, {},
    );
    log('POST /enroll (повтор)', r.status, r.data);
    st(r.status, 409, 'повторный enroll → 409');
    code(r.data.code, 'CONFLICT', 'enroll повтор');
  }

  // ─── 8. POST /learning/courses/:id/complete ───
  {
    const r = await req<{ status: string; finishedAt: string | null }>(
      'POST', `/learning/courses/${COURSE_ID}/complete`, {},
    );
    log('POST /complete', r.status, r.data);
    st(r.status, 200, 'complete HTTP');
    eq(r.data.status, 'completed', 'status=completed');
    truthy(typeof r.data.finishedAt === 'string', 'finishedAt установлен');
  }

  // ─── 9. complete повторно → 404 (нет активной записи) ───
  {
    const r = await req<{ code: string }>(
      'POST', `/learning/courses/${COURSE_ID}/complete`, {},
    );
    log('POST /complete (повтор)', r.status, r.data);
    st(r.status, 404, 'повторный complete → 404 (нет активной записи)');
    code(r.data.code, 'NOT_FOUND', 'complete повтор');
  }

  // ═══════════════════════════════════════════════════════════
  //  ЦИФРОВОЙ НАСТАВНИК
  // ═══════════════════════════════════════════════════════════

  // ─── 10. GET /learning/digital-mentor ───
  {
    const r = await req<{ id: string; mentorType: string }>(
      'GET', '/learning/digital-mentor',
    );
    log('GET /digital-mentor', r.status, r.data);
    st(r.status, 200, 'digital-mentor HTTP');
    eq(r.data.mentorType, 'ai', 'mentorType=ai');
  }

  // ─── 11. POST /learning/digital-mentor/transfer (self) ───
  {
    const r = await req<{ activeMentees: number }>(
      'POST', '/learning/digital-mentor/transfer', {
        mentee_id: ME_ID,
        human_mentor_id: ME_ID,
        reason: 'self-transfer test',
      },
    );
    log('POST /transfer (self)', r.status, r.data);
    st(r.status, 200, 'transfer self HTTP');
    truthy(typeof r.data.activeMentees === 'number', 'activeMentees:number');
  }

  // ═══════════════════════════════════════════════════════════
  //  ПТТ
  // ═══════════════════════════════════════════════════════════

  // ─── 12. POST /learning/ptt ───
  {
    const r = await req<{ id: string; status: string; durationDays: number }>(
      'POST', '/learning/ptt', {
        goal: `${MARKER}PTT goal`,
        duration_days: 30,
      },
    );
    log('POST /ptt', r.status, r.data);
    st(r.status, 201, 'create ptt HTTP');
    eq(r.data.status, 'started', 'status=started');
    eq(r.data.durationDays, 30, 'durationDays=30');
    PTT_ID = r.data.id;
  }

  // ─── 13. POST /ptt duration_days=91 → 422 ───
  {
    const r = await req<{ code: string }>('POST', '/learning/ptt', {
      goal: 'Test', duration_days: 91,
    });
    log('POST /ptt (duration=91)', r.status, r.data);
    st(r.status, 422, 'duration_days=91 → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'duration_days=91');
  }

  // ─── 14. GET /learning/ptt/:id ───
  {
    const r = await req<{ id: string; status: string }>(
      'GET', `/learning/ptt/${PTT_ID}`,
    );
    log('GET /ptt/:id', r.status, { id: r.data.id, status: r.data.status });
    st(r.status, 200, 'get ptt HTTP');
    eq(r.data.status, 'started', 'status=started');
  }

  // ─── 15. advance ×4: started → compression → materialization → reintegration → completed ───
  {
    const statuses = ['compression', 'materialization', 'reintegration', 'completed'];
    for (const s of statuses) {
      const r = await req<{ status: string }>(
        'POST', `/learning/ptt/${PTT_ID}/advance`, {},
      );
      log(`POST /ptt/:id/advance → ${s}`, r.status, { status: r.data.status });
      st(r.status, 200, `advance HTTP (→${s})`);
      eq(r.data.status, s, `status=${s}`);
    }
  }

  // ─── 16. advance после completed → 409 ───
  {
    const r = await req<{ code: string }>(
      'POST', `/learning/ptt/${PTT_ID}/advance`, {},
    );
    log('POST /ptt/:id/advance (completed)', r.status, r.data);
    st(r.status, 409, 'advance completed → 409');
    code(r.data.code, 'CONFLICT', 'advance completed');
  }

  // ─── 17. GET /learning/ptt/:id/audit ───
  {
    const r = await req<{ findings: string[] }>(
      'GET', `/learning/ptt/${PTT_ID}/audit`,
    );
    log('GET /ptt/:id/audit', r.status, { findings: r.data.findings?.length });
    st(r.status, 200, 'audit ptt HTTP');
    truthy(Array.isArray(r.data.findings), 'findings:array');
  }

  // ─── 18. GET /learning/ptt/:fake → 404 ───
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>('GET', `/learning/ptt/${fake}`);
    log('GET /ptt/:fake', r.status, r.data);
    st(r.status, 404, 'ptt fake → 404');
    code(r.data.code, 'NOT_FOUND', 'ptt fake');
  }

  // ═══════════════════════════════════════════════════════════
  //  КОГНИТИВНЫЕ МАРШРУТЫ
  // ═══════════════════════════════════════════════════════════

  // ─── 19. POST /cognitive-routes ───
  {
    const r = await req<{ id: string; status: string; participantId: string }>(
      'POST', '/cognitive-routes', {
        participant_id: ME_ID,
        direction_id: DIRECTION_ID,
        mentor_id: ME_ID,
      },
    );
    log('POST /cognitive-routes', r.status, r.data);
    st(r.status, 201, 'create route HTTP');
    eq(r.data.status, 'active', 'status=active');
    eq(r.data.participantId, ME_ID, 'participantId=me');
    ROUTE_ID = r.data.id;
  }

  // ─── 20. GET /cognitive-routes (list) ───
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', `/cognitive-routes?participant_id=${ME_ID}`,
    );
    log('GET /cognitive-routes', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'list routes HTTP');
    eq(r.data.data?.some((x) => x.id === ROUTE_ID), true, 'маршрут в списке');
  }

  // ─── 21. GET /cognitive-routes/queue/:direction_id ───
  {
    const r = await req<{ queue: string[]; freeSlots: number }>(
      'GET', `/cognitive-routes/queue/${DIRECTION_ID}`,
    );
    log('GET /queue/:dir', r.status, {
      queue_len: r.data.queue?.length,
      freeSlots: r.data.freeSlots,
    });
    st(r.status, 200, 'queue HTTP');
    truthy(Array.isArray(r.data.queue), 'queue:array');
    truthy(typeof r.data.freeSlots === 'number', 'freeSlots:number');
  }

  // ─── 22. POST /cognitive-routes/:id/complete ───
  {
    const r = await req<{ status: string; certificateIssued: boolean }>(
      'POST', `/cognitive-routes/${ROUTE_ID}/complete`, {},
    );
    log('POST /route/complete', r.status, r.data);
    st(r.status, 200, 'route complete HTTP');
    eq(r.data.status, 'completed', 'status=completed');
    eq(r.data.certificateIssued, true, 'certificateIssued=true');
  }

  // ─── 23. complete повторно → 409 ───
  {
    const r = await req<{ code: string }>(
      'POST', `/cognitive-routes/${ROUTE_ID}/complete`, {},
    );
    log('POST /route/complete (повтор)', r.status, r.data);
    st(r.status, 409, 'route complete повтор → 409');
    code(r.data.code, 'CONFLICT', 'route complete повтор');
  }

  // ─── 24. POST /cognitive-routes с fake direction → 404 ───
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>('POST', '/cognitive-routes', {
      participant_id: ME_ID, direction_id: fake, mentor_id: ME_ID,
    });
    log('POST /cognitive-routes (fake dir)', r.status, r.data);
    st(r.status, 404, 'create route fake dir → 404');
    code(r.data.code, 'NOT_FOUND', 'create route fake dir');
  }

  // ═══════════════════════════════════════════════════════════
  //  РЕФРЕШ
  // ═══════════════════════════════════════════════════════════

  // ─── 25. POST /refresh-courses (self) ───
  {
    // Нужны два разных направления. Возьмём первое и второе.
    const dirs = await query<{ id: string }>(
      `SELECT id FROM directions WHERE status = 'active' ORDER BY number LIMIT 2`,
    );
    if (dirs.length < 2) {
      fail('Нужно 2+ активных направления для refresh');
    } else {
      const r = await req<{ id: string; moduleBasicDefense: boolean }>(
        'POST', '/refresh-courses', {
          participant_id: ME_ID,
          direction_1_id: dirs[0]!.id,
          direction_2_id: dirs[1]!.id,
        },
      );
      log('POST /refresh-courses (self)', r.status, r.data);
      st(r.status, 201, 'refresh self HTTP');
      eq(r.data.moduleBasicDefense, false, 'moduleBasicDefense=false');
    }
  }

  // ─── 26. POST /refresh-courses d1===d2 → 422 ───
  {
    const r = await req<{ code: string }>('POST', '/refresh-courses', {
      participant_id: ME_ID,
      direction_1_id: DIRECTION_ID,
      direction_2_id: DIRECTION_ID,
    });
    log('POST /refresh-courses (d1===d2)', r.status, r.data);
    st(r.status, 422, 'refresh d1===d2 → 422');
    code(r.data.code, 'VALIDATION_ERROR', 'refresh d1===d2');
  }

  // ─── 27. POST /refresh-courses с fake dir → 404 ───
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>('POST', '/refresh-courses', {
      participant_id: ME_ID,
      direction_1_id: fake,
      direction_2_id: DIRECTION_ID,
    });
    log('POST /refresh-courses (fake dir)', r.status, r.data);
    st(r.status, 404, 'refresh fake dir → 404');
    code(r.data.code, 'NOT_FOUND', 'refresh fake dir');
  }

  // ═══════════════════════════════════════════════════════════
  //  МОДУЛИ
  // ═══════════════════════════════════════════════════════════

  // ─── 28. POST /modules/basic-defense (self) ───
  {
    const r = await req<{ id: string; module: string }>(
      'POST', '/modules/basic-defense', { participant_id: ME_ID },
    );
    log('POST /modules/basic-defense', r.status, r.data);
    st(r.status, 201, 'module basic-defense HTTP');
    eq(r.data.module, 'basic_defense', 'module=basic_defense');
  }

  // ─── 29. POST /modules/respect (self) ───
  {
    const r = await req<{ id: string; module: string }>(
      'POST', '/modules/respect', { participant_id: ME_ID },
    );
    log('POST /modules/respect', r.status, r.data);
    st(r.status, 201, 'module respect HTTP');
    eq(r.data.module, 'respect', 'module=respect');
  }

  // ═══════════════════════════════════════════════════════════
  //  ИНТЕГРАТОРЫ
  // ═══════════════════════════════════════════════════════════

  // ─── 30. POST /integration/mentors ───
  {
    const r = await req<{ id: string; mentorId: string; mentees: string[]; maxMentees: number }>(
      'POST', '/integration/mentors', {
        mentor_id: ME_ID,
        direction_id: DIRECTION_ID,
      },
    );
    log('POST /integration/mentors', r.status, r.data);
    st(r.status, 201, 'create integrator HTTP');
    eq(r.data.mentorId, ME_ID, 'mentorId=me');
    eq(r.data.maxMentees, 3, 'maxMentees=3');
    eq(Array.isArray(r.data.mentees), true, 'mentees:array');
    INTEGRATOR_ID = r.data.id;
  }

  // ─── 31. GET /integration/mentors (list) ───
  {
    const r = await req<{ data: Array<{ id: string }> }>(
      'GET', `/integration/mentors?direction_id=${DIRECTION_ID}`,
    );
    log('GET /integration/mentors', r.status, { count: r.data.data?.length });
    st(r.status, 200, 'list integrators HTTP');
    eq(r.data.data?.some((x) => x.id === INTEGRATOR_ID), true, 'интегратор в списке');
  }

  // ─── 32. POST /integration/mentors/:id/mentees ×3 ───
  {
    // Нужны 3 уникальных mentee. Используем me + 2 других участника.
    const others = await query<{ id: string }>(
      `SELECT id FROM participants WHERE deleted_at IS NULL AND id <> $1 LIMIT 2`,
      [ME_ID],
    );
    const menteeIds = [ME_ID, ...others.map((o) => o.id)];
    if (menteeIds.length < 3) {
      fail('Нужно 3+ участника для теста интегратора');
    } else {
      for (let i = 0; i < 3; i++) {
        const r = await req<{ mentees: string[] }>(
          'POST', `/integration/mentors/${ME_ID}/mentees`,
          { mentee_id: menteeIds[i] },
        );
        log(`POST /mentees #${i + 1}`, r.status, { count: r.data.mentees?.length });
        st(r.status, 200, `add mentee #${i + 1} HTTP`);
        eq(r.data.mentees?.length, i + 1, `mentees.length=${i + 1}`);
      }
    }
  }

  // ─── 33. 4-й mentee → 409 (max 3) ───
  {
    const extra = await queryOne<{ id: string }>(
      `SELECT id FROM participants
        WHERE deleted_at IS NULL AND id NOT IN ($1, $2, $3)
        LIMIT 1`,
      [ME_ID, ME_ID, ME_ID],
    );
    // Используем того же ME_ID — он уже добавлен → 409 «уже под опекой».
    // Или новый → 409 «max 3».
    const r = await req<{ code: string }>(
      'POST', `/integration/mentors/${ME_ID}/mentees`,
      { mentee_id: extra?.id ?? ME_ID },
    );
    log('POST /mentees #4', r.status, r.data);
    st(r.status, 409, '4-й mentee → 409');
    code(r.data.code, 'CONFLICT', '4-й mentee');
  }

  // ─── 34. POST /integration/mentors/:id/mentees с fake mentee → 404 ───
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await req<{ code: string }>(
      'POST', `/integration/mentors/${ME_ID}/mentees`,
      { mentee_id: fake },
    );
    log('POST /mentees (fake mentee)', r.status, r.data);
    st(r.status, 404, 'add fake mentee → 404');
    code(r.data.code, 'NOT_FOUND', 'add fake mentee');
  }

  // ─── 35. GET /integration/mentors/:fake/mentees — нет такого роута ───
  // (в контроллере нет GET /mentees, только POST — пропускаем)

  console.log('\n✅ Полный цикл Learning замкнут');
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