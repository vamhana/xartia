// scripts/test-questions.ts
// Очередь вопросов: автор ≠ отвечающий, SLA и эскалация.
//
// Запуск: pnpm tsx scripts/test-questions.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const t = token ?? TOKEN;
  if (t) {headers['Authorization'] = `Bearer ${t}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function main(): Promise<void> {
  console.log('▶ Вопросы наставнику: очередь, SLA, эскалация\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const me = login.data.participant;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === me.direction_id);
  if (!dir) {fail('направление не найдено'); return;}

  const suffix = String(Date.now()).slice(-6);
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7990${suffix}`,
    messengers: { telegram: `@q_${suffix}` },
    password: `Question${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) {fail(`register → ${reg.status}`); return;}
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Наставник ${suffix}`, direction_number: dir.number },
  );
  if (acc.status !== 201) {fail(`accept → ${acc.status}`); return;}
  const mentorId = acc.data.participant.id;

  const imp = await req<{ access_token: string }>('POST', `/dev/impersonate/${mentorId}`, {});
  const mentorToken = imp.data.access_token;

  // 1. Вопрос и запрет отвечать самому себе.
  const q1 = await req<{ id: string; status: string }>('POST', '/questions', {
    question: 'Не понимаю, как собрать AST для нового языка',
    mentor_id: mentorId,
  });
  if (q1.status === 201 && q1.data.status === 'open') {ok('Вопрос создан (open)');}
  else {fail(`create → ${q1.status}: ${JSON.stringify(q1.data)}`); return;}

  const selfAnswer = await req('POST', `/questions/${q1.data.id}/answer`, {
    answer: 'Отвечаю сам себе',
  });
  if (selfAnswer.status === 403) {ok('Нельзя отвечать на свой вопрос (403)');}
  else {fail(`self answer → ${selfAnswer.status}`);}

  // 2. Наставник отвечает.
  const answered = await req<{ status: string }>(
    'POST', `/questions/${q1.data.id}/answer`,
    { answer: 'Начни с токенов, потом рекурсивный спуск' }, mentorToken,
  );
  if (answered.status === 200 && answered.data.status === 'answered') {ok('Наставник ответил');}
  else {fail(`answer → ${answered.status}: ${JSON.stringify(answered.data)}`);}

  const again = await req('POST', `/questions/${q1.data.id}/answer`, { answer: 'Повтор' }, mentorToken);
  if (again.status === 409) {ok('Повторный ответ отклонён (409)');}
  else {fail(`repeat answer → ${again.status}`);}

  // 3. Просроченный вопрос эскалируется.
  const q2 = await req<{ id: string }>('POST', '/questions', {
    question: 'Как проверить, что лексер не теряет строки?',
    mentor_id: mentorId,
  });
  await query(
    `UPDATE mentor_questions SET created_at = now() - interval '6 hours' WHERE id = $1`,
    [q2.data.id],
  );
  const esc = await req<{ status: string }>('POST', `/questions/${q2.data.id}/escalate`, {}, mentorToken);
  if (esc.status === 200 && esc.data.status === 'escalated') {ok('Просроченный вопрос эскалирован');}
  else {fail(`escalate → ${esc.status}: ${JSON.stringify(esc.data)}`);}

  const sla = await req<{ overdue: number; escalated: number }>('GET', '/questions/sla');
  if (sla.status === 200 && sla.data.overdue >= 1 && sla.data.escalated >= 1) {
    ok(`SLA: просрочено ${sla.data.overdue}, эскалировано ${sla.data.escalated}`);
  } else {
    fail(`sla → ${sla.status}: ${JSON.stringify(sla.data)}`);
  }

  // 4. Валидация и список «мои вопросы».
  const short = await req('POST', '/questions', { question: 'мало' });
  if (short.status === 422 || short.status === 400) {ok('Слишком короткий вопрос отклонён');}
  else {fail(`short → ${short.status}`);}

  const mine = await req<{ data: Array<{ id: string }> }>('GET', '/questions?mine=true');
  if (mine.status === 200 && mine.data.data.some((q) => q.id === q1.data.id)) {
    ok('Список «мои вопросы» содержит вопрос');
  } else {
    fail(`mine → ${mine.status}`);
  }

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
