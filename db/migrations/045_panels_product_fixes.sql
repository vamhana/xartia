-- 045 — Добить продуктовые панели: Шлюз, Обнуление, Направление 1.
--
-- 044 добавила виджеты казны/Совета/надзора, но библиотека не содержала
-- transactions/assets/dictionary, поэтому панели Шлюза и Обнуления остались
-- без этих виджетов. Плюс у направления 1 не было панели (034 её пропустила).
--
-- Идемпотентна.

DO $$
DECLARE
  arch UUID;
  pid UUID;
BEGIN
  SELECT id INTO arch
    FROM participants
   WHERE is_first_architect = true AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF arch IS NULL THEN
    RAISE NOTICE '045: нет Первого Архитектора — панели не обновляются';
    RETURN;
  END IF;

  -- 1. Библиотека: сделки, активы, словарь.
  INSERT INTO widgets (type, entity, config, default_rights, created_by)
  SELECT v.type, v.entity, '{}'::jsonb, '{}'::jsonb, arch
    FROM (VALUES
      ('table', 'transactions'),
      ('table', 'assets'),
      ('list',  'dictionary'),
      ('table', 'plans')
    ) AS v(type, entity)
   WHERE NOT EXISTS (
     SELECT 1 FROM widgets w WHERE w.type = v.type AND w.entity = v.entity
   );

  -- 2. Направление 15: сделки и активы.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN directions d ON d.id = p.direction_id
    JOIN (VALUES
      ('table', 'transactions', '{"x":0,"y":5}', '{"w":8,"h":4}', 'Сделки Шлюза'),
      ('table', 'assets',       '{"x":8,"y":5}', '{"w":4,"h":4}', 'Активы')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE d.number = 15 AND p.role_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 3. OBLIVION: словарь.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":8,"y":0}'::jsonb, '{"w":4,"h":4}'::jsonb,
         jsonb_build_object('title', 'Словарь')
    FROM panels p
    JOIN roles r ON r.id = p.role_id
    JOIN widgets w ON w.type = 'list' AND w.entity = 'dictionary'
   WHERE r.name = 'OBLIVION' AND p.active
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 4. Направление 1: базовая панель, если её нет.
  IF NOT EXISTS (
    SELECT 1 FROM panels p JOIN directions d ON d.id = p.direction_id
     WHERE d.number = 1 AND p.role_id IS NULL AND p.active
  ) THEN
    INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
    SELECT format('Направление %s: %s', d.number, d.name), NULL, d.id, 'normal', 1, true, arch
      FROM directions d WHERE d.number = 1
    RETURNING id INTO pid;

    INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
    SELECT pid, w.id, s.pos::jsonb, s.sz::jsonb,
           jsonb_build_object('title', s.title)
      FROM (VALUES
        ('table',    'tasks',   '{"x":0,"y":0}', '{"w":8,"h":4}', 'Задачи направления'),
        ('list',     'signals', '{"x":8,"y":0}', '{"w":4,"h":4}', 'Сигналы'),
        ('metric',   'flows',   '{"x":0,"y":4}', '{"w":4,"h":3}', 'Потоки'),
        ('tree',     'cells',   '{"x":4,"y":4}', '{"w":4,"h":3}', 'Ячейки'),
        ('timeline', 'archive', '{"x":8,"y":4}', '{"w":4,"h":3}', 'Архив')
      ) AS s(typ, ent, pos, sz, title)
      JOIN widgets w ON w.type = s.typ AND w.entity = s.ent;
  END IF;
END $$;
