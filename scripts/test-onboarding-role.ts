// scripts/test-onboarding-role.ts
// Приём заявки с выдачей роли (A.1.35.01 + S.0.01.03).
//
// Сценарий: регистрация → Архитектор принимает заявку с ролью → новый
// участник входит и видит эту роль в паспорте.
//
// Запуск: pnpm tsx scripts/test-onboarding-role.ts <architect_phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const archPhone = process.argv[2] ?? process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const archPassword = process.argv[3] ?? process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';

function ok(msg: string): void {
  console.log(`   ✓ ${msg}`);
}

function fail(msg: string): void {
  console.error(`   ✗ ${msg}`);
  process.exitCode = 1;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (token) {headers['Authorization'] = `Bearer ${token}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

async function main(): Promise<void> {
  console.log('▶ Онбординг с ролью\n');

  // 1. Заявка
  const phone = `+7999${Math.floor(100000 + Math.random() * 899999)}`;
  const reg = await call<{ request_id: string }>('POST', '/auth/register', {
    phone,
    messengers: { telegram: '@role_test' },
    password: 'RoleTestPass123',
    consent_video: true,
    consent_data: true,
  });
  if (reg.status !== 201) { fail(`register → ${reg.status}`); return; }
  ok(`заявка создана (${phone})`);

  // 2. Архитектор
  const login = await call<{ access_token: string }>('POST', '/auth/login', {
    phone: archPhone, password: archPassword,
  });
  if (login.status !== 200) { fail(`login architect → ${login.status}`); return; }
  const token = login.data.access_token;

  // 3. Направление и роли этого направления
  const dirs = await call<{ data: Array<{ id: string; number: number }> }>(
    'GET', '/directions', undefined, token,
  );
  const dir = dirs.data.data.find((d) => d.number === 9) ?? dirs.data.data[0];
  if (!dir) { fail('нет направлений'); return; }

  const roles = await call<{ data: Array<{ name: string }> }>(
    'GET', `/roles?direction_id=${dir.id}`, undefined, token,
  );
  const role = roles.data.data.find((r) => r.name === 'OTC')
    ?? roles.data.data.find((r) => r.name !== 'FIRST_ARCHITECT');
  if (!role) { fail('у направления нет ролей'); return; }
  ok(`направление #${dir.number}, роль: ${role.name}`);

  // 4. Приём с ролью
  const accept = await call<{
    participant: { externalId: string };
    temporary_password: string;
    role: string | null;
  }>('POST', `/admin/registration-requests/${reg.data.request_id}/accept`, {
    name: 'Тест Роли',
    direction_id: dir.id,
    role: role.name,
  }, token);
  if (accept.status !== 201) { fail(`accept → ${accept.status}`); return; }
  if (accept.data.role === role.name) { ok(`роль выдана: ${accept.data.role}`); }
  else { fail(`роль не выдана (role=${accept.data.role})`); }

  // 5. Вход нового участника и проверка паспорта
  const newbie = await call<{ access_token: string }>('POST', '/auth/login', {
    phone, password: accept.data.temporary_password,
  });
  if (newbie.status !== 200) { fail(`login newbie → ${newbie.status}`); return; }

  const passport = await call<{ roles: Array<{ name: string }> }>(
    'GET', '/me/passport', undefined, newbie.data.access_token,
  );
  const names = (passport.data.roles ?? []).map((r) => r.name);
  if (passport.status === 200 && names.includes(role.name)) {
    ok(`паспорт показывает роль: ${names.join(', ')}`);
  } else {
    fail(`в паспорте нет роли (${names.join(', ') || 'пусто'})`);
  }
  ok(`новый участник: ${accept.data.participant.externalId}`);

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());
