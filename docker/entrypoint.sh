#!/bin/sh
# ─────────────────────────────────────────────
# XartIA API entrypoint
# Ожидает БД и Redis, опционально запускает миграции/seed
# ─────────────────────────────────────────────
set -e

log() {
  echo "[entrypoint] $*"
}

# ─── Ожидание PostgreSQL ───────────────────────
wait_for_postgres() {
  if [ -z "${DATABASE_URL}" ]; then
    log "DATABASE_URL not set, skipping postgres wait"
    return 0
  fi

  log "Waiting for PostgreSQL..."

  # Парсим хост и порт из DATABASE_URL
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')

  DB_HOST=${DB_HOST:-localhost}
  DB_PORT=${DB_PORT:-5432}

  i=0
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      log "PostgreSQL not ready after 60 seconds, giving up"
      exit 1
    fi
    log "  postgres is not ready yet ($i/60)..."
    sleep 1
  done

  log "PostgreSQL is ready"
}

# ─── Ожидание Redis ────────────────────────────
wait_for_redis() {
  if [ -z "${REDIS_URL}" ]; then
    log "REDIS_URL not set, skipping redis wait"
    return 0
  fi

  log "Waiting for Redis..."

  REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:/]*\).*|\1|p')
  REDIS_HOST=${REDIS_HOST:-localhost}

  i=0
  until redis-cli -h "$REDIS_HOST" ping > /dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 60 ]; then
      log "Redis not ready after 60 seconds, giving up"
      exit 1
    fi
    log "  redis is not ready yet ($i/60)..."
    sleep 1
  done

  log "Redis is ready"
}

# ─── Миграции ──────────────────────────────────
run_migrations() {
  if [ "${RUN_MIGRATIONS}" = "true" ]; then
    log "Running migrations..."
    node_modules/.bin/tsx scripts/migrate.ts
    log "Migrations done"
  fi
}

run_seeds() {
  if [ "${RUN_SEED}" = "true" ]; then
    log "Running seeds..."
    # npm run seed
    log "Seeds placeholder (not implemented yet)"
  fi
}

# ─── Graceful shutdown ─────────────────────────
shutdown() {
  log "Received shutdown signal"
  if [ -n "${APP_PID}" ]; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID"
  fi
  exit 0
}

trap shutdown TERM INT

# ─── Main ──────────────────────────────────────
log "Starting XartIA API entrypoint"
log "  NODE_ENV=${NODE_ENV:-development}"
log "  LOG_LEVEL=${LOG_LEVEL:-info}"

wait_for_postgres
wait_for_redis
run_migrations

log "Starting application: $*"

# Запускаем приложение в фоне, чтобы ловить сигналы
"$@" &
APP_PID=$!
wait "$APP_PID"