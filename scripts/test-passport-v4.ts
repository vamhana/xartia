// I.9.09.12 — Smoke v4: Фаза 3a, P0 (directions + task_profile + teaching + matching).
//
// Запуск: pnpm tsx scripts/test-passport-v4.ts
//
// Самодостаточен: создаёт admin / assessor / mentor / mentee через API.
// Требует: API + миграции 058–060 применены, сид выполнен.
// Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

import {
  BASE,
  ensureActor,
  login,
  request,
  submitAssessment,
  createTask,
  createTaskProfile,
  patchTaskProfile,
  assignTeaching,
  revokeTeaching,
} from './lib/passport-fixtures.js';

const ARCHITECT_PHONE = process.env['TEST_ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASS = process.env['TEST_ARCHITECT_PASS'] ?? 'ChangeMe123456';

let failed = 0;
function pass(label: string, detail?: unknown): void {
  console.log(`PASS  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
}
function fail(label: string, detail?: unknown): void {
  console.error(`FAIL  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
  failed++;
}
function expectEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {pass(label, { actual });}
  else {fail(label, { actual, expected });}
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  // ─── 1. Directions ──────────────────────────────────────────────────
  {
    const r = await request<{ data: Array<{ number: number }> }>(
      'GET', '/passport/directions', undefined, admin.token,
    );
    if (r.status === 200 && Array.isArray(r.data.data)) {
      expectEq('1a. directions count', r.data.data.length, 17);
    } else {
      fail('1a. directions count', { status: r.status, data: r.data });
    }

    // Фильтры по каталогу.
    const dirCount = async (n: number): Promise<number | null> => {
      const x = await request<{ meta?: { total?: number } }>(
        'GET', `/passport/catalog?direction=${n}&limit=1`, undefined, admin.token,
      );
      return x.status === 200 ? (x.data.meta?.total ?? null) : null;
    };
    expectEq('1b. catalog direction=9', await dirCount(9), 54);
    expectEq('1c. catalog direction=13', await dirCount(13), 16);
    expectEq('1d. catalog direction=6', await dirCount(6), 8);
    expectEq('1e. catalog direction=15', await dirCount(15), 10);
    expectEq('1f. catalog direction=16', await dirCount(16), 10);

    const card = await request<{
      directions?: {
        home?: { directionNumber?: number; role?: string } | null;
        main?: { directionNumber?: number } | null;
        related?: Array<{ directionNumber: number }>;
      };
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0032', undefined, admin.token,
    );
    const d = card.data.directions;
    if (
      card.status === 200 &&
      d?.home?.directionNumber === 9 &&
      d?.main?.directionNumber === 9 &&
      Array.isArray(d?.related) &&
      d.related.some((x) => x.directionNumber === 13)
    ) {
      pass('1g. atom 0032 home=9, related has 13');
    } else {
      fail('1g. atom 0032 home=9, related has 13', { directions: d });
    }
  }

  // ─── 2. TaskProfile ─────────────────────────────────────────────────
  const assessor = await ensureActor(admin.token, {
    name: 'v4 assessor',
    role: 'VERIFIER',
  });
  console.log(`assessor: ${assessor.id}`);

  const taskId = await createTask(admin.token, 'v4 profile smoke');
  console.log(`taskId: ${taskId}`);

  const profileAtoms = [
    { atom_id: 'CYB.ATOM.0009', role: 'executor' as const, min: { P: 4, U: 3 } },
    { atom_id: 'CYB.ATOM.0031', role: 'assessor' as const, min: { E: 5 } },
  ];

  {
    // 2a. 403 без роли автора профиля (assessor = VERIFIER)
    const r = await createTaskProfile(assessor.token, taskId, profileAtoms);
    expectEq('2a. create profile без FA/COUNCIL/OTC → 403', r.status, 403);

    // 2b. 201 создание
    const c = await createTaskProfile(admin.token, taskId, profileAtoms);
    if (c.status === 201) {pass('2b. create profile 201');}
    else {fail('2b. create profile 201', { status: c.status, data: c.data });}

    // 2c. повтор → 409
    const dup = await createTaskProfile(admin.token, taskId, profileAtoms);
    expectEq('2c. create duplicate → 409', dup.status, 409);

    // 2d. GET version = 1
    const g = await request<{ version?: number }>(
      'GET', `/passport/tasks/${taskId}/profile`, undefined, admin.token,
    );
    expectEq('2d. get profile version=1', g.data.version, 1);

    // 2e. PATCH version = 2
    const p = await patchTaskProfile(admin.token, taskId, profileAtoms);
    if (p.status === 200) {pass('2e. patch profile 200');}
    else {fail('2e. patch profile 200', { status: p.status, data: p.data });}
    const g2 = await request<{ version?: number }>(
      'GET', `/passport/tasks/${taskId}/profile`, undefined, admin.token,
    );
    expectEq('2e. version after patch=2', g2.data.version, 2);

    // 2f. невалидный atomId → 422
    const bad = await createTaskProfile(admin.token, taskId, [
      { atom_id: 'CYB.ATOM.9999', role: 'executor', min: { P: 4 } },
    ]);
    expectEq('2f. bad atom → 422', bad.status, 422);

    // 2g. history: 2 записи task_profile_created/updated у admin
    const h = await request<{ data: Array<{ eventType: string; payload: { task_id?: string } }> }>(
      'GET', '/passport/history?limit=500', undefined, admin.token,
    );
    const ev = (h.data?.data ?? []).filter(
      (e) =>
        e.payload?.task_id === taskId &&
        (e.eventType === 'task_profile_created' || e.eventType === 'task_profile_updated'),
    );
    if (ev.length >= 2) {
      pass('2g. history created+updated', { events: ev.map((e) => e.eventType) });
    } else {
      fail('2g. history created+updated', { events: ev });
    }
  }

  // ─── 3. TeachingRelation ────────────────────────────────────────────
  const mentee = await ensureActor(admin.token, { name: 'v4 mentee' });
  const mentor = await ensureActor(admin.token, {
    name: 'v4 mentor',
    role: 'VERIFIER',
  });
  console.log(`mentee: ${mentee.id}`);
  console.log(`mentor: ${mentor.id}`);

  const teachAtom = 'CYB.ATOM.0009';
  let relationId: string | null = null;

  {
    // 3a. assign без readiness → 403 (mentor не имеет assessments)
    const before = await assignTeaching(mentor.token, mentee.id, teachAtom);
    expectEq('3a. assign без readiness → 403', before.status, 403);

    // 3b. assessor ставит mentor'у P=7, X=5, E=5
    for (const [dim, lvl] of [['P', 7], ['X', 5], ['E', 5]] as const) {
      await submitAssessment(
        assessor.token, mentor.id, teachAtom, dim, lvl, 'exam',
      );
    }

    // 3c. readiness=ready
    const r = await request<{ state?: string }>(
      'GET', `/passport/teaching/my-readiness?atomId=${teachAtom}`,
      undefined, mentor.token,
    );
    expectEq('3c. mentor readiness=ready', r.data.state, 'ready');

    // 3d. assign → 201
    const ok = await assignTeaching(mentor.token, mentee.id, teachAtom);
    if (ok.status === 201 && (ok.data as { id?: string }).id) {
      relationId = (ok.data as { id: string }).id;
      pass('3d. assign 201', { relationId });
    } else {
      fail('3d. assign 201', { status: ok.status, data: ok.data });
    }

    // 3e. students: mentor видит mentee
    const st = await request<{ data: Array<{ menteeId: string }> }>(
      'GET', '/passport/teaching/students', undefined, mentor.token,
    );
    if (st.status === 200 && st.data.data.some((s) => s.menteeId === mentee.id)) {
      pass('3e. students list has mentee');
    } else {
      fail('3e. students list has mentee', { data: st.data });
    }

    // 3f. mentors-for-me: mentee видит mentor через per_atom
    const m = await request<{ data: Array<{ source: string; mentorId: string }> }>(
      'GET', '/passport/teaching/mentors-for-me', undefined, mentee.token,
    );
    if (m.status === 200 && m.data.data.some(
      (x) => x.source === 'per_atom' && x.mentorId === mentor.id,
    )) {
      pass('3f. mentors-for-me has per_atom mentor');
    } else {
      fail('3f. mentors-for-me has per_atom mentor', { data: m.data.data });
    }

    // 3g. ?scope=mentor:
    //     mentor → mentee: 200 (per_atom relation)
    //     assessor → mentee: 403
    const okScope = await request(
      'GET', `/passport/people/${mentee.id}?scope=mentor`, undefined, mentor.token,
    );
    expectEq('3g. mentor→mentee scope=mentor 200', okScope.status, 200);

    const denyScope = await request(
      'GET', `/passport/people/${mentee.id}?scope=mentor`, undefined, assessor.token,
    );
    expectEq('3g. assessor→mentee scope=mentor 403', denyScope.status, 403);
  }

  // ─── 4. Matching ────────────────────────────────────────────────────
  {
    // 4a. self matching
    const me = await request<{
      status?: string; checkedCount?: number; coverage?: number; gaps?: unknown[];
    }>(
      'GET', `/passport/tasks/${taskId}/matching`, undefined, admin.token,
    );
    if (
      me.status === 200 &&
      typeof me.data.status === 'string' &&
      typeof me.data.checkedCount === 'number' &&
      typeof me.data.coverage === 'number' &&
      Array.isArray(me.data.gaps)
    ) {
      pass('4a. matching self', {
        status: me.data.status,
        checked: me.data.checkedCount,
        coverage: me.data.coverage,
      });
    } else {
      fail('4a. matching self', { status: me.status, data: me.data });
    }

    // 4b. candidates — 200 + массив (может быть пустой, но 200)
    const cand = await request<{ data?: unknown[] }>(
      'GET', `/passport/tasks/${taskId}/candidates?limit=10`, undefined, admin.token,
    );
    if (cand.status === 200 && Array.isArray(cand.data.data)) {
      pass('4b. candidates array', { count: cand.data.data.length });
    } else {
      fail('4b. candidates array', { status: cand.status, data: cand.data });
    }

    // 4c. чужой matching → access_log пополняется reason='matching'
    const beforeLog = await request<{ meta?: { total?: number } }>(
      'GET', '/passport/access-log?limit=1', undefined, mentee.token,
    );
    const beforeCount = beforeLog.data.meta?.total ?? 0;

    const other = await request(
      'GET', `/passport/tasks/${taskId}/matching?participantId=${mentee.id}`,
      undefined, admin.token,
    );
    expectEq('4c. matching other 200', other.status, 200);

    const afterLog = await request<{ meta?: { total?: number } }>(
      'GET', '/passport/access-log?limit=1', undefined, mentee.token,
    );
    const afterCount = afterLog.data.meta?.total ?? 0;
    if (afterCount > beforeCount) {
      pass('4d. access_log +1 после matching other', { before: beforeCount, after: afterCount });
    } else {
      fail('4d. access_log +1 после matching other', { before: beforeCount, after: afterCount });
    }
  }

  // ─── 5. Revoke + идемпотентность ────────────────────────────────────
  if (relationId) {
    const r1 = await revokeTeaching(mentor.token, relationId, 'v4 smoke');
    if (r1.status === 200 && (r1.data as { status?: string }).status === 'revoked') {
      pass('5a. revoke 200');
    } else {
      fail('5a. revoke 200', { status: r1.status, data: r1.data });
    }

    const r2 = await revokeTeaching(mentor.token, relationId);
    if (r2.status === 200 && (r2.data as { status?: string }).status === 'revoked') {
      pass('5b. idempotent revoke 200');
    } else {
      fail('5b. idempotent revoke 200', { status: r2.status, data: r2.data });
    }

    const after = await request(
      'GET', `/passport/people/${mentee.id}?scope=mentor`, undefined, mentor.token,
    );
    expectEq('5c. after revoke scope=mentor 403', after.status, 403);
  }

  // ─── итог ──────────────────────────────────────────────────────────
  console.log('');
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    await gracefulShutdown();
    process.exit(1);
  }
  console.log('OK: 0 failed');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});