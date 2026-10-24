# scripts/backup.ps1
# Бэкап Postgres и проверка восстановления.
#
# Зачем: без проверенного восстановления приглашать людей нельзя — потеря
# работы участника обесценивает весь продукт.
#
# Использование:
#   pwsh scripts/backup.ps1                     # сделать дамп (custom format)
#   pwsh scripts/backup.ps1 -Verify            # дамп + восстановление в charter_restore
#   pwsh scripts/backup.ps1 -Keep 14           # хранить 14 последних дампов
#
# Требует: docker-контейнер postgres (по умолчанию charter-postgres).

param(
  [string]$Container = 'charter-postgres',
  [string]$Db = 'charter',
  [string]$DbUser = 'charter',
  [int]$Keep = 7,
  [switch]$Verify,
  [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups')
)

# PowerShell 5.1 превращает любой stderr от native-команд в фатальную ошибку
# при ErrorActionPreference=Stop, а pg_dump/pg_restore пишут туда NOTICE.
# Поэтому строгость понижена: каждую команду проверяем по $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

function Invoke-Psql {
  param([string]$Sql, [string]$Database)
  $out = docker exec $Container psql -U $DbUser -d $Database -tAc $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
  return ($out | Out-String).Trim()
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$remote = "/tmp/${Db}-${stamp}.dump"
$local = Join-Path $OutDir "${Db}-${stamp}.dump"

# 1. Дамп внутри контейнера (custom format — сжатый, восстанавливается pg_restore)
Write-Host "▶ pg_dump ${Db} → ${remote}"
$dump = docker exec $Container pg_dump -U $DbUser -d $Db --format=custom --file=$remote 2>&1
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed: $dump" }

# 2. Забрать файл на хост
$cp = docker cp "${Container}:${remote}" $local 2>&1
if ($LASTEXITCODE -ne 0) { throw "docker cp failed: $cp" }
docker exec $Container rm -f $remote | Out-Null

$sizeMb = [math]::Round((Get-Item $local).Length / 1MB, 2)
Write-Host "   ✓ ${local} (${sizeMb} MB)"

# 3. Проверка восстановления в отдельную БД
if ($Verify) {
  Write-Host "▶ Проверка восстановления → ${Db}_restore"
  Invoke-Psql -Sql "DROP DATABASE IF EXISTS ${Db}_restore" -Database postgres | Out-Null
  Invoke-Psql -Sql "CREATE DATABASE ${Db}_restore" -Database postgres | Out-Null

  $remoteIn = "/tmp/verify.dump"
  docker cp $local "${Container}:${remoteIn}" | Out-Null
  $restore = docker exec $Container pg_restore -U $DbUser -d "${Db}_restore" --no-owner $remoteIn 2>&1
  docker exec $Container rm -f $remoteIn | Out-Null

  $tablesLive = Invoke-Psql -Sql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -Database $Db
  $tablesRest = Invoke-Psql -Sql "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -Database "${Db}_restore"
  $partsLive = Invoke-Psql -Sql "SELECT count(*) FROM participants" -Database $Db
  $partsRest = Invoke-Psql -Sql "SELECT count(*) FROM participants" -Database "${Db}_restore"

  Write-Host "   таблиц:      ${tablesLive} → ${tablesRest}"
  Write-Host "   участников:  ${partsLive} → ${partsRest}"

  if ($tablesLive -ne $tablesRest -or $partsLive -ne $partsRest) {
    throw "Восстановление не совпало с источником"
  }
  Invoke-Psql -Sql "DROP DATABASE ${Db}_restore" -Database postgres | Out-Null
  Write-Host "   ✓ восстановление совпадает с источником"
}

# 4. Ротация
$dumps = Get-ChildItem $OutDir -Filter "${Db}-*.dump" | Sort-Object LastWriteTime -Descending
if ($dumps.Count -gt $Keep) {
  $dumps | Select-Object -Skip $Keep | ForEach-Object {
    Remove-Item $_.FullName -Force
    Write-Host "   · удалён старый дамп $($_.Name)"
  }
}

Write-Host "✓ Бэкап готов: $local"
