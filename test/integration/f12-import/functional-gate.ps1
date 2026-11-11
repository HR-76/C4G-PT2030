$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$container = "c4g-f12-import-functional-$PID"
$port = 5573
$password = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable F12 import functional PostgreSQL 17 container.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable F12 import functional PostgreSQL did not become ready.' }
  $env:F12_IMPORT_FUNCTIONAL_PROOF = 'C4G_F12_IMPORT_FUNCTIONAL_V1'
  $env:F12_IMPORT_FUNCTIONAL_ADMIN_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/postgres"
  & node (Join-Path $PSScriptRoot 'functional-gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'F12 import Central+A/B functional gate failed.' }
} finally {
  Remove-Item Env:F12_IMPORT_FUNCTIONAL_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F12_IMPORT_FUNCTIONAL_ADMIN_URL -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}
