// scripts/test-proposals.ts
// Мета-цикл: предложение → обсуждение → возражение → решение →
// реализация → принятие.
//
// Запуск: pnpm tsx scripts/test-proposals.ts <phone> <password>

import 'dotenv/config';

import { gracefulShutdown } from '../src/lib/shutdown.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';
const phone = process.argv[2] ?? '+79001234567';
const password = process.argv[3] ?? 'ChangeMe123456';

let TOKEN = '';
interface Res<T> { status: number; data: T }

async function req<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  const t = token ?? TOKEN;
  if (t) {headers['Authorization'] = `Bearer ${t}`;}
  if (body !== undefined) {headers['Content-Type'] = 'application/json';}
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data: data as T };
}

function ok(m: string): void { console.log(`   ✓ ${m}`); }
function fail(m: string): void { console.error(`   ✗ ${m}`); process.exitCode = 1; }

interface Proposal {
  id: string;
  status: string;
  impactCount: number;
  openObjections: number;
  objections: Array<{ id: string; status: string }>;
  decisions: Array<{ outcome: string; rationale: string }>;
}

async function main(): Promise<void> {
  console.log('▶ Предложения изменений ядра\n');

  const login = await req<{ access_token: string; participant: { id: string; direction_id: string } }>(
    'POST', '/auth/login', { phone, password },
  );
  if (login.status !== 200) {fail(`login → ${login.status}`); return;}
  TOKEN = login.data.access_token;
  const me = login.data.participant;

  const dirs = await req<{ data: Array<{ id: string; number: number }> }>('GET', '/directions');
  const dir = dirs.data.data.find((d) => d.id === me.direction_id);
  if (!dir) {fail('направление не найдено'); return;}

  // Реестр инвариантов.
  const inv = await req<{ data: Array<{ id: string; testPath: string }> }>('GET', '/invariants');
  if (inv.status === 200 && inv.data.data.length >= 12
      && inv.data.data.every((i) => i.testPath.length > 0)) {
    ok(`Реестр инвариантов: ${inv.data.data.length}, у всех есть тест`);
  } else {
    fail(`invariants → ${inv.status}: ${JSON.stringify(inv.data)}`);
  }

  // Участник-возражающий.
  const suffix = String(Date.now()).slice(-6);
  const reg = await req<{ request_id: string }>('POST', '/auth/register', {
    phone: `+7998${suffix}`,
    messengers: { telegram: `@prop_${suffix}` },
    password: `Proposal${suffix}`,
    consent_video: true,
    consent_data: true,
  });
  const acc = await req<{ participant: { id: string } }>(
    'POST', `/admin/registration-requests/${reg.data.request_id}/accept`,
    { direction_id: dir.id, name: `Критик ${suffix}`, direction_number: dir.number },
  );
  if (acc.status !== 201) {fail(`accept → ${acc.status}`); return;}
  const criticId = acc.data.participant.id;
  const imp = await req<{ access_token: string }>('POST', `/dev/impersonate/${criticId}`, {});
  const criticToken = imp.data.access_token;

  // 1. Создание предложения.
  const created = await req<Proposal>('POST', '/proposals', {
    type: 'rule',
    title: 'Изменить формулу Потока за наставничество',
    problem: 'Сейчас наставник не получает Поток за ученика, хотя передача опыта — часть работы.',
    proposal: 'Начислять 0.5 Потока наставнику после первой принятой задачи ученика.',
    alternatives: 'Оставить как есть и считать наставничество общественной нагрузкой.',
    invariants: ['flow_not_money', 'flow_confirmed_work'],
  });
  if (created.status === 201 && created.data.status === 'draft'
      && created.data.impactCount === 2) {
    ok('Предложение создано (draft, 2 инварианта)');
  } else {
    fail(`create → ${created.status}: ${JSON.stringify(created.data)}`);
    return;
  }
  const pid = created.data.id;

  // 2. Возражение на draft запрещено.
  const early = await req('POST', `/proposals/${pid}/objections`, {
    kind: 'conceptual', text: 'Так Поток станет платой за наставничество.',
  }, criticToken);
  if (early.status === 409) {ok('Возражения принимаются только в обсуждении (409)');}
  else {fail(`early objection → ${early.status}`);}

  // 3. Обсуждение с дедлайном.
  const disc = await req<Proposal>('POST', `/proposals/${pid}/discussion`, { days: 3 });
  if (disc.status === 200 && disc.data.status === 'discussion') {ok('Обсуждение начато (дедлайн 3 дня)');}
  else {fail(`discussion → ${disc.status}: ${JSON.stringify(disc.data)}`);}

  // 4. Возражение и запрет принятия при открытом возражении.
  const obj = await req<Proposal>('POST', `/proposals/${pid}/objections`, {
    kind: 'conceptual',
    text: 'Это превращает наставничество в способ заработать Поток, а не научить.',
  }, criticToken);
  if (obj.status === 200 && obj.data.openObjections === 1) {ok('Возражение зафиксировано');}
  else {fail(`objection → ${obj.status}: ${JSON.stringify(obj.data)}`);}

  const blocked = await req<{ code?: string }>('POST', `/proposals/${pid}/decide`, {
    outcome: 'accepted',
    rationale: 'Предложение полезно, но возражение ещё не разобрано — тест должен запретить.',
  });
  if (blocked.status === 409) {ok('Принятие с открытым возражением запрещено (409)');}
  else {fail(`decide with objection → ${blocked.status}`);}

  // 5. Ответ на возражение и решение.
  const objectionId = obj.data.objections[0]?.id;
  const resolved = await req<Proposal>(
    'POST', `/proposals/${pid}/objections/${objectionId}/resolve`,
    { status: 'addressed', resolution: 'Поток начисляется только после принятой задачи ученика; проверка ОТК.' },
  );
  if (resolved.status === 200 && resolved.data.openObjections === 0) {ok('Возражение закрыто с ответом');}
  else {fail(`resolve → ${resolved.status}: ${JSON.stringify(resolved.data)}`);}

  const decided = await req<Proposal>('POST', `/proposals/${pid}/decide`, {
    outcome: 'accepted',
    rationale: 'Возражение снято: начисление привязано к принятой задаче ученика, а не к факту наставничества.',
    method: 'council',
  });
  if (decided.status === 200 && decided.data.status === 'agreed'
      && decided.data.decisions[0]?.outcome === 'accepted') {
    ok('Решение принято и записано с обоснованием');
  } else {
    fail(`decide → ${decided.status}: ${JSON.stringify(decided.data)}`);
  }

  // 6. Реализация и принятие.
  const impl = await req<Proposal>('POST', `/proposals/${pid}/implement`, {
    pr_url: 'https://github.com/vamhana/xartia/pull/1',
  });
  if (impl.status === 200 && impl.data.status === 'implementing') {ok('Реализация начата (PR)');}
  else {fail(`implement → ${impl.status}`);}

  const accepted = await req<Proposal>('POST', `/proposals/${pid}/accept`);
  if (accepted.status === 200 && accepted.data.status === 'accepted') {ok('Изменение принято');}
  else {fail(`accept → ${accepted.status}`);}

  // 7. Мета-предложение: изменить сами правила обсуждения.
  const meta = await req<Proposal>('POST', '/proposals', {
    type: 'meta',
    title: 'Сократить дедлайн обсуждения до 5 дней',
    problem: 'Семидневное обсуждение затягивает мелкие изменения и снижает активность.',
    proposal: 'Для типа module — 5 дней, для rule/meta/charter — 7 дней.',
    invariants: ['audit_traceable'],
  });
  if (meta.status === 201 && meta.data.status === 'draft') {
    ok('Мета-предложение (изменение правил обсуждения) создаётся');
  } else {
    fail(`meta → ${meta.status}: ${JSON.stringify(meta.data)}`);
  }

  // 8. Валидация.
  const badInv = await req('POST', '/proposals', {
    type: 'rule',
    title: 'Неизвестный инвариант',
    problem: 'Проверяем, что неизвестный инвариант не пройдёт валидацию.',
    proposal: 'Это предложение не должно создаться.',
    invariants: ['no_such_invariant'],
  });
  if (badInv.status === 422 || badInv.status === 400) {ok('Неизвестный инвариант отклонён');}
  else {fail(`bad invariant → ${badInv.status}`);}

  const list = await req<{ data: Array<{ id: string; status: string }> }>(
    'GET', '/proposals?status=accepted',
  );
  if (list.status === 200 && list.data.data.some((p) => p.id === pid)) {
    ok('Список принятых предложений содержит изменение');
  } else {
    fail(`list → ${list.status}`);
  }

  console.log('\n✅ done');
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}).finally(() => gracefulShutdown());
