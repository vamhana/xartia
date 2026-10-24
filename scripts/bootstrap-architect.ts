// scripts/bootstrap-architect.ts
// Одноразовый bootstrap первого Архитектора.
// Минует очередь регистрации. Создаёт участника, роль, welcome pack.
// Запуск: pnpm bootstrap +79000000000 "Имя" "Пароль123"

import 'dotenv/config';

import { WELCOME_PACK } from '../src/core/constants.js';
import { transaction } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword, validatePasswordOrThrow } from '../src/security/password.js';

// -------- Нормализация телефона --------

function normalizePhone(input: string): string {
  let s = input.replace(/[\s\-()]/g, '');
  if (/^8\d{10}$/.test(s)) {s = '+7' + s.slice(1);}
  if (/^7\d{10}$/.test(s)) {s = '+' + s;}
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {
    throw new Error(`Некорректный телефон: ${input}`);
  }
  return s;
}

// -------- Main --------

async function main(): Promise<void> {
  const [rawPhone, name, password] = process.argv.slice(2);

  if (!rawPhone || !name || !password) {
    console.error('Использование: pnpm bootstrap <телефон> <имя> <пароль>');
    console.error('Пример: pnpm bootstrap +79000000000 "Первый Архитектор" "ChangeMe123456"');
    process.exit(1);
  }

  const phone = normalizePhone(rawPhone);
  validatePasswordOrThrow(password);

  console.log('→ Нормализованный телефон:', phone);
  console.log('→ Имя:', name);

  const phoneHash = hashForSearch(phone);
  const encryptedPhone = encryptField(phone);
  const passwordHash = await hashPassword(password);

  const result = await transaction(async (client) => {
    // 1. Проверка: нет ли уже Архитектора
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM participants WHERE is_first_architect = true LIMIT 1`,
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error('Архитектор уже существует: ' + existing.rows[0]!.id);
    }

    // 2. Проверка: телефон не занят
    const phoneTaken = await client.query(
      `SELECT 1 FROM participants WHERE phone_hash = $1 LIMIT 1`,
      [phoneHash],
    );
    if (phoneTaken.rowCount && phoneTaken.rowCount > 0) {
      throw new Error('Телефон уже зарегистрирован');
    }

    // 3. Направление №1 — техническая привязка для Архитектора
    //    (в схеме direction_id NOT NULL; у Архитектора нет своего направления)
    const dir = await client.query<{ id: string }>(
      `SELECT id FROM directions WHERE number = 1 LIMIT 1`,
    );
    if (!dir.rowCount || dir.rowCount === 0) {
      throw new Error('Направление №1 не найдено. Сначала примените 007_seeds.sql');
    }
    const directionId = dir.rows[0]!.id;

    // 4. Создание участника
    const participantId = newUUID();
    const externalId = 'А00001-1';  // волна А, номер 00001, направление 1

    await client.query(
      `INSERT INTO participants
         (id, external_id, wave_letter, wave_number, direction_id, name,
          phone, phone_hash, messengers, password_hash, status, profile_risk,
          welcome_pack_given, is_first_architect)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               'master', 'compatible', false, true)`,
      [
        participantId,
        externalId,
        'А',
        1,
        directionId,
        name.trim(),
        encryptedPhone,
        phoneHash,
        JSON.stringify({ telegram: '@first_architect' }),
        passwordHash,
      ],
    );

    // 5. Создание роли FIRST_ARCHITECT (если нет)
    let roleId: string;
    const existingRole = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'FIRST_ARCHITECT' AND direction_id = $1 LIMIT 1`,
      [directionId],
    );
    if (existingRole.rowCount && existingRole.rowCount > 0) {
      roleId = existingRole.rows[0]!.id;
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO roles (direction_id, name, type, max_term_days, max_terms, cooldown_days)
         VALUES ($1, 'FIRST_ARCHITECT', 'permanent', NULL, NULL, NULL)
         RETURNING id`,
        [directionId],
      );
      roleId = inserted.rows[0]!.id;
    }

    // 6. Привязка роли
    await client.query(
      `INSERT INTO participant_roles
         (participant_id, role_id, direction_id, status, granted_by)
       VALUES ($1, $2, $3, 'active', $1)`,
      [participantId, roleId, directionId],
    );

    // 7. Приветственный пакет 200 Потоков
    //    Триггер fn_update_flow_balance обновит flows.balance автоматически
    await client.query(
      `INSERT INTO flow_transactions
         (participant_id, type, amount, reason, source)
       VALUES ($1, 'main', $2, 'Приветственный пакет', 'system')`,
      [participantId, WELCOME_PACK],
    );
    await client.query(
      `UPDATE participants SET welcome_pack_given = true WHERE id = $1`,
      [participantId],
    );

    // 8. История статуса
    await client.query(
      `INSERT INTO participant_status_history (participant_id, status, reason)
       VALUES ($1, 'master', 'bootstrap_first_architect')`,
      [participantId],
    );

    // 9. Аудит
    await client.query(
      `INSERT INTO audit_log
         (actor_id, actor_type, action, entity_type, entity_id, new_value)
       VALUES (NULL, 'system', 'admin.bootstrap_architect', 'participant', $1, $2)`,
      [
        participantId,
        JSON.stringify({ external_id: externalId, direction_id: directionId }),
      ],
    );

    return { participantId, externalId, directionId };
  });

  console.log('\n✅ Первый Архитектор создан');
  console.log('   ID:          ', result.participantId);
  console.log('   External ID: ', result.externalId);
  console.log('   Направление: ', result.directionId, '(техническая привязка)');
  console.log('   Телефон:     ', phone);
  console.log('   Пароль:      ', '(заданный при запуске)');
  console.log('\nТеперь можно логиниться:');
  console.log(`   curl -X POST http://localhost:3000/auth/login \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"phone":"${phone}","password":"..."}'`);

  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});