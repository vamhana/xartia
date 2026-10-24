// L.0.01.14 — CSV-парсер и форматтер.src/lib/csv.ts
//
// Минимальный, без внешних зависимостей. Используется в Imports (CSV) и
// в Exports (CSV-выгрузка через toCsv).
//
// Поддержка:
//   - первая строка — заголовки;
//   - поля в кавычках с экранированием "" → ";
//   - LF и CRLF;
//   - пустые поля;
//   - BOM в начале файла — срезается.
//
// Не поддерживает:
//   - многострочные поля (переносы строки внутри кавычек);
//   - trailing newline без данных.
// Для наших 10k-строк — достаточно; при необходимости — расширить.

// ─── Парсинг ─────────────────────────────────────────────────────

/**
 * Разбирает CSV-текст в массив объектов. Первая строка — заголовки.
 *
 * Дублирующиеся заголовки → перезаписываются (последний побеждает).
 * Пустые строки в конце файла игнорируются.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const cleaned = text.replace(/^\uFEFF/, ''); // BOM
  const lines = splitCsvLines(cleaned);
  if (lines.length === 0) {return [];}

  const headerLine = lines[0] ?? '';
  const headers = parseCsvLine(headerLine);
  if (headers.length === 0) {return [];}

  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') {continue;}
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (h !== undefined) {
        row[h] = values[j] ?? '';
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Разбивает текст на строки, учитывая, что перевод строки внутри
 * кавычек — часть поля.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Экранирование "" → " (проверка следующего символа).
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // CRLF → пропускаем LF.
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      lines.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {lines.push(current);}
  return lines;
}

/**
 * Разбирает одну CSV-строку в массив значений.
 * Поддерживает кавычки и экранирование "" → ".
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

// ─── Форматирование ─────────────────────────────────────────────

/**
 * Эскейпинг одного поля для CSV.
 * - Защита от CSV-injection: значения, начинающиеся с = + - @ → префикс "'".
 * - Значения с , " \n \r — в кавычках.
 */
export function escapeCsv(value: string): string {
  if (value === '') {return '';}
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const needsQuoting = dangerous || /[",\n\r]/.test(value);
  if (needsQuoting) {
    const escaped = value.replace(/"/g, '""');
    return dangerous ? `"'${escaped}"` : `"${escaped}"`;
  }
  return value;
}

/**
 * Форматирует массив объектов в CSV-строку.
 * Заголовки — в указанном порядке. Объекты вне headers → проигнорированы.
 * null/undefined → пустое поле. Объекты → JSON.stringify.
 */
export function toCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
): string {
  const lines: string[] = [headers.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) {return '';}
          if (typeof v === 'object') {return escapeCsv(JSON.stringify(v));}
          return escapeCsv(String(v));
        })
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}