-- 040 — Передача наряда в дочерние ячейки.
--
-- Координатор верхнего уровня получает наряд на свою ячейку и передаёт части
-- вниз: 5 ячеек, у каждой свой наряд, дальше координатор ячейки раздаёт людям.
--
-- Задача остаётся видимой на верхнем уровне (иначе теряется общая картина),
-- но помечается, в какую дочернюю ячейку передана. В дочерней ячейке
-- создаётся (или дополняется) свой наряд на ту же дату.

ALTER TABLE cell_daily_plan_tasks
  ADD COLUMN IF NOT EXISTS delegated_to_cell_id UUID REFERENCES cells(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cell_daily_plan_tasks_delegated
  ON cell_daily_plan_tasks(delegated_to_cell_id);
