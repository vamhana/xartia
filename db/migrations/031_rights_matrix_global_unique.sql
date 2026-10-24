-- 031_rights_matrix_global_unique.sql(db\migrations\031_rights_matrix_global_unique.sql)
-- Partial UNIQUE для глобальных записей rights_matrix (role_id IS NULL).
-- Обычный UNIQUE (role_id, resource, action, scope, version) не срабатывает
-- для NULL-role (NULL != NULL в SQL). Этот индекс закрывает дыру.
-- Идемпотентна.

BEGIN;

-- Чистим дубли, если уже успели накопиться (dev/staging).
WITH keeper AS (
  SELECT resource, action, scope, version, MIN(id::text)::uuid AS keep_id
    FROM rights_matrix
   WHERE role_id IS NULL
   GROUP BY resource, action, scope, version
  HAVING COUNT(*) > 1
)
DELETE FROM rights_matrix rm
 USING keeper k
 WHERE rm.role_id IS NULL
   AND rm.resource = k.resource
   AND rm.action = k.action
   AND rm.scope = k.scope
   AND rm.version = k.version
   AND rm.id <> k.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rights_matrix_global
  ON rights_matrix (resource, action, scope, version)
  WHERE role_id IS NULL;

COMMIT;