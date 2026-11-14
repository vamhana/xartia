-- ============================================================================
-- 067 — Пакеты работ, исполняемые задачи и зависимости.
--
-- Что делаем:
--   1. tasks.kind ('package' | 'deliverable'), expected_result,
--      planned_start_at, estimated_minutes.
--   2. Ослабляем chk_priority_deadline: приоритет и срок — независимы.
--   3. task_dependencies — отдельная таблица (иерархия ≠ зависимости).
--
-- Обратная совместимость:
--   - kind = 'deliverable' по умолчанию → все существующие задачи ведут себя
--     как раньше.
--   - expected_result = NULL у старых задач → не блокируем их.
--   - Обязательность expected_result для новых deliverable — на уровне
--     сервиса (C.0.07.02), а не в БД, чтобы не сломать старые данные.
-- ============================================================================

BEGIN;

-- ─── 1. tasks: kind, expected_result, planned_start_at, estimated_minutes ─

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'deliverable';

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_tasks_kind;

ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_kind
    CHECK (kind IN ('package', 'deliverable'));

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS expected_result TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS planned_start_at TIMESTAMPTZ;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_tasks_estimated_minutes;

ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_estimated_minutes
    CHECK (estimated_minutes IS NULL OR estimated_minutes > 0);

-- ─── 2. Ослабить chk_priority_deadline ─────────────────────────────────────
--
-- Было (003_tables.sql):
--   CHECK (priority <> 'critical' OR deadline IS NOT NULL)
-- То есть critical обязательно имел deadline. По ТЗ §4.5 приоритет и срок —
-- независимы: приоритет = срочность, deadline = согласованный срок.
-- Снимаем жёсткую связь. Целостность priority_enum обеспечивается типом.

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_priority_deadline;

-- ─── 3. task_dependencies ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_dependencies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type     TEXT NOT NULL DEFAULT 'blocks',
  created_by          UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_dep_self   CHECK (task_id <> depends_on_task_id),
  CONSTRAINT chk_dep_type   CHECK (dependency_type IN ('blocks')),
  CONSTRAINT uq_dep_pair    UNIQUE (task_id, depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_task
  ON task_dependencies(task_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
  ON task_dependencies(depends_on_task_id);

COMMIT;