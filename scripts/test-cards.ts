// scripts/test-cards.ts
// Карточки ячейки и человека: состав, план ячейки, задачи с автором
// назначения, наставник/ученики, дневной план.
//
// Запуск: pnpm tsx scripts/test-cards.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (TOKEN) {headers['Authorization'] = `Bearer ${TOKEN}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

async function main(): Promise<void> {
  console.log('▶ Карточки ячейки и человека\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const me = login.data.participant;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === me.direction_id);
  if (!dir) {fail('направление не найдено'); return;}

  const suffix = String(Date.now()).slice(-6);
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7994${suffix}`,
    messengers: { telegram: `@card_${suffix}` },
    password: `CardTest${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Карточка ${suffix}`, direction_number: dir.number },
  );
  if (acc.status !== 201) {fail(`accept → ${acc.status}`); return;}
  const workerId = acc.data.participant.id;

  const cell = await req<{ id: string }>('POST', '/cells', {
    level: 0, number: `K${suffix.slice(-4)}`, direction_id: dir.id, profile: 'card-test',
  });
  if (cell.status !== 201) {fail(`cell → ${cell.status}`); return;}
  await req('POST', `/cells/${cell.data.id}/members`, {
    participant_id: workerId, role_in_cell: 'coordinator',
  });

  const plan = await req<{ id: string; title: string }>('POST', '/plans', {
    type: 'standard',
    title: 'Долгая задача ячейки',
    expected_result: 'Общий результат',
    lead_direction_id: dir.id,
    cell_id: cell.data.id,
  });
  if (plan.status !== 201) {fail(`plan → ${plan.status}`); return;}

  const task = await req<{ id: string }>('POST', '/tasks', {
    direction_id: dir.id,
    description: 'Задача человека в ячейке',
    priority: 'standard',
  });
  if (task.status !== 201) {fail(`task → ${task.status}`); return;}
  await req('POST', `/tasks/${task.data.id}/assign`, { participant_id: workerId });

  const cellCard = await req<{
    cell: { number: string };
    members: Array<{ participantId: string; name: string; roleInCell: string }>;
    plans: Array<{ id: string; title: string }>;
    dailyPlan: { tasks: unknown[] };
  }>('GET', `/cells/${cell.data.id}/card`);
  if (cellCard.status === 200
      && cellCard.data.members.some((m) => m.participantId === workerId)
      && cellCard.data.plans.some((p) => p.id === plan.data.id)) {
    ok('Карточка ячейки: состав и общий план');
  } else {
    fail(`cell card → ${cellCard.status}: ${JSON.stringify(cellCard.data)}`);
  }
  if (Array.isArray(cellCard.data.dailyPlan.tasks)) {ok('Дневной план ячейки отдаётся');}
  else {fail('дневного плана нет в карточке');}

  const person = await req<{
    participant: { id: string; cellNumber: string | null };
    tasks: Array<{ id: string; assignedBy: { name: string } | null }>;
    mentor: unknown;
    mentees: unknown[];
    dailyPlan: unknown[];
  }>('GET', `/participants/${workerId}/card`);
  const assigned = person.data.tasks.find((t) => t.id === task.data.id);
  if (person.status === 200 && assigned && assigned.assignedBy) {
    ok(`Карточка человека: задача и назначил «${assigned.assignedBy.name}»`);
  } else {
    fail(`person card → ${person.status}: ${JSON.stringify(person.data)}`);
  }
  if (person.data.participant.cellNumber === cellCard.data.cell.number) {
    ok('В карточке человека указана его ячейка');
  } else {
    fail(`ячейка в карточке: ${person.data.participant.cellNumber}`);
  }
  if (Array.isArray(person.data.mentees) && Array.isArray(person.data.dailyPlan)) {
    ok('Наставник/ученики и дневной план присутствуют');
  } else {
    fail('нет полей наставничества/дневного плана');
  }

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
