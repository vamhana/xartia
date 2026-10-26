-- 051 — Формальные критерии ОТК и SLA проверки.
--
-- Критерии: версионируемый набор проверок (по направлению или глобальный).
-- Решение ОТК сохраняет снимок критериев — по нему можно восстановить,
-- на каком основании вынесен вердикт.
-- SLA: фиксируем время сдачи, чтобы считать просрочку проверки.

CREATE TABLE IF NOT EXISTS otc_criteria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_id UUID REFERENCES directions(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один активный набор на направление (и один глобальный при direction_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_otc_criteria_active_direction
  ON otc_criteria (direction_id)
  WHERE active AND direction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_otc_criteria_active_global
  ON otc_criteria ((1))
  WHERE active AND direction_id IS NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE otc_decisions
  ADD COLUMN IF NOT EXISTS criteria_snapshot JSONB;

-- Глобальный набор по умолчанию: минимальные требования Хартии к результату.
INSERT INTO otc_criteria (direction_id, version, title, items, active)
SELECT NULL, 1, 'Базовые критерии ОТК',
       '[
         {"id":"artifact","title":"Артефакт доступен и соответствует задаче","required":true},
         {"id":"functionality","title":"Результат работает / воспроизводим","required":true},
         {"id":"safety","title":"Нет нарушений безопасности и прав","required":true},
         {"id":"docs","title":"Есть описание, как проверить","required":false}
       ]'::jsonb,
       true
WHERE NOT EXISTS (
  SELECT 1 FROM otc_criteria WHERE active AND direction_id IS NULL
);

UPDATE tasks SET submitted_at = updated_at WHERE status = 'submitted' AND submitted_at IS NULL;
