// Фаза 1, этап 6a — тест реального файла каталога (без БД).
// Страж от подмены и пересохранения: docs/XartIA_Skill_Catalog.xlsx обязан
// совпадать по SHA-256 с закреплённым снимком, а содержимое — разбираться и
// проходить все проверки целостности.
//
// Запуск: pnpm exec vitest run --root . scripts/xsk-real-file.test.ts

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertCatalogMatchesSpec,
  computeSkillContentHash,
  findKnownSource,
  parseXskCatalog,
} from '../src/core/passport/xsk-catalog-parse.js';

import { readXskWorkbook } from './lib/xsk-xlsx.js';

const FILE = fileURLToPath(new URL('../docs/XartIA_Skill_Catalog.xlsx', import.meta.url));

describe('docs/XartIA_Skill_Catalog.xlsx', () => {
  it('is exactly the pinned snapshot (re-saving the file in Excel changes its SHA-256)', async () => {
    const wb = await readXskWorkbook(FILE);
    const spec = findKnownSource(wb.sha256);
    expect(
      spec,
      `SHA-256 ${wb.sha256} не закреплён. Если файл пересохранён в Excel: git checkout -- docs/XartIA_Skill_Catalog.xlsx`,
    ).toBeDefined();
    expect(wb.bytes).toBe(spec?.bytes);
  }, 60_000);

  it('parses, passes every integrity rule and matches the pinned expectations', async () => {
    const wb = await readXskWorkbook(FILE);
    const spec = findKnownSource(wb.sha256);
    if (!spec) {throw new Error('файл не закреплён');}
    const catalog = parseXskCatalog(wb.sheets);
    expect(() => assertCatalogMatchesSpec(catalog, spec)).not.toThrow();

    expect(catalog.skills).toHaveLength(322);
    expect(catalog.skills[0]?.skillId).toBe('XSK-000001');
    expect(catalog.skills[321]?.skillId).toBe('XSK-000322');
    expect(catalog.domains).toHaveLength(24);
    expect(catalog.subdomains).toHaveLength(96);
  }, 60_000);

  it('gives every skill a distinct content hash that matches its fields', async () => {
    const wb = await readXskWorkbook(FILE);
    const catalog = parseXskCatalog(wb.sheets);
    expect(new Set(catalog.skills.map((s) => s.contentSha256)).size).toBe(322);
    for (const s of catalog.skills) {
      const { contentSha256, ...fields } = s;
      expect(computeSkillContentHash(fields), s.skillId).toBe(contentSha256);
    }
  }, 60_000);

  it('has no external mappings yet (crosswalk data must not be taken from this file)', async () => {
    const wb = await readXskWorkbook(FILE);
    const catalog = parseXskCatalog(wb.sheets);
    expect(catalog.skills.filter((s) => s.externalMapping !== null)).toHaveLength(0);
  }, 60_000);
});
