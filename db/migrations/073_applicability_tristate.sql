-- ============================================================================
-- 073 — Применимость измерений атомов: каноническая трёхзначная форма
--       (Фаза 1, этап 4b; §4.5 плана xartia-core-implementation).
--
-- Было:  dimension_applicability[dim] = { applicable: boolean, reason?, name? }
-- Стало: dimension_applicability[dim] = { state: 'applicable' | 'not_applicable'
--                                                | 'undetermined', reason?, name? }
--
-- Правила конвертации (согласованы с владельцем):
--   applicable: true,  атом approved           → state = applicable
--   applicable: true,  атом НЕ approved        → state = undetermined
--        (решение по применимости не подтверждено: §4.5 запрещает повышать
--         старое `true` без подтверждённого решения)
--   applicable: false + непустая причина       → state = not_applicable
--   applicable: false без причины              → state = undetermined
--   запись не объект / applicable не boolean   → state = undetermined
--   записи по измерению нет                    → остаётся нет (читается как
--                                                undetermined)
-- Уже имеющий `state` объект не трогается; ключи вне U/X/D/P/E не трогаются.
-- Ключ `applicable` у сконвертированных записей удаляется (один источник истины).
--
-- ОБРАТИМОСТЬ. Конвертация теряет информацию (true → undetermined у
-- кандидатов), поэтому старые значения сохраняются в таблице
-- competency_atoms_applicability_backup_073. Откат:
--   UPDATE competency_atoms a
--      SET dimension_applicability = b.dimension_applicability, updated_at = now()
--     FROM competency_atoms_applicability_backup_073 b
--    WHERE b.atom_id = a.atom_id;
-- Таблицу бэкапа и функцию можно удалить после этапа 4d.
--
-- Транзакцию открывает раннер (scripts/migrate.ts), поэтому BEGIN/COMMIT здесь
-- не нужны: миграция и запись в schema_migrations атомарны.
-- Идемпотентна: повторный прогон ничего не меняет.
-- ============================================================================

CREATE OR REPLACE FUNCTION passport_convert_applicability_v073(app jsonb, atom_status text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN app IS NULL OR jsonb_typeof(app) <> 'object' THEN app
    ELSE COALESCE(
      (
        SELECT jsonb_object_agg(
          e.key,
          CASE
            WHEN e.key NOT IN ('U', 'X', 'D', 'P', 'E') THEN e.value
            WHEN jsonb_typeof(e.value) <> 'object'
              THEN jsonb_build_object('state', 'undetermined')
            WHEN jsonb_exists(e.value, 'state') THEN e.value
            ELSE (e.value - 'applicable') || jsonb_build_object(
              'state',
              CASE
                WHEN e.value -> 'applicable' = 'true'::jsonb
                  THEN CASE WHEN atom_status = 'approved'
                            THEN 'applicable' ELSE 'undetermined' END
                WHEN e.value -> 'applicable' = 'false'::jsonb
                     AND jsonb_typeof(e.value -> 'reason') = 'string'
                     AND (e.value ->> 'reason') ~ '\S'
                  THEN 'not_applicable'
                ELSE 'undetermined'
              END
            )
          END
        )
        FROM jsonb_each(app) AS e(key, value)
      ),
      app
    )
  END
$$;

CREATE TABLE IF NOT EXISTS competency_atoms_applicability_backup_073 AS
  SELECT atom_id, status, dimension_applicability, now() AS backed_up_at
    FROM competency_atoms;

UPDATE competency_atoms
   SET dimension_applicability =
         passport_convert_applicability_v073(dimension_applicability, status),
       updated_at = now()
 WHERE dimension_applicability IS DISTINCT FROM
       passport_convert_applicability_v073(dimension_applicability, status);

DO $report$
DECLARE
  v_applicable     integer;
  v_not_applicable integer;
  v_undetermined   integer;
BEGIN
  SELECT count(*) FILTER (WHERE e.value ->> 'state' = 'applicable'),
         count(*) FILTER (WHERE e.value ->> 'state' = 'not_applicable'),
         count(*) FILTER (WHERE e.value ->> 'state' = 'undetermined')
    INTO v_applicable, v_not_applicable, v_undetermined
    FROM competency_atoms a,
         LATERAL jsonb_each(a.dimension_applicability) AS e(key, value)
   WHERE jsonb_typeof(a.dimension_applicability) = 'object'
     AND e.key IN ('U', 'X', 'D', 'P', 'E')
     AND jsonb_typeof(e.value) = 'object';
  RAISE NOTICE '073: applicability entries -> applicable=%, not_applicable=%, undetermined=%',
    v_applicable, v_not_applicable, v_undetermined;
END
$report$;
