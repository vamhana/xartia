-- 038 — Привязка сигнала к объекту надзора.
--
-- Балансировка видит дерево: микрорайон → дом → ячейка → человек. Сигнал
-- должен цепляться к конкретному уровню, иначе «напротив дома сигнал» не
-- нарисовать: все сигналы висят на направлении.
--
-- Три необязательных измерения:
--   subject_plan_id — сигнал о плане (микрорайон);
--   subject_task_id — сигнал о ветке/работе (дом, конкретная задача);
--   subject_cell_id — сигнал о ячейке (кто именно провалил участок).

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS subject_plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS subject_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS subject_cell_id UUID REFERENCES cells(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_signals_subject_plan ON signals(subject_plan_id);
CREATE INDEX IF NOT EXISTS idx_signals_subject_task ON signals(subject_task_id);
CREATE INDEX IF NOT EXISTS idx_signals_subject_cell ON signals(subject_cell_id);
