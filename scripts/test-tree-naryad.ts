// scripts/test-tree-naryad.ts
// Дерево работ и наряд ячейки.
//
// 1. План отдаётся деревом: дом → работы → люди (можно раскрыть до Ивана).
// 2. Наряд приходит на ячейку: координатор составляет его и распределяет
//    задачи по участникам ячейки; чужому назначить нельзя.
//
// Запуск: pnpm tsx scripts/test-tree-naryad.ts <phone> <password>

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log('▶ Дерево работ и наряд ячейки\n');

  const login = await call<{ access_token: string; participant: { id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;
  const archId = login.data.participant.id;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  const suffix = String(Date.now()).slice(-5);

  // ── 1. Дерево: план → дом → работа ───────────────────────────────
  const plan = await call<{ id: string; externalId: string }>(
    'POST', '/plans',
    {
      type: 'standard',
      title: `Микрорайон ${suffix}`,
      expected_result: 'Дома сданы',
      lead_direction_id: dir.id,
    },
    token,
  );
  if (plan.status !== 201) { fail(`plan → ${plan.status}`); return; }

  const house = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, plan_id: plan.data.id, description: `Дом ${suffix}`, priority: 'standard' },
    token,
  );
  const work = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Фундамент ${suffix}`, priority: 'standard' },
    token,
  );
  if (house.status !== 201 || work.status !== 201) { fail('не удалось создать задачи'); return; }
  await query(`UPDATE tasks SET parent_task_id = $1 WHERE id = $2`, [house.data.id, work.data.id]);

  const tree = await call<{
    roots: Array<{ externalId: string; children: Array<{ externalId: string }>; total: number }>;
    total: number;
  }>('GET', `/plans/${plan.data.id}/tree`, undefined, token);
  if (tree.status === 200 && tree.data.roots.length === 1) {
    ok(`корень 1, у него работ: ${tree.data.roots[0]?.children.length ?? 0}`);
  } else {
    fail(`tree → ${tree.status}: ${JSON.stringify(tree.data)}`);
  }
  if (tree.data.total >= 2) { ok(`всего в дереве: ${tree.data.total}`); }
  else { fail(`в дереве ${tree.data.total} узлов, ожидали ≥2`); }

  // ── 2. Наряд ячейки ──────────────────────────────────────────────
  const cell = await call<{ id: string }>(
    'POST', '/cells',
    { level: 1, number: `T${suffix}`, direction_id: dir.id, profile: 'test' },
    token,
  );
  if (cell.status !== 201) { fail(`cell → ${cell.status}: ${JSON.stringify(cell.data)}`); return; }
  const cellId = cell.data.id;

  // Свежий участник: Архитектор уже может состоять в другой ячейке,
  // а участник входит только в одну — берём нового.
  const workerPhone = `+7997${suffix}1`;
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone: workerPhone,
    messengers: { telegram: `@worker_${suffix}` },
    password: `WorkerTest${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) { fail(`регистрация участника → ${reg.status}`); return; }
  const accepted = await call<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Рабочий ${suffix}`, direction_number: 9 },
    token,
  );
  if (accepted.status !== 201) { fail(`приём участника → ${accepted.status}`); return; }
  const workerId = accepted.data.participant.id;

  const addMember = await call(
    'POST', `/cells/${cellId}/members`, { participant_id: workerId }, token,
  );
  if (addMember.status === 201 || addMember.status === 200) { ok('участник в ячейке'); }
  else { fail(`member → ${addMember.status}: ${JSON.stringify(addMember.data)}`); }

  const naryadTask = await call<{ id: string; externalId: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Работа наряда ${suffix}`, priority: 'standard' },
    token,
  );
  if (naryadTask.status !== 201) { fail('не удалось создать задачу наряда'); return; }

  const date = today();
  const naryad = await call<{ planId: string | null; tasks: Array<{ taskId: string }> }>(
    'POST', `/cells/${cellId}/daily-plan`,
    { date, task_ids: [naryadTask.data.id] },
    token,
  );
  if (naryad.status === 201 && naryad.data.planId) { ok('наряд составлен'); }
  else { fail(`naryad → ${naryad.status}: ${JSON.stringify(naryad.data)}`); return; }

  const assign = await call<{ tasks: Array<{ assignedTo: string | null; assignedName: string | null }> }>(
    'POST', `/cells/${cellId}/daily-plan/${naryadTask.data.id}/assign`,
    { date, participant_id: workerId },
    token,
  );
  const assigned = assign.data.tasks?.find((t) => t.assignedTo === workerId);
  if (assign.status === 200 && assigned) {
    ok(`задача назначена: ${assigned.assignedName ?? workerId.slice(0, 8)}`);
  } else {
    fail(`assign → ${assign.status}: ${JSON.stringify(assign.data)}`);
  }

  // Чужому (не участнику ячейки) назначать нельзя.
  const outsider = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Чужая работа ${suffix}`, priority: 'standard' },
    token,
  );
  if (outsider.status === 201) {
    await call('POST', `/cells/${cellId}/daily-plan`, {
      date,
      task_ids: [naryadTask.data.id, outsider.data.id],
    }, token);
    const bad = await call(
      'POST', `/cells/${cellId}/daily-plan/${outsider.data.id}/assign`,
      { date, participant_id: archId },
      token,
    );
    if (bad.status === 403) { ok('чужому назначить нельзя (403)'); }
    else { fail(`назначение чужому → ${bad.status}`); }
  }

  const view = await call<{ tasks: Array<{ taskId: string }> }>(
    'GET', `/cells/${cellId}/daily-plan?date=${date}`, undefined, token,
  );
  if (view.data.tasks.some((t) => t.taskId === naryadTask.data.id)) {
    ok('наряд читается на дату');
  } else {
    fail('наряд не отдаёт задачи');
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
