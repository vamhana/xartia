// scripts/reset-architect-password.ts
// Принудительный сброс пароля Архитектора из env ARCHITECT_PASSWORD.
// Используется для восстановления после падений test-recovery.ts между
// шагами 4 (смена) и 8 (восстановление) — пароль остаётся "RecoveryTest!...".
//
// Требует: DATABASE_URL, ARCHITECT_PHONE, ARCHITECT_PASSWORD, PHONE_HASH_KEY
// в .env. Не отзывает сессии — при необходимости перезапусти API.

import 'dotenv/config';
import argon2 from 'argon2';
import pg from 'pg';

import { hashForSearch } from '../src/security/encryption.js';

const ARCHITECT_PASSWORD = process.env['ARCHITECT_PASSWORD'] ?? 'ChangeMe123456';
const ARCHITECT_PHONE = process.env['ARCHITECT_PHONE'] ?? '+79001234567';
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL не задан');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log('─── Reset architect password ───');
  console.log(`   Телефон: ${ARCHITECT_PHONE}`);
  console.log(`   Пароль: ${ARCHITECT_PASSWORD.length} символов`);

  const passwordHash = await argon2.hash(ARCHITECT_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query<{
      id: string;
      external_id: string;
      name: string;
    }>(
      `UPDATE participants
          SET password_hash = $1, updated_at = now()
        WHERE is_first_architect = true AND deleted_at IS NULL
        RETURNING id, external_id, name`,
      [passwordHash],
    );

    if (res.rowCount === 0) {
      throw new Error('Архитектор с is_first_architect=true не найден');
    }

    const row = res.rows[0]!;
    console.log(`   ✓ Пароль сброшен: ${row.external_id} — ${row.name}`);

    // Проверка: может ли хеш быть верифицирован
    const ok = await argon2.verify(passwordHash, ARCHITECT_PASSWORD);
    console.log(`   ✓ Хеш верифицируется: ${ok ? 'да' : 'НЕТ — что-то пошло не так'}`);
  } finally {
    await client.end();
  }

  // Инвалидация кэша participant:v2:<architect> не нужна: password_hash
  // в кэш не кладётся (getById кэширует ParticipantRow без password_hash).
  // Сессии по паролю не проверяются — токены работают до exp.

  console.log('\n✅ Готово. Проверь: pnpm tsx scripts/test-recovery.ts');
  void hashForSearch;   // импорт ради env-проверки PHONE_HASH_KEY
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', (e as Error).message);
  process.exit(1);
});