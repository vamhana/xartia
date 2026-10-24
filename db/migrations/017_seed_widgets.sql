-- D.2.01.17 — Seed widgets library.
-- Идемпотентно: если widgets уже не пуста — пропускаем.
-- created_by привязывается к первому активному участнику.

DO $$
DECLARE
  v_author UUID;
  v_inserted INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM widgets LIMIT 1) THEN
    RAISE NOTICE 'Widgets already seeded, skipping';
    RETURN;
  END IF;

  SELECT id INTO v_author
    FROM participants
   WHERE deleted_at IS NULL
   ORDER BY entered_at ASC
   LIMIT 1;

  -- На чистой БД Архитектора ещё нет. Не падаем — сид пропускается.
  -- После bootstrap Архитектор вызовет POST /admin/seed (C.0.35.02.seedTemplates).
  IF v_author IS NULL THEN
    RAISE NOTICE 'Нет активных участников — widgets пропущены. Запусти POST /admin/seed после bootstrap-architect.';
    RETURN;
  END IF;

  INSERT INTO widgets (type, entity, config, default_rights, created_by) VALUES
    ('metric',   'flows',       '{"label":"Основной баланс","value":0}'::jsonb, '{}'::jsonb, v_author),
    ('progress', 'capsule',     '{"label":"Капсула","max":180,"value":0}'::jsonb, '{}'::jsonb, v_author),
    ('circular', 'regimes',     '{"label":"Активный режим","max":100,"value":0}'::jsonb, '{}'::jsonb, v_author),
    ('table',    'tasks',       '{"columns":[{"key":"externalId","title":"ID"},{"key":"description","title":"Описание"},{"key":"priority","title":"Приоритет"},{"key":"status","title":"Статус"}]}'::jsonb, '{}'::jsonb, v_author),
    ('list',     'signals',     '{"titleKey":"externalId","emptyText":"Нет открытых сигналов"}'::jsonb, '{}'::jsonb, v_author),
    ('card',     'passport',    '{"fields":[{"key":"externalId","label":"ID"},{"key":"name","label":"Имя"},{"key":"directionId","label":"Направление"}]}'::jsonb, '{}'::jsonb, v_author),
    ('chart',    'balance',     '{"chartType":"line","xKey":"date","series":[{"key":"value","label":"Значение"}]}'::jsonb, '{}'::jsonb, v_author),
    ('map',      'communities', '{"zoom":4}'::jsonb, '{}'::jsonb, v_author),
    ('timeline', 'archive',     '{}'::jsonb, '{}'::jsonb, v_author),
    ('tree',     'cells',       '{}'::jsonb, '{}'::jsonb, v_author);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Inserted % widgets', v_inserted;
END $$;