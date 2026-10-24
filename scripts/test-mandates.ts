// scripts/test-mandates.ts
// Тест мандатов: выдача → конфликты → ротация → cooldown → делегирование.
// Запуск: pnpm tsx scripts/test-mandates.ts

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

function log(label: string, status: number, data: unknown): void {
  console.warn(`\n─── ${label} ─── [${status}]`);
  console.warn(JSON.stringify(data, null, 2));
}
function ok(m: string) { console.warn(`   ✓ ${m}`); }
function fail(m: string) { console.warn(`   ✗ ${m}`); }

// Чистка следов прошлых прогонов: mandates / cooldowns / delegations / rotations.
// Тест самоподчищающийся, чтобы повторный запуск не падал на COOLDOWN.
async function cleanup(participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) {return;}
  await query(
    `DELETE FROM cooldowns WHERE participant_id = ANY($1::uuid[])`,
    [participantIds],
  );
  await query(
    `DELETE FROM rotations
      WHERE mandate_id IN (
        SELECT id FROM mandates WHERE holder_id = ANY($1::uuid[])
      )`,
    [participantIds],
  );
  await query(
    `DELETE FROM delegations
      WHERE from_id = ANY($1::uuid[]) OR to_id = ANY($1::uuid[])`,
    [participantIds],
  );
  await query(
    `DELETE FROM mandates WHERE holder_id = ANY($1::uuid[])`,
    [participantIds],
  );
  console.warn(`🧹 Cleanup: очищены mandates/cooldowns/delegations для ${participantIds.length} участников`);
}

async function main(): Promise<void> {
  const arch = await makeClient(process.argv[2] ?? '+79000000000', process.argv[3] ?? 'ChangeMe123456');
  const worker = await makeClient(process.argv[4] ?? '+79990001122', process.argv[5] ?? 'TestParticipant123');
  console.warn(`✅ Архитектор: ${arch.participantId}`);
  console.warn(`✅ Исполнитель: ${worker.participantId}`);

  // Чистим следы прошлых прогонов, чтобы тест был идемпотентным
  await cleanup([arch.participantId, worker.participantId]);

  // 1. Выдать Исполнителю мандат COUNCIL_MEMBER на 1 день
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const m1 = await req<{ id: string; function: string; status: string; expiresAt: string }>(
    arch, 'POST', '/mandates', {
      function: 'COUNCIL_MEMBER',
      holder_id: worker.participantId,
      direction_id: worker.directionId,
      expires_at: expiresAt,
    },
  );
  log('POST /mandates { COUNCIL_MEMBER }', m1.status, m1.data);
  if (m1.status !== 201) { fail('mandate create failed'); process.exit(1); }
  const mandateId = m1.data.id;
  ok(`Мандат выдан: ${mandateId}`);

  // 2. Попытка выдать конфликтующий мандат LIAISON — 409
  const conflict = await req(arch, 'POST', '/mandates', {
    function: 'LIAISON',
    holder_id: worker.participantId,
    direction_id: worker.directionId,
    expires_at: expiresAt,
  });
  log('POST /mandates { LIAISON } (ожидаем 409)', conflict.status, conflict.data);
  if (conflict.status === 409) {ok('Конфликт ролей отклонён (COUNCIL ↔ LIAISON)');}

  // 3. Список мандатов
  const list = await req<{ data: unknown[]; meta: { total: number } }>(
    arch, 'GET', `/mandates?holder_id=${worker.participantId}`,
  );
  log('GET /mandates', list.status, { count: list.data.data?.length, total: list.data.meta?.total });
  if ((list.data.data?.length ?? 0) >= 1) {ok('Мандат в списке');}

  // 4. Проверка: /mandates/:id
  const got = await req<{ id: string; function: string; holderId: string }>(arch, 'GET', `/mandates/${mandateId}`);
  log(`GET /mandates/${mandateId}`, got.status, got.data);
  if (got.data.holderId === worker.participantId) {ok('Holder = Исполнитель');}

  // 5. Проверка: активные cooldowns (пусто)
  const cd1 = await req<{ data: unknown[] }>(
    arch, 'GET', `/cooldowns?participant_id=${worker.participantId}`,
  );
  if ((cd1.data.data?.length ?? 0) === 0) {ok('Cooldown отсутствует');}

  // 6. Ротация мандата на Архитектора
  const rotated = await req<{ old: { status: string }; next: { id: string; holderId: string; status: string } }>(
    arch, 'POST', `/mandates/${mandateId}/rotate`, {
      successor_id: arch.participantId,
    },
  );
  log('POST /mandates/:id/rotate', rotated.status, rotated.data);
  if (rotated.status === 200) {
    ok(`Ротация: ${rotated.data.old.status} → ${rotated.data.next.status}`);
    if (rotated.data.next.holderId === arch.participantId) {ok('Новый holder = Архитектор');}
  }

  // 7. Проверка: у Исполнителя появился cooldown
  const cd2 = await req<{ data: Array<{ reason: string; validTo: string }> }>(
    arch, 'GET', `/cooldowns?participant_id=${worker.participantId}`,
  );
  log('GET /cooldowns (после ротации)', cd2.status, cd2.data);
  if ((cd2.data.data?.length ?? 0) >= 1) {
    ok(`Cooldown создан: ${cd2.data.data![0]!.reason}`);
  }

  // 8. Попытка выдать Исполнителю тот же мандат во время cooldown — 403
  const again = await req(arch, 'POST', '/mandates', {
    function: 'COUNCIL_MEMBER',
    holder_id: worker.participantId,
    direction_id: worker.directionId,
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /mandates (cooldown, ожидаем 403)', again.status, again.data);
  if (again.status === 403) {ok('Cooldown работает — 403');}

  // 9. Отзыв мандата Архитектора
  const revoked = await req<{ status: string }>(
    arch, 'DELETE', `/mandates/${rotated.data.next.id}`, {
      reason: 'Тестовый отзыв',
    },
  );
  log('DELETE /mandates/:id', revoked.status, revoked.data);
  if (revoked.data.status === 'revoked') {ok('Мандат отозван');}

  // 9b. Проверка: роль с cooldownDays: null (PSY — постоянная профессия)
  //     После ротации cooldown НЕ создаётся, повторная выдача НЕ падает.
  console.warn('\n─── PSY (cooldownDays: null) — ротация без cooldown ───');
  const mPsy = await req<{ id: string; function: string }>(arch, 'POST', '/mandates', {
    function: 'PSY',
    holder_id: worker.participantId,
    direction_id: worker.directionId,
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /mandates { PSY }', mPsy.status, mPsy.data);
  if (mPsy.status !== 201) {
    fail('PSY не выдан');
  } else {
    const rotPsy = await req<{ next: { id: string } }>(
      arch, 'POST', `/mandates/${mPsy.data.id}/rotate`, {
        successor_id: arch.participantId,
      },
    );
    log('POST /mandates/:id/rotate { PSY }', rotPsy.status, rotPsy.data);
    if (rotPsy.status === 200) {ok('PSY ротирован');}

    // Проверка cooldown: у worker НЕ должно появиться cooldown с reason LIKE 'rotation:PSY%'
    const cdPsy = await req<{ data: Array<{ reason: string }> }>(
      arch, 'GET', `/cooldowns?participant_id=${worker.participantId}`,
    );
    const psyCooldowns = (cdPsy.data.data ?? []).filter((c) => c.reason.startsWith('rotation:PSY'));
    if (psyCooldowns.length === 0) {
      ok('Cooldown для PSY НЕ создан (cooldownDays: null) — правка 1+2 работает');
    } else {
      fail(`ОШИБКА: создан cooldown для PSY: ${JSON.stringify(psyCooldowns)}`);
    }

    // Повторная выдача PSY worker'у — не должна падать с COOLDOWN
    const mPsy2 = await req<{ id: string }>(arch, 'POST', '/mandates', {
      function: 'PSY',
      holder_id: worker.participantId,
      direction_id: worker.directionId,
      expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    });
    log('POST /mandates { PSY } повторно', mPsy2.status, mPsy2.data);
    if (mPsy2.status === 201) {
      ok('PSY выдан повторно сразу после ротации — cooldown не блокирует');
      // Прибираем за собой
      await req(arch, 'DELETE', `/mandates/${mPsy2.data.id}`, { reason: 'cleanup' });
    } else if (mPsy2.status === 403) {
      fail('ОШИБКА: cooldown блокирует повторную выдачу PSY');
    }
  }

  // 10. Делегирование: Исполнитель → Архитектор невозможен (нет активного мандата у Исполнителя).
  //     Выдаём Исполнителю новый уникальный мандат — COUNCIL_MEMBER в другом направлении,
  //     но сначала дождёмся cooldown. Вместо этого дадим Архитектору мандат, а он делегирует Исполнителю.
  //     Сначала выдаём Архитектору OTC (не конфликтует с COUNCIL_MEMBER? — по ролям COUNCIL↔OTC конфликтует).
  //     Используем VERIFIER — не конфликтует.
  const m2 = await req<{ id: string }>(arch, 'POST', '/mandates', {
    function: 'VERIFIER',
    holder_id: arch.participantId,
    direction_id: arch.directionId,
    expires_at: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
  });
  log('POST /mandates { VERIFIER }', m2.status, m2.data);
  if (m2.status !== 201) {
    console.warn('   ℹ Пропускаем делегирование — не удалось выдать базовый мандат');
  } else {
    // 11. Архитектор делегирует VERIFIER Исполнителю
    const delegation = await req<{ id: string; function: string; toId: string; status: string }>(
      arch, 'POST', '/delegations', {
        function: 'VERIFIER',
        to_id: worker.participantId,
        valid_to: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      },
    );
    log('POST /delegations', delegation.status, delegation.data);
    if (delegation.status === 201) {ok('Делегирование создано');}

    // 12. Список делегирований
    const delList = await req<{ data: unknown[] }>(arch, 'GET', '/delegations');
    log('GET /delegations', delList.status, { count: delList.data.data?.length });

    // 13. Отзыв делегирования
    if (delegation.status === 201) {
      const delRev = await req(arch, 'DELETE', `/delegations/${delegation.data.id}`);
      if (delRev.status === 204) {ok('Делегирование отозвано');}
    }
  }

  // 14. Список мандатов «due» (предстоящие)
  const due = await req<{ data: unknown[] }>(arch, 'GET', '/mandates/due?within_days=365');
  log('GET /mandates/due?within_days=365', due.status, { count: due.data.data?.length });

  // 15. Cron-задача — обработать просроченные
  const processed = await req<{ rotated: number; cooldownsCreated: number }>(
    arch, 'POST', '/mandates/process-expired',
  );
  log('POST /mandates/process-expired', processed.status, processed.data);

  console.warn('\n✅ Тест Mandates завершён');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});