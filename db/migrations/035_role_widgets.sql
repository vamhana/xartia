-- 035 — Виджеты под роли: личные задачи и очередь ОТК.
--
-- До этого все панели показывали один и тот же «table/tasks» — общий список
-- задач. Роль отличается не оформлением, а данными: исполнителю нужны СВОИ
-- задачи, ревьюеру — очередь на проверку, а не весь список.
--
-- Что делает:
--   1. добавляет в библиотеку виджеты table/my_tasks, table/otc_queue,
--      metric/total_flow (loader'ы уже существуют в C.0.26.03);
--   2. в панели ASSOCIATED меняет общий список задач на «Мои задачи»;
--   3. в панелях OTC/VERIFIER/KEEPER — на «Очередь на проверку»;
--   4. проставляет человеческие заголовки через overrides.title.
--
-- Идемпотентна: повторный запуск не создаёт дублей и не ломает заголовки.

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
    RAISE NOTICE '035: нет Первого Архитектора — виджеты не создаются';
    RETURN;
  END IF;

  -- 1. Библиотечные виджеты, которых не хватало.
  INSERT INTO widgets (type, entity, config, default_rights, created_by)
  SELECT v.type, v.entity, '{}'::jsonb, '{}'::jsonb, arch
    FROM (VALUES
      ('table',  'my_tasks'),
      ('table',  'otc_queue'),
      ('metric', 'total_flow')
    ) AS v(type, entity)
   WHERE NOT EXISTS (
     SELECT 1 FROM widgets w WHERE w.type = v.type AND w.entity = v.entity
   );

  -- 2. Исполнителю — свои задачи.
  UPDATE panel_widgets pw
     SET widget_id = (SELECT id FROM widgets WHERE type = 'table' AND entity = 'my_tasks')
    FROM panels p, widgets w
   WHERE pw.panel_id = p.id
     AND pw.widget_id = w.id
     AND p.name = 'Роль: ASSOCIATED'
     AND w.type = 'table'
     AND w.entity = 'tasks';

  -- 3. Ревьюерам — очередь на проверку.
  UPDATE panel_widgets pw
     SET widget_id = (SELECT id FROM widgets WHERE type = 'table' AND entity = 'otc_queue')
    FROM panels p, widgets w
   WHERE pw.panel_id = p.id
     AND pw.widget_id = w.id
     AND p.name IN ('Роль: OTC', 'Роль: VERIFIER', 'Роль: KEEPER')
     AND w.type = 'table'
     AND w.entity = 'tasks';

  -- 4. Человеческие заголовки для панелей ролей.
  UPDATE panel_widgets pw
     SET overrides = COALESCE(pw.overrides, '{}'::jsonb) || jsonb_build_object('title', t.title)
    FROM panels p, widgets w,
         (VALUES
           ('Роль: ASSOCIATED',       'card',     'passport',    'Мой паспорт'),
           ('Роль: ASSOCIATED',       'table',    'my_tasks',    'Мои задачи'),
           ('Роль: ASSOCIATED',       'progress', 'capsule',     'Капсула Потока'),
           ('Роль: ASSOCIATED',       'list',     'signals',     'Сигналы направления'),

           ('Роль: OTC',              'table',    'otc_queue',   'Очередь на проверку'),
           ('Роль: OTC',              'list',     'signals',     'Сигналы'),
           ('Роль: OTC',              'timeline', 'archive',     'Архив'),
           ('Роль: OTC',              'metric',   'flows',       'Потоки'),

           ('Роль: VERIFIER',         'table',    'otc_queue',   'Очередь на проверку'),
           ('Роль: VERIFIER',         'timeline', 'archive',     'Архив'),
           ('Роль: VERIFIER',         'metric',   'flows',       'Потоки'),

           ('Роль: KEEPER',           'table',    'otc_queue',   'Очередь на проверку'),
           ('Роль: KEEPER',           'timeline', 'archive',     'Архив'),
           ('Роль: KEEPER',           'metric',   'flows',       'Потоки'),

           ('Роль: COUNCIL_MEMBER',   'table',    'tasks',       'Задачи направления'),
           ('Роль: COUNCIL_MEMBER',   'chart',    'balance',     'Баланс направления'),
           ('Роль: COUNCIL_MEMBER',   'list',     'signals',     'Сигналы'),
           ('Роль: COUNCIL_MEMBER',   'map',      'communities', 'Общины'),

           ('Роль: BALANCER',         'chart',    'balance',     'Баланс'),
           ('Роль: BALANCER',         'metric',   'flows',       'Потоки'),
           ('Роль: BALANCER',         'list',     'signals',     'Сигналы'),

           ('Роль: FIRST_ARCHITECT',  'table',    'tasks',       'Все задачи'),
           ('Роль: FIRST_ARCHITECT',  'list',     'signals',     'Сигналы'),
           ('Роль: FIRST_ARCHITECT',  'chart',    'balance',     'Мой Поток'),
           ('Роль: FIRST_ARCHITECT',  'metric',   'flows',       'Потоки'),
           ('Роль: FIRST_ARCHITECT',  'tree',     'cells',       'Ячейки'),
           ('Роль: FIRST_ARCHITECT',  'map',      'communities', 'Общины'),
           ('Роль: FIRST_ARCHITECT',  'timeline', 'archive',     'Архив')
         ) AS t(panel, typ, ent, title)
   WHERE pw.panel_id = p.id
     AND pw.widget_id = w.id
     AND p.name = t.panel
     AND w.type = t.typ
     AND w.entity = t.ent;

  -- 5. Заголовки для панелей направлений.
  UPDATE panel_widgets pw
     SET overrides = COALESCE(pw.overrides, '{}'::jsonb) || jsonb_build_object('title', t.title)
    FROM panels p, widgets w,
         (VALUES
           ('table',    'tasks',       'Задачи направления'),
           ('list',     'signals',     'Сигналы'),
           ('metric',   'flows',       'Потоки'),
           ('tree',     'cells',       'Ячейки'),
           ('timeline', 'archive',     'Архив')
         ) AS t(typ, ent, title)
   WHERE pw.panel_id = p.id
     AND pw.widget_id = w.id
     AND p.name LIKE 'Направление %'
     AND p.context = 'normal'
     AND w.type = t.typ
     AND w.entity = t.ent;
END $$;
