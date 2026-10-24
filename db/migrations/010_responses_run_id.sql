-- ─────────────────────────────────────────────
-- 010_responses_run_id.sql
-- Добавляет responses.run_id — привязка ответа к конкретному прогону.
--
-- Семантика:
--   run_id IS NULL     → ответ направления на сигнал (signals.service.respondService)
--   run_id IS NOT NULL → ответ направления в рамках всеобщего прогона (universal-runs.service.submitRunResponse)
--
-- Частичный UNIQUE (run_id, direction_id) WHERE run_id IS NOT NULL
-- гарантирует: одно направление даёт не более одного ответа на прогон.
-- Ответы на сигналы (run_id IS NULL) остаются без constraint — как было.
-- ─────────────────────────────────────────────

BEGIN;

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS run_id UUID NULL
  REFERENCES universal_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_responses_run
  ON responses(run_id)
  WHERE run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_responses_run_direction
  ON responses(run_id, direction_id)
  WHERE run_id IS NOT NULL;

COMMIT;

-- ─────────────────────────────────────────────
-- ВНИМАНИЕ при первом применении на dev:
-- если в responses уже есть ответы прогонов (созданные до этой миграции),
-- их run_id останется NULL — они «переедут» в категорию сигнальных.
-- Для чистой семантики на dev: DELETE FROM responses; перед миграцией.
-- В prod миграция безопасна: run_id = NULL для старых записей, колонка nullable.
-- ─────────────────────────────────────────────