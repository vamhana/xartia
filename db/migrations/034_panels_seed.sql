-- 034 — Панели по направлениям и ролям.
--
-- Зачем: панель — это не «дашборд вообще», а рабочее место конкретной роли в
-- конкретном направлении. До этой миграции в базе были только тестовые
-- панели «проба1..4», поэтому экран «Рабочая панель» выглядел пустым, а
-- конструктор — игрушкой.
--
-- Что делает:
--   1. архивирует тестовые панели (active = false, не удаляет — Хартия);
--   2. создаёт по одной панели на каждое из 17 направлений (role_id = NULL);
--   3. создаёт панели для ролей по профилям (executor / reviewer / analyst /
--      curator / architect) с привязкой role_id и direction_id = NULL;
--   4. создаёт кризисные панели (context = 'crisis') для Архитектора и Совета.
--
-- Идемпотентна: повторный запуск ничего не дублирует (проверка по имени/владельцу).

DO $$
DECLARE
  arch UUID;
  d RECORD;
  r RECORD;
  pid UUID;
BEGIN
  SELECT id INTO arch
    FROM participants
   WHERE is_first_architect = true AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF arch IS NULL THEN
    RAISE NOTICE '034: нет Первого Архитектора — панели не создаются';
    RETURN;
  END IF;

  -- 1. Архив тестовых панелей (ничего не удаляем).
  UPDATE panels
     SET active = false, updated_at = now()
   WHERE active = true AND name LIKE 'проба%';

  -- 2. Панели направлений.
  FOR d IN SELECT id, number, name FROM directions ORDER BY number LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM panels
       WHERE direction_id = d.id AND role_id IS NULL AND context = 'normal'
    );

    INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
    VALUES (format('Направление %s: %s', d.number, d.name), NULL, d.id, 'normal', 1, true, arch)
    RETURNING id INTO pid;

    INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
    SELECT pid, w.id, s.pos::jsonb, s.sz::jsonb, '{}'::jsonb
      FROM (VALUES
        ('table',    'tasks',     '{"x":0,"y":0}', '{"w":8,"h":4}'),
        ('list',     'signals',   '{"x":8,"y":0}', '{"w":4,"h":4}'),
        ('metric',   'flows',     '{"x":0,"y":4}', '{"w":4,"h":3}'),
        ('tree',     'cells',     '{"x":4,"y":4}', '{"w":4,"h":3}'),
        ('timeline', 'archive',   '{"x":8,"y":4}', '{"w":4,"h":3}')
      ) AS s(typ, ent, pos, sz)
      JOIN widgets w ON w.type = s.typ AND w.entity = s.ent;
  END LOOP;

  -- 3. Панели ролей. Профили: кто что делает.
  FOR r IN
    SELECT * FROM (VALUES
      ('ASSOCIATED',       'executor'),
      ('OPERATOR',         'executor'),
      ('NOOLOG',           'executor'),
      ('LIAISON',          'executor'),
      ('OTC',              'reviewer'),
      ('VERIFIER',         'reviewer'),
      ('KEEPER',           'reviewer'),
      ('BALANCER',         'analyst'),
      ('AGGREGATOR',       'analyst'),
      ('PROTOCOL_COUNCIL', 'analyst'),
      ('PSY',              'analyst'),
      ('COUNCIL_MEMBER',   'curator'),
      ('FIRST_ARCHITECT',  'architect')
    ) AS x(role_name, profile)
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM roles WHERE name = r.role_name);
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM panels p
        JOIN roles ro ON ro.id = p.role_id
       WHERE ro.name = r.role_name AND p.context = 'normal' AND p.direction_id IS NULL
    );

    INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
    SELECT format('Роль: %s', r.role_name), ro.id, NULL, 'normal', 1, true, arch
      FROM roles ro WHERE ro.name = r.role_name
     ORDER BY ro.direction_id
     LIMIT 1
    RETURNING id INTO pid;

    INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
    SELECT pid, w.id, s.pos::jsonb, s.sz::jsonb, '{}'::jsonb
      FROM (VALUES
        ('executor', 'card',     'passport',  '{"x":0,"y":0}', '{"w":4,"h":3}'),
        ('executor', 'table',    'tasks',     '{"x":4,"y":0}', '{"w":8,"h":4}'),
        ('executor', 'progress', 'capsule',   '{"x":0,"y":3}', '{"w":4,"h":3}'),
        ('executor', 'list',     'signals',   '{"x":4,"y":4}', '{"w":8,"h":3}'),

        ('reviewer', 'table',    'tasks',     '{"x":0,"y":0}', '{"w":8,"h":4}'),
        ('reviewer', 'list',     'signals',   '{"x":8,"y":0}', '{"w":4,"h":4}'),
        ('reviewer', 'timeline', 'archive',   '{"x":0,"y":4}', '{"w":6,"h":3}'),
        ('reviewer', 'metric',   'flows',     '{"x":6,"y":4}', '{"w":6,"h":3}'),

        ('analyst',  'chart',    'balance',   '{"x":0,"y":0}', '{"w":6,"h":4}'),
        ('analyst',  'metric',   'flows',     '{"x":6,"y":0}', '{"w":6,"h":4}'),
        ('analyst',  'list',     'signals',   '{"x":0,"y":4}', '{"w":12,"h":3}'),

        ('curator',  'table',    'tasks',     '{"x":0,"y":0}', '{"w":8,"h":4}'),
        ('curator',  'chart',    'balance',   '{"x":8,"y":0}', '{"w":4,"h":4}'),
        ('curator',  'list',     'signals',   '{"x":0,"y":4}', '{"w":6,"h":3}'),
        ('curator',  'map',      'communities','{"x":6,"y":4}', '{"w":6,"h":3}'),

        ('architect','table',    'tasks',     '{"x":0,"y":0}', '{"w":8,"h":4}'),
        ('architect','list',     'signals',   '{"x":8,"y":0}', '{"w":4,"h":4}'),
        ('architect','chart',    'balance',   '{"x":0,"y":4}', '{"w":4,"h":3}'),
        ('architect','metric',   'flows',     '{"x":4,"y":4}', '{"w":4,"h":3}'),
        ('architect','tree',     'cells',     '{"x":8,"y":4}', '{"w":4,"h":3}'),
        ('architect','map',      'communities','{"x":0,"y":7}', '{"w":6,"h":3}'),
        ('architect','timeline', 'archive',   '{"x":6,"y":7}', '{"w":6,"h":3}')
      ) AS s(profile, typ, ent, pos, sz)
      JOIN widgets w ON w.type = s.typ AND w.entity = s.ent
     WHERE s.profile = r.profile;
  END LOOP;

  -- 4. Кризисные панели: Архитектор и Совет. Другой контекст — другой экран.
  FOR r IN SELECT * FROM (VALUES ('FIRST_ARCHITECT'), ('COUNCIL_MEMBER')) AS x(role_name)
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM panels p
        JOIN roles ro ON ro.id = p.role_id
       WHERE ro.name = r.role_name AND p.context = 'crisis'
    );

    INSERT INTO panels (name, role_id, direction_id, context, version, active, created_by)
    SELECT format('Кризис: %s', r.role_name), ro.id, NULL, 'crisis', 1, true, arch
      FROM roles ro WHERE ro.name = r.role_name
     ORDER BY ro.direction_id
     LIMIT 1
    RETURNING id INTO pid;

    INSERT INTO panel_widgets (panel_id, widget_id, position, size, overrides)
    SELECT pid, w.id, s.pos::jsonb, s.sz::jsonb, '{}'::jsonb
      FROM (VALUES
        ('circular', 'regimes', '{"x":0,"y":0}', '{"w":6,"h":4}'),
        ('list',     'signals', '{"x":6,"y":0}', '{"w":6,"h":4}')
      ) AS s(typ, ent, pos, sz)
      JOIN widgets w ON w.type = s.typ AND w.entity = s.ent;
  END LOOP;
END $$;
