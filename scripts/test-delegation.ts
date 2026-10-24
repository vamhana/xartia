// scripts/test-delegation.ts
// Передача наряда в дочерние ячейки (5 × 5).
//
// Проверяем схему координации: наряд приходит на верхнюю ячейку, её
// координатор передаёт части двум дочерним, каждая раздаёт людям.
//
// Запуск: pnpm tsx scripts/test-delegation.ts <phone> <password>

import 'dotenv/config';

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
  console.log('▶ Передача наряда в дочерние ячейки\n');

  const login = await call<{ access_token: string }>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) { fail(`login → ${login.status}`); return; }
  const token = login.data.access_token;

  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  const suffix = String(Date.now()).slice(-5);

  const createCell = async (
    level: number, number: string, parentId?: string,
  ): Promise<string | null> => {
    const res = await call<{ id: string }>(
      'POST', '/cells',
      {
        level,
        number,
        direction_id: dir.id,
        ...(parentId ? { parent_cell_id: parentId } : {}),
      },
      token,
    );
    return res.status === 201 ? res.data.id : null;
  };

  // Уровни считаются от листьев вверх: у родителя уровень на 1 больше.
  const parentCell = await createCell(2, `P${suffix}`);
  if (!parentCell) { fail('не удалось создать верхнюю ячейку'); return; }
  const child1 = await createCell(1, `C1${suffix}`, parentCell);
  const child2 = await createCell(1, `C2${suffix}`, parentCell);
  if (!child1 || !child2) { fail('не удалось создать дочерние ячейки'); return; }
  ok('верхняя ячейка и две дочерние созданы');

  // Участник в первой дочерней ячейке — чтобы проверить распределение по людям.
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7995${suffix}1`,
    messengers: { telegram: `@deleg_${suffix}` },
    password: `DelegTest${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  const accepted = reg.status === 201
    ? await call<{ participant: { id: string } }>(
        'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
        { direction_id: dir.id, name: `Рабочий ${suffix}`, direction_number: 9 },
        token,
      )
    : null;
  const workerId = accepted?.data.participant.id ?? '';
  if (workerId) {
    await call('POST', `/cells/${child1}/members`, { participant_id: workerId }, token);
    ok('участник в дочерней ячейке');
  }

  const t1 = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Фундамент ${suffix}`, priority: 'standard' },
    token,
  );
  const t2 = await call<{ id: string }>(
    'POST', '/tasks',
    { direction_id: dir.id, description: `Стены ${suffix}`, priority: 'standard' },
    token,
  );
  if (t1.status !== 201 || t2.status !== 201) { fail('не удалось создать задачи'); return; }

  const date = today();
  const parentPlan = await call<{ planId: string | null }>(
    'POST', `/cells/${parentCell}/daily-plan`,
    { date, task_ids: [t1.data.id, t2.data.id] },
    token,
  );
  if (parentPlan.status === 201) { ok('наряд верхней ячейки составлен'); }
  else { fail(`parent plan → ${parentPlan.status}`); return; }

  const distribute = await call<{
    children: Array<{ cellNumber: string; tasks: Array<{ taskId: string }> }>;
  }>(
    'POST', `/cells/${parentCell}/daily-plan/distribute`,
    {
      date,
      assignments: [
        { child_cell_id: child1, task_ids: [t1.data.id] },
        { child_cell_id: child2, task_ids: [t2.data.id] },
      ],
    },
    token,
  );
  if (distribute.status === 201 && distribute.data.children.length === 2) {
    ok('наряд передан двум дочерним ячейкам');
  } else {
    fail(`distribute → ${distribute.status}: ${JSON.stringify(distribute.data)}`);
  }

  const child1Plan = distribute.data.children.find(
    (c) => c.tasks.some((t) => t.taskId === t1.data.id),
  );
  if (child1Plan) { ok(`задача попала в ячейку ${child1Plan.cellNumber}`); }
  else { fail('задача не попала в дочерний наряд'); }

  if (workerId && child1Plan) {
    const assign = await call(
      'POST', `/cells/${child1}/daily-plan/${t1.data.id}/assign`,
      { date, participant_id: workerId },
      token,
    );
    if (assign.status === 200) { ok('дочерняя ячейка распределила задачу человеку'); }
    else { fail(`assign в дочерней → ${assign.status}: ${JSON.stringify(assign.data)}`); }
  }

  const dup = await call(
    'POST', `/cells/${parentCell}/daily-plan/distribute`,
    {
      date,
      assignments: [{ child_cell_id: child1, task_ids: [t1.data.id] }],
    },
    token,
  );
  if (dup.status === 409) { ok('повторная передача той же задачи отклонена (409)'); }
  else { fail(`повторная передача → ${dup.status}`); }

  const tree = await call<{ parent: { tasks: unknown[] }; children: unknown[] }>(
    'GET', `/cells/${parentCell}/daily-plan/tree?date=${date}`, undefined, token,
  );
  if (tree.status === 200 && tree.data.children.length === 2) {
    ok('дерево наряда отдаёт обе дочерние ячейки');
  } else {
    fail(`tree → ${tree.status}`);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
