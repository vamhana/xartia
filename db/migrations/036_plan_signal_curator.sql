-- 036 — Связь «сигнал → план» и куратор плана.
--
-- Зачем: путь сигнала рвался на шаге «решение»: план жил отдельно от сигнала,
-- нельзя было открыть сигнал и увидеть «вот план, вот задачи, вот прогресс».
-- Плюс куратором считалось направление (lead_direction_id) — безличная
-- сущность, с которой нельзя поговорить и на которую нельзя нажать.
--
-- Что делает:
--   1. plans.signal_id — сигнал, из которого вырос план (nullable: планы
--      бывают и без сигнала — плановые работы направления);
--   2. plans.curator_id — конкретный человек-куратор (мандат, не должность);
--   3. индексы для обратного поиска «план по сигналу» и «планы куратора».
--
-- Не UNIQUE на signal_id: у одного сигнала может быть несколько планов
-- (этапы: пилот → раскатка), но каждый план принадлежит одному сигналу.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS curator_id UUID REFERENCES participants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plans_signal_id ON plans(signal_id);
CREATE INDEX IF NOT EXISTS idx_plans_curator_id ON plans(curator_id);
