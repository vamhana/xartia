-- 025_fix_operator_role_type.sql
--
-- Роль OPERATOR ошибочно засеяна как 'permanent' вместо 'temporary'
-- (см. C.0.01.01: termDays=180, maxTerms=2 — временная выборная роль).
-- Функционально не блокирует (сервис читает политику из кода,
-- не из БД), но семантически неверно для UI и внешних потребителей.
--
-- Идемпотентна.

BEGIN;

UPDATE roles
   SET type = 'temporary'
 WHERE name = 'OPERATOR'
   AND type = 'permanent';

COMMIT;

-- Проверка:
--   SELECT name, type FROM roles WHERE name = 'OPERATOR' LIMIT 1;
-- Ожидается: OPERATOR | temporary