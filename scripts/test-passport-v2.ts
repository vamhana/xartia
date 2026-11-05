// I.9.09.05 — Smoke v2: профессиональный паспорт (Фаза 1).
//
// Запуск: pnpm tsx scripts/test-passport-v2.ts [adminPhone] [adminPassword]
//
// Архитектор берётся из аргументов, иначе из ARCHITECT_PHONE / ARCHITECT_PASSWORD
// (.env), по умолчанию +79001234567 / ChangeMe123456. Архитектор НЕ является
// subject'ом и не является assessor'ом: он только заводит двух актёров через
// приём заявки (POST /auth/register → POST /admin/registration-requests/:id/accept).
//
//   subject  — обычный участник (роль не нужна: evidence и чтение своего
//              паспорта доступны любому аутентифицированному);
//   assessor — приём СРАЗУ с role='VERIFIER', иначе POST /passport/assessments
//              вернёт 403 «Only authorized assessors can create assessments».
//
// Оба получают уникальный телефон на каждый прогон: участники накапливаются
// в БД, но прогоны не конфликтуют. Готовых актёров можно подставить через
// TEST_SUBJECT_PHONE/PASS и TEST_ASSESSOR_PHONE/PASS — тогда они не создаются.
//
// SKIP в этом тесте отсутствует осознанно: молчаливый скип маскирует
// отсутствие второй стороны (именно так v2 «проходил» в CI с 5 скипами).
// Любая невозможность выполнить проверку — FAIL и exit(1).
//
// Покрытие (docs/passport-implementation.md §7.1):
//   1.  seed atoms total=54
//   1b. seed идемпотентен (rerun → без вставок и обновлений)
//   2.  declare → evidence → assessment → confirmed
//   3.  0 vs null различимы
//   4.  self-assessment запрещён (403)
//   5.  чужой паспорт закрыт по умолчанию (403), открывается по consent
//   6.  апелляция: история +1, assessment/state → under_review
//   7.  width/depth раздельно, без average
//   8.  старый /me/passport жив
//   9.  несуществующий атом → 404

import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://127.0.0.1:3000';

const ADMIN_PHONE = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const ADMIN_PASS = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

const READY_SUBJECT_PHONE = process.env['TEST_SUBJECT_PHONE'];
const READY_SUBJECT_PASS = process.env['TEST_SUBJECT_PASS'];
const READY_ASSESSOR_PHONE = process.env['TEST_ASSESSOR_PHONE'];
const READY_ASSESSOR_PASS = process.env['TEST_ASSESSOR_PASS'];

/** Пароль создаваемых актёров: политика ≥12, заглавная, строчная, цифры. */
const ACTOR_PASS = 'SmokePass12345';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// ─── HTTP ─────────────────────────────────────────────────────────────

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

async function req(method: string, path: string, body?: unknown, token?: string): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

interface Actor {
  phone: string;
  id: string;
  token: string;
}

async function login(phone: string, pass: string): Promise<Actor> {
  const res = await req('POST', '/auth/login', { phone, password: pass });
  if (res.status !== 200 || !res.data?.access_token) {
    throw new Error(`login ${phone} → ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { phone, id: res.data.participant.id, token: res.data.access_token };
}

// ─── Актёры ───────────────────────────────────────────────────────────

/** Уникальный телефон на прогон: +7999 + 7 цифр (11 цифр всего). */
function uniquePhone(offset: number): string {
  const tail = String((Date.now() + offset * 7919) % 10_000_000).padStart(7, '0');
  return `+7999${tail}`;
}

async function pickDirection(adminToken: string): Promise<string> {
  const r = await req('GET', '/directions', undefined, adminToken);
  const first = r.data?.data?.[0] ?? r.data?.[0];
  if (r.status !== 200 || !first?.id) {
    throw new Error(`GET /directions → ${r.status} ${JSON.stringify(r.data)}`);
  }
  return first.id as string;
}

async function register(phone: string): Promise<string> {
  const r = await req('POST', '/auth/register', {
    phone,
    messengers: { telegram: `@smoke_${phone.slice(-4)}` },
    password: ACTOR_PASS,
    consent_video: true,
    consent_data: true,
  });
  if (r.status !== 201 || !r.data?.request_id) {
    throw new Error(`register ${phone} → ${r.status} ${JSON.stringify(r.data)}`);
  }
  return r.data.request_id as string;
}

/**
 * Заводит актёра через приём заявки. role передаётся только асессору:
 * роли выдаются в accept, отдельных ручек синхронной выдачи нет.
 */
async function provision(
  adminToken: string,
  directionId: string,
  name: string,
  offset: number,
  role?: 'VERIFIER',
): Promise<Actor> {
  const phone = uniquePhone(offset);
  const requestId = await register(phone);

  const body: Record<string, unknown> = { name, direction_id: directionId };
  if (role) body['role'] = role;
  const accept = await req(
    'POST', `/admin/registration-requests/${requestId}/accept`, body, adminToken,
  );
  if (accept.status !== 201 || !accept.data?.temporary_password) {
    throw new Error(`accept ${phone} → ${accept.status} ${JSON.stringify(accept.data)}`);
  }
  // accept выдаёт роль в try/catch: при сбое приём проходит, role=null,
  // и шаг 2b упал бы 403 без понятной причины. Поэтому — FAIL здесь.
  if (role && accept.data.role !== role) {
    throw new Error(
      `accept ${phone}: роль ${role} не выдана (role=${String(accept.data.role)})`,
    );
  }
  return login(phone, accept.data.temporary_password as string);
}

async function ensureActors(admin: Actor): Promise<{ subject: Actor; assessor: Actor }> {
  const directionId = await pickDirection(admin.token);

  const subject = READY_SUBJECT_PHONE && READY_SUBJECT_PASS
    ? await login(READY_SUBJECT_PHONE, READY_SUBJECT_PASS)
    : await provision(admin.token, directionId, 'Смоук Субъект', 1);

  const assessor = READY_ASSESSOR_PHONE && READY_ASSESSOR_PASS
    ? await login(READY_ASSESSOR_PHONE, READY_ASSESSOR_PASS)
    : await provision(admin.token, directionId, 'Смоук Асессор', 2, 'VERIFIER');

  if (subject.id === assessor.id) {
    throw new Error('subject и assessor — один и тот же участник');
  }
  return { subject, assessor };
}

// ─── 1b. seed идемпотентен (повторный прогон без вставок/обновлений) ──

function checkSeedIdempotent(): void {
  const r = spawnSync(process.execPath, [TSX_CLI, join(REPO_ROOT, 'scripts', 'seed-passport.ts')], {
    encoding: 'utf8',
    timeout: 120_000,
    cwd: REPO_ROOT,
  });
  if (r.error) {
    fail('1b. seed idempotent (rerun)', { error: String(r.error), tsx: TSX_CLI });
    return;
  }
  if (r.status !== 0) {
    fail('1b. seed idempotent (rerun)', {
      status: r.status,
      stderr: (r.stderr ?? '').slice(0, 600),
    });
    return;
  }
  const out = r.stdout ?? '';
  // seed-passport.ts печатает "(inserted=N, updated=M, unchanged=K)" по блокам.
  if (/inserted=([1-9]\d*)/.test(out) || /updated=([1-9]\d*)/.test(out)) {
    fail('1b. seed idempotent', { stdout: out.slice(-600) });
    return;
  }
  pass('1b. seed idempotent (rerun: no inserts/updates)');
}

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
  if (actual === expected) pass(label, { actual });
  else fail(label, { actual, expected });
}

// ─── Сценарии ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);
  console.log(`admin=${ADMIN_PHONE}`);

  const admin = await login(ADMIN_PHONE, ADMIN_PASS);
  const { subject, assessor } = await ensureActors(admin);
  console.log(`subject=${subject.phone} (${subject.id})`);
  console.log(`assessor=${assessor.phone} (${assessor.id})`);

  // ── 1. seed: 54 атома ──
  {
    const r = await req('GET', '/passport/catalog?limit=1', undefined, subject.token);
    if (r.status !== 200) {
      fail('1. seed atoms', { status: r.status });
    } else {
      const total = r.data.meta?.total ?? 0;
      if (total >= 54) pass('1. seed atoms ≥ 54', { total });
      else fail('1. seed atoms ≥ 54', { total });
    }
  }
  // ── 1b. seed идемпотентен ──
  checkSeedIdempotent();

  // ── 2. declare → evidence → assessment ──
  const ATOM_DECL = 'CYB.ATOM.0042';   // Реализовать контроль доступа — P
  const ATOM_ZERO = 'CYB.ATOM.0043';   // Проверить личность — P (0)
  const DIM_DECL: 'U' | 'X' | 'D' | 'P' | 'E' = 'U';

  {
    const ev = await req(
      'POST', '/passport/evidence',
      {
        atomId: ATOM_DECL, dimension: DIM_DECL, evidenceType: 'portfolio',
        description: 'v2 smoke evidence',
      },
      subject.token,
    );
    if (ev.status !== 201) fail('2a. POST evidence', { status: ev.status, data: ev.data });
    else pass('2a. POST evidence 201');

    const a = await req(
      'POST', '/passport/assessments',
      {
        participantId: subject.id,
        atomId: ATOM_DECL, dimension: DIM_DECL, level: 5, method: 'exam',
      },
      assessor.token,
    );
    if (a.status !== 201) fail('2b. POST assessment', { status: a.status, data: a.data });
    else pass('2b. POST assessment 201');

    const card = await req(
      'GET', `/passport/atoms/${ATOM_DECL}/card`, undefined, subject.token,
    );
    const dim = (card.data?.dimensions ?? []).find(
      (d: { dimension: string }) => d.dimension === DIM_DECL,
    );
    if (dim?.status === 'confirmed' && dim?.level === 5) {
      pass('2c. card reflects state', { status: dim.status, level: dim.level });
    } else {
      fail('2c. card reflects state', { got: dim, want: { status: 'confirmed', level: 5 } });
    }
  }

  // ── 3. 0 vs null ──
  {
    const a = await req(
      'POST', '/passport/assessments',
      {
        participantId: subject.id,
        atomId: ATOM_ZERO, dimension: 'P', level: 0, method: 'exam',
      },
      assessor.token,
    );
    if (a.status !== 201) fail('3a. assess level=0', { status: a.status, data: a.data });

    const card = await req(
      'GET', `/passport/atoms/${ATOM_ZERO}/card`, undefined, subject.token,
    );
    const p = (card.data?.dimensions ?? []).find(
      (d: { dimension: string }) => d.dimension === 'P',
    );
    const u = (card.data?.dimensions ?? []).find(
      (d: { dimension: string }) => d.dimension === 'U',
    );
    if (p?.level === 0 && p?.status === 'confirmed' && u?.level === null && u?.status === 'not_assessed') {
      pass('3b. 0 ≠ null', { P: p, U: u });
    } else {
      fail('3b. 0 ≠ null', { P: p, U: u });
    }
  }

  // ── 4. self-assessment запрещён ──
  {
    const a = await req(
      'POST', '/passport/assessments',
      {
        participantId: subject.id,
        atomId: 'CYB.ATOM.0001', dimension: 'U', level: 5, method: 'exam',
      },
      subject.token,
    );
    expectEq('4. self-assessment 403', a.status, 403);
  }

  // ── 5. приватность: чужой паспорт закрыт ──
  {
    const r = await req(
      'GET', `/passport/people/${assessor.id}?scope=public`,
      undefined, subject.token,
    );
    expectEq('5a. foreign passport 403 (default private)', r.status, 403);

    const p = await req(
      'PATCH', '/passport/visibility',
      { scope: 'public', visibility: 'levels', consent: true },
      assessor.token,
    );
    if (p.status !== 200) fail('5b. PATCH visibility', { status: p.status, data: p.data });
    else pass('5b. PATCH visibility 200');

    const r2 = await req(
      'GET', `/passport/people/${assessor.id}?scope=public`,
      undefined, subject.token,
    );
    expectEq('5c. foreign passport 200 after consent', r2.status, 200);

    await req(
      'PATCH', '/passport/visibility',
      { scope: 'public', visibility: 'private', consent: false },
      assessor.token,
    );
  }

  // ── 6. апелляция сохраняет историю ──
  {
    const card = await req(
      'GET', `/passport/atoms/${ATOM_DECL}/card`, undefined, subject.token,
    );
    const assessment = (card.data?.assessments ?? []).find(
      (a: { dimension: string; status: string }) =>
        a.dimension === DIM_DECL && a.status === 'active',
    );
    if (!assessment) {
      fail('6a. active assessment exists', card.data?.assessments);
    } else {
      const before = await req('GET', '/passport/history?limit=500', undefined, subject.token);
      const nBefore = (before.data?.meta?.total ?? 0) as number;

      const ap = await req(
        'POST', '/passport/appeals',
        { assessmentId: assessment.id, reason: 'v2 smoke appeal' },
        subject.token,
      );
      if (ap.status !== 200) fail('6b. POST appeal', { status: ap.status, data: ap.data });
      else pass('6b. POST appeal 200');

      const after = await req('GET', '/passport/history?limit=500', undefined, subject.token);
      const nAfter = (after.data?.meta?.total ?? 0) as number;
      expectEq('6c. history grew by 1', nAfter - nBefore, 1);

      const card2 = await req(
        'GET', `/passport/atoms/${ATOM_DECL}/card`, undefined, subject.token,
      );
      const a2 = (card2.data?.assessments ?? []).find(
        (x: { id: string }) => x.id === assessment.id,
      );
      const d2 = (card2.data?.dimensions ?? []).find(
        (d: { dimension: string }) => d.dimension === DIM_DECL,
      );
      if (a2?.status === 'under_review' && d2?.status === 'under_review') {
        pass('6d. assessment & state under_review', { a: a2.status, d: d2.status });
      } else {
        fail('6d. assessment & state under_review', { a: a2, d: d2 });
      }
    }
  }

  // ── 7. width/depth раздельно ──
  {
    const me = await req('GET', '/passport/me', undefined, subject.token);
    if (me.status !== 200) {
      fail('7a. GET /passport/me', { status: me.status });
    } else {
      const d = me.data;
      const ok =
        typeof d.width === 'number' &&
        typeof d.depthExecution === 'number' &&
        typeof d.depthUnderstanding === 'number' &&
        typeof d.depthFull === 'number' &&
        d.depthExecution >= d.depthFull &&
        d.depthUnderstanding >= d.depthFull &&
        !('average' in d) &&
        !('avg' in d);
      if (ok) pass('7b. width/depth fields present & no average');
      else fail('7b. width/depth fields present & no average', d);
    }
  }

  // ── 8. старый контракт ──
  {
    const r = await req('GET', '/me/passport', undefined, subject.token);
    if (r.status === 200 && r.data?.id === subject.id && 'roles' in r.data) {
      pass('8. /me/passport (PassportFull) intact');
    } else {
      fail('8. /me/passport (PassportFull) intact', { status: r.status });
    }
  }

  // ── 9. 404 на несуществующий атом ──
  {
    const r = await req('GET', '/passport/atoms/CYB.ATOM.9999', undefined, subject.token);
    expectEq('9. atom 9999 → 404', r.status, 404);
  }

  // ── итог ──
  console.log('');
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    await gracefulShutdown();
    process.exit(1);
  }
  console.log('OK: 0 failed, 0 skipped');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});
