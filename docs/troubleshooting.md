# Troubleshooting: первый запуск

Короткий справочник по типичным сбоям при первом подъёме локального
окружения. Формат: **симптом → причина → что сделать**.

Полный архив граблей (Windows, compose-api, ESLint и прочее) лежит в корне:
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md). Этот файл покрывает пять
сценариев, с которыми новичок чаще всего уходит в первые десять минут.

Команды ниже проверены на чистом Docker-стеке
(`postgres` + `redis` + `minio` из `docker/docker-compose.yml`) и
последовательности из README: `pnpm db:migrate` →
`pnpm tsx scripts/ensure-architect.ts` → `pnpm db:migrate` → `pnpm dev`.

---

## 1. Порт занят (3000 / 5432 / 6379)

**Симптом.** `pnpm dev` падает с `EADDRINUSE :::3000`, Postgres/Redis не
слушают, или веб открывается, а API отвечает «чужим» процессом.

**Причина.** Порт уже держит другой процесс: старый `node`/`tsx` от
прошлого `pnpm dev`, сервис `api` из compose, локальный Postgres/Redis
вне Docker, или чужое приложение.

**Что сделать.**

1. Узнать, кто слушает порт:

```bash
# macOS / Linux
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5432 -sTCP:LISTEN
lsof -nP -iTCP:6379 -sTCP:LISTEN
```

```powershell
# Windows
netstat -ano | findstr ":3000 :5432 :6379"
```

2. Если это ваш старый Node: остановите процессы `node` / `tsx` / `vite` /
   `pnpm` и запустите снова `pnpm dev`.
3. Если это `com.docker` / `docker-proxy` на `:3000`: в compose поднят
   сервис `api`. Для локального `pnpm dev` на хосте остановите его:

```bash
docker compose -f docker/docker-compose.yml stop api
```

4. Для БД и Redis в dev обычно достаточно контейнеров на `5432` и `6379`.
   Если порт занят системным Postgres/Redis, либо остановите их, либо
   смените проброс в `docker/docker-compose.yml` и `DATABASE_URL` /
   `REDIS_URL` в `.env`.

Ожидаемая схема портов из `.env.example`: API `3000`, WebSocket `3001`,
веб (Vite) `5173`, Postgres `5432`, Redis `6379`, MinIO `9000`.

---

## 2. Docker не поднялся / WSL

**Симптом.** `docker compose -f docker/docker-compose.yml up -d postgres redis minio`
пишет ошибку демона, `Cannot connect to the Docker daemon`, или контейнеры
сразу выходят.

**Причина.** Docker Desktop (или демон) не запущен; на Windows часто не
готов WSL2; реже мешают прокси к registry или занятые порты (см. выше).

**Что сделать.**

1. Запустите Docker Desktop и дождитесь статуса «running».
2. На Windows: Settings → General → Use the WSL 2 based engine; в
   `wsl -l -v` дистрибутив Docker должен быть в состоянии Running.
3. Проверьте демон и порты:

```bash
docker info
docker compose -f docker/docker-compose.yml ps
```

4. Поднимите только инфраструктуру (без образа `api`):

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis minio
docker compose -f docker/docker-compose.yml exec postgres pg_isready -U charter
```

`pg_isready` должен ответить `accepting connections`. Если образ
`postgis/postgis` тянется долго или падает на auth registry, см. раздел
Docker в [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

Заметки про k3d/Longhorn на WSL2 (это уже не первый запуск ядра) живут в
`infra/longhorn/windows-wsl2.md`.

---

## 3. `pnpm db:migrate` падает на чистой базе

**Симптом.** Миграции обрываются с ошибкой соединения, `DATABASE_URL не задан`,
или `relation ... already exists` на полупустой БД.

**Причина.**

- Postgres ещё не готов, либо `DATABASE_URL` не указывает на
  `localhost:5432` / пользователя `charter`.
- В volume осталась схема от прошлого эксперимента: часть миграций
  идемпотентна, часть падает на уже существующих таблицах.
- Файл `.env` отсутствует (нужна копия `.env.example`).

**Что сделать.**

1. Скопируйте окружение и дождитесь готовности Postgres:

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d postgres redis minio
docker compose -f docker/docker-compose.yml exec postgres pg_isready -U charter
pnpm db:migrate
```

2. Если видите `already exists` на чистом (по задумке) стенде, сбросьте
   схему **только в dev**:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U charter -d charter \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
pnpm db:migrate
```

3. На актуальной `main` сид виджетов (`017_seed_widgets.sql`) **не падает**,
   если участников ещё нет: он пишет NOTICE и пропускает вставку. Полный
   порядок из README всё равно полезен: migrate → `ensure-architect` →
   migrate снова (сиды ролей/панелей и идемпотентный повтор).

Проверка:

```bash
pnpm db:migrate -- --dry-run
# ожидается: нет неприменённых миграций
```

---

## 4. Нет Архитектора после `ensure-architect`

**Симптом.** После `pnpm tsx scripts/ensure-architect.ts` в БД нет строки
с `is_first_architect = true`, скрипт падает на `ENCRYPTION_KEY`, или
логин Архитектора не принимается.

**Причина.** Скрипт пишет в ту БД, что задана в `DATABASE_URL`; для хеша
пароля и телефона нужны валидные ключи из `.env`. Дефолты скрипта:
телефон `+79001234567`, пароль `ChangeMe123456` (их можно переопределить
через `ARCHITECT_PHONE` / `ARCHITECT_PASSWORD`).

**Что сделать.**

1. Убедитесь, что `.env` рядом с корнем репозитория и
   `ENCRYPTION_KEY` / `INTEGRITY_HMAC_KEY` декодируются в **ровно 32 байта**
   base64 (плейсхолдер из `.env.example` для шифрования нужно заменить
   перед bootstrap, иначе скрипт упадёт с `CONFIG`).
2. Запустите снова (скрипт идемпотентен: создаст, обновит placeholder или
   ничего не сделает):

```bash
pnpm tsx scripts/ensure-architect.ts
```

Успех выглядит так: `Архитектор создан: А00001-1` (или сообщение, что уже
есть).

3. Проверьте строку в БД:

```bash
docker compose -f docker/docker-compose.yml exec -T postgres \
  psql -U charter -d charter \
  -c "SELECT external_id, name, is_first_architect, left(password_hash, 24) FROM participants;"
```

Ожидается один Архитектор; `password_hash` начинается с `$argon2id$v=`,
а не с `$argon2id$placeholder`.

---

## 5. Веб открывается, но API отвечает 401 / 404

**Симптом.** Vite на `http://localhost:5173` грузит интерфейс, а запросы
логина или данных дают `401 Unauthorized` или `404 Not Found`.

**Причина.**

- **401:** неверный пароль, или у Архитектора ещё placeholder-хеш (не
  прогнали `ensure-architect` до конца).
- **404:** API не слушает `localhost:3000`, на порту сидит другой процесс,
  либо запрос не проходит через dev-прокси `/__api` → `http://localhost:3000`
  (см. `vite.config.ts`).

**Что сделать.**

1. Убедитесь, что API жив на хосте:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health/live
# или другой health-роут из /health/*, если live отсутствует
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Если `:3000` занят не вашим `pnpm dev`, освободите порт (раздел 1) и
перезапустите.

2. Для 401 обновите Архитектора и логиньтесь дефолтами (или своими из `.env`):

```bash
pnpm tsx scripts/ensure-architect.ts
# телефон +79001234567, пароль ChangeMe123456
```

3. Для 404 на `/auth/login` проверьте, что фронт ходит в `/__api/...`
   (так делает `src/web/api/client.ts` по умолчанию), а не напрямую в
   несуществующий путь Vite. Прямой вызов бэкенда:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"phone":"+79001234567","password":"ChangeMe123456"}'
```

Ожидается не 404. Роут регистрируется через `registerAuthRoutes` в
`src/server.ts`.

4. Если задали `VITE_API_URL`, он должен указывать на доступный API.
   Иначе оставьте значение по умолчанию (`/__api`). Важно: `pnpm dev`
   поднимает только API и WebSocket, а веб запускается отдельно —
   `pnpm dev:web` в другом терминале.

---

## Куда писать, если не помогло

- Текст ошибки + шаг из README: [Telegram hartia_5](https://t.me/hartia_5)
  или [Discussions](https://github.com/vamhana/xartia/discussions).
- Расширенный список: [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).
- Правила вклада: [CONTRIBUTING.md](../CONTRIBUTING.md).
