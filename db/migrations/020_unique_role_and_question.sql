-- ============================================================================
-- 020_unique_role_and_question.sql — D.2.01.20
--
-- Добавляет UNIQUE-индексы на естественные ключи roles и interview_questions.
--
-- Зачем: без UNIQUE ON CONFLICT DO NOTHING в seed (C.0.35.02) не срабатывает —
-- INSERT выполняется всегда, повторный seed создаёт дубликаты. Это было
-- выявлено при разработке admin-панели (A.1.35.01 → POST /admin/seed).
--
-- Также чистит возможные дубликаты на dev/staging-БД, созданные до этого
-- фикса. На prod-БД дубликатов быть не должно (seed запускался один раз
-- через D.2.01.07 при первом migrate).
-- ============================================================================

BEGIN;

-- 1. Cleanup дубликатов roles.
--    1a. Перенаправить FK-ссылки из participant_roles на минимальный id.
--        NB: MIN(uuid) не существует в PostgreSQL — кастуем через text.
WITH keeper AS (
  SELECT direction_id, name, MIN(id::text)::uuid AS keep_id
    FROM roles
   GROUP BY direction_id, name
  HAVING COUNT(*) > 1
)
UPDATE participant_roles pr
   SET role_id = k.keep_id
  FROM roles r
  JOIN keeper k ON k.direction_id = r.direction_id AND k.name = r.name
 WHERE pr.role_id = r.id
   AND r.id <> k.keep_id;

--    1b. То же для rights_matrix.
WITH keeper AS (
  SELECT direction_id, name, MIN(id::text)::uuid AS keep_id
    FROM roles
   GROUP BY direction_id, name
  HAVING COUNT(*) > 1
)
UPDATE rights_matrix rm
   SET role_id = k.keep_id
  FROM roles r
  JOIN keeper k ON k.direction_id = r.direction_id AND k.name = r.name
 WHERE rm.role_id = r.id
   AND r.id <> k.keep_id;

--    1c. Удалить сами дубликаты.
DELETE FROM roles r1
USING roles r2
WHERE r1.id > r2.id
  AND r1.direction_id = r2.direction_id
  AND r1.name = r2.name;

-- 2. Cleanup дубликатов interview_questions.
--    FK ни на что не ссылается — просто DELETE лишних.
DELETE FROM interview_questions q1
USING interview_questions q2
WHERE q1.id > q2.id
  AND q1.category = q2.category
  AND q1.question = q2.question
  AND q1.version  = q2.version;

-- 3. UNIQUE-индексы.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_roles_direction_name
  ON roles (direction_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interview_questions_cat_q_ver
  ON interview_questions (category, question, version);

-- 4. Sanity-нотисы.
DO $$
DECLARE
  roles_cnt INT;
  questions_cnt INT;
  dups_roles INT;
  dups_questions INT;
BEGIN
  SELECT COUNT(*) INTO roles_cnt FROM roles;
  SELECT COUNT(*) INTO questions_cnt FROM interview_questions;
  SELECT COUNT(*) INTO dups_roles FROM (
    SELECT 1 FROM roles GROUP BY direction_id, name HAVING COUNT(*) > 1
  ) d;
  SELECT COUNT(*) INTO dups_questions FROM (
    SELECT 1 FROM interview_questions GROUP BY category, question, version HAVING COUNT(*) > 1
  ) d;

  RAISE NOTICE 'roles: % (дубликатов: %)', roles_cnt, dups_roles;
  RAISE NOTICE 'interview_questions: % (дубликатов: %)', questions_cnt, dups_questions;
END $$;

COMMIT;