-- 053 — Ёмкость и готовность ячеек (инкремент «муравейник»).
--
-- 1. Компетенции участника: без них нельзя посчитать дефицит людей.
-- 2. Привязка плана к ячейке: ячейка без общего плана не готова.
-- 3. Статус ячейки: forming → ready → frozen.

CREATE TABLE IF NOT EXISTS participant_competencies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  competency     VARCHAR(64) NOT NULL,
  level          SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  verified       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, competency)
);

CREATE INDEX IF NOT EXISTS idx_participant_competencies_competency
  ON participant_competencies(competency);

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS cell_id UUID REFERENCES cells(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plans_cell ON plans(cell_id) WHERE cell_id IS NOT NULL;

ALTER TABLE cells
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'forming'
    CHECK (status IN ('forming', 'ready', 'frozen'));
