-- 037 — Наряд ячейки (cell daily plan).
--
-- Модель: наряд приходит на ячейку (5 человек), координатор ячейки
-- распределяет задачи по людям. Координатор над 5 ячейками распределяет по
-- ячейкам, и так по нарастающей — но каждая ячейка ведёт свой наряд сама.
--
-- Почему отдельные таблицы, а не daily_plans.cell_id: у daily_plans есть
-- UNIQUE (direction_id, date) — наряд направления один на день. Нарядов
-- ячеек в одном направлении может быть много (по одному на ячейку).

CREATE TABLE IF NOT EXISTS cell_daily_plans (
  id          UUID PRIMARY KEY,
  cell_id     UUID NOT NULL REFERENCES cells(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  approved_by UUID NOT NULL REFERENCES participants(id),
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cell_id, date)
);

CREATE TABLE IF NOT EXISTS cell_daily_plan_tasks (
  id          UUID PRIMARY KEY,
  plan_id     UUID NOT NULL REFERENCES cell_daily_plans(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES participants(id),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_cell_daily_plans_cell_date
  ON cell_daily_plans(cell_id, date);

CREATE INDEX IF NOT EXISTS idx_cell_daily_plan_tasks_assignee
  ON cell_daily_plan_tasks(assigned_to);
