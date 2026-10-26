-- 049 — Поток за задачу: идемпотентность и связь с задачей.
--
-- flow_transactions партиционирована по created_at, поэтому UNIQUE(task_id)
-- на ней невозможен (ключ партиции обязателен). Вводим отдельный реестр
-- присуждений: PRIMARY KEY(task_id) — атомарный «замок» на одно начисление.

ALTER TABLE flow_transactions
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS task_flow_awards (
  task_id        UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  transaction_id UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
