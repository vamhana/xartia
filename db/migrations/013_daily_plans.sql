-- ============================================================================
-- 013_daily_plans.sql
-- 1. tasks.assigned_by — кто назначил задачу
-- 2. daily_plan_tasks — состав дневного плана
-- ============================================================================

BEGIN;

-- ─── 1. tasks.assigned_by ────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by
  ON tasks(assigned_by) WHERE assigned_by IS NOT NULL;

-- ─── 2. daily_plan_tasks ─────────────────────────────
CREATE TABLE IF NOT EXISTS daily_plan_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_plan_id   UUID NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_daily_plan_task UNIQUE (daily_plan_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_tasks_plan
  ON daily_plan_tasks(daily_plan_id, position);

CREATE INDEX IF NOT EXISTS idx_daily_plan_tasks_task
  ON daily_plan_tasks(task_id);

COMMIT;