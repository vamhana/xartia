-- 033 — артефакт работы в отчёте.
--
-- Зачем: для программиста «отчёт» без ссылки на PR/коммит бесполезен —
-- ОТК нечего проверять, а история вклада не восстанавливается. Ссылка
-- хранится отдельно от comment, чтобы её можно было показывать кликабельно
-- и позже агрегировать (лента вклада, «кто что сделал»).
--
-- artifact_url — необязателен: фото/видео-отчёты остаются валидными.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS artifact_url TEXT;

COMMENT ON COLUMN reports.artifact_url IS
  'Ссылка на результат: PR, коммит, документ. Необязательна.';

-- Дешёвый поиск отчётов с артефактами (лента вклада, аудит).
CREATE INDEX IF NOT EXISTS idx_reports_artifact
  ON reports (created_at DESC)
  WHERE artifact_url IS NOT NULL;
