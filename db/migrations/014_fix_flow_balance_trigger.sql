-- D.2.01.14 — Fix fn_update_flow_balance trigger.
--
-- Проблема: INSERT ... ON CONFLICT в триггере падал на CHECK (balance >= 0),
-- когда NEW.amount < 0, даже если строка flows существует и DO UPDATE
-- успешно дал бы положительный баланс. Причина: Postgres проверяет CHECK
-- на "пробной" строке из VALUES ДО разрешения ON CONFLICT.
--
-- Решение: UPDATE сначала, INSERT только если строка не найдена.

BEGIN;

CREATE OR REPLACE FUNCTION fn_update_flow_balance()
RETURNS TRIGGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE flows
     SET balance = flows.balance + NEW.amount,
         updated_at = now()
   WHERE participant_id = NEW.participant_id
     AND type = NEW.type;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count = 0 THEN
    INSERT INTO flows (participant_id, type, balance, updated_at)
    VALUES (NEW.participant_id, NEW.type, NEW.amount, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;