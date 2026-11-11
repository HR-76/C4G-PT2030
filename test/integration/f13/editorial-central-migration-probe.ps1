$ErrorActionPreference = 'Stop'
$container = "c4g-f13-editorial-gate-$PID"
$password = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:5575:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable editorial PostgreSQL.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable editorial PostgreSQL unavailable.' }
  $env:F13_EDITORIAL_DISPOSABLE_PROOF = 'C4G_F13_EDITORIAL_DISPOSABLE_V1'
  $env:F13_EDITORIAL_ADMIN_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:5575/postgres"
  & node (Join-Path $PSScriptRoot 'editorial-central-migration-probe.js')
  if ($LASTEXITCODE -ne 0) { throw 'F13 editorial gate failed.' }
} finally {
  Remove-Item Env:F13_EDITORIAL_DISPOSABLE_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F13_EDITORIAL_ADMIN_URL -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}

