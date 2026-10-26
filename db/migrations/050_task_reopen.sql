-- 050 — Пересмотр принятой задачи (P1).
--
-- Принятый результат можно пересмотреть: задача возвращается в работу,
-- начисленный Поток отменяется (обратная проводка), клейм снимается —
-- повторная приёмка снова начислит ровно один Поток.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reopened_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reopen_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_reopened_at TIMESTAMPTZ;
