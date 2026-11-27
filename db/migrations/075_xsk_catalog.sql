-- ============================================================================
-- 075 — Каталог XSK: read-only проекция версионированного снимка
--       (Фаза 1, этап 6a; §4.2 плана xartia-core-implementation).
--
-- Источник истины: файл XartIA_Skill_Catalog.xlsx, зафиксированный по SHA-256
-- (docs/XartIA_Skill_Catalog.xlsx). Эти таблицы — НЕИЗМЕНЯЕМАЯ производная
-- копия, а не конкурирующий источник: версия каталога входит в ключ каждой
-- записи, новая версия добавляет строки и ничего не перезаписывает.
--
-- Что хранится: области (24), подобласти (96) и навыки (322) версии 0.9.1 со
-- всеми полями записи навыка (нужны для просмотра исторического crosswalk).
-- Чего здесь НЕТ намеренно: критериев, HRisk, маршрутов и направлений (черновые
-- листы; направление из XSK не выводится), crosswalk (этап 6b).
--
-- Импорт не создаёт атомы, не меняет паспорта и не утверждает записи.
--
-- Неизменяемость: триггеры запрещают UPDATE, DELETE и TRUNCATE. Исправление
-- ошибочного импорта требует осознанного отключения триггера.
--
-- Транзакцию открывает раннер (scripts/migrate.ts). Идемпотентна.
-- ============================================================================

CREATE TABLE IF NOT EXISTS xsk_catalog_versions (
  catalog_version  VARCHAR(16)  PRIMARY KEY,
  source_file      TEXT         NOT NULL,
  source_sha256    CHAR(64)     NOT NULL UNIQUE,
  source_bytes     INTEGER      NOT NULL CHECK (source_bytes > 0),
  domains_count    INTEGER      NOT NULL CHECK (domains_count >= 0),
  subdomains_count INTEGER      NOT NULL CHECK (subdomains_count >= 0),
  skills_count     INTEGER      NOT NULL CHECK (skills_count >= 0),
  imported_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_xsk_version_sha CHECK (source_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS xsk_domains (
  catalog_version  VARCHAR(16) NOT NULL REFERENCES xsk_catalog_versions(catalog_version) ON DELETE RESTRICT,
  domain_id        VARCHAR(8)  NOT NULL,
  name             TEXT        NOT NULL,
  focus            TEXT,
  PRIMARY KEY (catalog_version, domain_id),
  CONSTRAINT chk_xsk_domain_id CHECK (domain_id ~ '^XD-[0-9]{2}$')
);

CREATE TABLE IF NOT EXISTS xsk_subdomains (
  catalog_version  VARCHAR(16) NOT NULL,
  subdomain_id     VARCHAR(16) NOT NULL,
  domain_id        VARCHAR(8)  NOT NULL,
  name             TEXT        NOT NULL,
  scope_text       TEXT,
  record_status    TEXT,
  PRIMARY KEY (catalog_version, subdomain_id),
  FOREIGN KEY (catalog_version, domain_id)
    REFERENCES xsk_domains(catalog_version, domain_id) ON DELETE RESTRICT,
  CONSTRAINT chk_xsk_subdomain_id CHECK (subdomain_id ~ '^XSD-[0-9]{2}\.[0-9]{2}$')
);

CREATE TABLE IF NOT EXISTS xsk_skills (
  catalog_version        VARCHAR(16) NOT NULL,
  skill_id               VARCHAR(16) NOT NULL,
  domain_id              VARCHAR(8)  NOT NULL,
  subdomain_id           VARCHAR(16) NOT NULL,
  name                   TEXT        NOT NULL,
  definition             TEXT        NOT NULL,
  observable_result      TEXT,
  assessment_method      TEXT,
  safety_boundaries      TEXT,
  record_status          TEXT        NOT NULL,
  external_mapping       TEXT,
  profile_id             VARCHAR(8)  NOT NULL,
  classification_basis   TEXT,
  content_sha256         CHAR(64)    NOT NULL,
  PRIMARY KEY (catalog_version, skill_id),
  FOREIGN KEY (catalog_version, domain_id)
    REFERENCES xsk_domains(catalog_version, domain_id) ON DELETE RESTRICT,
  FOREIGN KEY (catalog_version, subdomain_id)
    REFERENCES xsk_subdomains(catalog_version, subdomain_id) ON DELETE RESTRICT,
  CONSTRAINT chk_xsk_skill_id CHECK (skill_id ~ '^XSK-[0-9]{6}$'),
  CONSTRAINT chk_xsk_skill_profile CHECK (profile_id ~ '^[A-Z]{2,4}$'),
  CONSTRAINT chk_xsk_skill_hash CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_xsk_skills_domain
  ON xsk_skills (catalog_version, domain_id, subdomain_id);

COMMENT ON TABLE xsk_catalog_versions IS
  'Версии импортированного каталога XSK. Неизменяемо. Первоисточник — xlsx, зафиксированный по source_sha256.';
COMMENT ON COLUMN xsk_skills.content_sha256 IS
  'SHA-256 содержимого записи (см. computeSkillContentHash): отличает версии одного и того же Skill_ID.';
COMMENT ON TABLE xsk_skills IS
  'Навыки XSK конкретной версии каталога. Это НЕ атомы CYB.ATOM и не уровни паспорта.';

CREATE OR REPLACE FUNCTION xsk_catalog_read_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'xsk catalog snapshot is read-only (% on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS trg_xsk_catalog_versions_ro ON xsk_catalog_versions;
CREATE TRIGGER trg_xsk_catalog_versions_ro
  BEFORE UPDATE OR DELETE ON xsk_catalog_versions
  FOR EACH ROW EXECUTE FUNCTION xsk_catalog_read_only();
DROP TRIGGER IF EXISTS trg_xsk_catalog_versions_ro_trunc ON xsk_catalog_versions;
CREATE TRIGGER trg_xsk_catalog_versions_ro_trunc
  BEFORE TRUNCATE ON xsk_catalog_versions
  FOR EACH STATEMENT EXECUTE FUNCTION xsk_catalog_read_only();

DROP TRIGGER IF EXISTS trg_xsk_domains_ro ON xsk_domains;
CREATE TRIGGER trg_xsk_domains_ro
  BEFORE UPDATE OR DELETE ON xsk_domains
  FOR EACH ROW EXECUTE FUNCTION xsk_catalog_read_only();
DROP TRIGGER IF EXISTS trg_xsk_domains_ro_trunc ON xsk_domains;
CREATE TRIGGER trg_xsk_domains_ro_trunc
  BEFORE TRUNCATE ON xsk_domains
  FOR EACH STATEMENT EXECUTE FUNCTION xsk_catalog_read_only();

DROP TRIGGER IF EXISTS trg_xsk_subdomains_ro ON xsk_subdomains;
CREATE TRIGGER trg_xsk_subdomains_ro
  BEFORE UPDATE OR DELETE ON xsk_subdomains
  FOR EACH ROW EXECUTE FUNCTION xsk_catalog_read_only();
DROP TRIGGER IF EXISTS trg_xsk_subdomains_ro_trunc ON xsk_subdomains;
CREATE TRIGGER trg_xsk_subdomains_ro_trunc
  BEFORE TRUNCATE ON xsk_subdomains
  FOR EACH STATEMENT EXECUTE FUNCTION xsk_catalog_read_only();

DROP TRIGGER IF EXISTS trg_xsk_skills_ro ON xsk_skills;
CREATE TRIGGER trg_xsk_skills_ro
  BEFORE UPDATE OR DELETE ON xsk_skills
  FOR EACH ROW EXECUTE FUNCTION xsk_catalog_read_only();
DROP TRIGGER IF EXISTS trg_xsk_skills_ro_trunc ON xsk_skills;
CREATE TRIGGER trg_xsk_skills_ro_trunc
  BEFORE TRUNCATE ON xsk_skills
  FOR EACH STATEMENT EXECUTE FUNCTION xsk_catalog_read_only();
