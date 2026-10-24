-- ============================================================================
-- 006_partitions.sql — D.7.01.01 / D.7.01.02
-- Управление партициями: создание будущих, удаление старых, мониторинг
-- ============================================================================

BEGIN;

-- Создать месячную партицию для таблицы
CREATE OR REPLACE FUNCTION fn_create_monthly_partition(
  parent_table TEXT,
  month_start  DATE
) RETURNS VOID AS $$
DECLARE
  partition_name TEXT;
  next_month     DATE;
BEGIN
  next_month     := (month_start + INTERVAL '1 month')::DATE;
  partition_name := parent_table || '_' ||
                    to_char(month_start, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    partition_name, parent_table, month_start, next_month
  );
END;
$$ LANGUAGE plpgsql;

-- Удалить старые партиции
CREATE OR REPLACE FUNCTION fn_drop_old_partitions(
  parent_table TEXT,
  retain_years INT DEFAULT 7
) RETURNS INT AS $$
DECLARE
  cutoff_date DATE;
  r RECORD;
  dropped INT := 0;
BEGIN
  cutoff_date := (now() - (retain_years || ' years')::INTERVAL)::DATE;

  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = parent_table
      AND c.relname ~ ('^' || parent_table || '_\d{4}_\d{2}$')
      AND to_date(substring(c.relname from '\d{4}_\d{2}$'), 'YYYY_MM') < cutoff_date
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I', r.relname);
    dropped := dropped + 1;
  END LOOP;

  RETURN dropped;
END;
$$ LANGUAGE plpgsql;

-- Создать партиции на N месяцев вперёд
CREATE OR REPLACE FUNCTION fn_ensure_future_partitions(
  parent_table TEXT,
  months_ahead INT DEFAULT 3
) RETURNS INT AS $$
DECLARE
  i INT;
  m DATE;
  created INT := 0;
BEGIN
  m := date_trunc('month', now())::DATE;
  FOR i IN 0..months_ahead LOOP
    PERFORM fn_create_monthly_partition(parent_table, m);
    created := created + 1;
    m := (m + INTERVAL '1 month')::DATE;
  END LOOP;
  RETURN created;
END;
$$ LANGUAGE plpgsql;

COMMIT;