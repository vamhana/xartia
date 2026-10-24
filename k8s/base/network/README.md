# NetworkPolicy — изоляция слоёв

Default-deny во всех namespace, потом явные allow. Без `allow-dns` всё сломается.

## Потоки
Traefik (kube-system) → api:3000, ws:3001, web:8080
web → api:3000 (для /__api/ proxy)
api → postgres:5432, redis:6379, minio:9000
worker → postgres:5432, redis:6379, minio:9000
ws → redis:6379
cronjob → api:3000

text

Всё остальное — заблокировано.

## Применение

```powershell
kubectl apply -k k8s/base/network/
⚠️ Не включать в k8s-test overlay (по умолчанию)
k8s-test overlay не включает network/ — для smoke. Причина: если забыть allow-dns, все поды упадут по DNS, и smoke будет непонятно падать.

Тест NetworkPolicy — отдельный overlay k8s/overlays/k8s-test-netpol/ (roadmap), или применять вручную:

powershell
kubectl apply -k k8s/base/network/
# Smoke
python scripts/smoke_k8s.py
# Откат
kubectl delete -k k8s/base/network/
Roadmap
network/ — в overlays/staging, overlays/prod, не в k8s-test.

При первом применении в staging — проверить, что /health/ready → 200 после default-deny.

Если не 200 — kubectl describe networkpolicy, kubectl logs, kubectl exec -- nslookup.

text

---

## Важно: **NetworkPolicy не включается в `k8s-test`**

Это **намеренно**. `base/network/` — для staging/prod. В `k8s-test` — smoke без изоляции (иначе риск: забыть `allow-dns` → все поды упадут, smoke падает непонятно).

**Проверка после создания:**

```powershell
# 1. Рендер (без применения)
kubectl kustomize k8s/base/network > $null
# Ожидаемо: молчание

# 2. k8s-test overlay НЕ должен содержать network
kubectl kustomize k8s/overlays/k8s-test | Select-String "kind: NetworkPolicy"
# Ожидаемо: пусто

# 3. base/kustomization.yml НЕ должен включать network
Select-String -Path "k8s\base\kustomization.yml" -Pattern "network"
# Ожидаемо: пусто (network — отдельный apply, не через base)
Важно: base/network/ — отдельный apply (kubectl apply -k k8s/base/network/), не через base/kustomization.yml. Иначе он включится в k8s-test через ../../base → сломает smoke.