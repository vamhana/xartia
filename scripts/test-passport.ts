// scripts/test-passport.ts
// Smoke-тест: login → /me → /directions → /participants
// Запуск: pnpm tsx scripts/test-passport.ts

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  participant: { id: string; external_id: string; name: string; direction_id: string };
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {headers['Authorization'] = `Bearer ${token}`;}

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function print(label: string, status: number, data: unknown): void {
  console.log(`\n─── ${label} ─── [${status}]`);
  console.log(JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  const phone = process.argv[2] ?? '+79000000000';
  const password = process.argv[3] ?? 'ChangeMeFirstArch123';

  console.log(`BASE=${BASE}`);
  console.log(`Phone=${phone}`);

  // 1. Login
  const login = await req('POST', '/auth/login', { phone, password });
  print('POST /auth/login', login.status, login.data);

  if (login.status !== 200) {
    console.error('\n❌ Login failed — прерываю');
    process.exit(1);
  }

  const loginData = login.data as LoginResponse;
  const token = loginData.access_token;

  // 2. /me
  const me = await req('GET', '/me', undefined, token);
  print('GET /me', me.status, me.data);

  // 3. /directions
  const directions = await req('GET', '/directions', undefined, token);
  const dirData = directions.data as { data?: unknown[] };
  const count = dirData?.data?.length ?? 0;
  console.log(`\n─── GET /directions ─── [${directions.status}] (${count} шт.)`);
  if (Array.isArray(dirData?.data)) {
    for (const d of dirData.data.slice(0, 5) as Array<{ number: number; name: string; type: string }>) {
      console.log(`  ${d.number}. ${d.name} (${d.type})`);
    }
    if (count > 5) {console.log(`  ... и ещё ${count - 5}`);}
  }

  // 4. /participants
  const participants = await req('GET', '/participants?per_page=5', undefined, token);
  print('GET /participants?per_page=5', participants.status, participants.data);

  console.log('\n✅ Smoke-тест завершён');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});