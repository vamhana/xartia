-- 052 — Эскалация просроченной проверки ОТК.
--
-- Реестр эскалаций: одна запись на задачу, чтобы уведомление Совету
-- не повторялось при каждом вызове. SLA — 24 ч (OTC_SLA_HOURS).

CREATE TABLE IF NOT EXISTS otc_escalations (
  task_id      UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES directions(id) ON DELETE SET NULL,
  escalated_by UUID REFERENCES participants(id) ON DELETE SET NULL,
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
