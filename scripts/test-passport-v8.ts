// I.9.09.16 — Smoke v8: техдолги Группы 1.
//
// Запуск: pnpm tsx scripts/test-passport-v8.ts
//
// Покрывает:
//   1.1 criteria_version в submitAssessment + GET /card (self)
//   1.3 bumpVersion (major/minor/patch) через update_atom workflow
//   1.4 nextAtomId advisory lock (два подряд new_atom → разные ID)
// 1.2 (DELETE body) и 1.5 (GraphView lazy) — не тестируются в API
// (UI-хук и чанк; проверено typecheck'ом и vite build).
//
// ПРЕДУСЛОВИЕ: seed-catalog-v04 выполнен. Seed-passport idempotent.
// Не допускается skip: любая ошибка → FAIL, exit 1.

import 'dotenv/config';

import { query, queryOne } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';
import { ATOM_SEEDS } from './seed-data/atoms.js';
import {
  BASE,
  createAndMergeProposal,
  ensureActor,
  getAtom,
  login,
  request,
  submitAssessment,
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

  const subject = await ensureActor(admin.token, { name: 'v8 subject' });
  const assessor = await ensureActor(admin.token, {
    name: 'v8 assessor',
    role: 'VERIFIER',
  });
  console.log(`subject: ${subject.id}`);
  console.log(`assessor: ${assessor.id}`);

  // Чтобы cleanup 0009 (п.2) не сломал seed, фиксируем исходное состояние.
  const original0009 = ATOM_SEEDS.find((a) => a.atom_id === 'CYB.ATOM.0009');
  if (!original0009) throw new Error('0009 not found in ATOM_SEEDS');

  // ─── 1. criteria_version ────────────────────────────────────────────
  {
    // 1a. submitAssessment → criteria_version = atom.version
    const asId = await submitAssessment(
      assessor.token, subject.id, 'CYB.ATOM.0009', 'U', 5, 'exam',
    );
    pass('1a. submitAssessment 201', { assessmentId: asId });

    const row = await queryOne<{
      criteria_version: string | null;
      level: number;
      status: string;
    }>(
      `SELECT criteria_version, level, status
         FROM passport_assessments WHERE id = $1`,
      [asId],
    );
    expectEq('1b. criteria_version = 0.2.0', row?.criteria_version, '0.2.0');
    expectEq('1c. level = 5', row?.level, 5);

    // 1d. GET /card (self) → criteriaVersion в assessments
    const card = await request<{
      assessments: Array<{
        id: string;
        level: number | null;
        criteriaVersion: string | null;
        status: string;
      }>;
    }>(
      'GET', '/passport/atoms/CYB.ATOM.0009/card',
      undefined, subject.token,
    );
    if (card.status !== 200) {
      fail('1d. GET /card self 200', { status: card.status });
    } else {
      const a = card.data.assessments.find((x) => x.id === asId);
      if (a && a.criteriaVersion === '0.2.0' && a.level === 5 && a.status === 'active') {
        pass('1d. GET /card self: criteriaVersion=0.2.0', {
          level: a.level, status: a.status,
        });
      } else {
        fail('1d. GET /card self: criteriaVersion=0.2.0', { a });
      }
    }
  }

  // ─── 2. bumpVersion ─────────────────────────────────────────────────
  {
    // 2a. update_atom 0009 с bump: 'patch'
    const r = await createAndMergeProposal(
      admin.token,
      'update_atom',
      {
        definition: 'v8 bump: patch-версия (smoke)',
        bump: 'patch',
      },
      'CYB.ATOM.0009',
    );
    expectEq('2a. merge update_atom 200', r.status, 'merged');
    expectEq('2a. atomId', r.atomId, 'CYB.ATOM.0009');

    const g = await getAtom(admin.token, 'CYB.ATOM.0009');
    expectEq('2b. version after patch = 0.2.1', g.data.atom?.version, '0.2.1');
    if (g.data.atom?.definition.includes('v8 bump: patch')) {
      pass('2c. 0009 definition patched');
    } else {
      fail('2c. 0009 definition patched', {
        def: g.data.atom?.definition.slice(0, 60),
      });
    }

    // 2d. update_atom 0009 с bump: 'major' → 1.0.0
    const r2 = await createAndMergeProposal(
      admin.token,
      'update_atom',
      { definition: 'v8 bump: major (smoke)', bump: 'major' },
      'CYB.ATOM.0009',
    );
    expectEq('2d. merge major 200', r2.status, 'merged');
    const g2 = await getAtom(admin.token, 'CYB.ATOM.0009');
    expectEq('2e. version after major = 1.0.0', g2.data.atom?.version, '1.0.0');
  }

  // ─── 3. nextAtomId advisory lock ────────────────────────────────────
  const createdAtoms: string[] = [];
  {
    const basePayload = (name: string): Record<string, unknown> => ({
      cluster: 'software_development',
      name,
      definition: 'v8 lock test',
      boundary_includes: [],
      boundary_excludes: [],
      assessment_criteria: { status: 'draft' },
      assessment_methods: [],
      dimension_applicability: { U: { applicable: true } },
      freshness_policy: {
        content_change_rate: 'slow',
        practice_review_policy: 'P24M',
      },
      version: '0.1.0',
    });

    // Два подряд new_atom → MAX+1, MAX+2
    const r1 = await createAndMergeProposal(
      admin.token, 'new_atom', basePayload('v8 lock atom A'),
    );
    const r2 = await createAndMergeProposal(
      admin.token, 'new_atom', basePayload('v8 lock atom B'),
    );

    if (r1.atomId && r2.atomId) {
      createdAtomsPush(createdAtoms, r1.atomId);
      createdAtomsPush(createdAtoms, r2.atomId);
      if (r1.atomId !== r2.atomId) {
        pass('3a. two merges → different atomIds', {
          a: r1.atomId, b: r2.atomId,
        });
      } else {
        fail('3a. two merges → different atomIds', {
          a: r1.atomId, b: r2.atomId,
        });
      }

      const aNum = parseInt(r1.atomId.slice('CYB.ATOM.'.length), 10);
      const bNum = parseInt(r2.atomId.slice('CYB.ATOM.'.length), 10);
      if (bNum === aNum + 1) {
        pass('3b. IDs sequential', { aNum, bNum });
      } else {
        fail('3b. IDs sequential', { aNum, bNum });
      }
    } else {
      fail('3a/3b. merge returned null atomId', {
        r1: r1.atomId, r2: r2.atomId,
      });
    }
  }

  // ─── cleanup ────────────────────────────────────────────────────────
  // 0009: вернуть version и definition к seed.
  await query(
    `UPDATE competency_atoms
        SET version = $1, definition = $2, updated_at = now()
      WHERE atom_id = 'CYB.ATOM.0009'`,
    [original0009.version, original0009.definition],
  );
  // Lock-atoms: не DELETE (FK RESTRICT + append-only passport_history_events).
  // Помечаем status='deprecated' — getGraph/getOverview их отфильтруют.
  // Cleanup по name-префиксу — покрывает и атомы от ПРОШЛЫХ прогонов v8
  // (если те упали до cleanup). Идемпотентно.
  const depRes = await query<{ atom_id: string }>(
    `UPDATE competency_atoms
        SET status = 'deprecated', updated_at = now()
      WHERE name LIKE 'v8 lock atom%'
        AND status <> 'deprecated'
      RETURNING atom_id`,
  );
  pass('cleanup: 0009 restored, v8 lock-atoms deprecated', {
    restoredVersion: original0009.version,
    deprecatedNow: depRes.length,
    deprecatedFromThisRun: createdAtomsCount(createdAtoms),
  });
  // NB: lock-atoms не удалены (нельзя — append-only history).
  // Помечены deprecated; не появляются в graph/overview.
  // ─── итог ──────────────────────────────────────────────────────────
  console.log('');
  if (failed > 0) {
    console.error(`FAILED: ${failed}`);
    await gracefulShutdown();
    process.exit(1);
  }
  console.log('OK: 0 failed');
  await gracefulShutdown();
}

// Микро-хелперы для читаемости (без array.push в контексте).
function createdAtomsPush(arr: string[], id: string): void {
  arr.push(id);
}
function createdAtomsCount(arr: string[]): number {
  return arr.length;
}

main().catch(async (e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  try { await gracefulShutdown(); } catch { /* ignore */ }
  process.exit(1);
});