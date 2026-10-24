-- 028_search_fts.sql — FTS-индексы для универсального поиска (I.1.10).
--
-- Search — тонкий слой над существующими таблицами. Новых таблиц нет,
-- только индексы для ускорения FTS/ILIKE.
--
-- Идемпотентно: IF NOT EXISTS + CREATE EXTENSION IF NOT EXISTS.
--
-- Существующие FTS-индексы (НЕ дублируем):
--   - archive_documents.subject — idx_archive_documents_subject_fts (003)
--   - chat_messages.content     — FTS (012)
--   - participants.external_id  — btree (003)
--   - participants.phone_hash   — btree (003)

BEGIN;

-- pg_trgm для ILIKE-поиска по именам (не прозаический текст — FTS неэффективен).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- tasks.description — FTS на русском.
CREATE INDEX IF NOT EXISTS idx_tasks_description_fts
  ON tasks USING GIN (to_tsvector('russian', description));

-- signals: description + justification — FTS на русском.
-- Один индекс на конкатенацию: SQL-запросы используют ту же формулу,
-- что в idx_signals_description_fts.
CREATE INDEX IF NOT EXISTS idx_signals_description_fts
  ON signals USING GIN (
    to_tsvector('russian', description || ' ' || justification)
  );

-- goods: name + description (description nullable — COALESCE).
CREATE INDEX IF NOT EXISTS idx_goods_name_desc_fts
  ON goods USING GIN (
    to_tsvector('russian', name || ' ' || COALESCE(description, ''))
  );

-- participants.name — trgm для ILIKE '%q%' (имена — не проза).
CREATE INDEX IF NOT EXISTS idx_participants_name_trgm
  ON participants USING GIN (name gin_trgm_ops);

COMMIT;

-- Проверка:
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND (indexname LIKE '%_fts' OR indexname LIKE '%_trgm')
--    ORDER BY indexname;
-- Ожидается 4 новых индекса (+ archive_documents_subject_fts уже был).