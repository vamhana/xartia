-- ============================================================================
-- 012_chat.sql — Chat (W.2.12.01)
-- Каналы, сообщения, участники. Только для направлений/ячеек/советов/проектов
-- и личных переписок. Без партиционирования (объём небольшой).
-- ============================================================================

BEGIN;

-- ─── ENUM типа канала ────────────────────────────────
DO $$ BEGIN CREATE TYPE chat_channel_type_enum AS ENUM (
  'direct', 'direction', 'cell', 'council', 'project'
); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Реестр каналов ──────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Внутренний ID канала. Формат:
  --   direct:<uuid1>:<uuid2>   (uuid1 < uuid2 лексикографически)
  --   direction:<directionId>
  --   cell:<cellId>
  --   council:<councilId>
  --   project:<planId>
  channel_id      VARCHAR(128) NOT NULL UNIQUE,
  channel_type    chat_channel_type_enum NOT NULL,
  -- Для group-каналов — направление/ячейка/совет/проект.
  -- Для direct — NULL.
  scope_id        UUID,
  name            VARCHAR(255),
  created_by      UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  archived_at     TIMESTAMPTZ,
  archived_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Участники групповых каналов ─────────────────────
CREATE TABLE IF NOT EXISTS chat_channel_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ,
  CONSTRAINT uniq_active_membership UNIQUE (channel_id, participant_id, valid_from)
);

-- ─── Сообщения ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  content       TEXT NOT NULL,
  mentions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments   JSONB NOT NULL DEFAULT '[]'::jsonb,
  reply_to_id   UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  edited_at     TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_content_not_empty CHECK (length(trim(content)) > 0),
  CONSTRAINT chk_content_length CHECK (length(content) <= 10000),
  CONSTRAINT chk_mentions_array CHECK (jsonb_typeof(mentions) = 'array'),
  CONSTRAINT chk_attachments_array CHECK (jsonb_typeof(attachments) = 'array')
);

-- ─── Индексы ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_channels_type    ON chat_channels(channel_type) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_channels_scope   ON chat_channels(channel_type, scope_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_members_active   ON chat_channel_members(channel_id, participant_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_members_participant ON chat_channel_members(participant_id, valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender  ON chat_messages(sender_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions ON chat_messages USING GIN(mentions);
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_fts
  ON chat_messages USING GIN(to_tsvector('russian', content))
  WHERE deleted_at IS NULL;

COMMIT;