// Фаза 1, этап 6a — импорт каталога XSK в read-only таблицы (миграция 075).
//
// Принимает ТОЛЬКО закреплённый снимок (KNOWN_XSK_SOURCES): неизвестный файл,
// в том числе пересохранённый в Excel, отвергается по SHA-256. Идемпотентен.
// Пишет только в xsk_*; атомы, паспорта и направления не затрагиваются.
//
// Запуск: pnpm tsx scripts/import-xsk-catalog.ts [--file docs/XartIA_Skill_Catalog.xlsx]
// Последняя строка вывода — JSON-итог (его читает смоук).

import 'dotenv/config';
import { relative, resolve } from 'node:path';

import {
  KNOWN_XSK_SOURCES,
  findKnownSource,
  parseXskCatalog,
} from '../src/core/passport/xsk-catalog-parse.js';
import { importXskCatalog } from '../src/core/passport/xsk-import.js';
import { gracefulShutdown } from '../src/lib/shutdown.js';

import { parseXskWorkbook, readXskFile } from './lib/xsk-xlsx.js';

const DEFAULT_FILE = 'docs/XartIA_Skill_Catalog.xlsx';

async function main(): Promise<void> {
  const argIdx = process.argv.indexOf('--file');
  const file = resolve(argIdx >= 0 ? (process.argv[argIdx + 1] ?? DEFAULT_FILE) : DEFAULT_FILE);

  // Сначала байты и хэш; в парсер попадает только файл закреплённого снимка.
  const wb = await readXskFile(file);
  const spec = findKnownSource(wb.sha256);
  if (!spec) {
    throw new Error(
      `Файл ${file} не совпадает ни с одним закреплённым снимком XSK.\n`
      + `  SHA-256 файла: ${wb.sha256} (${wb.bytes} байт)\n`
      + `  Закреплено: ${KNOWN_XSK_SOURCES.map((s) => `${s.catalogVersion} = ${s.sha256}`).join('; ')}\n`
      + '  Если файл пересохранён в Excel, верните канонический: git checkout -- docs/XartIA_Skill_Catalog.xlsx',
    );
  }
  if (spec.bytes !== wb.bytes) {
    throw new Error(`Размер файла ${wb.bytes} не совпадает с закреплённым ${spec.bytes}`);
  }

  const catalog = parseXskCatalog(await parseXskWorkbook(wb.buf));
  const result = await importXskCatalog({
    catalog,
    spec,
    sourceFile: relative(process.cwd(), file).replace(/\\/g, '/'),
    sourceBytes: wb.bytes,
  });
  console.log(JSON.stringify(result));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gracefulShutdown();
  });
