// I.9.09.20 — Smoke наставничества (Фаза 3a, шаг 5).
// Запуск: pnpm tsx scripts/smoke-passport-teaching.ts
//
// Полный флоу:
//   admin — Архитектор; assessor — VERIFIER; subject — обычный.
//   1) readiness admin = unknown (нет assessments).
//   2) assessor ставит admin'у P=7, X=5, E=5 на 0009.
//   3) readiness admin = ready.
//   4) candidates по 0009 — admin в списке (ready).
//   5) assign: admin → subject.
//   6) students у admin = 1; mentors-for-me у subject содержит per_atom admin.
//   7) ?scope=mentor:
//        assessor → subject: 403 (нет relation).
//        admin    → subject: 200 (per_atom relation).
//   8) revoke.
//   9) admin → subject: 403.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  ensureActor,
  login,
  request,
  submitAssessment,
} from './lib/passport-fixtures.js';

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
  const admin = await login('+79001234567', 'ChangeMe123456');
  console.log(`admin: ${admin.id}`);

  // 1. readiness до assessments
  {
    const r = await request<{ state: string }>(
      'GET', '/passport/teaching/my-readiness?atomId=CYB.ATOM.0009',
      undefined, admin.token,
    );
    // Может быть 'unknown' (нет оценок) или 'ready' (если прошлый прогон
    // уже выставил). Оба — валидное начало.
    if (r.status === 200 && (r.data.state === 'unknown' || r.data.state === 'ready')) {
      pass('1. readiness before assessments', { state: r.data.state });
    } else {
      fail('1. readiness before assessments', { status: r.status, data: r.data });
    }
  }

  // 2. создать assessor и subject
  const assessor = await ensureActor(admin.token, {
    name: 'teaching-smoke assessor',
    role: 'VERIFIER',
  });
  console.log(`assessor: ${assessor.id}`);

  const subject = await ensureActor(admin.token, { name: 'teaching-smoke subject' });
  console.log(`subject: ${subject.id}`);

  // 3. assessor ставит admin'у assessments на 0009: P=7, X=5, E=5
  //    (submitAssessment не требует evidenceIds — A12)
  for (const [dim, level] of [
    ['P', 7],
    ['X', 5],
    ['E', 5],
  ] as const) {
    const id = await submitAssessment(
      assessor.token,
      admin.id,
      'CYB.ATOM.0009',
      dim,
      level,
      'exam',
    );
    console.log(`3. assessment ${dim}=${level}: ${id}`);
  }

  // 4. readiness после — ready
  {
    const r = await request<{ state: string; signals: unknown[] }>(
      'GET', '/passport/teaching/my-readiness?atomId=CYB.ATOM.0009',
      undefined, admin.token,
    );
    if (r.status === 200 && r.data.state === 'ready') {
      pass('4. readiness after assessments = ready', { signals: r.data.signals });
    } else {
      fail('4. readiness after assessments = ready', { status: r.status, data: r.data });
    }
  }

  // 5. candidates по 0009 — admin есть в списке
  {
    const r = await request<{ data: Array<{ mentorId: string; readiness: { state: string } }> }>(
      'GET', '/passport/teaching/mentors?atomId=CYB.ATOM.0009',
      undefined, subject.token,
    );
    const found = r.status === 200 && r.data.data.find((c) => c.mentorId === admin.id);
    if (found && found.readiness.state === 'ready') {
      pass('5. candidates contains admin with readiness=ready', {
        count: r.data.data.length,
      });
    } else {
      fail('5. candidates contains admin with readiness=ready', {
        status: r.status,
        count: r.data.data?.length,
        adminFound: !!found,
      });
    }
  }

  // 6. assign: admin → subject
  let relId: string;
  {
    const r = await request<{ id?: string; status?: string }>(
      'POST', '/passport/teaching/assign',
      { menteeId: subject.id, atomId: 'CYB.ATOM.0009' },
      admin.token,
    );
    if (r.status === 201 && r.data.id) {
      relId = r.data.id;
      pass('6. assign 201', { relationId: relId });
    } else {
      fail('6. assign 201', { status: r.status, data: r.data });
      throw new Error('assign failed, cannot continue');
    }
  }

  // 7. students у admin = 1 (или >0)
  {
    const r = await request<{ data: unknown[] }>(
      'GET', '/passport/teaching/students', undefined, admin.token,
    );
    if (r.status === 200 && r.data.data.length >= 1) {
      pass('7. students list', { count: r.data.data.length });
    } else {
      fail('7. students list', { status: r.status, data: r.data });
    }
  }

  // 8. mentors-for-me у subject содержит per_atom admin
  {
    const r = await request<{
      data: Array<{ source: string; mentorId: string; atomId: string | null }>;
    }>(
      'GET', '/passport/teaching/mentors-for-me', undefined, subject.token,
    );
    const perAtom = r.status === 200 &&
      r.data.data.find(
        (m) => m.source === 'per_atom' && m.mentorId === admin.id,
      );
    if (perAtom) {
      pass('8. mentors-for-me has per_atom admin', {
        count: r.data.data.length,
      });
    } else {
      fail('8. mentors-for-me has per_atom admin', {
        status: r.status,
        data: r.data.data,
      });
    }
  }

  // 9. ?scope=mentor:
  //    9a. assessor → subject: 403 (нет relation)
  //    9b. admin    → subject: 200 (per_atom relation)
  {
    const r1 = await request(
      'GET', `/passport/people/${subject.id}?scope=mentor`,
      undefined, assessor.token,
    );
    expectEq('9a. assessor → subject scope=mentor', r1.status, 403);

    const r2 = await request(
      'GET', `/passport/people/${subject.id}?scope=mentor`,
      undefined, admin.token,
    );
    expectEq('9b. admin → subject scope=mentor', r2.status, 200);
  }

  // 10. revoke
  {
    const r = await request<{ status?: string }>(
      'POST', `/passport/teaching/${relId}/revoke`,
      { reason: 'smoke' },
      admin.token,
    );
    if (r.status === 200 && r.data.status === 'revoked') {
      pass('10. revoke', { status: r.data.status });
    } else {
      fail('10. revoke', { status: r.status, data: r.data });
    }
  }

  // 11. после revoke admin → subject: 403
  {
    const r = await request(
      'GET', `/passport/people/${subject.id}?scope=mentor`,
      undefined, admin.token,
    );
    expectEq('11. after revoke scope=mentor', r.status, 403);
  }

  // 12. idempotent revoke — 200, статус revoked (не 409)
  {
    const r = await request<{ status?: string }>(
      'POST', `/passport/teaching/${relId}/revoke`,
      {},
      admin.token,
    );
    if (r.status === 200 && r.data.status === 'revoked') {
      pass('12. idempotent revoke');
    } else {
      fail('12. idempotent revoke', { status: r.status, data: r.data });
    }
  }

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