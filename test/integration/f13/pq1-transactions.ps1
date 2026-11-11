param([ValidateRange(1024,65535)][int]$Port = 5580)
$ErrorActionPreference = 'Stop'
$container = "c4g-pq1-transactions-$PID"
$password = [Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${Port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable editorial PostgreSQL.' }
  $ready = $false
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Disposable editorial PostgreSQL unavailable.' }
  $env:F13_EDITORIAL_DISPOSABLE_PROOF = 'C4G_F13_EDITORIAL_DISPOSABLE_V1'
  $env:F13_EDITORIAL_ADMIN_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:${Port}/postgres"
  # Expected refusal probes write diagnostics to stderr. On Windows PowerShell,
  # redirected native stderr must not abort a successful assertion sequence.
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'pq1-transactions.js') 2>&1 | ForEach-Object { "$_" }
  $gateExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($gateExit -ne 0) { throw 'F13 PQ1 gate failed.' }
} finally {
  Remove-Item Env:F13_EDITORIAL_DISPOSABLE_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F13_EDITORIAL_ADMIN_URL -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}
