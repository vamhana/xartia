// scripts/test-signal-plan.ts
// Путь сигнала: сигнал → план → куратор → задачи → прогресс.
//
// Проверяем, что решение не «повисает»: план связан с сигналом, у плана есть
// человек-куратор, а прогресс по задачам виден из самого сигнала.
//
// Запуск: pnpm tsx scripts/test-signal-plan.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

interface Note {
  type: string;
  data?: { signalId?: string; planId?: string };
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

async function main(): Promise<void> {
  console.log('▶ Путь сигнала: сигнал → план → куратор → прогресс\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;
  const me = login.data.participant.id;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  // 1. Сигнал: «есть наработки, предлагаю сделать игру».
  const sig = await call<{ id: string; externalId: string }>(
    'POST', '/signals',
    {
      type: 'idea',
      description: 'Есть опыт игр и наработки — предлагаю сделать игру, которая приносит деньги',
      justification: 'Внешний продукт даёт Шлюзу доход и опыт команде',
      priority: 'high',
      directions: [dir.id],
      lead_direction_id: dir.id,
    },
    token,
  );
  if (sig.status !== 201) { fail(`create signal → ${sig.status}: ${JSON.stringify(sig.data)}`); return; }
  ok(`сигнал ${sig.data.externalId}`);

  // 2. План, выросший из сигнала, с куратором-человеком.
  const plan = await call<{ id: string; signalId: string | null; curatorId: string | null }>(
    'POST', '/plans',
    {
      type: 'standard',
      title: 'Игра, которая приносит деньги',
      expected_result: 'Игра выпущена, первые продажи через Шлюз',
      lead_direction_id: dir.id,
      signal_id: sig.data.id,
      curator_id: me,
    },
    token,
  );
  if (plan.status !== 201) { fail(`create plan → ${plan.status}: ${JSON.stringify(plan.data)}`); return; }
  ok(`план ${plan.data.id.slice(0, 8)} создан`);
  if (plan.data.signalId === sig.data.id) { ok('план связан с сигналом'); }
  else { fail('plan.signalId не совпадает с сигналом'); }
  if (plan.data.curatorId === me) { ok('куратор назначен'); }
  else { fail('plan.curatorId не сохранён'); }

  // 3. Обратный путь: сигнал отдаёт план.
  const detail = await call<{
    plan: { id: string; progress: { total: number; done: number } | null } | null;
  }>('GET', `/signals/${sig.data.id}`, undefined, token);
  if (detail.data.plan?.id === plan.data.id) { ok('из сигнала виден план'); }
  else { fail('сигнал не отдаёт план'); }

  // 4. Фильтр планов по сигналу.
  const bySignal = await call<{ data: Array<{ id: string }> }>(
    'GET', `/plans?signal_id=${sig.data.id}`, undefined, token,
  );
  if (bySignal.data.data.some((p) => p.id === plan.data.id)) { ok('GET /plans?signal_id работает'); }
  else { fail('план не найден по signal_id'); }

  // 5. Уведомления: куратору и автору сигнала.
  const notes = await call<{ data: Note[] }>(
    'GET', '/notifications/history?page=1&per_page=50', undefined, token,
  );
  const curatorNote = notes.data.data.find(
    (n) => n.type === 'plan.curator_assigned' && n.data?.planId === plan.data.id,
  );
  if (curatorNote) { ok('куратор получил уведомление'); }
  else { fail('нет уведомления plan.curator_assigned'); }
  const authorNote = notes.data.data.find(
    (n) => n.type === 'plan.created_from_signal' && n.data?.signalId === sig.data.id,
  );
  if (authorNote) { ok('автор сигнала получил уведомление'); }
  else { fail('нет уведомления plan.created_from_signal'); }

  // 6. Задачи плана и прогресс в сигнале.
  const approve = await call('POST', `/plans/${plan.data.id}/approve`, {}, token);
  const activate = await call('POST', `/plans/${plan.data.id}/activate`, {}, token);
  if (approve.status === 200 && activate.status === 200) { ok('план утверждён и активен'); }
  else { fail(`approve/activate → ${approve.status}/${activate.status}`); }

  const task = await call<{ id: string }>(
    'POST', '/tasks',
    {
      direction_id: dir.id,
      plan_id: plan.data.id,
      description: 'Прототип игрового цикла',
      priority: 'standard',
    },
    token,
  );
  if (task.status === 201) { ok('задача добавлена в план'); }
  else { fail(`create task → ${task.status}: ${JSON.stringify(task.data)}`); }

  const after = await call<{
    plan: { progress: { total: number } | null } | null;
  }>('GET', `/signals/${sig.data.id}`, undefined, token);
  const total = after.data.plan?.progress?.total ?? 0;
  if (total >= 1) { ok(`прогресс виден из сигнала: задач ${total}`); }
  else { fail(`прогресс не отражён (total=${total})`); }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
