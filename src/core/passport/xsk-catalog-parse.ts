// Кандидат ID: C.1.16.02 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Чистая (без БД и без библиотеки xlsx) логика разбора и валидации каталога XSK
// (Фаза 1, этап 6a; §4.2 плана). Читает уже загруженные строки листов, поэтому
// библиотека для xlsx нужна только скриптам (scripts/lib/xsk-xlsx.ts), а не API.
//
// Правила:
//   * колонки ищутся по ИМЕНАМ заголовков, а не по позициям; нет колонки — ошибка;
//   * значения сохраняются дословно (без trim и нормализации); пустое → null;
//   * проверяются форматы ID, уникальность, ссылочная целостность, совпадение
//     дублирующих названий («Область», «Подобласть») и счётчиков на листе «Области»;
//   * ВСЕ найденные проблемы собираются и выбрасываются одной ошибкой;
//   * принимается только закреплённый снимок (KNOWN_XSK_SOURCES): неизвестный файл
//     (в том числе пересохранённый в Excel) импортировать нельзя.
//
// Что здесь НЕ читается намеренно: критерии, HRisk, маршруты, направления, ЗПО.

import { createHash } from 'node:crypto';

export type SheetData = ReadonlyArray<ReadonlyArray<unknown>>;

export interface XskWorkbookSheets {
  skills: SheetData;
  domains: SheetData;
  subdomains: SheetData;
}

export interface XskDomain {
  domainId: string;
  name: string;
  focus: string | null;
}

export interface XskSubdomain {
  subdomainId: string;
  domainId: string;
  name: string;
  scopeText: string | null;
  recordStatus: string | null;
}

export interface XskSkillFields {
  skillId: string;
  domainId: string;
  subdomainId: string;
  name: string;
  definition: string;
  observableResult: string | null;
  assessmentMethod: string | null;
  safetyBoundaries: string | null;
  recordStatus: string;
  externalMapping: string | null;
  profileId: string;
  classificationBasis: string | null;
}

export interface XskSkill extends XskSkillFields {
  contentSha256: string;
}

export interface XskCatalog {
  domains: XskDomain[];
  subdomains: XskSubdomain[];
  skills: XskSkill[];
}

export class XskCatalogValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(
      `XSK catalog validation failed (${issues.length} issue(s)):\n`
      + issues.slice(0, 20).map((i) => `  - ${i}`).join('\n')
      + (issues.length > 20 ? `\n  … and ${issues.length - 20} more` : ''),
    );
    this.name = 'XskCatalogValidationError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Закреплённые снимки
// ─────────────────────────────────────────────────────────────────────

export interface XskSourceSpec {
  catalogVersion: string;
  sha256: string;
  bytes: number;
  expected: {
    domains: number;
    subdomains: number;
    skills: number;
    /** Точное распределение статусов записей навыков. */
    statuses: Readonly<Record<string, number>>;
    /** Допустимые идентификаторы профилей оценивания. */
    profiles: readonly string[];
  };
}

/**
 * Единственные файлы, которые можно импортировать. Новая версия каталога
 * добавляется сюда отдельным ревьюируемым изменением. Версия книги — снимок,
 * а не вечная ссылка на изменяемый файл.
 */
export const KNOWN_XSK_SOURCES: readonly XskSourceSpec[] = [
  {
    catalogVersion: '0.9.1',
    sha256: 'fa5612cee87af7a64a37916de1216776bf9217c915bb6e3b57876a7b0bcdb497',
    bytes: 1_103_161,
    expected: {
      domains: 24,
      subdomains: 96,
      skills: 322,
      statuses: {
        'Черновик — нужна предметная проверка критериев': 158,
        'Черновик — риск-аудит v0.4; требуется предметная валидация': 118,
        'Новый черновик — валидация предметным советом': 46,
      },
      profiles: ['ANL', 'COM', 'DES', 'MGT', 'OPS', 'QA'],
    },
  },
];

export function findKnownSource(sha256: string): XskSourceSpec | undefined {
  return KNOWN_XSK_SOURCES.find((s) => s.sha256 === sha256);
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Заголовки листов (точные имена из каталога v0.9.1)
// ─────────────────────────────────────────────────────────────────────

const SKILL_HEADERS = {
  skillId: 'Skill_ID',
  domainId: 'Domain_ID',
  domainName: 'Область',
  subdomainId: 'Subdomain_ID',
  subdomainName: 'Подобласть',
  name: 'Фиксированное название навыка',
  definition: 'Определение навыка',
  observableResult: 'Наблюдаемый результат / доказательство',
  assessmentMethod: 'Метод оценки',
  safetyBoundaries: 'Границы и безопасность',
  recordStatus: 'Статус записи',
  externalMapping: 'Внешнее сопоставление',
  profileId: 'Профиль оценки v0.3',
  classificationBasis: 'Основание классификации',
} as const;

const DOMAIN_HEADERS = {
  domainId: 'Domain_ID',
  name: 'Название области',
  focus: 'Группа / фокус',
  subdomainsCount: 'Число подобластей',
  skillsCount: 'Число навыков',
} as const;

const SUBDOMAIN_HEADERS = {
  subdomainId: 'Subdomain_ID',
  domainId: 'Domain_ID',
  name: 'Подобласть',
  scopeText: 'Границы / содержание',
  recordStatus: 'Статус',
} as const;

const SKILL_ID_RE = /^XSK-\d{6}$/;
const DOMAIN_ID_RE = /^XD-\d{2}$/;
const SUBDOMAIN_ID_RE = /^XSD-\d{2}\.\d{2}$/;
const PROFILE_RE = /^[A-Z]{2,4}$/;

// ─────────────────────────────────────────────────────────────────────
// Чтение таблицы листа
// ─────────────────────────────────────────────────────────────────────

interface RawRow<K extends string> {
  rowNumber: number; // 1-based, как в Excel
  cells: Record<K, unknown>;
}

function readTable<K extends string>(
  sheetLabel: string,
  rows: SheetData,
  headers: Record<K, string>,
  issues: string[],
): Array<RawRow<K>> {
  const firstHeader = Object.values<string>(headers)[0] as string;
  const headerIdx = rows.findIndex((r) => r[0] === firstHeader);
  if (headerIdx < 0) {
    issues.push(`${sheetLabel}: не найден заголовок таблицы (первая колонка «${firstHeader}»)`);
    return [];
  }
  const headerRow = rows[headerIdx] as ReadonlyArray<unknown>;
  const colOf = {} as Record<K, number>;
  for (const key of Object.keys(headers) as K[]) {
    const col = headerRow.findIndex((h) => h === headers[key]);
    if (col < 0) {
      issues.push(`${sheetLabel}: нет колонки «${headers[key]}»`);
    }
    colOf[key] = col;
  }
  if ((Object.values(colOf) as number[]).some((c) => c < 0)) {
    return [];
  }

  const out: Array<RawRow<K>> = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as ReadonlyArray<unknown>;
    const first = row[0];
    const rowNumber = i + 1;
    if (first === null || first === undefined || first === '') {
      if (row.some((c) => c !== null && c !== undefined && c !== '')) {
        issues.push(`${sheetLabel}, строка ${rowNumber}: значения без идентификатора в первой колонке`);
      }
      continue;
    }
    const cells = {} as Record<K, unknown>;
    for (const key of Object.keys(headers) as K[]) {
      cells[key] = row[colOf[key]];
    }
    out.push({ rowNumber, cells });
  }
  return out;
}

function textOrNull(v: unknown, where: string, issues: string[]): string | null {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  if (typeof v === 'string') {
    return v;
  }
  issues.push(`${where}: ожидалась строка, получено ${typeof v}`);
  return null;
}

function intOrNull(v: unknown, where: string, issues: string[]): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) {
    return v;
  }
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    return Number(v);
  }
  issues.push(`${where}: ожидалось целое число`);
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Хэш содержимого записи
// ─────────────────────────────────────────────────────────────────────

/**
 * SHA-256 содержимого записи навыка. Порядок и набор полей зафиксированы и не
 * должны меняться: хэш отличает версии одного и того же Skill_ID.
 */
export function computeSkillContentHash(f: XskSkillFields): string {
  return sha256Hex(JSON.stringify([
    f.skillId, f.domainId, f.subdomainId, f.name, f.definition,
    f.observableResult, f.assessmentMethod, f.safetyBoundaries,
    f.recordStatus, f.externalMapping, f.profileId, f.classificationBasis,
  ]));
}

// ─────────────────────────────────────────────────────────────────────
// Разбор и валидация
// ─────────────────────────────────────────────────────────────────────

export function parseXskCatalog(sheets: XskWorkbookSheets): XskCatalog {
  const issues: string[] = [];

  // Области
  const domains: XskDomain[] = [];
  const domainCounts = new Map<string, { sub: number | null; skills: number | null }>();
  const domainIds = new Set<string>();
  for (const r of readTable('Области', sheets.domains, DOMAIN_HEADERS, issues)) {
    const w = `Области, строка ${r.rowNumber}`;
    const id = textOrNull(r.cells.domainId, `${w}, Domain_ID`, issues);
    const name = textOrNull(r.cells.name, `${w}, название`, issues);
    if (!id || !DOMAIN_ID_RE.test(id)) {
      issues.push(`${w}: некорректный Domain_ID «${String(id)}»`);
      continue;
    }
    if (domainIds.has(id)) {
      issues.push(`${w}: дубликат Domain_ID ${id}`);
      continue;
    }
    if (!name) {
      issues.push(`${w}: пустое название области ${id}`);
      continue;
    }
    domainIds.add(id);
    domains.push({ domainId: id, name, focus: textOrNull(r.cells.focus, `${w}, фокус`, issues) });
    domainCounts.set(id, {
      sub: intOrNull(r.cells.subdomainsCount, `${w}, число подобластей`, issues),
      skills: intOrNull(r.cells.skillsCount, `${w}, число навыков`, issues),
    });
  }

  // Подобласти
  const subdomains: XskSubdomain[] = [];
  const subById = new Map<string, XskSubdomain>();
  for (const r of readTable('Подобласти', sheets.subdomains, SUBDOMAIN_HEADERS, issues)) {
    const w = `Подобласти, строка ${r.rowNumber}`;
    const id = textOrNull(r.cells.subdomainId, `${w}, Subdomain_ID`, issues);
    const domainId = textOrNull(r.cells.domainId, `${w}, Domain_ID`, issues);
    const name = textOrNull(r.cells.name, `${w}, название`, issues);
    if (!id || !SUBDOMAIN_ID_RE.test(id)) {
      issues.push(`${w}: некорректный Subdomain_ID «${String(id)}»`);
      continue;
    }
    if (subById.has(id)) {
      issues.push(`${w}: дубликат Subdomain_ID ${id}`);
      continue;
    }
    if (!domainId || !domainIds.has(domainId)) {
      issues.push(`${w}: подобласть ${id} ссылается на несуществующую область «${String(domainId)}»`);
      continue;
    }
    if (!name) {
      issues.push(`${w}: пустое название подобласти ${id}`);
      continue;
    }
    const sub: XskSubdomain = {
      subdomainId: id,
      domainId,
      name,
      scopeText: textOrNull(r.cells.scopeText, `${w}, границы`, issues),
      recordStatus: textOrNull(r.cells.recordStatus, `${w}, статус`, issues),
    };
    subdomains.push(sub);
    subById.set(id, sub);
  }

  // Навыки
  const skills: XskSkill[] = [];
  const skillIds = new Set<string>();
  const domainById = new Map(domains.map((d) => [d.domainId, d]));
  for (const r of readTable('Навыки', sheets.skills, SKILL_HEADERS, issues)) {
    const w = `Навыки, строка ${r.rowNumber}`;
    const c = r.cells;
    const skillId = textOrNull(c.skillId, `${w}, Skill_ID`, issues);
    if (!skillId || !SKILL_ID_RE.test(skillId)) {
      issues.push(`${w}: некорректный Skill_ID «${String(skillId)}»`);
      continue;
    }
    if (skillIds.has(skillId)) {
      issues.push(`${w}: дубликат Skill_ID ${skillId}`);
      continue;
    }
    skillIds.add(skillId);

    const domainId = textOrNull(c.domainId, `${w}, Domain_ID`, issues);
    const subdomainId = textOrNull(c.subdomainId, `${w}, Subdomain_ID`, issues);
    const name = textOrNull(c.name, `${w}, название`, issues);
    const definition = textOrNull(c.definition, `${w}, определение`, issues);
    const recordStatus = textOrNull(c.recordStatus, `${w}, статус записи`, issues);
    const profileId = textOrNull(c.profileId, `${w}, профиль`, issues);

    const domain = domainId ? domainById.get(domainId) : undefined;
    const sub = subdomainId ? subById.get(subdomainId) : undefined;
    if (!domain) {
      issues.push(`${w} (${skillId}): неизвестная область «${String(domainId)}»`);
    }
    if (!sub) {
      issues.push(`${w} (${skillId}): неизвестная подобласть «${String(subdomainId)}»`);
    } else if (domainId && sub.domainId !== domainId) {
      issues.push(`${w} (${skillId}): подобласть ${sub.subdomainId} принадлежит области ${sub.domainId}, а не ${domainId}`);
    }
    if (domain && textOrNull(c.domainName, `${w}, «Область»`, issues) !== domain.name) {
      issues.push(`${w} (${skillId}): название области не совпадает с листом «Области»`);
    }
    if (sub && textOrNull(c.subdomainName, `${w}, «Подобласть»`, issues) !== sub.name) {
      issues.push(`${w} (${skillId}): название подобласти не совпадает с листом «Подобласти»`);
    }
    if (!name) {issues.push(`${w} (${skillId}): пустое название навыка`);}
    if (!definition) {issues.push(`${w} (${skillId}): пустое определение навыка`);}
    if (!recordStatus) {issues.push(`${w} (${skillId}): пустой статус записи`);}
    if (!profileId || !PROFILE_RE.test(profileId)) {
      issues.push(`${w} (${skillId}): некорректный профиль «${String(profileId)}»`);
    }

    if (!domain || !sub || !domainId || !subdomainId || !name || !definition
        || !recordStatus || !profileId || !PROFILE_RE.test(profileId)) {
      continue;
    }
    const fields: XskSkillFields = {
      skillId,
      domainId,
      subdomainId,
      name,
      definition,
      observableResult: textOrNull(c.observableResult, `${w}, результат`, issues),
      assessmentMethod: textOrNull(c.assessmentMethod, `${w}, метод оценки`, issues),
      safetyBoundaries: textOrNull(c.safetyBoundaries, `${w}, границы`, issues),
      recordStatus,
      externalMapping: textOrNull(c.externalMapping, `${w}, внешнее сопоставление`, issues),
      profileId,
      classificationBasis: textOrNull(c.classificationBasis, `${w}, основание`, issues),
    };
    skills.push({ ...fields, contentSha256: computeSkillContentHash(fields) });
  }

  // Счётчики на листе «Области» должны совпадать с реальными.
  for (const d of domains) {
    const declared = domainCounts.get(d.domainId);
    const subCount = subdomains.filter((s) => s.domainId === d.domainId).length;
    const skillCount = skills.filter((s) => s.domainId === d.domainId).length;
    if (declared?.sub !== null && declared?.sub !== undefined && declared.sub !== subCount) {
      issues.push(`Области, ${d.domainId}: заявлено подобластей ${declared.sub}, найдено ${subCount}`);
    }
    if (declared?.skills !== null && declared?.skills !== undefined && declared.skills !== skillCount) {
      issues.push(`Области, ${d.domainId}: заявлено навыков ${declared.skills}, найдено ${skillCount}`);
    }
  }

  if (issues.length > 0) {
    throw new XskCatalogValidationError(issues);
  }
  skills.sort((a, b) => a.skillId.localeCompare(b.skillId));
  return { domains, subdomains, skills };
}

/** Сверяет разобранный каталог с ожиданиями закреплённого снимка. */
export function assertCatalogMatchesSpec(catalog: XskCatalog, spec: XskSourceSpec): void {
  const issues: string[] = [];
  const e = spec.expected;
  if (catalog.domains.length !== e.domains) {
    issues.push(`областей ${catalog.domains.length}, ожидалось ${e.domains}`);
  }
  if (catalog.subdomains.length !== e.subdomains) {
    issues.push(`подобластей ${catalog.subdomains.length}, ожидалось ${e.subdomains}`);
  }
  if (catalog.skills.length !== e.skills) {
    issues.push(`навыков ${catalog.skills.length}, ожидалось ${e.skills}`);
  }
  const actual: Record<string, number> = {};
  for (const s of catalog.skills) {
    actual[s.recordStatus] = (actual[s.recordStatus] ?? 0) + 1;
  }
  for (const k of new Set([...Object.keys(actual), ...Object.keys(e.statuses)])) {
    if ((actual[k] ?? 0) !== (e.statuses[k] ?? 0)) {
      issues.push(`статус «${k}»: ${actual[k] ?? 0}, ожидалось ${e.statuses[k] ?? 0}`);
    }
  }
  const profiles = [...new Set(catalog.skills.map((s) => s.profileId))].sort();
  if (JSON.stringify(profiles) !== JSON.stringify([...e.profiles].sort())) {
    issues.push(`профили ${profiles.join(',')}, ожидалось ${[...e.profiles].sort().join(',')}`);
  }
  if (issues.length > 0) {
    throw new XskCatalogValidationError(issues.map((i) => `версия ${spec.catalogVersion}: ${i}`));
  }
}
