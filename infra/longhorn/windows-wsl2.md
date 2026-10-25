# Longhorn на Windows через WSL2 с кастомным ядром

> **Статус:** справочный материал. Текущий кластер `xartia-dev` (k3d на Docker Desktop) использует `local-path`; namespace `longhorn-system` создан, но подов нет. Этот гайд описывает другой вариант — WSL2 + k3s + кастомное ядро, где Longhorn действительно даёт PVC.
>
> Документ описывает **dev-окружение** (k3d/k3s + Longhorn на Windows через WSL2). Это инфраструктурная заметка, а не часть спецификации продукта: она объясняет, почему в проекте появился отдельный том под Postgres и как воспроизвести окружение с нуля.

## 📖 О чём этот документ
Пошаговое описание того, как организовать полноценное постоянное хранилище Kubernetes (Longhorn) на Windows-хосте без отдельной виртуальной машины — через WSL2 с кастомным ядром Linux, в которое встроены модули iscsi_tcp и xt_recent.

Документ объясняет как всё устроено, какие компоненты участвуют, зачем нужен каждый шаг, и как воспроизвести конфигурацию с нуля.

## 🎯 Зачем это нужно
Стандартное ядро WSL2 — урезанная сборка, в которой отключены многие модули, необходимые для Kubernetes и систем хранения. Из-за этого Longhorn в стандартном WSL2 работать не может:

Модуль	Зачем нужен	Состояние в стандартном WSL2
iscsi_tcp	Longhorn предоставляет тома через iSCSI. Без него поды не могут подключать и монтировать PVC.	❌ Отключён
xt_recent	kube-proxy использует его для iptables-правил с sessionAffinity: ClientIP.	❌ Отключён
Собрав ядро с этими модулями, вы получаете среду, максимально близкую к полноценному Linux-хосту, и можете запустить k3s + Longhorn прямо на Windows.

## 🏗️ Архитектура
```
┌──────────────────────────────────────────────────────────────┐
│                        Windows Host                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    WSL2 (Hyper-V VM)                   │  │
│  │                                                        │  │
│  │  Кастомное ядро 6.1.21.2-microsoft-standard-WSL2+      │  │
│  │  ├─ iscsi_tcp (встроен)                                │  │
│  │  ├─ xt_recent (встроен)                                │  │
│  │  └─ systemd                                            │  │
│  │                                                        │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │              Ubuntu (дистрибутив)                │  │  │
│  │  │                                                  │  │  │
│  │  │  iscsid ← демон iSCSI                            │  │  │
│  │  │                                                  │  │  │
│  │  │  k3s (v1.36.5+k3s1)                              │  │  │
│  │  │  ├─ containerd                                   │  │  │
│  │  │  ├─ kubelet                                      │  │  │
│  │  │  └─ kube-apiserver, coredns, traefik, ...        │  │  │
│  │  │                                                  │  │  │
│  │  │  Longhorn (v1.7.2)                               │  │  │
│  │  │  ├─ longhorn-manager                             │  │  │
│  │  │  ├─ longhorn-csi-plugin (DaemonSet)              │  │  │
│  │  │  ├─ csi-provisioner / attacher / resizer         │  │  │
│  │  │  ├─ engine-image                                 │  │  │
│  │  │  ├─ instance-manager                             │  │  │
│  │  │  └─ longhorn-ui                                  │  │  │
│  │  │                                                  │  │  │
│  │  │  Рабочая нагрузка: Pod + PVC (Longhorn)          │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

Файлы между Windows и WSL:
  C:\Users\<user>\.wslconfig         → путь к кастомному ядру, лимиты памяти
  C:\Users\<user>\wsl_kernel\bzImage → собранный образ ядра
  \\wsl$\Ubuntu\home\<user>\...      → файлы WSL из Проводника Windows
Как проходит запрос на запись данных
```
Pod (test-pod) → монтирует PVC
   ↓
kubelet → CSI NodeStageVolume (через longhorn-csi-plugin)
   ↓
longhorn-csi-plugin → iscsiadm → iSCSI-сессия
   ↓
iscsid (на Ubuntu) → iscsi_tcp (модуль ядра)
   ↓
Longhorn Engine (instance-manager) → реплика тома
   ↓
физический диск (виртуальный диск WSL2 на Windows)
## 🧩 Компоненты и их роли
### 1. WSL2 и кастомное ядро
WSL2 — это лёгкая виртуальная машина Hyper-V, в которой работает Linux-ядро от Microsoft. Ядро общее для всех дистрибутивов WSL2 и задаётся в C:\Users\<user>\.wslconfig.

Кастомное ядро — собрано из исходников WSL2-Linux-Kernel (ветка linux-msft-wsl-6.1.y) с включёнными опциями CONFIG_ISCSI_TCP=y и CONFIG_NETFILTER_XT_MATCH_RECENT=y.

Systemd — включён через /etc/wsl.conf ([boot] systemd=true). Он управляет сервисами (iscsid, k3s, make-root-shared.service) и запускает их автоматически.

2. iscsid (open-iscsi)
Демон-инициатор iSCSI. Отвечает за установку и поддержание iSCSI-сессий между узлом и Longhorn Engine. Без него Longhorn не сможет подключить том к поду, даже если модуль ядра есть.

Установка: apt install open-iscsi

Автозапуск: systemctl enable --now iscsid

Проверка сессий: sudo iscsiadm -m session

3. k3s
Лёгкий дистрибутив Kubernetes в одном бинарнике. Включает kube-apiserver, kubelet, containerd, coredns, traefik, local-path-provisioner, metrics-server.

Установка: curl -sfL https://get.k3s.io/ | K3S_KUBECONFIG_MODE="640" sh -

Конфиг: /etc/rancher/k3s/k3s.yaml

Копия конфига для пользователя: ~/.kube/config (права 600, владелец — пользователь)

Переменная окружения: export KUBECONFIG=~/.kube/config в ~/.bashrc

### 4. Longhorn
Распределённое блочное хранилище для Kubernetes. Предоставляет StorageClass longhorn, который создаёт PVC через CSI-драйвер driver.longhorn.io.

Установка: helm install longhorn longhorn/longhorn --namespace longhorn-system --create-namespace

Версия: v1.7.2

Ключевые поды:

longhorn-manager — управляет томами, репликами, узлами.

longhorn-csi-plugin — DaemonSet на каждом узле, выполняет NodeStageVolume/NodePublishVolume, работает с iscsiadm.

csi-provisioner, csi-attacher, csi-resizer, csi-snapshotter — CSI-сайдкары.

engine-image — образ Longhorn Engine.

instance-manager — запускает Engine и Replica процессы.

longhorn-ui — веб-интерфейс.

### 5. StorageClass
Описывает, как создавать тома. Для одноузлового кластера важно numberOfReplicas: "1". Параметры StorageClass иммутабельны — изменить их после создания нельзя, только пересоздать.

## 🚀 Пошаговое воспроизведение (с нуля)
Предварительные требования
Windows 10/11 с включённой подсистемой WSL2 (wsl --install, wsl --update).

Установленный дистрибутив Ubuntu (wsl --install -d Ubuntu).

Git, пакеты для сборки: sudo apt install -y build-essential flex bison libssl-dev libelf-dev bc python3 dwarves git.

Если установлен Docker Desktop — его можно остановить на время сборки, чтобы не конкурировать за память (wsl --terminate docker-desktop).

Этап 1: Сборка кастомного ядра
bash
# 1. Клонировать исходники (в домашнюю директорию WSL, НЕ в /mnt/c!)
cd ~
git clone --depth 1 -b linux-msft-wsl-6.1.y https://github.com/microsoft/WSL2-Linux-Kernel.git
cd WSL2-Linux-Kernel

# 2. Взять базовую конфигурацию
cp Microsoft/config-wsl .config

# 3. Включить нужные модули
sed -i 's/^# CONFIG_NETFILTER_XT_MATCH_RECENT is not set/CONFIG_NETFILTER_XT_MATCH_RECENT=y/' .config
grep -q '^CONFIG_NETFILTER_XT_MATCH_RECENT=' .config || echo 'CONFIG_NETFILTER_XT_MATCH_RECENT=y' >> .config

for opt in CONFIG_ISCSI_TCP CONFIG_SCSI_ISCSI_ATTRS CONFIG_ISCSI_BOOT_SYSFS CONFIG_SCSI_LOWLEVEL; do
    sed -i "s/^# ${opt} is not set/${opt}=y/" .config
    grep -q "^${opt}=" .config || echo "${opt}=y" >> .config
done

# 4. Обновить конфиг и собрать
make olddefconfig
make -j$(nproc) KCFLAGS="-std=gnu17" HOSTCFLAGS="-std=gnu17"

# 5. Установить модули и скопировать ядро в Windows
sudo make modules_install
mkdir -p /mnt/c/Users/<user>/wsl_kernel
cp arch/x86/boot/bzImage /mnt/c/Users/<user>/wsl_kernel/
Важные нюансы сборки:

Не собирать в /mnt/c — Windows-ФС нечувствительна к регистру, часть заголовков (xt_DSCP.h vs xt_dscp.h) потеряется, сборка упадёт.

GCC 15 требует -std=gnu17 — в C23 bool/true/false стали ключевыми словами, и код ядра 6.1 не совместим с ними.

Ошибка в tools/lib/bpf/libbpf.c — если сборка падает на discarded-qualifiers, вручную заменить char *next_path; на const char *next_path; в функции resolve_full_path.

Этап 2: Настройка WSL2 на кастомное ядро
Создать/отредактировать C:\Users\<user>\.wslconfig:

ini
[wsl2]
kernel=C:\\Users\\<user>\\wsl_kernel\\bzImage
memory=8GB
processors=4
Перезапустить WSL:

powershell
wsl --shutdown
wsl -d Ubuntu
Проверить ядро:

bash
uname -a
# Linux DESKTOP-... 6.1.21.2-microsoft-standard-WSL2+ ...
Проверить, что модули встроены:

bash
ls /sys/module/ | grep -E 'iscsi|xt_recent'
dmesg | grep -i iscsi
Этап 3: Systemd, iscsid, shared mount
Включить systemd в /etc/wsl.conf:

ini
[boot]
systemd=true
Перезапустить WSL и проверить ps -p 1 -o comm= → должно быть systemd.

Установить и запустить iscsid:

bash
sudo apt install -y open-iscsi
sudo systemctl enable --now iscsid
Сделать / shared mount (Longhorn требует shared propagation). Создать systemd-юнит /etc/systemd/system/make-root-shared.service:

ini
[Unit]
Description=Make root mount shared for Longhorn
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/bin/mount --make-shared /

[Install]
WantedBy=multi-user.target
bash
sudo systemctl daemon-reload
sudo systemctl enable --now make-root-shared.service
findmnt -o TARGET,PROPAGATION /   # должно быть shared
Почему не в .bashrc: sudo в .bashrc запрашивает пароль при каждом входе. Systemd-юнит срабатывает автоматически при загрузке.

Этап 4: Установка k3s
bash
curl -sfL https://get.k3s.io/ | K3S_KUBECONFIG_MODE="640" sh -
Настроить kubeconfig для пользователя:

bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config
chmod 600 ~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc
source ~/.bashrc
Проверить:

bash
kubectl get nodes
# desktop-... Ready control-plane ...
Этап 5: Установка Longhorn
bash
# Helm (snap или бинарник)
sudo snap install helm --classic

# Репозиторий и установка
helm repo add longhorn https://charts.longhorn.io
helm repo update
helm install longhorn longhorn/longhorn \
  --namespace longhorn-system \
  --create-namespace \
  --version 1.7.2
Дождаться готовности подов:

bash
kubectl -n longhorn-system get pods -w
Этап 6: Настройка StorageClass для одноузлового кластера
Параметры StorageClass иммутабельны, поэтому нужно пересоздать его с numberOfReplicas: "1":

bash
# Бэкап
kubectl get storageclass longhorn -o yaml > longhorn-sc-backup.yaml

# Удалить
kubectl delete storageclass longhorn

# Создать заново
cat <<'EOF' | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: longhorn
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: driver.longhorn.io
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "1"
  staleReplicaTimeout: "30"
  fromBackup: ""
  fsType: "ext4"
  dataLocality: "disabled"
  disableRevisionCounter: "true"
  unmapMarkSnapChainRemoved: "ignored"
EOF
Также снять default с local-path:

bash
kubectl patch storageclass local-path -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'
И на всякий случай — глобальная настройка реплик:

bash
kubectl patch settings.longhorn.io default-replica-count -n longhorn-system --type merge -p '{"value": "1"}'
Этап 7: Проверка через тестовый PVC
yaml
# infra/longhorn/test-pod.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: longhorn
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  containers:
  - name: test-container
    image: busybox
    command: ["/bin/sh", "-c", "echo 'Hello Longhorn' > /data/test.txt && sleep 3600"]
    volumeMounts:
    - name: test-volume
      mountPath: /data
  volumes:
  - name: test-volume
    persistentVolumeClaim:
      claimName: test-pvc
bash
kubectl apply -f test-pod.yaml

kubectl get pvc test-pvc        # → Bound
kubectl get pod test-pod        # → Running
kubectl exec test-pod -- cat /data/test.txt
# → Hello Longhorn
Если всё три пункта прошли — хранилище работает.

📋 Итоговая конфигурация (что должно быть)
Компонент	Состояние	Как проверить
Кастомное ядро	6.1.21.2-microsoft-standard-WSL2+, iscsi_tcp и xt_recent встроены	uname -a, ls /sys/module/ | grep iscsi, dmesg | grep iscsi
Systemd	PID 1 = systemd	ps -p 1 -o comm=
iscsid	active, автозапуск	systemctl is-active iscsid, ps aux | grep iscsid
Shared mount /	shared	findmnt -o TARGET,PROPAGATION /
iSCSI-сессия	установлена	sudo iscsiadm -m session
k3s	узел Ready	kubectl get nodes
Longhorn	все поды Running	kubectl -n longhorn-system get pods
StorageClass	longhorn (default), numberOfReplicas: "1"	kubectl get sc longhorn -o jsonpath='{.parameters.numberOfReplicas}'
Kubeconfig	~/.kube/config, права 600	ls -la ~/.kube/config
Хранилище	запись/чтение данных	kubectl exec test-pod -- cat /data/test.txt
🔁 Что происходит после wsl --shutdown
Что	Восстанавливается?	Как обеспечено
Кастомное ядро	✅ Автоматически	.wslconfig (kernel=...)
Systemd	✅ Автоматически	/etc/wsl.conf
iscsid	✅ Автоматически	systemctl enable iscsid
Shared mount /	✅ Автоматически	make-root-shared.service
k3s	✅ Автоматически	k3s.service enabled
Поды Longhorn	✅ Сами перезапускаются	StatefulSets / DaemonSets / Deployments
test-pod	✅ Перезапускается	ReplicaSet
Данные на томе	✅ Сохраняются	PV на диске WSL2
## ⚠️ Известные ограничения и грабли
### 1. Сборка в /mnt/c ломается
Windows-ФС нечувствительна к регистру. Заголовки ядра xt_DSCP.h и xt_dscp.h — разные в Linux, но один файл в Windows. Один из них теряется, сборка падает. Всегда собирать в ~ (ext4).

### 2. GCC 15 требует -std=gnu17
В C23 bool/true/false — ключевые слова. Код ядра 6.1 не совместим, сборка падает с cannot use keyword 'false' as enumeration constant. Решение: make KCFLAGS="-std=gnu17" HOSTCFLAGS="-std=gnu17".

3. libbpf.c не компилируется на GCC 15
Ошибка discarded-qualifiers в resolve_full_path. Фикс — одна строка: char *next_path; → const char *next_path;.

### 4. StorageClass иммутабелен
kubectl patch storageclass longhorn -p '{"parameters":...}' → field is immutable. Менять только пересозданием или helm upgrade.

5. helm upgrade --reuse-values падает
Ошибка nil pointer evaluating interface {}.trafficDistribution — новые поля в чарте не подставляются при --reuse-values. Использовать --reset-values или править StorageClass вручную.

6. degraded на одноузловом кластере
По умолчанию 3 реплики. На одном узле — всегда degraded. Для чистоты — numberOfReplicas: "1" в StorageClass (для новых PVC).

### 7. Обновления WSL / ядра
При обновлении WSL или базового ядра от Microsoft кастомный kernel может перестать загружаться. Репозиторий ~/WSL2-Linux-Kernel и .config сохраняются — пересборка занимает ~20–40 минут.

### 8. Docker Desktop и WSL2 делят память
Ошибка Wsl/0x8007000e («Недостаточно памяти») — WSL2 с Docker Desktop конкурирует за RAM. Решение: memory=8GB в .wslconfig, wsl --update, или закрыть Docker Desktop на время сборки.

9. iSCSI и network namespace
В обсуждении Longhorn упоминаются патчи ядра для «network namespace aware» iSCSI. Без них в некоторых конфигурациях Longhorn может работать нестабильно. В нашем случае (одноузловой k3s + numberOfReplicas: 1) всё работает без них. Если появятся проблемы с несколькими томами или перезагрузками — может понадобиться пересборка с патчами.

📚 Полезные команды
bash
# Проверка ядра и модулей
uname -a
ls /sys/module/ | grep iscsi
ls /sys/module/ | grep xt_recent
dmesg | grep -i iscsi

# Проверка iSCSI
systemctl is-active iscsid
sudo iscsiadm -m session

# Проверка shared mount
findmnt -o TARGET,PROPAGATION /

# Проверка k3s
kubectl get nodes
kubectl get pods -A
kubectl get pv
kubectl get pvc -A

# Проверка Longhorn
kubectl -n longhorn-system get pods
kubectl -n longhorn-system get volumes.longhorn.io
kubectl -n longhorn-system get nodes.longhorn.io
kubectl -n longhorn-system logs -l app=longhorn-manager --tail=50
kubectl -n longhorn-system logs -l app=longhorn-csi-plugin --tail=50

# Проверка StorageClass
kubectl get storageclass
kubectl get storageclass longhorn -o jsonpath='{.parameters.numberOfReplicas}'

# Проверка хранилища
kubectl get pvc test-pvc
kubectl get pod test-pod
kubectl exec test-pod -- cat /data/test.txt
## 🎯 Итог
Что получилось: работающий Longhorn на Windows-хосте через WSL2 с кастомным ядром, без отдельной виртуальной машины. Полная цепочка «WSL2 → кастомное ядро с iSCSI → k3s → Longhorn → PVC → под с данными» проверена и воспроизводима.

Что это даёт: полноценное постоянное хранилище Kubernetes в условиях, где стандартный WSL2 не может его предоставить. Подходит для локальной разработки, обучения и экспериментов с stateful-приложениями на Windows.

Чего это не заменяет: production-кластер. WSL2 — не production-среда, Longhorn на одном узле не даёт отказоустойчивости, а при обновлениях WSL/ядра требуется ручная пересборка.

Следующие шаги (если понадобится):

numberOfReplicas: "1" для новых PVC (пересоздать StorageClass).

Бэкапы Longhorn (S3/NFS): BackupTarget в настройках.

Мониторинг: Prometheus + Grafana из чарта Longhorn.

Snapshot'ы и restore через VolumeSnapshot CRD.

При переходе на multi-node — вернуть numberOfReplicas: 2 или 3.
## Retain PV не переиспользуется автоматически

После `kubectl delete pvc` PV в `Retain` остаётся в `Released`. Пересоздание
PVC с тем же именем **не привяжется** к старому PV — Kubernetes не может
сопоставить новый PVC (новый UID) с существующим PV без явного действия.

Это стандартное поведение всех CSI/StorageClass с `reclaimPolicy: Retain`,
не баг Longhorn.

Варианты переиспользования:

**A. Освободить claimRef (админский путь — для DR):**
```bash
kubectl patch pv $PV -p '{"spec":{"claimRef":null}}'
# PV → Available. При следующем поде PVC привяжется к нему.
B. Явный volumeName в PVC:

yaml
spec:
  volumeName: pvc-76901e10-...   # exact PV name
  storageClassName: longhorn-r1
PVC сразу привяжется к указанному PV.

C. Backup → restore (production):
Через Longhorn BackupTarget (S3/MinIO) — создаётся новый PV, данные
восстанавливаются. Используется в multi-node/DR.
