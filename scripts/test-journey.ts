// scripts/test-journey.ts
// Путь участника: заявка → уведомления четырём функциям → приём →
// назначение наставника → наставник видит ученика и его прогресс.
//
// Проверяем не «эндпоинт отвечает 200», а что цепочка событий не рвётся:
// у каждой функции Хартии есть адресат (или фолбэк на Архитектора), а
// наставник получает ученика и видит его прогресс.
//
// Каждый прогон создаёт собственную пару «наставник + ученик», поэтому тест
// не упирается в лимит учеников (I.6.4.1) и не зависит от прошлых запусков.
//
// Запуск: pnpm tsx scripts/test-journey.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

interface Note {
  id: string;
  type: string;
  title: string;
  data?: { requestId?: string; participantId?: string; link?: string };
  read: boolean;
}

interface User {
  token: string;
  participantId: string;
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function call<T = unknown>(
  method: string, path: string, body?: unknown, token?: string,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) {headers['Authorization'] = `Bearer ${token}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

async function registerApplicant(suffix: string, n: number): Promise<string | null> {
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7999${suffix}${n}`,
    messengers: { telegram: `@journey_${suffix}_${n}` },
    password: `JourneyTest${suffix}${n}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) {
    fail(`register #${n} → ${reg.status}: ${JSON.stringify(reg.data)}`);
    return null;
  }
  return reg.data.request_id;
}

async function main(): Promise<void> {
  console.log('▶ Путь участника: заявка → функции → приём → наставник\n');

  const login = await call<{ access_token: string }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const arch: User = { token: login.data.access_token, participantId: '' };

  const suffix = String(Date.now()).slice(-5);
  const menteeReq = await registerApplicant(suffix, 1);
  const mentorReq = await registerApplicant(suffix, 2);
  if (!menteeReq || !mentorReq) { return; }

  // 1. Заявка порождает четыре уведомления (фолбэк — Архитектор).
  const notes = await call<{ data: Note[] }>(
    'GET', '/notifications/history?page=1&per_page=50', undefined, arch.token,
  );
  for (const [type, label] of [
    ['registration.incubation', 'инкубация'],
    ['registration.balancing', 'балансировка'],
    ['registration.noology', 'ноология'],
    ['registration.verification', 'верификация'],
  ] as const) {
    const note = notes.data.data.find(
      (n) => n.type === type && n.data?.requestId === menteeReq,
    );
    if (note) { ok(`${label}: «${note.title}»`); }
    else { fail(`${label}: уведомления ${type} нет`); }
  }

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, arch.token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  const accept = async (requestId: string, name: string): Promise<{
    participant: { id: string; externalId: string };
    temporary_password: string;
  } | null> => {
    const res = await call<{
      participant: { id: string; externalId: string };
      temporary_password: string;
    }>(
      'POST', `/admin/registration-requests/${requestId}/accept`,
      { direction_id: dir.id, name, direction_number: 9 },
      arch.token,
    );
    if (res.status !== 201) {
      fail(`accept → ${res.status}: ${JSON.stringify(res.data)}`);
      return null;
    }
    return res.data;
  };

  const mentee = await accept(menteeReq, `Ученик ${suffix}`);
  const mentor = await accept(mentorReq, `Наставник ${suffix}`);
  if (!mentee || !mentor) { return; }
  ok(`приняты: ученик ${mentee.participant.externalId}, наставник ${mentor.participant.externalId}`);

  // 2. Наставник — это отдельный участник, назначенный на ученика.
  const assign = await call(
    'PATCH', `/admin/participants/${mentee.participant.id}`,
    { mentor_id: mentor.participant.id },
    arch.token,
  );
  if (assign.status === 200) { ok('наставник назначен'); }
  else { fail(`assign mentor → ${assign.status}: ${JSON.stringify(assign.data)}`); return; }

  // 3. Наставник входит своим временным паролем и видит уведомление.
  const mentorLogin = await call<{ access_token: string }>(
    'POST', '/auth/login',
    { phone: `+7999${suffix}2`, password: mentor.temporary_password },
  );
  if (mentorLogin.status !== 200) {
    fail(`login наставника → ${mentorLogin.status}: ${JSON.stringify(mentorLogin.data)}`);
  } else {
    const mentorNotes = await call<{ data: Note[] }>(
      'GET', '/notifications/history?page=1&per_page=50', undefined, mentorLogin.data.access_token,
    );
    const note = mentorNotes.data.data.find(
      (n) => n.type === 'mentor.assigned' && n.data?.participantId === mentee.participant.id,
    );
    if (note) { ok(`наставнику: «${note.title}»`); }
    else { fail('уведомления mentor.assigned нет'); }
  }

  // 4. Реестр наставников и карточка ученика.
  const mentors = await call<{ data: Array<{ mentorId: string; mentees: string[] }> }>(
    'GET', `/admin/mentors?direction_id=${dir.id}`, undefined, arch.token,
  );
  const row = mentors.data.data.find((m) => m.mentorId === mentor.participant.id);
  if (row && Array.isArray(row.mentees) && row.mentees.includes(mentee.participant.id)) {
    ok('ученик в реестре наставника');
  } else {
    fail('ученик не попал в реестр наставника');
  }

  const card = await call<{
    participant: { externalId: string };
    mentorId: string | null;
    tasks: { total: number };
    flows: number;
  }>('GET', `/admin/participants/${mentee.participant.id}/mentee-card`, undefined, arch.token);
  if (card.status === 200 && card.data.participant.externalId) {
    ok(`карточка ученика: наставник ${card.data.mentorId ? 'есть' : 'нет'}, задач ${card.data.tasks.total}, Поток ${card.data.flows}`);
  } else {
    fail(`mentee-card → ${card.status}`);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
