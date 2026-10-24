# Cron-задачи XartIA (I.3.05.*)

Cron в XartIA — **децентрализован**. Единого планировщика в приложении нет.
Вместо этого:

- **Расписание** — в K8s CronJob (`k8s/worker/*.yml`).
- **Логика** — в HTTP-эндпоинтах API, защищённых `requireRight`.
- **Транспорт** — K8s CronJob дёргает эндпоинт через `curl` (или другой HTTP-клиент).

Это даёт:

- **Единый аудит** — каждая задача попадает в `audit_log` через обычный сервисный слой.
- **Отсутствие «магических» cron-скриптов** — вся логика в `src/core/*/service.ts`.
- **Простое тестирование** — можно вызвать эндпоинт вручную через `curl`/`pnpm tsx scripts/...`.
- **Горизонтальное масштабирование** — N реплик API + `concurrencyPolicy: Forbid` в CronJob гарантируют один запуск.

## Соглашения

### Именование

- **CronJob id** — `I.3.05.NN` (спецификация), дублируется в `metadata.labels.cron-id`.
- **Имя CronJob** — `<domain>-<action>[-<frequency>]`, напр. `psy-mood-aggregate-hourly`.
- **Namespace** — `xartia`.
- **Файл** — `k8s/worker/<domain>-<action>.yml`.

### Эндпоинт

- Метод: **`POST`** (даже если идемпотентно — единообразие).
- Путь: `/<domain>/<action>` — например, `POST /psy/mood/aggregate`.
- Права: **`requireRight('<resource>', 'Act')`** — «Act» — это доменное действие
  для машины. См. `C.0.01.06 FALLBACK_PERMISSIONS` и `rights_matrix`.
- Тело: JSON, обычно `{}` или `{ "period": "hour" }`.
- Ответ: JSON с полем `"errors": N` (0 — успех), остальное — диагностика.

### Аутентификация

CronJob логинится через `/auth/login` **сервисным участником** — каждая
задача имеет свой участник с ограниченной ролью. Пароль — в K8s Secret.

Не используйте:

- Личный токен Архитектора — TTL 15 минут, истёк → 401.
- Долгоживущие access-токены — их нет и не будет.
- Отключение auth на cron-эндпоинтах — открывает дверь для DoS.

### Образ

`curlimages/curl:8.10.1` — минимальный, ~2 MB, поддерживается.

### Hardening (стандартный набор)

```yaml
concurrencyPolicy: Forbid
activeDeadlineSeconds: 120        # или 180, если логика долгая
startingDeadlineSeconds: 300      # не запускать пропущенные >5 мин
backoffLimit: 2                   # 1 retry
successfulJobsHistoryLimit: 3
failedJobsHistoryLimit: 3
# + в контейнере:
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 1000
```

## Реестр задач

- **I.3.05.12** — файл: `cronjob-connectivity-timeouts.yml`; расписание: `*/5 * * * *`; эндпоинт: `POST /connectivity/check-timeouts`; право: `(auth only)`; токен: `service-worker`.
- **I.3.05.02** — файл: `cronjob-universal-runs-timeouts.yml`; расписание: `*/5 * * * *`; эндпоинт: `POST /universal-runs/check-timeouts`; право: `signal:Act`; токен: `service-worker`.
- **I.3.05.03** — файл: `cronjob-mandates-expired.yml`; расписание: `0 * * * *`; эндпоинт: `POST /mandates/process-expired`; право: `mandate:Act`; токен: `service-worker`.
- **I.3.05.05** — (зарезервировано).
- **I.3.05.06** — файл: `cronjob-psy-mood.yml`; расписание: `0 * * * *` + `0 3 * * *`; эндпоинт: `POST /psy/mood/aggregate`; право: `psy_session:Act`; токен: `xartia-psy-cron`.
- **I.3.05.07** — файл: `cronjob-automation.yml`; расписание: `0 4 * * *`; эндпоинт: `POST /automation/run-daily-audit`; право: `automation:Act`; токен: `xartia-automation-cron`.
- **I.3.05.08** — файл: `cronjob-webhooks-retry.yml`; расписание: `* * * * *`; эндпоинт: `POST /webhooks/process-retries`; право: `webhook:Act`; токен: `xartia-webhooks-cron`.
| I.3.05.09 | `cronjob-aggregator.yml` | `0 2 * * *` | `POST /aggregator/process-daily` | `aggregator:Act` | `xartia-aggregator-cron` |
| I.3.05.10 | `cronjob-quanta-detect.yml` | `0 3 * * *` | `POST /quanta/process-daily` | `quantum:Act` | `xartia-quanta-cron` |
| I.3.05.11 | `cronjob-experiments-suspend.yml` | `0 4 * * *` | `POST /dissident-projects/process-suspensions` | `experiment:Act` | `xartia-experiments-cron` |
| I.3.05.12 | `deployment.yml` | Polling loop по `jobs` (FOR UPDATE SKIP LOCKED). Обрабатывает Exports (5 типов). Cleanup завершённых jobs (setInterval 24ч, >30 дней). | Deployment |
**Не путать с CronJob:** worker — постоянно работающий процесс, не K8s CronJob.


Cleanup внутри worker (I.3.05.12 отменён — не нужен отдельный cron).
**Список — источник правды.** При добавлении новой cron-задачи обновите его.

> **Примечание.** Строка `I.3.05.04` (`cronjob-automation-daily-audit.yml`) удалена:
> задача покрыта `I.3.05.07` с выделенным сервисным участником. Старый CronJob
> `cronjob-automation-daily-audit.yml` и Secret `service-worker`-скоуп для
> автоматизации — **deprecated**, удалить из кластера:
>
> ```powershell
> kubectl -n xartia delete cronjob automation-daily-audit
> ```

## Сервисные участники

Каждая группа cron-задач имеет своего сервисного участника с минимально
необходимыми правами. Не «супер-cron», а «один cron — один участник».

- **`service-worker`** — External ID: —; роль: смешанные; задачи: I.3.05.12–03; скрипт: (legacy, до перехода на per-task участников).
- **`xartia-psy-cron`** — External ID: `П90001-12`; роль: `PSY`; задачи: I.3.05.06; скрипт: `scripts/ensure-psy-cron.ts`.
- **`xartia-automation-cron`** — External ID: `А90002-12`; роль: `OPERATOR`; задачи: I.3.05.07; скрипт: `scripts/ensure-automation-cron.ts`.
- **`xartia-webhooks-cron`** — External ID: `В90003-01`; роль: `PROTOCOL_COUNCIL`; задачи: I.3.05.08; скрипт: `scripts/ensure-webhooks-cron.ts`.
| `xartia-aggregator-cron` | `Г90004-01` | `AGGREGATOR` | `I.3.05.09` | `scripts/ensure-aggregator-cron.ts` |
| `xartia-quanta-cron` | `К90005-01` | `NOOLOG` | `I.3.05.10` | `scripts/ensure-quanta-cron.ts` |
| `xartia-experiments-cron` | `Э90006-01` | `NOOLOG` | `I.3.05.11` | `scripts/ensure-experiments-cron.ts` |

> **Внимание.** External ID должен соответствовать CHECK-констрейнту
> `[А-Я]?\d{5}-\d{1,2}(:.+)?$`. Латиница (`CRON00001-12`) **не проходит** —
> используйте кириллический префикс (`К`, `В`) или чистые цифры.

### Создание сервисного участника

Пример для PSY-cron (PowerShell):

```powershell
# 1. Сгенерировать пароль.
$password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# 2. Создать / обновить участника (идемпотентно).
pnpm tsx scripts/ensure-psy-cron.ts $password

# 3. Положить пароль в K8s Secret.
kubectl create secret generic xartia-psy-cron `
  --namespace xartia `
  --from-literal=phone='+70000000001' `
  --from-literal=password=$password
```

То же для автоматизации:

```powershell
$password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
pnpm tsx scripts/ensure-automation-cron.ts $password
kubectl create secret generic xartia-automation-cron `
  --namespace xartia `
  --from-literal=phone='+70000000002' `
  --from-literal=password=$password
```

И для webhooks-retry:

```powershell
$pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
pnpm tsx scripts/ensure-webhooks-cron.ts $pass
kubectl create secret generic xartia-webhooks-cron `
  --namespace xartia `
  --from-literal=phone='+70000000003' `
  --from-literal=password=$pass
```

Скрипт `ensure-psy-cron.ts` делает self-check: логинится тем же
паролем через `/auth/login` и проверяет `/permissions/me`. Если у
участника нет нужного права — падает с подсказкой. Это ловит 90%
проблем до деплоя в K8s.

`ensure-automation-cron.ts` следует тому же паттерну: проверяет
наличие `automation:Act` у роли `OPERATOR`.

`ensure-webhooks-cron.ts` — аналогично: проверяет `webhook:Act`
у роли `PROTOCOL_COUNCIL`.

### Ротация пароля

```powershell
# 1. Новый пароль.
$new = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# 2. Обновить в БД.
pnpm tsx scripts/ensure-psy-cron.ts $new

# 3. Обновить в K8s (Secret перезаписывается).
kubectl -n xartia create secret generic xartia-psy-cron `
  --from-literal=phone='+70000000001' `
  --from-literal=password=$new `
  --dry-run=client -o yaml | kubectl apply -f -

# 4. (опц.) Форсировать запуск, не ждать следующего часа.
kubectl -n xartia create job --from=cronjob/psy-mood-aggregate-hourly psy-mood-manual-rot
kubectl -n xartia logs -f job/psy-mood-manual-rot
```

Для `xartia-automation-cron` — аналогично, только
`ensure-automation-cron.ts`, Secret `xartia-automation-cron` и CronJob
`automation-daily-audit`.

Для `xartia-webhooks-cron` — `ensure-webhooks-cron.ts`,
Secret `xartia-webhooks-cron` и CronJob `webhooks-retry`.

## Деплой

```powershell
# Применить все CronJob-ы.
kubectl apply -f k8s/worker/

# Проверить.
kubectl -n xartia get cronjob

# Посмотреть историю запусков.
kubectl -n xartia get jobs | findstr psy
kubectl -n xartia get pods | findstr psy
```

## Диагностика

### CronJob не запускается

```powershell
kubectl -n xartia describe cronjob psy-mood-aggregate-hourly
kubectl -n xartia get events --sort-by=.lastTimestamp | Select-Object -First 30
```

Типовые причины:

- **`no matches for kind "CronJob"`** — K8s <1.21, обновить или использовать `batch/v1beta1`.
- **`is forbidden`** — ServiceAccount, под которым запускается CronJob, не имеет прав
  на создание Pod'ов. Проверьте RBAC.
- **Схема некорректна** — `kubectl apply --dry-run=server -f <file>`.

### Job упал

```powershell
kubectl -n xartia get jobs
kubectl -n xartia logs job/psy-mood-aggregate-hourly-XXXXX
```

Ожидаемые строки:

```text
[cron] logging in as +70000000001
[cron] token acquired, calling /psy/mood/aggregate (period=hour)
[cron] response: {"processed":N,"created":M,"updated":K,"skipped":S,"errors":0,...}
[cron] OK
```

- **`[cron] ERROR: aggregate reported non-zero errors`** — смотри `"errors":N`
  в JSON. Значит API вернул 200, но внутри агрегации что-то падало
  (например, AVG на пустой выборке — но это не должно давать errors).

- **`login failed: HTTP 401`** — неверный пароль или participant удалён.
  Перезапустите `scripts/ensure-psy-cron.ts` и обновите Secret.

- **`login failed: HTTP 404`** — `/auth/login` не зарегистрирован.
  Проверьте `registerAuthRoutes(app)` в `src/server.ts`.

### Логи API во время cron

```powershell
docker compose -f docker/docker-compose.yml logs api --since 5m |
  Select-String "psy.mood.aggregate|psy_session"
```

Или в `audit_log`:

```sql
SELECT action, entity_type, entity_id, new_value, created_at
  FROM audit_log
 WHERE action = 'psy.mood.aggregate'
 ORDER BY created_at DESC
 LIMIT 10;
```

Ожидаемо: `actor_type = 'system'`, `new_value.processed = N`.

### Проверка, что агрегаты идут

```sql
-- За последние 24 часа должно быть ~24 записи (hourly) + 1 (daily).
SELECT date_trunc('hour', created_at) AS bucket,
       COUNT(*) AS records,
       MAX(value) AS max_value,
       MIN(value) AS min_value
  FROM mood_metrics
 WHERE created_at > now() - interval '24 hours'
 GROUP BY 1
 ORDER BY 1 DESC;
```

## Будущее

Со временем cron-механика может эволюционировать:

- **Service Account для API** — долгоживущий токен с жёстким скоупом.
  Требует поддержки `type: 'service'` в `S.0.01.01 jwt.ts`.
- **HMAC-подпись** — вместо токена `X-Signature: HMAC(timestamp, body, key)`.
- **Очередь задач (Kafka / Redis Stream)** — CronJob публикует, API-воркер читает.
  Правильнее, но требует отдельного слоя.

Пока login-flow — золотая середина: минимум кода, ротация через Secret,
полноценный `audit_log`.

## Ссылки

- **Спецификация:** `I.3.05.*` (id_2.md / spec).
- **Troubleshooting:** `TROUBLESHOOTING.md`, раздел «Запуск API» — про порты и зомби-процессы.
- **Паттерн-образцы:** `A.1.13.01 universal-runs/controller.ts` (`POST /check-timeouts`),
  `A.1.05.01 mandates/controller.ts` (`POST /process-expired`).
- **Права:** `C.0.01.06 src/core/rights.ts` (`FALLBACK_PERMISSIONS` + `rights_matrix`).
- **Аудит:** `C.0.01.05 src/core/audit.ts`.

## Что именно изменилось в этом патче

1. **Реестр задач:** добавлена строка `I.3.05.08` — `cronjob-webhooks-retry.yml`, `* * * * *`, `POST /webhooks/process-retries`, право `webhook:Act`, токен `xartia-webhooks-cron`.

2. **Сервисные участники:** добавлена строка `xartia-webhooks-cron` / `В90003-01` / `PROTOCOL_COUNCIL` / `I.3.05.08` / `scripts/ensure-webhooks-cron.ts`.

3. **Создание сервисного участника:** добавлен третий пример — `ensure-webhooks-cron.ts` + Secret `xartia-webhooks-cron` + phone `+70000000003`.

4. **Ротация пароля:** добавлено упоминание webhooks-cron.

5. **External ID приведены к CHECK-констрейнту** `[А-Я]?\d{5}-\d{1,2}(:.+)?$`:
   - `CRON00001-12` → `П90001-12`
   - `CRON00002-12` → `А90002-12`
   - `В90003-01` — валиден (кириллическая `В` + 5 цифр + `-01`).
   Добавлено предупреждение про латиницу.

6. **Все code fences закрыты** — исходник содержал незакрытые блоки YAML / PowerShell / SQL.

## Что тебе нужно проверить / сделать

1. **Написать `scripts/ensure-webhooks-cron.ts`** — по образцу `ensure-psy-cron.ts`. Заменить:
   - `TEST_EXTERNAL_ID = 'В90003-01'`;
   - роль на `PROTOCOL_COUNCIL`;
   - проверку права `requireRight('webhook', 'Act')` через `/permissions/me`.

2. **Phone `+70000000003`** — должен быть уникальным (`phone_hash UNIQUE` в `participants`).

3. **Роль `PROTOCOL_COUNCIL`** — убедиться, что она есть в seed `roles` и что
   `rights_matrix` содержит `webhook:Act`. Иначе `requireRight('webhook', 'Act')` вернёт 403.

4. **`cronjob-webhooks-retry.yml`** — манифест нужно сгенерировать по образцу
   `cronjob-psy-mood.yml`. Если нужен — сгенерирую.

5. **Роль `OPERATOR`** — проверить наличие `automation:Act` в `rights_matrix` (из предыдущего патча).