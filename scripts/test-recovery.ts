// scripts/test-recovery.ts
// E2E smoke для флоу recovery (S.0.01.04 / C.0.02.02 / A.1.01.01).
//
// Pre-flight (dev/CI-база, не prod!):
//   1. Сброс активных recovery_requests (pending/approved → expired).
//   2. Сброс rate-limit ключей ratelimit:* в Redis.
//   3. Проверка, что сервер возвращает dev_token на approve (иначе fail fast).
//
// Сценарий:
//   1. POST /auth/recover/request          → 201 { request_id, status: 'pending' }
//   2. POST /auth/login (Архитектор)       → access_token
//   3. POST /auth/recover/approve/:id      → 200 { dev_token, expires_at }
//   4. POST /auth/recover/confirm          → 200 { ok: true }
//   5. POST /auth/login (старый пароль)    → 401
//   6. POST /auth/login (новый пароль)     → 200
//   7. POST /auth/recover/confirm (reuse)  → 409 или 401
//   8. Восстановление исходного пароля     → 200
//
// Требует:
//   - запущенный сервер (pnpm dev или через launch_workspace.py)
//   - ALLOW_DEV_TOKEN=true в .env и подхваченный процессом сервера
//   - DATABASE_URL в .env (для pre-flight)
//   - REDIS_URL в .env (для pre-flight)
//   - Архитектор +79001234567 / ChangeMe123456 (ensure-architect.ts)

import 'dotenv/config';
import Redis from 'ioredis';
import pg from 'pg';

// -------- Конфигурация --------

const API = process.env['API_BASE'] ?? 'http://localhost:3000';
const ARCHITECT_PHONE = process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASSWORD = process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';
const NEW_PASSWORD = 'RecoveryTest!' + Date.now().toString().slice(-6);

const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

const HTTP_TIMEOUT_MS = 10_000;

if (!DATABASE_URL) {
  console.error(
    '\n❌ DATABASE_URL не задан в .env.\n' +
    '   Тест требует прямого доступа к БД для pre-flight сброса заявок.\n',
  );
  process.exit(1);
}

// -------- Типы и утилиты --------

interface JsonResponse { [k: string]: unknown }

interface HttpResult<T> {
  status: number;
  data: T;
}

async function post<T extends JsonResponse>(
  path: string,
  body: unknown,
  token?: string,
): Promise<HttpResult<T>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { status: res.status, data };
}

async function getHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.status !== 200) { return false; }
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) { throw new Error(`ASSERT FAILED: ${msg}`); }
}

// -------- Pre-flight --------

async function resetRecoveryRequests(): Promise<number> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `UPDATE recovery_requests
          SET status = 'expired'
        WHERE status IN ('pending', 'approved')`,
    );
    return res.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

async function resetRateLimits(): Promise<number> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await redis.connect();
    // SCAN + DEL через Lua — атомарно и без блокировки на больших keyspace.
    const deleted = (await redis.eval(
      `local keys = redis.call('keys', 'ratelimit:*')
       for i, k in ipairs(keys) do redis.call('del', k) end
       return #keys`,
      0,
    )) as number;
    return deleted;
  } finally {
    await redis.quit().catch(() => {});
  }
}

// После getHealth и pre-flight (resetRecoveryRequests + resetRateLimits)
// Добавить:

// 0c. Проверка: логинится ли Архитектор с ARCHITECT_PASSWORD?
// Если нет — тест всё равно упадёт на шаге 2. Лучше упасть ДО создания заявки.
const probe = await post<{ access_token?: string }>('/auth/login', {
  phone: ARCHITECT_PHONE,
  password: ARCHITECT_PASSWORD,
});
if (probe.status !== 200) {
  console.error(
    '\n❌ Архитектор не логинится с ARCHITECT_PASSWORD из env.\n' +
    '   Вероятно, прошлый прогон упал между шагом 4 (смена) и шагом 8 (восстановление).\n' +
    '   Пароль сейчас — RecoveryTest!...\n\n' +
    '   Восстанови:\n' +
    '     pnpm tsx scripts/reset-architect-password.ts\n',
  );
  process.exit(1);
}
// probe.data.access_token — можно переиспользовать как adminToken для шага 3,
// но проще оставить как есть, чтобы тест был предсказуемым.

// -------- Main --------

async function main(): Promise<void> {
  console.log('─── Recovery E2E ───');

  // 0a. Сервер жив?
  if (!(await getHealth())) {
    console.error(
      `\n❌ Сервер не отвечает на ${API}/health/live.\n` +
      '   Проверь: pnpm dev (или launch_workspace).\n',
    );
    process.exit(1);
  }

  // 0b. Pre-flight: сброс залипших заявок и лимитов
  const resetReq = await resetRecoveryRequests();
  if (resetReq > 0) {
    console.log(`   ↻ Сброшено активных заявок: ${resetReq}`);
  }
  const resetLimits = await resetRateLimits();
  if (resetLimits > 0) {
    console.log(`   ↻ Сброшено rate-limit ключей: ${resetLimits}`);
  }

  // 1. Создание заявки
  const reqRes = await post<{
    request_id?: string;
    status?: string;
    code?: string;
    message?: string;
  }>('/auth/recover/request', { phone: ARCHITECT_PHONE });

  if (reqRes.status === 429) {
    console.error(
      '\n❌ 429 на /auth/recover/request — rate-limit не сбросился.\n' +
      `   Ответ: ${JSON.stringify(reqRes.data)}\n`,
    );
    process.exit(1);
  }
  assert(reqRes.status === 201, `request: ожидался 201, получен ${reqRes.status}`);
  assert(reqRes.data['status'] === 'pending', 'status должен быть pending');
  const requestId = reqRes.data['request_id'];
  assert(typeof requestId === 'string', 'request_id должен быть строкой');
  console.log(`   ✓ Заявка создана: ${requestId}`);

  // 2. Логин Архитектором
  const login1 = await post<{
    access_token?: string;
    code?: string;
    message?: string;
  }>('/auth/login', {
    phone: ARCHITECT_PHONE,
    password: ARCHITECT_PASSWORD,
  });
  if (login1.status === 401) {
    console.error(
      '\n❌ Логин Архитектора вернул 401.\n' +
      '   Проверь: pnpm tsx scripts/ensure-architect.ts\n' +
      `   Ответ: ${JSON.stringify(login1.data)}\n`,
    );
    process.exit(1);
  }
  assert(login1.status === 200, `login#1: ожидался 200, получен ${login1.status}`);
  const adminToken = login1.data['access_token'];
  assert(typeof adminToken === 'string', 'нет access_token');
  console.log('   ✓ Логин Архитектором');

  // 3. Approve
  const approveRes = await post<{
    request_id?: string;
    expires_at?: string;
    delivered_via?: string[];
    warning?: string;
    dev_token?: string;
    code?: string;
    message?: string;
    audit_id?: string;
  }>(`/auth/recover/approve/${requestId}`, {}, adminToken);

  if (approveRes.status !== 200) {
    console.error(
      `\n❌ approve: ожидался 200, получен ${approveRes.status}.\n` +
      `   Ответ: ${JSON.stringify(approveRes.data)}\n`,
    );
    process.exit(1);
  }

  const devToken = approveRes.data['dev_token'];
  if (!devToken) {
    console.error(
      '\n❌ Approve вернул 200 без dev_token.\n' +
      '   Это значит, что сервер на :3000 не видит ALLOW_DEV_TOKEN=true.\n\n' +
      '   Что проверить:\n' +
      '   1) .env содержит ALLOW_DEV_TOKEN=true (findstr /I ALLOW_DEV_TOKEN .env)\n' +
      '   2) Сервер перезапущен ПОСЛЕ правки .env — tsx watch может не подхватить env.\n' +
      '      Если api запущен через launch_workspace.py, дочерние cmd наследуют\n' +
      '      окружение python. Перезапусти сам launch_workspace.py целиком.\n' +
      '   3) Рабочая директория процесса сервера — корень проекта.\n' +
      '      Проверь: netstat -ano | findstr :3000\n' +
      '              Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" | Select-Object CommandLine\n' +
      `\n   Ответ approve: ${JSON.stringify(approveRes.data)}\n`,
    );
    process.exit(1);
  }
  const expiresAt = approveRes.data['expires_at'];
  console.log(`   ✓ Approve: expires_at=${expiresAt}`);

  // 4. Confirm
  const confirmRes = await post<{ ok?: boolean; code?: string; message?: string }>(
    '/auth/recover/confirm',
    { token: devToken, new_password: NEW_PASSWORD },
  );
  assert(
    confirmRes.status === 200,
    `confirm: ожидался 200, получен ${confirmRes.status} (${JSON.stringify(confirmRes.data)})`,
  );
  assert(confirmRes.data['ok'] === true, 'confirm: ok !== true');
  console.log('   ✓ Confirm: пароль сменён');

  // 5. Старый пароль не работает
  const badLogin = await post('/auth/login', {
    phone: ARCHITECT_PHONE,
    password: ARCHITECT_PASSWORD,
  });
  assert(
    badLogin.status === 401,
    `старый пароль: ожидался 401, получен ${badLogin.status}`,
  );
  console.log('   ✓ Старый пароль не работает (401)');

  // 6. Новый пароль работает
  const goodLogin = await post<{ access_token?: string }>('/auth/login', {
    phone: ARCHITECT_PHONE,
    password: NEW_PASSWORD,
  });
  assert(
    goodLogin.status === 200,
    `новый пароль: ожидался 200, получен ${goodLogin.status}`,
  );
  const newToken = goodLogin.data['access_token'];
  assert(typeof newToken === 'string', 'нет access_token после смены');
  console.log('   ✓ Новый пароль работает');

  // 7. Повторный confirm тем же токеном — отклонён
  const reuseRes = await post('/auth/recover/confirm', {
    token: devToken,
    new_password: 'AnotherPass12345',
  });
  assert(
    reuseRes.status === 409 || reuseRes.status === 401,
    `повторный confirm: ожидался 409/401, получен ${reuseRes.status}`,
  );
  console.log('   ✓ Повторный confirm отклонён');

  // 8. Восстановление исходного пароля Архитектора — идемпотентность.
  //    Шаг 7 не поменял пароль, но шаг 4 поменял. Нужно вернуть.
  console.log('─── Восстановление исходного пароля ───');

  // Заявок нет — активную исчерпали шагом 4. Создаём новую.
  const req2 = await post<{ request_id?: string; status?: string }>(
    '/auth/recover/request',
    { phone: ARCHITECT_PHONE },
  );
  assert(req2.status === 201, `request#2: ожидался 201, получен ${req2.status}`);
  const requestId2 = req2.data['request_id'];
  assert(typeof requestId2 === 'string', 'request#2: нет request_id');

  // Approve — нужен свежий admin-токен, потому что старый (adminToken)
  // выпущен при пароле ARCHITECT_PASSWORD, а теперь пароль другой.
  const login2 = await post<{ access_token?: string }>('/auth/login', {
    phone: ARCHITECT_PHONE,
    password: NEW_PASSWORD,
  });
  assert(login2.status === 200, `login#2: ожидался 200, получен ${login2.status}`);
  const adminToken2 = login2.data['access_token'];
  assert(typeof adminToken2 === 'string', 'нет access_token#2');

  const approve2 = await post<{ dev_token?: string }>(
    `/auth/recover/approve/${requestId2}`,
    {},
    adminToken2,
  );
  assert(approve2.status === 200, `approve#2: ожидался 200, получен ${approve2.status}`);
  const devToken2 = approve2.data['dev_token'];
  assert(typeof devToken2 === 'string', 'нет dev_token#2');

  const confirm2 = await post('/auth/recover/confirm', {
    token: devToken2,
    new_password: ARCHITECT_PASSWORD,
  });
  assert(confirm2.status === 200, `confirm#2: ожидался 200, получен ${confirm2.status}`);
  console.log('   ✓ Исходный пароль восстановлен');

  console.log('\n✅ Recovery E2E завершён: 8 шагов пройдено');
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', (e as Error).message);
  process.exit(1);
});