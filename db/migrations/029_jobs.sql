-- 029_jobs.sql — таблица jobs для worker-инфраструктуры.
--
-- Единая очередь задач: Exports, Imports, Bulk (будущее).
-- Worker на PostgreSQL (FOR UPDATE SKIP LOCKED), не Redis:
--   - задачи переживают рестарт,
--   - статусы видны в админке,
--   - не нужен отдельный брокер.
--
-- Идемпотентно: IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','cancelled')),
  progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  result_key TEXT,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES participants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue
  ON jobs (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_user
  ON jobs (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_running
  ON jobs (status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_jobs_completed_at
  ON jobs (finished_at) WHERE status IN ('completed','failed','cancelled');

COMMIT;

-- Проверка:
--   SELECT COUNT(*) FROM pg_tables
--    WHERE schemaname = 'public' AND tablename = 'jobs';
-- Ожидается: 1.