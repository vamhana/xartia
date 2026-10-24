// scripts/ensure-automation-cron.ts
//
// Идемпотентно создаёт (или обновляет) сервисного участника для
// K8s CronJob I.3.05.07 (automation-daily-audit).
//
// Запуск: pnpm tsx scripts/ensure-automation-cron.ts <password>
//
// Переменные окружения (опционально):
//   AUTOMATION_CRON_PHONE       — телефон (по умолч. +70000000002)
//   AUTOMATION_CRON_EXTERNAL_ID — external_id (по умолч. А90002-12)
//   API_URL                     — для self-check

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { query, queryOne, transaction } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

// ─── Конфиг ──────────────────────────────────────────────────────

const EXTERNAL_ID = process.env['AUTOMATION_CRON_EXTERNAL_ID'] ?? 'К00002-12';
const NAME = 'Automation Cron Worker';
const PHONE = process.env['AUTOMATION_CRON_PHONE'] ?? '+70000000002';
const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const ROLE_NAME = 'OPERATOR';
const RIGHT_RESOURCE = 'automation';

// ─── Утилиты ─────────────────────────────────────────────────────

function ok(msg: string): void   { console.log(`   ✓ ${msg}`); }
function fail(msg: string): void { console.log(`   ✗ ${msg}`); }
function info(msg: string): void { console.log(`   · ${msg}`); }

// ─── Self-check через боевой /auth/login ─────────────────────────

interface LoginResponse {
  access_token: string;
  participant: { id: string; direction_id: string };
}

interface PermissionsMeResponse {
  roles: string[];
  rights: Record<string, string[]>;
}

async function selfCheck(password: string, attempt = 1): Promise<{ ok: boolean; rights: string[] }> {
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, password }),
  });

  // 429 — rate-limit. У smoke-теста это ожидаемо при частых прогонах:
  // ratelimit:auth.login:* в Redis живёт 15 минут. Ретраим до 3 попыток
  // с backoff из details.retry_after_sec (или 5s по умолчанию).
  if (loginRes.status === 429 && attempt < 3) {
    const j = (await loginRes.clone().json().catch(() => ({}))) as {
      details?: { retry_after_sec?: number };
    };
    const raw = j?.details?.retry_after_sec;
    const wait = Math.max(1, Math.min(typeof raw === 'number' ? raw : 5, 30));
    console.warn(`   ⚠ 429 rate-limit, retry через ${wait}s (attempt ${attempt}/3)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return selfCheck(password, attempt + 1);
  }

  if (!loginRes.ok) {
    const text = await loginRes.text().catch(() => '');
    throw new Error(`login failed: HTTP ${loginRes.status} ${text.slice(0, 200)}`);
  }
  const login = (await loginRes.json()) as LoginResponse;
  info(`login ok, participant=${login.participant.id}`);

  const meRes = await fetch(`${API_URL}/permissions/me`, {
    headers: { Authorization: `Bearer ${login.access_token}` },
  });
  if (!meRes.ok) {
    throw new Error(`/permissions/me failed: HTTP ${meRes.status}`);
  }
  const me = (await meRes.json()) as PermissionsMeResponse;
  const rights = me.rights[RIGHT_RESOURCE] ?? [];
  return { ok: rights.includes('Act'), rights };
}

// ─── Основной сценарий ───────────────────────────────────────────

async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password || password.length < 16) {
    console.error('Usage: pnpm tsx scripts/ensure-automation-cron.ts <password>');
    console.error('Password must be at least 16 chars.');
    process.exit(1);
  }

  console.log(`→ Сервисный участник: ${EXTERNAL_ID} / ${PHONE}`);

  // 1. Роль OPERATOR и её направление одним запросом.
  //    roles.name НЕ UNIQUE — по строке на направление. Ищем любое
  //    активное направление, где засеяна роль OPERATOR.
  const roleWithDir = await queryOne<{
    id: string;
    direction_id: string;
    d_number: number;
    d_name: string;
  }>(
    `SELECT r.id, r.direction_id,
            d.number AS d_number, d.name AS d_name
       FROM roles r
       JOIN directions d ON d.id = r.direction_id
      WHERE r.name = $1 AND r.active = true AND d.status = 'active'
      ORDER BY d.number ASC
      LIMIT 1`,
    [ROLE_NAME],
  );
  if (!roleWithDir) {
    throw new Error(
      `Роль ${ROLE_NAME} не найдена ни в одном активном направлении. ` +
        `Примените миграцию 022_seed_operator_role.sql.`,
    );
  }
  const role = { id: roleWithDir.id };
  const direction = {
    id: roleWithDir.direction_id,
    number: roleWithDir.d_number,
    name: roleWithDir.d_name,
  };
  info(`direction: ${direction.id} (#${direction.number} ${direction.name})`);
  info(`role: ${ROLE_NAME} (${role.id})`);

  const passwordHash = await hashPassword(password);
  const phoneHash = hashForSearch(PHONE);
  const encryptedPhone = encryptField(PHONE);

  // 3. Идемпотентный upsert.
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM participants
      WHERE external_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [EXTERNAL_ID],
  );

  let participantId: string;

  if (existing) {
    participantId = existing.id;
    await query(
      `UPDATE participants
          SET password_hash = $2,
              phone = $3,
              phone_hash = $4,
              updated_at = now()
        WHERE id = $1`,
      [participantId, passwordHash, encryptedPhone, phoneHash],
    );
    ok(`обновлён пароль (id=${participantId})`);
  } else {
    participantId = randomUUID();
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO participants
           (id, external_id, wave_letter, wave_number, direction_id,
            name, phone, phone_hash, messengers, password_hash,
            status, profile_risk, entered_at)
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6,
                 '{}'::jsonb, $7, 'associated', 'compatible', now())`,
        [
          participantId,
          EXTERNAL_ID,
          direction.id,
          NAME,
          encryptedPhone,
          phoneHash,
          passwordHash,
        ],
      );
      await client.query(
        `INSERT INTO participant_status_history (participant_id, status, reason)
         VALUES ($1, 'associated', 'cron-worker bootstrap')`,
        [participantId],
      );
    });
    ok(`создан (id=${participantId})`);
  }

  // 4. Роль OPERATOR.
  const hasRole = await queryOne<{ id: string }>(
    `SELECT id FROM participant_roles
      WHERE participant_id = $1 AND role_id = $2 AND status = 'active'
      LIMIT 1`,
    [participantId, role.id],
  );

  if (!hasRole) {
    await query(
      `INSERT INTO participant_roles
         (id, participant_id, role_id, direction_id,
          valid_from, status, granted_by)
       VALUES ($1, $2, $3, $4, now(), 'active', $2)`,
      [randomUUID(), participantId, role.id, direction.id],
    );
    ok(`назначена роль ${ROLE_NAME}`);
  } else {
    ok(`роль ${ROLE_NAME} уже назначена`);
  }

  // 5. Сброс кэша прав.
  try {
    const rightsMod = await import('../src/core/rights.js');
    await rightsMod.invalidateRightsMatrixCache();
    info('кэш матрицы прав сброшен');
  } catch (e) {
    console.warn(`   ⚠ не удалось сбросить кэш прав: ${String(e).slice(0, 80)}`);
  }

  // 6. Self-check.
  console.log('\n→ Само-проверка через боевой /auth/login…');

  let check: { ok: boolean; rights: string[] };
  try {
    check = await selfCheck(password);
  } catch (e) {
    fail(`login/permissions: ${e instanceof Error ? e.message : String(e)}`);
    console.error(
      '\n⚠ Участник создан/обновлён, но self-check не прошёл. ' +
        'Проверьте API_URL и что сервер поднят.\n',
    );
    await gracefulShutdown();
    process.exit(1);
  }

  if (!check.ok) {
    fail(`${RIGHT_RESOURCE} права: [${check.rights.join(', ') || 'пусто'}]`);
    console.error(
      '\n⚠ У сервисного участника НЕТ ' + RIGHT_RESOURCE + ':Act.\n' +
        '   Проверьте seed прав в rights_matrix:\n' +
        `   SELECT rm.resource, rm.action, rm.scope\n` +
        `     FROM rights_matrix rm\n` +
        `     JOIN roles r ON r.id = rm.role_id\n` +
        `    WHERE r.name = '${ROLE_NAME}' AND rm.resource = '${RIGHT_RESOURCE}';\n` +
        '\n   Если записи нет — добавьте в FALLBACK_PERMISSIONS (C.0.01.06):\n' +
        `   [Role.${ROLE_NAME}]: { ${RIGHT_RESOURCE}: ['V','C','E','A','Act'], ... }\n` +
        '   Fallback сработает, если роль отсутствует в БД.\n',
    );
    await gracefulShutdown();
    process.exit(1);
  }
  ok(`${RIGHT_RESOURCE} права: [${check.rights.join(', ')}]`);

  // 7. Итог.
  console.log('\n✅ Сервисный участник готов:');
  console.log(`   external_id : ${EXTERNAL_ID}`);
  console.log(`   id          : ${participantId}`);
  console.log(`   phone       : ${PHONE}`);
  console.log(`   direction   : ${direction.id} (#${direction.number})`);
  console.log(`   role        : ${ROLE_NAME}`);
  console.log('\n→ K8s Secret `xartia-automation-cron`:\n');
  console.log(`     kubectl create secret generic xartia-automation-cron \\`);
  console.log(`       --namespace xartia \\`);
  console.log(`       --from-literal=phone='${PHONE}' \\`);
  console.log(`       --from-literal=password='<тот_же_пароль>'`);
  console.log('\n→ Деплой CronJob:');
  console.log('     kubectl apply -f k8s/worker/cronjob-automation.yml\n');

  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});