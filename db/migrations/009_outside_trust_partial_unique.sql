-- 009_outside_trust_partial_unique.sql
-- UNIQUE на participant_id → частичный UNIQUE для активных записей.
-- Позволяет иметь историю: одна активная + N снятых.

BEGIN;

-- Убираем старый глобальный UNIQUE
ALTER TABLE outside_trust_network DROP CONSTRAINT IF EXISTS outside_trust_network_participant_id_key;

-- Добавляем частичный UNIQUE — только для status = 'active'
CREATE UNIQUE INDEX IF NOT EXISTS uniq_outside_trust_active
  ON outside_trust_network(participant_id)
  WHERE status = 'active';

COMMIT;