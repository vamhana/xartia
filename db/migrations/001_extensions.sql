-- ─────────────────────────────────────────────
-- D.2.01.01 — Extensions
-- Установка PostgreSQL-расширений:
--   pgcrypto    — шифрование PII (телефоны, email)
--   postgis     — геолокация (участники, задачи, центры)
--   pg_trgm     — триграммы (быстрый нечёткий поиск)
--   btree_gist  — композитные индексы с RANGE
--   uuid-ossp   — генерация UUID (резерв для pgcrypto)
-- ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Проверка: вывести установленные расширения
DO $$
DECLARE
    ext_name TEXT;
BEGIN
    RAISE NOTICE 'Установленные расширения:';
    FOR ext_name IN
        SELECT extname FROM pg_extension ORDER BY extname
    LOOP
        RAISE NOTICE '  - %', ext_name;
    END LOOP;
END $$;