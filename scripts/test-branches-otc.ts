// scripts/test-branches-otc.ts
// Ветки плана, приёмка ОТК с начислением Потока и просрочка без сдачи.
//
// Проверяем три вещи из жизни стройки:
//   1. «20 домов» видны как 20 веток: дом №1 готов, дом №2 отстаёт;
//   2. ОТК принимает работу — исполнителю начисляется Поток;
//   3. задача не сдана в ОТК (срок истёк, отчёта нет) → балансировка видит
//      список и поднимает сигналы направлениям.
//
// Запуск: pnpm tsx scripts/test-branches-otc.ts <phone> <password>

import 'dotenv/config';

import { queryOne, query } from '../src/lib/db.js';
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
  console.log('▶ Ветки плана, приёмка ОТК и просрочка без сдачи\n');

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

  // ── 1. Ветки: план + два «дома», у каждого подзадачи ──────────────
  const plan = await call<{ id: string; externalId: string }>(
    'POST', '/plans',
    {
      type: 'standard',
      title: `Микрорайон ${suffix}`,
      expected_result: '20 домов сданы',
      lead_direction_id: dir.id,
    },
    token,
  );
  if (plan.status !== 201) { fail(`plan → ${plan.status}`); return; }
  await call('POST', `/plans/${plan.data.id}/approve`, {}, token);
  await call('POST', `/plans/${plan.data.id}/activate`, {}, token);

  const createTask = async (description: string): Promise<string | null> => {
    const t = await call<{ id: string }>(
      'POST', '/tasks',
      { direction_id: dir.id, plan_id: plan.data.id, description, priority: 'standard' },
      token,
    );
    return t.status === 201 ? t.data.id : null;
  };

  const house1 = await createTask(`Дом 1 ${suffix}`);
  const house2 = await createTask(`Дом 2 ${suffix}`);
  const h1child = await createTask(`Дом 1: фундамент ${suffix}`);
  const h2child = await createTask(`Дом 2: фундамент ${suffix}`);
  if (!house1 || !house2 || !h1child || !h2child) { fail('не удалось создать задачи'); return; }

  await query(`UPDATE tasks SET parent_task_id = $1 WHERE id = $2`, [house1, h1child]);
  await query(`UPDATE tasks SET parent_task_id = $1 WHERE id = $2`, [house2, h2child]);
  // Дом 1 сдан, у дома 2 просрочен фундамент → одна ветка отстаёт.
  await query(`UPDATE tasks SET status = 'accepted' WHERE id = $1`, [h1child]);
  await query(`UPDATE tasks SET deadline = now() - interval '2 days' WHERE id = $1`, [h2child]);

  const branches = await call<{
    branches: Array<{ title: string; status: string }>;
    behindCount: number;
  }>('GET', `/plans/${plan.data.id}/branches`, undefined, token);
  if (branches.status === 200 && branches.data.branches.length === 2) {
    ok(`веток: ${branches.data.branches.length}, отстаёт: ${branches.data.behindCount}`);
  } else {
    fail(`branches → ${branches.status}: ${JSON.stringify(branches.data)}`);
  }
  if (branches.data.behindCount === 1) { ok('отстающая ветка распознана'); }
  else { fail(`ожидали 1 отстающую ветку, получили ${branches.data.behindCount}`); }

  const allBranches = await call<{ data: Array<{ planId: string }> }>(
    'GET', '/plans/branches', undefined, token,
  );
  if (allBranches.data.data.some((p) => p.planId === plan.data.id)) {
    ok('план с ветками виден на панели');
  } else {
    fail('план не попал в список веток');
  }

  // ── 2. Приёмка ОТК и начисление Потока ────────────────────────────
  const otcPhone = `+7998${suffix}1`;
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone: otcPhone,
    messengers: { telegram: `@otc_${suffix}` },
    password: `OtcTest${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) { fail(`регистрация ОТК → ${reg.status}`); return; }

  const accepted = await call<{ participant: { id: string }; temporary_password: string }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `ОТК ${suffix}`, direction_number: 9, role: 'OTC' },
    token,
  );
  if (accepted.status !== 201) { fail(`приём ОТК → ${accepted.status}`); return; }
  const otcLogin = await call<{ access_token: string }>(
    'POST', '/auth/login', { phone: otcPhone, password: accepted.data.temporary_password },
  );
  if (otcLogin.status !== 200) { fail(`login ОТК → ${otcLogin.status}`); return; }
  const otcToken = otcLogin.data.access_token;

  const work = await createTask(`Работа на приёмку ${suffix}`);
  if (!work) { fail('не удалось создать задачу на приёмку'); return; }
  await call('POST', `/tasks/${work}/assign`, { participant_id: archId }, token);
  await call('POST', `/tasks/${work}/take`, {}, token);
  const report = await call('POST', `/tasks/${work}/reports`, {
    type: 'text',
    comment: 'Готово, прошу принять',
    artifact_url: 'https://github.com/xartia/core/pull/42',
  }, token);
  if (report.status !== 201) { fail(`report → ${report.status}`); return; }
  const submitted = await call('POST', `/tasks/${work}/submit`, {}, token);
  if (submitted.status !== 200) { fail(`submit → ${submitted.status}`); return; }

  const before = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM flow_transactions WHERE participant_id = $1`,
    [archId],
  );
  const accept = await call('POST', `/tasks/${work}/accept`, {}, otcToken);
  if (accept.status === 200) { ok('ОТК принял задачу'); }
  else { fail(`accept → ${accept.status}: ${JSON.stringify(accept.data)}`); }
  const after = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM flow_transactions WHERE participant_id = $1`,
    [archId],
  );
  if (parseInt(after?.c ?? '0', 10) > parseInt(before?.c ?? '0', 10)) {
    ok('Поток начислен при приёмке');
  } else {
    fail(`Поток не начислен (${before?.c} → ${after?.c})`);
  }

  // ── 3. Просрочка без сдачи → список и сигналы ────────────────────
  const overdueTask = await createTask(`Просроченная без сдачи ${suffix}`);
  if (!overdueTask) { fail('не удалось создать просроченную задачу'); return; }
  await query(`UPDATE tasks SET deadline = now() - interval '3 days' WHERE id = $1`, [overdueTask]);

  const overdue = await call<{ data: Array<{ id: string }>; meta: { total: number } }>(
    'GET', '/tasks/overdue', undefined, token,
  );
  if (overdue.data.data.some((t) => t.id === overdueTask)) {
    ok(`просроченная задача в списке (всего ${overdue.data.meta.total})`);
  } else {
    fail('просроченная задача не попала в список');
  }

  const scan = await call<{ data: { created: number; tasks: number } }>(
    'POST', '/tasks/overdue/scan', {}, token,
  );
  // Повторный прогон не должен плодить сигналы: второй вызов в течение суток
  // по тому же направлению даёт skipped, и это правильно.
  if (scan.status === 200 && (scan.data.data.created + scan.data.data.skipped) >= 1) {
    ok(`scan: создано ${scan.data.data.created}, пропущено по дедупу ${scan.data.data.skipped}`);
  } else {
    fail(`scan → ${scan.status}: ${JSON.stringify(scan.data)}`);
  }

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
