// scripts/test-create-from-request-race.ts
// Тест на race condition в createFromRequest.
//
// Сценарий:
//   1. POST /auth/register — создаём заявку через API.
//   2. Два параллельных вызова createFromRequest с ОДНИМ requestId.
//   3. Проверяем: ровно один успешен, второй → ConflictError.
//   4. В БД ровно один участник с этим phone_hash.
//
// Запуск: pnpm tsx scripts/test-create-from-request-race.ts

import 'dotenv/config';
import { ConflictError } from '../src/core/errors.js';
import { createFromRequest } from '../src/core/participants/service.js';
import { query, queryOne } from '../src/lib/db.js';
import { redis } from '../src/lib/redis.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { hashForSearch } from '../src/security/encryption.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

function ok(m: string) { console.log(`   ✓ ${m}`); }
function fail(m: string) { console.log(`   ✗ ${m}`); }

// Создаём заявку через API (публичный endpoint)
async function registerRequest(phone: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      messengers: { telegram: '@race_test' },
      password,
      consent_video: true,
      consent_data: true,
    }),
  });
  const data = await res.json() as { request_id?: string; code?: string; message?: string };
  if (!res.ok || !data.request_id) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.request_id;
}

// Чистим ratelimit-ключи — иначе тест упадёт на накопленных 429.
async function clearRedis(pattern: string): Promise<number> {
  const script = `
    local keys = redis.call('KEYS', ARGV[1])
    for i=1,#keys do redis.call('DEL', keys[i]) end
    return #keys
  `;
  return await redis.eval(script, 0, pattern) as number;
}

async function cleanup(phoneHash: string, requestId: string): Promise<void> {
  await query(`DELETE FROM participant_status_history WHERE participant_id IN (SELECT id FROM participants WHERE phone_hash = $1)`, [phoneHash]);
  await query(`DELETE FROM participants WHERE phone_hash = $1`, [phoneHash]);
  await query(`DELETE FROM registration_requests WHERE id = $1`, [requestId]);
  console.log(`🧹 Cleanup: заявка и участник удалены`);
}

async function main(): Promise<void> {
  // Очищаем rate-limit — тест делает 2 регистрации, легко попасть в лимит 3/час.
  const cleared = await clearRedis('ratelimit:*');
  console.log(`ℹ Очищено rate-limit: ${cleared}`);

  // Динамический телефон, чтобы не конфликтовать с другими тестами
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const phone = `+7999000${suffix}`;       // E.164, 11 цифр
  const password = 'RaceTestPassword123';

  console.log(`📞 Телефон: ${phone}`);

  // 1. Заявка через API
  const requestId = await registerRequest(phone, password);
  ok(`Заявка создана через API: ${requestId}`);

  const phoneHash = hashForSearch(phone);

  // Первичная очистка на случай грязи
  await cleanup(phoneHash, requestId);
  // Пересоздаём заявку (cleanup её удалил)
  const requestId2 = await registerRequest(phone, password);
  ok(`Заявка пересоздана: ${requestId2}`);

  // 2. Параллельные вызовы createFromRequest с ОДНИМ requestId
  const input = {
    requestId: requestId2,
    interviewerId: '00000000-0000-0000-0000-000000000000',  // заглушка
    directionId: '43cf7775-fe20-45e4-93c7-fc9ca6485ff2',    // любой существующий direction
    directionNumber: 1,
    professionId: null,
    wave: 'А',
    waveNumber: 90000 + Math.floor(Math.random() * 9000),
    name: `Race Test ${suffix}`,
  };

  console.log('\n─── ЗАПУСК ПАРАЛЛЕЛЬНЫХ createFromRequest ───');
  const results = await Promise.allSettled([
    createFromRequest(input),
    createFromRequest(input),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  console.log(`   Fulfilled: ${fulfilled.length}, Rejected: ${rejected.length}`);

  // 3. Проверки
  if (fulfilled.length === 1) {
    ok(`Ровно один createFromRequest успешен`);
  } else {
    fail(`Ожидался 1 успех, получено ${fulfilled.length}`);
  }

  if (rejected.length === 1) {
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    if (reason instanceof ConflictError) {
      ok(`Второй вызов отклонён с ConflictError: "${reason.message}"`);
    } else {
      fail(`Ожидался ConflictError, получено: ${reason}`);
    }
  } else {
    fail(`Ожидался 1 отклонённый, получено ${rejected.length}`);
  }

  // 4. В БД — ровно один участник
  const cnt = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM participants WHERE phone_hash = $1`,
    [phoneHash],
  );
  const participantsCount = parseInt(cnt?.c ?? '0', 10);
  if (participantsCount === 1) {
    ok(`В БД ровно 1 участник с этим phone_hash`);
  } else {
    fail(`В БД ${participantsCount} участников (ожидался 1)`);
  }

  // 5. Заявка в статусе accepted
  const reqRow = await queryOne<{ status: string }>(
    `SELECT status FROM registration_requests WHERE id = $1`,
    [requestId2],
  );
  if (reqRow?.status === 'accepted') {
    ok(`Заявка в статусе 'accepted'`);
  } else {
    fail(`Статус заявки: ${reqRow?.status ?? 'null'} (ожидался 'accepted')`);
  }

  console.log('\n✅ Тест race завершён');
  await cleanup(phoneHash, requestId2);
  await gracefulShutdown();
}

main()
  .catch((e) => {
    console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await gracefulShutdown(); } catch { /* ignore */ }
  });