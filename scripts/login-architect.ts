// scripts/ensure-webhooks-cron.ts
//
// Идемпотентно создаёт (или обновляет) сервисного участника для
// K8s CronJob I.3.05.08 (webhooks-process-retries).
//
// Запуск: pnpm tsx scripts/ensure-webhooks-cron.ts <password>
//
// Переменные окружения (опционально):
//   WEBHOOKS_CRON_PHONE       — телефон (по умолч. +70000000003)
//   WEBHOOKS_CRON_EXTERNAL_ID — external_id (по умолч. В90003-01)
//   API_URL                   — для self-check

import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { query, queryOne, transaction } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword } from '../src/security/password.js';

// ─── Конфиг ──────────────────────────────────────────────────────

const EXTERNAL_ID = process.env['WEBHOOKS_CRON_EXTERNAL_ID'] ?? 'В90003-01';
const NAME = 'Webhooks Cron Worker';
const PHONE = process.env['WEBHOOKS_CRON_PHONE'] ?? '+70000000003';
const API_URL = process.env['API_URL'] ?? 'http://localhost:3000';
const ROLE_NAME = 'PROTOCOL_COUNCIL';
const RIGHT_RESOURCE = 'webhook';

// ─── Утилиты ─────────────────────────────────────────────────────

function ok(msg: string): void   { console.log(`   ✓ ${msg}`); }
function fail(msg: string): void { console.log(`   ✗ ${msg}`); }
function info(msg: string): void { console.log(`   · ${msg}`); }

// ─── Self-check ──────────────────────────────────────────────────

interface LoginResponse {
  access_token: string;
  participant: { id: string; direction_id: string };
}

interface PermissionsMeResponse {
  roles: string[];
  rights: Record<string, string[]>;
}

async function selfCheck(password: string): Promise<{
  ok: boolean;
  rights: string[];
}> {
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, password }),
  });
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
    console.error('Usage: pnpm tsx scripts/ensure-webhooks-cron.ts <password>');
    console.error('Password must be at least 16 chars.');
    process.exit(1);
  }

  console.log(`→ Сервисный участник: ${EXTERNAL_ID} / ${PHONE}`);

  // 1. Роль PROTOCOL_COUNCIL + направление одним запросом.
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
        `Проверьте seed ролей (D.2.01.07).`,
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

  // 2. Идемпотентный upsert.
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

  // 3. Роль PROTOCOL_COUNCIL — напрямую в participant_roles.
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

  // 4. Сброс кэша прав.
  try {
    const rightsMod = await import('../src/core/rights.js');
    await rightsMod.invalidateRightsMatrixCache();
    info('кэш матрицы прав сброшен');
  } catch (e) {
    console.warn(`   ⚠ не удалось сбросить кэш прав: ${String(e).slice(0, 80)}`);
  }

  // 5. Self-check.
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
        '   Проверьте FALLBACK_PERMISSIONS (C.0.01.06):\n' +
        `   [Role.${ROLE_NAME}]: { ${RIGHT_RESOURCE}: ['V','C','E','D'], ... }\n` +
        '   (Act появится через wildcard от FIRST_ARCHITECT или при ручной выдаче)\n',
    );
    await gracefulShutdown();
    process.exit(1);
  }
  ok(`${RIGHT_RESOURCE} права: [${check.rights.join(', ')}]`);

  // 6. Итог.
  console.log('\n✅ Сервисный участник готов:');
  console.log(`   external_id : ${EXTERNAL_ID}`);
  console.log(`   id          : ${participantId}`);
  console.log(`   phone       : ${PHONE}`);
  console.log(`   direction   : ${direction.id} (#${direction.number})`);
  console.log(`   role        : ${ROLE_NAME}`);
  console.log('\n→ K8s Secret `xartia-webhooks-cron`:\n');
  console.log(`     kubectl create secret generic xartia-webhooks-cron \\`);
  console.log(`       --namespace xartia \\`);
  console.log(`       --from-literal=phone='${PHONE}' \\`);
  console.log(`       --from-literal=password='<тот_же_пароль>'`);
  console.log('\n→ Деплой CronJob:');
  console.log('     kubectl apply -f k8s/worker/cronjob-webhooks-retry.yml\n');

  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});