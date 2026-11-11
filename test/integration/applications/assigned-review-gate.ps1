$ErrorActionPreference = 'Stop'
$container = "c4g-assigned-review-$PID"
$password = [Guid]::NewGuid().ToString('N')
$started = $false
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --publish 127.0.0.1::5432 postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL unavailable' }
  $started = $true
  $port = (& docker port $container 5432/tcp) -replace '^127\.0\.0\.1:', ''
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL did not become ready' }
  $env:F13_S2_DISPOSABLE_PROOF = 'C4G_F13_S2_DISPOSABLE_V1'
  $env:F13_S2_ADMIN_URL = "postgresql://c4g_f12_admin:${password}@127.0.0.1:$port/postgres"
  $env:APPLICATION_ASSIGNED_REVIEW_PROOF = '1'
  & node (Join-Path $PSScriptRoot '../c4g/runtime-gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'Assigned review gate failed' }
} finally {
  Remove-Item Env:F13_S2_DISPOSABLE_PROOF, Env:F13_S2_ADMIN_URL, Env:APPLICATION_ASSIGNED_REVIEW_PROOF -ErrorAction SilentlyContinue
  if ($started) { & docker rm --force --volumes $container *> $null }
}
