# scripts/ci-local.ps1
# Локальный прогон того же CI, что в .github/workflows/ci.yml.
#
# Зачем: GitHub Actions нельзя запустить «здесь и сейчас», а проверять PR
# нужно. Этот скрипт делает те же шаги против локального стека (docker
# postgres/redis + запущенный API) и падает с ненулевым кодом при ошибке.
#
# Использование:
#   pwsh scripts/ci-local.ps1              # всё
#   pwsh scripts/ci-local.ps1 -StaticOnly  # только типы и сборка
#
# Требует: запущенный API (pnpm dev или контейнер), docker-инфраструктуру,
# .env с ARCHITECT_PHONE / ARCHITECT_PASSWORD.

param(
  [switch]$StaticOnly
)

$ErrorActionPreference = 'Stop'
$script:failed = @()
$script:passed = @()

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  Write-Host ""
  Write-Host "── $Name" -ForegroundColor Cyan
  $started = Get-Date
  # Windows PowerShell 5.1 считает любую запись в stderr от native-команды
  # фатальной при ErrorActionPreference=Stop. Vite/pnpm пишут туда
  # предупреждения — внутри шага понижаем строгость и смотрим код выхода.
  $ErrorActionPreference = 'Continue'
  try {
    & $Action
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
      throw "exit code $LASTEXITCODE"
    }
    $ms = [int]((Get-Date) - $started).TotalMilliseconds
    $script:passed += $Name
    Write-Host "   ✓ $Name (${ms} ms)" -ForegroundColor Green
  } catch {
    $ms = [int]((Get-Date) - $started).TotalMilliseconds
    $script:failed += "$Name — $($_.Exception.Message)"
    Write-Host "   ✗ $Name (${ms} ms): $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Wait-Api {
  param([int]$TimeoutSec = 60)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 3 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "API не ответил на /health за ${TimeoutSec}s"
}

# ── 1. Статика ─────────────────────────────────────────────────
Invoke-Step 'typecheck (API)' { pnpm typecheck }
Invoke-Step 'build (tsc)' { pnpm build }
Invoke-Step 'build:web (vite)' { pnpm exec vite build }

if (-not $StaticOnly) {
  # ── 2. База и данные ─────────────────────────────────────────
  Invoke-Step 'db:migrate' { pnpm db:migrate }
  Invoke-Step 'ensure-architect' { pnpm tsx scripts/ensure-architect.ts }
  Invoke-Step 'db:migrate (сиды)' { pnpm db:migrate }
  Invoke-Step 'API health' { Wait-Api }

  # ── 3. Smoke-тесты (как в CI) ────────────────────────────────
  $phone = $env:ARCHITECT_PHONE
  if (-not $phone) { $phone = '+79001234567' }
  $password = $env:ARCHITECT_PASSWORD
  if (-not $password) { $password = 'ChangeMe123456' }

  Invoke-Step 'seed: base' { pnpm tsx scripts/seed-base.ts $phone $password }
  Invoke-Step 'smoke: system' { pnpm tsx scripts/test-system.ts }
  Invoke-Step 'smoke: public' { pnpm tsx scripts/test-public.ts }
  Invoke-Step 'smoke: register' { pnpm tsx scripts/test-register.ts }
  Invoke-Step 'smoke: passport' { pnpm tsx scripts/test-passport.ts $phone $password }
  Invoke-Step 'smoke: collective' { pnpm tsx scripts/test-collective.ts $phone $password }
  Invoke-Step 'smoke: onboarding-role' { pnpm tsx scripts/test-onboarding-role.ts $phone $password }
  Invoke-Step 'smoke: notifications' { pnpm tsx scripts/test-notification-link.ts $phone $password }
  Invoke-Step 'smoke: journey' { pnpm tsx scripts/test-journey.ts $phone $password }
  Invoke-Step 'smoke: signal-plan' { pnpm tsx scripts/test-signal-plan.ts $phone $password }
  Invoke-Step 'smoke: plan-deviation' { pnpm tsx scripts/test-plan-deviation.ts $phone $password }
  Invoke-Step 'smoke: branches-otc' { pnpm tsx scripts/test-branches-otc.ts $phone $password }
  Invoke-Step 'smoke: tree-naryad' { pnpm tsx scripts/test-tree-naryad.ts $phone $password }
  Invoke-Step 'ws: build+up' {
    docker compose -f docker/docker-compose.yml --profile ws build ws | Out-Null
    docker compose -f docker/docker-compose.yml --profile ws up -d --no-build ws | Out-Null
    # Ждём готовности WS по /health (порт Docker открывает раньше приложения).
    for ($i = 0; $i -lt 90; $i++) {
      try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { break }
      } catch { Start-Sleep -Seconds 1 }
    }
  }
  Invoke-Step 'smoke: ws' { pnpm tsx scripts/test-ws.ts $phone $password }
  Invoke-Step 'invariants: registry' { pnpm tsx scripts/check-invariants.ts }
  Invoke-Step 'smoke: proposals' { pnpm tsx scripts/test-proposals.ts $phone $password }
  Invoke-Step 'smoke: webhooks' { pnpm tsx scripts/test-webhooks.ts $phone $password }
  Invoke-Step 'smoke: cards' { pnpm tsx scripts/test-cards.ts $phone $password }
  Invoke-Step 'smoke: plan-versions' { pnpm tsx scripts/test-plan-versions.ts $phone $password }
  Invoke-Step 'smoke: questions' { pnpm tsx scripts/test-questions.ts $phone $password }
  Invoke-Step 'smoke: reassignment' { pnpm tsx scripts/test-reassignment.ts $phone $password }
  Invoke-Step 'smoke: capacity' { pnpm tsx scripts/test-capacity-cells.ts $phone $password }
  Invoke-Step 'smoke: panels' { pnpm tsx scripts/test-panels.ts $phone $password }
  Invoke-Step 'smoke: invariants' { pnpm tsx scripts/test-invariants.ts $phone $password }
  Invoke-Step 'smoke: treasury' { pnpm tsx scripts/test-treasury.ts $phone $password }
  Invoke-Step 'smoke: council' { pnpm tsx scripts/test-council.ts $phone $password }
  Invoke-Step 'smoke: delegation' { pnpm tsx scripts/test-delegation.ts $phone $password }
  Invoke-Step 'smoke: gateway' { pnpm tsx scripts/test-gateway.ts $phone $password }
  Invoke-Step 'smoke: gateway-contour' { pnpm tsx scripts/test-gateway-contour.ts $phone $password }
  Invoke-Step 'smoke: tasks' { pnpm tsx scripts/test-tasks.ts $phone $password }
}

# ── 4. Итог ────────────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 60)
Write-Host "ПРОЙДЕНО: $($script:passed.Count)  УПАЛО: $($script:failed.Count)"
if ($script:failed.Count -gt 0) {
  Write-Host ""
  foreach ($f in $script:failed) { Write-Host "  ✗ $f" -ForegroundColor Red }
  exit 1
}
Write-Host "CI локально: зелёный" -ForegroundColor Green
exit 0
