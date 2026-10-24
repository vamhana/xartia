# Longhorn — распределённое блочное хранилище

## Почему Longhorn

- **CNCF incubating**, Rancher/SUSE.
- **Replicated block storage** — данные реплицируются между нодами участников.
- **Backup to S3** (наш MinIO) + **DR volume** (реплика в другом месте).
- **Снапшоты, restore, expansion**.
- Работает поверх любого диска (NVMe, HDD, USB).

## ⚠️ НЕ работает на k3d (Windows/macOS)

Longhorn требует **Linux-нод** (kernel modules, iSCSI). k3d на Windows/macOS — это Linux-VM внутри Docker, но iSCSI-модули не всегда доступны. На dev-кластере используем `local-path` (k3s default).

**Staging/prod — Linux-ноды (VPS, bare-metal, K8s на Linux-VM с iSCSI).**

## Установка (staging/prod)

```powershell
# 1. Добавить Helm-репозиторий
helm repo add longhorn https://charts.longhorn.io
helm repo update

# 2. Установить Longhorn в namespace longhorn-system (уже создан в base/)
helm install longhorn longhorn/longhorn `
  --namespace longhorn-system `
  --set defaultSettings.defaultReplicaCount=2 `
  --set defaultSettings.storageMinimalAvailablePercentage=15 `
  --set defaultSettings.backupTarget="s3://longhorn-backup@minio.xartia-data.svc:9000/" `
  --set defaultSettings.backupTargetCredentialSecret="longhorn-minio-credentials"

# 3. Дождаться готовности (3-5 минут)
kubectl -n longhorn-system get pods -w

# 4. Применить StorageClass'ы
kubectl apply -k k8s/longhorn/
Проверка:

powershell
kubectl get storageclass | Select-String longhorn
kubectl -n longhorn-system get pods
Ожидаемо: 3 StorageClass (longhorn-r1, longhorn-r2, longhorn-r3), все поды Longhorn в Running/Completed.

Что создаётся
StorageClass	Реплик	Использование
longhorn-r3	3	Postgres (prod), критичные данные
longhorn-r2	2	Redis, MinIO, backup (MinIO — свой erasure coding, но backup-каталог на Longhorn — RF=2)
longhorn-r1	1	Кэши, временные данные, логи
reclaimPolicy: Retain — критично
Все три StorageClass'а имеют reclaimPolicy: Retain. Это значит: kubectl delete pvc не удаляет данные — PVC переходит в Released, данные остаются на диске. Для Postgres это защита от случайного kubectl delete.

Восстановление после Retain:

powershell
# PVC остался, но Released. Пересоздать с тем же именем:
kubectl -n xartia-data delete pvc postgres-data-postgres-0
kubectl -n xartia-data apply -f postgres-statefulset.yml  # PVC пересоздастся
Backup (Velero + restic)
В Сессии 9. Longhorn сам умеет backup в S3 (MinIO), Velero — для K8s-объектов. Оба нужны.

Что НЕ входит в эту сессию
MinIO distributed — отдельно (Data layer, Сессия 3). MinIO использует свой erasure coding, не Longhorn.

Velero — Сессия 9.

Longhorn UI ingress — опционально, не критично.