-- ============================================================================
-- 068 — История версий наряда ячейки.
--
-- Append-only снимки состава наряда. Версии не перезаписываются и не
-- удаляются. Каждое изменение наряда (upsert / assign / distribute)
-- фиксирует новую версию.
--
-- Снимок (JSONB):
--   { tasks: [{taskId, position, assignedTo, delegatedToCellId}],
--     status, approvedBy }
--
-- Соглашение о версиях:
--   v1 — исходное состояние (пустой наряд при создании ИЛИ фактическое
--        состояние существующего наряда перед первым изменением после
--        установки миграции);
--   v2+ — состояние после каждого последующего изменения.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cell_daily_plan_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES cell_daily_plans(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot      JSONB NOT NULL,
  reason        TEXT,
  created_by    UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_cell_daily_plan_version_positive CHECK (version > 0),
  CONSTRAINT uq_cell_daily_plan_version UNIQUE (plan_id, version),
  CONSTRAINT chk_cell_daily_plan_snapshot_shape CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot ? 'tasks'
    AND snapshot ? 'status'
    AND snapshot ? 'approvedBy'
    AND jsonb_typeof(snapshot->'tasks') = 'array'
  )
);

CREATE INDEX IF NOT EXISTS idx_cell_daily_plan_versions_plan
  ON cell_daily_plan_versions(plan_id, version DESC);

COMMIT;