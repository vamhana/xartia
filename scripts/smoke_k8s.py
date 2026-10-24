#!/usr/bin/env python3
"""
smoke_k8s.py — A+ валидация K8s-манифестов.
1. apply
2. wait data-layer (postgres, redis, minio)
3. wait api (миграции 001–031, 017 skip — см. D.2.01.17 v0.0.02)
4. bootstrap minimal architect (participants уже создан)
5. smoke-проверки
6. cleanup
Exit 0 — OK, 1 — FAIL.
"""
import subprocess, sys, time


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
    # Явно печатаем stdout диагностических команд: run() печатает только при
    # check=True, а здесь check=False — поэтому вызываем subprocess.run напрямую.
    for cmd in [
        ["kubectl", "-n", ns, "get", "pods", "-l", label, "-o", "wide"],
        ["kubectl", "-n", ns, "describe", "pod", "-l", label],
        ["kubectl", "-n", ns, "logs", "-l", label, "--tail=100"],
    ]:
        print(f"\n$ {' '.join(cmd)}")
        rr = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        print(rr.stdout or "(empty)")
        if rr.stderr.strip():
            print(f"STDERR: {rr.stderr}")
    print(f"\n⚠ Namespace {ns} сохранён для диагностики.")
    print(f"  Удалить: kubectl delete ns {ns}")
    sys.exit(1)


def main():
    ns = "xartia-k8s-test"

    # 0. Cleanup + namespace + секреты
    run(["kubectl", "delete", "ns", ns, "--ignore-not-found"], check=False)
    run(["kubectl", "create", "ns", ns])

    run(["kubectl", "-n", ns, "create", "secret", "generic", "postgres-secrets",
         "--from-literal=POSTGRES_USER=charter",
         "--from-literal=POSTGRES_PASSWORD=charter",
         "--from-literal=POSTGRES_DB=charter"])
    run(["kubectl", "-n", ns, "create", "secret", "generic", "minio-secrets",
         "--from-literal=MINIO_ROOT_USER=minio",
         "--from-literal=MINIO_ROOT_PASSWORD=minio123"])
    run(["kubectl", "-n", ns, "create", "secret", "generic", "api-secrets",
         "--from-literal=DATABASE_URL=postgresql://charter:charter@postgres-svc:5432/charter",
         "--from-literal=DATABASE_REPLICA_URL=postgresql://charter:charter@postgres-svc:5432/charter",
         "--from-literal=REDIS_URL=redis://redis-svc:6379",
         "--from-literal=S3_ENDPOINT=http://minio-svc:9000",
         "--from-literal=S3_ACCESS_KEY=minio",
         "--from-literal=S3_SECRET_KEY=minio123",
         "--from-literal=S3_BUCKET_MEDIA=charter-media",
         "--from-literal=S3_BUCKET_ARCHIVE=charter-archive",
         "--from-literal=S3_BUCKET_GATEWAY=charter-gateway",
         "--from-literal=JWT_SECRET=change-me-in-production-min-32-chars-long",
         "--from-literal=JWT_ACCESS_TTL=15m",
         "--from-literal=JWT_REFRESH_TTL=30d",
         "--from-literal=ENCRYPTION_KEY=Z19ja2/xMo1qMGTKgnBLyrPJNnjYGYnTN1FZsbxpkuQ=",
         "--from-literal=PHONE_HASH_KEY=9F+J4yT4cqcXXVvqv32TjcBZXRKCh9NE4lDoq+eP6os=",
         "--from-literal=INTEGRITY_HMAC_KEY=IMqxEP1mR+lRkzKrGPHeT8A5zLFkkj3inPJwEUYhVCg="])

    # 1. Apply всё
    run(["kubectl", "apply", "-k", "k8s/overlays/k8s-test"])

    # 2. Wait data-layer
    wait_ready(ns, "app=postgres", 180)
    wait_ready(ns, "app=redis", 120)
    wait_ready(ns, "app=minio", 120)

    # 2.5. Pre-check: redis-svc доступен из другого пода
    r = run(["kubectl", "-n", ns, "run", "test-redis-precheck",
             "--rm", "-i", "--restart=Never", "--image=redis:7-alpine",
             "--command", "--", "redis-cli", "-h", "redis-svc", "ping"], check=False)
    if "PONG" not in r.stdout:
        print(f"FAIL: redis-svc недоступен: {r.stdout}")
        sys.exit(1)
    print("OK: redis-svc PONG")

    # 3. Wait api — миграции 001–031 (017 skip — см. D.2.01.17 v0.0.02).
    wait_ready(ns, "app=api", 300)

    # 3b. Early check: deployment 'ws' существует? Если нет — wait_ready
    #     будет ждать 180с и упадёт с "not ready", хотя проблема не в поде.
    r = run(["kubectl", "-n", ns, "get", "deploy", "ws",
             "--ignore-not-found", "-o", "name"], check=False)
    if not r.stdout.strip():
        print("FAIL: deployment 'ws' не создан.")
        print("     Проверьте k8s/overlays/k8s-test/kustomization.yml —")
        print("     в resources должен быть ../../base/ws")
        sys.exit(1)
    wait_ready(ns, "app=ws", 180)

    # 3c. Early check: deployment 'web' существует? Аналогично ws.
    r = run(["kubectl", "-n", ns, "get", "deploy", "web",
             "--ignore-not-found", "-o", "name"], check=False)
    if not r.stdout.strip():
        print("FAIL: deployment 'web' не создан.")
        print("     Проверьте k8s/overlays/k8s-test/kustomization.yml —")
        print("     в resources должен быть ../../base/web")
        sys.exit(1)
    wait_ready(ns, "app=web", 180)

    # 3d. Worker — без readiness. Проверяем phase=Running.
    r = run(["kubectl", "-n", ns, "get", "pods", "-l", "app=worker",
             "-o", "jsonpath={.items[*].status.phase}"], check=False)
    if "Running" not in r.stdout:
        print(f"FAIL: worker not Running: {r.stdout}")
        run(["kubectl", "-n", ns, "logs", "-l", "app=worker", "--tail=50"], check=False)
        sys.exit(1)
    print("OK: worker Running")

    # 4. Bootstrap minimal architect. В prod — scripts/bootstrap-architect.ts.
    #    participants уже создан миграциями.
    print("bootstrap: minimal architect ...")
    run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql",
         "-U", "charter", "-d", "charter", "-c",
         "INSERT INTO participants (external_id, direction_id, name, phone, phone_hash, "
         "messengers, password_hash, status, profile_risk, is_first_architect) "
         "SELECT '12345-1', id, 'Smoke Architect', 'encrypted', 'hash-smoke', "
         "'{}'::jsonb, 'placeholder', 'associated', 'compatible', true "
         "FROM directions LIMIT 1 ON CONFLICT DO NOTHING;"])

    # Guard: Архитектор создан
    r = run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql",
             "-U", "charter", "-d", "charter", "-tA", "-c",
             "SELECT COUNT(*) FROM participants WHERE is_first_architect = true;"],
            check=False)
    if r.stdout.strip() != "1":
        print(f"FAIL: bootstrap participant не создан (stdout={r.stdout.strip()!r})")
        sys.exit(1)
    print("bootstrap: OK")

    # 5. Smoke: postgres
    r = run(["kubectl", "-n", ns, "exec", "postgres-0", "--",
             "psql", "-U", "charter", "-d", "charter", "-c", "SELECT 1;"], check=False)
    if "1 row" not in r.stdout and "1" not in r.stdout:
        print(f"FAIL: postgres SELECT 1 → {r.stdout}")
        sys.exit(1)
    print("OK: postgres SELECT 1")

    # 6. Smoke: redis
    r = run(["kubectl", "-n", ns, "exec", "redis-0", "--", "redis-cli", "ping"], check=False)
    if "PONG" not in r.stdout:
        print(f"FAIL: redis PING → {r.stdout}")
        sys.exit(1)
    print("OK: redis PING")

    # 7. Smoke: minio
    r = run(["kubectl", "-n", ns, "exec", "minio-0", "--", "mc", "--version"], check=False)
    if r.returncode != 0:
        print("WARN: minio mc не установлен (не критично)")
    else:
        print("OK: minio mc")

    # 8. Smoke: api /health/ready
    import urllib.request
    print("smoke: api /health/ready (port-forward) ...")
    pf = subprocess.Popen(
        ["kubectl", "-n", ns, "port-forward", "svc/api-svc", "18080:3000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(3)
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

    # 9. Cleanup
    print(f"cleanup: delete ns {ns}")
    run(["kubectl", "delete", "ns", ns, "--ignore-not-found"])

    print("\n✅ SMOKE OK")


if __name__ == "__main__":
    main()