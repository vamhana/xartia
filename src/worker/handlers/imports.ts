// I.9.07.03 — Обработчики импорта для worker.src/worker/handlers/imports.ts
//
// 3 handler'а: participants, goods, dictionary.
// Каждый: download CSV → parse → валидация → дедупликация → (dry-run | execute).
//
// Лимиты: 10 MB файл, 10 000 строк.
// Dry-run: preview в S3, никаких INSERT.
// Execute: INSERT по строкам, каждая независима (ошибка одной не откатывает партию).
//
// PII (participants): phone → encryptField, phone_hash → hashForSearch,
// password_hash → hashPassword(temp).

import { z } from 'zod';

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  formatReportKey,
  type ImportError,
  type ImportPreview,
  type ImportReport,
  type ImportType,
} from '../../core/imports/entity.js';
import type { UUID } from '../../core/types.js';
import { parseCsv } from '../../lib/csv.js';
import { query, queryOne } from '../../lib/db.js';
import { newUUID , formatParticipantId } from '../../lib/id.js';
import {
  complete,
  updateProgress,
  type Job,
} from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { upload } from '../../lib/s3.js';
import { hashForSearch, encryptField } from '../../security/encryption.js';
import { hashPassword } from '../../security/password.js';


// ─── Payload ─────────────────────────────────────────────────────

interface ImportPayload {
  importType: ImportType;
  fileUrl: string;
  dryRun: boolean;
  fromJobId?: UUID;
  requesterId: UUID;
}

function readPayload(job: Job): ImportPayload {
  const p = job.payload;
  const importType = (p['importType'] as ImportType | undefined) ?? 'participants';
  const fileUrl = (p['fileUrl'] as string | undefined) ?? '';
  const dryRun = p['dryRun'] === true;
  const fromJobId = (p['fromJobId'] as string | undefined) as UUID | undefined;
  const requesterId = (p['requesterId'] as UUID | undefined) ?? job.createdBy;
  return {
    importType,
    fileUrl,
    dryRun,
    ...(fromJobId ? { fromJobId } : {}),
    requesterId,
  };
}

/**
 * Следующий wave_number для (wave_letter, direction_id).
 * Используется, когда в CSV не задан ни external_id, ни wave_number.
 *
 * Если wave_number задан явно — используем его (доверяем оператору).
 * При коллизии — INSERT упадёт на UNIQUE, строка попадёт в errors.
 */
async function nextWaveNumber(
  directionId: string,
  waveLetter: string,
): Promise<number> {
  const row = await queryOne<{ max_wn: string | null }>(
    `SELECT MAX(wave_number)::text AS max_wn
       FROM participants
      WHERE deleted_at IS NULL
        AND direction_id = $1
        AND wave_letter = $2`,
    [directionId, waveLetter],
  );
  return parseInt(row?.max_wn ?? '0', 10) + 1;
}

// ─── Скачивание CSV ────────────────────────────────────────────

interface S3DownloadModule {
  download?: (key: string, bucket: string) => Promise<Buffer>;
}

async function downloadCsv(fileKey: string): Promise<Buffer> {
  const mod = (await import('../../lib/s3.js')) as S3DownloadModule;
  if (typeof mod.download === 'function') {
    return mod.download(fileKey, 'archive');
  }
  // Fallback через presigned URL + fetch.
  const { getDownloadUrl } = (await import('../../lib/s3.js')) as {
    getDownloadUrl: (
      key: string,
      bucket: string,
      ttlSec: number,
    ) => Promise<string>;
  };
  const url = await getDownloadUrl(fileKey, 'archive', 600);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download ${fileKey}: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── Общая загрузка + проверка лимитов ─────────────────────────

async function loadAndParse(
  job: Job,
  payload: ImportPayload,
): Promise<{ rows: Array<Record<string, string>>; text: string }> {
  await updateProgress(job.id, 5);

  const buf = await downloadCsv(payload.fileUrl);

  if (buf.length > MAX_IMPORT_BYTES) {
    throw new Error(
      `Файл слишком большой: ${buf.length} > ${MAX_IMPORT_BYTES} байт (10 MB)`,
    );
  }

  const text = buf.toString('utf8');
  const rows = parseCsv(text);

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(
      `Слишком много строк: ${rows.length} > ${MAX_IMPORT_ROWS}`,
    );
  }

  if (rows.length === 0) {
    throw new Error('CSV пустой (нет строк данных)');
  }

  await updateProgress(job.id, 10);
  return { rows, text };
}

// ─── Запись preview / report в S3 ──────────────────────────────

async function saveJson(key: string, data: unknown): Promise<void> {
  await upload(
    key,
    Buffer.from(JSON.stringify(data, null, 2), 'utf8'),
    'application/json; charset=utf-8',
    'archive',
  );
}

// ─── participants ───────────────────────────────────────────────

const participantRowSchema = z.object({
  external_id: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^[А-Я]?\d{5}-\d{1,2}(:.+)?$/.test(v),
      'external_id должен быть формата А00001-1',
    ),
  name: z.string().min(1).max(255),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'phone E.164'),
  messengers_json: z.string().optional(),
  direction_number: z.coerce.number().int().min(1).max(99),
  wave_letter: z.string().max(1).optional(),
  wave_number: z.coerce.number().int().min(0).max(99999).optional(),
});

interface ParticipantImportRow {
  external_id: string | null;
  name: string;
  phone: string;
  messengers: Record<string, string>;
  direction_number: number;
  wave_letter: string | null;
  wave_number: number | null;
}

export async function handleImportParticipants(job: Job): Promise<void> {
  const payload = readPayload(job);
  const { rows } = await loadAndParse(job, payload);

  const errors: ImportError[] = [];
  const valid: ParticipantImportRow[] = [];
  const seenPhones = new Set<string>();

  for (const [i, raw] of rows.entries()) {
    if (!raw) { continue; }
    const rowNum = i + 1;
    const parsed = participantRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNum,
          field: String(issue.path[0] ?? ''),
          message: issue.message,
        });
      }
      continue;
    }

    const r = parsed.data;
    if (seenPhones.has(r.phone)) {
      errors.push({
        row: rowNum,
        field: 'phone',
        message: 'дубликат внутри файла',
      });
      continue;
    }
    seenPhones.add(r.phone);

    let messengers: Record<string, string> = {};
    if (r.messengers_json) {
      try {
        messengers = JSON.parse(r.messengers_json) as Record<string, string>;
      } catch {
        errors.push({
          row: rowNum,
          field: 'messengers_json',
          message: 'невалидный JSON',
        });
        continue;
      }
    }

    valid.push({
      external_id: r.external_id && r.external_id.length > 0 ? r.external_id : null,
      name: r.name,
      phone: r.phone,
      messengers,
      direction_number: r.direction_number,
      wave_letter: r.wave_letter ?? null,
      wave_number: r.wave_number ?? null,
    });
  }

  await updateProgress(job.id, 30);

  // Дедупликация по phone_hash.
  const hashes = valid.map((r) => hashForSearch(r.phone));
  const existing = await query<{ phone_hash: string }>(
    `SELECT phone_hash FROM participants
      WHERE phone_hash = ANY($1::text[]) AND deleted_at IS NULL`,
    [hashes],
  );
  const existingSet = new Set(existing.map((r) => r.phone_hash));

  const toCreate: ParticipantImportRow[] = [];
  let toSkip = 0;
  for (const [i, r] of valid.entries()) {
    const h = hashes[i];
    if (!r || !h) { continue; }
    if (existingSet.has(h)) {
      toSkip++;
    } else {
      toCreate.push(r);
    }
  }

  await updateProgress(job.id, 50);

  const totalRows = rows.length;

  if (payload.dryRun) {
    const preview: ImportPreview = {
      toCreate: toCreate.length,
      toSkip,
      errors,
      totalRows,
    };
    const key = formatReportKey(job.id, true);
    await saveJson(key, preview);
    await updateProgress(job.id, 90);
    await complete(job.id, key);
    logger.info(
      { jobId: job.id, toCreate: toCreate.length, toSkip, errors: errors.length },
      'imports: participants dry-run complete',
    );
    return;
  }

  // Execute: INSERT по одной строке.
  let created = 0;
  let skipped = toSkip;
  const execErrors: ImportError[] = [...errors];

  // Lookup direction_id по direction_number (кэш).
  const dirCache = new Map<number, string>();
  const dirNumbers = [...new Set(toCreate.map((r) => r.direction_number))];
  if (dirNumbers.length > 0) {
    const dirs = await query<{ number: number; id: string }>(
      `SELECT number, id FROM directions WHERE number = ANY($1::int[])`,
      [dirNumbers],
    );
    for (const d of dirs) {dirCache.set(d.number, d.id);}
  }

  const totalToCreate = toCreate.length;
  let processed = 0;

  for (const r of toCreate) {
    processed++;
    const directionId = dirCache.get(r.direction_number);
    if (!directionId) {
      execErrors.push({
        row: -1,
        field: 'direction_number',
        message: `direction_number ${r.direction_number} не существует`,
      });
      continue;
    }

    try {
      const id = newUUID();
      const phoneHash = hashForSearch(r.phone);
      const encryptedPhone = encryptField(r.phone);
      const tempPassword = newUUID().slice(0, 16);
      const passwordHash = await hashPassword(tempPassword);

      const waveLetter = r.wave_letter ?? 'А';
      // Если external_id не задан и wave_number не задан — авто-генерация
      // через MAX(wave_number)+1 для (direction_id, wave_letter). Иначе
      // используем явный wave_number (при коллизии — errors, не падаем).
      const waveNumber = r.wave_number !== null
        ? r.wave_number
        : await nextWaveNumber(directionId, waveLetter);
      const externalId =
        r.external_id ??
        formatParticipantId(waveLetter, waveNumber, r.direction_number);

      await query(
        `INSERT INTO participants
           (id, external_id, wave_letter, wave_number, direction_id,
            name, phone, phone_hash, messengers, password_hash,
            status, profile_risk, entered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
                 'associated', 'compatible', now())`,
        [
          id,
          externalId,
          waveLetter,
          waveNumber,
          directionId,
          r.name,
          encryptedPhone,
          phoneHash,
          JSON.stringify(r.messengers),
          passwordHash,
        ],
      );
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      execErrors.push({
        row: -1,
        field: '',
        message: `INSERT failed: ${msg.slice(0, 200)}`,
      });
    }

    if (processed % 100 === 0) {
      await updateProgress(job.id, 50 + Math.round((processed / totalToCreate) * 40));
    }
  }

  const report: ImportReport = {
    created,
    skipped,
    errors: execErrors,
    totalRows,
  };
  const key = formatReportKey(job.id, false);
  await saveJson(key, report);
  await updateProgress(job.id, 90);
  await complete(job.id, key);
  logger.info(
    { jobId: job.id, created, skipped, errors: execErrors.length },
    'imports: participants execute complete',
  );
}

// ─── goods ─────────────────────────────────────────────────────

const goodRowSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['material', 'nonmaterial']),
  producer_direction_number: z.coerce.number().int().min(1).max(99),
  description: z.string().max(5000).optional(),
});

interface GoodImportRow {
  name: string;
  type: 'material' | 'nonmaterial';
  producer_direction_number: number;
  description: string | null;
}

export async function handleImportGoods(job: Job): Promise<void> {
  const payload = readPayload(job);
  const { rows } = await loadAndParse(job, payload);

  const errors: ImportError[] = [];
  const valid: GoodImportRow[] = [];

  for (const [i, raw] of rows.entries()) {
    if (!raw) { continue; }
    const rowNum = i + 1;
    const parsed = goodRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNum,
          field: String(issue.path[0] ?? ''),
          message: issue.message,
        });
      }
      continue;
    }
    const r = parsed.data;
    valid.push({
      name: r.name,
      type: r.type,
      producer_direction_number: r.producer_direction_number,
      description: r.description ?? null,
    });
  }

  await updateProgress(job.id, 30);

  // Дедупликация по (name, type).
  const names = valid.map((r) => r.name);
  const types = [...new Set(valid.map((r) => r.type))];

  const existing = names.length === 0
    ? []
    : await query<{ name: string; type: string }>(
        `SELECT name, type FROM goods
          WHERE name = ANY($1::text[]) AND type = ANY($2::text[])`,
        [names, types],
      );
  const existingSet = new Set(existing.map((r) => `${r.name}::${r.type}`));

  const toCreate: GoodImportRow[] = [];
  let toSkip = 0;
  for (const r of valid) {
    if (existingSet.has(`${r.name}::${r.type}`)) {
      toSkip++;
    } else {
      toCreate.push(r);
    }
  }

  await updateProgress(job.id, 50);

  const totalRows = rows.length;

  if (payload.dryRun) {
    const preview: ImportPreview = {
      toCreate: toCreate.length,
      toSkip,
      errors,
      totalRows,
    };
    const key = formatReportKey(job.id, true);
    await saveJson(key, preview);
    await updateProgress(job.id, 90);
    await complete(job.id, key);
    logger.info(
      { jobId: job.id, toCreate: toCreate.length, toSkip },
      'imports: goods dry-run complete',
    );
    return;
  }

  // Execute.
  let created = 0;
  let skipped = toSkip;
  const execErrors: ImportError[] = [...errors];

  // Lookup direction_id.
  const dirCache = new Map<number, string>();
  const dirNumbers = [...new Set(toCreate.map((r) => r.producer_direction_number))];
  if (dirNumbers.length > 0) {
    const dirs = await query<{ number: number; id: string }>(
      `SELECT number, id FROM directions WHERE number = ANY($1::int[])`,
      [dirNumbers],
    );
    for (const d of dirs) {dirCache.set(d.number, d.id);}
  }

  const totalToCreate = toCreate.length;
  let processed = 0;

  // Импорт `createGoodService` — dynamic, чтобы не тянуть в worker при
  // обработке других job-типов.
  const { createGoodService } = await import('../../core/goods/service.js');

  for (const r of toCreate) {
    processed++;
    const directionId = dirCache.get(r.producer_direction_number);
    if (!directionId) {
      execErrors.push({
        row: -1,
        field: 'producer_direction_number',
        message: `direction_number ${r.producer_direction_number} не существует`,
      });
      continue;
    }

    try {
      await createGoodService(
        {
          name: r.name,
          type: r.type,
          producerDirectionId: directionId,
          ...(r.description ? { description: r.description } : {}),
        },
        payload.requesterId,
      );
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      execErrors.push({
        row: -1,
        field: '',
        message: `INSERT failed: ${msg.slice(0, 200)}`,
      });
    }

    if (processed % 100 === 0) {
      await updateProgress(job.id, 50 + Math.round((processed / totalToCreate) * 40));
    }
  }

  const report: ImportReport = {
    created,
    skipped,
    errors: execErrors,
    totalRows,
  };
  const key = formatReportKey(job.id, false);
  await saveJson(key, report);
  await updateProgress(job.id, 90);
  await complete(job.id, key);
  logger.info(
    { jobId: job.id, created, skipped, errors: execErrors.length },
    'imports: goods execute complete',
  );
}

// ─── dictionary ─────────────────────────────────────────────────

const dictRowSchema = z.object({
  term: z.string().min(1).max(255),
  definition: z.string().min(1).max(10000),
});

interface DictImportRow {
  term: string;
  definition: string;
}

export async function handleImportDictionary(job: Job): Promise<void> {
  const payload = readPayload(job);
  const { rows } = await loadAndParse(job, payload);

  const errors: ImportError[] = [];
  const valid: DictImportRow[] = [];
  const seenTerms = new Set<string>();

  for (const [i, raw] of rows.entries()) {
    if (!raw) { continue; }
    const rowNum = i + 1;
    const parsed = dictRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNum,
          field: String(issue.path[0] ?? ''),
          message: issue.message,
        });
      }
      continue;
    }
    const r = parsed.data;
    if (seenTerms.has(r.term)) {
      errors.push({
        row: rowNum,
        field: 'term',
        message: 'дубликат внутри файла',
      });
      continue;
    }
    seenTerms.add(r.term);
    valid.push(r);
  }

  await updateProgress(job.id, 30);

  // Дедупликация по term.
  const terms = valid.map((r) => r.term);
  const existing = terms.length === 0
    ? []
    : await query<{ term: string }>(
        `SELECT term FROM dictionary_terms WHERE term = ANY($1::text[])`,
        [terms],
      );
  const existingSet = new Set(existing.map((r) => r.term));

  const toCreate: DictImportRow[] = [];
  let toSkip = 0;
  for (const r of valid) {
    if (existingSet.has(r.term)) {
      toSkip++;
    } else {
      toCreate.push(r);
    }
  }

  await updateProgress(job.id, 50);

  const totalRows = rows.length;

  if (payload.dryRun) {
    const preview: ImportPreview = {
      toCreate: toCreate.length,
      toSkip,
      errors,
      totalRows,
    };
    const key = formatReportKey(job.id, true);
    await saveJson(key, preview);
    await updateProgress(job.id, 90);
    await complete(job.id, key);
    logger.info(
      { jobId: job.id, toCreate: toCreate.length, toSkip },
      'imports: dictionary dry-run complete',
    );
    return;
  }

  let created = 0;
  let skipped = toSkip;
  const execErrors: ImportError[] = [...errors];

  const totalToCreate = toCreate.length;
  let processed = 0;

  const { createTermService } = await import('../../core/semantic/service.js');

  for (const r of toCreate) {
    processed++;
    try {
      await createTermService({
        term: r.term,
        definition: r.definition,
        by: payload.requesterId,
      });
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      execErrors.push({
        row: -1,
        field: '',
        message: `INSERT failed: ${msg.slice(0, 200)}`,
      });
    }

    if (processed % 100 === 0) {
      await updateProgress(job.id, 50 + Math.round((processed / totalToCreate) * 40));
    }
  }

  const report: ImportReport = {
    created,
    skipped,
    errors: execErrors,
    totalRows,
  };
  const key = formatReportKey(job.id, false);
  await saveJson(key, report);
  await updateProgress(job.id, 90);
  await complete(job.id, key);
  logger.info(
    { jobId: job.id, created, skipped, errors: execErrors.length },
    'imports: dictionary execute complete',
  );
}