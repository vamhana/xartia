-- 021_psy_rights_narrow.sql
--
-- Сузить psy_session до релевантных ролей.
-- Оставляем: PSY (полный V/C/E/Act), COUNCIL_MEMBER (только V), FIRST_ARCHITECT
-- (через универсальное '*' — не хранится в rights_matrix для psy_session).
--
-- ВАЖНО: roles.name НЕ UNIQUE — на каждое направление своя запись
-- 'COUNCIL_MEMBER'/'PSY'/... Поэтому подзапросы возвращают N строк,
-- и сравнивать надо через IN, а не через '='.
--
-- Идемпотентна: повторный прогон — no-op (DELETE удаляет 0 строк).

BEGIN;

-- 1. Удалить все psy_session-права для ролей, кроме PSY/COUNCIL_MEMBER/FIRST_ARCHITECT.
DELETE FROM rights_matrix
 WHERE resource = 'psy_session'
   AND role_id IN (
     SELECT id FROM roles
      WHERE name NOT IN ('PSY', 'COUNCIL_MEMBER', 'FIRST_ARCHITECT')
   );

-- 2. COUNCIL_MEMBER — только V (чтение). Всё остальное (C/E/Act/...) удалить.
--    NB: `IN`, не `=` — подзапрос возвращает по строке на направление.
DELETE FROM rights_matrix
 WHERE resource = 'psy_session'
   AND role_id IN (SELECT id FROM roles WHERE name = 'COUNCIL_MEMBER')
   AND action <> 'V';

COMMIT;

-- Кэш прав (C.0.01.06) TTL 30 сек в Redis — сам истечёт.
-- При необходимости сбросить вручную из node:
--   import { invalidateRightsMatrixCache } from './src/core/rights.js';
--   await invalidateRightsMatrixCache();