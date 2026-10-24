// scripts/test-permissions.ts
import 'dotenv/config';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { loadWsEnv } from './lib/ws-env.js';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000';

interface Client { token: string; participantId: string }

async function req<T>(
  c: Client,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

function ok(m: string) { console.log(`  ✓ ${m}`); }
function fail(m: string) { console.error(`  ✗ ${m}`); process.exitCode = 1; }

async function main() {
  console.log('▶ A.1.94.01 permissions smoke test\n');

  const env = await loadWsEnv();
  const arch: Client = { token: env.token, participantId: env.participantId };
  console.log(`  arch pid: ${arch.participantId}\n`);

  // 1. GET /permissions/me
  const me = await req<{
    roles: string[];
    effective: string[];
    mandates: unknown[];
    rights: Record<string, string[]>;
  }>(arch, 'GET', '/permissions/me');
  if (me.status !== 200) {
    fail(`GET /permissions/me → ${me.status}`);
    console.error(JSON.stringify(me.data, null, 2));
    return;
  }
  console.log(
    `  me: roles=${me.data.roles.length}, effective=${me.data.effective.length}, ` +
    `mandates=${me.data.mandates.length}, rights-keys=${Object.keys(me.data.rights).length}`,
  );
  if (me.data.roles.length > 0) {ok('GET /permissions/me');}
  else {fail('roles пусты');}

  // 2. POST /permissions/check
  const check = await req<{ allowed: boolean; reason: string }>(
    arch, 'POST', '/permissions/check',
    { resource: 'participant', action: 'V' },
  );
  console.log(`  check participant:V → allowed=${check.data.allowed}, reason=${check.data.reason}`);
  if (check.status === 200) {ok('POST /permissions/check');}
  else {fail(`POST /permissions/check → ${check.status}`);}

  // 3. POST /permissions/check-batch
  const batch = await req<{ results: Array<{ allowed: boolean }> }>(
    arch, 'POST', '/permissions/check-batch',
    {
      checks: [
        { resource: 'participant', action: 'V' },
        { resource: 'signal', action: 'C' },
        { resource: 'flow', action: 'C' },
      ],
    },
  );
  console.log(`  batch: ${batch.data.results?.length ?? 0} results`);
  if (batch.data.results?.length === 3) {ok('POST /permissions/check-batch');}
  else {fail('batch size != 3');}

  // 4. Справочники
  const resources = await req<{ resources: string[] }>(
    arch, 'GET', '/permissions/resources',
  );
  console.log(`  resources: ${resources.data.resources.length}`);
  ok('GET /permissions/resources');

  const actions = await req<{ actions: string[] }>(
    arch, 'GET', '/permissions/actions',
  );
  console.log(`  actions: ${actions.data.actions.length}`);
  ok('GET /permissions/actions');

  const scopes = await req<{ scopes: string[] }>(
    arch, 'GET', '/permissions/scopes',
  );
  console.log(`  scopes: ${scopes.data.scopes.length}`);
  ok('GET /permissions/scopes');

  // 5. Заглушки
  const matrix = await req<{ entries: unknown[] }>(
    arch, 'GET', '/permissions/matrix',
  );
  ok(`GET /permissions/matrix (entries=${matrix.data.entries.length})`);

  const roleRights = await req<{ rights: unknown[] }>(
    arch, 'GET', '/permissions/roles/COUNCIL_MEMBER',
  );
  ok(`GET /permissions/roles/:id (rights=${roleRights.data.rights.length})`);

  // 6. Без токена → 401
  const noAuth = await fetch(`${BASE}/permissions/me`);
  if (noAuth.status === 401) {ok('no token → 401');}
  else {fail(`no token → ${noAuth.status}`);}

  console.log('\n✅ done');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(() => gracefulShutdown());