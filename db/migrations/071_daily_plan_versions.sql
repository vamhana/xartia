-- ============================================================================
-- 071 — История версий дневного плана направления.
--
-- Проблема: upsertDailyPlan делал DELETE + INSERT в daily_plan_tasks без
-- истории. Аналогично cell_daily_plan_versions (D.2.01.68), но для
-- daily_plans направления (а не для наряда ячейки).
--
-- Соглашение о версиях:
--   v1 — исходное состояние (пустой план при создании ИЛИ фактическое
--        состояние существующего плана перед первым изменением после
--        установки миграции);
--   v2+ — состояние после каждого изменения.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS daily_plan_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id UUID NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,
  reason        TEXT,
  created_by    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_daily_plan_version_positive CHECK (version > 0),
  CONSTRAINT uq_daily_plan_version UNIQUE (daily_plan_id, version),
  CONSTRAINT chk_daily_plan_snapshot_shape CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot ? 'tasks'
    AND snapshot ? 'status'
    AND snapshot ? 'approvedBy'
    AND jsonb_typeof(snapshot->'tasks') = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_versions_plan
  ON daily_plan_versions(daily_plan_id, version DESC);

COMMIT;