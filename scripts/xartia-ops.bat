@echo off
chcp 65001 > nul
setlocal
title xartia-ops
cd /d "%~dp0.."

echo ============================================================
echo   XartIA Operations Console
echo ============================================================
echo.

echo [1/3] Поднимаю инфраструктуру (postgres, redis, minio)...
docker compose -f docker/docker-compose.yml up -d postgres redis minio
if errorlevel 1 (
  echo.
  echo [!] Не удалось поднять Docker-стек. Проверьте Docker Desktop.
  goto :done
)
echo   OK
echo.

echo [2/3] Жду готовности postgres...
docker compose -f docker/docker-compose.yml exec -T postgres ^
  sh -c "until pg_isready -U charter -d charter > /dev/null 2>&1; do sleep 1; done"
if errorlevel 1 (
  echo [!] postgres не поднялся.
  goto :done
)
echo   OK
echo.

echo [3/3] Миграции и Архитектор...
call pnpm db:migrate
if errorlevel 1 (
  echo.
  echo [!] Миграции упали. Смотрите вывод выше.
  echo [!] worker НЕ запущен.
  goto :done
)
echo.

call pnpm tsx scripts/ensure-architect.ts
if errorlevel 1 (
  echo.
  echo [!] ensure-architect упал.
  echo [!] worker НЕ запущен.
  goto :done
)
echo.

echo ============================================================
echo   Миграции и Архитектор готовы.
echo ============================================================
echo.
echo Полезные команды (из другого окна, например xartia-db):
echo   docker compose -f docker/docker-compose.yml logs -f postgres
echo   docker compose -f docker/docker-compose.yml exec postgres psql -U charter -d charter
echo   pnpm db:migrate
echo   pnpm tsx scripts/ensure-architect.ts
echo.
echo Логин Архитектора:
echo   Телефон: +79001234567
echo   Пароль:  ChangeMe123456
echo.
echo ============================================================
echo   Запускаю pnpm dev:worker в этом окне.
echo   Ctrl+C — остановить worker.
echo ============================================================
echo.

pnpm dev:worker

:done
echo.
echo [окно остаётся открытым — worker остановлен или не запускался]