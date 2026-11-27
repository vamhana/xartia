// Фаза 1, этап 6a — Smoke: каталог XSK (миграция 075).
//
// Прямой DB-скрипт (без API). Проверяет на реальной БД:
//   * импорт закреплённого снимка через настоящий CLI, идемпотентность;
//   * отказ на файле с другим SHA-256 (в т.ч. «пересохранённом»);
//   * содержимое: версия, счётчики, распределения, хэши всех 322 записей;
//   * read-only сервис (версии, навык, фильтры, пагинация, NotFound);
//   * неизменяемость таблиц (UPDATE / DELETE / TRUNCATE);
//   * изоляцию: импорт не меняет атомы, паспорта, оценки, направления.
//
// Запуск: pnpm tsx scripts/test-xsk-catalog.ts
// Скрипт НИЧЕГО не удаляет и не правит (таблицы неизменяемы); на пустой БД он
// впервые импортирует каталог — это и есть ожидаемый эффект миграции 075.

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { copyFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NotFoundError } from '../src/core/errors.js';
import {
  findKnownSource,
  parseXskCatalog,
} from '../src/core/passport/xsk-catalog-parse.js';
import {
  getXskCatalogVersion,
  getXskSkill,
  listXskCatalogVersions,
  listXskDomains,
  listXskSkills,
  listXskSubdomains,
} from '../src/core/passport/xsk-catalog.js';
import { query } from '../src/lib/db.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { readXskWorkbook } from './lib/xsk-xlsx.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const FILE = join(REPO_ROOT, 'docs', 'XartIA_Skill_Catalog.xlsx');
const VERSION = '0.9.1';

let failed = 0;
function pass(label: string): void {
  console.log(`PASS  ${label}`);
}
function fail(label: string, detail: unknown): void {
  failed++;
  console.log(`FAIL  ${label}  ${JSON.stringify(detail)}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass(label);
  } else {
    fail(label, { actual, expected });
  }
}

interface CliRun {
  status: number | null;
  json: Record<string, unknown> | null;
  stderr: string;
}

function runImportCli(extraArgs: string[] = []): CliRun {
  const r = spawnSync(
    process.execPath,
    [TSX_CLI, join(REPO_ROOT, 'scripts', 'import-xsk-catalog.ts'), ...extraArgs],
    { encoding: 'utf8', timeout: 120_000, cwd: REPO_ROOT },
  );
  const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('{"status"')).pop();
  return {
    status: r.status,
    json: line ? (JSON.parse(line) as Record<string, unknown>) : null,
    stderr: r.stderr ?? '',
  };
}

// Таблицы, которых импорт XSK не вправе касаться.
const ISOLATION_TABLES = [
  'competency_atoms', 'person_atom_states', 'passport_assessments',
  'atom_direction_map', 'anchor_examples', 'calibration_sessions',
];

async function fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of ISOLATION_TABLES) {
    const rows = await query<{ n: number; h: string }>(
      `SELECT count(*)::int AS n, COALESCE(md5(string_agg(x::text, '|' ORDER BY x::text)), '') AS h
         FROM ${t} x`,
    );
    out[t] = `${rows[0]?.n}:${rows[0]?.h}`;
  }
  return out;
}

async function expectRefused(label: string, sql: string): Promise<void> {
  try {
    await query(sql);
    fail(label, 'statement was NOT refused');
  } catch (e) {
    if (e instanceof Error && /read-only/.test(e.message)) {
      pass(label);
    } else {
      fail(label, String(e));
    }
  }
}

async function main(): Promise<void> {
  const wb = await readXskWorkbook(FILE);
  const spec = findKnownSource(wb.sha256);
  if (!spec) {
    fail('0. docs/XartIA_Skill_Catalog.xlsx совпадает с закреплённым снимком',
      { sha256: wb.sha256, hint: 'git checkout -- docs/XartIA_Skill_Catalog.xlsx' });
    return;
  }
  pass(`0. файл совпадает с закреплённым снимком ${spec.catalogVersion}`);
  const catalog = parseXskCatalog(wb.sheets);

  // ── 1–3. Импорт, идемпотентность, изоляция ──────────────────────────
  const before = await fingerprint();
  const first = runImportCli();
  if (first.status === 0 && first.json
      && (first.json['status'] === 'imported' || first.json['status'] === 'already_imported')) {
    pass(`1. импорт через CLI: ${String(first.json['status'])}`);
  } else {
    fail('1. импорт через CLI', { status: first.status, json: first.json, stderr: first.stderr.slice(0, 600) });
    return;
  }
  const second = runImportCli();
  eq('2. повторный импорт идемпотентен (already_imported)', second.json?.['status'], 'already_imported');
  eq('2b. итог содержит версию и счётчики',
    [second.json?.['catalogVersion'], second.json?.['domains'], second.json?.['subdomains'], second.json?.['skills']],
    [VERSION, 24, 96, 322]);
  const after = await fingerprint();
  eq('3. импорт не изменил атомы, паспорта, оценки, направления, калибровку', after, before);

  // ── 4. Содержимое ───────────────────────────────────────────────────
  const ver = await getXskCatalogVersion(VERSION);
  eq('4a. версия: SHA-256, размер, счётчики',
    [ver.sourceSha256, ver.sourceBytes, ver.domainsCount, ver.subdomainsCount, ver.skillsCount],
    [spec.sha256, spec.bytes, 24, 96, 322]);
  const dbHashes = await query<{ skill_id: string; content_sha256: string }>(
    'SELECT skill_id, content_sha256 FROM xsk_skills WHERE catalog_version = $1 ORDER BY skill_id',
    [VERSION],
  );
  eq('4b. хэши содержимого всех 322 записей совпадают с файлом',
    dbHashes.map((r) => `${r.skill_id}:${r.content_sha256.trim()}`),
    catalog.skills.map((s) => `${s.skillId}:${s.contentSha256}`));
  const statuses = await query<{ record_status: string; n: number }>(
    `SELECT record_status, count(*)::int AS n FROM xsk_skills
      WHERE catalog_version = $1 GROUP BY 1 ORDER BY 1`, [VERSION]);
  eq('4c. распределение статусов записей',
    Object.fromEntries(statuses.map((r) => [r.record_status, r.n])),
    Object.fromEntries(Object.entries(spec.expected.statuses).sort(([a], [b]) => a.localeCompare(b))));

  // ── 5. Read-only сервис ─────────────────────────────────────────────
  const versions = await listXskCatalogVersions();
  eq('5a. версия каталога видна в списке', versions.some((v) => v.catalogVersion === VERSION), true);
  const s1 = await getXskSkill(VERSION, 'XSK-000001');
  eq('5b. навык XSK-000001: поля записи',
    [s1.skillId, s1.domainId, s1.subdomainId, s1.profileId, s1.name.length > 0, s1.definition.length > 0],
    ['XSK-000001', 'XD-01', 'XSD-01.01', 'ANL', true, true]);
  const domains = await listXskDomains(VERSION);
  eq('5c. областей 24', domains.length, 24);
  const firstDomain = domains[0]?.domainId ?? 'XD-01';
  const subs = await listXskSubdomains(VERSION, firstDomain);
  eq('5d. подобласти фильтруются по области', subs.every((s) => s.domainId === firstDomain) && subs.length > 0, true);
  const byDomain = await listXskSkills({ catalogVersion: VERSION, domainId: firstDomain, limit: 500 });
  eq('5e. фильтр по области совпадает с файлом',
    byDomain.total, catalog.skills.filter((s) => s.domainId === firstDomain).length);
  const page = await listXskSkills({ catalogVersion: VERSION, limit: 10, offset: 5 });
  eq('5f. пагинация: 10 записей, всего 322, первая XSK-000006',
    [page.items.length, page.total, page.items[0]?.skillId], [10, 322, 'XSK-000006']);
  const needle = (catalog.skills[2]?.name ?? '').slice(2, 9).toUpperCase();
  const byName = await listXskSkills({ catalogVersion: VERSION, nameContains: needle, limit: 500 });
  eq('5g. поиск по названию нечувствителен к регистру',
    byName.items.some((s) => s.skillId === catalog.skills[2]?.skillId), true);
  for (const [label, fn] of [
    ['5h. неизвестный навык → NotFound', () => getXskSkill(VERSION, 'XSK-999999')],
    ['5i. неизвестная версия → NotFound', () => getXskCatalogVersion('9.9.9')],
    ['5j. список навыков неизвестной версии → NotFound', () => listXskSkills({ catalogVersion: '9.9.9' })],
  ] as const) {
    try {
      await fn();
      fail(label, 'no error');
    } catch (e) {
      eq(label, e instanceof NotFoundError, true);
    }
  }

  // ── 6. Неизменяемость ───────────────────────────────────────────────
  for (const t of ['xsk_catalog_versions', 'xsk_domains', 'xsk_subdomains', 'xsk_skills']) {
    await expectRefused(`6. ${t}: UPDATE отклонён`, `UPDATE ${t} SET catalog_version = catalog_version`);
    await expectRefused(`6. ${t}: DELETE отклонён`, `DELETE FROM ${t}`);
    await expectRefused(`6. ${t}: TRUNCATE отклонён`, `TRUNCATE ${t} CASCADE`);
  }

  // ── 7. Файл с другим SHA-256 отвергается ────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'xsk-smoke-'));
  try {
    const altered = join(dir, 'XartIA_Skill_Catalog.xlsx');
    copyFileSync(FILE, altered);
    appendFileSync(altered, Buffer.from([0]));
    const bad = runImportCli(['--file', altered]);
    if (bad.status !== 0 && bad.json === null && /не совпадает ни с одним закреплённым снимком/.test(bad.stderr)) {
      pass('7. файл с другим SHA-256 отвергнут (код выхода ≠ 0, БД не тронута)');
    } else {
      fail('7. файл с другим SHA-256 отвергнут', { status: bad.status, stderr: bad.stderr.slice(0, 300) });
    }
    eq('7b. после отказа каталог без изменений',
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM xsk_skills'))[0]?.n,
      (await query<{ n: number }>('SELECT count(*)::int AS n FROM xsk_skills WHERE catalog_version = $1', [VERSION]))[0]?.n);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
