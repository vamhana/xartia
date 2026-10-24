-- ============================================================================
-- 019_recovery_requests.sql
-- Восстановление доступа к аккаунту (S.0.01.04 / C.0.02.02 / A.1.01.01).
-- Флоу B: заявка → approve (Совет/Архитектор) → токен через мессенджер → смена пароля.
-- Зависит от: 003_tables.sql (participants).
--
-- Статусная машина:
--   pending   → approved | rejected
--   approved  → used | expired
--   used / rejected / expired — терминальные.
--
-- approved_by / approved_at семантически = «кто и когда принял решение»,
-- заполняются и при approve, и при reject (см. C.0.02.02 rejectRecoveryRequest).
--
-- Переход approved → expired выполняется ЛЕНИВО в C.0.02.02
-- consumeRecoveryToken (при token_expires_at <= now()). Отдельный cron
-- не требуется; контракт защищён на уровне сервиса.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS recovery_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status            VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','used','rejected','expired')),
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_ip      INET,
  -- ON DELETE RESTRICT: hard-delete approver'а запрещён, пока у него есть
  -- решения. Soft-delete (participants.deleted_at) не задевает FK.
  approved_by       UUID REFERENCES participants(id) ON DELETE RESTRICT,
  approved_at       TIMESTAMPTZ,
  -- SHA-256 hex (64 символа). Сам токен в БД не хранится.
  token_hash        VARCHAR(64),
  token_expires_at  TIMESTAMPTZ,
  used_at           TIMESTAMPTZ,
  reject_reason     TEXT,

  -- Согласованность статуса и полей.
  CONSTRAINT chk_recovery_status_fields CHECK (
    (status = 'pending'
       AND approved_by IS NULL AND approved_at IS NULL
       AND token_hash IS NULL AND token_expires_at IS NULL
       AND used_at IS NULL AND reject_reason IS NULL)
    OR
    (status = 'approved'
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL
       AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL
       AND used_at IS NULL)
    OR
    (status = 'used'
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL
       AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL
       AND used_at IS NOT NULL)
    OR
    (status = 'rejected'
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL
       AND token_hash IS NULL AND token_expires_at IS NULL
       AND used_at IS NULL AND reject_reason IS NOT NULL)
    OR
    (status = 'expired'
       AND approved_by IS NOT NULL AND approved_at IS NOT NULL
       AND token_hash IS NOT NULL AND token_expires_at IS NOT NULL
       AND used_at IS NULL)
  ),

  -- Хронология.
  CONSTRAINT chk_recovery_chronology CHECK (
    (approved_at IS NULL OR approved_at >= requested_at)
    AND (used_at IS NULL OR approved_at IS NULL OR used_at >= approved_at)
    AND (token_expires_at IS NULL OR approved_at IS NULL OR token_expires_at > approved_at)
  )
);

-- Одна активная заявка на участника.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recovery_active
  ON recovery_requests(participant_id)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS idx_recovery_status
  ON recovery_requests(status, requested_at DESC);

-- Поиск при confirm. Partial: до approve токена нет.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recovery_token_hash
  ON recovery_requests(token_hash)
  WHERE token_hash IS NOT NULL;

-- Аудит «кто сколько одобрил/отклонил».
CREATE INDEX IF NOT EXISTS idx_recovery_approved_by
  ON recovery_requests(approved_by, approved_at DESC)
  WHERE approved_by IS NOT NULL;

-- Антифрод / rate-limit по IP.
CREATE INDEX IF NOT EXISTS idx_recovery_requested_ip
  ON recovery_requests(requested_ip, requested_at DESC)
  WHERE requested_ip IS NOT NULL;

COMMENT ON TABLE recovery_requests IS
  'Заявки на восстановление доступа (флоу B). Токен хранится только как SHA-256 hex.';
COMMENT ON COLUMN recovery_requests.status IS
  'pending → approved|rejected; approved → used|expired. approved→expired — лениво в consumeRecoveryToken.';
COMMENT ON COLUMN recovery_requests.token_hash IS
  'SHA-256 hex (64 символа) от одноразового токена. Сам токен в БД не хранится.';
COMMENT ON COLUMN recovery_requests.approved_by IS
  'Кто принял решение (approve или reject). ON DELETE RESTRICT: hard-delete approver''а запрещён.';

COMMIT;

-- Пост-проверки:
--   SELECT COUNT(*) FROM recovery_requests;                     -- 0 после миграции
--   \d recovery_requests
--   SELECT indexname FROM pg_indexes WHERE tablename = 'recovery_requests';