// scripts/test-external-id-sequence.ts
// Проверяет последовательность external_id для plans, tasks, signals:
//   - без коллизий (MAX + 1)
//   - устойчиво к параллельным запросам
//   - устойчиво к удалениям (не регрессирует)
// Запуск: pnpm tsx scripts/test-external-id-sequence.ts

import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Client { token: string; participantId: string; directionId: string; }

async function makeClient(phone: string, password: string): Promise<Client> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json() as {
    access_token: string;
    participant: { id: string; direction_id: string };
  };
  if (!res.ok) {throw new Error(`Login ${phone}: ${JSON.stringify(data)}`);}
  return { token: data.access_token, participantId: data.participant.id, directionId: data.participant.direction_id };
}

async function req<T = unknown>(c: Client, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${c.token}` };
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

function ok(m: string) { console.warn(`   ✓ ${m}`); }
function fail(m: string) { console.warn(`   ✗ ${m}`); }

const MARKER = 'SEQ-TEST:';

async function cleanup(_participantId: string): Promise<void> {
  await query(`DELETE FROM plans WHERE title LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM tasks WHERE description LIKE $1`, [`${MARKER}%`]);
  await query(`DELETE FROM signals WHERE description LIKE $1`, [`${MARKER}%`]);
  console.warn(`🧹 Cleanup: тестовые plans/tasks/signals удалены`);
}

async function main(): Promise<void> {
  const arch = await makeClient(process.argv[2] ?? '+79000000000', process.argv[3] ?? 'ChangeMe123456');
  console.warn(`✅ Архитектор: ${arch.participantId}`);

  await cleanup(arch.participantId);

  // ─── 1. Планы: 5 подряд → непрерывная последовательность ────────
  // ВАЖНО: в БД могут быть планы за сегодня от других тестов,
  // поэтому не проверяем абсолютные 001..005, а проверяем,
  // что наши 5 планов идут ПОДРЯД (без пропусков).
  console.warn('\n─── ПЛАНЫ ───');
  const planIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await req<{ externalId: string }>(arch, 'POST', '/plans', {
      type: 'standard',
      title: `${MARKER} plan ${i + 1}`,
      expected_result: 'ok',
      lead_direction_id: arch.directionId,
    });
    if (r.status !== 201) { fail(`plan ${i+1} не создан: ${r.status}`); continue; }
    planIds.push(r.data.externalId);
  }
  const today = new Date().toISOString().slice(0, 10);

  if (planIds.length === 5 && new Set(planIds).size === 5) {
    const nums = planIds.map((id) => parseInt(id.slice(-3), 10)).sort((a, b) => a - b);
    const consecutive = nums.every((n, i) => i === 0 || n === nums[i-1]! + 1);
    if (consecutive) {ok(`5 планов подряд: ${nums.join(', ')}`);}
    else {fail(`Планы не подряд: ${nums.join(', ')}`);}
  } else {
    fail(`Ожидалось 5 уникальных, получено: ${planIds.join(', ')}`);
  }

  // Удалим 2 первых — sequence НЕ должна регрессировать (MAX + 1).
  const maxBefore = parseInt(planIds[planIds.length - 1]!.slice(-3), 10);
  await query(`DELETE FROM plans WHERE external_id = ANY($1::text[])`, [planIds.slice(0, 2)]);
  const nextPlan = await req<{ externalId: string }>(arch, 'POST', '/plans', {
    type: 'standard',
    title: `${MARKER} plan after delete`,
    expected_result: 'ok',
    lead_direction_id: arch.directionId,
  });
  const expectedNext = `PLAN-${today}-${String(maxBefore + 1).padStart(3, '0')}`;
  if (nextPlan.status === 201 && nextPlan.data.externalId === expectedNext) {
    ok(`После удаления 2 планов → следующий ${expectedNext} (не регрессирует)`);
  } else {
    fail(`Ожидался ${expectedNext}, получен ${nextPlan.data.externalId}`);
  }

  // ─── 2. Задачи: 5 подряд ─────────────────────────────────────────
  console.warn('\n─── ЗАДАЧИ ───');
  const taskIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await req<{ externalId: string }>(arch, 'POST', '/tasks', {
      direction_id: arch.directionId,
      description: `${MARKER} task ${i + 1}`,
      priority: 'standard',
    });
    if (r.status !== 201) { fail(`task ${i+1} не создан: ${r.status}`); continue; }
    taskIds.push(r.data.externalId);
  }
  const _expectedTasks = [1, 2, 3, 4, 5].map((n) => `ЗДЧ-${today}-${String(n).padStart(3, '0')}`);
  // ВАЖНО: в БД могут быть ЗДЧ за сегодня от других тестов — не проверяем точное совпадение,
  // только что все 5 уникальны и по возрастанию.
  const uniqTasks = new Set(taskIds);
  if (uniqTasks.size === 5) {
    ok(`5 задач: все external_id уникальны (${taskIds.join(', ')})`);
  } else {
    fail(`Коллизии в задачах: ${taskIds.join(', ')}`);
  }
  // Проверим, что последние 5 идут подряд (без пропусков)
  const nums = taskIds.map((id) => parseInt(id.slice(-3), 10)).sort((a, b) => a - b);
  const consecutive = nums.every((n, i) => i === 0 || n === nums[i-1]! + 1);
  if (consecutive) {
    ok(`5 задач идут подряд: ${nums.join(', ')}`);
  } else {
    fail(`Задачи не подряд: ${nums.join(', ')}`);
  }

  // ─── 3. Сигналы ─────────────────────────────────────────────────
  console.warn('\n─── СИГНАЛЫ ───');
  const sigIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await req<{ externalId: string }>(arch, 'POST', '/signals', {
      type: 'problem',
      description: `${MARKER} signal ${i + 1}`,
      justification: 'test',
      priority: 'standard',
    });
    if (r.status !== 201) { fail(`signal ${i+1} не создан: ${r.status}`); continue; }
    sigIds.push(r.data.externalId);
  }
  const uniqSigs = new Set(sigIds);
  if (uniqSigs.size === 5) {
    ok(`5 сигналов: все external_id уникальны`);
  } else {
    fail(`Коллизии в сигналах: ${sigIds.join(', ')}`);
  }

  // ─── 4. Параллельные планы: без коллизий ─────────────────────────
  console.warn('\n─── ПАРАЛЛЕЛЬНЫЕ ПЛАНЫ (5 одновременно) ───');
  const parallel = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      req<{ externalId: string }>(arch, 'POST', '/plans', {
        type: 'standard',
        title: `${MARKER} parallel ${n}`,
        expected_result: 'ok',
        lead_direction_id: arch.directionId,
      }),
    ),
  );
  const parallelIds = parallel.filter((r) => r.status === 201).map((r) => r.data.externalId);
  const uniqParallel = new Set(parallelIds);
  if (uniqParallel.size === 5 && parallelIds.length === 5) {
    ok(`5 параллельных планов — все успешны, ${uniqParallel.size} уникальных external_id`);
  } else {
    fail(`Параллельные планы: ${parallel.length} запросов, ${parallelIds.length} успешных, ${uniqParallel.size} уникальных`);
  }

  console.warn('\n✅ Тест external_id sequence завершён');
  await cleanup(arch.participantId);
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});