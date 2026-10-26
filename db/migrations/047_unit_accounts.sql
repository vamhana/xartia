-- 047 — Внешние держатели монеты и пополнение казны.
--
-- Модель (уточнение владельца):
--   • из казны НЕТ переводов конкретным людям — тратится сообща на блага;
--   • монету может купить любой внешний человек («Вася»), пока дёшево;
--   • купленную монету он может перевести в казну (оплата услуг сообщества);
--   • у пяти ролей — ключи от казны и счетов пополнения, со сменой.
--
-- Поэтому нужны лицевые счета держателей: без них внешний покупатель не может
-- ни хранить монету, ни перевести её казне.

CREATE TABLE IF NOT EXISTS unit_accounts (
  id                   UUID PRIMARY KEY,
  participant_id       UUID REFERENCES participants(id) ON DELETE SET NULL,
  external_ref         TEXT,
  balance              NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (participant_id IS NOT NULL OR external_ref IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_accounts_participant
  ON unit_accounts(participant_id)
  WHERE participant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_accounts_external
  ON unit_accounts(external_ref)
  WHERE external_ref IS NOT NULL;

-- Журнал движения монеты по счетам: покупка, дар казне, выкуп.
CREATE TABLE IF NOT EXISTS unit_transfers (
  id             UUID PRIMARY KEY,
  account_id     UUID REFERENCES unit_accounts(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('buy', 'donate', 'redeem')),
  units          NUMERIC(38, 18) NOT NULL,
  usdc           NUMERIC(20, 6) NOT NULL,
  price          NUMERIC(38, 18) NOT NULL,
  actor_id       UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unit_transfers_created
  ON unit_transfers(created_at DESC);

-- Виды операций казны расширяются: покупка монеты и дар казне.
ALTER TABLE treasury_operations DROP CONSTRAINT IF EXISTS treasury_operations_kind_check;
ALTER TABLE treasury_operations ADD CONSTRAINT treasury_operations_kind_check
  CHECK (kind IN ('revenue', 'spend', 'redeem', 'genesis', 'buy', 'donate'));
