// scripts/test-cells.ts
// Smoke-тест Cells: login → создать ячейку → добавить Архитектора → проверить состав.
// Запуск: pnpm tsx scripts/test-cells.ts +79000000000 Пароль
//
// Идемпотентность: номер ячейки генерируется от времени (T#####),
// повторный прогон не падает на 409. Плюс cleanup в начале — сносим
// остатки прошлых прогонов (ячейки с номером T#####).

import 'dotenv/config';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface LoginResponse {
  access_token: string;
  participant: { id: string; direction_id: string };
}

let TOKEN = '';

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

function log(label: string, status: number, data: unknown): void {
  console.warn(`\n─── ${label} ─── [${status}]`);
  console.warn(JSON.stringify(data, null, 2));
}

function ok(m: string) { console.warn(`   ✓ ${m}`); }
function _fail(m: string) { console.warn(`   ✗ ${m}`); }

async function main(): Promise<void> {
  const phone = process.argv[2] ?? '+79000000000';
  const password = process.argv[3];
  if (!password) {
    console.error('Использование: pnpm tsx scripts/test-cells.ts <phone> <password>');
    process.exit(1);
  }

  // 1. Login — нужен до cleanup, чтобы знать architectId
  const login = await req<LoginResponse>('POST', '/auth/login', { phone, password });
  if (login.status !== 200) {
    log('POST /auth/login', login.status, login.data);
    process.exit(1);
  }
  TOKEN = login.data.access_token;
  const architectId = login.data.participant.id;
  const directionId = login.data.participant.direction_id;
  console.warn(`✅ Logged in: ${architectId}, direction=${directionId}`);

  // 1.5. Cleanup:
  //    (а) снять Архитектора со всех активных ячеек — он должен попасть в новую
  //    (б) удалить тестовые ячейки (number LIKE T%)
  await query(
    `UPDATE cell_members SET valid_to = now()
      WHERE participant_id = $1 AND valid_to IS NULL`,
    [architectId],
  );
  await query(
    `UPDATE participants SET cell_id = NULL, updated_at = now() WHERE id = $1`,
    [architectId],
  );
  await query(
    `DELETE FROM cell_members
      WHERE cell_id IN (SELECT id FROM cells WHERE number LIKE 'T%')`,
  );
  await query(`DELETE FROM cells WHERE number LIKE 'T%'`);
  console.warn('🧹 Cleanup: Архитектор снят со старых ячеек + тестовые ячейки удалены');
  // 2. Создать ячейку уровня 0
  //    Номер генерируется от времени — уникален для каждого прогона.
  const testNumber = `T${String(Date.now() % 100000).padStart(5, '0')}`;
  const created = await req<{ id: string; number: string }>('POST', '/cells', {
    level: 0,
    number: testNumber,
    direction_id: directionId,
  });
  log(`POST /cells { level: 0, number: "${testNumber}" }`, created.status, created.data);

  if (created.status !== 201) {
    console.error('\n❌ Не удалось создать ячейку — прерываю');
    await gracefulShutdown();
    process.exit(1);
  }
  const cellId = created.data.id;
  ok(`Ячейка создана: ${cellId} (${created.data.number})`);

  // 3. Список всех ячеек
  const list = await req('GET', '/cells');
  log('GET /cells', list.status, list.data);

  // 4. Добавить Архитектора в ячейку как coordinator
  const addMember = await req('POST', `/cells/${cellId}/members`, {
    participant_id: architectId,
    role_in_cell: 'coordinator',
  });
  log(`POST /cells/${cellId}/members { coordinator }`, addMember.status, addMember.data);
  if (addMember.status === 201) {ok('Архитектор добавлен в ячейку');}

  // 5. Проверить состав
  const members = await req('GET', `/cells/${cellId}/members`);
  log(`GET /cells/${cellId}/members`, members.status, members.data);
  const membersArr = (members.data as { data?: unknown[] })?.data ?? [];
  if (membersArr.length === 1) {ok('Состав: 1 участник');}

  // 6. Проверить карточку ячейки — members_count должен стать 1
  const cell = await req<{ membersCount: number }>('GET', `/cells/${cellId}`);
  log(`GET /cells/${cellId}`, cell.status, cell.data);
  if (cell.data.membersCount === 1) {ok('membersCount = 1 (триггер сработал)');}

  // 7. Проверить participants.cell_id
  const me = await req<{ cellId: string }>('GET', '/me');
  log('GET /me (cellId)', me.status, { cellId: me.data.cellId });
  if (me.data.cellId === cellId) {ok('participants.cell_id обновлён');}

  // 8. Дерево от корня
  const tree = await req('GET', `/cells/tree/${cellId}`);
  log(`GET /cells/tree/${cellId}`, tree.status, tree.data);

  console.warn('\n✅ Smoke-тест Cells завершён');
  await gracefulShutdown();
}

main().catch((e) => {
  console.error('\n❌ Ошибка:', e instanceof Error ? e.message : e);
  process.exit(1);
});