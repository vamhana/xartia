-- 058 — Профессиональный паспорт (Фаза 1).
-- См. docs/паспорт.md v0.3.4 и docs/passport-implementation.md.
--
-- Принципы:
--   * Шкала 0..9. NULL ≠ 0 (NULL = нет оценки).
--   * Пять измерений (U/X/D/P/E) независимы. Среднее запрещено на уровне кода.
--   * Ширина/глубина — не материализуются, считаются в projection.ts.
--   * История паспорта append-only: UPDATE/DELETE запрещены триггером.
--   * Приватность по умолчанию: private. Публичный профиль — только по consent.
--   * Не пересекается с participant_competencies (053): там ёмкость, тут паспорт.
--   * Существующие миграции (053 и раньше) не меняются.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Каталог атомов компетенций
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS competency_atoms (
  atom_id                  TEXT PRIMARY KEY
    CHECK (atom_id ~ '^CYB\.ATOM\.[0-9]{4}$'),
  cluster                  VARCHAR(64) NOT NULL
    CHECK (cluster IN (
      'requirements_and_computational_thinking',
      'software_development',
      'data_and_databases',
      'server_interfaces_and_api',
      'testing_and_quality',
      'software_security',
      'infrastructure_and_operations'
    )),
  name                     TEXT NOT NULL,
  definition               TEXT NOT NULL,
  boundary_includes        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  boundary_excludes        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  context                  TEXT,
  input                    TEXT,
  outcome                  TEXT,
  assessment_criteria      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {status, U?, X?, D?, P?, E?}
  assessment_methods       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  dimension_applicability  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {U:{applicable}, ..., E:{applicable}}
  freshness_policy         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {content_change_rate, practice_review_policy}
  translations             JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {lang: {name, definition, ...}}
  status                   VARCHAR(16) NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','draft','in_review','approved','deprecated')),
  version                  VARCHAR(16) NOT NULL DEFAULT '0.1.0',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competency_atoms_cluster ON competency_atoms(cluster);
CREATE INDEX IF NOT EXISTS idx_competency_atoms_status  ON competency_atoms(status);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Связи между атомами
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS competency_relations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_atom_id   TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  to_atom_id     TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  relation_type  VARCHAR(32) NOT NULL
    CHECK (relation_type IN (
      'part_of','requires','prerequisite_for','alternative_to',
      'shared_foundation','applied_in','related_to'
    )),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_atom_id, to_atom_id, relation_type),
  CHECK (from_atom_id <> to_atom_id)
);

CREATE INDEX IF NOT EXISTS idx_competency_relations_from ON competency_relations(from_atom_id);
CREATE INDEX IF NOT EXISTS idx_competency_relations_to   ON competency_relations(to_atom_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Профессиональные профили (версионируемые)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profession_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(64) UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  version       VARCHAR(16) NOT NULL DEFAULT '0.1.0',
  requirements  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- shape: { atoms: [{atom_id, min:{U,X,D,P,E}}], aggregates:{width_min?, depth_min?},
  --          alternatives: [], context: {...}, calibration: 'pending'|'done' }
  status        VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('candidate','draft','in_review','approved','deprecated')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Личная проекция: состояние человека по атому × измерению
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS person_atom_states (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  atom_id        TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE RESTRICT,
  dimension      CHAR(1) NOT NULL CHECK (dimension IN ('U','X','D','P','E')),
  level          SMALLINT NULL
    CHECK (level IS NULL OR (level BETWEEN 0 AND 9)),
  status         VARCHAR(24) NOT NULL DEFAULT 'not_assessed'
    CHECK (status IN (
      'not_assessed','declared','confirmed','disputed',
      'under_review','not_applicable','calibration_pending'
    )),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, atom_id, dimension),
  -- not_assessed и not_applicable не имеют числового уровня
  CHECK (
    (status IN ('not_assessed','not_applicable') AND level IS NULL)
    OR (status NOT IN ('not_assessed','not_applicable'))
  )
);

CREATE INDEX IF NOT EXISTS idx_person_atom_states_participant ON person_atom_states(participant_id);
CREATE INDEX IF NOT EXISTS idx_person_atom_states_atom        ON person_atom_states(atom_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Доказательства
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_evidence (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  atom_id        TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE RESTRICT,
  dimension      CHAR(1) NOT NULL CHECK (dimension IN ('U','X','D','P','E')),
  evidence_type  VARCHAR(32) NOT NULL
    CHECK (evidence_type IN (
      'declaration','training','portfolio','practical_task','exam',
      'specialist_conclusion','independent_review','real_activity','regular_practice'
    )),
  description    TEXT NOT NULL,
  artifact_url   TEXT,
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {domain, scale, autonomy, constraints:[...]}
  status         VARCHAR(16) NOT NULL DEFAULT 'submitted'
    CHECK (status IN (
      'submitted','accepted','disputed','rejected',
      'invalidated','withdrawn','superseded'
    )),
  created_by     UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_evidence_participant
  ON passport_evidence(participant_id, atom_id, dimension, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_passport_evidence_status
  ON passport_evidence(status);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Оценки (assessment). Отдельно от заявлений/доказательств.
-- ─────────────────────────────────────────────────────────────────────
-- NB: значение 'not_assessed' намеренно НЕ входит в CHECK — его место
--     в person_atom_states (отсутствие оценки). В passport_assessments
--     строка создаётся только когда кто-то действительно поставил оценку.

CREATE TABLE IF NOT EXISTS passport_assessments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  atom_id        TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE RESTRICT,
  dimension      CHAR(1) NOT NULL CHECK (dimension IN ('U','X','D','P','E')),
  level          SMALLINT NULL
    CHECK (level IS NULL OR (level BETWEEN 0 AND 9)),
  method         VARCHAR(64) NOT NULL,
  assessor_id    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         VARCHAR(24) NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'provisional','calibration_pending','active','under_review',
      'rejected','superseded','invalidated'
    )),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Независимость: проверяющий не может оценивать свою работу
  CHECK (assessor_id <> participant_id)
);

CREATE INDEX IF NOT EXISTS idx_passport_assessments_participant
  ON passport_assessments(participant_id, atom_id, dimension, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_passport_assessments_status
  ON passport_assessments(status);
CREATE INDEX IF NOT EXISTS idx_passport_assessments_assessor
  ON passport_assessments(assessor_id);

-- ─────────────────────────────────────────────────────────────────────
-- 7. История паспорта — append-only
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_history_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  atom_id        TEXT REFERENCES competency_atoms(atom_id) ON DELETE RESTRICT,
  event_type     VARCHAR(48) NOT NULL
    CHECK (event_type IN (
      'claim_declared',
      'evidence_submitted','evidence_accepted','evidence_rejected',
      'assessment_created','assessment_activated','assessment_under_review',
      'appeal_filed','appeal_resolved',
      'visibility_changed',
      'path_created','path_completed','path_abandoned'
    )),
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id       UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_history_participant
  ON passport_history_events(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_passport_history_atom
  ON passport_history_events(atom_id, created_at DESC);

CREATE OR REPLACE FUNCTION passport_history_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'passport_history_events is append-only: % not allowed (id=%)',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_passport_history_events_immutable ON passport_history_events;
CREATE TRIGGER trg_passport_history_events_immutable
  BEFORE UPDATE OR DELETE ON passport_history_events
  FOR EACH ROW EXECUTE FUNCTION passport_history_events_immutable();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Приватность: согласия по scope
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_visibility (
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  scope          VARCHAR(24) NOT NULL
    CHECK (scope IN ('public','mentor','assessor','task')),
  visibility     VARCHAR(16) NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','summary','levels','full')),
  consent        BOOLEAN NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, scope)
);

-- ─────────────────────────────────────────────────────────────────────
-- 9. Журнал доступа к чужому паспорту
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passport_access_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  viewer_id      UUID REFERENCES participants(id) ON DELETE SET NULL,
  scope          VARCHAR(24) NOT NULL,
  reason         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passport_access_log_participant
  ON passport_access_log(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_passport_access_log_viewer
  ON passport_access_log(viewer_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 10. Фантомные маршруты (development paths)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS development_paths (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  goal              TEXT NOT NULL,
  target_profile_id UUID REFERENCES profession_profiles(id) ON DELETE SET NULL,
  missing_atoms     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{atom_id, missing_dimensions:[...]}]
  status            VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','abandoned')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_development_paths_participant
  ON development_paths(participant_id, status);