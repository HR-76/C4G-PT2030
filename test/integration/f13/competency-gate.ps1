$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$container = "c4g-f13-competency-gate-$PID"
$port = 5564
$password = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable F13 slice 2 PostgreSQL 17 container.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable F13 slice 2 PostgreSQL did not become ready.' }
  $env:F13_S2_DISPOSABLE_PROOF = 'C4G_F13_S2_DISPOSABLE_V1'
  $env:F13_S2_ADMIN_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/postgres"
  $env:F13_S2_GATE_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/c4g_f13_s2_synthetic_gate"
  & node (Join-Path $PSScriptRoot 'competency-gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'F13 slice 2 disposable PostgreSQL gate failed.' }
} finally {
  Remove-Item Env:F13_S2_DISPOSABLE_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F13_S2_ADMIN_URL -ErrorAction SilentlyContinue
  Remove-Item Env:F13_S2_GATE_URL -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}
