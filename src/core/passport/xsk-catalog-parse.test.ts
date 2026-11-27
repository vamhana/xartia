import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  XskCatalogValidationError,
  assertCatalogMatchesSpec,
  computeSkillContentHash,
  findKnownSource,
  parseXskCatalog,
  sha256Hex,
  KNOWN_XSK_SOURCES,
  type XskSkillFields,
  type XskSourceSpec,
  type XskWorkbookSheets,
} from './xsk-catalog-parse.js';

const D_H = ['Domain_ID', 'Название области', 'Группа / фокус', 'Число подобластей', 'Число навыков'];
const S_H = ['Subdomain_ID', 'Domain_ID', 'Подобласть', 'Границы / содержание', 'Статус'];
const K_H = [
  'Skill_ID', 'Domain_ID', 'Область', 'Subdomain_ID', 'Подобласть',
  'Фиксированное название навыка', 'Определение навыка', 'Наблюдаемый результат / доказательство',
  'Метод оценки', 'Границы и безопасность', 'Статус записи', 'Внешнее сопоставление',
  'Профиль оценки v0.3', 'Основание классификации',
];

type Rows = unknown[][];

/** Мини-книга в форме реального файла: титульные строки, пустая строка, заголовок, данные. */
function workbook(): { domains: Rows; subdomains: Rows; skills: Rows } {
  return {
    domains: [
      ['Области XSK'], ['служебная строка'], [], D_H,
      ['XD-01', 'Область А', 'фокус А', 1, 2],
      ['XD-02', 'Область Б', null, 1, 1],
    ],
    subdomains: [
      ['Подобласти XSK'], [], [], S_H,
      ['XSD-01.01', 'XD-01', 'Подобласть А1', 'границы', 'ok'],
      ['XSD-02.01', 'XD-02', 'Подобласть Б1', null, null],
    ],
    skills: [
      ['Навыки XSK'], [], [], K_H,
      ['XSK-000001', 'XD-01', 'Область А', 'XSD-01.01', 'Подобласть А1', 'Навык 1', 'Определение 1',
        'Результат 1', 'Метод 1', 'Границы 1', 'Черновик', null, 'ANL', 'Основание 1'],
      ['XSK-000002', 'XD-01', 'Область А', 'XSD-01.01', 'Подобласть А1', 'Навык 2', 'Определение 2',
        null, null, null, 'Черновик', null, 'QA', null],
      ['XSK-000003', 'XD-02', 'Область Б', 'XSD-02.01', 'Подобласть Б1', 'Навык 3', 'Определение 3',
        'Результат 3', 'Метод 3', 'Границы 3', 'Новый', null, 'OPS', null],
    ],
  };
}

const parse = (w: ReturnType<typeof workbook>) => parseXskCatalog(w as unknown as XskWorkbookSheets);

function issuesOf(w: ReturnType<typeof workbook>): string[] {
  try {
    parse(w);
  } catch (e) {
    expect(e).toBeInstanceOf(XskCatalogValidationError);
    return [...(e as XskCatalogValidationError).issues];
  }
  return [];
}

describe('parseXskCatalog: valid input', () => {
  it('parses all three sheets, skipping title rows and the blank line above the header', () => {
    const c = parse(workbook());
    expect(c.domains).toHaveLength(2);
    expect(c.subdomains).toHaveLength(2);
    expect(c.skills.map((s) => s.skillId)).toEqual(['XSK-000001', 'XSK-000002', 'XSK-000003']);
    expect(c.skills[0]).toMatchObject({
      domainId: 'XD-01', subdomainId: 'XSD-01.01', name: 'Навык 1', profileId: 'ANL',
      recordStatus: 'Черновик', externalMapping: null,
    });
  });

  it('turns empty cells into null and keeps text verbatim (no trimming)', () => {
    const w = workbook();
    w.skills[5]![7] = '';
    w.skills[4]![6] = '  с пробелами  ';
    const c = parse(w);
    expect(c.skills.find((s) => s.skillId === 'XSK-000002')?.observableResult).toBeNull();
    expect(c.skills[0]?.definition).toBe('  с пробелами  ');
  });

  it('finds columns by header name, not by position', () => {
    const w = workbook();
    // Меняем местами колонки «Метод оценки» и «Границы и безопасность» в заголовке и данных.
    for (const r of w.skills.slice(3)) {
      const t = r[8]; r[8] = r[9]; r[9] = t;
    }
    const c = parse(w);
    expect(c.skills[0]?.assessmentMethod).toBe('Метод 1');
    expect(c.skills[0]?.safetyBoundaries).toBe('Границы 1');
  });

  it('ignores trailing empty rows like the 1000-row ranges of the real workbook', () => {
    const w = workbook();
    for (let i = 0; i < 50; i++) {w.skills.push([null, null, null]);}
    expect(parse(w).skills).toHaveLength(3);
  });
});

describe('parseXskCatalog: validation (all issues are collected)', () => {
  it('reports a missing header column', () => {
    const w = workbook();
    w.skills[3] = (w.skills[3] as string[]).map((h) => (h === 'Определение навыка' ? 'Определение' : h));
    expect(issuesOf(w).join('\n')).toContain('нет колонки «Определение навыка»');
  });

  it('reports a missing table header', () => {
    const w = workbook();
    w.domains = [['Области XSK'], [], ['что-то другое']];
    expect(issuesOf(w).join('\n')).toContain('Области: не найден заголовок таблицы');
  });

  it('rejects malformed, duplicate ids', () => {
    const bad = workbook();
    bad.skills[4]![0] = 'XSK-1';
    expect(issuesOf(bad).join('\n')).toContain('некорректный Skill_ID «XSK-1»');

    const dup = workbook();
    dup.skills[5]![0] = 'XSK-000001';
    expect(issuesOf(dup).join('\n')).toContain('дубликат Skill_ID XSK-000001');

    const badDomain = workbook();
    badDomain.domains[4]![0] = 'XD-1';
    expect(issuesOf(badDomain).join('\n')).toContain('некорректный Domain_ID');

    const badSub = workbook();
    badSub.subdomains[4]![0] = 'XSD-1.1';
    expect(issuesOf(badSub).join('\n')).toContain('некорректный Subdomain_ID');
  });

  it('enforces referential integrity', () => {
    const w1 = workbook();
    w1.skills[4]![1] = 'XD-99';
    expect(issuesOf(w1).join('\n')).toContain('неизвестная область «XD-99»');

    const w2 = workbook();
    w2.skills[4]![3] = 'XSD-09.09';
    expect(issuesOf(w2).join('\n')).toContain('неизвестная подобласть «XSD-09.09»');

    const w3 = workbook();
    w3.skills[4]![3] = 'XSD-02.01'; // подобласть области Б у навыка области А
    expect(issuesOf(w3).join('\n')).toContain('принадлежит области XD-02, а не XD-01');

    const w4 = workbook();
    w4.subdomains[4]![1] = 'XD-77';
    expect(issuesOf(w4).join('\n')).toContain('несуществующую область «XD-77»');
  });

  it('checks the duplicated names against the area and subarea sheets', () => {
    const w = workbook();
    w.skills[4]![2] = 'Другая область';
    w.skills[5]![4] = 'Другая подобласть';
    const text = issuesOf(w).join('\n');
    expect(text).toContain('название области не совпадает');
    expect(text).toContain('название подобласти не совпадает');
  });

  it('requires name, definition, status and a well-formed profile', () => {
    const w = workbook();
    w.skills[4]![5] = null;
    w.skills[4]![6] = '';
    w.skills[4]![10] = null;
    w.skills[4]![12] = 'analyst';
    const text = issuesOf(w).join('\n');
    expect(text).toContain('пустое название навыка');
    expect(text).toContain('пустое определение навыка');
    expect(text).toContain('пустой статус записи');
    expect(text).toContain('некорректный профиль «analyst»');
  });

  it('cross-checks the counts declared on the areas sheet', () => {
    const w = workbook();
    w.domains[4]![3] = 5;
    w.domains[4]![4] = 9;
    const text = issuesOf(w).join('\n');
    expect(text).toContain('XD-01: заявлено подобластей 5, найдено 1');
    expect(text).toContain('XD-01: заявлено навыков 9, найдено 2');
  });

  it('rejects values without an id and unexpected cell types', () => {
    const w1 = workbook();
    w1.skills.push([null, 'XD-01', 'Область А', 'XSD-01.01']);
    expect(issuesOf(w1).join('\n')).toContain('значения без идентификатора');

    const w2 = workbook();
    w2.skills[4]![6] = 12345;
    expect(issuesOf(w2).join('\n')).toContain('ожидалась строка, получено number');
  });

  it('collects several problems into ONE error instead of stopping at the first', () => {
    const w = workbook();
    w.skills[4]![0] = 'bad';
    w.skills[5]![1] = 'XD-99';
    w.domains[5]![0] = 'oops';
    expect(issuesOf(w).length).toBeGreaterThanOrEqual(3);
  });
});

describe('computeSkillContentHash', () => {
  const base: XskSkillFields = {
    skillId: 'XSK-000001', domainId: 'XD-01', subdomainId: 'XSD-01.01', name: 'n', definition: 'd',
    observableResult: 'o', assessmentMethod: 'm', safetyBoundaries: 'b', recordStatus: 's',
    externalMapping: null, profileId: 'ANL', classificationBasis: 'c',
  };

  it('is a stable 64-hex digest', () => {
    expect(computeSkillContentHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSkillContentHash({ ...base })).toBe(computeSkillContentHash(base));
  });

  it('changes when ANY field changes (and null differs from an empty string)', () => {
    const h = computeSkillContentHash(base);
    for (const key of Object.keys(base) as Array<keyof XskSkillFields>) {
      const changed = { ...base, [key]: `${String(base[key] ?? '')}!` } as XskSkillFields;
      expect(computeSkillContentHash(changed), key).not.toBe(h);
    }
    expect(computeSkillContentHash({ ...base, externalMapping: '' })).not.toBe(h);
  });

  it('is pinned: the field order is part of the contract', () => {
    expect(computeSkillContentHash(base))
      .toBe(sha256Hex(JSON.stringify([
        'XSK-000001', 'XD-01', 'XSD-01.01', 'n', 'd', 'o', 'm', 'b', 's', null, 'ANL', 'c',
      ])));
  });
});

describe('assertCatalogMatchesSpec / pinned sources', () => {
  const spec: XskSourceSpec = {
    catalogVersion: 'test', sha256: 'x'.repeat(64), bytes: 1,
    expected: {
      domains: 2, subdomains: 2, skills: 3,
      statuses: { Черновик: 2, Новый: 1 },
      profiles: ['ANL', 'OPS', 'QA'],
    },
  };

  it('accepts a catalog that matches the spec exactly', () => {
    expect(() => assertCatalogMatchesSpec(parse(workbook()), spec)).not.toThrow();
  });

  it('rejects wrong counts, wrong status distribution and an unexpected profile set', () => {
    const c = parse(workbook());
    const text = (s: XskSourceSpec): string => {
      try {
        assertCatalogMatchesSpec(c, s);
      } catch (e) {
        return (e as Error).message;
      }
      return '';
    };
    expect(text({ ...spec, expected: { ...spec.expected, skills: 4 } })).toContain('навыков 3, ожидалось 4');
    expect(text({ ...spec, expected: { ...spec.expected, statuses: { Черновик: 3 } } })).toContain('статус «Новый»');
    expect(text({ ...spec, expected: { ...spec.expected, profiles: ['ANL', 'OPS'] } })).toContain('профили');
  });

  it('pins version 0.9.1 to the checksum and size recorded in the plan', () => {
    const s = findKnownSource('fa5612cee87af7a64a37916de1216776bf9217c915bb6e3b57876a7b0bcdb497');
    expect(s?.catalogVersion).toBe('0.9.1');
    expect(s?.bytes).toBe(1_103_161);
    expect(s?.expected).toMatchObject({ domains: 24, subdomains: 96, skills: 322 });
    expect(Object.values(s?.expected.statuses ?? {}).reduce((a, b) => a + b, 0)).toBe(322);
    expect(findKnownSource('0'.repeat(64))).toBeUndefined();
    expect(new Set(KNOWN_XSK_SOURCES.map((k) => k.sha256)).size).toBe(KNOWN_XSK_SOURCES.length);
    expect(new Set(KNOWN_XSK_SOURCES.map((k) => k.catalogVersion)).size).toBe(KNOWN_XSK_SOURCES.length);
  });
});

describe('xsk-import.ts must stay confined to the xsk_* tables (stage 6a)', () => {
  const source = readFileSync(fileURLToPath(new URL('./xsk-import.ts', import.meta.url)), 'utf8');

  it('writes only to xsk_ tables', () => {
    const targets = [
      ...source.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi),
    ].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t, `write target ${t}`).toMatch(/^xsk_/);
    }
  });

  it('never touches atoms, passports, assessments or directions', () => {
    for (const forbidden of ['competency_atoms', 'person_atom_states', 'passport_', 'atom_direction_map', 'catalog_proposals']) {
      expect(source.includes(forbidden), forbidden).toBe(false);
    }
  });
});
