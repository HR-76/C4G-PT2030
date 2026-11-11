$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$container = "c4g-f43-gate-$PID"
$port = 5545
$disposablePassword = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$disposablePassword" --env POSTGRES_USER=c4g_f43_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable F4.3 PostgreSQL 17 container.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -U c4g_f43_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable F4.3 PostgreSQL did not become ready.' }
  $env:F43_DISPOSABLE_PROOF = 'C4G_F43_DISPOSABLE_V1'
  $env:F43_GATE_ADMIN_URL = "postgresql://c4g_f43_admin:$disposablePassword@127.0.0.1:${port}/postgres"
  $env:F43_GATE_DATABASE_URL = "postgresql://c4g_f43_admin:$disposablePassword@127.0.0.1:${port}/c4g_f43_synthetic_gate"
  & node (Join-Path $PSScriptRoot 'tenant-gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'F4.3 disposable PostgreSQL gate failed.' }
} finally {
  Remove-Item Env:F43_DISPOSABLE_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F43_GATE_ADMIN_URL -ErrorAction SilentlyContinue
  Remove-Item Env:F43_GATE_DATABASE_URL -ErrorAction SilentlyContinue
  & docker rm --force $container *> $null
}
