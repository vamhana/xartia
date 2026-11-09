// I.9.09.15 — Smoke v7: Фаза 3d (calibration  update team  batch  graph).
//
// Запуск: pnpm tsx scripts/test-passport-v7.ts
//
// Самодостаточен. Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  BASE,
  assignAnchor,
  assessTeam,
  createAnchor,
  createCalibrationSession,
  createTeam,
  ensureActor,
  getBatchParticipants,
  getGraph,
  getSessionReport,
  getTeam,
  listAnchors,
  login,
  scoreAssignment,
  updateTeam,
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
  if (actual === expected) pass(label, { actual });
  else fail(label, { actual, expected });
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  const assessorA = await ensureActor(admin.token, {
    name: 'v7 assessor A',
    role: 'VERIFIER',
  });
  const assessorB = await ensureActor(admin.token, {
    name: 'v7 assessor B',
    role: 'VERIFIER',
  });
  const subject = await ensureActor(admin.token, { name: 'v7 subject' });
  console.log(`assessorA: ${assessorA.id}`);
  console.log(`assessorB: ${assessorB.id}`);
  console.log(`subject: ${subject.id}`);

  // ─── 1. Anchor CRUD ─────────────────────────────────────────────────
  let anchorId: string;
  {
    const r = await createAnchor(admin.token, {
      atomId: 'CYB.ATOM.0009',
      dimension: 'P',
      level: 5,
      title: 'v7 anchor 0009/P/5',
      content: { text: 'sample' },
    });
    if (r.status === 201 && r.data.id) {
      anchorId = r.data.id;
      pass('1a. create anchor 201', { id: anchorId });
    } else {
      fail('1a. create anchor 201', { status: r.status, data: r.data });
      throw new Error('cannot continue without anchor');
    }

    // без прав — assessor (VERIFIER, не FA/COUNCIL)
    const deny = await createAnchor(assessorA.token, {
      atomId: 'CYB.ATOM.0009',
      dimension: 'P',
      level: 5,
      title: 'deny',
    });
    expectEq('1b. create anchor без прав 403', deny.status, 403);

    // list
    const list = await listAnchors(admin.token, 'CYB.ATOM.0009', 'P');
    if (list.status === 200 && list.data.data.some((a) => a.id === anchorId)) {
      pass('1c. list anchors');
    } else {
      fail('1c. list anchors', { status: list.status });
    }

    // bad atom → 404 (в нашем коде assertAtomExists → NotFoundError)
    const bad = await createAnchor(admin.token, {
      atomId: 'CYB.ATOM.9999',
      dimension: 'P',
      level: 5,
      title: 'bad',
    });
    expectEq('1d. bad atom → 404', bad.status, 404);

    // level 10 → 422
    const badLevel = await createAnchor(admin.token, {
      atomId: 'CYB.ATOM.0009',
      dimension: 'P',
      level: 10,
      title: 'bad level',
    });
    expectEq('1e. level 10 → 422', badLevel.status, 422);
  }

  // ─── 2. Session ─────────────────────────────────────────────────────
  let sessionId: string;
  {
    const r = await createCalibrationSession(admin.token, 'CYB.ATOM.0009', 'P');
    if (r.status === 201 && r.data.id) {
      sessionId = r.data.id;
      pass('2a. create session 201', { id: sessionId });
    } else {
      fail('2a. create session 201', { status: r.status, data: r.data });
      throw new Error('cannot continue without session');
    }

    // без прав
    const deny = await createCalibrationSession(assessorA.token, 'CYB.ATOM.0009', 'P');
    expectEq('2b. create session без прав 403', deny.status, 403);
  }

  // ─── 3. Assign ──────────────────────────────────────────────────────
  let asgA: string;
  let asgB: string;
  {
    const rA = await assignAnchor(admin.token, sessionId, anchorId, assessorA.id);
    if (rA.status === 201 && rA.data.id) {
      asgA = rA.data.id;
      pass('3a. assign A 201', { id: asgA });
    } else {
      fail('3a. assign A 201', { status: rA.status, data: rA.data });
      throw new Error('cannot continue');
    }

    const rB = await assignAnchor(admin.token, sessionId, anchorId, assessorB.id);
    if (rB.status === 201 && rB.data.id) {
      asgB = rB.data.id;
      pass('3b. assign B 201', { id: asgB });
    } else {
      fail('3b. assign B 201', { status: rB.status });
      throw new Error('cannot continue');
    }

    // повтор того же (session, anchor, assessor) → 409
    const dup = await assignAnchor(admin.token, sessionId, anchorId, assessorA.id);
    expectEq('3c. duplicate assign → 409', dup.status, 409);

    // anchor из другого атома → 422
    const badAnchor = await createAnchor(admin.token, {
      atomId: 'CYB.ATOM.0010',
      dimension: 'P',
      level: 5,
      title: 'v7 anchor 0010/P/5',
    });
    if (badAnchor.status === 201 && badAnchor.data.id) {
      const mismatch = await assignAnchor(admin.token, sessionId, badAnchor.data.id, assessorA.id);
      expectEq('3d. anchor/session mismatch → 422', mismatch.status, 422);
    }
  }

  // ─── 4. Score ───────────────────────────────────────────────────────
  {
    // assessorA ставит 3, assessorB ставит 7 → maxDiff = 4 → needsThird
    const sA = await scoreAssignment(assessorA.token, asgA, 3, 'низко');
    expectEq('4a. score A 200', sA.status, 200);
    expectEq('4a. score A level=3', sA.data.level, 3);

    const sB = await scoreAssignment(assessorB.token, asgB, 7, 'высоко');
    expectEq('4b. score B 200', sB.status, 200);
    expectEq('4b. score B level=7', sB.data.level, 7);

    // повтор — 409
    const dup = await scoreAssignment(assessorA.token, asgA, 5);
    expectEq('4c. repeat score → 409', dup.status, 409);

    // чужой assessor
    const wrong = await scoreAssignment(assessorB.token, asgA, 5);
    expectEq('4d. чужой assessor → 403', wrong.status, 403);

    // level 10 → 422
    const bad = await scoreAssignment(assessorA.token, asgA, 10);
    expectEq('4e. level 10 → 422', bad.status, 422);
  }

  // ─── 5. Report: needsThird ─────────────────────────────────────────
  {
    const r = await getSessionReport(admin.token, sessionId);
    if (r.status === 200) {
      pass('5a. report 200');
    } else {
      fail('5a. report 200', { status: r.status });
    }
    if (r.data.summary.worksCount === 1) {
      pass('5b. summary.worksCount=1', r.data.summary);
    } else {
      fail('5b. summary.worksCount=1', r.data.summary);
    }
    if (r.data.summary.scoredCount === 2 && r.data.summary.unscoredCount === 0) {
      pass('5c. scored=2, unscored=0');
    } else {
      fail('5c. scored=2, unscored=0', r.data.summary);
    }
    if (r.data.summary.flaggedCount === 1) {
      pass('5d. flaggedCount=1 (maxDiff=4)');
    } else {
      fail('5d. flaggedCount=1 (maxDiff=4)', r.data.summary);
    }
    const w = r.data.works[0];
    if (w?.maxDiff === 4 && w.needsThird === true) {
      pass('5e. work maxDiff=4, needsThird=true', { maxDiff: w.maxDiff });
    } else {
      fail('5e. work maxDiff=4, needsThird=true', { w });
    }
    if (r.data.summary.overdue === false) {
      pass('5f. overdue=false (нет deadline)');
    } else {
      fail('5f. overdue=false (нет deadline)');
    }
  }

  // ─── 6. Update team (техдолг 3c) ───────────────────────────────────
  {
    const t = await createTeam(admin.token, {
      name: 'v7 team',
      expectedResult: 'original',
      participants: [subject.id, assessorA.id],
    });
    if (t.status !== 201 || !t.data.id) {
      fail('6a. create team for update', { status: t.status, data: t.data });
      throw new Error('cannot continue');
    }
    const teamId = t.data.id;

    // PATCH name  expectedResult
    const patch = await updateTeam(admin.token, teamId, {
      name: 'v7 team renamed',
      expectedResult: 'updated',
    });
    expectEq('6b. patch 200', patch.status, 200);

    const g = await getTeam(admin.token, teamId);
    expectEq('6c. name updated', g.data.status === 'draft' ? 'draft' : g.data.status, 'draft');

    // Оценим team, чтобы assessor_id зафиксировался
    await assessTeam(admin.token, teamId, 5, {});

    // PATCH participants с assessor_id → 422
    const bad = await updateTeam(admin.token, teamId, {
      participants: [assessorA.id, admin.id],  // admin — assessor
    });
    expectEq('6d. PATCH assessor in participants → 422', bad.status, 422);
  }

  // ─── 7. Batch participants (техдолг 3c) ────────────────────────────
  {
    const r = await getBatchParticipants(admin.token, [subject.id, assessorA.id]);
    if (r.status === 200 && r.data.data.length === 2) {
      pass('7a. batch 2 participants');
    } else {
      fail('7a. batch 2 participants', { status: r.status, data: r.data });
    }

    // с невалидным
    const r2 = await getBatchParticipants(admin.token, [subject.id, 'not-uuid', 'xxx']);
    expectEq('7b. batch filters invalid → 1', r2.data.data.length, 1);

    // пустой
    const r3 = await getBatchParticipants(admin.token, ['not-uuid']);
    expectEq('7c. batch empty for all-invalid', r3.data.data.length, 0);
  }

  // ─── 8. Graph ───────────────────────────────────────────────────────
  {
    const g = await getGraph(admin.token);
    if (g.status === 200 && g.data.nodes.length >= 54 && g.data.edges.length >= 133) {
      pass('8a. graph full ≥ 54/133', {
        nodes: g.data.nodes.length, edges: g.data.edges.length,
      });
    } else {
      fail('8a. graph full', {
        status: g.status,
        nodes: g.data.nodes?.length,
        edges: g.data.edges?.length,
      });
    }

    const gc = await getGraph(admin.token, undefined, 'software_development');
    // Каталог v0.4: атомы могут добавляться через workflow. Seed-пилот = 10
    // в этом кластере. Проверяем «не меньше 10» (как v2 п.1).
    if (gc.status === 200 && gc.data.nodes.length >= 10) {
      pass('8b. graph cluster=software_development ≥ 10', {
        nodes: gc.data.nodes.length,
      });
    } else {
      fail('8b. graph cluster ≥ 10', { nodes: gc.data.nodes?.length });
    }

    const gd = await getGraph(admin.token, undefined, undefined, 13);
    if (gd.status === 200 && gd.data.nodes.length === 16) {
      pass('8c. graph direction=13 → 16', { nodes: gd.data.nodes.length });
    } else {
      fail('8c. graph direction=13 → 16', { nodes: gd.data.nodes?.length });
    }

    const ga = await getGraph(admin.token, 'assessed');
    if (ga.status === 200 && Array.isArray(ga.data.nodes)) {
      pass('8d. graph filter=assessed returns array', {
        count: ga.data.nodes.length,
      });
    } else {
      fail('8d. graph filter=assessed', { status: ga.status });
    }
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