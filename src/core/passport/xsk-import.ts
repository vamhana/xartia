// Кандидат ID: C.1.16.03 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Импорт закреплённого снимка каталога XSK в read-only таблицы (миграция 075).
// Фаза 1, этап 6a.
//
//   * Пишет ТОЛЬКО в xsk_* (версия, области, подобласти, навыки). Не создаёт
//     атомы, не меняет паспорта, оценки, направления и статусы.
//   * Идемпотентен: повторный импорт того же снимка ничего не меняет и
//     возвращает already_imported, предварительно сверив сохранённое с файлом
//     (набор Skill_ID + хэш содержимого каждой записи).
//   * Конкурентные импорты сериализуются advisory-lock.
//   * Любое расхождение (та же версия с другим SHA, тот же SHA под другой
//     версией, сохранённое не совпадает с файлом) — ConflictError, без правок.

import { transaction } from '../../lib/db.js';
import { ConflictError } from '../errors.js';

import {
  assertCatalogMatchesSpec,
  type XskCatalog,
  type XskSourceSpec,
} from './xsk-catalog-parse.js';

export interface XskImportInput {
  catalog: XskCatalog;
  spec: XskSourceSpec;
  /** Путь файла как он будет показан в xsk_catalog_versions.source_file. */
  sourceFile: string;
  sourceBytes: number;
}

export interface XskImportResult {
  status: 'imported' | 'already_imported';
  catalogVersion: string;
  sourceSha256: string;
  domains: number;
  subdomains: number;
  skills: number;
}

interface VersionRow {
  catalog_version: string;
  source_sha256: string;
  domains_count: number;
  subdomains_count: number;
  skills_count: number;
}

export async function importXskCatalog(input: XskImportInput): Promise<XskImportResult> {
  const { catalog, spec } = input;
  // Падаем до обращения к БД, если разобранное не соответствует закреплённому снимку.
  assertCatalogMatchesSpec(catalog, spec);

  const counts = {
    domains: catalog.domains.length,
    subdomains: catalog.subdomains.length,
    skills: catalog.skills.length,
  };
  const result = (status: XskImportResult['status']): XskImportResult => ({
    status,
    catalogVersion: spec.catalogVersion,
    sourceSha256: spec.sha256,
    ...counts,
  });

  return transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('xsk_catalog_import'))`);

    const existing = await client.query<VersionRow>(
      `SELECT catalog_version, source_sha256, domains_count, subdomains_count, skills_count
         FROM xsk_catalog_versions
        WHERE catalog_version = $1 OR source_sha256 = $2`,
      [spec.catalogVersion, spec.sha256],
    );

    if (existing.rows.length > 1) {
      throw new ConflictError('XSK catalog: version and checksum belong to different imports', {
        reason: 'xsk_import_conflict',
        catalog_version: spec.catalogVersion,
      });
    }

    const row = existing.rows[0];
    if (row) {
      if (row.catalog_version !== spec.catalogVersion || row.source_sha256 !== spec.sha256) {
        throw new ConflictError(
          `XSK catalog: version ${row.catalog_version} is already imported from a different file`,
          { reason: 'xsk_version_sha_mismatch', stored_version: row.catalog_version },
        );
      }
      // Сверяем сохранённое с файлом, а не верим записи о версии на слово.
      const stored = await client.query<{ skill_id: string; content_sha256: string }>(
        `SELECT skill_id, content_sha256 FROM xsk_skills
          WHERE catalog_version = $1 ORDER BY skill_id`,
        [spec.catalogVersion],
      );
      const fromFile = catalog.skills.map((s) => `${s.skillId}:${s.contentSha256}`);
      const fromDb = stored.rows.map((s) => `${s.skill_id}:${s.content_sha256.trim()}`);
      if (JSON.stringify(fromFile) !== JSON.stringify(fromDb)
          || row.domains_count !== counts.domains
          || row.subdomains_count !== counts.subdomains
          || row.skills_count !== counts.skills) {
        throw new ConflictError(
          `XSK catalog ${spec.catalogVersion}: stored data differs from the pinned file`,
          { reason: 'xsk_stored_differs', catalog_version: spec.catalogVersion },
        );
      }
      return result('already_imported');
    }

    await client.query(
      `INSERT INTO xsk_catalog_versions
         (catalog_version, source_file, source_sha256, source_bytes,
          domains_count, subdomains_count, skills_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [spec.catalogVersion, input.sourceFile, spec.sha256, input.sourceBytes,
        counts.domains, counts.subdomains, counts.skills],
    );

    await client.query(
      `INSERT INTO xsk_domains (catalog_version, domain_id, name, focus)
       SELECT $1::text, d.domain_id, d.name, d.focus
         FROM unnest($2::text[], $3::text[], $4::text[]) AS d(domain_id, name, focus)`,
      [spec.catalogVersion,
        catalog.domains.map((d) => d.domainId),
        catalog.domains.map((d) => d.name),
        catalog.domains.map((d) => d.focus)],
    );

    await client.query(
      `INSERT INTO xsk_subdomains
         (catalog_version, subdomain_id, domain_id, name, scope_text, record_status)
       SELECT $1::text, s.subdomain_id, s.domain_id, s.name, s.scope_text, s.record_status
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
              AS s(subdomain_id, domain_id, name, scope_text, record_status)`,
      [spec.catalogVersion,
        catalog.subdomains.map((s) => s.subdomainId),
        catalog.subdomains.map((s) => s.domainId),
        catalog.subdomains.map((s) => s.name),
        catalog.subdomains.map((s) => s.scopeText),
        catalog.subdomains.map((s) => s.recordStatus)],
    );

    const k = catalog.skills;
    await client.query(
      `INSERT INTO xsk_skills
         (catalog_version, skill_id, domain_id, subdomain_id, name, definition,
          observable_result, assessment_method, safety_boundaries, record_status,
          external_mapping, profile_id, classification_basis, content_sha256)
       SELECT $1::text, s.skill_id, s.domain_id, s.subdomain_id, s.name, s.definition,
              s.observable_result, s.assessment_method, s.safety_boundaries, s.record_status,
              s.external_mapping, s.profile_id, s.classification_basis, s.content_sha256
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                     $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
                     $12::text[], $13::text[], $14::text[])
              AS s(skill_id, domain_id, subdomain_id, name, definition,
                   observable_result, assessment_method, safety_boundaries, record_status,
                   external_mapping, profile_id, classification_basis, content_sha256)`,
      [spec.catalogVersion,
        k.map((s) => s.skillId), k.map((s) => s.domainId), k.map((s) => s.subdomainId),
        k.map((s) => s.name), k.map((s) => s.definition),
        k.map((s) => s.observableResult), k.map((s) => s.assessmentMethod),
        k.map((s) => s.safetyBoundaries), k.map((s) => s.recordStatus),
        k.map((s) => s.externalMapping), k.map((s) => s.profileId),
        k.map((s) => s.classificationBasis), k.map((s) => s.contentSha256)],
    );

    return result('imported');
  });
}
