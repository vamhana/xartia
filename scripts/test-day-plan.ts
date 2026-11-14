// I.9.04.77 — Персональный план дня: создание, лимиты, версии, close.
//
// Запуск: pnpm tsx scripts/test-day-plan.ts <phone> <password>
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN = randomUUID();
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

  const login = await req('POST', '/auth/login', { phone, password: pass });
  if (login.status !== 200) {throw new Error('login failed');}
  TOKEN = (login.data as { access_token: string }).access_token;
  const me = (login.data as { participant: { id: string; direction_id: string } }).participant;

  // Предварительная очистка (на случай падения прошлого прогона).
  await query(
    `DELETE FROM participant_day_plans WHERE participant_id = $1 AND date = $2::date`,
    [me.id, DATE],
  );

  // ─── 1. GET несуществующего плана → 404 ─────────────────────────
  {
    const r = await req('GET', `/learning/day-plans/me/${DATE}`);
    check(r.status === 404, 'GET несуществующего плана → 404');
  }

  // ─── 2. PUT без блоков → пустой draft, v1 + v2 ──────────────────
  {
    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [],
    });
    check(r.status === 200, `PUT пустой план → 200 (факт: ${r.status})`);
    const plan = r.data as {
      status?: string; version?: number; blocks?: unknown[];
    };
    check(plan.status === 'draft', 'статус = draft');
    check(plan.blocks?.length === 0, 'пустой план — 0 блоков');

    const versions = await query<{ version: number }>(
      `SELECT v.version
         FROM participant_day_plan_versions v
         JOIN participant_day_plans p ON p.id = v.day_plan_id
        WHERE p.participant_id = $1 AND p.date = $2::date
        ORDER BY v.version`,
      [me.id, DATE],
    );
    check(versions.length === 2, `2 версии после первого PUT (факт: ${versions.length})`);
    check(versions[0]?.version === 1, 'v1');
    check(versions[1]?.version === 2, 'v2');
  }

  // ─── 3. PUT с 3 блоками (production+learning+teaching) ──────────
  let taskId: string | null = null;
  {
    const plan = await req('POST', '/plans', {
      type: 'standard', title: `I.9.04.77:${RUN} day`,
      expected_result: 'day plan', lead_direction_id: me.direction_id, criteria: {},
    });
    const planId = (plan.data as { id: string }).id;
    await req('POST', `/plans/${planId}/approve`, {});
    await req('POST', `/plans/${planId}/activate`, {});
    const t = await req('POST', '/tasks', {
      direction_id: me.direction_id, plan_id: planId,
      description: `I.9.04.77:${RUN} task`,
      priority: 'standard', kind: 'deliverable', expected_result: 'r',
    });
    taskId = (t.data as { id: string }).id;

    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [
        { kind: 'production', task_id: taskId, planned_minutes: 180 },
        { kind: 'learning', planned_minutes: 120 },
        { kind: 'teaching', planned_minutes: 60 },
      ],
    });
    check(r.status === 200, `PUT 3 блока → 200 (факт: ${r.status})`);
    const p = r.data as { blocks?: unknown[]; status?: string };
    check(p.blocks?.length === 3, '3 блока');
    check(p.status === 'draft', 'статус = draft (PUT на draft)');
  }

  // ─── 4. PUT с суммой > available → 409 ──────────────────────────
  {
    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 60,
      blocks: [
        { kind: 'learning', planned_minutes: 120 },
      ],
    });
    check(r.status === 409, `сумма > available → 409 (факт: ${r.status})`);
  }

  // ─── 5. PUT без task_id для production → 422/400 ────────────────
  {
    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [
        { kind: 'production', planned_minutes: 60 },
      ],
    });
    check([400, 422].includes(r.status),
      `production без task_id → 400/422 (факт: ${r.status})`);
  }

  // ─── 6. Подтверждение плана ─────────────────────────────────────
  {
    // Восстанавливаем валидный план.
    await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [
        { kind: 'production', task_id: taskId, planned_minutes: 180 },
        { kind: 'learning', planned_minutes: 120 },
      ],
    });

    const r = await req('POST', `/learning/day-plans/me/${DATE}/confirm`, {});
    check(r.status === 200, `confirm → 200 (факт: ${r.status})`);
    const p = r.data as { status?: string };
    check(p.status === 'confirmed', 'статус = confirmed');
  }

  // ─── 7. PUT на confirmed возвращает в draft ─────────────────────
  {
    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [
        { kind: 'production', task_id: taskId, planned_minutes: 200 },
      ],
    });
    check(r.status === 200, `PUT на confirmed → 200 (факт: ${r.status})`);
    const p = r.data as { status?: string };
    check(p.status === 'draft', 'PUT на confirmed возвращает draft');
  }

  // ─── 8. close без confirm → 409 ─────────────────────────────────
  {
    const r = await req('POST', `/learning/day-plans/me/${DATE}/close`, {
      actuals: [],
    });
    check(r.status === 409, `close без confirm → 409 (факт: ${r.status})`);
  }

  // ─── 9. Re-confirm + close с actuals ────────────────────────────
  {
    const plan = await req('GET', `/learning/day-plans/me/${DATE}`);
    const blocks = (plan.data as { blocks: Array<{ id: string }> }).blocks;
    const blockIds = blocks.map((b) => b.id);

    await req('POST', `/learning/day-plans/me/${DATE}/confirm`, {});

    const r = await req('POST', `/learning/day-plans/me/${DATE}/close`, {
      actuals: blockIds.map((id) => ({ block_id: id, actual_minutes: 150 })),
    });
    check(r.status === 200, `close → 200 (факт: ${r.status})`);
    const p = r.data as {
      status?: string;
      blocks?: Array<{ actualMinutes: number | null; status: string }>;
    };
    check(p.status === 'closed', 'статус = closed');
    check(
      p.blocks?.every((b) => b.actualMinutes === 150 && b.status === 'done'),
      'все блоки: actualMinutes=150, status=done',
    );
  }

  // ─── 10. PUT на closed → 409 ────────────────────────────────────
  {
    const r = await req('PUT', `/learning/day-plans/me/${DATE}`, {
      timezone: 'Europe/Moscow',
      available_minutes: 480,
      blocks: [],
    });
    check(r.status === 409, `PUT на closed → 409 (факт: ${r.status})`);
  }

  // ─── 11. History (версии) ───────────────────────────────────────
  {
    const r = await req('GET', `/learning/day-plans/me/history?date=${DATE}`);
    check(r.status === 200, `history?date → 200 (факт: ${r.status})`);
    const versions = (r.data as { data: Array<{ version: number }> }).data;
    check(versions.length >= 4, `>=4 версий (факт: ${versions.length})`);
    // Версии по убыванию.
    const desc = versions.every((v, i) =>
      i === 0 || versions[i - 1]!.version > v.version,
    );
    check(desc, 'версии по убыванию');
  }

  console.log(`\n── Итог: ${ok}/${ok + fail} ok, ${fail} fail ──`);
  if (fail > 0) {process.exitCode = 1;}

  // cleanup: закрытый план — удаляем (каскад на blocks/versions).
  await query(
    `DELETE FROM participant_day_plans WHERE participant_id = $1 AND date = $2::date`,
    [me.id, DATE],
  );
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(async () => { await gracefulShutdown(); });