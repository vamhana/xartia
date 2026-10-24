// scripts/test-otc.ts
// Полный цикл: план → задача → отчёт → приёмка ОТК.
// Запуск: pnpm tsx scripts/test-otc.ts <phone> <password>
//
// Порядок шагов исправлен: submit ДО проверки очереди.
// Раньше проверка очереди шла до submit — отчёта там не было,
// тест показывал ложный fail.

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
let TOKEN = '';

async function req<T = unknown>(
  method: string, path: string, body?: unknown,
): Promise<{ status: number; data: T }> {
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
  return { status: res.status, data: data as T };
}

function log(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

function ok(msg: string): void { console.log(`   ✓ ${msg}`); }
function fail(msg: string): void { console.log(`   ✗ ${msg}`); }

async function main(): Promise<void> {
  const phone = process.argv[2] ?? '+79000000000';
  const password = process.argv[3];
  if (!password) {
    console.error('Usage: pnpm tsx scripts/test-otc.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login
  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) { log('POST /auth/login', login.status, login.data); process.exit(1); }
  TOKEN = login.data.access_token;
  const me = login.data.participant;
  console.log(`✅ Logged in: ${me.id}, direction=${me.direction_id}`);

  // 2. Создать план → approve → activate
  const plan = await req<{ id: string }>('POST', '/plans', {
    type: 'standard',
    title: 'OTC test plan',
    expected_result: 'Проверка цикла отчёт-приёмка',
    lead_direction_id: me.direction_id,
    criteria: { test: true },
  });
  if (plan.status !== 201) { log('POST /plans', plan.status, plan.data); process.exit(1); }
  const planId = plan.data.id;
  await req('POST', `/plans/${planId}/approve`);
  await req('POST', `/plans/${planId}/activate`);
  ok(`План создан и активен: ${planId}`);

  // 3. Создать задачу
  const task = await req<{ id: string; externalId: string; status: string }>('POST', '/tasks', {
    direction_id: me.direction_id,
    description: 'Задача для теста ОТК',
    priority: 'standard',
    plan_id: planId,
    required_competencies: [],
  });
  if (task.status !== 201) { log('POST /tasks', task.status, task.data); process.exit(1); }
  const taskId = task.data.id;
  ok(`Задача создана: ${task.data.externalId}`);

  // 4. Назначить и взять
  await req('POST', `/tasks/${taskId}/assign`, { participant_id: me.id });
  await req('POST', `/tasks/${taskId}/take`);
  ok('Задача назначена и взята');

  // 5. Создать текстовый отчёт
  const report = await req<{ id: string; type: string }>(
    'POST', `/tasks/${taskId}/reports`,
    { type: 'text', comment: 'Всё выполнено, проверьте пожалуйста' },
  );
  log('POST /tasks/:id/reports', report.status, report.data);
  if (report.status !== 201) { fail('Report create failed'); process.exit(1); }
  const reportId = report.data.id;
  ok(`Отчёт создан: ${reportId}`);

  // 6. Сдать задачу (ПЕРЕД проверкой очереди — она видит только submitted)
  const submitted = await req<{ status: string }>('POST', `/tasks/${taskId}/submit`);
  log('POST /tasks/:id/submit', submitted.status, submitted.data);
  if (submitted.data.status === 'submitted') {ok('Задача переведена в submitted');}

  // 7. Проверка: отчёт в очереди ОТК (теперь задача submitted)
  const queue = await req<{ data: Array<{ reportId: string; taskId: string }> }>('GET', '/otc/queue');
  log('GET /otc/queue', queue.status, {
    count: queue.data.data?.length,
    first: queue.data.data?.slice(0, 3),
  });
  const inQueue = queue.data.data?.some((i) => i.reportId === reportId);
  if (inQueue) {ok('Отчёт в очереди ОТК');}
  else {fail('Отчёт НЕ в очереди ОТК');}

  // 8. Список отчётов по задаче
  const reportsByTask = await req<{ data: unknown[] }>('GET', `/tasks/${taskId}/reports`);
  log('GET /tasks/:id/reports', reportsByTask.status, { count: reportsByTask.data.data?.length });
  if (reportsByTask.data.data?.length === 1) {ok('1 отчёт привязан к задаче');}

  // 9. ОТК: принять
  const decision = await req<{ id: string; verdict: string; crisisProtocol: boolean }>(
    'POST', '/otc/decisions',
    { report_id: reportId, verdict: 'accepted', comment: 'Принято' },
  );
  log('POST /otc/decisions { accepted }', decision.status, decision.data);
  if (decision.status === 201 && decision.data.verdict === 'accepted') {
    ok('Решение: accepted');
    if (decision.data.crisisProtocol === false) {ok('crisisProtocol=false');}
  } else {
    fail('Решение не принято');
  }

  // 10. Проверка: задача стала accepted (side-effect ОТК)
  const finalTask = await req<{ status: string }>('GET', `/tasks/${taskId}`);
  log(`GET /tasks/${taskId}`, finalTask.status, { status: finalTask.data.status });
  if (finalTask.data.status === 'accepted') {ok('Side-effect: задача accepted');}
  else {fail(`Side-effect не сработал: ${finalTask.data.status}`);}

  // 11. Проверка: отчёт больше не в очереди
  const queueAfter = await req<{ data: Array<{ reportId: string }> }>('GET', '/otc/queue');
  const stillInQueue = queueAfter.data.data?.some((i) => i.reportId === reportId);
  if (!stillInQueue) {ok('Отчёт ушёл из очереди');}
  else {fail('Отчёт всё ещё в очереди');}

  // 12. Попытка повторного решения — ожидаем 409
  const repeat = await req('POST', '/otc/decisions', { report_id: reportId, verdict: 'accepted' });
  if (repeat.status === 409) {ok('Повторное решение отклонено (409)');}
  else {fail(`Ожидали 409, получили ${repeat.status}`);}

  // 13. Статистика ОТК
  const stats = await req<{ totalDecisions: number; accepted: number }>('GET', '/otc/stats');
  log('GET /otc/stats', stats.status, stats.data);
  if (stats.data.totalDecisions >= 1) {ok(`Всего решений: ${stats.data.totalDecisions}`);}

  // 14. Проверка: ОТК не может проверять свою работу (I.2.12)
  //     Отдельная задача + отчёт + submit → попытка принять от себя.
  const task2 = await req<{ id: string }>('POST', '/tasks', {
    direction_id: me.direction_id,
    description: 'Задача №2 — самопроверка ОТК',
    priority: 'standard',
  });
  const task2Id = task2.data.id;
  await req('POST', `/tasks/${task2Id}/assign`, { participant_id: me.id });
  await req('POST', `/tasks/${task2Id}/take`);
  const report2 = await req<{ id: string }>('POST', `/tasks/${task2Id}/reports`, {
    type: 'text', comment: 'Проверка самопроверки',
  });
  await req('POST', `/tasks/${task2Id}/submit`);
  const selfCheck = await req('POST', '/otc/decisions', {
    report_id: report2.data.id, verdict: 'accepted',
  });
  log('POST /otc/decisions (самопроверка)', selfCheck.status, selfCheck.data);
  if (selfCheck.status === 409) {ok('ОТК не может проверять свою работу');}
  else {fail(`Самопроверка не отклонена (${selfCheck.status})`);}

  console.log('\n✅ Полный цикл замкнут: план → задача → отчёт → приёмка');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});