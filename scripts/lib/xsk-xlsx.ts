// Чтение xlsx каталога XSK (Фаза 1, этап 6a). Библиотека read-excel-file нужна
// ТОЛЬКО здесь, в scripts/: API её не импортирует, поэтому в рантайме её нет.
//
// Порядок важен: сначала байты и SHA-256, и только для закреплённого снимка
// разбор. Файл с неизвестным хэшем (повреждённый, усечённый, пересохранённый)
// в парсер не попадает: парсер может зависнуть или вести себя непредсказуемо на
// битом zip. Хэш считается от тех же байт, которые потом разбираются.

import { readFile } from 'node:fs/promises';

import readXlsxFile from 'read-excel-file/node';

import {
  sha256Hex,
  type SheetData,
  type XskWorkbookSheets,
} from '../../src/core/passport/xsk-catalog-parse.js';

export interface XskFileBytes {
  buf: Buffer;
  sha256: string;
  bytes: number;
}

export interface XskWorkbook extends XskFileBytes {
  sheets: XskWorkbookSheets;
}

/** Шаг 1: только байты и хэш, без разбора. */
export async function readXskFile(path: string): Promise<XskFileBytes> {
  const buf = await readFile(path);
  return { buf, sha256: sha256Hex(buf), bytes: buf.length };
}

/** Шаг 2: разбор. Вызывать только для файла, чей SHA-256 уже сверен с закреплённым. */
export async function parseXskWorkbook(buf: Buffer): Promise<XskWorkbookSheets> {
  const sheets = await readXlsxFile(buf);
  const byName = new Map<string, SheetData>(sheets.map((s) => [s.sheet, s.data as SheetData]));
  const need = (name: string): SheetData => {
    const data = byName.get(name);
    if (!data) {
      throw new Error(`В книге нет листа «${name}» (есть: ${[...byName.keys()].slice(0, 8).join(', ')}…)`);
    }
    return data;
  };
  return { skills: need('Навыки'), domains: need('Области'), subdomains: need('Подобласти') };
}

/** Удобная обёртка для тестов: байты, хэш и разбор. НЕ для импорта (там порядок строже). */
export async function readXskWorkbook(path: string): Promise<XskWorkbook> {
  const file = await readXskFile(path);
  return { ...file, sheets: await parseXskWorkbook(file.buf) };
}
