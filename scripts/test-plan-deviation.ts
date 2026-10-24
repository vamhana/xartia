// scripts/test-plan-deviation.ts
// Отклонения плана и сигнал от балансировки.
//
// Сценарий: план взят в работу, у задач истёк срок → балансировка видит
// отклонение и поднимает сигнал направлению (не решает за него). Повторный
// сигнал по тому же плану не создаётся.
//
// Запуск: pnpm tsx scripts/test-plan-deviation.ts <phone> <password>

import 'dotenv/config';

import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

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
  console.log('▶ Отклонения плана → сигнал балансировки\n');

  const login = await call<{ access_token: string }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  // Чекпоинт в прошлом: к этой дате задачи должны были быть закрыты.
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  const plan = await call<{ id: string; externalId: string }>(
    'POST', '/plans',
    {
      type: 'standard',
      title: `Проверка отклонений ${Date.now().toString().slice(-5)}`,
      expected_result: 'План выполнен в срок',
      lead_direction_id: dir.id,
      checkpoints: [{ at: past, description: 'Первый этап' }],
    },
    token,
  );
  if (plan.status !== 201) { fail(`create plan → ${plan.status}: ${JSON.stringify(plan.data)}`); return; }
  ok(`план ${plan.data.externalId}`);

  const appr = await call('POST', `/plans/${plan.data.id}/approve`, {}, token);
  const act = await call('POST', `/plans/${plan.data.id}/activate`, {}, token);
  if (appr.status !== 200 || act.status !== 200) {
    fail(`approve/activate → ${appr.status}/${act.status}`);
    return;
  }

  // Две задачи; у одной срок в прошлом (искусственно, иначе срок всегда в будущем).
  const t1 = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, plan_id: plan.data.id, description: 'Задача с просрочкой', priority: 'standard' },
    token,
  );
  const t2 = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, plan_id: plan.data.id, description: 'Задача в работе', priority: 'standard' },
    token,
  );
  if (t1.status !== 201 || t2.status !== 201) { fail('не удалось создать задачи'); return; }

  await query(
    `UPDATE tasks SET deadline = now() - interval '1 day' WHERE id = $1`,
    [t1.data.id],
  );
  ok('у задачи истёк срок');

  const dev = await call<{ status: string; overdue: number; total: number }>(
    'GET', `/plans/${plan.data.id}/deviation`, undefined, token,
  );
  if (dev.status === 200 && dev.data.status === 'behind' && dev.data.overdue >= 1) {
    ok(`план отстаёт: просрочено ${dev.data.overdue} из ${dev.data.total}`);
  } else {
    fail(`deviation: status=${dev.data.status}, overdue=${dev.data.overdue}`);
  }

  const list = await call<{ data: Array<{ planId: string; status: string }> }>(
    'GET', '/plans/deviations?only_behind=true', undefined, token,
  );
  if (list.data.data.some((d) => d.planId === plan.data.id)) {
    ok('план в списке отклонений');
  } else {
    fail('план не попал в список отклонений');
  }

  const sig = await call<{ id: string; externalId: string; description: string }>(
    'POST', `/plans/${plan.data.id}/deviation/signal`, {}, token,
  );
  if (sig.status === 201 && sig.data.description.includes(`[план:${plan.data.id}]`)) {
    ok(`сигнал ${sig.data.externalId} поднят`);
  } else {
    fail(`signal → ${sig.status}: ${JSON.stringify(sig.data)}`);
  }

  const dup = await call('POST', `/plans/${plan.data.id}/deviation/signal`, {}, token);
  if (dup.status === 409) { ok('повторный сигнал не создан (409)'); }
  else { fail(`повторный сигнал → ${dup.status}`); }

  // Быстрее графика: план, где задачи уже приняты, а срок ещё не вышел.
  // Балансировка должна заметить и это — чтобы направление перенесло опыт
  // на отстающие участки.
  const fastPlan = await call<{ id: string; externalId: string }>(
    'POST', '/plans',
    {
      type: 'standard',
      title: `Быстрый план ${Date.now().toString().slice(-5)}`,
      expected_result: 'Проверка опережения',
      lead_direction_id: dir.id,
    },
    token,
  );
  if (fastPlan.status !== 201) { fail(`fast plan → ${fastPlan.status}`); return; }
  await call('POST', `/plans/${fastPlan.data.id}/approve`, {}, token);
  await call('POST', `/plans/${fastPlan.data.id}/activate`, {}, token);
  const fastTask = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, plan_id: fastPlan.data.id, description: 'Сделано досрочно', priority: 'standard' },
    token,
  );
  if (fastTask.status === 201) {
    await query(`UPDATE tasks SET status = 'accepted' WHERE id = $1`, [fastTask.data.id]);
    const devFast = await call<{ status: string; done: number }>(
      'GET', `/plans/${fastPlan.data.id}/deviation`, undefined, token,
    );
    if (devFast.data.status === 'ahead') { ok('опережение распознано (ahead)'); }
    else { fail(`ожидали ahead, получили ${devFast.data.status}`); }

    const fastSig = await call<{ externalId: string }>(
      'POST', `/plans/${fastPlan.data.id}/deviation/signal`, {}, token,
    );
    if (fastSig.status === 201) { ok(`сигнал об опережении ${fastSig.data.externalId}`); }
    else { fail(`сигнал об опережении → ${fastSig.status}`); }
  } else {
    fail(`fast task → ${fastTask.status}`);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
