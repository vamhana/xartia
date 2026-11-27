// Кандидат ID: C.1.16.01 (закрепить в реестре на этапе 8 плана фазы 1).
//
// Read-only доступ к импортированному каталогу XSK (миграция 075, этап 6a).
// Навыки XSK — не атомы CYB.ATOM и не уровни паспорта; здесь нет ни crosswalk
// (этап 6b), ни какого-либо влияния на Matching и допуски.

import { query, queryOne } from '../../lib/db.js';
import { NotFoundError } from '../errors.js';

export interface XskCatalogVersion {
  catalogVersion: string;
  sourceFile: string;
  sourceSha256: string;
  sourceBytes: number;
  domainsCount: number;
  subdomainsCount: number;
  skillsCount: number;
  importedAt: string;
}

export interface XskDomainRecord {
  catalogVersion: string;
  domainId: string;
  name: string;
  focus: string | null;
}

export interface XskSubdomainRecord {
  catalogVersion: string;
  subdomainId: string;
  domainId: string;
  name: string;
  scopeText: string | null;
  recordStatus: string | null;
}

export interface XskSkillRecord {
  catalogVersion: string;
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
  contentSha256: string;
}

interface VersionRow {
  catalog_version: string;
  source_file: string;
  source_sha256: string;
  source_bytes: number;
  domains_count: number;
  subdomains_count: number;
  skills_count: number;
  imported_at: Date;
}

interface SkillRow {
  catalog_version: string;
  skill_id: string;
  domain_id: string;
  subdomain_id: string;
  name: string;
  definition: string;
  observable_result: string | null;
  assessment_method: string | null;
  safety_boundaries: string | null;
  record_status: string;
  external_mapping: string | null;
  profile_id: string;
  classification_basis: string | null;
  content_sha256: string;
}

const SKILL_COLUMNS = `catalog_version, skill_id, domain_id, subdomain_id, name, definition,
  observable_result, assessment_method, safety_boundaries, record_status,
  external_mapping, profile_id, classification_basis, content_sha256`;

function toVersion(r: VersionRow): XskCatalogVersion {
  return {
    catalogVersion: r.catalog_version,
    sourceFile: r.source_file,
    sourceSha256: r.source_sha256.trim(),
    sourceBytes: r.source_bytes,
    domainsCount: r.domains_count,
    subdomainsCount: r.subdomains_count,
    skillsCount: r.skills_count,
    importedAt: r.imported_at.toISOString(),
  };
}

function toSkill(r: SkillRow): XskSkillRecord {
  return {
    catalogVersion: r.catalog_version,
    skillId: r.skill_id,
    domainId: r.domain_id,
    subdomainId: r.subdomain_id,
    name: r.name,
    definition: r.definition,
    observableResult: r.observable_result,
    assessmentMethod: r.assessment_method,
    safetyBoundaries: r.safety_boundaries,
    recordStatus: r.record_status,
    externalMapping: r.external_mapping,
    profileId: r.profile_id,
    classificationBasis: r.classification_basis,
    contentSha256: r.content_sha256.trim(),
  };
}

export async function listXskCatalogVersions(): Promise<XskCatalogVersion[]> {
  const rows = await query<VersionRow>(
    `SELECT catalog_version, source_file, source_sha256, source_bytes,
            domains_count, subdomains_count, skills_count, imported_at
       FROM xsk_catalog_versions ORDER BY imported_at, catalog_version`,
  );
  return rows.map(toVersion);
}

export async function getXskCatalogVersion(catalogVersion: string): Promise<XskCatalogVersion> {
  const r = await queryOne<VersionRow>(
    `SELECT catalog_version, source_file, source_sha256, source_bytes,
            domains_count, subdomains_count, skills_count, imported_at
       FROM xsk_catalog_versions WHERE catalog_version = $1`,
    [catalogVersion],
  );
  if (!r) {throw new NotFoundError('XSK catalog version', catalogVersion);}
  return toVersion(r);
}

export async function listXskDomains(catalogVersion: string): Promise<XskDomainRecord[]> {
  await getXskCatalogVersion(catalogVersion);
  const rows = await query<{ catalog_version: string; domain_id: string; name: string; focus: string | null }>(
    `SELECT catalog_version, domain_id, name, focus FROM xsk_domains
      WHERE catalog_version = $1 ORDER BY domain_id`,
    [catalogVersion],
  );
  return rows.map((r) => ({
    catalogVersion: r.catalog_version, domainId: r.domain_id, name: r.name, focus: r.focus,
  }));
}

export async function listXskSubdomains(
  catalogVersion: string,
  domainId?: string,
): Promise<XskSubdomainRecord[]> {
  await getXskCatalogVersion(catalogVersion);
  const rows = await query<{
    catalog_version: string; subdomain_id: string; domain_id: string; name: string;
    scope_text: string | null; record_status: string | null;
  }>(
    `SELECT catalog_version, subdomain_id, domain_id, name, scope_text, record_status
       FROM xsk_subdomains
      WHERE catalog_version = $1 AND ($2::text IS NULL OR domain_id = $2)
      ORDER BY subdomain_id`,
    [catalogVersion, domainId ?? null],
  );
  return rows.map((r) => ({
    catalogVersion: r.catalog_version, subdomainId: r.subdomain_id, domainId: r.domain_id,
    name: r.name, scopeText: r.scope_text, recordStatus: r.record_status,
  }));
}

export async function getXskSkill(catalogVersion: string, skillId: string): Promise<XskSkillRecord> {
  const r = await queryOne<SkillRow>(
    `SELECT ${SKILL_COLUMNS} FROM xsk_skills WHERE catalog_version = $1 AND skill_id = $2`,
    [catalogVersion, skillId],
  );
  if (!r) {throw new NotFoundError('XSK skill', skillId);}
  return toSkill(r);
}

export interface ListXskSkillsOptions {
  catalogVersion: string;
  domainId?: string;
  subdomainId?: string;
  profileId?: string;
  /** Подстрока в названии навыка (регистронезависимо). */
  nameContains?: string;
  limit?: number;
  offset?: number;
}

export async function listXskSkills(
  opts: ListXskSkillsOptions,
): Promise<{ items: XskSkillRecord[]; total: number }> {
  await getXskCatalogVersion(opts.catalogVersion);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = `catalog_version = $1
    AND ($2::text IS NULL OR domain_id = $2)
    AND ($3::text IS NULL OR subdomain_id = $3)
    AND ($4::text IS NULL OR profile_id = $4)
    AND ($5::text IS NULL OR strpos(lower(name), lower($5)) > 0)`;
  const params = [
    opts.catalogVersion, opts.domainId ?? null, opts.subdomainId ?? null,
    opts.profileId ?? null, opts.nameContains ?? null,
  ];
  const total = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM xsk_skills WHERE ${where}`, params,
  );
  const rows = await query<SkillRow>(
    `SELECT ${SKILL_COLUMNS} FROM xsk_skills WHERE ${where}
      ORDER BY skill_id LIMIT $6 OFFSET $7`,
    [...params, limit, offset],
  );
  return { items: rows.map(toSkill), total: total?.n ?? 0 };
}
