// I.9.09.14 — Smoke v6: Фаза 3c, P0 (TeamCapability + practice_review_policy
// + stale на 5+ атомах + cron permits-expire).
//
// Запуск: pnpm tsx scripts/test-passport-v6.ts
//
// Самодостаточен: создаёт admin / assessor / subject / outsider.
// Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { runPermitsExpire } from '../src/worker/jobs/permits-expire.js';

import {
  BASE,
  assessTeam,
  backdateAssessment,
  createPermit,
  createTeam,
  ensureActor,
  getMe,
  getTeam,
  getTeamHistory,
  issuePermit,
  listMyTeams,
  login,
  request,
  submitAssessment,
  submitEvidence,
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

function uniquePermitId(prefix: string): string {
  const n = String(Math.floor(Math.random() * 9000) + 1000);
  return `PERMIT.${prefix.toUpperCase()}.${n}`;
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  const subject = await ensureActor(admin.token, { name: 'v6 subject' });
  const assessor = await ensureActor(admin.token, { name: 'v6 assessor', role: 'VERIFIER' });
  const outsider = await ensureActor(admin.token, { name: 'v6 outsider' });
  console.log(`subject: ${subject.id}`);
  console.log(`assessor: ${assessor.id}`);
  console.log(`outsider: ${outsider.id}`);

  // ─── 1. practice_review_policy: 54/54 ≠ to_calibrate ────────────────
  {
    const row = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM competency_atoms
        WHERE freshness_policy->>'practice_review_policy' = 'to_calibrate'`,
    );
    // Строго 0: seed-catalog-v04 обязан починить 0055 (P24M или иной).
    // Если тут 1 — значит seed-catalog-v04 не отработал; это регресс,
    // маскировать «страховкой n===1» нельзя.
    expectEq('1a. atoms with to_calibrate = 0', row[0]?.n ?? -1, 0);

    const total = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM competency_atoms`,
    );
    // Каталог v0.4: 54 пилота + динамически добавленные через workflow.
    // Проверяем «не меньше 54» — точное число меняется по мере расширения.
    if ((total[0]?.n ?? 0) >= 54) {
      pass('1b. atoms total ≥ 54', { actual: total[0]?.n });
    } else {
      fail('1b. atoms total ≥ 54', { actual: total[0]?.n });
    }
  }

  // ─── 2. staleAssessments на 5+ атомах ───────────────────────────────
  // Берём 5 атомов с P12M (medium). Бэкдейт 13 месяцев → stale.
  {
    const atoms = ['CYB.ATOM.0002', 'CYB.ATOM.0003', 'CYB.ATOM.0004',
                   'CYB.ATOM.0005', 'CYB.ATOM.0006'];
    for (const atomId of atoms) {
      const evId = await submitEvidence(subject.token, atomId, 'U', `v6 stale ${atomId}`);
      const asId = await submitAssessment(
        assessor.token, subject.id, atomId, 'U', 5, 'exam', [evId],
      );
      // 0002–0006 — content_change_rate='slow' → practice_review_policy='P24M'
      // (после 3c). Бэкдейт 25 мес > 24 → stale.
      await backdateAssessment(asId, 25);
    }

    const me = await getMe(subject.token);
    const staleHits = me.staleAssessments.filter((s) => atoms.includes(s.atomId));
    if (staleHits.length >= 5) {
      pass('2a. staleAssessments на 5+ атомах', { count: staleHits.length });
    } else {
      fail('2a. staleAssessments на 5+ атомах', { hits: staleHits });
    }

    // Уровень не понизился
    const card = await request<{
      dimensions: Array<{ dimension: string; level: number | null; status: string }>;
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0002/card', undefined, subject.token,
    );
    const u = card.data?.dimensions?.find((d) => d.dimension === 'U');
    if (u?.level === 5 && u?.status === 'confirmed') {
      pass('2b. stale не понижает level', { level: u.level });
    } else {
      fail('2b. stale не понижает level', { u });
    }
  }

  // ─── 3. TeamCapability CRUD + assess ────────────────────────────────
  let teamId: string;
  {
    const r = await createTeam(admin.token, {
      name: 'v6 smoke team',
      expectedResult: 'smoke result',
      participants: [subject.id, outsider.id],
      criteria: {
        coordination: { description: 'слаженность' },
        result: { description: 'результат' },
      },
    });
    if (r.status === 201 && r.data.id) {
      teamId = r.data.id;
      pass('3a. create team 201', { id: teamId });
    } else {
      fail('3a. create team 201', { status: r.status, data: r.data });
      throw new Error('cannot continue without team');
    }

    // list
    const list = await listMyTeams(admin.token);
    if (list.status === 200 && list.data.data.some((t) => t.id === teamId)) {
      pass('3b. list my teams contains');
    } else {
      fail('3b. list my teams contains', { status: list.status, data: list.data });
    }

    // get
    const g = await getTeam(admin.token, teamId);
    expectEq('3c. get team 200', g.status, 200);
    expectEq('3c. get team status draft', g.data.status, 'draft');

    // assess (admin = assessor, не участник)
    const a = await assessTeam(admin.token, teamId, 7, { coordination: 8, result: 6 });
    if (a.status === 201 && a.data.level === 7) {
      pass('3d. assess 201 level=7', { level: a.data.level });
    } else {
      fail('3d. assess 201 level=7', { status: a.status, data: a.data });
    }

    // status → assessed
    const g2 = await getTeam(admin.token, teamId);
    expectEq('3e. status assessed', g2.data.status, 'assessed');

    // history
    const h = await getTeamHistory(admin.token, teamId);
    if (h.status === 200 && h.data.data.length >= 1) {
      pass('3f. history has 1+', { count: h.data.data.length });
    } else {
      fail('3f. history has 1+', { status: h.status, data: h.data });
    }

    // criteriaScores с неизвестным ключом → 422
    const badScore = await assessTeam(admin.token, teamId, 5, { unknownKey: 5 });
    expectEq('3g. unknown criteria key → 422', badScore.status, 422);

    // level 10 → 422
    const badLevel = await assessTeam(admin.token, teamId, 10, { coordination: 5 });
    expectEq('3h. level 10 → 422', badLevel.status, 422);
  }

  // ─── 4. assessor ∈ participants → 403 (API) + ERROR (триггер) ───────
  {
    // subject — участник команды, но не assessor. Пытается оценить.
    const deny = await assessTeam(subject.token, teamId, 5, { coordination: 5 });
    expectEq('4a. member assess → 403', deny.status, 403);

    // Прямой INSERT через SQL — триггер должен сработать.
    let threw = false;
    try {
      await query(
        `INSERT INTO team_capabilities
           (name, expected_result, participants, assessor_id, created_by)
         VALUES ('trigger-test', 'x', $1::jsonb, $2, $3)`,
        [JSON.stringify([subject.id]), subject.id, admin.id],
      );
    } catch {
      threw = true;
    }
    if (threw) {
      pass('4b. trigger blocks assessor ∈ participants');
    } else {
      fail('4b. trigger blocks assessor ∈ participants');
    }
  }

  // ─── 5. Viewer ∈ participants → 200; ∉ → 403 ────────────────────────
  {
    const memberView = await getTeam(subject.token, teamId);
    expectEq('5a. member get team 200', memberView.status, 200);

    const outsiderView = await getTeam(outsider.token, teamId);
    // outsider ∈ participants (мы положили его в команду), так что 200.
    // Для 403 нужен кто-то вне team и не assessor.
    const stranger = await ensureActor(admin.token, { name: 'v6 stranger' });
    const strangerView = await getTeam(stranger.token, teamId);
    expectEq('5b. stranger get team 403', strangerView.status, 403);

    void outsiderView;
  }

  // ─── 6. Cron permits-expire ─────────────────────────────────────────
  {
    const permitId = uniquePermitId('v6cron');
    const create = await createPermit(admin.token, {
      permitId,
      name: 'v6 cron test',
      issuedBy: 'x',
      verificationMethod: 'y',
    });
    if (create.status !== 201) {
      fail('6a. create permit for cron', { status: create.status, data: create.data });
    } else {
      pass('6a. create permit for cron');
    }

    // Выдаём с validUntil в прошлом
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const issue = await issuePermit(admin.token, subject.id, permitId, past);
    if (issue.status === 201 && issue.data.id) {
      pass('6b. issue with past validUntil', { id: issue.data.id });
    } else {
      fail('6b. issue with past validUntil', { status: issue.status, data: issue.data });
    }

    // Статус до — active
    const before = await query<{ status: string }>(
      `SELECT status FROM participant_permits
        WHERE permit_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [permitId],
    );
    expectEq('6c. before cron status=active', before[0]?.status, 'active');

    // cron
    const result = await runPermitsExpire();
    if (result.participantPermitsExpired >= 1) {
      pass('6d. cron expired 1+', result);
    } else {
      fail('6d. cron expired 1+', result);
    }

    // Статус после — expired
    const after = await query<{ status: string }>(
      `SELECT status FROM participant_permits
        WHERE permit_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [permitId],
    );
    expectEq('6e. after cron status=expired', after[0]?.status, 'expired');
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