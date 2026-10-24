-- 023_webhooks.sql — Webhooks / Webhook Deliveries
-- Зависит от D.2.01.03 (participants для FK).
-- Идемпотентно: IF NOT EXISTS + CHECK-констрейнты.
--
-- Хартия V.6, V.7: внешние интеграции, HTTP-подписки на события платформы.
-- Secret зашифрован at-rest через L.0.01.06 encrypt(ENCRYPTION_KEY).

BEGIN;

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES participants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_webhook_url_https CHECK (url LIKE 'https://%'),
  CONSTRAINT chk_webhook_url_length CHECK (length(url) BETWEEN 1 AND 2048)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INT,
  response_body TEXT,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','failed')),
  next_retry_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON webhook_deliveries (next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
  ON webhook_deliveries (webhook_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhooks_events
  ON webhooks USING GIN (events);

CREATE INDEX IF NOT EXISTS idx_webhooks_active
  ON webhooks (active) WHERE active = true;

COMMIT;

-- Проверка:
--   SELECT COUNT(*) FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN ('webhooks','webhook_deliveries');
-- Ожидается: 2.