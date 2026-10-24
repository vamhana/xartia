#!/usr/bin/env python3
# scripts/check_k8s.py
"""
check_k8s.py — диагностика K8s-конфигурации и состояния кластера XartIA.

Проверки делятся на 3 слоя:
    static    — файлы репозитория (всегда доступны)
    cluster   — состояние кластера (kubectl; требует работающего kube-context)
    runtime   — поды/деплойменты (kubectl; требует применённого base)

Каждая проблема имеет:
    code      — машиночитаемый код (для fix_k8s.py --only/--ignore)
    severity  — FAIL (роняет exit 1) | WARN (только при --strict)
    message   — что не так
    hint      — как починить (если известно)

Использование:
    python check_k8s.py                  # все проверки
    python check_k8s.py --static-only    # только файлы
    python check_k8s.py --cluster-only   # только кластер
    python check_k8s.py --strict         # WARN → FAIL
    python check_k8s.py --json           # JSON в stdout (для fix_k8s.py)
    python check_k8s.py --quiet          # только FAIL/ERROR

Exit: 0 — нет FAIL, 1 — есть FAIL.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent

# ── Доменные константы ─────────────────────────────────────────────────────

# namespace'ы, которые должны существовать (longhorn-system — НЕ обязателен,
# он появляется только если ставили Helm; для k3d он вреден → WARN)
REQUIRED_NAMESPACES = {
    "xartia", "xartia-data", "xartia-gateway",
    "registry", "cert-manager", "monitoring",
}
OPTIONAL_NAMESPACES = {"longhorn-system"}
DANGEROUS_NAMESPACES = {"longhorn-system"}  # в k3d не нужен, WARN если есть

REQUIRED_PRIORITYCLASS = {"xartia-critical", "xartia-default", "xartia-batch"}

# 6 cron-сервисов (имена Secret'ов в ns xartia)
CRON_SECRETS = {
    "xartia-psy-cron":         ("psy",         "+70000000001"),
    "xartia-automation-cron":  ("automation",  "+70000000002"),
    "xartia-webhooks-cron":    ("webhooks",    "+70000000003"),
    "xartia-aggregator-cron":  ("aggregator",  "+70000000004"),
    "xartia-quanta-cron":      ("quanta",      "+70000000005"),
    "xartia-experiments-cron": ("experiments", "+70000000006"),
}

# Все ключи, без которых api падает на старте
API_SECRETS_REQUIRED = {
    "DATABASE_URL", "DATABASE_REPLICA_URL", "REDIS_URL", "S3_ENDPOINT",
    "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET_MEDIA", "S3_BUCKET_ARCHIVE",
    "S3_BUCKET_GATEWAY", "JWT_SECRET", "JWT_ACCESS_TTL", "JWT_REFRESH_TTL",
    "ENCRYPTION_KEY", "PHONE_HASH_KEY", "INTEGRITY_HMAC_KEY",
}

# Init-контейнеры, которые должны резолвить data-сервисы по FQDN
# (кросс-namespace DNS не работает по короткому имени)
FQDN_TARGETS = [
    (ROOT / "k8s/base/api/deployment.yml",    "pg_isready -h postgres-svc ",
     "pg_isready -h postgres-svc.xartia-data.svc.cluster.local "),
    (ROOT / "k8s/base/worker/deployment.yml", "pg_isready -h postgres-svc ",
     "pg_isready -h postgres-svc.xartia-data.svc.cluster.local "),
    (ROOT / "k8s/base/ws/deployment.yml",     "redis-cli -h redis-svc ",
     "redis-cli -h redis-svc.xartia-data.svc.cluster.local "),
]

# Файлы, где longhorn-system не должен появляться в k3d-конфиге
LONGHORN_FILES = {
    "namespace":     ROOT / "k8s/base/namespace.yml",
    "resourcequota": ROOT / "k8s/base/resourcequota.yml",
    "limitrange":    ROOT / "k8s/base/limitrange.yml",
}

# Kustomize-таргеты для render/dry-run
RENDER_TARGETS = [
    ("base",      ROOT / "k8s/base"),
    ("overlays/dev",      ROOT / "k8s/overlays/dev"),
    ("overlays/k8s-test", ROOT / "k8s/overlays/k8s-test"),
]

# ── Issue model ────────────────────────────────────────────────────────────

@dataclass
class Issue:
    code: str
    severity: str          # "FAIL" | "WARN" | "INFO"
    message: str
    hint: str = ""
    where: str = ""        # файл:строка или ns/name

    def as_dict(self) -> dict:
        return asdict(self)


def add(issues: list[Issue], code: str, severity: str, message: str,
        hint: str = "", where: str = "") -> None:
    issues.append(Issue(code, severity, message, hint, where))


# ── kubectl helper ─────────────────────────────────────────────────────────

def kubectl(*args: str, timeout: int = 30) -> tuple[int, str, str]:
    try:
        r = subprocess.run(
            ["kubectl", *args], capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
        return r.returncode, r.stdout or "", r.stderr or ""
    except FileNotFoundError:
        return -1, "", "kubectl not found"
    except subprocess.TimeoutExpired:
        return -1, "", f"timeout after {timeout}s"


def kubectl_available() -> bool:
    rc, _, _ = kubectl("version", "--client", "--request-timeout=2s")
    return rc == 0


def cluster_reachable() -> bool:
    rc, _, err = kubectl("cluster-info", timeout=5)
    return rc == 0


# ── Static checks (files) ──────────────────────────────────────────────────

def check_include_templates(issues: list[Issue]) -> None:
    path = ROOT / "k8s/base/kustomization.yml"
    if not path.exists():
        add(issues, "include-templates", "FAIL",
            f"{path} не найден", "проверь путь")
        return
    text = path.read_text(encoding="utf-8")
    if re.search(r"(?m)^\s+includeTemplates:\s*true\s*$", text):
        return
    add(issues, "include-templates", "FAIL",
        "k8s/base/kustomization.yml: нет includeTemplates: true",
        "python fix_k8s.py --only=include-templates",
        where="k8s/base/kustomization.yml")


def check_longhorn_files(issues: list[Issue]) -> None:
    for key, path in LONGHORN_FILES.items():
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if "longhorn-system" not in text:
            continue
        add(issues, "longhorn-files", "WARN",
            f"{path.name}: содержит longhorn-system (не нужен в k3d)",
            "python fix_k8s.py --only=longhorn-files",
            where=str(path.relative_to(ROOT)))


def check_fqdn(issues: list[Issue]) -> None:
    for path, short, _ in FQDN_TARGETS:
        if not path.exists():
            add(issues, "fqdn", "FAIL",
                f"{path} не найден", "проверь путь")
            continue
        text = path.read_text(encoding="utf-8")
        if short not in text:
            # либо уже FQDN, либо паттерна нет — не паникуем
            continue
        add(issues, "fqdn", "FAIL",
            f"{path.name}: initContainer использует короткое имя ({short.strip()})",
            "python fix_k8s.py --only=fqdn",
            where=str(path.relative_to(ROOT)))


def check_overlay_namespace(issues: list[Issue]) -> None:
    for ov in (ROOT / "k8s/overlays").iterdir():
        if not ov.is_dir():
            continue
        kf = ov / "kustomization.yml"
        if not kf.exists():
            continue
        text = kf.read_text(encoding="utf-8")
        # поле namespace: на верхнем уровне (не внутри metadata.namespace)
        for i, line in enumerate(text.splitlines(), 1):
            stripped = line.split("#", 1)[0].rstrip()
            if stripped == "namespace:" or stripped.startswith("namespace:"):
                # только верхний уровень (indent 0)
                if line == line.lstrip():
                    add(issues, "overlay-namespace", "FAIL",
                        f"{kf.relative_to(ROOT)}:{i}: поле namespace: (схлопнет все NS)",
                        "удали namespace: из overlay",
                        where=str(kf.relative_to(ROOT)))
                    break


# ── Cluster checks ─────────────────────────────────────────────────────────

def get_json(*args: str) -> dict | None:
    rc, out, _ = kubectl(*args, "-o", "json")
    if rc != 0 or not out.strip():
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def check_cluster_namespaces(issues: list[Issue]) -> None:
    data = get_json("get", "ns")
    if data is None:
        add(issues, "cluster-ns", "FAIL",
            "kubectl get ns → ошибка", "проверь kube-context")
        return
    names = {i["metadata"]["name"] for i in data.get("items", [])}
    missing = REQUIRED_NAMESPACES - names
    if missing:
        add(issues, "cluster-ns", "FAIL",
            f"нет namespace: {sorted(missing)}",
            "kubectl apply -k k8s/base")
    for dangerous in DANGEROUS_NAMESPACES & names:
        add(issues, "longhorn-cluster", "WARN",
            f"namespace {dangerous} присутствует (не нужен в k3d)",
            "python fix_k8s.py --only=longhorn-cluster")


def check_cluster_priorityclass(issues: list[Issue]) -> None:
    data = get_json("get", "priorityclass")
    if data is None:
        add(issues, "cluster-priorityclass", "FAIL",
            "kubectl get priorityclass → ошибка", "")
        return
    names = {i["metadata"]["name"] for i in data.get("items", [])}
    missing = REQUIRED_PRIORITYCLASS - names
    if missing:
        add(issues, "cluster-priorityclass", "FAIL",
            f"нет priorityclass: {sorted(missing)}",
            "kubectl apply -f k8s/base/priorityclass.yml")


def check_storageclass_orphans(issues: list[Issue]) -> None:
    """longhorn-* SC без установленного Longhorn = orphan."""
    data = get_json("get", "storageclass")
    if data is None:
        return
    names = {i["metadata"]["name"] for i in data.get("items", [])}
    has_longhorn_sc = {n for n in names if n.startswith("longhorn-")}
    if not has_longhorn_sc:
        return
    has_longhorn_ns = get_json("get", "ns", "longhorn-system") is not None
    if not has_longhorn_ns:
        add(issues, "storageclass-orphans", "WARN",
            f"orphan StorageClass: {sorted(has_longhorn_sc)} (Longhorn не установлен)",
            "kubectl delete storageclass " + " ".join(sorted(has_longhorn_sc)))


def check_secret(issues: list[Issue], ns: str, name: str,
                 required_keys: set[str] | None = None) -> None:
    rc, out, _ = kubectl("get", "secret", name, "-n", ns,
                          "--ignore-not-found", "-o", "jsonpath={.data}")
    if rc != 0 or not out.strip():
        code = "secret-api" if name == "api-secrets" else (
            "secret-postgres" if name == "postgres-secrets" else (
                "secret-minio" if name == "minio-secrets" else "secret-cron"))
        add(issues, code, "FAIL",
            f"{ns}/{name} не найден", "", where=f"{ns}/{name}")
        return
    if required_keys is None:
        return
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        add(issues, "secret-api", "FAIL",
            f"{ns}/{name}: невалидный jsonpath", "")
        return
    missing = required_keys - set(data.keys())
    if missing:
        add(issues, "secret-api", "FAIL",
            f"{ns}/{name}: нет ключей {sorted(missing)}",
            "python fix_k8s.py --only=secret-api",
            where=f"{ns}/{name}")


def check_all_secrets(issues: list[Issue]) -> None:
    check_secret(issues, "xartia-data", "postgres-secrets")
    check_secret(issues, "xartia-data", "minio-secrets")
    check_secret(issues, "xartia", "api-secrets", API_SECRETS_REQUIRED)
    for secret_name in CRON_SECRETS:
        check_secret(issues, "xartia", secret_name)


def check_app_deployments(issues: list[Issue]) -> None:
    for name in ("api", "ws", "worker", "web"):
        rc, out, _ = kubectl(
            "-n", "xartia", "get", "deploy", name, "-o",
            "jsonpath={.status.readyReplicas}/{.spec.replicas}",
        )
        if rc != 0:
            add(issues, "app-deployments", "FAIL",
                f"xartia/deploy/{name}: не найден", "")
            continue
        if "/" not in out:
            add(issues, "app-deployments", "FAIL",
                f"xartia/deploy/{name}: нет статуса", "")
            continue
        ready, total = out.split("/")
        ready = int(ready or 0)
        total = int(total or 0)
        if ready == 0 or ready < total:
            add(issues, "app-deployments", "FAIL",
                f"xartia/deploy/{name}: {ready}/{total} Ready",
                f"kubectl -n xartia describe pod -l app={name}")


def check_data_pods(issues: list[Issue]) -> None:
    for name in ("postgres-0", "redis-0", "minio-0"):
        rc, out, _ = kubectl(
            "-n", "xartia-data", "get", "pod", name, "-o",
            "jsonpath={.status.phase}/{.status.conditions[?(@.type=='Ready')].status}",
            "--ignore-not-found",
        )
        if rc != 0 or not out.strip():
            add(issues, "data-pods", "FAIL",
                f"xartia-data/{name}: не найден", "")
            continue
        if "/" not in out:
            add(issues, "data-pods", "FAIL",
                f"xartia-data/{name}: {out}", "")
            continue
        phase, ready = out.split("/")
        if phase != "Running" or ready != "True":
            add(issues, "data-pods", "FAIL",
                f"xartia-data/{name}: {phase}/{ready}",
                f"kubectl -n xartia-data describe pod {name}")


def check_cronjobs(issues: list[Issue]) -> None:
    rc, out, _ = kubectl("-n", "xartia", "get", "cronjob", "-o", "name")
    if rc != 0:
        add(issues, "cronjobs", "FAIL",
            "xartia/cronjob: не удалось получить список", "")
        return
    names = {l.split("/")[-1] for l in out.splitlines() if l.strip()}
    expected = {
        "aggregator-process-daily", "automation-run-daily-audit",
        "experiments-process-suspensions", "psy-mood-aggregate-hourly",
        "psy-mood-aggregate-daily", "quanta-process-daily",
        "webhooks-process-retries",
    }
    missing = expected - names
    extra = names - expected
    if missing:
        add(issues, "cronjobs", "FAIL",
            f"нет CronJob: {sorted(missing)}", "kubectl apply -f k8s/worker/")
    if extra:
        add(issues, "cronjobs", "WARN",
            f"лишние CronJob (не из реестра): {sorted(extra)}", "")

def check_cronjob_labels(issues: list[Issue]) -> None:
    cron_dir = ROOT / "k8s/worker"
    if not cron_dir.exists():
        return
    for path in sorted(cron_dir.glob("cronjob-*.yml")):
        text = path.read_text(encoding="utf-8")
        if "kind: CronJob" not in text:
            continue
        for block in re.split(r"(?m)^---[ \t]*\n", text):
            if "kind: CronJob" not in block:
                continue
            if re.search(r"(?m)^\s+template:\s*\n\s+metadata:", block):
                continue
            m = re.search(r"(?m)^\s+name:\s*(\S+)", block)
            name = m.group(1) if m else path.name
            add(issues, "cronjob-labels", "FAIL",
                f"{path.name}: CronJob '{name}' без template.metadata.labels → "
                f"allow-cronjobs-* не пропустит поды",
                "python fix_k8s.py --only=cronjob-labels",
                where=str(path.relative_to(ROOT)))


# ── Render / dry-run ───────────────────────────────────────────────────────

def check_render(issues: list[Issue]) -> None:
    for name, target in RENDER_TARGETS:
        if not target.exists():
            continue
        rc, _, err = kubectl("kustomize", str(target), timeout=60)
        if rc != 0:
            add(issues, "kustomize-render", "FAIL",
                f"{name}: kustomize render → {err.strip().splitlines()[-1] if err.strip() else rc}",
                "проверь YAML")


def check_dryrun(issues: list[Issue], targets: list[str]) -> None:
    for name, target in RENDER_TARGETS:
        if not target.exists():
            continue
        if name not in targets:
            continue
        rc, out, err = kubectl(
            "apply", "--dry-run=server", "-k", str(target), timeout=60,
        )
        if rc != 0 or "Error from server" in err:
            last = (err or out).strip().splitlines()
            add(issues, "dry-run", "FAIL",
                f"{name}: server dry-run → {last[-1] if last else rc}",
                "")


# ── Orchestrator ───────────────────────────────────────────────────────────

def collect_issues(
    static: bool = True,
    cluster: bool = True,
    dryrun_targets: Iterable[str] = ("base",),
) -> list[Issue]:
    issues: list[Issue] = []

    if static:
        check_include_templates(issues)
        check_longhorn_files(issues)
        check_fqdn(issues)
        check_overlay_namespace(issues)
        check_cronjob_labels(issues)
        check_render(issues)

    if cluster:
        if not kubectl_available():
            add(issues, "kubectl-missing", "FAIL",
                "kubectl not found в PATH", "установи kubectl")
        elif not cluster_reachable():
            add(issues, "cluster-unreachable", "WARN",
                "кластер недоступен (kube-context)", "k3d cluster start / kubectl config use-context …")
        else:
            check_cluster_namespaces(issues)
            check_cluster_priorityclass(issues)
            check_storageclass_orphans(issues)
            check_all_secrets(issues)
            check_data_pods(issues)
            check_app_deployments(issues)
            check_cronjobs(issues)
            check_dryrun(issues, list(dryrun_targets))

    return issues


# ── CLI ────────────────────────────────────────────────────────────────────

def _summary(issues: list[Issue]) -> dict:
    s = {"ok": 0, "fail": 0, "warn": 0, "info": 0}
    for i in issues:
        key = {"FAIL": "fail", "WARN": "warn", "INFO": "info"}.get(i.severity, "info")
        s[key] += 1
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--static-only", action="store_true")
    ap.add_argument("--cluster-only", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    static = not args.cluster_only
    cluster = not args.static_only
    issues = collect_issues(static=static, cluster=cluster)
    summary = _summary(issues)

    if args.json:
        print(json.dumps({
            "summary": summary,
            "issues": [i.as_dict() for i in issues],
        }, ensure_ascii=False, indent=2))
    else:
        if not args.quiet:
            print("=" * 64)
            print(f"  check_k8s.py  (static={static}, cluster={cluster})")
            print("=" * 64)
            print()
        for i in issues:
            tag = {"FAIL": "[FAIL]", "WARN": "[WARN]", "INFO": "[INFO]"}.get(i.severity, "[ ?? ]")
            where = f"  ({i.where})" if i.where else ""
            if args.quiet and i.severity == "WARN":
                continue
            print(f"  {tag} [{i.code}] {i.message}{where}")
            if i.hint and not args.quiet:
                print(f"         → {i.hint}")
        print()
        print(f"  OK:   {summary['ok']}")
        print(f"  FAIL: {summary['fail']}")
        print(f"  WARN: {summary['warn']}")
        if args.strict:
            print("  (--strict: WARN считаются FAIL)")

    fails = summary["fail"] + (summary["warn"] if args.strict else 0)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())