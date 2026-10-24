// scripts/ensure-architect.ts
// Идемпотентно обеспечивает наличие первого Архитектора.
//
//   1. Нет Архитектора          → создаёт (полный bootstrap).
//   2. Есть, но с placeholder   → обновляет его поля (не удаляет!).
//   3. Есть и готов             → ничего не делает.
//
// Env (дефолты для dev):
//   ARCHITECT_PHONE     = +79001234567
//   ARCHITECT_NAME      = "Первый Архитектор"
//   ARCHITECT_PASSWORD  = "ChangeMe123456"
//
// Запуск: pnpm tsx scripts/ensure-architect.ts

import 'dotenv/config';

import { Client, type PoolClient } from 'pg';

import { newUUID } from '../src/lib/id.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword, validatePasswordOrThrow } from '../src/security/password.js';

const DEFAULT_PHONE = '+79001234567';
const DEFAULT_NAME = 'Первый Архитектор';
const DEFAULT_PASSWORD = 'ChangeMe123456';
const WELCOME_PACK = 200;
const PLACEHOLDER_PREFIX = '$argon2id$placeholder';

function normalizePhone(input: string): string {
  let s = input.replace(/[\s\-()]/g, '');
  if (/^8\d{10}$/.test(s)) {s = '+7' + s.slice(1);}
  if (/^7\d{10}$/.test(s)) {s = '+' + s;}
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {
    throw new Error(`Некорректный телефон: ${input}`);
  }
  return s;
}

async function ensureFirstArchitectRole(
  c: PoolClient,
  directionId: string,
): Promise<string> {
  const existing = await c.query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'FIRST_ARCHITECT' AND direction_id = $1 LIMIT 1`,
    [directionId],
  );
  if (existing.rowCount) {return existing.rows[0]!.id;}

  const inserted = await c.query<{ id: string }>(
    `INSERT INTO roles
       (direction_id, name, type, max_term_days, max_terms, cooldown_days)
     VALUES ($1, 'FIRST_ARCHITECT', 'permanent', NULL, NULL, NULL)
     RETURNING id`,
    [directionId],
  );
  return inserted.rows[0]!.id;
}

async function ensureRoleAssignment(
  c: PoolClient,
  participantId: string,
  roleId: string,
  directionId: string,
): Promise<boolean> {
  const has = await c.query(
    `SELECT 1 FROM participant_roles
      WHERE participant_id = $1 AND role_id = $2 AND status = 'active'
      LIMIT 1`,
    [participantId, roleId],
  );
  if (has.rowCount) {return false;}

  await c.query(
    `INSERT INTO participant_roles
       (participant_id, role_id, direction_id, status, granted_by)
     VALUES ($1, $2, $3, 'active', $1)`,
    [participantId, roleId, directionId],
  );
  return true;
}

async function ensureWelcomePack(
  c: PoolClient,
  participantId: string,
): Promise<boolean> {
  const has = await c.query(
    `SELECT 1 FROM flow_transactions
      WHERE participant_id = $1 AND reason = 'Приветственный пакет'
      LIMIT 1`,
    [participantId],
  );
  if (has.rowCount) {return false;}

  await c.query(
    `INSERT INTO flow_transactions
       (participant_id, type, amount, reason, source)
     VALUES ($1, 'main', $2, 'Приветственный пакет', 'system')`,
    [participantId, WELCOME_PACK],
  );
  await c.query(
    `UPDATE participants SET welcome_pack_given = true WHERE id = $1`,
    [participantId],
  );
  return true;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {throw new Error('DATABASE_URL не задан ни в окружении, ни в .env');}

  const phone = normalizePhone(process.env.ARCHITECT_PHONE ?? DEFAULT_PHONE);
  const name = process.env.ARCHITECT_NAME ?? DEFAULT_NAME;
  const password = process.env.ARCHITECT_PASSWORD ?? DEFAULT_PASSWORD;

  validatePasswordOrThrow(password);

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Направление №1 (техническая привязка)
    const dir = await client.query<{ id: string }>(
      `SELECT id FROM directions WHERE number = 1 LIMIT 1`,
    );
    if (!dir.rowCount) {
      throw new Error('Направление №1 не найдено. Сначала примените 007_seeds.sql');
    }
    const directionId = dir.rows[0]!.id;

    const phoneHash = hashForSearch(phone);
    const encryptedPhone = encryptField(phone);
    const passwordHash = await hashPassword(password);

    // ── 1. Ищем существующего Архитектора ─────────────────────
    const existing = await client.query<{
      id: string;
      external_id: string;
      password_hash: string;
    }>(
      `SELECT id, external_id, password_hash
         FROM participants
        WHERE is_first_architect = true
        LIMIT 1`,
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0]!;
      const isPlaceholder =
        row.password_hash === PLACEHOLDER_PREFIX ||
        row.password_hash.startsWith(PLACEHOLDER_PREFIX);

      if (!isPlaceholder) {
        console.log(`  ✓ Архитектор уже готов: ${row.external_id}`);
        console.log(`    (пароль установлен, не трогаем)`);
        return;
      }

      // ── 1a. Placeholder → настоящий Архитектор (UPDATE) ─────
      console.log(`  ⚠ Архитектор с placeholder-паролем: ${row.external_id}`);
      console.log(`    Обновляю поля (виджеты и FK не трогаем)...`);

      await client.query('BEGIN');
      try {
        await client.query(
          `UPDATE participants
             SET name = $2,
                 phone = $3,
                 phone_hash = $4,
                 password_hash = $5,
                 status = 'master',
                 profile_risk = 'compatible'
           WHERE id = $1`,
          [row.id, name, encryptedPhone, phoneHash, passwordHash],
        );

        const roleId = await ensureFirstArchitectRole(client, directionId);
        await ensureRoleAssignment(client, row.id, roleId, directionId);
        await ensureWelcomePack(client, row.id);

        await client.query(
          `INSERT INTO participant_status_history
             (participant_id, status, reason)
           VALUES ($1, 'master', 'ensure_architect_update')`,
          [row.id],
        );

        await client.query(
          `INSERT INTO audit_log
             (actor_id, actor_type, action, entity_type, entity_id, new_value)
           VALUES (NULL, 'system', 'admin.ensure_architect_update',
                   'participant', $1, $2)`,
          [
            row.id,
            JSON.stringify({ external_id: row.external_id, updated: true }),
          ],
        );

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      }

      console.log(`  ✓ Архитектор обновлён: ${row.external_id}`);
      console.log(`    Телефон: ${phone}`);
      console.log(`    Пароль:  ${password}`);
      return;
    }

    // ── 2. Нет Архитектора → создаём с нуля ───────────────────
    console.log(`  · Архитектора нет, создаю...`);

    const participantId = newUUID();
    const externalId = 'А00001-1';

    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO participants
           (id, external_id, wave_letter, wave_number, direction_id, name,
            phone, phone_hash, messengers, password_hash, status, profile_risk,
            welcome_pack_given, is_first_architect)
         VALUES ($1, $2, 'А', 1, $3, $4, $5, $6, $7, $8,
                 'master', 'compatible', false, true)`,
        [
          participantId,
          externalId,
          directionId,
          name,
          encryptedPhone,
          phoneHash,
          JSON.stringify({ telegram: '@first_architect' }),
          passwordHash,
        ],
      );

      const roleId = await ensureFirstArchitectRole(client, directionId);
      await ensureRoleAssignment(client, participantId, roleId, directionId);
      await ensureWelcomePack(client, participantId);

      await client.query(
        `INSERT INTO participant_status_history
           (participant_id, status, reason)
         VALUES ($1, 'master', 'ensure_architect_create')`,
        [participantId],
      );

      await client.query(
        `INSERT INTO audit_log
           (actor_id, actor_type, action, entity_type, entity_id, new_value)
         VALUES (NULL, 'system', 'admin.ensure_architect_create',
                 'participant', $1, $2)`,
        [
          participantId,
          JSON.stringify({ external_id: externalId, direction_id: directionId }),
        ],
      );

      await client.query('COMMIT');

      console.log(`  ✓ Архитектор создан: ${externalId}`);
      console.log(`    Телефон: ${phone}`);
      console.log(`    Пароль:  ${password}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('✗ ensure-architect:', e instanceof Error ? e.message : e);
  process.exit(1);
});