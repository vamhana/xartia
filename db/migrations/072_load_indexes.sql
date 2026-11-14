-- ============================================================================
-- 072 — Индексы для нагрузки (ТЗ §21).
--
-- После Этапов 1–5 агрегаты и списки фильтруют по kind='deliverable'.
-- Без композитных индексов это Seq Scan при росте задач.
--
-- Добавляем:
--   * tasks (direction_id, kind, status) — listTasks с фильтром kind;
--   * tasks (plan_id, kind, status)      — getPlanProgress / getPlanTree;
--   * tasks (kind, status)               — глобальные агрегаты;
--   * tasks (assigned_to, kind, status)  — listMyTasks с фильтром kind;
--   * task_practices (teacher_id, learner_task_id, status)
--                                        — isTeacherOfLearnerTask (§7.5).
--
-- Не создаём дубли: если индекс с таким именем уже есть — no-op.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_tasks_direction_kind_status
  ON tasks (direction_id, kind, status);

CREATE INDEX IF NOT EXISTS idx_tasks_plan_kind_status
  ON tasks (plan_id, kind, status) WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_kind_status
  ON tasks (kind, status);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_kind_status
  ON tasks (assigned_to, kind, status)
  WHERE assigned_to IS NOT NULL AND status <> 'accepted';

CREATE INDEX IF NOT EXISTS idx_task_practices_teacher_learner_task
  ON task_practices (teacher_id, learner_task_id, status);

COMMIT;