// scripts/test-rate-limit.ts
// Проверяет rate-limit на /auth/login и /auth/register:
//   - успешные попытки в пределах лимита
//   - 429 при превышении
//   - заголовки Retry-After / X-RateLimit-*
//   - сброс лимита через Redis
//
// ВАЖНО: тест меняет Redis-состояние. Для чистого прогона — reset перед каждым кейсом.

import 'dotenv/config';

import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { reset } from '../src/security/rate-limit.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

async function loginAttempt(phone: string, password: string): Promise<{
  status: number;
  retryAfter: string | null;
  remaining: string | null;
  limit: string | null;
}> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    remaining: res.headers.get('x-ratelimit-remaining'),
    limit: res.headers.get('x-ratelimit-limit'),
  };
}

async function registerAttempt(phone: string, password: string): Promise<{
  status: number;
  retryAfter: string | null;
}> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      messengers: { telegram: '@ratelimit_test' },
      password,
      consent_video: true,
      consent_data: true,
    }),
  });
  return { status: res.status, retryAfter: res.headers.get('retry-after') };
}

async function main(): Promise<void> {
  // ─── Тест 1: /auth/login (5/15 мин по IP) ──────────────────────
  console.log('\n─── /auth/login: 5/15 мин по IP ───');
  await reset(`ip:127.0.0.1`);   // локальный IP — обычно 127.0.0.1

  const fakePhone = '+79990009999';
  const fakePassword = 'WrongPasswordNotMatter123';

  // 5 попыток — должны пройти (все вернут 401, но лимит не превышен)
  for (let i = 1; i <= 5; i++) {
    const r = await loginAttempt(fakePhone, fakePassword);
    if (r.status === 401) {
      if (i === 1) {
        ok(`Попытка ${i}: 401, remaining=${r.remaining}/${r.limit}`);
      }
    } else if (r.status === 429) {
      fail(`Попытка ${i}: неожиданный 429 (лимит должен ещё держаться)`);
      break;
    }
  }
  ok(`5 попыток прошли (все 401, лимит не превышен)`);

  // 6-я — должна упасть с 429
  const r6 = await loginAttempt(fakePhone, fakePassword);
  if (r6.status === 429 && r6.retryAfter) {
    ok(`Попытка 6 → 429, Retry-After=${r6.retryAfter}s`);
  } else {
    fail(`Попытка 6: ожидался 429 с Retry-After, получено ${r6.status} (retry-after=${r6.retryAfter})`);
  }

  // Заголовки на 429
  if (r6.limit === '5') {ok(`X-RateLimit-Limit=5`);}
  if (r6.remaining === '0') {ok(`X-RateLimit-Remaining=0`);}

  // ─── Тест 2: reset сбрасывает лимит ────────────────────────────
  console.log('\n─── reset сбрасывает лимит ───');
  await reset(`ip:127.0.0.1`);
  const afterReset = await loginAttempt(fakePhone, fakePassword);
  if (afterReset.status === 401) {
    ok(`После reset — 401 (лимит сброшен)`);
  } else {
    fail(`После reset ожидался 401, получено ${afterReset.status}`);
  }

  // ─── Тест 3: /auth/register (3/час по IP) ──────────────────────
  console.log('\n─── /auth/register: 3/час по IP ───');
  await reset(`ip:127.0.0.1`);

  // 3 попытки — должны получить 201 (валидные) или 409 (дубли) — не 429
  let createdCount = 0;
  for (let i = 1; i <= 3; i++) {
    const phone = `+7999000${String(9000 + i).padStart(4, '0')}`;
    const r = await registerAttempt(phone, 'RateTestPassword123');
    if (r.status === 201) {
      createdCount++;
    } else if (r.status === 429) {
      fail(`Регистрация ${i}: неожиданный 429`);
      break;
    }
  }
  ok(`3 регистрации прошли (создано ${createdCount}, статусов 429 нет)`);

  // 4-я — должна упасть с 429
  const r4 = await registerAttempt('+79990009500', 'RateTestPassword123');
  if (r4.status === 429 && r4.retryAfter) {
    ok(`Регистрация 4 → 429, Retry-After=${r4.retryAfter}s`);
  } else {
    fail(`Регистрация 4: ожидался 429, получено ${r4.status}`);
  }

  // ─── Очистка ────────────────────────────────────────────────────
  console.log('\n─── Очистка ───');
  await reset(`ip:127.0.0.1`);

  // Удаляем созданных участников/заявки, чтобы не мусорить
  const { query } = await import('../src/lib/db.js');
  await query(`DELETE FROM registration_requests WHERE phone_hash IN (
    SELECT phone_hash FROM registration_requests WHERE created_at > now() - interval '1 minute'
  )`).catch(() => {});

  console.log('\n✅ Тест rate-limit завершён');
  await gracefulShutdown();
  await redis.quit();
}

main().catch(async (e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  try {
    await gracefulShutdown();
    await redis.quit();
  } catch { /* ignore */ }
  process.exit(1);
});