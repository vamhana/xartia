// Фаза 1 — страж: аудит исторических данных обязан оставаться read-only.
// Запуск: pnpm exec vitest run --root . scripts/audit-passport-history.test.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./audit-passport-history.ts', import.meta.url)), 'utf8');
const sqlLiterals = [...source.matchAll(/`([^`]*)`/g)].map((m) => m[1] as string).filter((s) => /\b(SELECT|SET)\b/.test(s));

describe('audit-passport-history.ts', () => {
  it('opens a READ ONLY transaction before running any query', () => {
    const readOnlyAt = source.indexOf("SET TRANSACTION READ ONLY");
    const firstQuery = source.indexOf('const atoms = await q(');
    expect(readOnlyAt).toBeGreaterThan(-1);
    expect(readOnlyAt).toBeLessThan(firstQuery);
  });

  it('contains no write or DDL statements in its SQL', () => {
    expect(sqlLiterals.length).toBeGreaterThan(5);
    for (const sql of sqlLiterals) {
      expect(sql, sql.slice(0, 60)).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|VACUUM)\b/i);
    }
  });

  it('only writes to the filesystem (the optional --out report), never to the database', () => {
    expect(source).toContain('writeFileSync');
    expect(source).not.toMatch(/client\.query\(\s*`\s*(INSERT|UPDATE|DELETE)/i);
  });
});
