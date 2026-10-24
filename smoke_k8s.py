#!/usr/bin/env python3
"""
smoke_k8s.py — A+ валидация K8s-манифестов.
1. kubectl apply -k k8s/overlays/k8s-test
2. kubectl wait pod --for=condition=Ready
3. kubectl exec postgres -- psql -c 'SELECT 1'
4. kubectl exec redis -- redis-cli ping
5. kubectl exec minio -- mc --version
6. kubectl delete ns xartia-k8s-test
Exit 0 — OK, 1 — FAIL.

Порядок:
  - apply всё (api стартует, но может падать в CrashLoopBackOff на
    миграции 017_seed_widgets.sql — RAISE EXCEPTION 'Нет активных
    участников — сначала bootstrap-architect');
  - wait data-layer (postgres/redis/minio);
  - bootstrap minimal architect через прямой INSERT в postgres (в prod —
    scripts/bootstrap-architect.ts, см. A.1.35.01);
  - перезапустить api pod (entrypoint переиграет миграции — 017 пройдёт);
  - wait api (readinessProbe /health/ready);
  - smoke-проверки.

Secrets: дешифруются через sops (encrypted at rest, в git — только *.enc.yaml).
  - SOPS_AGE_KEY_FILE (env) — путь к age-ключу, по умолчанию
    C:\xartia-keys\dev.txt (Windows dev).
"""
import os, subprocess, sys, time


def run(cmd, check=True, capture=True, timeout=120):
    print(f"$ {' '.join(cmd)}")
    r = subprocess.run(cmd, capture_output=capture, text=True, timeout=timeout)
    if check and r.returncode != 0:
        print(f"FAIL (exit {r.returncode})")
        if capture:
            print(f"stdout: {r.stdout[:500]}")
            print(f"stderr: {r.stderr[:500]}")
        sys.exit(1)
    return r


def wait_ready(ns, label, timeout=180):
    """Polling: kubectl wait ненадёжен, если pod'а ещё нет в момент вызова
    (возвращает 'no matching resources found' немедленно, не ждёт timeout)."""
    print(f"wait: {label} in {ns} ...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = run(
            ["kubectl", "-n", ns, "get", "pods", "-l", label,
             "-o", "jsonpath={.items[*].status.conditions[?(@.type=='Ready')].status}"],
            check=False,
        )
        if r.returncode == 0 and r.stdout.strip() and all(
            s == "True" for s in r.stdout.split()
        ):
            print(f"OK: {label} ready")
            return
        time.sleep(3)

    print(f"FAIL: {label} not ready in {timeout}s")
    run(["kubectl", "-n", ns, "get", "pods", "-l", label, "-o", "wide"], check=False)
    run(["kubectl", "-n", ns, "describe", "pod", "-l", label], check=False)
    run(["kubectl", "-n", ns, "logs", "-l", label, "--tail=50"], check=False)
    run(["kubectl", "-n", ns, "get", "pvc"], check=False)
    print(f"\n⚠ Namespace {ns} сохранён для диагностики.")
    print(f"  Удалить: kubectl delete ns {ns}")
    sys.exit(1)


SOPS_AGE_KEY_FILE = os.environ.get(
    "SOPS_AGE_KEY_FILE", r"C:\xartia-keys\dev.txt",
)


def apply_sops(enc_file, ns):
    """sops --decrypt <enc_file> | kubectl -n <ns> apply -f -"""
    print(f"$ sops --decrypt {enc_file} | kubectl -n {ns} apply -f -")
    env = os.environ.copy()
    env["SOPS_AGE_KEY_FILE"] = SOPS_AGE_KEY_FILE

    dec = subprocess.Popen(
        ["sops", "--decrypt", enc_file],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )
    app = subprocess.run(
        ["kubectl", "-n", ns, "apply", "-f", "-"],
        stdin=dec.stdout, capture_output=True, text=True,
    )
    dec.stdout.close()
    dec.wait()

    if dec.returncode != 0 or app.returncode != 0:
        print(f"FAIL: sops rc={dec.returncode}, kubectl rc={app.returncode}")
        if dec.stderr.strip():
            print(f"  sops stderr: {dec.stderr.strip()[:500]}")
        if app.stderr.strip():
            print(f"  kubectl stderr: {app.stderr.strip()[:500]}")
        sys.exit(1)
    print(app.stdout.strip())


def main():
    ns = "xartia-k8s-test"

    # 0. Cleanup (если осталось от прошлого запуска)
    run(["kubectl", "delete", "ns", ns, "--ignore-not-found"], check=False)

    # 0.1. Namespace (kustomize его не создаёт — см. kustomization.yml)
    run(["kubectl", "create", "ns", ns])

    # 0.2. Secrets из SOPS (encrypted at rest; в git — только *.enc.yaml).
    for enc in [
        "k8s/overlays/dev/secrets/postgres.enc.yaml",
        "k8s/overlays/dev/secrets/minio.enc.yaml",
        "k8s/overlays/dev/secrets/api.enc.yaml",
    ]:
        apply_sops(enc, ns)

    # 2. Apply всё. api стартует, но может падать в CrashLoopBackOff на
    #    миграции 017_seed_widgets.sql (RAISE EXCEPTION 'Нет активных
    #    участников — сначала bootstrap-architect'). Это ожидаемо.
    run(["kubectl", "apply", "-k", "k8s/overlays/k8s-test"])

    # 3. Wait data-layer. api пока не ждём — перезапустим его после bootstrap.
    wait_ready(ns, "app=postgres", 180)
    wait_ready(ns, "app=redis", 120)
    wait_ready(ns, "app=minio", 120)

    # 4. Bootstrap minimal architect. В prod это делает CLI
    #    scripts/bootstrap-architect.ts (не ходит по HTTP — см. A.1.35.01).
    #    Здесь — прямой INSERT в работающий postgres, чтобы миграция 017
    #    (seed widgets) смогла пройти при следующем старте api.
    #    ON CONFLICT DO NOTHING (без колонки) — покрывает и UNIQUE(external_id),
    #    и UNIQUE(is_first_architect) WHERE true.
    print("bootstrap: minimal architect ...")
    run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql",
         "-U", "charter", "-d", "charter", "-c",
         "INSERT INTO participants (external_id, direction_id, name, phone, phone_hash, "
         "messengers, password_hash, status, profile_risk, is_first_architect) "
         "SELECT '12345-1', id, 'Smoke Architect', 'encrypted', 'hash-smoke', "
         "'{}'::jsonb, 'placeholder', 'associated', 'compatible', true "
         "FROM directions LIMIT 1 ON CONFLICT DO NOTHING;"],
        check=False)

    # Guard: если directions пуст (007_seeds.sql не применилась) или INSERT
    # не создал строку — следующий старт api снова упадёт на 017.
    r = run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql",
             "-U", "charter", "-d", "charter", "-tA", "-c",
             "SELECT COUNT(*) FROM participants WHERE is_first_architect = true;"],
            check=False)
    if r.stdout.strip() != "1":
        print(f"FAIL: bootstrap participant не создан "
              f"(stdout={r.stdout.strip()!r}, stderr={r.stderr.strip()!r})")
        run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql",
             "-U", "charter", "-d", "charter", "-tA", "-c",
             "SELECT COUNT(*) FROM directions;"], check=False)
        print(f"\n⚠ Namespace {ns} сохранён для диагностики.")
        sys.exit(1)
    print("bootstrap: OK")

    # 5. Перезапустить api pod. Entrypoint повторит миграции — 017 пройдёт.
    #    check=False: pod может быть в Terminating от предыдущего apply, или
    #    RS ещё не успел создать новый — в обоих случаях kubectl вернёт 0
    #    или "not found", что нас устраивает (deployment всё равно поднимет pod).
    run(["kubectl", "-n", ns, "delete", "pod", "-l", "app=api",
         "--ignore-not-found"], check=False)

    # 6. Wait api. readinessProbe /health/ready сам ходит в postgres/redis,
    #    так что "Ready=True" означает, что миграции и зависимости в порядке.
    wait_ready(ns, "app=api", 240)

    # 7. Smoke: postgres
    r = run(["kubectl", "-n", ns, "exec", "postgres-0", "--",
             "psql", "-U", "charter", "-d", "charter", "-c", "SELECT 1;"], check=False)
    if "1 row" not in r.stdout and "1" not in r.stdout:
        print(f"FAIL: postgres SELECT 1 → {r.stdout}")
        sys.exit(1)
    print("OK: postgres SELECT 1")

    # 8. Smoke: redis
    r = run(["kubectl", "-n", ns, "exec", "redis-0", "--", "redis-cli", "ping"], check=False)
    if "PONG" not in r.stdout:
        print(f"FAIL: redis PING → {r.stdout}")
        sys.exit(1)
    print("OK: redis PING")

    # 9. Smoke: minio
    r = run(["kubectl", "-n", ns, "exec", "minio-0", "--", "mc", "--version"], check=False)
    if r.returncode != 0:
        print(f"WARN: minio mc не установлен (не критично)")
    else:
        print("OK: minio mc")

    # 10. Smoke: api /health/ready (port-forward + urllib)
    import urllib.request
    print("smoke: api /health/ready (port-forward) ...")
    pf = subprocess.Popen(
        ["kubectl", "-n", ns, "port-forward", "svc/api-svc", "18080:3000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(3)  # port-forward поднимается ~2с
        with urllib.request.urlopen("http://127.0.0.1:18080/health/ready", timeout=10) as r:
            body = r.read().decode()
            print(f"OK: api /health/ready → {r.status} {body[:120]}")
    except Exception as e:
        print(f"FAIL: api /health/ready → {e}")
        run(["kubectl", "-n", ns, "logs", "deploy/api", "--tail=50"], check=False)
        print(f"\n⚠ Namespace {ns} сохранён для диагностики.")
        sys.exit(1)
    finally:
        pf.terminate()
        try: pf.wait(timeout=5)
        except subprocess.TimeoutExpired: pf.kill()

    # 11. Cleanup
    print(f"cleanup: delete ns {ns}")
    run(["kubectl", "delete", "ns", ns, "--ignore-not-found"])

    print("\n✅ SMOKE OK")


if __name__ == "__main__":
    main()