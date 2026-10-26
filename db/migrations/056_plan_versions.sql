-- 056 — Версионирование плана.
--
-- Изменение плана — это версия, а не молчаливая правка: v1 → v2 → …
-- Версия хранит снимок плана, причину и автора. Принятые задачи не
-- отменяются; наряд пересобирается из новой версии.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS plan_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,
  reason      TEXT NOT NULL,
  created_by  UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_plan
  ON plan_versions(plan_id, version DESC);
