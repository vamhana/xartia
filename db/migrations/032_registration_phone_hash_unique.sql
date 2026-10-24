-- 032_registration_phone_hash_unique.sql
-- P3: partial UNIQUE на phone_hash активных заявок.
-- Без этого два параллельных register проходят pre-check и создают
-- две pending-заявки на один телефон.
--
-- WHERE status <> 'rejected' — rejected не блокирует повторную регистрацию.
-- Idempotent: IF NOT EXISTS.

BEGIN;

-- Cleanup дублей (dev/staging, если race уже случался): оставляем
-- минимальный id (по created_at ASC).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY phone_hash
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM registration_requests
   WHERE status <> 'rejected'
)
DELETE FROM registration_requests
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_registration_phone_hash_active
  ON registration_requests(phone_hash)
  WHERE status <> 'rejected';

COMMIT;

-- Проверка:
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'registration_requests';
-- Ожидается: idx_registration_phone_hash (был) +
--            uniq_registration_phone_hash_active (новый).