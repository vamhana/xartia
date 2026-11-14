// I.9.09.11 — Smoke v3: Фаза 2, P0 (матрица прав + resolveAppeal + disputed).
//
// Запуск: pnpm tsx scripts/test-passport-v3.ts
//
// Самодостаточен: создаёт subject / assessor / mentor / resolver / admin —
// всё через API, без ручной подготовки. Требует два предварительных
// условия:
//   1. API поднят, миграции 058 + 059 применены.
//   2. Архитектор (+79001234567 / ChangeMe123456) существует и имеет
//      admin-права (accept registration requests). Можно переопределить
//      через TEST_ARCHITECT_PHONE / TEST_ARCHITECT_PASS.
//
// Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

import {
  BASE,
  type Actor,
  ensureActor,
  createGrant,
  revokeGrant,
  createSmokeTask,
  login,
  request,
  setMentor,
  setVisibility,
  submitAppeal,
  submitAssessment,
  submitEvidence,
  createPath,
  getMe,
  backdateAssessment,
} from './lib/passport-fixtures.js';

const ARCHITECT_PHONE = process.env['TEST_ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASS = process.env['TEST_ARCHITECT_PASS'] ?? 'ChangeMe123456';

// ─── Отчётность ───────────────────────────────────────────────────────

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

// ─── main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  // ─── setup ─────────────────────────────────────────────────────────
  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  const subject = await ensureActor(admin.token, { name: 'v3 subject' });
  const assessor = await ensureActor(admin.token, { name: 'v3 assessor', role: 'VERIFIER' });
  const mentor = await ensureActor(admin.token, { name: 'v3 mentor', role: 'VERIFIER' });
  const resolver = await ensureActor(admin.token, { name: 'v3 resolver', role: 'VERIFIER' });
  console.log(`subject: ${subject.id}`);
  console.log(`assessor: ${assessor.id}`);
  console.log(`mentor: ${mentor.id}`);
  console.log(`resolver: ${resolver.id}`);

  // ─── 1. Матрица: scope=mentor ──────────────────────────────────────
  {
    // 1a. Без mentor_id, без гранта → 403
    let r = await request('GET', `/passport/people/${subject.id}?scope=mentor`, undefined, assessor.token);
    expectEq('1a. mentor: no relation → 403', r.status, 403);

    // 1b. Устанавливаем mentor_id → 200
    await setMentor(admin.token, subject.id, mentor.id);
    r = await request('GET', `/passport/people/${subject.id}?scope=mentor`, undefined, mentor.token);
    expectEq('1b. mentor_id match → 200', r.status, 200);

    // 1c. Снимаем mentor_id — доступ снова 403.
    await setMentor(admin.token, subject.id, null);
    r = await request('GET', `/passport/people/${subject.id}?scope=mentor`, undefined, mentor.token);
    expectEq('1c. after clear mentor_id → 403', r.status, 403);

    // 1d. Явный грант scope=mentor для assessor → 200
    const g = await createGrant(subject.token, assessor.id, 'mentor');
    r = await request('GET', `/passport/people/${subject.id}?scope=mentor`, undefined, assessor.token);
    expectEq('1d. grant mentor → 200', r.status, 200);

    // 1e. Отзываем грант → 403
    await revokeGrant(subject.token, g.id);
    r = await request('GET', `/passport/people/${subject.id}?scope=mentor`, undefined, assessor.token);
    expectEq('1e. after revoke → 403', r.status, 403);
  }

  // ─── 2. Матрица: scope=assessor ────────────────────────────────────
  {
    // 2a. Роль есть, consent нет → 403
    let r = await request('GET', `/passport/people/${subject.id}?scope=assessor`, undefined, assessor.token);
    expectEq('2a. role no consent → 403', r.status, 403);

    // 2b. Без роли — тоже 403 (mentor без роли? но mentor у нас VERIFIER).
    // Берём subject: subject без роли, пытается читать assessor — но
    // это другой запрос. Здесь тестируем: viewer без роли не пройдёт даже
    // с consent. Используем subject как viewer.
    await setVisibility(assessor.token, 'assessor', 'levels', true);
    r = await request('GET', `/passport/people/${assessor.id}?scope=assessor`, undefined, subject.token);
    expectEq('2b. no role no consent → 403', r.status, 403);

    // 2c. Роль + consent → 200
    await setVisibility(subject.token, 'assessor', 'levels', true);
    r = await request('GET', `/passport/people/${subject.id}?scope=assessor`, undefined, assessor.token);
    expectEq('2c. role + consent → 200', r.status, 200);

    // 2d. Убираем consent — 403
    await setVisibility(subject.token, 'assessor', 'private', false);
    r = await request('GET', `/passport/people/${subject.id}?scope=assessor`, undefined, assessor.token);
    expectEq('2d. after revoke consent → 403', r.status, 403);
  }

  // ─── 3. Матрица: scope=task ────────────────────────────────────────
  {
    // 3a. Без task_id → 403
    let r = await request('GET', `/passport/people/${subject.id}?scope=task`, undefined, assessor.token);
    expectEq('3a. task: no task_id → 403', r.status, 403);

    // 3b. Несуществующий task → 403 (findActiveGrant → null)
    const fakeTask = '00000000-0000-4000-8000-000000000000';
    r = await request(
      'GET', `/passport/people/${subject.id}?scope=task&taskId=${fakeTask}`,
      undefined, assessor.token,
    );
    expectEq('3b. task: nonexistent → 403', r.status, 403);

    // 3c. Реальная task + grant → 200
    const taskId = await createSmokeTask(admin.token, assessor.id);
    const g = await createGrant(subject.token, assessor.id, 'task', { taskId, reason: 'v3 task test' });
    r = await request(
      'GET', `/passport/people/${subject.id}?scope=task&taskId=${taskId}`,
      undefined, assessor.token,
    );
    expectEq('3c. grant + assigned_to → 200', r.status, 200);

    // 3d. Отзыв grant → 403
    await revokeGrant(subject.token, g.id);
    r = await request(
      'GET', `/passport/people/${subject.id}?scope=task&taskId=${taskId}`,
      undefined, assessor.token,
    );
    expectEq('3d. after revoke grant → 403', r.status, 403);
  }

  // ─── 4. resolveAppeal: 3 исхода ────────────────────────────────────
  // Для каждого исхода — отдельный атом, чтобы избежать пересечений.

  // 4a. upheld (без replacement) → assessment invalidated, state not_assessed
  {
    const evId = await submitEvidence(subject.token, 'CYB.ATOM.0030', 'U', 'v3 upheld');
    const asId = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0030', 'U', 5, 'exam', [evId]);
    await submitAppeal(subject.token, asId, 'v3 upheld appeal');
    const r = await request(
      'POST', `/passport/appeals/${await findAppealId(subject.token, 'CYB.ATOM.0030', asId)}/resolve`,
      { resolution: 'upheld', note: 'v3 upheld resolution' },
      resolver.token,
    );
    expectEq('4a. upheld → 200', r.status, 200);

    // State — через card (current snapshot).
    const card = await request<{ dimensions: Array<{ dimension: string; level: number | null; status: string }> }>(
      'GET', '/passport/atoms/CYB.ATOM.0030/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    if (u?.level === null && u?.status === 'not_assessed') {
      pass('4b. upheld: state not_assessed');
    } else {
      fail('4b. upheld: state not_assessed', { u });
    }

    // Инвалидация assessment — через историю: card отдаёт только
    // действующие оценки, invalidated показываются в audit-ленте.
    const hist = await request<{ data: Array<{ eventType: string; payload: { assessment_id?: string } }> }>(
      'GET', '/passport/history?atom_id=CYB.ATOM.0030&limit=200', undefined, subject.token,
    );
    const invalidatedHit = (hist.data?.data ?? []).some(
      (e) => e.eventType === 'assessment_invalidated'
        && e.payload?.assessment_id === asId,
    );
    if (invalidatedHit) {
      pass('4b. upheld: assessment_invalidated event present');
    } else {
      fail('4b. upheld: assessment_invalidated event present', hist.data?.data?.slice(-5));
    }
  }

  // 4c. rejected → assessment active, state confirmed, level preserved
  {
    const evId = await submitEvidence(subject.token, 'CYB.ATOM.0031', 'U', 'v3 rejected');
    const asId = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0031', 'U', 6, 'exam', [evId]);
    await submitAppeal(subject.token, asId, 'v3 rejected appeal');
    const appealId = await findAppealId(subject.token, 'CYB.ATOM.0031', asId);
    const r = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'rejected', note: 'v3 rejected resolution' },
      resolver.token,
    );
    expectEq('4c. rejected → 200', r.status, 200);

    const card = await request<{ dimensions: Array<{ dimension: string; level: number | null; status: string }>; assessments: Array<{ id: string; status: string }> }>(
      'GET', '/passport/atoms/CYB.ATOM.0031/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    const a = card.data?.assessments?.find((x) => x.id === asId);
    if (u?.level === 6 && u?.status === 'confirmed' && a?.status === 'active') {
      pass('4d. rejected: state confirmed/level=6, assessment active');
    } else {
      fail('4d. rejected: state confirmed/level=6, assessment active', { u, a });
    }
  }

  // 4e. remanded → assessment under_review, state under_review
  {
    const evId = await submitEvidence(subject.token, 'CYB.ATOM.0032', 'U', 'v3 remanded');
    const asId = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0032', 'U', 5, 'exam', [evId]);
    await submitAppeal(subject.token, asId, 'v3 remanded appeal');
    const appealId = await findAppealId(subject.token, 'CYB.ATOM.0032', asId);
    const r = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'remanded', note: 'v3 remanded resolution', assignedTo: resolver.id },
      resolver.token,
    );
    expectEq('4e. remanded → 200', r.status, 200);

    const card = await request<{ dimensions: Array<{ dimension: string; status: string }>; assessments: Array<{ id: string; status: string }> }>(
      'GET', '/passport/atoms/CYB.ATOM.0032/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    const a = card.data?.assessments?.find((x) => x.id === asId);
    if (u?.status === 'under_review' && a?.status === 'under_review') {
      pass('4f. remanded: assessment & state under_review');
    } else {
      fail('4f. remanded: assessment & state under_review', { u, a });
    }

    // 4g. Повторный resolve → 409
    const r2 = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'rejected', note: 'v3 repeat' },
      resolver.token,
    );
    expectEq('4g. repeat resolve → 409', r2.status, 409);
  }

  // ─── 5. resolveAppeal: независимость арбитра ──────────────────────
  {
    const evId = await submitEvidence(subject.token, 'CYB.ATOM.0033', 'U', 'v3 indep');
    const asId = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0033', 'U', 5, 'exam', [evId]);
    await submitAppeal(subject.token, asId, 'v3 indep appeal');
    const appealId = await findAppealId(subject.token, 'CYB.ATOM.0033', asId);

    // 5a. subject — 403
    let r = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'rejected', note: 'x' }, subject.token,
    );
    expectEq('5a. resolver=subject → 403', r.status, 403);

    // 5b. assessor — 403
    r = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'rejected', note: 'x' }, assessor.token,
    );
    expectEq('5b. resolver=assessor → 403', r.status, 403);

    // 5c. mentor — set, then mentor (VERIFIER) tries → 403 (independence)
    await setMentor(admin.token, subject.id, mentor.id);
    r = await request(
      'POST', `/passport/appeals/${appealId}/resolve`,
      { resolution: 'rejected', note: 'x' }, mentor.token,
    );
    expectEq('5c. resolver=subject.mentor → 403', r.status, 403);

    // cleanup
    await setMentor(admin.token, subject.id, null);
  }

  // ─── 6. disputed workflow: связь через passport_assessment_evidence ─
  {
    // Атом 0034, два измерения: U (со связью), P (без)
    const evU = await submitEvidence(subject.token, 'CYB.ATOM.0034', 'U', 'v3 dispute U');
    const asU = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0034', 'U', 5, 'exam', [evU]);
    const asP = await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0034', 'P', 6, 'exam');   // без evidenceIds

    // 6a. Dispute evidence U → asU under_review, asP остаётся active
    let r = await request(
      'POST', `/passport/evidence/${evU}/dispute`,
      { reason: 'v3 dispute reason' }, subject.token,
    );
    expectEq('6a. dispute → 200', r.status, 200);

    const card = await request<{ assessments: Array<{ id: string; status: string }> }>(
      'GET', '/passport/atoms/CYB.ATOM.0034/card', undefined, subject.token,
    );
    const aU = card.data?.assessments?.find((x) => x.id === asU);
    const aP = card.data?.assessments?.find((x) => x.id === asP);
    if (aU?.status === 'under_review' && aP?.status === 'active') {
      pass('6b. disputed: linked assessment under_review, other stays active');
    } else {
      fail('6b. disputed: linked assessment under_review, other stays active', { aU, aP });
    }

    // 6c. Повторный dispute → 409
    r = await request(
      'POST', `/passport/evidence/${evU}/dispute`,
      { reason: 'x' }, subject.token,
    );
    expectEq('6c. repeat dispute → 409', r.status, 409);

    // 6d. resolve invalidated → 200, событие assessment_under_review
    r = await request(
      'POST', `/passport/evidence/${evU}/resolve`,
      { resolution: 'invalidated', note: 'v3 invalidate' }, resolver.token,
    );
    expectEq('6d. resolve invalidated → 200', r.status, 200);

    // проверка истории: есть assessment_under_review с reason=evidence_invalidated
    const hist = await request<{ data: Array<{ eventType: string; payload: { assessment_id?: string; reason?: string } }> }>(
      'GET', '/passport/history?atom_id=CYB.ATOM.0034&limit=200', undefined, subject.token,
    );
    const hit = (hist.data?.data ?? []).some(
      (e) => e.eventType === 'assessment_under_review'
        && e.payload?.assessment_id === asU
        && e.payload?.reason === 'evidence_invalidated',
    );
    if (hit) {pass('6e. assessment_under_review event with reason=evidence_invalidated');}
    else {fail('6e. assessment_under_review event with reason=evidence_invalidated', hist.data?.data?.slice(0, 5));}

    // 6f. Повторный resolve → 409
    r = await request(
      'POST', `/passport/evidence/${evU}/resolve`,
      { resolution: 'accepted', note: 'x' }, resolver.token,
    );
    expectEq('6f. repeat resolve → 409', r.status, 409);
  }

  // ─── 7. P1: alternative_atom_ids (шаг 7) ───────────────────────────
  {
    const pathId = await createPath(subject.token, {
      goal: 'v3 alternative smoke',
      targetProfileSlug: 'python_backend',
    });
    if (!pathId) {
      fail('7a. createPath with profile');
    } else {
      pass('7a. createPath with profile', { pathId });
    }

    const me = await getMe(subject.token);
    const goal = me.goals.find((g) => g.goal === 'v3 alternative smoke');
    if (!goal) {
      fail('7b. goal appears in /passport/me');
    } else {
      pass('7b. goal appears in /passport/me');
      const m0032 = goal.missingAtoms.find((x) => x.atomId === 'CYB.ATOM.0032');
      const hasAlt = m0032 && m0032.alternativeAtomIds.includes('CYB.ATOM.0033');
      if (hasAlt) {
        pass('7c. alternative_atom_ids for 0032 contains 0033',
          { alt: m0032?.alternativeAtomIds });
      } else {
        fail('7c. alternative_atom_ids for 0032 contains 0033',
          { alt: m0032?.alternativeAtomIds, missing: !m0032 });
      }
    }
  }

  // ─── 8. P1: staleAssessments (шаг 6) ────────────────────────────────
  {
    // 8a (был to_calibrate → не stale) удалён в Фазе 3c: после 3c все
    // 54 атома имеют P-политику (A52), и проверка «to_calibrate не стареет»
    // не воспроизводима. 8b/8c покрывают остальное.

    // 8b. 0009 (P12M) → бэкдейт 13 мес → stale
    const evP12 = await submitEvidence(subject.token, 'CYB.ATOM.0009', 'U', 'v3 stale P12M');
    const asP12 = await submitAssessment(
      assessor.token, subject.id, 'CYB.ATOM.0009', 'U', 5, 'exam', [evP12],
    );
    await backdateAssessment(asP12, 13);

    const me = await getMe(subject.token);
    const hasP12 = me.staleAssessments.some(
      (s) => s.atomId === 'CYB.ATOM.0009' && s.dimension === 'U' && s.policy === 'P12M',
    );
    if (hasP12) {
      pass('8b. P12M atom is stale');
    } else {
      fail('8b. P12M atom is stale', {
        stale: me.staleAssessments.filter((s) => s.atomId === 'CYB.ATOM.0009'),
      });
    }

    // 8c. Уровень НЕ понизился
    const card = await request<{
      dimensions: Array<{ dimension: string; level: number | null; status: string }>;
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0009/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    if (u?.level === 5 && u?.status === 'confirmed') {
      pass('8c. stale does not demote level', { level: u.level, status: u.status });
    } else {
      fail('8c. stale does not demote level', { u });
    }
  }

  // ─── 9. P1: reuse (шаг 8) ───────────────────────────────────────────
  {
    // 9a. submitted → reuse 201
    const ev = await submitEvidence(subject.token, 'CYB.ATOM.0044', 'U', 'v3 reuse base');
    const r1 = await request<{ candidateEvidenceId?: string; requiresAssessment?: boolean }>(
      'POST', `/passport/evidence/${ev}/reuse`,
      {}, subject.token,
    );
    if (r1.status === 201 && r1.data?.candidateEvidenceId && r1.data?.requiresAssessment === true) {
      pass('9a. reuse submitted → 201', {
        candidate: r1.data.candidateEvidenceId,
        requiresAssessment: r1.data.requiresAssessment,
      });
    } else {
      fail('9a. reuse submitted → 201', { status: r1.status, data: r1.data });
    }

    // 9b. disputed → 409
    const evD = await submitEvidence(subject.token, 'CYB.ATOM.0044', 'P', 'v3 reuse disputed');
    // связать с assessment и задиспьютить
    await submitAssessment(
      assessor.token, subject.id, 'CYB.ATOM.0044', 'P', 5, 'exam', [evD],
    );
    await request(
      'POST', `/passport/evidence/${evD}/dispute`,
      { reason: 'v3 reuse disputed reason' }, subject.token,
    );
    const r2 = await request(
      'POST', `/passport/evidence/${evD}/reuse`, {}, subject.token,
    );
    expectEq('9b. reuse disputed → 409', r2.status, 409);

    // 9c. cross-atom → 422 (VALIDATION_ERROR проекта)
    const r3 = await request(
      'POST', `/passport/evidence/${ev}/reuse`,
      { atomId: 'CYB.ATOM.0045' }, subject.token,
    );
    expectEq('9c. reuse cross-atom → 422', r3.status, 422);

    // 9d. assessment не создан после 9a — считаем assessments на 0044/U
    const cardU = await request<{
      assessments: Array<{ id: string; dimension: string; status: string; isCurrent: boolean }>;
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0044/card', undefined, subject.token,
    );
    const uCurrent = (cardU.data?.assessments ?? []).filter(
      (a) => a.dimension === 'U' && a.isCurrent,
    );
    if (uCurrent.length === 0) {
      pass('9d. reuse does not create assessment');
    } else {
      fail('9d. reuse does not create assessment', { uCurrent });
    }
  }

  // ─── 10. P1: superseded с isCurrent:false (шаг 5) ──────────────────
  {
    // 10a. два assessment подряд на одном (atom, dim)
    const ev1 = await submitEvidence(subject.token, 'CYB.ATOM.0046', 'U', 'v3 supersede 1');
    const as1 = await submitAssessment(
      assessor.token, subject.id, 'CYB.ATOM.0046', 'U', 4, 'exam', [ev1],
    );
    const as2 = await submitAssessment(
      assessor.token, subject.id, 'CYB.ATOM.0046', 'U', 7, 'exam',
    );

    const card = await request<{
      dimensions: Array<{ dimension: string; level: number | null; status: string }>;
      assessments: Array<{ id: string; dimension: string; status: string; isCurrent: boolean; level: number | null }>;
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0046/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    const a1 = card.data?.assessments?.find((x) => x.id === as1);
    const a2 = card.data?.assessments?.find((x) => x.id === as2);

    if (u?.level === 7 && u?.status === 'confirmed') {
      pass('10a. state reflects latest assessment', { level: u.level });
    } else {
      fail('10a. state reflects latest assessment', { u });
    }
    if (a1?.status === 'superseded' && a1.isCurrent === false) {
      pass('10b. old assessment superseded + isCurrent:false', {
        status: a1.status, isCurrent: a1.isCurrent,
      });
    } else {
      fail('10b. old assessment superseded + isCurrent:false', { a1 });
    }
    if (a2?.status === 'active' && a2.isCurrent === true) {
      pass('10c. new assessment active + isCurrent:true', {
        status: a2.status, isCurrent: a2.isCurrent,
      });
    } else {
      fail('10c. new assessment active + isCurrent:true', { a2 });
    }
  }

  // ─── итог ─────────────────────────────────────────────────────────
  console.log('');
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    await gracefulShutdown();
    process.exit(1);
  }
  console.log('OK: 0 failed');
  await gracefulShutdown();
}

// ─── findAppealId: находим id appeal_filed по (subject, atom, assessment) ──
// Апелляция доступна только через историю (эндпоинта «список моих апелляций»
// в P0 нет). Ищем appeal_filed с payload.assessment_id === assessmentId.

async function findAppealId(
  subjectToken: string,
  atomId: string,
  assessmentId: string,
): Promise<string> {
  const r = await request<{ data: Array<{ id: string; eventType: string; payload: { assessment_id?: string } }> }>(
    'GET', `/passport/history?atom_id=${atomId}&limit=500`, undefined, subjectToken,
  );
  const hit = (r.data?.data ?? []).find(
    (e) => e.eventType === 'appeal_filed' && e.payload?.assessment_id === assessmentId,
  );
  if (!hit) {throw new Error(`findAppealId: not found for assessment=${assessmentId}`);}
  return hit.id;
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});