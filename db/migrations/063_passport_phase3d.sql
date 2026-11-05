-- 063 — Фаза 3d: калибровка 0–9 (инфраструктура) + техдолг 3c.
-- См. docs/passport-phase3d.md.
--
-- 1. anchor_examples         — эталонные работы (контент заполняют специалисты).
-- 2. calibration_sessions    — сессии калибровки.
-- 3. calibration_assignments — оценки anchor'ов участниками (append-only по духу).
-- 4. passport_assessments    += criteria_version, anchor_example_id.
-- 5. Индекс team_capabilities.created_by (техдолг 3c).
--
-- Калибровка НЕ пишет в passport_history_events — это методологическая
-- активность, а не персональная оценка. Аудит — через audit_log.

-- ─────────────────────────────────────────────────────────────────────
-- 1. anchor_examples
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS anchor_examples (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id      TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  dimension    CHAR(1) NOT NULL CHECK (dimension IN ('U','X','D','P','E')),
  level        SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 9),
  title        TEXT NOT NULL,
  description  TEXT,
  content      JSONB NOT NULL DEFAULT '{}'::jsonb,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_anchor_examples_content_object
    CHECK (jsonb_typeof(content) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_anchor_examples_atom_dim_level
  ON anchor_examples(atom_id, dimension, level);

CREATE INDEX IF NOT EXISTS idx_anchor_examples_created_by
  ON anchor_examples(created_by);

-- ─────────────────────────────────────────────────────────────────────
-- 2. calibration_sessions
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_id      TEXT NOT NULL REFERENCES competency_atoms(atom_id) ON DELETE CASCADE,
  dimension    CHAR(1) NOT NULL CHECK (dimension IN ('U','X','D','P','E')),
  status       VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','closed')),
  created_by   UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  deadline     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calibration_sessions_atom_dim
  ON calibration_sessions(atom_id, dimension, status);

-- ─────────────────────────────────────────────────────────────────────
-- 3. calibration_assignments
-- ─────────────────────────────────────────────────────────────────────
-- assign:  INSERT, level=NULL
-- score:   UPDATE ... SET level=..., note=... WHERE level IS NULL
-- повтор:  UPDATE не находит строку → 409
-- Пересмотр — новый assignment (A67).

CREATE TABLE IF NOT EXISTS calibration_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES calibration_sessions(id) ON DELETE CASCADE,
  anchor_example_id UUID NOT NULL REFERENCES anchor_examples(id) ON DELETE CASCADE,
  assessor_id       UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  level             SMALLINT,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  scored_at         TIMESTAMPTZ,
  CONSTRAINT chk_calibration_assignments_level
    CHECK (level IS NULL OR (level BETWEEN 0 AND 9))
);

-- Один и тот же assessor не может дважды оценивать один anchor в сессии.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_calibration_assignments_session_work_assessor
  ON calibration_assignments(session_id, anchor_example_id, assessor_id);

CREATE INDEX IF NOT EXISTS idx_calibration_assignments_session
  ON calibration_assignments(session_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. passport_assessments: criteria_version, anchor_example_id
-- ─────────────────────────────────────────────────────────────────────
-- criteria_version — снимок competency_atoms.version на момент оценки (A70).
-- anchor_example_id — опциональная привязка (A60, если оценка «по эталону»).

ALTER TABLE passport_assessments
  ADD COLUMN IF NOT EXISTS criteria_version INTEGER;

ALTER TABLE passport_assessments
  ADD COLUMN IF NOT EXISTS anchor_example_id UUID
    REFERENCES anchor_examples(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_passport_assessments_anchor
  ON passport_assessments(anchor_example_id)
  WHERE anchor_example_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Техдолг 3c: индекс на team_capabilities.created_by
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_team_capabilities_created_by
  ON team_capabilities(created_by);