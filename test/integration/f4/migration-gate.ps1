$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$container = "c4g-f41-gate-$PID"
$port = 5543
$disposablePassword = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$disposablePassword" --env POSTGRES_USER=c4g_f41 --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable F4.1 PostgreSQL container.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -U c4g_f41 -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable F4.1 PostgreSQL did not become ready.' }
  $env:F4_GATE_DATABASE_URL = "postgresql://c4g_f41:$disposablePassword@127.0.0.1:${port}/postgres"
  & node (Join-Path $PSScriptRoot 'migration-gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 disposable PostgreSQL gate failed.' }
  & node (Join-Path $PSScriptRoot 'rollback-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 rollback matrix failed.' }
  & node (Join-Path $PSScriptRoot 'atomicity-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 rollback atomicity matrix failed.' }
  & node (Join-Path $PSScriptRoot 'f3-disposable-regression.js')
  if ($LASTEXITCODE -ne 0) { throw 'F3 disposable regression failed.' }
  & node (Join-Path $PSScriptRoot 'preflight-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 preflight matrix failed.' }
  & node (Join-Path $PSScriptRoot 'foreign-key-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 foreign-key matrix failed.' }
  & node (Join-Path $PSScriptRoot 'schema-state-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 schema-state matrix failed.' }
  & node (Join-Path $PSScriptRoot 'repository-concurrency.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 repository concurrency matrix failed.' }
  & node (Join-Path $PSScriptRoot 'lifecycle-corrections.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 corrected lifecycle matrix failed.' }
  & node (Join-Path $PSScriptRoot 'event-collision-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 event collision matrix failed.' }
  & node (Join-Path $PSScriptRoot 'code-sanitization-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 classified-code matrix failed.' }
  & node (Join-Path $PSScriptRoot 'transaction-state-matrix.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 real transaction-state matrix failed.' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'cleanup-failure-supervisor.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'F4.1 deliberate-failure cleanup supervisor failed.' }
} finally {
  Remove-Item Env:F4_GATE_DATABASE_URL -ErrorAction SilentlyContinue
  & docker rm --force $container *> $null
}
