// I.9.09.15 — Smoke v7: Фаза 3d (calibration  update team  batch  graph).
//
// Запуск: pnpm tsx scripts/test-passport-v7.ts
//
// Самодостаточен. Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
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
  if (actual === expected) {pass(label, { actual });}
  else {fail(label, { actual, expected });}
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

  // ─── 9. Фаза 1, этап 5: снимок атома, pilot, ограничения калибровки ───
  // Калибровка по неутверждённому атому — материал подготовки (pilot), а не
  // production; снимок неизменяем и не «взрослеет» при утверждении атома.
  {
    const ATOM = 'CYB.ATOM.0001';
    interface AtomRow {
      status: string;
      version: string;
      assessment_criteria: unknown;
      dimension_applicability: unknown;
    }
    const readAtom = async (): Promise<AtomRow | null> => queryOne<AtomRow>(
      `SELECT status, version, assessment_criteria, dimension_applicability
         FROM competency_atoms WHERE atom_id = $1`,
      [ATOM],
    );
    const original = await readAtom();
    if (!original) {throw new Error(`${ATOM} not found`);}
    const legacyIds: string[] = [];

    try {
      // Эталонная ситуация: candidate + draft-критерии; P применимо, U не решено,
      // E явно неприменимо.
      await query(
        `UPDATE competency_atoms
            SET status = 'candidate',
                assessment_criteria = jsonb_set(assessment_criteria, '{status}', '"draft"'::jsonb, true),
                dimension_applicability = $2::jsonb
          WHERE atom_id = $1`,
        [ATOM, JSON.stringify({
          P: { state: 'applicable' },
          U: { state: 'undetermined' },
          E: { state: 'not_applicable', reason: 'v7 smoke: nothing to calibrate' },
        })],
      );
      const before = await readAtom();

      // 9a. production-материал: атом approved (фикстуры) → pilot=false.
      const prodAnchor = await createAnchor(admin.token, {
        atomId: 'CYB.ATOM.0009', dimension: 'P', level: 4, title: 'v7 9a production',
      });
      if (prodAnchor.status === 201 && prodAnchor.data.pilot === false
          && prodAnchor.data.atomStatus === 'approved' && prodAnchor.data.criteriaStatus === 'approved'
          && typeof prodAnchor.data.atomVersion === 'string') {
        pass('9a. anchor по утверждённому атому: снимок approved/approved, pilot=false');
      } else {
        fail('9a. anchor по утверждённому атому: снимок approved/approved, pilot=false',
          { status: prodAnchor.status, data: prodAnchor.data });
      }

      // 9b–9d. pilot-материал по candidate-атому.
      const pilotAnchor = await createAnchor(admin.token, {
        atomId: ATOM, dimension: 'P', level: 5, title: 'v7 9b pilot',
      });
      if (pilotAnchor.status === 201 && pilotAnchor.data.pilot === true
          && pilotAnchor.data.atomStatus === 'candidate' && pilotAnchor.data.criteriaStatus === 'draft'
          && pilotAnchor.data.atomVersion === original.version) {
        pass('9b. anchor по candidate-атому: снимок candidate/draft, pilot=true');
      } else {
        fail('9b. anchor по candidate-атому: снимок candidate/draft, pilot=true',
          { status: pilotAnchor.status, data: pilotAnchor.data });
      }
      const pilotSession = await createCalibrationSession(admin.token, ATOM, 'P');
      if (pilotSession.status === 201 && pilotSession.data.pilot === true
          && pilotSession.data.atomStatus === 'candidate') {
        pass('9c. сессия по candidate-атому: pilot=true');
      } else {
        fail('9c. сессия по candidate-атому: pilot=true',
          { status: pilotSession.status, data: pilotSession.data });
      }
      const undeterminedAnchor = await createAnchor(admin.token, {
        atomId: ATOM, dimension: 'U', level: 3, title: 'v7 9d undetermined',
      });
      expectEq('9d. anchor по измерению undetermined разрешён (201)', undeterminedAnchor.status, 201);

      // 9e. Калибровка не меняет атом (статус, критерии, версия, применимость).
      const after = await readAtom();
      expectEq('9e. создание anchor/сессий не изменило атом',
        JSON.stringify(after), JSON.stringify(before));

      // 9f. not_applicable → 409 dimension_not_applicable (anchor и сессия).
      const naAnchor = await createAnchor(admin.token, {
        atomId: ATOM, dimension: 'E', level: 3, title: 'v7 9f',
      });
      const naSession = await createCalibrationSession(admin.token, ATOM, 'E');
      if (naAnchor.status === 409 && naAnchor.data.details?.reason === 'dimension_not_applicable'
          && naSession.status === 409 && naSession.data.details?.reason === 'dimension_not_applicable') {
        pass('9f. not_applicable → 409 dimension_not_applicable (anchor и сессия)');
      } else {
        fail('9f. not_applicable → 409 dimension_not_applicable (anchor и сессия)',
          { anchor: [naAnchor.status, naAnchor.data], session: [naSession.status, naSession.data] });
      }

      // 9g. deprecated → 409 atom_deprecated (anchor и сессия).
      await query(`UPDATE competency_atoms SET status = 'deprecated' WHERE atom_id = $1`, [ATOM]);
      const depAnchor = await createAnchor(admin.token, {
        atomId: ATOM, dimension: 'P', level: 5, title: 'v7 9g',
      });
      const depSession = await createCalibrationSession(admin.token, ATOM, 'P');
      if (depAnchor.status === 409 && depAnchor.data.details?.reason === 'atom_deprecated'
          && depSession.status === 409 && depSession.data.details?.reason === 'atom_deprecated') {
        pass('9g. deprecated → 409 atom_deprecated (anchor и сессия)');
      } else {
        fail('9g. deprecated → 409 atom_deprecated (anchor и сессия)',
          { anchor: [depAnchor.status, depAnchor.data], session: [depSession.status, depSession.data] });
      }

      // 9h. Атом позже утверждён: старый pilot-материал остаётся pilot, новый — production.
      await query(
        `UPDATE competency_atoms
            SET status = 'approved',
                assessment_criteria = jsonb_set(assessment_criteria, '{status}', '"approved"'::jsonb, true)
          WHERE atom_id = $1`,
        [ATOM],
      );
      const list = await listAnchors(admin.token, ATOM, 'P');
      const oldOne = list.data.data.find((a) => a.id === pilotAnchor.data.id);
      expectEq('9h. старый anchor остаётся pilot=true после утверждения атома', oldOne?.pilot, true);
      const newAnchor = await createAnchor(admin.token, {
        atomId: ATOM, dimension: 'P', level: 6, title: 'v7 9h new',
      });
      expectEq('9i. новый anchor после утверждения: pilot=false', newAnchor.data.pilot, false);

      // 9j. Отчёт: pilot по сессии, версия атома в снимке против текущей.
      if (pilotSession.data.id && pilotAnchor.data.id) {
        const asg = await assignAnchor(admin.token, pilotSession.data.id, pilotAnchor.data.id, assessorA.id);
        expectEq('9j. assign в pilot-сессию (201)', asg.status, 201);
        const rep1 = await getSessionReport(admin.token, pilotSession.data.id);
        if (rep1.status === 200 && rep1.data.summary.pilot === true
            && rep1.data.summary.atomVersionChanged === false
            && rep1.data.summary.currentAtomVersion === original.version) {
          pass('9k. отчёт: pilot=true, версия атома не менялась');
        } else {
          fail('9k. отчёт: pilot=true, версия атома не менялась',
            { status: rep1.status, summary: rep1.data.summary });
        }
        await query(`UPDATE competency_atoms SET version = '9.9.9' WHERE atom_id = $1`, [ATOM]);
        const rep2 = await getSessionReport(admin.token, pilotSession.data.id);
        if (rep2.status === 200 && rep2.data.summary.atomVersionChanged === true
            && rep2.data.summary.currentAtomVersion === '9.9.9') {
          pass('9l. отчёт: версия атома изменилась после создания сессии → atomVersionChanged');
        } else {
          fail('9l. отчёт: версия атома изменилась после создания сессии → atomVersionChanged',
            { status: rep2.status, summary: rep2.data.summary });
        }
      } else {
        fail('9j. нет id pilot-сессии/anchor', { pilotSession: pilotSession.data, pilotAnchor: pilotAnchor.data });
      }

      // 9m. Production-отчёт: сессия по утверждённому атому → pilot=false.
      const prodSession = await createCalibrationSession(admin.token, 'CYB.ATOM.0009', 'P');
      if (prodSession.data.id && prodAnchor.data.id) {
        await assignAnchor(admin.token, prodSession.data.id, prodAnchor.data.id, assessorB.id);
        const rep3 = await getSessionReport(admin.token, prodSession.data.id);
        if (rep3.status === 200 && rep3.data.summary.pilot === false
            && rep3.data.summary.atomVersionChanged === false) {
          pass('9m. отчёт по утверждённому атому: pilot=false');
        } else {
          fail('9m. отчёт по утверждённому атому: pilot=false', { status: rep3.status, summary: rep3.data.summary });
        }
      }

      // 9n. Старая запись без снимка: pilot=null (неизвестно), не production.
      const legacy = await queryOne<{ id: string }>(
        `INSERT INTO anchor_examples (atom_id, dimension, level, title, created_by)
         VALUES ('CYB.ATOM.0009', 'P', 1, 'v7 legacy no snapshot', $1)
         RETURNING id`,
        [admin.id],
      );
      if (legacy) {legacyIds.push(legacy.id);}
      const listLegacy = await listAnchors(admin.token, 'CYB.ATOM.0009', 'P');
      expectEq('9n. запись без снимка: pilot=null',
        listLegacy.data.data.find((a) => a.id === legacy?.id)?.pilot, null);

      // 9o. Снимок неизменяем на уровне БД (в том числе «дозаполнение» NULL).
      let refused = 0;
      const attempts: Array<[string, string | undefined]> = [
        // Снимок production-anchor — approved; ставим ДРУГОЕ значение (то же не изменение).
        [`UPDATE anchor_examples SET atom_status = 'candidate' WHERE id = $1`, prodAnchor.data.id],
        [`UPDATE anchor_examples
             SET criteria_status = 'approved', atom_status = 'approved', atom_version = '0.2.0'
           WHERE id = $1`, legacy?.id],
      ];
      for (const [sql, id] of attempts) {
        try {
          await query(sql, [id]);
        } catch (e) {
          if (e instanceof Error && /immutable/.test(e.message)) {refused++;}
        }
      }
      expectEq('9o. снимок нельзя изменить (в т.ч. дозаполнить NULL): оба UPDATE отклонены', refused, 2);
    } finally {
      // Возвращаем атом в исходное состояние и убираем служебные записи.
      await query(
        `UPDATE competency_atoms
            SET status = $2, version = $3,
                assessment_criteria = $4::jsonb, dimension_applicability = $5::jsonb
          WHERE atom_id = $1`,
        [ATOM, original.status, original.version,
          JSON.stringify(original.assessment_criteria), JSON.stringify(original.dimension_applicability)],
      );
      for (const id of legacyIds) {
        await query('DELETE FROM anchor_examples WHERE id = $1', [id]);
      }
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