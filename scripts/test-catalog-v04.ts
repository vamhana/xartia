// I.9.09.41 — Smoke catalog-v04: workflow предложений + педагогическая
// компетенция + anchor'ы.
//
// Запуск: pnpm tsx scripts/test-catalog-v04.ts
//
// ПРЕДУСЛОВИЕ: seed-catalog-v04.ts выполнен (0055 + 9 anchor'ов).
// Самодостаточен для проверок; не создаёт seed (это делает seed-catalog-v04).
// Skip не допускается: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { queryOne } from '../src/lib/db.js';
import { ATOM_SEEDS } from './seed-data/atoms.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import {
  BASE,
  createCatalogProposal,
  ensureActor,
  getAtom,
  listCatalogProposals,
  login,
  mergeProposal,
  request,
  setProposalStatus,
} from './lib/passport-fixtures.js';

const ARCHITECT_PHONE = process.env['TEST_ARCHITECT_PHONE'] ?? '+79001234567';
const ARCHITECT_PASS = process.env['TEST_ARCHITECT_PASS'] ?? 'ChangeMe123456';

let failed = 0;
function pass(label: string, detail?: unknown): void {
  console.log(`PASS  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
}
function fail(label: string, detail?: unknown): void {
  console.error(`FAIL  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
  failed++;
}
function expectEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) pass(label, { actual });
  else fail(label, { actual, expected });
}

async function main(): Promise<void> {
  console.log(`BASE=${BASE}`);

  const admin = await login(ARCHITECT_PHONE, ARCHITECT_PASS);
  console.log(`admin: ${admin.id}`);

  // Второй пользователь — не FA/COUNCIL, чтобы проверить 403.
  const outsider = await ensureActor(admin.token, { name: 'catalog-v04 outsider' });
  console.log(`outsider: ${outsider.id}`);

  // ─── 1. Seed-предусловие: 0055 + anchors ────────────────────────────
  {
    const r = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM competency_atoms WHERE atom_id = 'CYB.ATOM.0055'`,
    );
    expectEq('1a. 0055 exists', r?.n ?? 0, 1);

    const atoms = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM competency_atoms`,
    );
    if ((atoms?.n ?? 0) >= 54) pass('1b. atoms ≥ 54', { total: atoms?.n });
    else fail('1b. atoms ≥ 54', { total: atoms?.n });

    const anchors = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM anchor_examples`,
    );
    if ((anchors?.n ?? 0) >= 9) pass('1c. anchors ≥ 9', { total: anchors?.n });
    else fail('1c. anchors ≥ 9', { total: anchors?.n });

    const tc = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM competency_atoms
        WHERE freshness_policy->>'practice_review_policy' = 'to_calibrate'`,
    );
    expectEq('1d. to_calibrate = 0', tc?.n ?? -1, 0);
  }

  // ─── 2. 0055 метаданные ─────────────────────────────────────────────
  {
    const g = await getAtom(admin.token, 'CYB.ATOM.0055');
    expectEq('2a. 0055 get 200', g.status, 200);
    expectEq('2b. 0055 status candidate', g.data.atom?.status, 'candidate');
    expectEq('2c. 0055 version 0.1.0', g.data.atom?.version, '0.1.0');
  }

  // ─── 3. Workflow: create → reject ───────────────────────────────────
  {
    const c = await createCatalogProposal(
      admin.token,
      'new_atom',
      {
        cluster: 'requirements_and_computational_thinking',
        name: 'v4 reject-test atom',
        definition: 'test',
        boundary_includes: [],
        boundary_excludes: [],
        assessment_criteria: { status: 'draft' },
        assessment_methods: [],
        dimension_applicability: { U: { applicable: true } },
        freshness_policy: { content_change_rate: 'slow', practice_review_policy: 'P24M' },
        version: '0.1.0',
      },
    );
    if (c.status === 201 && c.data.id) pass('3a. create → 201');
    else { fail('3a. create → 201', { status: c.status, data: c.data }); throw new Error('cannot continue'); }

    const proposalId = c.data.id;

    // submitted (автор)
    const s = await setProposalStatus(admin.token, proposalId, 'submitted');
    expectEq('3b. → submitted 200', s.status, 200);

    // in_review (FA)
    const ir = await setProposalStatus(admin.token, proposalId, 'in_review');
    expectEq('3c. → in_review 200', ir.status, 200);

    // rejected без reason → 422
    const bad = await setProposalStatus(admin.token, proposalId, 'rejected');
    expectEq('3d. reject без reason → 422', bad.status, 422);

    // rejected с reason
    const rej = await setProposalStatus(admin.token, proposalId, 'rejected', {
      reason: 'тестовый reject',
    });
    expectEq('3e. reject с reason 200', rej.status, 200);
    expectEq('3e. status rejected', rej.data.status, 'rejected');

    // повторный merge rejected → 409
    const m = await mergeProposal(admin.token, proposalId);
    expectEq('3f. merge rejected → 409', m.status, 409);
  }

  // ─── 4. Permissions ─────────────────────────────────────────────────
  {
    const c = await createCatalogProposal(
      outsider.token,
      'new_atom',
      {
        cluster: 'software_development',
        name: 'v4 outsider atom',
        definition: 'test',
        boundary_includes: [],
        boundary_excludes: [],
        assessment_criteria: { status: 'draft' },
        assessment_methods: [],
        dimension_applicability: { U: { applicable: true } },
        freshness_policy: { content_change_rate: 'slow', practice_review_policy: 'P24M' },
        version: '0.1.0',
      },
    );
    // outsider может создать (любой авторизованный), но не in_review/approve/merge
    if (c.status === 201 && c.data.id) pass('4a. outsider create 201');
    else { fail('4a. outsider create 201', { status: c.status }); throw new Error('cannot continue'); }

    const proposalId = c.data.id;
    await setProposalStatus(outsider.token, proposalId, 'submitted');

    // outsider → in_review → 403
    const ir = await setProposalStatus(outsider.token, proposalId, 'in_review');
    expectEq('4b. outsider in_review → 403', ir.status, 403);

    // outsider merge (из submitted) → 403 (роль) или 409 (status)
    const m = await mergeProposal(outsider.token, proposalId);
    expectEq('4c. outsider merge → 403', m.status, 403);
  }

  // ─── 5. update_atom: bump version ───────────────────────────────────
  {
    // Меняем 0001 definition.
    const c = await createCatalogProposal(
      admin.token,
      'update_atom',
      { definition: 'v4 update: обновлённое определение (smoke)' },
      'CYB.ATOM.0001',
    );
    if (c.status === 201 && c.data.id) pass('5a. update proposal 201');
    else { fail('5a. update proposal 201', { status: c.status, data: c.data }); throw new Error('cannot continue'); }

    const proposalId = c.data.id;
    for (const s of ['submitted', 'in_review', 'approved'] as const) {
      const r = await setProposalStatus(admin.token, proposalId, s);
      expectEq(`5b. ${s} 200`, r.status, 200);
    }

    // before version
    const before = await getAtom(admin.token, 'CYB.ATOM.0001');
    const beforeVersion = before.data.atom?.version ?? '';

    const m = await mergeProposal(admin.token, proposalId);
    expectEq('5c. merge 200', m.status, 200);
    expectEq('5c. proposal status merged', m.data.status, 'merged');

    // after version — должен bump'нуться (minor)
    const after = await getAtom(admin.token, 'CYB.ATOM.0001');
    const afterVersion = after.data.atom?.version ?? '';
    if (afterVersion !== beforeVersion && afterVersion > beforeVersion) {
      pass('5d. 0001 version bumped', { before: beforeVersion, after: afterVersion });
    } else {
      fail('5d. 0001 version bumped', { before: beforeVersion, after: afterVersion });
    }

    // definition обновлён
    const card = await request<{ atom: { definition: string } }>(
      'GET', '/passport/atoms/CYB.ATOM.0001', undefined, admin.token,
    );
    if (card.data.atom.definition.includes('v4 update')) {
      pass('5e. 0001 definition updated');
    } else {
      fail('5e. 0001 definition updated', { def: card.data.atom.definition.slice(0, 80) });
    }
    // ─── cleanup: вернуть 0001 к seed-состоянию (dev-only) ───────────
    // test-catalog-v04 использует пилотный атом 0001 для update_atom.
    // seed-passport.ts откатит его при следующем запуске (version ≠).
    // Чистим сразу, чтобы checkSeedIdempotent в test-passport-v2 не падал.
    const seed0001 = ATOM_SEEDS.find((a) => a.atom_id === 'CYB.ATOM.0001');
    if (!seed0001) {
      fail('5f. seed0001 not found in ATOM_SEEDS');
    } else {
      await queryOne(
        `UPDATE competency_atoms
            SET version = $1,
                definition = $2,
                updated_at = now()
          WHERE atom_id = 'CYB.ATOM.0001'`,
        [seed0001.version, seed0001.definition],
      );
      pass('5f. 0001 restored to seed state', { version: seed0001.version });
    }
    
  }

  // ─── 6. deprecate_atom ──────────────────────────────────────────────
  {
    // 0041 — не используется в v7, безопасно.
    const c = await createCatalogProposal(
      admin.token,
      'deprecate_atom',
      { reason: 'v4 smoke deprecate' },
      'CYB.ATOM.0041',
    );
    if (c.status === 201 && c.data.id) pass('6a. deprecate proposal 201');
    else { fail('6a. deprecate proposal 201', { status: c.status }); throw new Error('cannot continue'); }

    const proposalId = c.data.id;
    for (const s of ['submitted', 'in_review', 'approved'] as const) {
      await setProposalStatus(admin.token, proposalId, s);
    }
    const m = await mergeProposal(admin.token, proposalId);
    expectEq('6b. merge deprecate 200', m.status, 200);

    const after = await getAtom(admin.token, 'CYB.ATOM.0041');
    expectEq('6c. 0041 deprecated', after.data.atom?.status, 'deprecated');

    // cleanup: вернуть 0041 в candidate (dev-БД).
    await queryOne(
      `UPDATE competency_atoms SET status = 'candidate' WHERE atom_id = 'CYB.ATOM.0041'`,
    );
  }

  // ─── 7. list + get ──────────────────────────────────────────────────
  {
    const list = await listCatalogProposals(admin.token, 'merged');
    if (list.status === 200 && list.data.data.length >= 2) {
      pass('7a. list merged ≥ 2', { count: list.data.data.length });
    } else {
      fail('7a. list merged ≥ 2', { status: list.status, count: list.data.data?.length });
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    await gracefulShutdown();
    process.exit(1);
  }
  console.log('OK: 0 failed');
  await gracefulShutdown();
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});