// scripts/bootstrap-participant.ts
// Создаёт обычного участника с ролью ASSOCIATED.
// Запуск: pnpm tsx scripts/bootstrap-participant.ts <phone> <name> <password> [directionNumber]

import 'dotenv/config';
import { WELCOME_PACK } from '../src/core/constants.js';
import { transaction } from '../src/lib/db.js';
import { newUUID } from '../src/lib/id.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { encryptField, hashForSearch } from '../src/security/encryption.js';
import { hashPassword, validatePasswordOrThrow } from '../src/security/password.js';

function normalizePhone(input: string): string {
  let s = input.replace(/[\s\-()]/g, '');
  if (/^8\d{10}$/.test(s)) {s = '+7' + s.slice(1);}
  if (/^7\d{10}$/.test(s)) {s = '+' + s;}
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {throw new Error(`Некорректный телефон: ${input}`);}
  return s;
}

async function main(): Promise<void> {
  const [rawPhone, name, password, dirStr] = process.argv.slice(2);
  if (!rawPhone || !name || !password) {
    console.error('Использование: pnpm tsx scripts/bootstrap-participant.ts <phone> <name> <password> [directionNumber=2]');
    process.exit(1);
  }

  const phone = normalizePhone(rawPhone);
  const directionNumber = dirStr ? parseInt(dirStr, 10) : 2;
  validatePasswordOrThrow(password);

  const phoneHash = hashForSearch(phone);
  const encryptedPhone = encryptField(phone);
  const passwordHash = await hashPassword(password);

  const result = await transaction(async (client) => {
    const taken = await client.query(
      `SELECT 1 FROM participants WHERE phone_hash = $1 LIMIT 1`,
      [phoneHash],
    );
    if (taken.rowCount && taken.rowCount > 0) {throw new Error('Телефон уже зарегистрирован');}

    const dir = await client.query<{ id: string }>(
      `SELECT id FROM directions WHERE number = $1 LIMIT 1`,
      [directionNumber],
    );
    if (!dir.rowCount || dir.rowCount === 0) {
      throw new Error(`Направление №${directionNumber} не найдено`);
    }
    const directionId = dir.rows[0]!.id;

    // Считаем номер участника: кол-во + 1
    const countRes = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM participants WHERE wave_number IS NOT NULL`,
    );
    const nextNumber = parseInt(countRes.rows[0]?.cnt ?? '0', 10) + 1;
    const externalId = `А${String(nextNumber).padStart(5, '0')}-${directionNumber}`;

    const participantId = newUUID();
    await client.query(
      `INSERT INTO participants
         (id, external_id, wave_letter, wave_number, direction_id, name,
          phone, phone_hash, messengers, password_hash, status, profile_risk,
          welcome_pack_given)
       VALUES ($1, $2, 'А', $3, $4, $5, $6, $7, $8, $9, 'associated', 'compatible', false)`,
      [
        participantId, externalId, nextNumber, directionId, name.trim(),
        encryptedPhone, phoneHash, JSON.stringify({ telegram: `@user_${nextNumber}` }),
        passwordHash,
      ],
    );

    // Роль ASSOCIATED
    let roleId: string;
    const existingRole = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'ASSOCIATED' AND direction_id = $1 LIMIT 1`,
      [directionId],
    );
    if (existingRole.rowCount && existingRole.rowCount > 0) {
      roleId = existingRole.rows[0]!.id;
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO roles (direction_id, name, type)
         VALUES ($1, 'ASSOCIATED', 'permanent') RETURNING id`,
        [directionId],
      );
      roleId = inserted.rows[0]!.id;
    }
    await client.query(
      `INSERT INTO participant_roles (participant_id, role_id, direction_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [participantId, roleId, directionId],
    );

    // Приветственный пакет
    await client.query(
      `INSERT INTO flow_transactions (participant_id, type, amount, reason, source)
       VALUES ($1, 'main', $2, 'Приветственный пакет', 'system')`,
      [participantId, WELCOME_PACK],
    );
    await client.query(
      `UPDATE participants SET welcome_pack_given = true WHERE id = $1`,
      [participantId],
    );

    await client.query(
      `INSERT INTO participant_status_history (participant_id, status, reason)
       VALUES ($1, 'associated', 'bootstrap_participant')`,
      [participantId],
    );

    return { participantId, externalId };
  });

  console.log('\n✅ Участник создан');
  console.log('   ID:          ', result.participantId);
  console.log('   External ID: ', result.externalId);
  console.log('   Телефон:     ', phone);
  console.log('   Направление: ', directionNumber);
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});