#!/usr/bin/env python3
# scripts/fix_k8s.py
"""
fix_k8s.py — идемпотентный fixer для проблем, найденных check_k8s.py.

Автоматически чинит:
    include-templates   → + includeTemplates: true в base/kustomization.yml
    fqdn                → long FQDN в initContainers (api/ws/worker)
    longhorn-files      → удалить блоки longhorn-system из base/*.yml
    longhorn-cluster    → удалить ns longhorn-system из кластера
    storageclass-orphans→ удалить orphan storageclass longhorn-*

НЕ может без внешних данных (печатает инструкцию):
    secret-cron         → нужны пароли; см. hint
    secret-postgres     → нужны значения; см. hint
    secret-minio        → нужны значения; см. hint
    secret-api          → может (dev-значения из docker-compose); см. ниже

Использование:
    python fix_k8s.py                  # все auto-fixable + инструкции для остальных
    python fix_k8s.py --dry-run        # показать, ничего не менять
    python fix_k8s.py --yes            # без подтверждения
    python fix_k8s.py --only=fqdn,include-templates
    python fix_k8s.py --ignore=longhorn-cluster
    python fix_k8s.py --keep-longhorn  # не удалять ns longhorn-system
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from check_k8s import (
    ROOT, Issue, collect_issues, kubectl, API_SECRETS_REQUIRED, FQDN_TARGETS,
    LONGHORN_FILES,
)

# ── Dev-значения для api-secrets ───────────────────────────────────────────
# Совпадают с docker/docker-compose.yml + .env.example + k8s-test overlay.
# В staging/prod — пересоздать из SOPS: sops -d secrets/api.enc.yaml | kubectl apply -f -
API_SECRETS_DEV_VALUES = {
    "DATABASE_URL":         "postgresql://charter:charter@postgres-svc.xartia-data.svc.cluster.local:5432/charter",
    "DATABASE_REPLICA_URL": "postgresql://charter:charter@postgres-svc.xartia-data.svc.cluster.local:5432/charter",
    "REDIS_URL":            "redis://redis-svc.xartia-data.svc.cluster.local:6379",
    "S3_ENDPOINT":          "http://minio-svc.xartia-data.svc.cluster.local:9000",
    "S3_ACCESS_KEY":        "minio",
    "S3_SECRET_KEY":        "minio123",
    "S3_BUCKET_MEDIA":      "charter-media",
    "S3_BUCKET_ARCHIVE":    "charter-archive",
    "S3_BUCKET_GATEWAY":    "charter-gateway",
    "JWT_SECRET":           "change-me-in-production-min-32-chars-long",
    "JWT_ACCESS_TTL":       "15m",
    "JWT_REFRESH_TTL":      "30d",
    "ENCRYPTION_KEY":       "Z19ja2/xMo1qMGTKgnBLyrPJNnjYGYnTN1FZsbxpkuQ=",
    "PHONE_HASH_KEY":       "9F+J4yT4cqcXXVvqv32TjcBZXRKCh9NE4lDoq+eP6os=",
    "INTEGRITY_HMAC_KEY":   "IMqxEP1mR+lRkzKrGPHeT8A5zLFkkj3inPJwEUYhVCg=",
}

# ── Auto-fixable codes ─────────────────────────────────────────────────────
AUTO_FIXABLE = {
    "include-templates", "fqdn", "longhorn-files",
    "longhorn-cluster", "storageclass-orphans", "secret-api",
    "cronjob-labels",   # ← новое
}
MANUAL_ONLY = {"secret-postgres", "secret-minio", "secret-cron",
               "overlay-namespace", "cluster-ns", "cluster-priorityclass"}

changes: list[str] = []
errors: list[str] = []
manual: list[Issue] = []


def log(msg: str) -> None:
    print(f"   {msg}")
    changes.append(msg)


def err(msg: str) -> None:
    print(f"   ERROR: {msg}")
    errors.append(msg)


def backup(path: Path) -> Path:
    bak = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, bak)
    return bak


def fix_cronjob_labels(dry: bool) -> None:
    cron_dir = ROOT / "k8s/worker"
    if not cron_dir.exists():
        return
    for path in sorted(cron_dir.glob("cronjob-*.yml")):
        text = path.read_text(encoding="utf-8")
        if "kind: CronJob" not in text:
            continue
        blocks = re.split(r"(?m)^---[ \t]*\n", text)
        new_blocks, modified = [], False
        for block in blocks:
            if not block.strip() or "kind: CronJob" not in block:
                new_blocks.append(block); continue
            if re.search(r"(?m)^\s+template:\s*\n\s+metadata:", block):
                new_blocks.append(block); continue
            m_mod = re.search(r"(?m)^\s+module:\s*(\S+)", block)
            module = m_mod.group(1) if m_mod else "unknown"
            m = re.search(r"(?m)^(\s+)template:\s*\n(\s+)spec:", block)
            if not m:
                new_blocks.append(block); continue
            t_ind, s_ind = m.group(1), m.group(2)
            l_ind = s_ind + "  "
            inject = (
                f"{t_ind}template:\n"
                f"{s_ind}metadata:\n"
                f"{l_ind}labels:\n"
                f"{l_ind}  app: xartia\n"
                f"{l_ind}  module: {module}\n"
                f"{s_ind}spec:"
            )
            block = block[:m.start()] + inject + block[m.end():]
            modified = True
            new_blocks.append(block)
        if not modified:
            log(f"{path.name}: labels уже есть — skip")
            continue
        if dry:
            log(f"[DRY] {path.name}: + template.metadata.labels")
            continue
        bak = backup(path)
        path.write_text(
            "---\n".join(b.strip() for b in new_blocks if b.strip()) + "\n",
            encoding="utf-8",
        )
        log(f"{path.name}: + template.metadata.labels  (backup: {bak.name})")

# ── Fix: includeTemplates ──────────────────────────────────────────────────

def fix_include_templates(dry: bool) -> None:
    path = ROOT / "k8s/base/kustomization.yml"
    if not path.exists():
        err(f"{path}: не найден")
        return
    text = path.read_text(encoding="utf-8")
    if re.search(r"(?m)^\s+includeTemplates:\s*true\s*$", text):
        log(f"{path.name}: includeTemplates уже есть — skip")
        return

    lines = text.splitlines()
    sel_idx, sel_indent = -1, ""
    for i, raw in enumerate(lines):
        s = raw.split("#", 1)[0]
        if s.strip().startswith("includeSelectors:") and "true" in s.lower():
            sel_idx = i
            sel_indent = s[: len(s) - len(s.lstrip())]
            break

    if sel_idx >= 0:
        new_lines = lines[: sel_idx + 1] + [f"{sel_indent}includeTemplates: true"] + lines[sel_idx + 1:]
    else:
        # Ищем конец блока "- pairs:" внутри labels
        in_labels = in_pairs = False
        dash_indent = ""
        pairs_end = -1
        for i, raw in enumerate(lines):
            s = raw.split("#", 1)[0]
            stripped = s.strip()
            if not stripped:
                continue
            indent = s[: len(s) - len(s.lstrip())]
            if not in_labels:
                if indent == "" and stripped == "labels:":
                    in_labels = True
                continue
            if not in_pairs:
                if stripped.startswith("- pairs:"):
                    in_pairs = True
                    dash_indent = indent
                    continue
                if indent == "" and stripped != "labels:":
                    break
                continue
            if len(indent) > len(dash_indent):
                pairs_end = i
            else:
                break
        if pairs_end < 0:
            err(f"{path.name}: не нашёл ни includeSelectors, ни блок pairs")
            return
        insert_indent = dash_indent + "  "
        new_lines = (
            lines[: pairs_end + 1]
            + [f"{insert_indent}includeSelectors: true",
               f"{insert_indent}includeTemplates: true"]
            + lines[pairs_end + 1:]
        )

    if dry:
        log(f"[DRY] {path.name}: + includeTemplates: true")
        return
    bak = backup(path)
    path.write_text("\n".join(new_lines) + ("\n" if text.endswith("\n") else ""),
                    encoding="utf-8")
    log(f"{path.name}: + includeTemplates: true  (backup: {bak.name})")


# ── Fix: FQDN в initContainers ─────────────────────────────────────────────

def fix_fqdn(dry: bool) -> None:
    for path, short, long_ in FQDN_TARGETS:
        if not path.exists():
            err(f"{path}: не найден")
            continue
        text = path.read_text(encoding="utf-8")
        if short not in text:
            if long_.strip() in text or "xartia-data.svc.cluster.local" in text:
                log(f"{path.name}: уже FQDN — skip")
            else:
                err(f"{path.name}: не нашёл '{short.strip()}'")
            continue
        if dry:
            log(f"[DRY] {path.name}: '{short.strip()}' → '{long_.strip()}'")
            continue
        bak = backup(path)
        path.write_text(text.replace(short, long_), encoding="utf-8")
        log(f"{path.name}: FQDN прописан  (backup: {bak.name})")


# ── Fix: удалить longhorn из base/*.yml ────────────────────────────────────

def _strip_longhorn_blocks(path: Path, dry: bool) -> None:
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    if "longhorn-system" not in text:
        log(f"{path.name}: longhorn уже нет — skip")
        return
    parts = re.split(r"(?m)^---[ \t]*\n", text)
    kept = [p for p in parts if p.strip() and "longhorn-system" not in p]
    dropped = len(parts) - len(kept) - (1 if text.endswith("---\n") else 0)
    if dropped <= 0:
        log(f"{path.name}: longhorn уже нет — skip")
        return
    if dry:
        log(f"[DRY] {path.name}: - {dropped} блок(ов) longhorn")
        return
    bak = backup(path)
    path.write_text("---\n".join(p for p in kept if p.strip()).rstrip() + "\n",
                    encoding="utf-8")
    log(f"{path.name}: - {dropped} блок(ов) longhorn  (backup: {bak.name})")


def fix_longhorn_files(dry: bool) -> None:
    for path in LONGHORN_FILES.values():
        _strip_longhorn_blocks(path, dry)


# ── Fix: удалить longhorn-system из кластера ──────────────────────────────

def fix_longhorn_cluster(dry: bool, keep: bool) -> None:
    if keep:
        log("longhorn-cluster: --keep-longhorn — skip")
        return
    rc, out, _ = kubectl("get", "ns", "longhorn-system", "--ignore-not-found", "-o", "name")
    if rc != 0 or not out.strip():
        log("longhorn-cluster: ns longhorn-system уже нет — skip")
        return
    if dry:
        log("[DRY] cluster: - ns longhorn-system")
        return
    rc, _, e = kubectl("delete", "ns", "longhorn-system", "--ignore-not-found", timeout=60)
    if rc != 0:
        err(f"delete ns longhorn-system: {e.strip() or rc}")
        return
    log("cluster: - ns longhorn-system")


# ── Fix: orphan storageclass longhorn-* ───────────────────────────────────

def fix_storageclass_orphans(dry: bool) -> None:
    rc, out, _ = kubectl("get", "storageclass", "-o", "name")
    if rc != 0:
        err("kubectl get storageclass → ошибка")
        return
    orphans = [l.split("/")[-1] for l in out.splitlines()
               if l.split("/")[-1].startswith("longhorn-")]
    if not orphans:
        log("storageclass-orphans: нет — skip")
        return
    if dry:
        log(f"[DRY] cluster: - storageclass {orphans}")
        return
    rc, _, e = kubectl("delete", "storageclass", *orphans, "--ignore-not-found")
    if rc != 0:
        err(f"delete storageclass {orphans}: {e.strip() or rc}")
        return
    log(f"cluster: - storageclass {orphans}")


# ── Fix: api-secrets (полный набор) ───────────────────────────────────────

def fix_api_secrets(dry: bool) -> None:
    if dry:
        log(f"[DRY] xartia/api-secrets: пересоздать ({len(API_SECRETS_DEV_VALUES)} ключей)")
        return
    # 1. Сгенерировать YAML через kubectl create secret --dry-run=client
    args = ["-n", "xartia", "create", "secret", "generic", "api-secrets",
            "--dry-run=client", "-o", "yaml"]
    for k, v in API_SECRETS_DEV_VALUES.items():
        args.append(f"--from-literal={k}={v}")
    rc, out, e = kubectl(*args)
    if rc != 0:
        err(f"generate api-secrets: {e.strip() or rc}")
        return
    # 2. Применить через stdin
    r = subprocess.run(["kubectl", "apply", "-f", "-"],
                       input=out, text=True, capture_output=True)
    if r.returncode != 0:
        err(f"apply api-secrets: {r.stderr.strip()}")
        return
    log(f"xartia/api-secrets: пересоздан ({len(API_SECRETS_DEV_VALUES)} ключей)")


# ── Dispatcher ─────────────────────────────────────────────────────────────

def run_fix(issue: Issue, dry: bool, keep_longhorn: bool) -> None:
    code = issue.code
    if code == "include-templates":
        fix_include_templates(dry)
    elif code == "fqdn":
        fix_fqdn(dry)
    elif code == "longhorn-files":
        fix_longhorn_files(dry)
    elif code == "longhorn-cluster":
        fix_longhorn_cluster(dry, keep_longhorn)
    elif code == "storageclass-orphans":
        fix_storageclass_orphans(dry)
    elif code == "secret-api":
        fix_api_secrets(dry)
    elif code == "cronjob-labels":
        fix_cronjob_labels(dry)
    else:
        manual.append(issue)


def print_manual() -> None:
    if not manual:
        return
    print()
    print("  ── Требуют ручного вмешательства ─────────────────")
    for i in manual:
        print(f"  [{i.code}] {i.message}")
        if i.hint:
            print(f"         → {i.hint}")
        # Специальная инструкция для cron-secrets
        if i.code == "secret-cron" and i.where:
            name = i.where.split("/")[-1]
            svc = name.replace("xartia-", "").replace("-cron", "")
            phone_map = {
                "psy": "+70000000001", "automation": "+70000000002",
                "webhooks": "+70000000003", "aggregator": "+70000000004",
                "quanta": "+70000000005", "experiments": "+70000000006",
            }
            phone = phone_map.get(svc, "+7000000000X")
            print(f"         $pw = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | % {{[char]$_}})")
            print(f"         pnpm tsx scripts/ensure-{svc}-cron.ts $pw")
            print(f"         kubectl -n xartia create secret generic {name} `")
            print(f"           --from-literal=phone='{phone}' `")
            print(f"           --from-literal=password=$pw")


# ── main ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", "-y", action="store_true")
    ap.add_argument("--keep-longhorn", action="store_true")
    ap.add_argument("--only", default="",
                    help="comma-separated codes для фикса")
    ap.add_argument("--ignore", default="",
                    help="comma-separated codes игнорировать")
    args = ap.parse_args()

    only = set(filter(None, args.only.split(",")))
    ignore = set(filter(None, args.ignore.split(",")))

    print("=" * 64)
    print("  fix_k8s.py" + ("  [DRY-RUN]" if args.dry_run else ""))
    print("=" * 64)
    print()
    print("  Собираю проблемы (check_k8s.collect_issues) ...")
    issues = collect_issues(static=True, cluster=True)
    auto = [i for i in issues if i.code in AUTO_FIXABLE
            and (not only or i.code in only)
            and i.code not in ignore]
    manual_list = [i for i in issues if i.code in MANUAL_ONLY
                   and i.code not in ignore]

    print(f"  Найдено: {len(issues)} issue "
          f"(auto-fixable: {len(auto)}, manual: {len(manual_list)})")
    if not auto and not manual_list:
        print("\n  ✅ Нечего чинить.")
        return 0

    if not args.dry_run and not args.yes:
        print()
        print("  Будет изменено:")
        for i in auto:
            print(f"    - [{i.code}] {i.message}")
        ans = input("  Продолжить? [y/N]: ").strip().lower()
        if ans not in ("y", "yes", "д", "да"):
            print("  Отменено.")
            return 0

    print()
    print("  ── Auto-fix ────────────────────────────────────────")
    # Дедупликация по code (fix вызывается один раз на code)
    seen: set[str] = set()
    for i in auto:
        if i.code in seen:
            continue
        seen.add(i.code)
        run_fix(i, args.dry_run, args.keep_longhorn)

    manual = manual_list
    print_manual()

    print()
    if errors:
        print(f"  Итог: {len(changes)} изменений, {len(errors)} ошибок")
        for e in errors:
            print(f"    ERROR: {e}")
        return 1

    print(f"  Итог: {len(changes)} изменений. "
          f"Manual: {len(manual)}. Перепроверка...")
    if not args.dry_run:
        rc = subprocess.call([sys.executable, str(ROOT / "check_k8s.py"),
                              "--quiet"])
        return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())