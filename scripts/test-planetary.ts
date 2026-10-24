/**
 * I.9.04.16 — test-planetary.ts
 *
 * Полный цикл Планетарного уровня + регрессия на багфиксы v0.0.02:
 *   - unfreeze на незамороженном → 409 «Расширение не заморожено»
 *     (было: { frozen: false } всегда)
 *   - POST /communities с невалидным mother_community_id → 404
 *     (было: 409 «уже существует» из-за catch без проверки кода PG-ошибки)
 *   - POST /bridges с невалидным community_a/b → 404
 *     (было: 409 «мост уже существует»)
 *
 * Запуск:
 *   ARCHITECT_PHONE=... ARCHITECT_PASSWORD=... \
 *   API_URL=http://localhost:3000 pnpm tsx scripts/test-planetary.ts
 *
 * Требует: чистый rate-limit bucket для api.write (16 мутаций за прогон).
 * Требует: архитектор (FIRST_ARCHITECT — wildcard planetary:*).
 * Побочные эффекты: создаёт communities/bridges/plans — на dev/staging.
 */

import 'dotenv/config';

// ─────────────────────── config ───────────────────────

const PORT = process.env['API_PORT'] ?? process.env['PORT'] ?? '3000';
const BASE = (process.env['API_URL'] ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const PHONE = process.env['ARCHITECT_PHONE'];
const PASSWORD = process.env['ARCHITECT_PASSWORD'];

// 32 буквы: А..Я без Ё (не входит в диапазон [А-Я] в PG regex).
const LETTERS = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

// ─────────────────────── helpers ───────────────────────

function ok(m: string): void {
  console.log(`✓ ${m}`);
}
function fail(m: string): never {
  console.error(`✗ ${m}`);
  process.exit(1);
}
function assert(cond: unknown, m: string): asserts cond {
  if (!cond) {fail(m);}
}

function randomCode(): string {
  const i = (): number => Math.floor(Math.random() * LETTERS.length);
  return `${LETTERS[i()]!}${LETTERS[i()]!}`;
}

interface ApiOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
}

async function api(
  path: string,
  opts: ApiOpts = {},
): Promise<{ status: number; body: unknown }> {
  const url = new URL(BASE + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {url.searchParams.set(k, v);}
  }
  const headers: Record<string, string> = {};
  if (opts.token) {headers['Authorization'] = `Bearer ${opts.token}`;}
  if (opts.body !== undefined) {headers['Content-Type'] = 'application/json';}

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

interface LoginResp {
  access_token: string;
  participant: {
    id: string;
    external_id: string;
    name: string;
    direction_id: string | null;
  };
}

async function login(): Promise<{ token: string; participantId: string }> {
  const r = await api('/auth/login', {
    method: 'POST',
    body: { phone: PHONE, password: PASSWORD },
  });
  assert(r.status === 200, `login: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  const j = r.body as LoginResp;
  return { token: j.access_token, participantId: j.participant.id };
}

interface CommunityResp {
  id: string;
  code: string;
  name: string;
  status: 'incubation' | 'active' | 'node' | 'center';
  level: number;
  motherCommunityId: string | null;
}

async function createCommunity(
  token: string,
  body: { name: string; mother_community_id?: string },
): Promise<CommunityResp> {
  let code = randomCode();
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await api('/planetary/communities', {
      method: 'POST',
      token,
      body: {
        code,
        name: body.name,
        ...(body.mother_community_id
          ? { mother_community_id: body.mother_community_id }
          : {}),
      },
    });
    if (r.status === 201) {return r.body as CommunityResp;}
    if (r.status === 409) {
      code = randomCode();
      continue;
    }
    fail(`createCommunity(${body.name}): HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  fail(`createCommunity(${body.name}): все 8 кодов заняты — БД переполнена`);
}

// ─────────────────────── main ───────────────────────

async function main(): Promise<void> {
  console.log(`→ BASE = ${BASE}`);
  assert(PHONE, 'ARCHITECT_PHONE не задан');
  assert(PASSWORD, 'ARCHITECT_PASSWORD не задан');

  const { token, participantId } = await login();
  ok(`login as architect (participantId=${participantId})`);

  // ───── 0. Приводим expansion_status к «не заморожено» (идемпотентно) ─────
  {
    const r = await api('/planetary/expansion/unfreeze', { method: 'POST', token });
    assert(
      r.status === 200 || r.status === 409,
      `pre-unfreeze: HTTP ${r.status}; ${JSON.stringify(r.body)}`,
    );
  }
  ok('0. expansion_status: unfrozen (idempotent)');

  // ───── 1. Community A (root) ─────
  const communityA = await createCommunity(token, {
    name: `Test-Root-${Date.now()}`,
  });
  assert(communityA.status === 'incubation', `A: status=${communityA.status}`);
  assert(communityA.level === 0, `A: level=${communityA.level}`);
  ok(`1. community A: ${communityA.code} → ${communityA.id}`);

  // ───── 2. Community B (child of A) ─────
  const communityB = await createCommunity(token, {
    name: `Test-Child-${Date.now()}`,
    mother_community_id: communityA.id,
  });
  assert(communityB.motherCommunityId === communityA.id, 'B.motherCommunityId ≠ A.id');
  ok(`2. community B: ${communityB.code} → ${communityB.id} (mother=A)`);

  // ───── 3. GET /planetary/communities ─────
  {
    const r = await api('/planetary/communities', { token });
    assert(r.status === 200, `communities list: HTTP ${r.status}`);
    const data = (r.body as { data: CommunityResp[] }).data;
    assert(Array.isArray(data), 'communities list: data не массив');
    assert(data.some((c) => c.id === communityA.id), 'communities list: A не найден');
    assert(data.some((c) => c.id === communityB.id), 'communities list: B не найден');
  }
  ok('3. GET /planetary/communities — A и B в списке');

  // ───── 4. GET /planetary/communities/:id ─────
  {
    const r = await api(`/planetary/communities/${communityA.id}`, { token });
    assert(r.status === 200, `community get: HTTP ${r.status}`);
    assert((r.body as CommunityResp).id === communityA.id, 'community get: id ≠');
  }
  ok('4. GET /planetary/communities/:id — OK');

  // ───── 5. Council: add + list ─────
  {
    const r = await api('/planetary/council', {
      method: 'POST',
      token,
      body: {
        member_id: participantId,
        community_id: communityA.id,
        type: 'delegate',
      },
    });
    assert(r.status === 201, `council add: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  {
    const r = await api('/planetary/council', { token });
    assert(r.status === 200, `council list: HTTP ${r.status}`);
    const data = (r.body as { data: Array<{ memberId: string }> }).data;
    assert(Array.isArray(data), 'council list: data не массив');
    assert(data.some((m) => m.memberId === participantId), 'council list: наш member не найден');
  }
  ok('5. POST+GET /planetary/council — OK');

  // ───── 6. Bridge A ↔ B ─────
  let bridgeId = '';
  {
    const r = await api('/planetary/bridges', {
      method: 'POST',
      token,
      body: {
        community_a: communityA.id,
        community_b: communityB.id,
        coefficient: 1.5,
      },
    });
    assert(r.status === 201, `bridge create: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
    const b = r.body as { id: string; coefficient: number };
    assert(Math.abs(b.coefficient - 1.5) < 1e-9, `bridge coefficient=${b.coefficient}`);
    bridgeId = b.id;
  }
  {
    // Дубль (нормализация a<b) → 409
    const r = await api('/planetary/bridges', {
      method: 'POST',
      token,
      body: {
        community_a: communityB.id, // намеренно в обратном порядке
        community_b: communityA.id,
        coefficient: 2.0,
      },
    });
    assert(r.status === 409, `bridge duplicate: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  {
    const r = await api('/planetary/bridges', { token });
    assert(r.status === 200, `bridges list: HTTP ${r.status}`);
    const data = (r.body as { data: Array<{ id: string }> }).data;
    assert(data.some((b) => b.id === bridgeId), 'bridges list: наш мост не найден');
  }
  ok(`6. bridge A↔B: ${bridgeId} (coefficient=1.5); дубль в обратном порядке → 409`);

  // ───── 7. Plan: create + get ─────
  {
    const r = await api('/planetary/plan', {
      method: 'POST',
      token,
      body: {
        period: '2026-Q1',
        plan: { goal: 'expansion-test', steps: ['a', 'b'] },
      },
    });
    assert(r.status === 201, `plan create: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  {
    const r = await api('/planetary/plan', { token });
    assert(r.status === 200, `plan get: HTTP ${r.status}`);
    const p = (r.body as { data: { period: string } | null }).data;
    assert(p !== null, 'plan get: null');
    assert(p.period === '2026-Q1', `plan get: period=${p.period}`);
  }
  ok('7. POST+GET /planetary/plan — OK');

  // ───── 8. Referendum ─────
  {
    const r = await api('/planetary/referendum', {
      method: 'POST',
      token,
      body: { type: 'convergence', threshold: 70 },
    });
    assert(r.status === 201, `referendum: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
    const ref = r.body as { status: string; threshold: number };
    assert(ref.status === 'initiated', `referendum status=${ref.status}`);
    assert(ref.threshold === 70, `referendum threshold=${ref.threshold}`);
  }
  ok('8. POST /planetary/referendum — OK (threshold=70)');

  // ───── 9. Reserve (read) ─────
  {
    const r = await api('/planetary/reserve', { token });
    assert(r.status === 200, `reserve: HTTP ${r.status}`);
    const res = r.body as { totalVolume: number; distributed: number; available: number };
    assert(typeof res.totalVolume === 'number', 'reserve: totalVolume не number');
  }
  ok('9. GET /planetary/reserve — OK');

  // ───── 10. Pulse (read) ─────
  {
    const r = await api('/planetary/pulse', {
      token,
      query: { community_id: communityA.id },
    });
    assert(r.status === 200, `pulse: HTTP ${r.status}`);
    assert(Array.isArray((r.body as { data: unknown[] }).data), 'pulse: data не массив');
  }
  ok('10. GET /planetary/pulse — OK');

  // ───── 11. Expansion conditions (read) ─────
  {
    const r = await api('/planetary/expansion/conditions', { token });
    assert(r.status === 200, `conditions: HTTP ${r.status}`);
    const c = r.body as { allowed: boolean; reasons: string[]; coordinationLevel: string };
    assert(typeof c.allowed === 'boolean', 'conditions: allowed не boolean');
    assert(Array.isArray(c.reasons), 'conditions: reasons не массив');
    assert(
      ['direct', 'regional', 'continental', 'planetary'].includes(c.coordinationLevel),
      `conditions: coordinationLevel=${c.coordinationLevel}`,
    );
  }
  ok('11. GET /planetary/expansion/conditions — OK');

  // ───── 12. Freeze expansion ─────
  {
    const r = await api('/planetary/expansion/freeze', {
      method: 'POST',
      token,
      body: { reason: 'test-freeze' },
    });
    assert(r.status === 200, `freeze: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
    const f = r.body as { frozen: boolean; reason: string };
    assert(f.frozen === true, 'freeze: frozen ≠ true');
    assert(f.reason === 'test-freeze', `freeze: reason=${f.reason}`);
  }
  ok('12. POST /planetary/expansion/freeze — OK');

  // ───── 13. Freeze again → 409 ─────
  {
    const r = await api('/planetary/expansion/freeze', {
      method: 'POST',
      token,
      body: { reason: 'again' },
    });
    assert(r.status === 409, `freeze duplicate: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  ok('13. freeze повторно → 409');

  // ───── 14. Unfreeze ─────
  {
    const r = await api('/planetary/expansion/unfreeze', { method: 'POST', token });
    assert(r.status === 200, `unfreeze: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
    assert((r.body as { frozen: boolean }).frozen === false, 'unfreeze: frozen ≠ false');
  }
  ok('14. POST /planetary/expansion/unfreeze — OK');

  // ───── 15. 🆕 Unfreeze на незамороженном → 409 (баг-фикс v0.0.02) ─────
  {
    const r = await api('/planetary/expansion/unfreeze', { method: 'POST', token });
    assert(
      r.status === 409,
      `unfreeze-when-unfrozen: ОЖИДАЛСЯ 409 (баг-фикс), получен ${r.status}; ` +
        JSON.stringify(r.body),
    );
    const b = r.body as { code: string; message: string };
    assert(b.code === 'CONFLICT', `unfreeze-when-unfrozen: code=${b.code}, ожидался CONFLICT`);
    assert(
      typeof b.message === 'string' && b.message.includes('не заморожено'),
      `unfreeze-when-unfrozen: message="${b.message}"`,
    );
  }
  ok('15. unfreeze на незамороженном → 409 «Расширение не заморожено» ✅');

  // ───── 16. 🆕 POST /communities с невалидным mother_community_id → 404 ─────
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await api('/planetary/communities', {
      method: 'POST',
      token,
      body: { code: randomCode(), name: 'Test-BadMother', mother_community_id: fake },
    });
    assert(
      r.status === 404,
      `bad mother: ОЖИДАЛСЯ 404 (баг-фикс, было 409), получен ${r.status}; ` +
        JSON.stringify(r.body),
    );
    assert((r.body as { code: string }).code === 'NOT_FOUND', 'bad mother: code ≠ NOT_FOUND');
  }
  ok('16. POST /communities с невалидным mother_community_id → 404 ✅');

  // ───── 17. 🆕 POST /bridges с невалидным community_a → 404 ─────
  {
    const fake = '00000000-0000-0000-0000-000000000000';
    const r = await api('/planetary/bridges', {
      method: 'POST',
      token,
      body: { community_a: fake, community_b: communityA.id, coefficient: 1.0 },
    });
    assert(
      r.status === 404,
      `bad bridge: ОЖИДАЛСЯ 404 (баг-фикс, было 409), получен ${r.status}; ` +
        JSON.stringify(r.body),
    );
    assert((r.body as { code: string }).code === 'NOT_FOUND', 'bad bridge: code ≠ NOT_FOUND');
  }
  ok('17. POST /bridges с невалидным community_a → 404 ✅');

  // ───── 18. 🆕 Bridge: community_a === community_b → 422 ─────
  {
    const r = await api('/planetary/bridges', {
      method: 'POST',
      token,
      body: { community_a: communityA.id, community_b: communityA.id, coefficient: 1.0 },
    });
    assert(r.status === 422, `same bridge: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
    assert(
      (r.body as { code: string }).code === 'VALIDATION_ERROR',
      'same bridge: code ≠ VALIDATION_ERROR',
    );
  }
  ok('18. POST /bridges с community_a === community_b → 422');

  // ───── 19. 🆕 GET /communities?status=incubation — фильтр ─────
  {
    const r = await api('/planetary/communities', {
      token,
      query: { status: 'incubation' },
    });
    assert(r.status === 200, `communities?status=incubation: HTTP ${r.status}`);
    const data = (r.body as { data: CommunityResp[] }).data;
    assert(
      data.every((c) => c.status === 'incubation'),
      'filter status=incubation: есть не-incubation',
    );
  }
  ok('19. GET /communities?status=incubation — фильтр работает');

  // ───── 20. 🆕 Валидация кода: латиница → 422 ─────
  {
    const r = await api('/planetary/communities', {
      method: 'POST',
      token,
      body: { code: 'AB', name: 'Test-Latin' },
    });
    assert(r.status === 422, `latin code: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  ok('20. POST /communities с латинским кодом «AB» → 422');

  // ───── 21. 🆕 Валидация coefficient: negative → 422 ─────
  {
    const r = await api('/planetary/bridges', {
      method: 'POST',
      token,
      body: { community_a: communityA.id, community_b: communityB.id, coefficient: -1 },
    });
    assert(r.status === 422, `negative coefficient: HTTP ${r.status}; ${JSON.stringify(r.body)}`);
  }
  ok('21. POST /bridges с negative coefficient → 422');

  console.log('\n══════════════════════════════════════');
  console.log('  I.9.04.16 PASSED — 21 шаг');
  console.log('══════════════════════════════════════');
}

main().catch((e) => {
  console.error('✗ Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});