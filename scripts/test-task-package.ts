// I.9.04.74 — Приёмочный тест №1: package создаётся без expected_result.
//
// Проверяет реальный POST /tasks через HTTP API и сохранённые значения в БД.
// Использует уже существующего авторизованного участника с правом создания задач.
// Отдельный тестовый worker/исполнитель не требуется.
//
// Запуск :
//   pnpm tsx scripts/test-task-package.ts <phone> <password>
// или через ARCHITECT_PHONE / ARCHITECT_PASSWORD.
// API_URL по умолчанию: http://localhost:3000.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const RUN_ID = randomUUID();
const MARKER = `I.9.04.74:${RUN_ID}`;

interface Client {
  token: string;
  participantId: string;
  directionId: string;
}

interface ApiResult<T = unknown> {
  status: number;
  data: T;
}

interface LoginResponse {
  access_token: string;
  participant: {
    id: string;
    direction_id: string;
  };
}

interface IdResponse {
  id?: string;
  externalId?: string;
  status?: string;
}

interface StoredTask {
  id: string;
  kind: string;
  expected_result: string | null;
  description: string;
  plan_id: string | null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERT: ${message}`);
  }
}

function assertStatus(
  result: ApiResult,
  expected: number,
  label: string,
): void {
  if (result.status !== expected) {
    throw new Error(
      `${label}: ожидали HTTP ${expected}, получили ${result.status}; ` +
      `ответ=${JSON.stringify(result.data)}`,
    );
  }
}

async function request<T = unknown>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (token) {headers['Authorization'] = `Bearer ${token}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });

  const responseText = await response.text();
  let data: unknown;
  try {
    data = responseText.length > 0 ? JSON.parse(responseText) : null;
  } catch {
    data = responseText;
  }

  return { status: response.status, data: data as T };
}

async function login(phone: string, password: string): Promise<Client> {
  const result = await request<LoginResponse>(
    'POST',
    '/auth/login',
    undefined,
    { phone, password },
  );

  assertStatus(result, 200, 'POST /auth/login');
  assert(result.data?.access_token, 'в ответе login отсутствует access_token');
  assert(result.data?.participant?.id, 'в ответе login отсутствует participant.id');
  assert(
    result.data?.participant?.direction_id,
    'в ответе login отсутствует participant.direction_id',
  );

  return {
    token: result.data.access_token,
    participantId: result.data.participant.id,
    directionId: result.data.participant.direction_id,
  };
}

function log(label: string, result: ApiResult): void {
  console.log(`\n── ${label} [${result.status}] ──`);
  console.log(JSON.stringify(result.data, null, 2));
}

async function cleanup(planId: string | undefined, taskId: string | undefined, description: string): Promise<void> {
  // Удаляем только созданные этим запуском записи; общие таблицы не очищаем.
  if (planId) {
    // plan_tasks может ссылаться на задачу, поэтому сначала удаляем связь.
    await query('DELETE FROM plan_tasks WHERE plan_id = $1', [planId]);
  }

  if (taskId) {
    await query(
      'DELETE FROM tasks WHERE id = $1 AND description = $2',
      [taskId, description],
    );
  }

  if (planId) {
    // План создаётся этим тестом, поэтому можно удалить только его историю и сам план.
    await query('DELETE FROM plan_versions WHERE plan_id = $1', [planId]);
    await query('DELETE FROM plans WHERE id = $1', [planId]);
  }
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Отказ: интеграционный тест нельзя запускать в production');
  }

  const phone = process.argv[2] ?? process.env['ARCHITECT_PHONE'];
  const password = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'];
  if (!phone || !password) {
    throw new Error(
      'Укажите телефон и пароль: pnpm tsx scripts/test-task-package.ts <phone> <password> ' +
      'или задайте ARCHITECT_PHONE и ARCHITECT_PASSWORD',
    );
  }

  let planId: string | undefined;
  let taskId: string | undefined;
  const description = `${MARKER} Приёмочный тест: package без expected_result`;

  try {
    console.log('▶ I.9.04.74 — тест создания package без expected_result');
    console.log(`API: ${BASE}`);

    const actor = await login(phone, password);
    console.log(`✓ Авторизация участника ${actor.participantId}`);

    // Создаём отдельный план, чтобы тест не зависел от чужих данных.
    // expected_result здесь относится к плану, а не к package-задаче.
    const planResult = await request<IdResponse>('POST', '/plans', actor.token, {
      type: 'standard',
      title: `${MARKER} Тестовый план для package`,
      expected_result: 'Проверка создания организационного пакета',
      lead_direction_id: actor.directionId,
      criteria: { test: true, marker: MARKER },
    });
    log('POST /plans', planResult);
    assertStatus(planResult, 201, 'POST /plans');
    assert(typeof planResult.data?.id === 'string', 'созданный план не вернул id');
    planId = planResult.data.id;

    const approveResult = await request<{ status?: string }>(
      'POST', `/plans/${planId}/approve`, actor.token, {},
    );
    log('POST /plans/:id/approve', approveResult);
    assertStatus(approveResult, 200, 'POST /plans/:id/approve');
    assert(approveResult.data?.status === 'approved', 'план не перешёл в approved');

    const activateResult = await request<{ status?: string }>(
      'POST', `/plans/${planId}/activate`, actor.token, {},
    );
    log('POST /plans/:id/activate', activateResult);
    assertStatus(activateResult, 200, 'POST /plans/:id/activate');
    assert(activateResult.data?.status === 'in_progress', 'план не перешёл в in_progress');

    // Ключевой запрос теста: kind=package, expected_result намеренно отсутствует.
    const createBody = {
      direction_id: actor.directionId,
      plan_id: planId,
      description,
      priority: 'standard',
      kind: 'package',
      // НЕ добавлять expected_result: его отсутствие — предмет проверки.
    };

    const createResult = await request<IdResponse>(
      'POST', '/tasks', actor.token, createBody,
    );
    log('POST /tasks { kind: package, без expected_result }', createResult);
    assertStatus(createResult, 201, 'POST /tasks package без expected_result');
    const created = createResult.data as {
      id?: string; kind?: string; expectedResult?: string | null;
    };
    assert(
      created.kind === 'package',
      `в HTTP-ответе kind=${JSON.stringify(created.kind)}, ожидали package`,
    );
    assert(
      created.expectedResult === null,
      `в HTTP-ответе expectedResult=${JSON.stringify(created.expectedResult)}, ожидали null`,
    );
    assert(typeof createResult.data?.id === 'string', 'созданная задача не вернула id');
    taskId = createResult.data.id;

    // Проверяем именно сохранённое состояние, а не только HTTP-ответ.
    const stored = await queryOne<StoredTask>(
      `SELECT id, kind, expected_result, description, plan_id
         FROM tasks
        WHERE id = $1`,
      [taskId],
    );

    assert(stored, `задача ${taskId} отсутствует в БД после ответа 201`);
    assert(stored.kind === 'package', `в БД kind=${stored.kind}, ожидали package`);
    assert(
      stored.expected_result === null,
      `ожидали expected_result=NULL, получили ${JSON.stringify(stored.expected_result)}`,
    );
    assert(stored.description === description, 'описание сохранённой задачи не совпадает');
    assert(stored.plan_id === planId, 'задача сохранена не в том плане');

    console.log('\n✓ PASS: package создан (HTTP 201) без expected_result');
    console.log(`  taskId=${taskId}`);
    console.log('  БД: kind=package, expected_result=NULL');
  } finally {
    try {
      await cleanup(planId, taskId, description);
      if (planId || taskId) {console.log('🧹 Тестовые task/plan удалены');}
    } catch (cleanupError) {
      console.error('✗ Ошибка очистки тестовых данных:', cleanupError);
      process.exitCode = 1;
    }
    await gracefulShutdown();
  }
}

main().catch((error: unknown) => {
  console.error('\n✗ FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
