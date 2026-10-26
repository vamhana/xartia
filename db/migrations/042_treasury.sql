-- 042 — Казна: стабильная учётная единица (XartIA 5.0).
--
-- Пол 1.00 в USD обеспечивается только T1 (USDC/фиат/T-bills).
-- Прибыль добавляется в резерв без эмиссии → цена растёт; расходы списываются
-- из премии, пол не трогается. Траты — только через мультисиг 3-из-5.

CREATE TABLE IF NOT EXISTS treasury_state (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  t1_usdc        NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (t1_usdc >= 0),
  t2_usdc        NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (t2_usdc >= 0),
  operating_usdc NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (operating_usdc >= 0),
  buffer_usdc    NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (buffer_usdc >= 0),
  supply         NUMERIC(38, 18) NOT NULL DEFAULT 0 CHECK (supply >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO treasury_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS treasury_operations (
  id                     UUID PRIMARY KEY,
  kind                   TEXT NOT NULL CHECK (kind IN ('revenue', 'spend', 'redeem', 'genesis')),
  amount_usdc            NUMERIC(20, 6) NOT NULL,
  amount_units           NUMERIC(38, 18) NOT NULL DEFAULT 0,
  price                  NUMERIC(38, 18) NOT NULL,
  gateway_transaction_id UUID,
  actor_id               UUID REFERENCES participants(id) ON DELETE SET NULL,
  note                   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_operations_created
  ON treasury_operations(created_at DESC);

CREATE TABLE IF NOT EXISTS treasury_spend_requests (
  id          UUID PRIMARY KEY,
  amount_usdc NUMERIC(20, 6) NOT NULL CHECK (amount_usdc > 0),
  purpose     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'executed', 'rejected')),
  created_by  UUID REFERENCES participants(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS treasury_approvals (
  request_id     UUID NOT NULL REFERENCES treasury_spend_requests(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, participant_id)
);
