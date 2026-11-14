-- ============================================================================
-- 069 — Персональный план дня.
--
-- ТЗ §9: план на локальную дату, учёт часового пояса, доступное время,
-- блоки разных типов (production/learning/teaching/other), плановое и
-- фактическое время раздельно.
--
-- Соглашение о версиях (по аналогии с cell_daily_plan_versions, D.2.01.68):
--   v1 — исходное состояние (пустой план, blocks: []);
--   v2 — после первого PUT с блоками;
--   v3+ — при каждом последующем изменении.
--
-- Фактические минуты заполняются только через POST .../close
-- (подтверждённое событие). ТЗ §9.4.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS participant_day_plans (
  id                 UUID PRIMARY KEY,
  participant_id     UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  date               DATE NOT NULL,
  timezone           VARCHAR(64) NOT NULL,
  available_minutes  INTEGER NOT NULL
    CHECK (available_minutes > 0 AND available_minutes <= 1440),
  status             TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'closed')),
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_participant_day_plan UNIQUE (participant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_pdp_participant_date
  ON participant_day_plans(participant_id, date DESC);

CREATE TABLE IF NOT EXISTS participant_day_blocks (
  id                     UUID PRIMARY KEY,
  day_plan_id            UUID NOT NULL REFERENCES participant_day_plans(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL
    CHECK (kind IN ('production', 'learning', 'teaching', 'other')),
  task_id                UUID REFERENCES tasks(id) ON DELETE SET NULL,
  task_practice_id       UUID,   -- TeachingPracticeLink (Этап 4)
  learning_goal_id       UUID,   -- Цель обучения (Этап 4)
  teaching_assignment_id UUID,   -- Преподавательское назначение (Этап 4)
  planned_minutes        INTEGER NOT NULL CHECK (planned_minutes > 0),
  actual_minutes         INTEGER CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  position               INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'done', 'skipped')),
  comment                TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pdb_production_task
    CHECK (kind <> 'production' OR task_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pdb_plan
  ON participant_day_blocks(day_plan_id, position);

CREATE INDEX IF NOT EXISTS idx_pdb_task
  ON participant_day_blocks(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS participant_day_plan_versions (
  id           UUID PRIMARY KEY,
  day_plan_id  UUID NOT NULL REFERENCES participant_day_plans(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL CHECK (version > 0),
  snapshot     JSONB NOT NULL,
  reason       TEXT,
  created_by   UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pdpv UNIQUE (day_plan_id, version),
  CONSTRAINT chk_pdpv_snapshot_shape CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot ? 'availableMinutes'
    AND snapshot ? 'blocks'
    AND jsonb_typeof(snapshot->'blocks') = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_pdpv_plan
  ON participant_day_plan_versions(day_plan_id, version DESC);

COMMIT;