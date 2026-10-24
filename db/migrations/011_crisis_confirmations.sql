-- ─────────────────────────────────────────────
-- 011_crisis_confirmations.sql
-- Фиксирует факт подтверждения участия в мобилизации.
-- Симметрично crisis_refusals (уже существует).
--
-- Зачем:
--   1. Дедупликация: UNIQUE (mobilization_id, participant_id)
--      защищает от накрутки confirmed_count одним участником.
--   2. Аудит: кто именно подтвердил (не только счётчик).
--   3. Симметрия с crisis_refusals — единый паттерн.
--
-- Дополнительно: добавляет UNIQUE на crisis_refusals
-- (защита от дублей отказов, которой раньше не было).
--
-- Идемпотентность:
--   CREATE TABLE / INDEX — IF NOT EXISTS
--   ADD CONSTRAINT — через DO-блок (PG < 18 не поддерживает IF NOT EXISTS)
-- ─────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS crisis_confirmations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mobilization_id UUID NOT NULL REFERENCES crisis_mobilizations(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_crisis_confirmation UNIQUE (mobilization_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_crisis_confirmations_mob
  ON crisis_confirmations(mobilization_id);

-- Удаляем дубли в crisis_refusals (dev/staging) перед добавлением UNIQUE.
DELETE FROM crisis_refusals a
 USING crisis_refusals b
 WHERE a.id > b.id
   AND a.mobilization_id = b.mobilization_id
   AND a.participant_id = b.participant_id;

-- ADD CONSTRAINT IF NOT EXISTS не поддерживается до PG 18 — используем DO-блок.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uniq_crisis_refusal'
  ) THEN
    ALTER TABLE crisis_refusals
      ADD CONSTRAINT uniq_crisis_refusal
      UNIQUE (mobilization_id, participant_id);
  END IF;
END $$;

COMMIT;