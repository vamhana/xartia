// scripts/test-register.ts
import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { hashForSearch } from '../src/security/encryption.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

function ok(m: string) { console.log(`  ✓ ${m}`); }
function fail(m: string) { console.error(`  ✗ ${m}`); process.exitCode = 1; }

async function resetRateLimits(): Promise<number> {
  const keys = await redis.keys('ratelimit:*');
  if (keys.length === 0) {return 0;}
  await redis.del(...keys);
  return keys.length;
}
async function main() {
  console.log('▶ F.4.01.03 + F.4.01.04 register + waitingroom smoke\n');

  const cleared = await resetRateLimits();
  console.log(`  cleared ratelimit keys: ${cleared}\n`);

  // ... остальной код
  // Уникальный телефон
  const suffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  const phone = `+7999${suffix}`;
  const password = 'RaceTestPassword123';

  console.log(`  phone: ${phone}\n`);

  // 1. POST /auth/register
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      messengers: { telegram: '@smoke_test' },
      password,
      consent_video: true,
      consent_data: true,
    }),
  });
  const data = (await res.json()) as {
    request_id?: string;
    status?: string;
    audit_id?: string;
    code?: string;
  };
  console.log(`  register: ${res.status} ${JSON.stringify(data).slice(0, 120)}`);
  if (res.status === 201 && data.request_id) {ok('POST /auth/register');}
  else {
    fail(`register → ${res.status}`);
    return;
  }
  const requestId = data.request_id;

  // 2. GET /auth/status/:request_id
  const st = await fetch(`${BASE}/auth/status/${requestId}`);
  const stData = (await st.json()) as { request_id?: string; status?: string };
  console.log(`  status: ${st.status} ${JSON.stringify(stData)}`);
  if (st.status === 200 && stData.status === 'new') {ok('GET /auth/status → new');}
  else {fail(`status → ${st.status} status=${stData.status}`);}

  // 3. Дубликат — 409
  const dup = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      messengers: { telegram: '@smoke_test' },
      password,
      consent_video: true,
      consent_data: true,
    }),
  });
  if (dup.status === 409) {ok('duplicate phone → 409');}
  else {fail(`duplicate → ${dup.status}`);}

  // 4. Невалидное тело — 422
  const bad = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: 'not-a-phone',
      messengers: {},
      password: 'short',
      consent_video: false,
      consent_data: false,
    }),
  });
  if (bad.status === 422) {ok('invalid body → 422');}
  else {fail(`invalid body → ${bad.status}`);}

  // 5. Неизвестный request_id — 404
  const nf = await fetch(`${BASE}/auth/status/${crypto.randomUUID()}`);
  if (nf.status === 404) {ok('unknown request_id → 404');}
  else {fail(`unknown request_id → ${nf.status}`);}

  // Cleanup — по phone_hash, а не по phone (телефон в БД не хранится в открытом виде)
  const phoneHash = hashForSearch(phone);
  const deleted = await query<{ id: string }>(
    `DELETE FROM registration_requests WHERE phone_hash = $1 RETURNING id`,
    [phoneHash],
  );
  console.log(`  cleanup: deleted ${deleted.length} row(s)`);

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());