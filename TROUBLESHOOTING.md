# TROUBLESHOOTING — XartIA Charter 5.0

Практический справочник по граблям, на которые уже наступали (или наступим).
Формат: **симптом → причина → фикс**. Все команды — из корня проекта
`C:\Users\TD\Desktop\heart`.

## Оглавление

- [Docker и стек](#docker-и-стек)
- [Запуск API](#запуск-api)
- [БД и миграции](#бд-и-миграции)
- [ESLint / TypeScript](#eslint--typescript)
- [Runtime (tsx, cmd, PowerShell)](#runtime-tsx-cmd-powershell)
- [Auth](#auth)
- [Bootstrap и логин](#bootstrap-и-логин)
- [launch_workspace.py](#launch_workspacepy)
- [Web / Vite](#web--vite)
- [WebSocket](#websocket)
- [Быстрая диагностика](#быстрая-диагностика)
- [Что НЕ надо делать](#что-не-надо-делать)
- [Исторические заметки](#исторические-заметки)

---

## Docker и стек

### D1. `charter-api` в docker-compose держит `:3000` и отвечает старым кодом

**Симптом:** правишь `src/**`, перезапускаешь `pnpm dev`, но `/permissions/matrix`
(или другой роут) возвращает старую заглушку. Изменения в коде как будто игнорируются.

**Причина:** в `docker-compose.yml` поднят сервис `api`, который слушает `3000:3000`
и запускает собранный (запечённый в образ) код. Он перехватывает запросы у локального
`pnpm dev`, который пытается встать на тот же порт.

**Фикс:** при dev-работе на хосте — остановить compose-сервис `api`:

```powershell
docker compose -f docker/docker-compose.yml stop api
# теперь 3000 свободен для локального pnpm dev
```

Если нужно вернуть:

```powershell
docker compose -f docker/docker-compose.yml --profile api up -d api
# пересоберёт образ, если код поменялся
```

> **Правило:** локальный dev — либо всё в docker, либо всё на хосте.
> Смешение даёт «фантомные» баги, когда правишь один код, а отвечает другой.

---

### D2. `quay.io/...` — 401 UNAUTHORIZED

**Симптом:**

```text
failed to resolve reference "quay.io/minio/minio:latest":
unexpected status from HEAD request to https://quay.io/v2/...: 401 UNAUTHORIZED
```

`curl -I https://quay.io/v2/` отдаёт корректный `HTTP/1.1 401` с
`WWW-Authenticate: Bearer realm="..."` — сеть в порядке.

**Причина:** Docker daemon не делает шаги 2–3 анонимного токен-флоу
(получить токен → повторить запрос). Обычно — корпоративный прокси в Docker Desktop,
который режет `quay.io/v2/auth`.

**Диагностика:**

```powershell
docker info | findstr /I "Proxy"
```

Если непусто — вот источник.

**Фикс A (полный):** Docker Desktop → Settings → Resources → Proxies →
Manual proxy configuration → **off** → Apply & Restart.

**Фикс B (dev):** в текущем `docker-compose.yml` уже используется
`coollabsio/minio` (Docker Hub) — для dev эта проблема больше не воспроизводится.
Но для prod (если образ тянется с `quay.io`) — только Фикс A.

**Фикс C (prod):** перейти на Bitnami (Docker Hub) — он сам создаёт бакеты
через `MINIO_DEFAULT_BUCKETS`, `minio-init` не нужен:

```yaml
  minio:
    image: bitnami/minio:latest
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minio123}
      MINIO_DEFAULT_BUCKETS: "charter-media,charter-archive,charter-gateway"
```

---

### D3. Compose пишет `[!] Не удалось поднять Docker-стек`

**Причина:** Docker Desktop не запущен, или один из образов не тянется
(см. D2), или порт занят (см. A3).

**Диагностика:**

```powershell
docker ps -a
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs --tail 50
```

Проверить занятость портов 5432, 6379, 9000, 9001:

```powershell
netstat -ano | findstr ":5432 :6379 :9000 :9001"
```

---

### D4. `service "api" depends on "minio" with condition "service_healthy", but "minio" does not have a healthcheck`

**Причина:** в `docker-compose.yml` у сервиса `minio` нет блока `healthcheck`,
а у `api` в `depends_on` стоит `condition: service_healthy`.

**Фикс — один из двух:**

**A. Ослабить условие:**

```yaml
  api:
    depends_on:
      minio:
        condition: service_started
```

**B. Добавить healthcheck** (для `bitnami/minio`, если у образа есть `mc`):

```yaml
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

Для `coollabsio/minio` проще вариант A.

---

### D5. CRLF в `entrypoint.sh` внутри alpine

**Симптом:**

```text
[FATAL tini (7)] exec /app/entrypoint.sh failed: No such file or directory
```

Файл в образе лежит (видно по билд-логу `COPY ... DONE`), но `tini` не может
его запустить.

**Причина:** файл сохранён на Windows с `\r\n`. Ядро читает shebang как
`#!/bin/sh\r` и ищет интерпретатор `/bin/sh\r` — не находит.

**Диагностика:**

```powershell
$bytes = [IO.File]::ReadAllBytes("docker\entrypoint.sh")
if ($bytes -contains 13) { "ЕСТЬ CR — надо чинить" } else { "OK, LF" }
```

**Фикс (три уровня, применить все):**

1. **Сейчас:** конвертировать файл в LF.

```powershell
$p = "docker\entrypoint.sh"
$c = [IO.File]::ReadAllText($p) -replace "`r`n", "`n"
[IO.File]::WriteAllText($p, $c)
```

2. **`.gitattributes`:** добавить:

```text
*.sh text eol=lf
docker/entrypoint.sh text eol=lf
```

3. **`Dockerfile.api`:** страховка на случай повторения:

```dockerfile
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh
```

**Пересобрать:**

```powershell
docker compose -f docker/docker-compose.yml --profile api build api
docker compose -f docker/docker-compose.yml --profile api up -d api
```

---

### D6. `failed to compute cache key: "/docker/entrypoint.sh": not found`

**Симптом:** билд падает на `COPY docker/entrypoint.sh` или `COPY tsconfig.*`.
Соседние `COPY src`, `COPY db`, `COPY scripts` проходят.

**Причина:** в `.dockerignore` есть широкие паттерны, которые съедают файлы.
Классика: `docker`, `Dockerfile*`, `*.json`, `tsconfig.base.json`, `*.sh`.
Docker `COPY a b ./` — единая операция; если отфильтрован хотя бы один
файл — падает вся инструкция.

**Фикс:** убрать из `.dockerignore` строки:

```text
docker
Dockerfile*
tsconfig.json
tsconfig.base.json
*.json          (если есть)
```

**Проверка:**

```powershell
findstr /N "docker tsconfig" .dockerignore
```

Не должно быть совпадений с этими именами (кроме комментариев).

**Пересобрать без кеша:**

```powershell
docker compose -f docker/docker-compose.yml --profile api build api --no-cache
```

---

### D7. `unable to determine transport target for "pino-pretty"`

**Симптом:** api стартует, падает на `src/lib/logger.ts` с этим сообщением.

**Причина:** `logger.ts` включает pretty-транспорт, если `NODE_ENV=development`.
В контейнере `NODE_ENV=development`, а `pino-pretty` не установлен (devDep или отсутствует).

**Правильный фикс:** не привязывать pretty к `NODE_ENV`, а использовать
отдельный флаг `LOG_PRETTY`:

```ts
// src/lib/logger.ts
const usePretty =
  process.env.LOG_PRETTY === 'true' || process.env.LOG_PRETTY === '1';

transport: usePretty
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
  : undefined,
```

Тогда в prod-образе (без `LOG_PRETTY`) — JSON-логи, `pino-pretty` не нужен.
Локально: `$env:LOG_PRETTY="true"; pnpm dev`.

> **Исторически (см. «Исторические заметки»):** пакеты `dotenv`, `pino-pretty`,
> `ws` были в `devDependencies`, а Dockerfile ставил `--prod`. Это решено в
> `I.10.04.01` — переносом в `dependencies`. Если снова словишь
> `Cannot find package 'X'` в контейнере, но `X` импортируется из `src/**` —
> проверь `package.json`, `pnpm install`, пересобери без кеша.

---

## Запуск API

### A1. Зомби-процессы `pnpm dev` на `:3000`

**Симптом:** запускаешь `pnpm dev`, но часть запросов уходит в «старый» сервер,
логи неконсистентны, изменения кода применяются через раз.
`netstat` показывает 4 PID на `:3000`.

**Причина:** от прошлых запусков остались процессы `node`/`tsx`/`vite`/`pnpm`,
которые не были корректно остановлены (Ctrl+C не всегда убивает
дочерние процессы в Windows). Все они конкурируют за `:3000`, и запросы
распределяются случайно.

**Диагностика:**

```powershell
netstat -ano | findstr ":3000"
Get-Process node,tsx,vite,pnpm -ErrorAction SilentlyContinue
```

**Фикс:**

```powershell
Get-Process node,tsx,vite,pnpm -ErrorAction SilentlyContinue | Stop-Process -Force
```

Затем — чистый запуск:

```powershell
pnpm dev
```

`launch_workspace.py` делает `taskkill` при старте — но если api
запускается вручную, пригодится и руками.

---

### A2. api в бесконечном `Restarting` с `exit code 1`

**Симптом:** `docker compose ps` показывает `charter-api Restarting (1)`,
в логах — одна и та же ошибка при каждом рестарте.

**Причина:** `restart: unless-stopped` + `set -e` в entrypoint.
Приложение падает → контейнер перезапускается → падает снова.

**Диагностика — прочитать верхнюю ошибку, не отвлекаясь на повторы:**

```powershell
docker compose -f docker/docker-compose.yml logs api --tail 200 |
  Select-String -Pattern "Error|FAIL|FATAL" -Context 2,5
```

**Фикс:** остановить api и починить первопричину.

```powershell
docker compose -f docker/docker-compose.yml stop api
# починить
docker compose -f docker/docker-compose.yml --profile api up -d api
```

**Временно (только на dev):** в `docker-compose.yml` заменить
`restart: unless-stopped` на `restart: "no"` — тогда упадёт и остановится,
не будет засорять логи.

---

### A3. `Error: listen EADDRINUSE :::3000`

**Причина:** порт 3000 занят — либо повисшим node с прошлого запуска (см. A1),
либо Docker-контейнером `charter-api` (см. D1), либо другим приложением.

**Фикс:**

```powershell
# Кто держит порт
netstat -ano | findstr ":3000"

# Убить конкретный PID
Stop-Process -Id <PID> -Force

# Или — разом все dev-процессы
Get-Process node,tsx,vite,pnpm -ErrorAction SilentlyContinue | Stop-Process -Force
```

Если порт держит `com.docker.backend` — это `charter-api`, см. D1.

---

### A4. API слушает, но healthcheck фейлится

**Симптом:** `charter-api Up X seconds (unhealthy)`.

**Причина:** `HEALTHCHECK` в Dockerfile идёт на `/health/live`. Если роут
не зарегистрирован или возвращает не-200 — unhealthy.

**Проверка вручную:**

```powershell
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
curl http://localhost:3000/version
```

Если `/health/live` возвращает 200, а docker говорит unhealthy — параметры
healthcheck слишком строгие (`interval`, `start-period`, `retries`).
Увеличить `start-period` до 30–40 с.

---

### A5. `redisPub: connection error` / `ECONNREFUSED :6379`

**Симптом:** api стартует, но в логах спам `redis: connection error`,
`redisPub: connection error`, `redisSub: connection error`.

**Причина:** Redis-контейнер не поднят. `ioredis` с
`retryStrategy: (t) => Math.min(t * 200, 3000)` будет пытаться
переподключиться и логировать каждый сбой.

**Фикс:**

```powershell
docker compose -f docker/docker-compose.yml up -d redis
```

API сам переподключится в течение 3 секунд после старта Redis. Если
спам продолжается — проверить порт:

```powershell
netstat -ano | findstr ":6379"
```

Если Redis жив, но API на хосте не может достучаться —
проверить `REDIS_URL` в `.env`. Для работы на хосте: `redis://localhost:6379`.
Для работы в контейнере: `redis://redis:6379`.

---

## БД и миграции

### B1. `relation "auth_sessions" already exists`

**Симптом:** `003_tables.sql ... FAIL` при первом прогоне миграций.

**Причина:** в БД `charter` остались таблицы от прошлых экспериментов.
001 и 002 идемпотентны (`IF NOT EXISTS`, `DO ... EXCEPTION`) и проходят,
003 написан без `IF NOT EXISTS` — падает на первой существующей таблице.

**Фикс — сбросить `public`-схему (dev only!):**

```powershell
docker compose -f docker/docker-compose.yml exec postgres `
  psql -U charter -d charter `
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
```

Если ругается `must be owner of schema public` — от `postgres`:

```powershell
docker compose -f docker/docker-compose.yml exec postgres `
  psql -U postgres -d charter `
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"
```

Затем:

```powershell
pnpm db:migrate
```

> Не пытаться «пометить 003 как применённую» — остальные миграции упадут.

---

### B2. `017_seed_widgets.sql ... FAIL: Нет активных участников`

**Симптом:** миграции 001–016 проходят, 017 падает.

**Причина:** по замыслу. `017` вставляет виджеты с `created_by = <participant>`,
а участников нет.

**Фикс — создать Архитектора, затем повторить migrate:**

```powershell
pnpm tsx scripts/ensure-architect.ts
pnpm db:migrate
```

**Проверка:**

```powershell
pnpm db:migrate -- --dry-run
# → Нет неприменённых миграций
```

---

### B3. `update or delete on table "participants" violates foreign key constraint "widgets_created_by_fkey"`

**Симптом:** `ensure-architect.ts` пытается удалить placeholder-Архитектора,
FK из `widgets` не пускает.

**Причина:** `widgets.created_by → participants.id` без `ON DELETE CASCADE`.
10 сидовых виджетов ссылаются на placeholder.

**Фикс:** не удалять, а **обновлять**. В `ensure-architect.ts` при
обнаружении placeholder-пароля делать `UPDATE participants SET ...`,
а не `DELETE`. Актуальная версия скрипта так и делает.

---

### B4. `rights_matrix: []` в `/permissions/matrix`

**Симптом:** роут `/permissions/matrix` отвечает `{ entries: [] }`,
хотя миграции прогнаны, а UI ожидает сотни записей.

**Причина A:** миграция с seed'ом прав не прогналась. Проверить:

```sql
SELECT COUNT(*) FROM roles;              -- ожидается ~113
SELECT COUNT(*) FROM rights_matrix;      -- ожидается сотни
SELECT version FROM schema_migrations ORDER BY version;  -- до 0xx
```

**Причина B:** таблица `roles` пуста — тогда JOIN в `listRightsMatrix`
вернёт пусто, даже если `rights_matrix` заполнена.

**Причина C:** в `rights_matrix` используется `role_id`, которого нет в
`roles`, либо роль называется не так, как в enum `Role` — фильтрация
`isRoleString` в `listRightsMatrix` такие строки отбросит.

**Фикс:**

```powershell
# Прогнать миграции
pnpm db:migrate

# Проверить наполнение
docker compose -f docker/docker-compose.yml exec postgres `
  psql -U charter -d charter `
  -c "SELECT COUNT(*) FROM rights_matrix rm JOIN roles r ON r.id = rm.role_id;"
```

Если `rights_matrix` пуста — либо миграция 015 не прогналась, либо seed
не сработал (проверить в `db/migrations/`).

**Кэш:** если данные в БД появились, но эндпоинт всё ещё отвечает `[]` —
инвалидировать кэш матрицы:

```powershell
# Из node/tsx
import { invalidateRightsMatrixCache } from './src/core/rights.js';
await invalidateRightsMatrixCache();
```

Или просто подождать 30 секунд — TTL ключа `rights:matrix:v2`.

---

### B5. `db_replica: "fail"` в `/health/ready`

**Симптом:** `/health/ready` отвечает 503 (или отдаёт
`checks.db_replica: "fail"`), хотя всё работает.

**Причина:** `DATABASE_REPLICA_URL` не задан → реплика указывает на тот же
хост, что primary → проверка `pg_last_xact_replay_timestamp()` возвращает
`NULL` (для primary нет WAL-replay), health-чек считает это провалом.

Это не баг для dev — в dev реплика не нужна. Для prod:

- либо задать `DATABASE_REPLICA_URL` на реальную реплику;
- либо в health-модуле при `DATABASE_REPLICA_URL === DATABASE_URL`
  пропускать проверку реплики (считать `"ok"`).

Пока — игнорировать в dev.

---

## ESLint / TypeScript

### TS1. ESLint 9: `couldn't find eslint.config.js`

**Симптом:** `pnpm lint` падает с этим сообщением.

**Причина:** ESLint 9 перешёл на flat config (`eslint.config.mjs`).
Старый `.eslintrc.json` он больше не ищет.

**Фикс A (правильный): миграция на flat config.**

Создать `eslint.config.mjs`:

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ...
);
```

Удалить `.eslintrc.json` и `.eslintignore` (в flat config они не работают).

**Фикс B (быстрый): принудительно включить старый режим:**

```powershell
$env:ESLINT_USE_FLAT_CONFIG="false"
pnpm lint
```

Или в `package.json`:

```json
"scripts": {
  "lint": "cross-env ESLINT_USE_FLAT_CONFIG=false eslint ."
}
```

Это временная мера — в ESLint 10 старый режим уберут.

---

### TS2. ESLint 9: 3500+ фантомных ошибок (`no-undef`, `import/no-unresolved`)

**Симптом:** после перехода на flat config `pnpm lint` выдаёт тысячи
предупреждений `no-undef` на `console`, `process`, `Buffer`, а
`import/no-unresolved` ругается на `.js`-импорты, которые резолвятся в `.ts`.

**Причина:** правила из базового `recommended` не знают, что мы в TS-мире.
`no-undef` дублирует `tsc`, а `import/no-unresolved` не понимает
`moduleResolution: "NodeNext"`.

**Фикс:** отключить в flat config для TS-файлов:

```js
export default tseslint.config(
  {
    files: ['**/*.ts'],
    rules: {
      'no-undef': 'off',                 // включено в tsc
      'import/no-unresolved': 'off',     // .js → .ts резолвит tsc
    },
  },
);
```

`no-undef` не нужен в TS вообще — `tsc` ловит несуществующие идентификаторы
на этапе компиляции. `import/no-unresolved` не понимает `.js`-расширения,
которые в ESM+TS указывают на `.ts`-исходники.

---

### TS3. `tsconfig.json` без `extends` — рассинхрон с базой

**Симптом:** локально билд проходит, в docker — падает на type-error,
или paths-алиасы не работают в одной из конфигураций.

**Причина:** `tsconfig.json` не наследует `tsconfig.base.json`, из-за чего
`strict`, `target`, `module`, `moduleResolution`, `paths` могут отличаться.

**Фикс:** привести `tsconfig.json` к:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

**Проверить итоговый merged-конфиг:**

```powershell
pnpm tsc --showConfig
```

Сравнить с `tsconfig.base.json` — все ключевые поля должны совпадать.

---

## Runtime (tsx, cmd, PowerShell)

### R1. `tsx -e` и top-level await

**Симптом:**

```text
Top-level await is currently not supported with the "cjs" output format
```

**Причина:** `tsx -e "..."` исполняет код в CJS-контексте, top-level
await в нём не поддерживается.

**Фикс A:** обернуть в async-IIFE:

```powershell
pnpm tsx -e "(async () => { const r = await fetch('http://localhost:3000/health/live'); console.log(await r.text()); })()"
```

**Фикс B (предпочтительный):** положить код в файл и запустить его:

```powershell
pnpm tsx scripts/check-health.ts
```

В файле `.ts` с `import` (ESM) top-level await работает.

---

### R2. `tsx -e` без `import 'dotenv/config'`

**Симптом:** падает на `ENCRYPTION_KEY must be set (base64, 32 bytes)`
или другой переменной из `.env`.

**Причина:** ESM выполняет `import` раньше кода `-e`. Если `-e`-код
тянет `src/security/encryption.ts`, то модуль выполнится до того, как
`process.env` наполнится из `.env`.

**Фикс:** первой строкой `-e`-скрипта:

```powershell
pnpm tsx -e "import 'dotenv/config'; import { encryptField } from './src/security/encryption.js'; console.log(encryptField('test'))"
```

`dotenv/config` — тоже ESM-import, но грузится **до** остальных и
наполняет `process.env`.

**Фикс для файла:** то же самое — `import 'dotenv/config';` первой строкой.

---

### R3. `cmd for /f "delims=="` режет значение по `=`

**Симптом:** читаешь `.env.tokens` через `for /f "tokens=2 delims=="`,
для JWT всё ок, для base64-ключей (в значении есть `=`) — обрезается
хвост.

**Причина:** `delims==` заставляет cmd использовать `=` как разделитель
полей. `tokens=2` берёт только второе поле, всё после второго `=` теряется.

**Фикс A (cmd):** использовать `tokens=2*` (звёздочка = «остаток строки»):

```bat
for /f "tokens=2* delims==" %%A in (.env.tokens) do set TOKEN=%%B
```

Или ещё проще — `tokens=1*`:

```bat
for /f "tokens=1* delims==" %%A in (.env.tokens) do set TOKEN=%%B
```

**Фикс B (PowerShell):**

```powershell
$line = Get-Content .env.tokens | Where-Object { $_ -match '^API_TOKEN=' }
$token = $line.Substring($line.IndexOf('=') + 1)
```

Работает одинаково для JWT и base64.

---

### R4. PowerShell vs cmd — разный синтаксис

**Симптом:** команда работает в одном шелле и не работает в другом.

**Различия, которые больнее всего:**

| Задача | cmd | PowerShell |
|---|---|---|
| Env var | `set FOO=bar` | `$env:FOO="bar"` |
| Читать env | `%FOO%` | `$env:FOO` |
| Перенос строки | `^` | `` ` `` (обратный апостроф) |
| Строка с кавычками | `"..."` | `"..."` / `'...'` (по-разному раскрывается) |
| For / foreach | `for /f ...` | `foreach (...) { }` |
| Pipe | `\|` | `\|` (но семантика объектов иная) |

> **Правило:** не смешивать. Один скрипт — один шелл. Если нужен
> универсализм — писать на Node.

**Фикс (перевести cmd → PowerShell):**

```powershell
# cmd: for /f "tokens=2 delims==" %%A in (.env.tokens) do set TOKEN=%%B
$token = (Get-Content .env.tokens | Select-String '^API_TOKEN=').ToString().Split('=',2)[1]
```

---

### R5. Кириллица в `.bat` → кракозябры (`╨Я╨╛╨┤╨╜╨╕╨╝╨░╤О`)

**Причина:** cmd.exe по умолчанию читает bat в `cp866`, а файл сохранён
в UTF-8.

**Фикс:** добавить в начало bat:

```bat
@echo off
chcp 65001 > nul
```

И сохранять файл в **UTF-8 без BOM**.

Альтернатива: сохранять bat в `cp866` — тогда `chcp` не нужен, но
редакторы на Windows по умолчанию UTF-8.

**Специфика `.env.tokens`:** если bat читает значения из `.env.tokens`
через `for /f`, а в токенах есть кириллица (комментарии, имена) — нужно,
чтобы `.env.tokens` тоже был в UTF-8, а `chcp 65001` стоял до первого
чтения.

---

## Auth

### AU1. `TOKEN_EXPIRED` через 15 минут

**Симптом:** через 15 минут после логина все запросы возвращают
`TOKEN_EXPIRED`.

**Причина:** access-токен имеет TTL 15 минут (нормально для безопасности).
Нужно периодически обновлять через refresh-токен.

**Фикс:** есть скрипт `pnpm token:refresh` (он же `login-architect.ts --force`).
Он логинится заново и обновляет `.env.tokens`.

Для автоматизации — добавить в `launch_workspace.py` таймер или периодически
запускать руками:

```powershell
pnpm token:refresh
```

> Не пытаться увеличить TTL access-токена в `auth.controller.ts` —
> это ослабит безопасность. Refresh-флоу — правильный путь.

---

### AU2. `INVALID_TOKEN` с валидным токеном

**Симптом:** копируешь токен из `.env.tokens`, подставляешь в
`Authorization: Bearer <token>`, а сервер отвечает `INVALID_TOKEN`.

**Причина A:** в `Bearer <token>` попал лишний хвост — например, склеились
access + refresh, или остался пробел/кавычка.

**Причина B:** токен передаётся в кавычках, а сервер не срезает их:
`Authorization: Bearer "abc.def.ghi"` вместо `Bearer abc.def.ghi`.

**Диагностика:**

```powershell
$token = "..."  # вставить
$token.Length
# Сравнить с длиной из .env.tokens
```

**Фикс:** в `Bearer <access>` не должно быть кавычек, пробелов в начале/конце,
склеенных токенов. Проверить в `.env.tokens`:

```powershell
Get-Content .env.tokens | Select-String 'API_TOKEN'
```

`API_TOKEN=` до конца строки — это одно значение. Если JWT — три части,
разделённые точками. Никаких `=`, кроме `API_TOKEN=`, быть не должно.

---

### AU3. `ENCRYPTION_KEY must be set (base64, 32 bytes)`

**Симптом:** `ensure-architect.ts` (или любой скрипт, тянущий
`src/security/**`) падает на верхнем уровне модуля до `main()`.

**Причина:** ESM выполняет `import` **раньше** кода `main()`.
`src/security/encryption.ts` читает `process.env.ENCRYPTION_KEY` на
верхнем уровне. Если `.env` ещё не прочитан — падает.

**Фикс:** добавить первой строкой файла:

```ts
import 'dotenv/config';
```

**Проверить, что в `.env` есть:**

```text
ENCRYPTION_KEY=<base64, 32 bytes>
PHONE_HASH_KEY=<base64, 32 bytes>
```

**Сгенерировать, если пусто:**

```powershell
node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
```

**Проверка, что ключ декодируется ровно в 32 байта:**

```powershell
node -e "const b = Buffer.from('вставить_ключ', 'base64'); console.log('bytes:', b.length, b.length === 32 ? 'OK' : 'FAIL')"
```

---

## Bootstrap и логин

### BS1. `Архитектор уже существует: <uuid>`

**Причина:** в БД уже есть participant с `is_first_architect = true`.

**Фикс:** не удалять вслепую (см. B3). Использовать `ensure-architect.ts`:
он сам определит состояние и обновит либо не тронет.

```powershell
pnpm tsx scripts/ensure-architect.ts
```

**Проверить текущее состояние:**

```powershell
docker compose -f docker/docker-compose.yml exec postgres `
  psql -U charter -d charter `
  -c "SELECT external_id, name, status, is_first_architect FROM participants;"
```

---

### BS2. Логин возвращает `401 Unauthorized`

**Причина A:** неверный пароль.

**Причина B:** у Архитектора placeholder-пароль (`$argon2id$placeholder`),
и `argon2.verify` не сходится.

**Проверка:**

```sql
SELECT external_id, password_hash FROM participants WHERE is_first_architect = true;
```

Если `password_hash` начинается с `$argon2id$placeholder` — Архитектор
создан вручную через SQL, пароль нерабочий.

**Фикс:**

```powershell
pnpm tsx scripts/ensure-architect.ts
```

Скрипт заменит placeholder-хеш на настоящий argon2 от `ChangeMe123456`.

---

### BS3. Логин возвращает `404 Not Found`

**Причина:** роут `/auth/login` не зарегистрирован. Скорее всего
`src/api/auth/controller.ts` не подключён в `src/server.ts`.

**Диагностика:**

```powershell
findstr /S "registerAuthRoutes" src
findstr /S "/auth/login" src
```

Проверить, что `registerAuthRoutes(app)` вызывается в `src/server.ts`.

---

## launch_workspace.py

### L1. Скрипт требует прав администратора

**Причина:** `SetParent` и `SetConsoleFont` требуют админа.

**Фикс:** скрипт сам вызовет UAC и перезапустится — просто подтвердите.

Если UAC отключён в системе — запускать из-под админ-консоли:

```powershell
Start-Process python -ArgumentList "scripts\launch_workspace.py" -Verb RunAs
```

---

### L2. Окна не внедряются, в плитках висит «Ожидание окна N»

**Причина A:** `cmd.exe` стартовал раньше, чем `launch_workspace.py`
успел начать поиск окон. Таймер `try_embed_windows` крутится каждые 500 мс,
обычно ловит.

**Причина B:** `cmd.exe` не успел создать окно к моменту первого тика.

**Фикс A:** подождать 5–10 секунд, потом нажать в меню «Процессы →
Запустить все». Скрипт пересоздаст окна и попробует снова.

**Фикс B:** увеличить интервал таймера в `launch_workspace.py`:

```python
self.embed_timer.start(1000)  # было 500
```

**Причина C:** антивирус блокирует `SetParent`. Добавить
`python.exe` и `cmd.exe` в исключения.

**Причина D (свежая):** если при запуске было 4 зомби-процесса на `:3000`
(см. A1), workspace мог «прицепиться» не к тому окну. Перед запуском
убедиться, что все `node`/`tsx`/`vite` убиты.

---

### L3. Кириллица в окнах workspace — кракозябры

См. R5. `xartia-ops.bat` надо `chcp 65001`. Автогенерируемые bat-файлы
из `launch_workspace.py` уже пишутся в `cp866` — там проблемы нет.

---

### L4. Окно `xartia-db` сразу закрывается с ошибкой соединения

**Причина:** postgres ещё поднимается, или контейнер не запущен.

**Фикс:** `xartia-ops` в соседней плитке поднимает стек. Подождать 5–10 сек,
нажать Enter в окне `xartia-db` — он `/k`, команда останется в истории.

Или перезапустить workspace (меню «Процессы → Остановить все», затем
«Запустить все»).

---

## Web / Vite

### W1. `pnpm dev:web` падает на пустом импорте

**Причина:** в `src/web/pages/**` есть пустые файлы. Импорт пустого
модуля не всегда ошибка, но `import Foo from './empty'` без `export` — да.

**Диагностика:**

```powershell
# Найти пустые .tsx в pages
Get-ChildItem src\web\pages -Recurse -File |
  Where-Object { $_.Length -eq 0 } |
  Select-Object FullName
```

**Фикс:** либо заполнить файлы содержимым, либо временно убрать из
`App.tsx` роутинг на пустые страницы.

---

### W2. Vite не проксирует `/api` на бэкенд

**Причина:** в `vite.config.ts` нет или неверный `proxy`.

**Фикс:**

```ts
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
```

---

### W3. CORS-ошибка в браузере

**Симптом:** консоль браузера `blocked by CORS policy`.

**Причина:** фронт на `:5173`, api на `:3000`. Если фронт ходит напрямую
(не через Vite proxy) — нужен CORS на api.

**Фикс A:** использовать Vite proxy (см. W2) и ходить на относительный
`/api/...` — тогда CORS не нужен.

**Фикс B:** в `src/server.ts` убедиться, что `@fastify/cors` зарегистрирован
с `origin: true` для dev:

```ts
await app.register(cors, { origin: true, credentials: true });
```

---

## WebSocket

### WS1. `pnpm tsx src/ws/server.ts` падает на `Cannot find package 'ws'`

**Причина:** `ws` был в `devDependencies`, а Dockerfile ставит `--prod`.

**Проверка:**

```powershell
findstr /N "from 'ws'" src\ws\server.ts
```

**Фикс:** если `ws` импортируется из `src/**` — перенести в
`dependencies`, `pnpm install`, пересобрать образ без кеша.

> **Историческая заметка:** см. блок «Исторические заметки» в конце — было
> в `I.10.04.01`.

---

### WS2. WS-сервер не принимает подключения на `:3001`

**Проверка:**

```powershell
netstat -ano | findstr ":3001"
Test-NetConnection -ComputerName localhost -Port 3001
```

Если порт закрыт — сервер не слушает. Смотреть логи в окне `xartia-ws`.

Если порт занят другим процессом:

```powershell
Stop-Process -Id <PID> -Force
```

---

## Быстрая диагностика

### Состояние всего стека

```powershell
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs api --tail 50
docker compose -f docker/docker-compose.yml logs postgres --tail 30
```

### Состояние БД

```sql
-- Из psql (окно xartia-db или через exec)
SELECT COUNT(*) FROM participants;
SELECT COUNT(*) FROM directions;         -- ожидается 17
SELECT COUNT(*) FROM roles;              -- 112 (8 × 14)
SELECT COUNT(*) FROM rights_matrix;      -- сотни
SELECT COUNT(*) FROM widgets;            -- 10 после ensure-architect
SELECT version FROM schema_migrations ORDER BY version;  -- 001..017
```

### Проверка Архитектора

```sql
SELECT p.external_id, p.name, p.status, r.name AS role
FROM participants p
LEFT JOIN participant_roles pr ON pr.participant_id = p.id AND pr.status = 'active'
LEFT JOIN roles r ON r.id = pr.role_id
WHERE p.is_first_architect = true;
```

Ожидание:

```text
 external_id |       name        | status |      role
-------------+-------------------+--------+------------------
 А00001-1    | Первый Архитектор | master | FIRST_ARCHITECT
```

### Проверка api

```powershell
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready

# Логин
$body = @{ phone = "+79001234567"; password = "ChangeMe123456" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5
```

### Проверка прав

```powershell
# Матрица должна быть непустой
curl http://localhost:3000/permissions/matrix -H "Authorization: Bearer $env:API_TOKEN"

# Если пусто — см. B4
```

### Полный сброс (dev)

```powershell
# 1. Остановить всё
docker compose -f docker/docker-compose.yml --profile api --profile ws down

# 2. Убить node
Get-Process node,tsx,vite,pnpm -ErrorAction SilentlyContinue | Stop-Process -Force

# 3. Снести volume БД (ОПАСНО — все данные потеряются)
docker volume rm charter-pg-data
docker volume rm charter-redis-data
# MinIO volume не трогаем — там бакеты

# 4. Поднять инфру
docker compose -f docker/docker-compose.yml up -d postgres redis minio

# 5. Миграции + Архитектор
pnpm db:migrate
pnpm tsx scripts/ensure-architect.ts
pnpm db:migrate   # до-накатить 017
```

### Очистка Docker (если что-то совсем сломалось)

```powershell
# Незапущенные контейнеры + висячие образы + неиспользуемые сети
docker system prune -a

# Только тома конкретного проекта
docker volume ls | findstr charter
```

> **Осторожно:** `docker system prune -a` снесёт все неиспользуемые образы,
> включая закешированные `node:22-alpine`, `postgis/postgis:15-3.4` — при
> следующем билде будут тянуться заново.

---

## Что НЕ надо делать

- **Не удалять `participants` через SQL**, если на него ссылаются виджеты,
  сессии, аудит — словите FK-ошибку. Использовать `ensure-architect.ts`.
- **Не менять `package.json` без `pnpm install`** — `--frozen-lockfile`
  увидит расхождение, либо (хуже) поставит старую версию из lock.
- **Не добавлять `--no-cache`** в билд «на всякий случай». Это единственный
  способ обойти кеш, но каждый билд будет по 30+ секунд вместо 3.
- **Не редактировать `003_tables.sql`** на проде. Если нужны изменения —
  новая миграция (018, 019, ...).
- **Не коммитить `.env`** — он в `.gitignore`, но проверять `git status`.
- **Не поднимать `docker compose api` и `pnpm dev` одновременно** — они
  дерутся за `:3000` (см. D1, A3). Выбрать одно.
- **Не менять TTL access-токена вверх** — 15 минут это правильно. Refresh
  через `pnpm token:refresh`.
- **Не хранить `ENCRYPTION_KEY` в `.env` рядом с prod-данными** — для prod
  через Vault (см. S.0.01.04).

---

## Исторические заметки

Материалы, которые были актуальны раньше, но потеряли смысл после правок.
Оставлены как контекст «почему так сделано».

**`dotenv` / `pino-pretty` / `ws` в devDependencies** (было T2, T17). Решено
в `I.10.04.01`: перенесены в `dependencies`, lock перегенерирован.
`Dockerfile.api` ставит `--prod`, а эти пакеты импортируются из `src/**`.
Если снова увидишь `Cannot find package 'X'` в контейнере для пакета,
импортируемого из `src/**` — проверь `package.json`, `pnpm install`,
пересобрать без кеша.

**`quay.io/minio` vs `bitnami/minio` в dev** (было T5). Текущий
`docker-compose.yml` использует `coollabsio/minio` (Docker Hub) — для dev
проблема не воспроизводится. Для prod — см. D2.

---

## Лог изменений

- **2026-10-12** — Первая версия. Составлено по итогам bootstrap-сессии:
  Docker-билд, миграции 001–017, bootstrap Архитектора, launch_workspace.
- **2026-10-15** — Реструктуризация. Новая таксономия (D/A/B/TS/R/AU/BS/L/W/WS).
  Добавлены: charter-api vs pnpm dev, зомби-процессы на :3000, ESLint 9
  flat config, phantom errors, tsconfig без extends, tsx -e TLA, cmd for /f
  с =, PowerShell vs cmd, Redis ECONNREFUSED, db_replica fail,
  rights_matrix пусто, TOKEN_EXPIRED, INVALID_TOKEN. Перенесены в
  «Исторические заметки»: dotenv в devDeps, quay.io для dev.

Правки — через PR, не редактировать втихую.

### A6. `POST /universal-runs/:id/responses` → 500 с `column "status" is of type run_status_enum but expression is of type text`

**Симптом:** после пересборки api с B1–B6 `submitRunResponse`
возвращает 500, при этом `/signals/:id/responses` (тот же INSERT в
`responses`, но `run_id = NULL`) работает. В логах api:

    error: column "status" is of type run_status_enum but expression is of type text

**Причина:** атомарный `UPDATE universal_runs SET status = CASE WHEN ...
THEN 'aggregated' ELSE 'collecting' END`. `CASE` возвращает `text`,
Postgres не делает неявный text → enum в SET-выражении (только в INSERT
для литерала, но не для CASE). Транзакция откатывается целиком, поэтому
INSERT в `responses` тоже откатывается — отсюда пустая таблица и `500`
на первый (не дублирующий) ответ.

**Фикс:** явный каст:
```sql
status = (CASE WHEN ... THEN 'aggregated' ELSE 'collecting' END)::run_status_enum

«Что НЕ надо делать»:

- **Не полагаться на неявный `text → enum` в `UPDATE ... CASE`.** В `INSERT VALUES ('literal')` работает, в `CASE ... END` — нет. Всегда `::enum_type`.

## Почему это не поймал `tsc`

`client.query<...>('SQL string', [...])` — SQL не типизирован. `tsc` видит только строку и параметры. Ошибка — в рантайме Postgres. Единственная защита — либо тест (что и сработало), либо `pg`-драйвер с шаблонными запросами (не твой случай).

Этот класс ошибок — «SQL-строка правильная по смыслу, но сломана по типам» — ловится только интеграционным тестом. У тебя он есть, он и поймал.