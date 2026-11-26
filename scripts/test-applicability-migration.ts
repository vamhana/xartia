// Фаза 1, этап 4b — Smoke: конвертация применимости (миграция 073).
//
// Прямой DB-скрипт (без API): вызывает SQL-функцию passport_convert_applicability_v073,
// которую создаёт миграция 073 и которой она же конвертирует каталог, и сверяет
// результат с таблицей правил (§4.5 плана) и с каноническим читателем
// getDimensionApplicabilityState из кода. Ничего не пишет в БД.
//
// Запуск: pnpm tsx scripts/test-applicability-migration.ts

import 'dotenv/config';

import type { ApplicabilityState, Dimension, DimensionApplicability } from '../src/core/passport/types.js';
import { getDimensionApplicabilityState } from '../src/core/passport/types.js';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

let failed = 0;
function pass(label: string): void {
  console.log(`PASS  ${label}`);
}
function fail(label: string, detail: unknown): void {
  failed++;
  console.log(`FAIL  ${label}  ${JSON.stringify(detail)}`);
}

interface Case {
  name: string;
  atomStatus: string;
  input: unknown;
  /** Ожидаемое каноническое состояние по измерениям; пропущенные измерения → undetermined. */
  expected: Partial<Record<Dimension, ApplicabilityState>>;
}

const DIMS: Dimension[] = ['U', 'X', 'D', 'P', 'E'];

const CASES: Case[] = [
  { name: 'approved + true → applicable', atomStatus: 'approved',
    input: { U: { applicable: true, name: 'Понимание' } }, expected: { U: 'applicable' } },
  { name: 'candidate + true → undetermined', atomStatus: 'candidate',
    input: { U: { applicable: true }, P: { applicable: true } }, expected: {} },
  { name: 'draft / in_review / deprecated + true → undetermined', atomStatus: 'in_review',
    input: { U: { applicable: true } }, expected: {} },
  { name: 'false + reason → not_applicable (любой статус атома)', atomStatus: 'candidate',
    input: { X: { applicable: false, reason: 'вне области' } }, expected: { X: 'not_applicable' } },
  { name: 'false без причины → undetermined', atomStatus: 'approved',
    input: { D: { applicable: false } }, expected: {} },
  { name: 'false + пустая/пробельная причина → undetermined', atomStatus: 'approved',
    input: { D: { applicable: false, reason: '' }, P: { applicable: false, reason: '  ' },
      E: { applicable: false, reason: '\n\t' } },
    expected: {} },
  { name: 'причина не строка → undetermined', atomStatus: 'approved',
    input: { D: { applicable: false, reason: 5 } }, expected: {} },
  { name: 'applicable не boolean / запись не объект → undetermined', atomStatus: 'approved',
    input: { U: { applicable: 'yes' }, X: true, D: null, P: { applicable: 1 }, E: {} }, expected: {} },
  { name: 'уже новый формат не меняется', atomStatus: 'candidate',
    input: { U: { state: 'applicable' }, X: { state: 'not_applicable', reason: 'r' }, D: { state: 'undetermined' } },
    expected: { U: 'applicable', X: 'not_applicable' } },
  { name: 'state побеждает старый boolean', atomStatus: 'approved',
    input: { U: { state: 'undetermined', applicable: true } }, expected: {} },
  { name: 'отсутствующие измерения остаются отсутствующими', atomStatus: 'approved',
    input: { U: { applicable: true } }, expected: { U: 'applicable' } },
  { name: 'пустой объект остаётся пустым', atomStatus: 'approved', input: {}, expected: {} },
];

async function convert(input: unknown, atomStatus: string): Promise<Record<string, unknown>> {
  const rows = await query<{ r: Record<string, unknown> }>(
    'SELECT passport_convert_applicability_v073($1::jsonb, $2::text) AS r',
    [JSON.stringify(input), atomStatus],
  );
  return rows[0]?.r ?? {};
}

async function main(): Promise<void> {
  const fn = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'passport_convert_applicability_v073'`,
  );
  if ((fn[0]?.n ?? 0) !== 1) {
    fail('0. функция passport_convert_applicability_v073 создана миграцией 073', fn);
    return;
  }
  pass('0. функция passport_convert_applicability_v073 существует');

  for (const c of CASES) {
    const out = await convert(c.input, c.atomStatus);
    const app = out as DimensionApplicability;

    const mismatches: Array<{ dim: Dimension; got: ApplicabilityState; want: ApplicabilityState }> = [];
    for (const d of DIMS) {
      const got = getDimensionApplicabilityState(app, d);
      const want = c.expected[d] ?? 'undetermined';
      if (got !== want) {mismatches.push({ dim: d, got, want });}
    }
    // Сырое сохранённое состояние. Читатель из кода защитный (not_applicable без
    // причины он сам превратит в undetermined) и поэтому не должен быть единственной
    // проверкой: сверяем и то, что реально записала SQL-функция.
    const input = c.input as Record<string, unknown>;
    const rawMismatches: Array<{ dim: Dimension; got: unknown; want: unknown }> = [];
    for (const d of DIMS) {
      const stored = out[d] as { state?: unknown } | undefined;
      if (d in input) {
        const want = c.expected[d] ?? 'undetermined';
        if (stored?.state !== want) {rawMismatches.push({ dim: d, got: stored?.state, want });}
      } else if (stored !== undefined) {
        rawMismatches.push({ dim: d, got: stored, want: 'absent' });
      }
    }
    // Ни у одной сконвертированной записи не должно остаться boolean `applicable`.
    const legacyLeft = DIMS.filter((d) => {
      const e = out[d];
      const original = (c.input as Record<string, unknown>)[d];
      const wasObjectWithoutState = typeof original === 'object' && original !== null && !('state' in original);
      return wasObjectWithoutState && typeof e === 'object' && e !== null && 'applicable' in e;
    });
    // Идемпотентность: повторная конвертация результата ничего не меняет.
    const again = await convert(out, c.atomStatus);
    const stable = JSON.stringify(again) === JSON.stringify(out);

    if (mismatches.length === 0 && rawMismatches.length === 0 && legacyLeft.length === 0 && stable) {
      pass(c.name);
    } else {
      fail(c.name, { mismatches, rawMismatches, legacyLeft, stable, out });
    }
  }

  // Ключи вне U/X/D/P/E и name/reason сохраняются.
  const kept = await convert(
    { U: { applicable: true, name: 'Понимание', reason: 'r' }, Z: { applicable: true } },
    'approved',
  ) as Record<string, Record<string, unknown>>;
  if (kept['U']?.['name'] === 'Понимание' && kept['U']?.['reason'] === 'r'
      && kept['Z']?.['applicable'] === true && !('applicable' in (kept['U'] ?? {}))) {
    pass('name/reason сохраняются, чужие ключи не трогаются, applicable удалён');
  } else {
    fail('name/reason сохраняются, чужие ключи не трогаются, applicable удалён', kept);
  }

  // NULL и не-объект возвращаются как есть (функция не падает).
  const nullOut = await query<{ r: unknown }>(
    `SELECT passport_convert_applicability_v073(NULL::jsonb, 'approved') AS r`,
  );
  if (nullOut[0]?.r === null) {pass('NULL → NULL');} else {fail('NULL → NULL', nullOut);}
}

main()
  .catch((error: unknown) => {
    failed++;
    console.error(error);
  })
  .finally(async () => {
    await gracefulShutdown();
    if (failed > 0) {
      console.error(`FAILED: ${failed}`);
      process.exit(1);
    }
    console.log('OK: 0 failed');
  });
