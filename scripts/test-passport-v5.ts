// I.9.09.13 — Smoke v5: Фаза 3b, P0 (Permit + mentor_questions + permit-gap в matching).
//
// Запуск: pnpm tsx scripts/test-passport-v5.ts
//
// Самодостаточен: создаёт admin / assessor / subject.
// Требует: миграция 061 применена.
// Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

import {
  BASE,
  createMentorQuestion,
  createPermit,
  createTask,
  ensureActor,
  issuePermit,
  listMyQuestions,
  login,
  request,
  revokeParticipantPermit,
  submitAssessment,
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

// Уникальный permitId на каждый прогон.
function uniquePermitId(prefix: string): string {
  const n = String(Math.floor(Math.random() * 9000) + 1000);
  return `PERMIT.${prefix.toUpperCase()}.${n}`;
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  const subject = await ensureActor(admin.token, { name: 'v5 subject' });
  console.log(`subject: ${subject.id}`);

  const assessor = await ensureActor(admin.token, {
    name: 'v5 assessor',
    role: 'VERIFIER',
  });
  console.log(`assessor: ${assessor.id}`);

  // ─── 1. Permit CRUD ─────────────────────────────────────────────────
  const permitId = uniquePermitId('height');
  {
    // 1a. создание — 201
    const r = await createPermit(admin.token, {
      permitId,
      name: 'v5 работа на высоте',
      issuedBy: 'Внешний орган',
      scope: 'до 15 м',
      verificationMethod: 'внешний сертификат',
    });
    expectEq('1a. create permit 201', r.status, 201);

    // 1b. duplicate — 409
    const dup = await createPermit(admin.token, {
      permitId,
      name: 'dup',
      issuedBy: 'x',
      verificationMethod: 'y',
    });
    expectEq('1b. duplicate permit 409', dup.status, 409);

    // 1c. bad permitId — 422
    const bad = await createPermit(admin.token, {
      permitId: 'PERMIT.bad',
      name: 'x',
      issuedBy: 'x',
      verificationMethod: 'x',
    });
    expectEq('1c. bad permitId 422', bad.status, 422);

    // 1d. создание без прав (assessor = VERIFIER) — 403
    const deny = await createPermit(assessor.token, {
      permitId: uniquePermitId('other'),
      name: 'x',
      issuedBy: 'x',
      verificationMethod: 'x',
    });
    expectEq('1d. create permit без прав 403', deny.status, 403);
  }

  // ─── 2. Issue ───────────────────────────────────────────────────────
  let firstPermitId: string;
  {
    // 2a. выдать subject'у — 201
    const r = await issuePermit(
      admin.token, subject.id, permitId,
      // 1 год вперёд
      new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    );
    if (r.status === 201 && r.data.id) {
      firstPermitId = r.data.id;
      pass('2a. issue permit 201', { id: firstPermitId, isExpired: r.data.isExpired });
    } else {
      fail('2a. issue permit 201', { status: r.status, data: r.data });
      throw new Error('cannot continue without permit');
    }

    // 2b. duplicate active — 409
    const dup = await issuePermit(admin.token, subject.id, permitId);
    expectEq('2b. duplicate issue 409', dup.status, 409);

    // 2c. 403 для subject'а (нет роли)
    const deny = await issuePermit(subject.token, subject.id, permitId);
    expectEq('2c. issue без прав 403', deny.status, 403);
  }

  // ─── 3. task_profile permit_ids валидация ──────────────────────────
  const taskId = await createTask(admin.token, 'v5 permit task');
  {
    // 3a. неизвестный permit_id → 422 (профиль НЕ создаётся, validation
    // срабатывает до INSERT).
    const bad = await request(
      'POST', `/passport/tasks/${taskId}/profile`,
      {
        requiredAtoms: [
          { atom_id: 'CYB.ATOM.0009', role: 'executor', min: { P: 4 } },
        ],
        permitIds: ['PERMIT.NONEXIST.0001'],
      },
      admin.token,
    );
    expectEq('3a. unknown permit_id → 422', bad.status, 422);

    // 3b. валидный permit_id → 201 (единственный POST — профиль создаётся
    // сразу с permitIds).
    const ok = await request(
      'POST', `/passport/tasks/${taskId}/profile`,
      {
        requiredAtoms: [
          { atom_id: 'CYB.ATOM.0009', role: 'executor', min: { P: 4 } },
        ],
        permitIds: [permitId],
      },
      admin.token,
    );
    expectEq('3b. valid permit_id → 201', ok.status, 201);
  }

  // ─── 4. Matching: permit-gap ────────────────────────────────────────
  // Нужно, чтобы subject имел P≥4 на 0009, чтобы пройти atom-gap.
  // assessor ставит P=5.
  await submitAssessment(assessor.token, subject.id, 'CYB.ATOM.0009', 'P', 5, 'exam');

  {
    // 4a. permit выдан active → match (атом покрыт + permit ok)
    const r = await request<{
      status?: string;
      gaps?: Array<{ reason: string; permitStatus?: string }>;
    }>(
      'GET', `/passport/tasks/${taskId}/matching?participantId=${subject.id}`,
      undefined, admin.token,
    );
    if (r.status === 200 && r.data.status === 'match') {
      pass('4a. matching match (permit active)', { status: r.data.status });
    } else {
      fail('4a. matching match (permit active)', { status: r.status, data: r.data });
    }
  }

  {
    // 4b. отзываем permit → matching no_match / missing_permit / revoked
    const rev = await revokeParticipantPermit(admin.token, firstPermitId!, 'v5 smoke');
    expectEq('4b. revoke 200', rev.status, 200);

    const r = await request<{
      status?: string;
      gaps?: Array<{ reason: string; permitStatus?: string; permitId?: string }>;
    }>(
      'GET', `/passport/tasks/${taskId}/matching?participantId=${subject.id}`,
      undefined, admin.token,
    );
    const permitGap = r.data.gaps?.find((g) => g.reason === 'missing_permit');
    if (
      r.status === 200 &&
      r.data.status === 'no_match' &&
      permitGap?.permitStatus === 'revoked' &&
      permitGap.permitId === permitId
    ) {
      pass('4b. matching no_match / missing_permit / revoked');
    } else {
      fail('4b. matching no_match / missing_permit / revoked', {
        status: r.status,
        data: r.data,
      });
    }

    // 4c. повторный revoke — идемпотентно 200
    const rev2 = await revokeParticipantPermit(admin.token, firstPermitId!, 'again');
    expectEq('4c. idempotent revoke 200', rev2.status, 200);
  }

  {
    // 4d. выдаём permit с validUntil в прошлом → expired gap
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await issuePermit(admin.token, subject.id, permitId, past);
    if (r.status === 201) {pass('4d. issue expired 201');}
    else {fail('4d. issue expired 201', { status: r.status, data: r.data });}

    const m = await request<{
      status?: string;
      gaps?: Array<{ reason: string; permitStatus?: string }>;
    }>(
      'GET', `/passport/tasks/${taskId}/matching?participantId=${subject.id}`,
      undefined, admin.token,
    );
    const gap = m.data.gaps?.find((g) => g.reason === 'missing_permit');
    if (m.data.status === 'no_match' && gap?.permitStatus === 'expired') {
      pass('4e. matching expired permit');
    } else {
      fail('4e. matching expired permit', { data: m.data });
    }

    // cleanup: revoke истёкший, чтобы не блокировать будущие прогоны
    if (r.data.id) {
      await revokeParticipantPermit(admin.token, r.data.id, 'cleanup');
    }
  }

  // ─── 5. mentor_questions ────────────────────────────────────────────
  let questionId: string;
  {
    // 5a. создать вопрос — 201
    const r = await createMentorQuestion(
      subject.token,
      'v5: как проверить контракт?',
      'CYB.ATOM.0009',
    );
    if (r.status === 201 && r.data.id) {
      questionId = r.data.id;
      pass('5a. create question 201', { id: questionId, status: r.data.status });
    } else {
      fail('5a. create question 201', { status: r.status, data: r.data });
      throw new Error('cannot continue without question');
    }

    // 5b. bad atomId → 422
    const bad = await createMentorQuestion(subject.token, 'x', 'CYB.ATOM.9999');
    expectEq('5b. bad atomId 422', bad.status, 422);

    // 5c. список моих вопросов содержит
    const mine = await listMyQuestions(subject.token);
    if (mine.status === 200 && mine.data.data.some((q) => q.id === questionId)) {
      pass('5c. my questions contains');
    } else {
      fail('5c. my questions contains', { status: mine.status, data: mine.data });
    }

    // 5d. ответить как FA → 200
    const ans = await request<{ status?: string; answeredAt?: string }>(
      'POST', `/passport/teaching/mentor-questions/${questionId}/answer`,
      { answer: 'v5 answer: смотри на граничные случаи.' },
      admin.token,
    );
    if (ans.status === 200 && ans.data.status === 'answered') {
      pass('5d. FA answer 200', { status: ans.data.status });
    } else {
      fail('5d. FA answer 200', { status: ans.status, data: ans.data });
    }

    // 5e. ответить чужой (assessor — не mentor, не FA по вопросу) — 403
    // (assessor имеет VERIFIER, но не FA, и mentorId вопроса ≠ assessor)
    const deny = await request<{ status?: string }>(
      'POST', `/passport/teaching/mentor-questions/${questionId}/answer`,
      { answer: 'x' },
      assessor.token,
    );
    // Если mentorId=null и FA=admin, то assessor не может. Ожидаем 403.
    expectEq('5e. answer чужой 403', deny.status, 403);
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