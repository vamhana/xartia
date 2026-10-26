-- 046 — Кризисные панели и места наставника/координатора.
--
-- 1. Кризис: Архитектор и Совет видят казну, надзор и сигналы, а не только
--    два общих виджета.
-- 2. Инкубация (направление 11): наставничество — список учеников.
-- 3. Все направления: «Наряд на день» — рабочее место координатора ячейки.
-- 4. ASSOCIATED: наряд на день как личный план.
--
-- Идемпотентна.

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
    RAISE NOTICE '046: нет Первого Архитектора — панели не обновляются';
    RETURN;
  END IF;

  -- 1. Кризисные панели.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, s.pos::jsonb, s.sz::jsonb, jsonb_build_object('title', s.title)
    FROM panels p
    JOIN (VALUES
      ('metric', 'treasury_price',    '{"x":0,"y":0}', '{"w":4,"h":2}', 'Курс казны'),
      ('metric', 'treasury_coverage', '{"x":4,"y":0}', '{"w":4,"h":2}', 'Покрытие пола'),
      ('tree',   'oversight',        '{"x":0,"y":2}', '{"w":8,"h":4}', 'Надзор'),
      ('list',   'signals',          '{"x":8,"y":0}', '{"w":4,"h":6}', 'Сигналы')
    ) AS s(typ, ent, pos, sz, title) ON TRUE
    JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
   WHERE p.name IN ('Кризис: FIRST_ARCHITECT', 'Кризис: COUNCIL_MEMBER')
     AND p.context = 'crisis'
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 2. Инкубация: наставничество.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":0,"y":5}'::jsonb, '{"w":12,"h":4}'::jsonb,
         jsonb_build_object('title', 'Наставничество: ученики')
    FROM panels p
    JOIN directions d ON d.id = p.direction_id
    JOIN widgets w ON w.type = 'table' AND w.entity = 'mentees'
   WHERE d.number = 11 AND p.role_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 3. Наряд на день — во все направления (место координатора ячейки).
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":0,"y":9}'::jsonb, '{"w":12,"h":4}'::jsonb,
         jsonb_build_object('title', 'Наряд на день')
    FROM panels p
    JOIN directions d ON d.id = p.direction_id
    JOIN widgets w ON w.type = 'table' AND w.entity = 'daily_plan'
   WHERE p.role_id IS NULL AND d.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );

  -- 4. ASSOCIATED: наряд на день.
  INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
  SELECT p.id, w.id, '{"x":0,"y":4}'::jsonb, '{"w":12,"h":3}'::jsonb,
         jsonb_build_object('title', 'Наряд на день')
    FROM panels p
    JOIN roles r ON r.id = p.role_id
    JOIN widgets w ON w.type = 'table' AND w.entity = 'daily_plan'
   WHERE r.name = 'ASSOCIATED' AND p.active
     AND NOT EXISTS (
       SELECT 1 FROM panel_widgets pw WHERE pw.panel_id = p.id AND pw.widget_id = w.id
     );
END $$;
