// I.9.04.78 — Версии дневного плана направления + §7.5 (учитель не принимает
// результат ученика).
//
// Запуск: pnpm tsx scripts/test-daily-plan-versions.ts <phone> <password>
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { login, ensureActor } from './lib/passport-fixtures.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN = randomUUID();
const MARK = `I.9.04.78:${RUN}`;
const DATE = new Date().toISOString().slice(0, 10);
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
function check(c: unknown, m: string): void {
  if (c) { ok++; console.log(`  ✓ ${m}`); }
  else { fail++; console.log(`  ✗ ${m}`); }
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') {throw new Error('refuse prod');}
  const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'];
  const pass = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];
  if (!phone || !pass) {throw new Error('usage: <phone> <password>');}

  const admin = await login(phone, pass);
  TOKEN = admin.token;

  const adminRow = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [admin.id],
  );
  if (!adminRow?.direction_id) {throw new Error('у FA нет direction_id');}
  const dirId = adminRow.direction_id;

  // Очистка от прошлого прогона (порядок: версии каскадно через daily_plans).
  await query(
    `DELETE FROM daily_plans WHERE direction_id = $1 AND date = $2::date`,
    [dirId, DATE],
  );

  // План + 3 задачи.
  const plan = await req('POST', '/plans', {
    type: 'standard',
    title: `${MARK} dp`,
    expected_result: 'daily plan',
    lead_direction_id: dirId,
    criteria: {},
  });
  const planId = (plan.data as { id: string }).id;
  await req('POST', `/plans/${planId}/approve`, {});
  await req('POST', `/plans/${planId}/activate`, {});

  const mk = async (desc: string) => {
    const t = await req('POST', '/tasks', {
      direction_id: dirId, plan_id: planId,
      description: `${MARK} ${desc}`, priority: 'standard',
      kind: 'deliverable', expected_result: 'r',
    });
    return (t.data as { id: string }).id;
  };
  const t1 = await mk('t1');
  const t2 = await mk('t2');
  const t3 = await mk('t3');

  // ─── 1. Первый upsert: v1 (пустой), v2 (2 задачи) ─────────────
  {
    const r = await req('POST', '/daily-plans', {
      direction_id: dirId, date: DATE, task_ids: [t1, t2],
    });
    check(r.status === 201, `первый POST /daily-plans → 201 (факт: ${r.status})`);

    const v = await query<{ version: number; snapshot: { tasks: unknown[] } }>(
      `SELECT v.version, v.snapshot FROM daily_plan_versions v
         JOIN daily_plans p ON p.id = v.daily_plan_id
        WHERE p.direction_id = $1 AND p.date = $2::date
        ORDER BY v.version`,
      [dirId, DATE],
    );
    check(v.length === 2, `2 версии после первого upsert (факт: ${v.length})`);
    check(v[0]?.snapshot.tasks.length === 0, 'v1 — пустой');
    check(v[1]?.snapshot.tasks.length === 2, 'v2 — 2 задачи');
  }

  // ─── 2. Второй upsert: v3, v4 ────────────────────────────────
  {
    const r = await req('POST', '/daily-plans', {
      direction_id: dirId, date: DATE, task_ids: [t3],
    });
    check(r.status === 201, `второй POST /daily-plans → 201 (факт: ${r.status})`);

    const v = await query<{ version: number; snapshot: { tasks: unknown[] } }>(
      `SELECT v.version, v.snapshot FROM daily_plan_versions v
         JOIN daily_plans p ON p.id = v.daily_plan_id
        WHERE p.direction_id = $1 AND p.date = $2::date
        ORDER BY v.version`,
      [dirId, DATE],
    );
    check(v.length === 4, `4 версии после второго upsert (факт: ${v.length})`);
    check(v[2]?.snapshot.tasks.length === 2, 'v3 — 2 задачи (до изменения)');
    check(v[3]?.snapshot.tasks.length === 1, 'v4 — 1 задача (после изменения)');
  }

  // ─── 3. remove task → v5, v6 ──────────────────────────────────
  {
    const dp = await queryOne<{ id: string }>(
      `SELECT id FROM daily_plans WHERE direction_id = $1 AND date = $2::date`,
      [dirId, DATE],
    );
    if (!dp) {throw new Error('дневной план не найден');}

    const r = await req('DELETE', `/daily-plans/${dp.id}/tasks/${t3}`);
    check(r.status === 204, `DELETE задачи из daily-plans → 204 (факт: ${r.status})`);

    const v = await query<{ version: number; snapshot: { tasks: unknown[] } }>(
      `SELECT v.version, v.snapshot FROM daily_plan_versions v
         JOIN daily_plans p ON p.id = v.daily_plan_id
        WHERE p.direction_id = $1 AND p.date = $2::date
        ORDER BY v.version`,
      [dirId, DATE],
    );
    check(v.length === 6, `6 версий после удаления (факт: ${v.length})`);
    check(v[4]?.snapshot.tasks.length === 1, 'v5 — 1 задача (до удаления)');
    check(v[5]?.snapshot.tasks.length === 0, 'v6 — 0 задач (после удаления)');
  }

  // ─── 4. GET /daily-plans/versions ─────────────────────────────
  {
    const r = await req('GET',
      `/daily-plans/versions?direction_id=${dirId}&date=${DATE}`);
    check(r.status === 200, `GET /daily-plans/versions → 200 (факт: ${r.status})`);
    const data = (r.data as { data: Array<{ version: number }> }).data;
    check(data.length === 6, `6 версий в ответе (факт: ${data.length})`);
    const desc = data.every((v, i) => i === 0 || data[i - 1]!.version > v.version);
    check(desc, 'версии по убыванию');
  }

  // ─── 5. §7.5: учитель не принимает результат ученика ─────────
  {
    const learner = await ensureActor(admin.token, {
      name: `v9 learner ${RUN.slice(0, 6)}`,
    });
    await query(
      `UPDATE participants SET direction_id = $1, updated_at = now() WHERE id = $2`,
      [dirId, learner.id],
    );

    const atom = await queryOne<{ atom_id: string }>(
      `SELECT atom_id FROM competency_atoms
        WHERE dimension_applicability->'P'->>'applicable' = 'true'
        ORDER BY atom_id LIMIT 1`,
    );
    if (!atom) {throw new Error('нет атома с P applicable');}
    for (const [dim, level] of [['P', 7], ['X', 5], ['E', 5]] as const) {
      await query(
        `INSERT INTO person_atom_states
           (participant_id, atom_id, dimension, level, status)
         VALUES ($1, $2, $3, $4, 'confirmed')
         ON CONFLICT (participant_id, atom_id, dimension)
         DO UPDATE SET level = EXCLUDED.level, status = 'confirmed'`,
        [admin.id, atom.atom_id, dim, level],
      );
    }

    const src = await mk('src');
    const lrn = await mk('lrn');
    await req('POST', `/tasks/${src}/assign`, { participant_id: admin.id });
    await req('POST', `/tasks/${lrn}/assign`, { participant_id: learner.id });

    const p = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: learner.id,
      source_task_id: src, learner_task_id: lrn,
      competency_atom_id: atom.atom_id,
      expected_learning_result: 'test learning result',
    });
    check(p.status === 201, `create practice → 201 (факт: ${p.status})`);
    const practiceId = (p.data as { id: string }).id;

    const savedT = TOKEN;
    try {
      TOKEN = learner.token;
      await req('POST', `/learning/task-practices/${practiceId}/consent`, {});
    } finally {
      TOKEN = savedT;
    }

    const pAfter = await req('GET', `/learning/task-practices/${practiceId}`);
    check((pAfter.data as { status?: string }).status === 'active',
      'практика active');

    // Отчёт с артефактом + submit от learner.
    await query(
      `INSERT INTO reports (task_id, participant_id, type, comment, artifact_url)
       VALUES ($1, $2, 'text', 'test artifact', $3)`,
      [lrn, learner.id, 'https://example.com/test-artifact-1'],
    );
    try {
      TOKEN = learner.token;
      // Задача в assigned → нужен take перед submit.
      // ALLOWED_TRANSITIONS: assigned → in_progress (take) → submitted (submit).
      const take = await req('POST', `/tasks/${lrn}/take`, {});
      check(take.status === 200, `take от learner → 200 (факт: ${take.status})`);

      const sub = await req('POST', `/tasks/${lrn}/submit`, {});
      check(sub.status === 200, `submit от learner → 200 (факт: ${sub.status})`);
    } finally {
      TOKEN = savedT;
    }

    // FA (учитель) пытается принять задачу ученика → 403.
    const acc = await req('POST', `/tasks/${lrn}/accept`, {});
    check(acc.status === 403,
      `accept ученика учителем → 403 (факт: ${acc.status})`);
    const msg = (acc.data as { message?: string }).message ?? '';
    check(msg.includes('§7.5') || msg.includes('учитель'),
      'сообщение про §7.5');
  }

  console.log(`\n── Итог: ${ok}/${ok + fail} ok, ${fail} fail ──`);
  if (fail > 0) {process.exitCode = 1;}

  // cleanup: daily_plans каскадно удалит daily_plan_tasks и daily_plan_versions;
  // tasks удалим отдельно, кроме тех, у кого есть profile (нет ни у одной).
  await query(
    `DELETE FROM daily_plans WHERE direction_id = $1 AND date = $2::date`,
    [dirId, DATE],
  );
  await query(
    `DELETE FROM tasks WHERE plan_id = $1
       AND id NOT IN (SELECT task_id FROM task_profiles)`,
    [planId],
  );
  await query(`DELETE FROM plan_versions WHERE plan_id = $1`, [planId]);
  await query(`DELETE FROM plans WHERE id = $1`, [planId]);
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(async () => { await gracefulShutdown(); });