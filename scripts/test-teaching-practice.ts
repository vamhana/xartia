// I.9.09.43 — TeachingPracticeLink: полный цикл + негативы.
//
// Запуск: pnpm tsx scripts/test-teaching-practice.ts <phone> <password>
//
// Требует второго участника (ученика) — создаётся через ensureActor.
// Перед тестом учителю (FA) выставляется предметная readiness
// (P=7, X=5, E=5, confirmed) на тестовом атоме — прямой SQL, потому что
// API для assessment существует, но требует отдельного assessor-flow.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { login, ensureActor } from './lib/passport-fixtures.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN = randomUUID();
const MARK = `I.9.09.43:${RUN}`;
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

async function makeDeliverable(
  directionId: string,
  planId: string,
  description: string,
  assignTo: string,
): Promise<{ id: string; externalId: string }> {
  const t = await req('POST', '/tasks', {
    direction_id: directionId, plan_id: planId,
    description, priority: 'standard', kind: 'deliverable',
    expected_result: 'r',
  });
  if (t.status !== 201) {throw new Error(`create task → ${t.status} ${JSON.stringify(t.data)}`);}
  const taskId = (t.data as { id: string }).id;
  const a = await req('POST', `/tasks/${taskId}/assign`, { participant_id: assignTo });
  if (a.status !== 200) {throw new Error(`assign task → ${a.status} ${JSON.stringify(a.data)}`);}
  return { id: taskId, externalId: (t.data as { externalId: string }).externalId };
}

async function main() {
  if (process.env['NODE_ENV'] === 'production') {throw new Error('refuse prod');}
  const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'];
  const pass = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];
  if (!phone || !pass) {throw new Error('usage: <phone> <password>');}

  // login возвращает { token, id }, без direction_id — берём направление из БД.
  const admin = await login(phone, pass);
  TOKEN = admin.token;

  const adminRow = await queryOne<{ direction_id: string | null }>(
    `SELECT direction_id FROM participants WHERE id = $1 AND deleted_at IS NULL`,
    [admin.id],
  );
  if (!adminRow?.direction_id) {
    throw new Error(`у FA ${admin.id} нет direction_id в БД`);
  }
  const dirId = adminRow.direction_id;
  console.log(`  dir: ${dirId}`);

  // Атом с применимым P (readiness требует P>=7).
  const atom = await queryOne<{ atom_id: string }>(
    `SELECT atom_id FROM competency_atoms
      WHERE dimension_applicability->'P'->>'applicable' = 'true'
      ORDER BY atom_id LIMIT 1`,
  );
  if (!atom) {throw new Error('нет атома с P applicable');}
  const atomId = atom.atom_id;
  console.log(`  atom: ${atomId}`);

  // FA: readiness по атому (P=7, X=5, E=5 — X, E могут быть не применимы,
  // computeReadiness их пропустит).
  for (const [dim, level] of [['P', 7], ['X', 5], ['E', 5]] as const) {
    await query(
      `INSERT INTO person_atom_states
         (participant_id, atom_id, dimension, level, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       ON CONFLICT (participant_id, atom_id, dimension)
       DO UPDATE SET level = EXCLUDED.level, status = 'confirmed'`,
      [admin.id, atomId, dim, level],
    );
  }

  // Второй участник — ученик. ensureActor возвращает { id, token, phone, password }.
  const learner = await ensureActor(admin.token, { name: `v9 learner ${RUN.slice(0, 6)}` });
  console.log(`  learner: ${learner.id}`);

  // Выравниваем направление learner по FA: ensureActor кладёт в первое
  // активное направление, а у FA может быть другое.
  await query(
    `UPDATE participants SET direction_id = $1, updated_at = now() WHERE id = $2`,
    [dirId, learner.id],
  );

  // План и две задачи.
  const plan = await req('POST', '/plans', {
    type: 'standard',
    title: `${MARK} practice`,
    expected_result: 'practice',
    lead_direction_id: dirId,
    criteria: {},
  });
  const planId = (plan.data as { id: string }).id;
  await req('POST', `/plans/${planId}/approve`, {});
  await req('POST', `/plans/${planId}/activate`, {});

  const sourceTask = await makeDeliverable(dirId, planId, `${MARK} source`, admin.id);
  const learnerTask = await makeDeliverable(dirId, planId, `${MARK} learner`, learner.id);

  // ─── 1. Негативы при создании ─────────────────────────────────
  {
    const r = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: admin.id,
      source_task_id: sourceTask.id, learner_task_id: sourceTask.id,
      competency_atom_id: atomId, expected_learning_result: 'test expected result',
    });
    check([400, 422].includes(r.status),
      `teacher=learner → 400/422 (факт: ${r.status})`);

    const r2 = await req('POST', '/learning/task-practices', {
      teacher_id: learner.id, learner_id: admin.id,
      source_task_id: sourceTask.id, learner_task_id: learnerTask.id,
      competency_atom_id: atomId, expected_learning_result: 'test expected result',
    });
    check([403, 409].includes(r2.status),
      `source не назначена на teacher → 403/409 (факт: ${r2.status})`);

    const r3 = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: learner.id,
      source_task_id: sourceTask.id, learner_task_id: learnerTask.id,
      competency_atom_id: 'CYB.ATOM.9999', expected_learning_result: 'test expected result',
    });
    check([400, 404, 422].includes(r3.status),
      `атом не существует → 400/404/422 (факт: ${r3.status})`);

    const r4 = await req('POST', '/learning/task-practices', {
      teacher_id: learner.id, learner_id: admin.id,
      source_task_id: learnerTask.id, learner_task_id: sourceTask.id,
      competency_atom_id: atomId, expected_learning_result: 'test expected result',
    });
    check([403, 409].includes(r4.status),
      `teacher без readiness/source-assignee → 403/409 (факт: ${r4.status})`);
  }

  // ─── 2. Позитив: создание (FA = teacher, инициатор) ───────────
  let practiceId = '';
  {
    const r = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: learner.id,
      source_task_id: sourceTask.id, learner_task_id: learnerTask.id,
      competency_atom_id: atomId,
      expected_learning_result: 'Научиться применять атом на собственной задаче',
    });
    check(r.status === 201, `create → 201 (факт: ${r.status})`);
    const p = r.data as {
      status?: string; teacherConsent?: boolean; learnerConsent?: boolean;
    };
    check(p.status === 'proposed', 'статус = proposed');
    check(p.teacherConsent === true, 'teacherConsent=true (инициатор)');
    check(p.learnerConsent === false, 'learnerConsent=false');
    practiceId = (r.data as { id: string }).id;
  }

  // ─── 3. Дубликат активной пары → 409 ──────────────────────────
  {
    const r = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: learner.id,
      source_task_id: sourceTask.id, learner_task_id: learnerTask.id,
      competency_atom_id: atomId, expected_learning_result: 'duplicate test',
    });
    check(r.status === 409, `дубликат → 409 (факт: ${r.status})`);
  }

  // ─── 4. consent от FA — идемпотентно proposed ─────────────────
  {
    const r = await req('POST', `/learning/task-practices/${practiceId}/consent`, {});
    check(r.status === 200, `consent от FA → 200 (факт: ${r.status})`);
    check((r.data as { status?: string }).status === 'proposed',
      'статус остался proposed');
  }

  // ─── 5. consent от learner → active (через API) ───────────────
  {
    const saved = TOKEN;
    try {
      TOKEN = learner.token;
      const r = await req('POST', `/learning/task-practices/${practiceId}/consent`, {});
      check(r.status === 200, `consent от learner → 200 (факт: ${r.status})`);
      const p = r.data as { status?: string; learnerConsent?: boolean };
      check(p.learnerConsent === true, 'learnerConsent=true');
      check(p.status === 'active', `статус = active (факт: ${p.status})`);
    } finally {
      TOKEN = saved;
    }
  }

  // ─── 6. submit от FA (не learner) → 403 ───────────────────────
  {
    const r = await req('POST', `/learning/task-practices/${practiceId}/submit`, {});
    check(r.status === 403, `submit от FA → 403 (факт: ${r.status})`);
  }

  // ─── 7. submit от learner → submitted ─────────────────────────
  {
    const saved = TOKEN;
    try {
      TOKEN = learner.token;
      const r = await req('POST', `/learning/task-practices/${practiceId}/submit`, {});
      check(r.status === 200, `submit от learner → 200 (факт: ${r.status})`);
      check((r.data as { status?: string }).status === 'submitted',
        'статус = submitted');
    } finally {
      TOKEN = saved;
    }
  }

  // ─── 8. complete от FA (teacher) ─────────────────────────────
  {
    const r = await req('POST', `/learning/task-practices/${practiceId}/complete`, {});
    check(r.status === 200, `complete от teacher → 200 (факт: ${r.status})`);
    const p = r.data as { status?: string; completedAt?: string | null };
    check(p.status === 'completed', `статус = completed (факт: ${p.status})`);
    check(typeof p.completedAt === 'string', 'completedAt проставлен');
  }

  // ─── 9. cancel на completed → 409 ────────────────────────────
  {
    const r = await req('POST', `/learning/task-practices/${practiceId}/cancel`, {
      reason: 'тестовая отмена',
    });
    check(r.status === 409, `cancel completed → 409 (факт: ${r.status})`);
  }

  // ─── 10. listMyPractices: практика в asTeacher ────────────────
  {
    const r = await req('GET', '/learning/task-practices/me');
    check(r.status === 200, 'GET /me → 200');
    const d = r.data as {
      asTeacher?: Array<{ id: string }>;
      asLearner?: Array<{ id: string }>;
    };
    check((d.asTeacher ?? []).some((x) => x.id === practiceId),
      'в asTeacher есть completed практика');
  }

  // ─── 11. listMyPractices у learner: практика в asLearner ─────
  {
    const saved = TOKEN;
    try {
      TOKEN = learner.token;
      const r = await req('GET', '/learning/task-practices/me');
      const d = r.data as { asLearner?: Array<{ id: string }> };
      check((d.asLearner ?? []).some((x) => x.id === practiceId),
        'у learner в asLearner есть практика');
    } finally {
      TOKEN = saved;
    }
  }

  // ─── 12. Вторая практика → cancel (API, FA как teacher) ───────
  {
    const r0 = await req('POST', '/learning/task-practices', {
      teacher_id: admin.id, learner_id: learner.id,
      source_task_id: sourceTask.id, learner_task_id: learnerTask.id,
      competency_atom_id: atomId, expected_learning_result: 'cancel test',
    });
    check(r0.status === 201, `create второй практики → 201 (факт: ${r0.status})`);
    const newId = (r0.data as { id: string }).id;

    const r1 = await req('POST', `/learning/task-practices/${newId}/cancel`, {
      reason: 'тестовая отмена',
    });
    check(r1.status === 200, `cancel proposed → 200 (факт: ${r1.status})`);
    const p = r1.data as { status?: string; cancelReason?: string };
    check(p.status === 'cancelled', 'статус = cancelled');
    check(p.cancelReason === 'тестовая отмена', 'cancelReason сохранён');

    const r2 = await req('POST', `/learning/task-practices/${newId}/cancel`, {
      reason: 'повтор',
    });
    check(r2.status === 200, 'повторный cancel → 200 (идемпотентно)');
  }

  console.log(`\n── Итог: ${ok}/${ok + fail} ok, ${fail} fail ──`);
  if (fail > 0) {process.exitCode = 1;}

  // cleanup: практики удаляются каскадно через tasks.
  await query(
    `DELETE FROM tasks WHERE plan_id = $1 AND id NOT IN (SELECT task_id FROM task_profiles)`,
    [planId],
  );
  await query(`DELETE FROM plan_versions WHERE plan_id = $1`, [planId]);
  await query(`DELETE FROM plans WHERE id = $1`, [planId]);
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(async () => { await gracefulShutdown(); });