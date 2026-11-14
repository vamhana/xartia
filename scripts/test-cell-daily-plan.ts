// I.9.04.75 — Наряд ячейки: версии, координатор, переназначение, пакеты.
// Запуск: pnpm tsx scripts/test-cell-daily-plan.ts <phone> <password>
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN = randomUUID();
const MARK = `I.9.04.75:${RUN}`;

let TOKEN = '';
async function req(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as Record<string, unknown> };
}

let ok = 0, fail = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { ok++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') {throw new Error('refuse prod');}
  const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'];
  const pass = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];
  if (!phone || !pass) {throw new Error('usage: <phone> <password>');}

  const login = await req('POST', '/auth/login', { phone, password: pass });
  if (login.status !== 200) {throw new Error('login failed');}
  TOKEN = (login.data as { access_token: string }).access_token;
  const me = (login.data as { participant: { id: string; direction_id: string } }).participant;

  // Найдём активное направление и создадим тестовую ячейку.
  const dir = await queryOne<{ id: string }>(
    `SELECT id FROM directions WHERE status = 'active' AND id = $1 LIMIT 1`,
    [me.direction_id],
  );
  if (!dir) {throw new Error('нет активного направления');}

  // Создаём ячейку уровня 0.
  const num = `T${RUN.slice(0, 6)}`;
  const cellRes = await req('POST', '/cells', {
    level: 0, number: num, direction_id: dir.id,
  });
  check(cellRes.status === 201, 'POST /cells → 201');
  const cellId = (cellRes.data as { id: string }).id;

  // ─── Негатив (2.6): пока FA ни в одной ячейке ─────────────────────
  // Проверка самоповышения — ПЕРВАЯ в addMemberService, поэтому
  // требование «participant не в другой ячейке» (409) ещё не срабатывает:
  // без этого блока FA уже состоял бы в cellId и получал бы 409, а не 403.
  {
    const cell2Res = await req('POST', '/cells', {
      level: 0, number: `X${RUN.slice(0, 6)}`, direction_id: dir.id,
    });
    check(cell2Res.status === 201, 'вторая ячейка для негатива → 201');
    const cell2 = (cell2Res.data as { id: string }).id;

    // Попытка сделать себя coordinator → 403 (проверка в начале addMemberService).
    const selfPromote = await req('POST', `/cells/${cell2}/members`, {
      participant_id: me.id, role_in_cell: 'coordinator',
    });
    check(selfPromote.status === 403,
      'самоповышение coordinator → 403 (первая проверка)');

    // Попытка сделать себя member → 201 (разрешено, роль не повышена).
    const selfMember = await req('POST', `/cells/${cell2}/members`, {
      participant_id: me.id, role_in_cell: 'member',
    });
    check(selfMember.status === 201,
      'самодобавление как member → 201 (не повышенная роль)');

    // Освобождаем участника — теперь можно добавить в cellId.
    await query(`DELETE FROM cell_members WHERE cell_id = $1`, [cell2]);
    await query(`DELETE FROM cells WHERE id = $1`, [cell2]);
  }

  // ─── Позитив: FA как member в первую ячейку ──────────────────────
  const addMe = await req('POST', `/cells/${cellId}/members`, {
    participant_id: me.id, role_in_cell: 'member',
  });
  check(addMe.status === 201,
    'добавление Архитектора как member (FA — системный гарант, isCellCoordinatorOrArchitect)');

  // Создаём план.
  const plan = await req('POST', '/plans', {
    type: 'standard',
    title: `${MARK} план`,
    expected_result: 'наряд',
    lead_direction_id: dir.id,
    criteria: {},
  });
  check(plan.status === 201, 'POST /plans → 201');
  const planId = (plan.data as { id: string }).id;
  await req('POST', `/plans/${planId}/approve`, {});
  await req('POST', `/plans/${planId}/activate`, {});

  // Создаём задачу-deliverable и задачу-package.
  const t1 = await req('POST', '/tasks', {
    direction_id: dir.id, plan_id: planId,
    description: `${MARK} deliverable 1`,
    priority: 'standard',
    kind: 'deliverable', expected_result: 'результат',
  });
  check(t1.status === 201, 'POST deliverable');
  const task1 = (t1.data as { id: string }).id;

  const t2 = await req('POST', '/tasks', {
    direction_id: dir.id, plan_id: planId,
    description: `${MARK} deliverable 2`,
    priority: 'standard',
    kind: 'deliverable', expected_result: 'результат',
  });
  const task2 = (t2.data as { id: string }).id;

  const tPkg = await req('POST', '/tasks', {
    direction_id: dir.id, plan_id: planId,
    description: `${MARK} package`,
    priority: 'standard', kind: 'package',
  });
  check(tPkg.status === 201, 'POST package');
  const packageTask = (tPkg.data as { id: string }).id;

  const today = new Date().toISOString().slice(0, 10);

  // upsert с package → 409.
  const badUpsert = await req('POST', `/cells/${cellId}/daily-plan`, {
    date: today, task_ids: [task1, packageTask],
  });
  check(badUpsert.status === 409, 'upsert с package → 409');

  // upsert с двумя deliverable.
  const up1 = await req('POST', `/cells/${cellId}/daily-plan`, {
    date: today, task_ids: [task1, task2],
  });
  check(up1.status === 201, 'upsert наряд (2 задачи) → 201');

  // Версии: должно быть 2 (пустой + сформированный).
  const ver1 = await query<{ version: number; snapshot: { tasks: unknown[] } }>(
    `SELECT v.version, v.snapshot
       FROM cell_daily_plan_versions v
       JOIN cell_daily_plans p ON p.id = v.plan_id
      WHERE p.cell_id = $1 AND p.date = $2::date
      ORDER BY v.version`,
    [cellId, today],
  );
  check(ver1.length === 2, '2 версии после upsert');
  check(ver1[0]?.snapshot.tasks.length === 0, 'v1 — пустой');
  check(ver1[1]?.snapshot.tasks.length === 2, 'v2 — 2 задачи');

  // Переназначение: assignCellDailyTask на другого участника (создадим).
  // Создаём второго участника — но регистрация — долгий процесс.
  // Используем существующего: другого Архитектора нет, но можно того же.
  // Для теста переназначения достаточно того же участника, но статус задачи
  // должен быть assigned. Сейчас task1.created → assignCellDailyTask
  // переведёт в assigned.
  const assign1 = await req('POST', `/cells/${cellId}/daily-plan/${task1}/assign`, {
    date: today, participant_id: me.id,
  });
  check(assign1.status === 200, 'назначение координатором → 200');

  // Статус задачи — assigned.
  const t1row = await queryOne<{ status: string; assigned_by: string }>(
    `SELECT status, assigned_by FROM tasks WHERE id = $1`,
    [task1],
  );
  check(t1row?.status === 'assigned', 'tasks.status = assigned');
  check(t1row?.assigned_by === me.id, 'tasks.assigned_by = coordinator');

  // Версий теперь должно быть 3 (v1 пустой, v2 наряд, v3 назначение).
  const ver2 = await query<{ version: number }>(
    `SELECT version FROM cell_daily_plan_versions
      WHERE plan_id = (SELECT id FROM cell_daily_plans WHERE cell_id = $1 AND date = $2::date)
      ORDER BY version`,
    [cellId, today],
  );
  check(ver2.length === 3, '3 версии после назначения');

  // Попытка assign пакета → 409.
  const assignPkg = await req('POST', `/cells/${cellId}/daily-plan/${packageTask}/assign`, {
    date: today, participant_id: me.id,
  });
  check(assignPkg.status === 404 || assignPkg.status === 409,
    'назначение package → 404/409');

  // listCellPlanCandidates не содержит package.
  const cands = await req('GET', `/cells/${cellId}/daily-plan/candidates`);
  const list = (cands.data as { data: Array<{ id: string }> }).data ?? [];
  check(!list.some((c) => c.id === packageTask), 'candidates без package');

  console.log(`\n── Итог: ${ok}/${ok + fail} ok, ${fail} fail ──`);
  if (fail > 0) {process.exitCode = 1;}

  // cleanup — удалим план (каскад), ячейку, участников.
  // Задачи с профилями не удаляем — task_profiles_history append-only
  // (триггер запрещает DELETE). Оставляем мусор в dev-БД, но триггер цел.
  await query(
    `DELETE FROM tasks
      WHERE plan_id = $1
        AND id NOT IN (SELECT task_id FROM task_profiles)`,
    [planId],
  );
  await query(`DELETE FROM plan_versions WHERE plan_id = $1`, [planId]);
  await query(`DELETE FROM plans WHERE id = $1`, [planId]);
  await query(`DELETE FROM cell_members WHERE cell_id = $1`, [cellId]);
  await query(`DELETE FROM cells WHERE id = $1`, [cellId]);
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(async () => { await gracefulShutdown(); });