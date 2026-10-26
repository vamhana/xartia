-- 044 — Продуктовые панели: казна, Совет, надзор, наставничество.
--
-- До этого панели ролей состояли из общих виджетов (задачи/сигналы/потоки).
-- Теперь у каждой функции — свои данные:
--   Архитектор   — казна (курс/покрытие), подписанты, запросы трат, дерево надзора
--   Совет        — состояние Совета направления, запросы трат (подписи), покрытие пола
--   Балансировка — дерево надзора, покрытие пола
--   Верификация/Хранитель — запросы трат на подпись
--   Шлюз (напр. 15) — сделки, активы, курс казны
--   Балансировка (напр. 8) — надзор + казна
--
-- Идемпотентна: повторный запуск не дублирует виджеты и позиции.

DO $$
DECLARE
  arch UUID;
BEGIN
  SELECT id INTO arch
    FROM participants
   WHERE is_first_architect = true AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF arch IS NULL THEN
    RAISE NOTICE '044: нет Первого Архитектора — панели не обновляются';
    RETURN;
  END IF;

  -- 1. Библиотека виджетов.
  INSERT INTO widgets (type, entity, config, default_rights, created_by)
  SELECT v.type, v.entity, '{}'::jsonb, '{}'::jsonb, arch
    FROM (VALUES
      ('metric', 'treasury_price'),
      ('metric', 'treasury_coverage'),
      ('list',   'signatories'),
      ('table',  'spend_requests'),
      ('card',   'council'),
      ('tree',   'oversight'),
      ('table',  'mentees')
    ) AS v(type, entity)
   WHERE NOT EXISTS (
     SELECT 1 FROM widgets w WHERE w.type = v.type AND w.entity = v.entity
   );

  -- 2. Архитектор: казна и надзор.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN (VALUES
      ('metric', 'treasury_price',    '{"x":0,"y":8}',  '{"w":3,"h":3}', 'Курс казны'),
      ('metric', 'treasury_coverage', '{"x":3,"y":8}',  '{"w":3,"h":3}', 'Покрытие пола'),
      ('list',   'signatories',      '{"x":6,"y":8}',  '{"w":6,"h":3}', 'Подписанты казны'),
      ('table',  'spend_requests',   '{"x":0,"y":11}', '{"w":6,"h":4}', 'Запросы трат'),
      ('tree',   'oversight',        '{"x":6,"y":11}', '{"w":6,"h":4}', 'Надзор: планы → ячейки')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE p.name = 'Роль: FIRST_ARCHITECT'
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 3. Совет направления: состояние Совета, подписи, покрытие.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN (VALUES
      ('card',   'council',          '{"x":0,"y":7}',  '{"w":4,"h":4}', 'Совет направления'),
      ('table',  'spend_requests',   '{"x":4,"y":7}',  '{"w":4,"h":4}', 'Траты на подпись'),
      ('metric', 'treasury_coverage','{"x":8,"y":7}',  '{"w":4,"h":4}', 'Покрытие пола')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE p.name = 'Роль: COUNCIL_MEMBER'
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 4. Балансировка: надзор + покрытие.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN (VALUES
      ('tree',   'oversight',         '{"x":0,"y":7}', '{"w":8,"h":5}', 'Надзор: планы → ячейки'),
      ('metric', 'treasury_coverage', '{"x":8,"y":7}', '{"w":4,"h":3}', 'Покрытие пола')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE p.name = 'Роль: BALANCER'
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 5. Верификация и Хранитель: запросы трат.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":0,"y":7}'::jsonb, '{"w":6,"h":4}'::jsonb,
         jsonb_build_object('title', 'Запросы трат')
    FROM panels p
    JOIN widgets w ON w.type = 'table' AND w.entity = 'spend_requests'
   WHERE p.name IN ('Роль: VERIFIER', 'Роль: KEEPER')
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 6. Панель для OBLIVION, если её не было.
  IF NOT EXISTS (SELECT 1 FROM panels p JOIN roles r ON r.id = p.role_id
                  WHERE r.name = 'OBLIVION' AND p.active = true) THEN
    INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
    SELECT 'Роль: OBLIVION', r.id, NULL, 'normal', 1, true, arch
      FROM roles r WHERE r.name = 'OBLIVION' LIMIT 1
    RETURNING id INTO arch;

    INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
    SELECT arch, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
      FROM (VALUES
        ('timeline', 'archive',     '{"x":0,"y":0}', '{"w":8,"h":4}', 'Архив'),
        ('list',     'dictionary',  '{"x":8,"y":0}', '{"w":4,"h":4}', 'Словарь'),
        ('list',     'signals',     '{"x":0,"y":4}', '{"w":6,"h":4}', 'Сигналы')
      ) AS s(typ, ent, pos, sz, title)
      JOIN widgets w ON w.type = s.typ AND w.entity = s.ent;
  END IF;

  -- 7. Направление 15 (Шлюз): сделки и активы.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN directions d ON d.id = p.direction_id
    JOIN (VALUES
      ('table', 'transactions',   '{"x":0,"y":5}', '{"w":8,"h":4}', 'Сделки Шлюза'),
      ('table', 'assets',         '{"x":8,"y":5}', '{"w":4,"h":4}', 'Активы')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE d.number = 15 AND p.role_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 8. Направление 8 (Балансировка): надзор.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":0,"y":5}'::jsonb, '{"w":12,"h":5}'::jsonb,
         jsonb_build_object('title', 'Надзор: планы → ячейки')
    FROM panels p
    JOIN directions d ON d.id = p.direction_id
    JOIN widgets w ON w.type = 'tree' AND w.entity = 'oversight'
   WHERE d.number = 8 AND p.role_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );
END $$;
