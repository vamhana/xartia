// Фаза 1 — страж покрытия: каждый скрипт, который пишет в таблицы паспорта и
// каталога, обязан отказываться работать на production ДО обращений к БД и API.
// Новый скрипт с такой записью без защиты уронит этот тест.
//
// Запуск: pnpm exec vitest run --root . scripts/production-guards.test.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url));

const WRITE_TO_PASSPORT_TABLES =
  /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(competency_atoms|passport_\w+|person_atom_states|anchor_examples|calibration_\w+|xsk_\w+|atom_direction_map|catalog_proposals)\b/i;

/** Легитимные production-операции и сама защита; причина указана явно. */
const ALLOWLIST: Record<string, string> = {
  'seed-passport.ts': 'сид каталога: штатная production-операция (с флагом --skip-pilots)',
  'lib/refuse-production.ts': 'сама защита',
};

function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  for (const dir of ['', 'lib']) {
    for (const name of readdirSync(join(SCRIPTS, dir))) {
      if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
        const rel = dir ? `${dir}/${name}` : name;
        out.push({ rel, text: readFileSync(join(SCRIPTS, rel), 'utf8') });
      }
    }
  }
  return out;
}

const hasGuard = (text: string): boolean => /refuseProduction\(/.test(text) || /NODE_ENV/.test(text);

describe('scripts that write to passport/catalog tables', () => {
  const writers = sources().filter(({ rel, text }) => WRITE_TO_PASSPORT_TABLES.test(text) && !(rel in ALLOWLIST));

  it('finds the known writers (guards against the scan silently matching nothing)', () => {
    const names = writers.map((w) => w.rel);
    for (const expected of [
      'prepare-passport-test-fixtures.ts', 'test-passport-approval-gate.ts', 'test-passport-v7.ts',
      'test-passport-v8.ts', 'test-catalog-v04.ts', 'seed-catalog-v04.ts', 'lib/passport-fixtures.ts',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it.each(writers.map((w) => [w.rel, w.text] as const))('%s refuses to run on production', (rel, text) => {
    expect(hasGuard(text), `${rel} пишет в таблицы паспорта/каталога, но не вызывает refuseProduction()`).toBe(true);
  });

  it('calls the guard before any await in the entry point (no side effects before the refusal)', () => {
    for (const { rel, text } of writers) {
      if (rel.startsWith('lib/') || !text.includes('refuseProduction(')) {continue;}
      const mainAt = text.search(/async function main\s*\(/);
      const callAt = text.indexOf('refuseProduction(', mainAt);
      expect(mainAt, `${rel}: нет async function main`).toBeGreaterThanOrEqual(0);
      expect(callAt, `${rel}: refuseProduction не вызван в main`).toBeGreaterThan(mainAt);
      expect(text.slice(mainAt, callAt).includes('await '), `${rel}: await до refuseProduction`).toBe(false);
    }
  });

  it('guards backdateAssessment itself before it touches the database', () => {
    const lib = sources().find((s) => s.rel === 'lib/passport-fixtures.ts');
    const fnAt = lib?.text.search(/export async function backdateAssessment/) ?? -1;
    expect(fnAt).toBeGreaterThanOrEqual(0);
    const body = (lib?.text ?? '').slice(fnAt, fnAt + 600);
    expect(body.indexOf('refuseProduction(')).toBeGreaterThan(-1);
    expect(body.indexOf('refuseProduction(')).toBeLessThan(body.indexOf('UPDATE passport_assessments'));
  });
});

describe('scripts that rewrite assessment history through the fixtures library', () => {
  it('guard every importer of backdateAssessment at the entry point', () => {
    const importers = sources().filter(({ text }) => /\bbackdateAssessment\b/.test(text) && !text.includes('export async function backdateAssessment'));
    expect(importers.map((i) => i.rel).sort()).toEqual(['test-passport-v3.ts', 'test-passport-v6.ts']);
    for (const { rel, text } of importers) {
      expect(hasGuard(text), `${rel} подменяет историю оценок, но не вызывает refuseProduction()`).toBe(true);
    }
  });
});

describe('allowlist', () => {
  it('lists only files that exist, each with a stated reason', () => {
    const existing = new Set(sources().map((s) => s.rel));
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(existing.has(rel), rel).toBe(true);
      expect(reason.length, rel).toBeGreaterThan(5);
    }
  });
});
