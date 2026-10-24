# scripts/ — служебные скрипты XartIA

Всё, что запускается руками: миграции, bootstrap, dev-workspace.
Здесь же — `launch_workspace.py`, который держит 6 консольных окон проекта.

---

## Быстрый старт (dev)

```powershell
python scripts\launch_workspace.py
```

Поднимает окно 3×2 с шестью cmd:

| Плитка | Что делает |
|---|---|
| `xartia-api`   | `pnpm dev` — API на :3000 (tsx watch) |
| `xartia-ws`    | `pnpm tsx src/ws/server.ts` — WebSocket :3001 |
| `xartia-web`   | `pnpm dev:web` — Vite :5173 |
| `xartia-ops`   | Docker-инфраструктура + миграции + Архитектор |
| `xartia-logs`  | `docker compose logs -f postgres redis minio` |
| `xartia-db`    | `psql` к БД `charter` |

При старте workspace убивает повисшие `node/tsx/vite/pnpm` (освобождает 3000/3001/5173).

Логин Архитектора (dev):
```
Телефон: +79001234567
Пароль:  ChangeMe123456
```

---

## Файлы

| Файл | Назначение |
|---|---|
| `launch_workspace.py` | Окно с 6 встроенными cmd. Требует админ-прав (SetParent). |
| `xartia-ops.bat` | Инфраструктура + миграции + ensure-architect. Вызывается из 4-й плитки. |
| `migrate.ts` | Идемпотентный раннер миграций. Учёт в `schema_migrations`. |
| `reset.ts` | DROP SCHEMA public + migrate. Только для dev. |
| `ensure-architect.ts` | Идемпотентно создаёт/обновляет первого Архитектора. |
| `_env.ts` | Загрузчик `.env` без `dotenv` — для скриптов, которые не тянут `src/security/**`. |
| `bootstrap-architect.ts` | Разовая инициализация Архитектора (заменяется на `ensure-architect.ts`). |
| `bootstrap-participant.ts` | Создание обычного участника. ⚠️ Синтаксис в `import` сломан — см. ниже. |
| `api-dump.ts` | Дамп OpenAPI/роутов (см. исходник). |
| `check-redis.ts` | Проверка подключения к Redis. |
| `get-test-ids.ts`, `get-test-token.ts` | Утилиты для интеграционных тестов. |
| `lib/ws-env.ts` | Общие хелперы для WS-тестов. |
| `test-*.ts` | Интеграционные smoke-тесты по доменам (см. `pnpm tsx scripts/test-<domain>.ts`). |

---

## Установка с нуля

```powershell
# 1. Инфраструктура (Postgres+PostGIS, Redis, MinIO)
docker compose -f docker/docker-compose.yml up -d postgres redis minio

# 2. Миграции (001..017)
pnpm db:migrate

# 3. Архитектор (создастся или обновится)
pnpm tsx scripts/ensure-architect.ts

# 4. Проверка логина
$body = @{ phone = "+79001234567"; password = "ChangeMe123456" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5
```

`migrate.ts` спотыкается на `017_seed_widgets.sql`, если нет ни одного participant.
Это нормально: 017 требует `created_by`. Запустите `ensure-architect.ts`, потом
`pnpm db:migrate` ещё раз.

---

## Команды

```powershell
pnpm db:migrate                # применить все неприменённые
pnpm db:migrate -- --dry-run   # показать, что будет применено
pnpm db:migrate -- 005         # начиная с 005 (включительно)
pnpm db:reset                  # DROP SCHEMA + migrate (нужен CONFIRM_RESET=yes)
pnpm tsx scripts/ensure-architect.ts
pnpm tsx scripts/bootstrap-participant.ts +79001234567 "Имя" "Пароль"
```

`reset.ts` защищён от случайного запуска:

```powershell
$env:CONFIRM_RESET = "yes"; pnpm db:reset
```

---

## Архитектор: как это работает

`ensure-architect.ts` — идемпотентный. Три сценария:

| Состояние БД | Что делает |
|---|---|
| Архитектора нет | Создаёт `А00001-1` + роль FIRST_ARCHITECT + welcome pack |
| Есть, пароль `$argon2id$placeholder` | **UPDATE** полей (не удаляет!) |
| Есть, пароль настоящий | Ничего не трогает |

**Почему UPDATE, а не DELETE.** Таблица `widgets.created_by → participants.id`
без `ON DELETE CASCADE`. Если placeholder удалить — упрётся в
`widgets_created_by_fkey`. Обновление полей решает проблему и сохраняет 10
сидовых виджетов.

Env-переменные (все опциональны):

```
ARCHITECT_PHONE=+79001234567
ARCHITECT_NAME=Первый Архитектор
ARCHITECT_PASSWORD=ChangeMe123456
```

---

## Типичные грабли

### 1. CRLF в `.sh` внутри alpine-контейнера

**Симптом:** `exec /app/entrypoint.sh failed: No such file or directory`.
**Причина:** файл сохранён на Windows с `\r\n`, shebang становится `#!/bin/sh\r`,
ядро ищет `/bin/sh\r` — не находит.
**Фикс:**
- Конвертировать `docker/entrypoint.sh` в LF.
- `.gitattributes` должен содержать `*.sh text eol=lf`.
- В `Dockerfile.api` уже стоит `RUN sed -i 's/\r$//' /app/entrypoint.sh`.
  Страховка, но не повод хранить файл в CRLF.

### 2. `dotenv` / `pino-pretty` не найдены в prod-образе

**Симптом:** `Cannot find package 'dotenv' imported from /app/src/server.ts`.
**Причина:** пакет в `devDependencies`, а Dockerfile ставит `--prod`.
**Фикс:** всё, что импортируется из `src/**`, должно быть в `dependencies`.

Тот же паттерн ловится на любом пакете: `ws`, `pino-pretty`, `dotenv`.
Правило: `devDependencies` — только для тестов, линтеров, сборки.

### 3. `relation "auth_sessions" already exists`

**Симптом:** `003_tables.sql` падает на первой таблице.
**Причина:** в БД остались таблицы от прошлых экспериментов до введения
`schema_migrations`. 001 и 002 идемпотентны и проходят, 003 — нет.
**Фикс — сбросить схему:**

```powershell
docker compose -f docker/docker-compose.yml exec postgres `
  psql -U charter -d charter `
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
```

Затем `pnpm db:migrate` с нуля.

### 4. PostGIS не ставится

**Симптом:** `CREATE EXTENSION postgis` — ошибка.
**Причина:** образ `postgres:*`, а не `postgis/postgis:*`.
**Фикс:** в `docker-compose.yml` использовать `postgis/postgis:15-3.4`.

### 5. `quay.io/minio/*` — 401 UNAUTHORIZED

**Причина:** Docker daemon ходит через прокси, а `quay.io/v2/auth` режется.
**Быстрый обход:** использовать `coollabsio/minio:latest` (Docker Hub).
**Полный фикс:** Docker Desktop → Settings → Resources → Proxies → выключить.

### 6. `bootstrap-participant.ts` — синтаксис сломан

**Симптом:** `ERROR: Expected string but found "."` на строке 6.
**Причина:** `import { transaction } from ../src/lib/db.js;` — нет кавычек.
**Фикс:** `import { transaction } from '../src/lib/db.js';`

### 7. Кириллица в `.bat` — кракозябры

**Симптом:** `╨Я╨╛╨┤╨╜╨╕╨╝╨░╤О...` вместо «Поднимаю».
**Фикс:** в начале bat — `chcp 65001 > nul`, сохранять в UTF-8 без BOM.
Сам bat из `launch_workspace.py` пишется в `cp866` — тогда `chcp` не нужен,
но конкретно `xartia-ops.bat` живёт в UTF-8.

---

## Полезные команды для отладки

```powershell
# Полный стек
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f api --tail 50

# Зайти в psql
docker compose -f docker/docker-compose.yml exec postgres psql -U charter -d charter

# Что в БД
SELECT external_id, name, status FROM participants;
SELECT COUNT(*) FROM widgets;
SELECT version FROM schema_migrations ORDER BY version;
SELECT COUNT(*) FROM directions;      -- ожидается 17
SELECT COUNT(*) FROM rights_matrix;   -- сотни
SELECT COUNT(*) FROM widgets;         -- 10

# Healthcheck api
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready

# Убить повисшие node перед перезапуском
Get-Process node,tsx,vite,pnpm -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Что НЕ добавлять в `.dockerignore`

Список граблей, на которых уже постояли:

```
docker/                ← нужен docker/entrypoint.sh
Dockerfile*            ← нужен для multi-stage в будущем
tsconfig.json          ← нужен tsx в рантайме
tsconfig.base.json     ← нужен tsx в рантайме
src/, db/, scripts/    ← нужны в образе
package.json, pnpm-lock.yaml
```

Если хоть один из них отфильтрован — `COPY` падает с `not found`,
даже если вторая часть той же инструкции указывает существующий файл
(`COPY a.json b.json ./` — единая операция).

---

## Env

`.env` в корне проекта. Ключевые переменные для скриптов:

```
DATABASE_URL=postgresql://charter:charter@localhost:5432/charter
ENCRYPTION_KEY=<base64, 32 bytes>
PHONE_HASH_KEY=<base64, 32 bytes>

ARCHITECT_PHONE=+79001234567
ARCHITECT_NAME=Первый Архитектор
ARCHITECT_PASSWORD=ChangeMe123456
```

`ENCRYPTION_KEY` и `PHONE_HASH_KEY` обязательны: без них падает
`src/security/encryption.ts` при импорте. Проверять — до запуска
`ensure-architect.ts` и любых скриптов, которые тянут `src/security/**`.

---

## Известные нерешённые пункты

- `bootstrap-participant.ts` — не исправлен `import` (см. грабли №6).
- `bootstrap-architect.ts` дублирует логику `ensure-architect.ts`.
  После стабилизации — удалить, оставить только `ensure-architect`.
- `_env.ts` используется только `reset.ts`. `migrate.ts` и `ensure-architect.ts`
  тянут `dotenv/config` — надо унифицировать.
- `api-dump.ts`, `check-redis.ts`, `get-test-*` — есть, но не задокументированы
  в этом README; см. исходники.

---

## Соглашения

- **Shell-скрипты в LF.** Проверять перед коммитом: `git diff --check`.
- **Скрипты идемпотентны.** Повторный запуск не должен ломать состояние.
- **Одна транзакция = один смысл.** `BEGIN ... COMMIT` вокруг создания
  Архитектора, чтобы при падении откатиться целиком.
- **Никаких `--no-cache` по умолчанию.** Только если явно менялся lock-файл
  и Docker не видит разницы.