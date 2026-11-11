param([switch]$Probe)
$ErrorActionPreference = 'Stop'
$container = "c4g-platform-billing-$PID"
$password = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_billing_admin --env POSTGRES_DB=postgres -p 127.0.0.1:5608:5432 postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL unavailable' }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_billing_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable PostgreSQL not ready' }
  $env:PLATFORM_BILLING_ADMIN_URL = "postgresql://c4g_billing_admin:$password@127.0.0.1:5608/postgres"
  if ($Probe) { $env:PLATFORM_BILLING_CAPTURE = '1' }
  & node (Join-Path $PSScriptRoot 'migration-probe.js')
  if ($LASTEXITCODE -ne 0) { throw 'Platform billing migration probe failed' }
} finally {
  Remove-Item Env:PLATFORM_BILLING_ADMIN_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PLATFORM_BILLING_CAPTURE -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}
