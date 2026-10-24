# k8s/ — Kubernetes-манифесты XartIA
Стратегия: **base + overlays**. Base — провайдер-agnostic, overlays — специфика окружения.
> **Текущий статус (2026-10-22, после Sessions 6–7):**
>
> - ✅ **base/** — применён в k3d, все 7 namespace, quota, limits, priorityclass
> - ✅ **overlays/k8s-test** — SMOKE OK (postgres, redis, minio, api, ws, web)
> - ✅ **NetworkPolicy (Session 6)** — 16 правил, default-deny работает вживую
> - ✅ **CronJobs (Session 7)** — 7 задач запускаются по расписанию, все `[cron] OK`
> - ✅ **SOPS-секреты** (`*.enc.yaml`) — в git; smoke использует `--from-literal` (TODO: переключить на `sops --decrypt`)
> - ⚠️ **overlays/dev, staging, prod** — не тестировались в реальном кластере
> - ⚠️ **rbac/, gateway/** — пустые заготовки (roadmap)
> - ⚠️ **worker** — в base/, в k8s-test overlay не включён (тестируется в Compose)
---
## Структура
k8s/
├── base/ # провайдер-agnostic
│ ├── namespace.yml # 7 namespace (xartia, -data, -gateway, registry, cert-manager, monitoring, longhorn-system)
│ ├── priorityclass.yml # xartia-critical / -default / -batch
│ ├── limitrange.yml # дефолтные requests/limits для каждого ns
│ ├── resourcequota.yml # суммарные квоты на ns
│ ├── kustomization.yml # includeTemplates: true — критично (см. грабли №2)
│ ├── postgres/ # StatefulSet + services + configmap + backup-cronjob
│ ├── redis/ # StatefulSet + services + configmap
│ ├── minio/ # StatefulSet + services (образ coollabsio/minio)
│ ├── api/ # Deployment + service + SA + configmap
│ ├── ws/ # Deployment + service (tsx src/ws/server.ts)
│ ├── worker/ # Deployment (polling loop; НЕ в k8s-test)
│ ├── web/ # Deployment + service (nginx-unprivileged)
│ └── network/ # NetworkPolicy: default-deny + 15 allow-* (Session 6, отдельный apply)
│
├── overlays/
│ ├── k8s-test/ # A+ валидация: изолированный ns, 1 реплика, local-path
│ │ ├── kustomization.yml
│ │ └── namespaces.yml # (legacy, smoke создаёт ns сам)
│ ├── dev/ # k3d + local-path
│ │ ├── kustomization.yml
│ │ └── secrets/*.enc.yaml # SOPS-шифрованные (age)
│ ├── staging/ # Linux-ноды + longhorn-r2
│ └── prod/ # Linux-ноды + longhorn-r3 + PDB + HPA
│
├── longhorn/ # StorageClass'ы (ТОЛЬКО staging/prod, не для k3d)
│ ├── storageclass-r1.yml
│ ├── storageclass-r2.yml
│ └── storageclass-r3.yml
│
├── worker/ # CronJob-манифесты (Session 7)
│ ├── cronjob-psy-mood.yml # I.3.05.06 (hourly + daily)
│ ├── cronjob-automation.yml # I.3.05.07
│ ├── cronjob-webhooks-retry.yml # I.3.05.08
│ ├── cronjob-aggregator.yml # I.3.05.09
│ ├── cronjob-quanta-detect.yml # I.3.05.10
│ ├── cronjob-experiments-suspend.yml # I.3.05.11
│ └── README.md # реестр задач + сервисные участники
│
├── rbac/ # TODO: SA для api/worker + Role/RoleBinding
└── gateway/ # TODO: отдельный namespace + Deployment + ingress
---
## Что где живёт
Слой — Namespace — k8s-test — dev — staging — prod:
- **API** — `xartia` — ✅ — ✅ — ✅ — ✅
- **WS** — `xartia` — ✅ — ✅ — ✅ — ✅
- **Web (nginx)** — `xartia` — ✅ — ✅ — ✅ — ✅
- **Worker** — `xartia` — ❌ — — — ✅ — ✅
- **CronJob (7 шт.)** — `xartia` — ❌ — ✅ (k3d) — ✅ — ✅
- **Postgres** — `xartia-data` — ✅ — ✅ — ✅ — ✅
- **Redis** — `xartia-data` — ✅ — ✅ — ✅ — ✅
- **MinIO** — `xartia-data` — ✅ — ✅ — ✅ — ✅
- **Gateway** — `xartia-gateway` — ❌ — — — TODO — TODO
- **Registry (Zot)** — `registry` — ❌ — — — TODO — TODO
- **TLS (step-ca)** — `cert-manager` — ❌ — — — TODO — TODO
- **Monitoring** — `monitoring` — ❌ — — — TODO — TODO
- **Longhorn** — `longhorn-system` — ❌ — ❌ — ✅ — ✅
> **Dev-среды изолированы.** `docker compose postgres` ≠ `k8s postgres`. Креденшелы CronJob'ов живут в K8s DB → для ротации используй `kubectl -n xartia exec deploy/api -- node_modules/.bin/tsx scripts/ensure-<svc>-cron.ts <pw>`. Это критично: скрипты, запущенные из `localhost`, обновят compose-БД, а CronJob в K8s останется с устаревшим паролем.
---
## Quick start: k3d (Windows / macOS / Linux)
### 0. Предусловия
```powershell
k3d version          # >= 5.9.0
kubectl version --client
sops --version
age --version
1. Кластер
powershell
k3d cluster create xartia-dev --servers 1 --agents 2
kubectl config current-context   # → k3d-xartia-dev
kubectl get nodes                # 3 ноды, Ready
2. Образы (собрать локально + импортировать в k3d)
powershell
# API (используется для api, ws, worker — один образ)
docker build -f docker/Dockerfile.api -t xartia-api:latest .
k3d image import xartia-api:latest -c xartia-dev
# Web (nginx-unprivileged, listen 8080)
docker build -f docker/Dockerfile.web -t xartia-web:latest .
k3d image import xartia-web:latest -c xartia-dev
# CronJob-образ (curlimages/curl — тянется с Docker Hub, но лучше импортировать)
docker pull curlimages/curl:8.10.1
k3d image import curlimages/curl:8.10.1 -c xartia-dev
# Проверка
docker exec k3d-xartia-dev-server-0 crictl images | findstr xartia
3. Base (Session 1)
powershell
kubectl apply -k k8s/base
kubectl get ns -l app.kubernetes.io/part-of=xartia     # 7 ns, Active
kubectl get priorityclass | findstr xartia            # 3 класса
kubectl get resourcequota -A                          # 7 quota
kubectl get limitrange -A                             # 7 limits
4. Секреты (обязательно до старта api)
Проверка: check_k8s.py выдаст [FAIL] [secret-api] / [secret-postgres] / [secret-minio], если что-то не создано. Без всех трёх поды api/postgres/minio не стартуют.
postgres-secrets и minio-secrets (в xartia-data):
powershell
kubectl -n xartia-data create secret generic postgres-secrets `
  --from-literal=POSTGRES_USER=charter `
  --from-literal=POSTGRES_PASSWORD=charter `
  --from-literal=POSTGRES_DB=charter `
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n xartia-data create secret generic minio-secrets `
  --from-literal=MINIO_ROOT_USER=minio `
  --from-literal=MINIO_ROOT_PASSWORD=minio123 `
  --dry-run=client -o yaml | kubectl apply -f -
api-secrets (в xartia) — 15 ключей, все обязательны:
powershell
@'
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: xartia
type: Opaque
stringData:
  DATABASE_URL: "postgresql://charter:charter@postgres-svc.xartia-data.svc.cluster.local:5432/charter"
  DATABASE_REPLICA_URL: "postgresql://charter:charter@postgres-svc.xartia-data.svc.cluster.local:5432/charter"
  REDIS_URL: "redis://redis-svc.xartia-data.svc.cluster.local:6379"
  S3_ENDPOINT: "http://minio-svc.xartia-data.svc.cluster.local:9000"
  S3_ACCESS_KEY: "minio"
  S3_SECRET_KEY: "minio123"
  S3_BUCKET_MEDIA: "charter-media"
  S3_BUCKET_ARCHIVE: "charter-archive"
  S3_BUCKET_GATEWAY: "charter-gateway"
  JWT_SECRET: "change-me-in-production-min-32-chars-long"
  JWT_ACCESS_TTL: "15m"
  JWT_REFRESH_TTL: "30d"
  ENCRYPTION_KEY: "Z19ja2/xMo1qMGTKgnBLyrPJNnjYGYnTN1FZsbxpkuQ="
  PHONE_HASH_KEY: "9F+J4yT4cqcXXVvqv32TjcBZXRKCh9NE4lDoq+eP6os="
  INTEGRITY_HMAC_KEY: "IMqxEP1mR+lRkzKrGPHeT8A5zLFkkj3inPJwEUYhVCg="
'@ | Out-File -Encoding utf8 tmp-api-secrets.yaml
kubectl apply -f tmp-api-secrets.yaml
Remove-Item tmp-api-secrets.yaml
Важно: DATABASE_URL и REDIS_URL — с FQDN (*.xartia-data.svc.cluster.local). Не postgres-svc, не postgres-svc.xartia-data. api в xartia, сервисы в xartia-data — короткое имя там не резолвится (см. грабли №9).
Проверка всех трёх:
powershell
kubectl -n xartia-data get secret postgres-secrets
kubectl -n xartia-data get secret minio-secrets
kubectl -n xartia get secret api-secrets -o jsonpath='{.data}' | ConvertFrom-Json | Get-Member -MemberType NoteProperty | Measure-Object -Line
# Ожидаемо: 15
5. Base apply
powershell
kubectl apply -k k8s/base
kubectl -n xartia-data get pods   # postgres-0, redis-0, minio-0 → Running
kubectl -n xartia get pods        # api-*, ws-*, worker-*, web-* → Running
Если api / ws / worker висят в Init:0/1 — смотреть kubectl -n xartia logs deploy/api -c wait-for-postgres --tail=20. Скорее всего FQDN в initContainers не прописан (грабли №9).
6. NetworkPolicy (Session 6)
Применяется отдельно от base — не входит в k8s/base/kustomization.yml, чтобы не блокировать k8s-test smoke.
powershell
kubectl apply -k k8s/base/network/
kubectl get networkpolicy -A   # 16 правил
Проверка (обязательно после apply):
powershell
# 1. Разрешённое — должно работать
kubectl -n xartia exec deploy/api -- node -e "const net=require('net');const s=net.connect(5432,'postgres-svc.xartia-data.svc.cluster.local',()=>{console.log('OK');s.end()});s.on('error',e=>{console.log('FAIL',e.code);process.exit(1)})"
kubectl -n xartia exec deploy/web -- wget -qO- --timeout=5 http://api-svc:3000/health/live
# 2. Запрещённое — должно блокироваться
kubectl -n xartia exec deploy/web -- sh -c "timeout 3 nc -zv redis-svc.xartia-data 6379 2>&1 || echo 'BLOCKED (expected)'"
# 3. DNS — должен работать во всех namespace с default-deny egress
kubectl -n xartia exec deploy/api -- node -e "require('dns').lookup('postgres-svc.xartia-data.svc.cluster.local',(e,a)=>{if(e){console.log('DNS FAIL',e.code);process.exit(1)}console.log('DNS OK',a)})"
Откат:
powershell
kubectl delete -k k8s/base/network/
7. Smoke-тест (k8s-test overlay)
powershell
python scripts/smoke_k8s.py
Что делает smoke_k8s.py:
Создаёт ns xartia-k8s-test + 3 секрета (--from-literal).
kubectl apply -k k8s/overlays/k8s-test (postgres, redis, minio, api, ws, web).
Ждёт Ready: postgres → redis → minio → api → ws → web.
redis-svc PONG из отдельного пода (precheck на protected-mode).
Bootstrap Architect через прямой INSERT (в prod — scripts/bootstrap-architect.ts).
Перезапускает api pod (entrypoint переигрывает миграции — 017 пройдёт).
Smoke: psql SELECT 1, redis PING, minio mc --version, api /health/ready через port-forward.
kubectl delete ns xartia-k8s-test.
Успех → ✅ SMOKE OK. Провал → ns сохраняется для диагностики.
8. CronJobs (Session 7)
Перед deploy — создать 6 сервисных участников в K8s БД и 6 Secret'ов. Порядок важен: если secret создан раньше участника или с паролем от участника из другой БД — /auth/login вернёт 401, CronJob упадёт.
powershell
# 1. Убедиться, что api в K8s работает и видит K8s БД
kubectl -n xartia exec deploy/api -- node -e "fetch('http://localhost:3000/health/ready').then(r=>r.text()).then(console.log)"
# Ожидаемо: {"status":"ok","checks":{"db":"ok",...}}
# 2. Сгенерировать пароли (в одной PowerShell-сессии, не терять!)
$passwords = @{}
foreach ($svc in 'psy','automation','webhooks','aggregator','quanta','experiments') {
  $passwords[$svc] = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
}
# 3. Создать участников в K8s БД через api-под (НЕ через localhost!)
foreach ($svc in 'psy','automation','webhooks','aggregator','quanta','experiments') {
  Write-Host "`n=== $svc ===" -ForegroundColor Cyan
  kubectl -n xartia exec deploy/api -- node_modules/.bin/tsx "scripts/ensure-$svc-cron.ts" $passwords[$svc]
  # Между запусками — пауза: auth.login rate limit 50/15min на IP
  Start-Sleep -Seconds 15
}
# Ожидаемо: каждый → ✓ создан/обновлён + ✓ <resource> права: [..., Act]
# Если 429 — дождаться retry_after_sec (обычно 60–900s) и повторить ОДИН скрипт
# 4. Создать 6 Secret'ов
$phones = @{
  psy='+70000000001'; automation='+70000000002'; webhooks='+70000000003'
  aggregator='+70000000004'; quanta='+70000000005'; experiments='+70000000006'
}
foreach ($svc in $phones.Keys) {
  $phone_val = $phones[$svc]     # ← ОБЯЗАТЕЛЬНО переменная (см. грабли №10)
  $pass_val  = $passwords[$svc]
  if (-not $phone_val -or -not $pass_val) { Write-Error "empty: $svc"; continue }
  kubectl -n xartia delete secret "xartia-$svc-cron" --ignore-not-found
  kubectl -n xartia create secret generic "xartia-$svc-cron" `
    --from-literal="phone=$phone_val" `
    --from-literal="password=$pass_val"
}
# 5. Проверить все 6 Secret'ов (phone = +700000000XX, не мусор)
foreach ($svc in 'psy','automation','webhooks','aggregator','quanta','experiments') {
  $raw = kubectl -n xartia get secret "xartia-$svc-cron" -o jsonpath='{.data.phone}'
  "{0,-20} {1}" -f $svc, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))
}
# Ожидаемо: psy +70000000001 ... experiments +70000000006
# Если видишь "System.Collections.Hashtable[...]" — пересоздать с переменной (шаг 4)
# 6. Apply CronJob-манифестов
kubectl apply --dry-run=server -f k8s/worker/   # сначала dry-run
kubectl apply -f k8s/worker/
kubectl -n xartia get cronjob                   # 7 CronJob, SUSPEND=False
# 7. Форсированный тест одного CronJob
kubectl -n xartia delete job webhooks-manual --ignore-not-found
kubectl -n xartia create job --from=cronjob/webhooks-process-retries webhooks-manual
Start-Sleep 5
kubectl -n xartia logs -l job-name=webhooks-manual --tail=10
# Ожидаемо:
#   [cron] logging in as +70000000003
#   [cron] token acquired, calling /webhooks/process-retries
#   [cron] response: {"processed":0,...}
#   [cron] OK
Если CronJob упал за 2-5 сек — смотреть kubectl -n xartia describe job <name> (секция Events). Если HTTP 401 — participant в БД не тот, что в Secret. Если HTTP 429 — rate limit (см. грабли №11). Если Connection refused после 1ms — NetworkPolicy блокирует (проверить template.metadata.labels в CronJob, грабли №12).
Ротация пароля (когда нужно):
powershell
$new = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
# Обновить в K8s БД (не в compose!)
kubectl -n xartia exec deploy/api -- node_modules/.bin/tsx scripts/ensure-webhooks-cron.ts $new
# Обновить Secret
kubectl -n xartia delete secret xartia-webhooks-cron
kubectl -n xartia create secret generic xartia-webhooks-cron `
  --from-literal=phone='+70000000003' `
  --from-literal=password=$new
# Форсировать запуск
kubectl -n xartia create job --from=cronjob/webhooks-process-retries webhooks-rot-check
kubectl -n xartia logs -l job-name=webhooks-rot-check --tail=10
9. Диагностика (check_k8s.py, fix_k8s.py)
powershell
# Только читает — не меняет. Структурированные проблемы с кодами.
python check_k8s.py                  # exit 0 если нет FAIL
python check_k8s.py --strict         # WARN тоже роняет в 1
python check_k8s.py --json           # машиночитаемый вывод
python check_k8s.py --static-only    # только файлы, без кластера
python check_k8s.py --cluster-only   # только кластер
# Идемпотентный fixer (создаёт *.bak). Сначала --dry-run.
python fix_k8s.py --dry-run
python fix_k8s.py --only=fqdn,include-templates,secret-api --yes
python fix_k8s.py --ignore=longhorn-files --yes
Что проверяет check_k8s.py:
static: includeTemplates: true, namespace: в overlay, FQDN в initContainers, template.metadata.labels в CronJob, longhorn в base-файлах, kustomize render.
cluster: 7 ns, 3 priorityclass, orphan storageclass longhorn-*, наличие ns longhorn-system.
secrets: postgres-secrets, minio-secrets, api-secrets (15 ключей), 6 cron-секретов.
runtime: 3 data-пода Ready, 4 deployment'а Ready, 7 CronJob.
dry-run: kubectl apply --dry-run=server -k k8s/base.
Что чинит fix_k8s.py автоматически:
include-templates — + includeTemplates: true в base/kustomization.yml.
fqdn — postgres-svc → postgres-svc.xartia-data.svc.cluster.local (3 файла: api, worker, ws).
longhorn-files — удалить блоки longhorn-system из base/*.yml.
longhorn-cluster — удалить ns longhorn-system из кластера.
storageclass-orphans — удалить storageclass longhorn-*.
secret-api — пересоздать api-secrets полным набором dev-значений.
cronjob-labels — добавить template.metadata.labels: { app: xartia, module: <domain> }.
Что требует ручного вмешательства:
secret-postgres / secret-minio / secret-cron — значения из окружения; fix печатает готовые команды.
overlay-namespace — только для k8s-test это намеренно (false positive, чинится патчем if ov.name == "k8s-test": continue в check_overlay_namespace()).
cluster-ns / cluster-priorityclass — kubectl apply -k k8s/base.
data-pods / app-deployments — runtime, не конфиг; fix печатает hint.
🔴 Правила, чтобы не наступить на грабли (проверено болью)
1. Никогда namespace: в overlays
Kustomize v5+ переименовывает все Namespace-объекты полем namespace:. Результат: xartia-data, xartia-gateway, registry схлопываются в один xartia → namespace transformation produces ID conflict.
Правильно: namespaces заданы в base/namespace.yml, overlay их не трогает.
Исключение: overlays/k8s-test/kustomization.yml намеренно имеет namespace: xartia-k8s-test — это консолидация для smoke-теста. check_k8s.py показывает это как [FAIL] [overlay-namespace] — false positive, игнорировать.
2. includeTemplates: true в base labels — обязательно
yaml
# base/kustomization.yml
labels:
  - pairs:
      app.kubernetes.io/part-of: xartia
      app.kubernetes.io/managed-by: kustomize
    includeSelectors: true
    includeTemplates: true     # ← БЕЗ ЭТОГО Deployment даст 0 подов
Без includeTemplates: true: spec.selector.matchLabels содержит part-of=xartia, а spec.template.metadata.labels — нет. Deployment создаст 0 подов, kubectl apply пройдёт молча.
3. Redis: protected-mode no (dev) или пароль (prod)
protected-mode yes + нет пароля = Redis принимает только с loopback. В K8s pod-to-pod идёт через CNI → Redis отвергает → api получает EPIPE/ECONNRESET → regime middleware делает 3 retry на каждый запрос → health-пробы таймаутят → liveness убивает api.
dev/staging (ClusterIP, не публикуется): protected-mode no в base/redis/configmap.yml.
prod: --requirepass + REDIS_URL=redis://:pass@redis-svc:6379.
4. nginx: только nginxinc/nginx-unprivileged + listen 8080
nginx:alpine под runAsUser: 101 падает:
text
nginx: [emerg] mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)
listen 80 не биндится под non-root без CAP_NET_BIND_SERVICE.
Правильно:
Dockerfile.web: FROM nginxinc/nginx-unprivileged:1.27-alpine.
nginx.conf: listen 8080;.
deployment.yml: containerPort: 8080, probes на 8080.
service.yml: port: 80, targetPort: 8080.
securityContext: runAsUser: 101 можно убрать — образ сам ставит 101.
5. Longhorn НЕ работает на k3d под Windows/macOS
k3d — это Linux-VM в Docker, но iSCSI-модули не всегда доступны. Попытка установить Longhorn → longhorn-manager в CrashLoopBackOff / Pending. Плюс остаются orphan StorageClass longhorn-* после удаления — удалять вручную.
Dev/test → local-path (k3s default, одна нода).
Staging/prod → Longhorn на настоящих Linux-нодах.
6. Worker: livenessProbe на /tmp/worker-alive — ловушка
base/worker/deployment.yml содержит:
yaml
livenessProbe:
  exec:
    command: ["sh", "-c", "test -f /tmp/worker-alive || exit 1"]
Worker не создаёт этот файл → через 150 сек liveness убьёт контейнер → CrashLoopBackOff.
Если добавляете worker в K8s: либо убрать livenessProbe (для dev достаточно restartPolicy: Always), либо добавить touch /tmp/worker-alive + setInterval(touch, 30000) в src/worker/index.ts. Для k8s-test worker не в overlay — тестируется в Compose.
7. kubectl logs — по deploy, не по container_name
powershell
kubectl -n xartia logs deploy/api --tail=100   # ✅
kubectl -n xartia logs charter-api --tail=100  # ❌ (charter-api — container_name из compose)
В K8s container_name не используется — поды получают имена <deploy>-<hash>-<id>.
8. k3d image import требует образ в локальном Docker
Сначала docker build / docker pull, потом k3d image import. Иначе: Image '...' is not a file and couldn't be found in the container runtime.
9. FQDN в initContainers (api, worker, ws)
api/ws/worker живут в ns xartia, postgres/redis/minio — в xartia-data. Короткое postgres-svc резолвится только в своём ns. В initContainers обязательно:
yaml
# base/api/deployment.yml, base/worker/deployment.yml
until pg_isready -h postgres-svc.xartia-data.svc.cluster.local -p 5432 -U charter; do
# base/ws/deployment.yml
until redis-cli -h redis-svc.xartia-data.svc.cluster.local -p 6379 ping; do
Без FQDN поды висят в Init:0/1 бесконечно (waiting for postgres-svc ...), pg_isready возвращает no response, redis-cli — Name has no usable address. Фикс: python fix_k8s.py --only=fqdn --yes + kubectl apply -k k8s/base + kubectl -n xartia delete pod -l "app in (api,ws,worker)" (rolling update сам не справится — новые поды не Ready → старые не умирают → deadlock).
DATABASE_URL и REDIS_URL в Secret тоже с FQDN — иначе api стартует, но /health/ready упадёт на db-connect.
10. PowerShell: indexer внутри аргумента не вычисляется
powershell
# ❌ НЕПРАВИЛЬНО — в Secret попадёт "System.Collections.Hashtable[webhooks]"
kubectl create secret generic xartia-webhooks-cron `
  --from-literal=phone=$phones[$svc] `
  --from-literal=password=$passwords[$svc]
# ✅ ПРАВИЛЬНО — вынести в переменную (или использовать $(...))
$phone_val = $phones[$svc]
$pass_val  = $passwords[$svc]
kubectl create secret generic xartia-webhooks-cron `
  --from-literal="phone=$phone_val" `
  --from-literal="password=$pass_val"
Симптом: CronJob падает на /auth/login с 422 VALIDATION_ERROR (не 401!) за 2ms. Причина: в Secret phone = "System.Collections.Hashtable[...]", Zod-валидатор отбивает body до вызова auth.
Проверка (после создания Secret):
powershell
$raw = kubectl -n xartia get secret xartia-webhooks-cron -o jsonpath='{.data.phone}'
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($raw))
# Ожидаемо: +70000000003. Если "System.Collections.Hashtable[...]" — пересоздать.
11. Rate limit /auth/login — 50/15min на IP
src/core/rate-limit.ts: auth.login: { windowMs: 15*60_000, max: 50, keyBy: 'ip' }.
При foreach по 6 скриптам × 2 логина (login + /permissions/me) = 12 запросов за 13 секунд — лимит не превышается. Но если до этого были другие логины с того же IP (например, ручные тесты curl), лимит может выжраться.
Симптом: ✗ login/permissions: login failed: HTTP 429 {"code":"RATE_LIMIT","details":{"retry_after_sec":771}}.
Фикс:
powershell
# Очистить rate-limit ключи в K8s Redis (НЕ compose!)
kubectl -n xartia-data exec redis-0 -- sh -c "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli DEL"
# Или радикально (dev-ok, prod — нет)
kubectl -n xartia-data exec redis-0 -- redis-cli FLUSHDB
Профилактика: в foreach — Start-Sleep -Seconds 15 между скриптами; или патч selfCheck с retry-on-429 (backlog).
check_k8s.py не ловит — rate limit runtime, не конфиг. При следующей ротации — смотреть лог ensure-*.ts.
12. CronJob: template.metadata.labels для NetworkPolicy
allow-cronjobs-egress-to-api и allow-cronjobs-to-api матчат поды по app=xartia. Лейблы в metadata.labels CronJob-объекта не наследуются подами — нужны в template.metadata.labels:
yaml
spec:
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: xartia
            module: webhooks   # psy | automation | webhooks | aggregator | quanta | experiments
        spec:
          ...
Без этого — CronJob-поды без app: xartia → default-deny-all рубит egress → curl: (7) Failed to connect ... after 1 ms (это REJECT от kube-router, не timeout). describe job покажет правильный Pod Template: Labels: app=xartia, но это шаблон, а реальный под без лейблов — потому что template.metadata.labels пуст → CronJob-контроллер не передаёт их в под.
Фикс: python fix_k8s.py --only=cronjob-labels --yes + kubectl apply -f k8s/worker/.
13. NetworkPolicy применяется отдельно от base
k8s/base/network/ — не входит в k8s/base/kustomization.yml (иначе сломает smoke: k8s-test не содержит xartia-data, default-deny заблокирует DNS). Применяется явно:
powershell
kubectl apply -k k8s/base/network/
kubectl delete -k k8s/base/network/   # откат
14. refresh_tokens в K8s БД может отсутствовать
kubectl -n xartia-data exec postgres-0 -- psql -U charter -d charter -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;" — если видишь 3 таблицы (participants, participant_status_history, audit_log), значит миграции в K8s БД применились частично (017_seed_widgets.sql падает без architect, api → CrashLoopBackOff → остальные миграции не применяются).
/auth/login работает (200), но /auth/refresh и другие auth-эндпоинты — могут падать. Проверить: kubectl -n xartia exec deploy/api -- node_modules/.bin/tsx scripts/migrate.ts — если «нет неприменённых» — миграции прошли, но таблиц меньше, значит миграции создают таблицы в других схемах или CREATE TABLE IF NOT EXISTS без реального создания.
Backlog при ревизии A.1.01 (Auth).
Секреты: SOPS + age
Установка (один раз)
powershell
choco install sops -y
choco install age.portable -y
Ключи
powershell
# Приватные — ВНЕ git (USB / offline / %USERPROFILE%)
New-Item -ItemType Directory -Force -Path C:\xartia-keys
age-keygen -o C:\xartia-keys\dev.txt
age-keygen -o C:\xartia-keys\staging.txt
age-keygen -o C:\xartia-keys\prod.txt
# Ограничить права
icacls C:\xartia-keys\dev.txt /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
# Публичные (age1...) — в .sops.yaml, безопасны
age-keygen -y C:\xartia-keys\dev.txt
.sops.yaml в корне проекта
yaml
creation_rules:
  - path_regex: k8s/overlays/dev/secrets/.*\.ya?ml$
    age: age1...   # dev public key
  - path_regex: k8s/overlays/staging/secrets/.*\.ya?ml$
    age: age1...   # staging public key
  - path_regex: k8s/overlays/prod/secrets/.*\.ya?ml$
    age: age1...   # prod public key
Шифрование / расшифровка
powershell
# Зашифровать (создаст *.enc.yaml)
sops --encrypt --in-place k8s/overlays/dev/secrets/api.yaml
# Расшифровать в stdout (для apply)
$env:SOPS_AGE_KEY_FILE = "C:\xartia-keys\dev.txt"
sops --decrypt k8s/overlays/dev/secrets/api.enc.yaml | kubectl apply -f -
# Редактировать (откроет $EDITOR, сохранит зашифрованным)
sops k8s/overlays/dev/secrets/api.enc.yaml
Что в git
✅ Можно: *.enc.yaml, .sops.yaml.
❌ Нельзя: *.txt (age-ключи), *.dec.yaml, secrets/*.yaml (не-enc).
См. k8s/.gitignore.
Проверка (по сессиям)
Session 1: base
powershell
kubectl apply -k k8s/base
kubectl get ns -l app.kubernetes.io/part-of=xartia     # 7 ns
kubectl get priorityclass | findstr xartia            # 3 pc
kubectl get resourcequota -A                          # 7 quota
kubectl get limitrange -A                             # 7 limits
kubectl get storageclass                              # только local-path
Kustomize render (без применения)
powershell
kubectl kustomize k8s/overlays/k8s-test | Out-Null
if ($LASTEXITCODE -eq 0) { "OK" } else { "FAIL" }
# Проверить, что нет longhorn и нет namespace: конфликта
kubectl kustomize k8s/overlays/k8s-test | findstr /I longhorn          # пусто
kubectl kustomize k8s/overlays/k8s-test | findstr /C:"kind: Namespace" # 6+
Server-side dry-run (ловит конфликты в кластере)
powershell
kubectl apply --dry-run=server -k k8s/base
kubectl apply --dry-run=server -f k8s/worker/
Полный smoke
powershell
python scripts/smoke_k8s.py    # ✅ SMOKE OK
NetworkPolicy
powershell
kubectl apply -k k8s/base/network/
kubectl get networkpolicy -A                          # 16 правил
kubectl -n xartia exec deploy/web -- sh -c "timeout 3 nc -zv redis-svc.xartia-data 6379 2>&1 || echo 'BLOCKED'"
# Ожидаемо: BLOCKED
CronJobs
powershell
kubectl -n xartia get cronjob                          # 7, SUSPEND=False
kubectl -n xartia create job --from=cronjob/webhooks-process-retries webhooks-check
Start-Sleep 5
kubectl -n xartia logs -l job-name=webhooks-check --tail=10
# Ожидаемо: [cron] OK
Применение в staging / prod (TODO)
Внимание: staging/prod не тестировались. Требуют:
Linux-нод (для Longhorn).
Установленного Longhorn (Helm) перед kubectl apply -k k8s/longhorn/.
step-ca + cert-manager (для TLS).
Registry (Zot/Harbor) для образов.
bash
# 1. Установить Longhorn (только staging/prod, НЕ k3d)
helm repo add longhorn https://charts.longhorn.io
helm repo update
helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --set defaultSettings.defaultReplicaCount=2 \
  --set defaultSettings.backupTarget="s3://longhorn-backup@minio.xartia-data.svc:9000/" \
  --set defaultSettings.backupTargetCredentialSecret="longhorn-minio-credentials"
# 2. StorageClass'ы
kubectl apply -k k8s/longhorn/
# 3. Overlay
kubectl apply -k k8s/overlays/staging
# или
kubectl apply -k k8s/overlays/prod
Известные ограничения (честно)
local-path = одна нода. PVC привязан к ноде, под не переедет. Для dev — ок, для staging/prod — Longhorn.
overlays/dev, staging, prod не применялись в реальном кластере. Проверен только k8s-test + dev-k3d (base + network).
Секреты в smoke — --from-literal. Не через SOPS (хотя *.enc.yaml есть). TODO: переключить smoke на sops --decrypt | kubectl apply -f -.
rbac/, gateway/ — пустые. Нет SA для приложений (кроме api), нет Gateway, нет RBAC Role/RoleBinding.
Нет HPA/PDB. В overlays/prod только заготовка. Нужны metrics-server (есть в k3s) + патчи.
Нет ingress/TLS. Web/API доступны только через kubectl port-forward. Для staging/prod — ingress + step-ca.
Worker не в K8s overlay. Работает в Compose. При добавлении — убрать livenessProbe (грабли №6).
minio образ — coollabsio/minio:latest. Официальный minio/minio удалён с Docker Hub в 2025 (AGPLv3 → 401). coollabsio — community-fork. Для prod — свой registry (Zot) с immutable-тегом.
/auth/login из «чужого» пода → 500 (не 401). Баг обработки ошибок, не логики. Backlog при A.1.01.
refresh_tokens может отсутствовать в K8s БД. /auth/refresh упадёт. Backlog при A.1.01.
Webhook egress наружу заблокирован default-deny (network/ разрешает только xartia-data). Когда появятся реальные webhooks — добавить allow-api-egress-external или прокси. Backlog.
Roadmap (актуальный на 2026-10-22)
Сделано:
✅ Session 1 — base (7 ns, 3 priorityclass, 7 limitrange, 7 resourcequota).
✅ Session 2 — Longhorn StorageClass'ы + SOPS + age (Longhorn удалён из dev — не работает в k3d).
✅ Session 3 — data (postgres, redis, minio) + overlays/k8s-test + smoke_k8s.py.
✅ Session 3.5 — SOPS: 3 .enc.yaml + универсальный path_regex.
✅ Session 4 — api Deployment + Service + SA + ConfigMap.
✅ Session 5 — ws + web + worker + nginx-unprivileged + Dockerfile.web.
✅ Session 6 — NetworkPolicy (16 правил) — проверено вживую (web→redis BLOCKED, api→data OK, DNS OK).
✅ Session 7 — CronJobs (7 шт.) — 6 сервисных участников + 6 Secret'ов + все [cron] OK.
Дальше:
🟠 Session 8 — RBAC: SA для api/worker/ws + Role/RoleBinding (сейчас api SA есть, но без RBAC).
🟠 Session 9 — Gateway: base/gateway/ — Deployment + Postgres + NetworkPolicy + ingress.
🟡 Session 10 — SOPS в smoke: --from-literal → sops --decrypt | kubectl apply -f -.
🟡 Session 11 — overlays/dev: применить в k3d, отладить отличия от k8s-test.
🟢 Session 12 — overlays/staging: VPS (Linux, Longhorn, step-ca).
🟢 Session 13 — overlays/prod: 3 ноды, Longhorn r3, HPA, PDB, monitoring.
🟢 Session 14 — Velero + restic: backup K8s-объектов в MinIO (S3).
🟢 Session 15 — Forgejo + Woodpecker: self-hosted CI (вместо GitHub Actions).
Технический долг (мелочи, не блокеры):
check_k8s.py false-positive overlay-namespace на k8s-test (патч: if ov.name == "k8s-test": continue).
Retry-on-429 в ensure-*.ts (патч 6 скриптов).
fix_k8s.py --only=secret-cron — сейчас manual; можно автоматизировать (генерация пароля + kubectl create + участник).
scripts/smoke_k8s.py — переключить на SOPS.
Ссылки
Compose (primary для разработки): docker/docker-compose.yml + .env.
Smoke-test: scripts/smoke_k8s.py.
Диагностика: scripts/check_k8s.py, scripts/fix_k8s.py.
CronJob реестр: k8s/worker/README.md.
Философия независимости: Longhorn (не облако), Zot (не Docker Hub), step-ca (не Let's Encrypt), Headscale (не Tailscale), Forgejo (не GitHub).
Хартия 5.0: github.com/vamhana/hartia.

## Longhorn: dev-валидация (2026-10-23) — закрыта

`k8s/longhorn/storageclass-r1.yml` протестирован вживую на:
- k3s v1.36.5 (WSL2, кастомное ядро 6.1.21.2 с `iscsi_tcp` + `xt_recent`)
- Longhorn v1.7.2 (Helm)
- Одноузловой кластер (`desktop-0reiupl`, `allowScheduling=true`)

Проверено end-to-end:
- SC создаётся с `Retain` / `WaitForFirstConsumer` / `replicas=1`
- PVC → Bound → Pod → Running → запись/чтение (`hello r1`)
- `replicas=1` (не 3), `robustness=healthy`
- `reclaimPolicy: Retain`: после `delete pvc` PV → `Released`,
  Longhorn volume `detached`; данные на диске сохранены
- Rebind: `kubectl patch pv $PV -p '{"spec":{"claimRef":null}}'`
  → PV `Available` → новый PVC привязывается к тому же PV
  → данные доступны (`hello r1`) ✅

Требуемые настройки Longhorn (иначе `No available disk candidates`):
```bash
kubectl -n longhorn-system patch settings.longhorn.io \
  storage-minimal-available-percentage --type merge -p '{"value":"5"}'
kubectl -n longhorn-system patch settings.longhorn.io \
  storage-reserved-percentage-for-default-disk --type merge -p '{"value":"5"}'
Убрать default с longhorn (у helm-чарта replicas=3 → degraded на 1 ноде):

bash
kubectl patch storageclass longhorn -p '{"metadata":{"annotations":\
{"storageclass.kubernetes.io/is-default-class":"false"}}}'
kubectl patch storageclass local-path -p '{"metadata":{"annotations":\
{"storageclass.kubernetes.io/is-default-class":"true"}}}'
Не проверено (нужен multi-node): r2/r3 с реальной HA,
BackupTarget в MinIO, VolumeSnapshot.

Полная инструкция по WSL2+k3s+Longhorn: docs/wsl2-longhorn-setup.md.

text

И создай `docs/wsl2-longhorn-setup.md` — перенеси туда свой документ «Longhorn на Windows через WSL2 с кастомным ядром». **Не коммить** `wsl_kernel/bzImage` — добавь в `.gitignore`: