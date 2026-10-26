-- 043 — Выручка Шлюза не должна учитываться дважды.
--
-- Одна сделка Шлюза → одна операция казны. Частичный уникальный индекс
-- защищает от повторного аудита/ретрая.

CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_operations_gateway_tx
  ON treasury_operations(gateway_transaction_id)
  WHERE gateway_transaction_id IS NOT NULL;
