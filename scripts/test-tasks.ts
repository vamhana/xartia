// scripts/test-tasks.ts
// Smoke-тест Plans + Tasks: полный цикл от создания плана до приёмки задачи.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
import { query } from '../src/lib/db.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

async function asToken<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const prev = TOKEN;
  TOKEN = token;
  try { return await fn(); } finally { TOKEN = prev; }
}

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

function ok(label: string): void {
  console.log(`   ✓ ${label}`);
}

async function main(): Promise<void> {
  const phone = process.argv[2] ?? '+79000000000';
  const password = process.argv[3];
  if (!password) { console.error('Usage: pnpm tsx scripts/test-tasks.ts <phone> <password>'); process.exit(1); }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { log('POST /auth/login', login.status, login.data); process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}, direction=${me.direction_id}`);

  // 2. Создать план
  const planCreate = await req<{ id: string; externalId: string; status: string }>('POST', '/plans', {
    type: 'standard',
    title: 'Тестовый план',
    expected_result: 'Проверка цикла задач',
    lead_direction_id: me.direction_id,
    criteria: { test: true },
  });
  log('POST /plans', planCreate.status, planCreate.data);
  if (planCreate.status !== 201) { console.error('❌ Plan create failed'); await gracefulShutdown(); process.exit(1); }
  const planId = planCreate.data.id;

  // 3. Approve
  const approved = await req<{ status: string }>('POST', `/plans/${planId}/approve`);
  log(`POST /plans/${planId}/approve`, approved.status, approved.data);
  if (approved.data.status === 'approved') {ok('План утверждён');}

  // 4. Activate
  const activated = await req<{ status: string }>('POST', `/plans/${planId}/activate`);
  log(`POST /plans/${planId}/activate`, activated.status, activated.data);
  if (activated.data.status === 'in_progress') {ok('План активен');}

  // 5. Список планов
  const plansList = await req<{ data: unknown[]; meta: { total: number } }>('GET', '/plans');
  log('GET /plans', plansList.status, { count: plansList.data.data?.length, total: plansList.data.meta?.total });

  // 6. Создать задачу
  const taskCreate = await req<{ id: string; externalId: string; priority: string; status: string; deadline: string }>(
    'POST', '/tasks',
    {
      direction_id: me.direction_id,
      description: 'Тестовая задача: проверить цикл',
      priority: 'standard',
      plan_id: planId,
      required_competencies: ['test'],
    },
  );
  log('POST /tasks', taskCreate.status, taskCreate.data);
  if (taskCreate.status !== 201) { console.error('❌ Task create failed'); await gracefulShutdown(); process.exit(1); }
  const taskId = taskCreate.data.id;
  if (taskCreate.data.status === 'created') {ok('Задача создана, status=created');}
  if (taskCreate.data.deadline) {ok(`Deadline: ${taskCreate.data.deadline}`);}

  // 7. Список всех задач
  const tasksList = await req<{ data: unknown[]; meta: { total: number } }>('GET', '/tasks');
  log('GET /tasks', tasksList.status, { count: tasksList.data.data?.length, total: tasksList.data.meta?.total });

  // 8. Исполнитель — другой участник направления (I.2.12: ОТК не проверяет себя).
  const execRows = await query<{ id: string }>(
    `SELECT id FROM participants
      WHERE direction_id = $1 AND id <> $2 AND deleted_at IS NULL
      ORDER BY created_at
      LIMIT 1`,
    [me.direction_id, me.id],
  );
  let executorId = execRows[0]?.id;
  if (!executorId) {
    // На чистой базе в направлении только Архитектор — создаём исполнителя.
    const suffix = String(Date.now()).slice(-6);
    const reg = await req<{ request_id: string }>('POST', '/auth/register', {
      phone: `+7996${suffix}`,
      messengers: { telegram: `@exec_${suffix}` },
      password: `Exec${suffix}`,
      consent_video: true,
      consent_data: true,
    });
    const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
    const dirNumber = dirs.data.data.find((d) => d.id === me.direction_id)?.number ?? 1;
    const acc = await req<{ participant: { id: string } }>(
      'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
      { direction_id: me.direction_id, name: `Исполнитель ${suffix}`, direction_number: dirNumber },
    );
    if (acc.status !== 201) {
      console.error(`   ✗ не удалось создать исполнителя: ${acc.status}`);
      process.exit(1);
    }
    executorId = acc.data.participant.id;
  }
  const executor = { id: executorId };
  const impersonated = await req<{ access_token: string }>(
    'POST', `/dev/impersonate/${executor.id}`,
  );
  const execToken = impersonated.data.access_token;

  const assigned = await req<{ status: string; assignedTo: string }>(
    'POST', `/tasks/${taskId}/assign`, { participant_id: executor.id },
  );
  log(`POST /tasks/${taskId}/assign`, assigned.status, assigned.data);
  if (assigned.data.status === 'assigned') {ok('Задача назначена');}

  // 9. Мои задачи
  const myTasks = await req<{ data: unknown[] }>('GET', '/tasks/my');
  log('GET /tasks/my', myTasks.status, { count: myTasks.data.data?.length });

  // 10. Взять в работу
  const taken = await asToken(execToken, () =>
    req<{ status: string }>('POST', `/tasks/${taskId}/take`),
  );
  log(`POST /tasks/${taskId}/take`, taken.status, taken.data);
  if (taken.data.status === 'in_progress') {ok('Задача в работе');}

  // 10b. Отчёт с артефактом: программист прикладывает ссылку на PR.
  // Без этого ОТК проверяет только текст, а вклад не восстановить (C.0.08.01).
  const artifact = 'https://github.com/xartia/core/pull/1';
  const report = await asToken(execToken, () =>
    req<{ artifactUrl: string | null }>(
      'POST', `/tasks/${taskId}/reports`,
      { type: 'text', comment: 'Проверка отчёта с артефактом.', artifact_url: artifact },
    ),
  );
  log(`POST /tasks/${taskId}/reports`, report.status, report.data);
  if (report.status === 201 && report.data.artifactUrl === artifact) {
    ok('Артефакт сохранён в отчёте');
  } else {
    console.error('   ✗ Артефакт не сохранился');
    process.exitCode = 1;
  }

  // 11. Сдать
  const submitted = await asToken(execToken, () =>
    req<{ status: string }>('POST', `/tasks/${taskId}/submit`),
  );
  log(`POST /tasks/${taskId}/submit`, submitted.status, submitted.data);
  if (submitted.data.status === 'submitted') {ok('Задача сдана');}

  // 12. Принять
  const accepted = await req<{ status: string }>('POST', `/tasks/${taskId}/accept`);
  log(`POST /tasks/${taskId}/accept`, accepted.status, accepted.data);
  if (accepted.data.status === 'accepted') {ok('Задача принята');}

  // P0.4: Поток начислен ровно один раз (реестр присуждений).
  const awards = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM task_flow_awards WHERE task_id = $1`,
    [taskId],
  );
  const flows = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM flow_transactions WHERE task_id = $1`,
    [taskId],
  );
  if (parseInt(awards[0]?.c ?? '0', 10) === 1 && parseInt(flows[0]?.c ?? '0', 10) === 1) {
    ok('Поток начислен ровно один раз (P0.4)');
  } else {
    console.error(`   ✗ Поток начислен неверно: awards=${awards[0]?.c}, flows=${flows[0]?.c}`);
    process.exitCode = 1;
  }

  const again = await req<{ code?: string }>('POST', `/tasks/${taskId}/accept`);
  if (again.status === 409) {ok('Повторная приёмка отклонена');}
  else {console.error(`   ✗ повторная приёмка → ${again.status}`); process.exitCode = 1;}

  // P0.2: сдача без отчёта с артефактом запрещена.
  const bare = await req<{ id: string }>('POST', '/tasks', {
    direction_id: me.direction_id,
    description: 'Задача без отчёта (P0.2)',
    priority: 'standard',
  });
  if (bare.status === 201) {
    await req('POST', `/tasks/${bare.data.id}/assign`, { participant_id: executor!.id });
    await asToken(execToken, () => req('POST', `/tasks/${bare.data.id}/take`));
    const bareSubmit = await asToken(execToken, () =>
      req<{ code?: string; message?: string }>('POST', `/tasks/${bare.data.id}/submit`),
    );
    if (bareSubmit.status === 409 && /артефакт/i.test(bareSubmit.data.message ?? '')) {
      ok('Без отчёта с артефактом сдача отклонена (P0.2)');
    } else {
      console.error(`   ✗ submit без отчёта → ${bareSubmit.status}: ${bareSubmit.data.message}`);
      process.exitCode = 1;
    }
  }

  // 13. Проверить финальный статус
  const finalTask = await req<{ status: string }>('GET', `/tasks/${taskId}`);
  log(`GET /tasks/${taskId}`, finalTask.status, { status: finalTask.data.status });
  if (finalTask.data.status === 'accepted') {ok('Финальный статус: accepted');}

  // 14. Попытка сдать принятую задачу — должна упасть 409
  const badSubmit = await req('POST', `/tasks/${taskId}/submit`);
  log(`POST /tasks/${taskId}/submit (ожидаем 409)`, badSubmit.status, badSubmit.data);
  if (badSubmit.status === 409) {ok('Недопустимый переход отклонён');}

  console.log('\n✅ Smoke-тест Plans + Tasks завершён');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});