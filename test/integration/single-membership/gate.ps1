$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/../../..").Path
$container = "c4g-single-membership-$PID"
$password = ((New-Guid).Guid + (New-Guid).Guid).Replace('-','')
$port = 5612
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'DISPOSABLE_POSTGRES_START_FAILED' }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $container pg_isready -U c4g_f12_admin -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'DISPOSABLE_POSTGRES_NOT_READY' }
  $env:C4G_SINGLE_MEMBERSHIP_GATE_URL = "postgresql://c4g_f12_admin:$password@127.0.0.1:${port}/postgres"
  & node (Join-Path $PSScriptRoot 'gate.js')
  if ($LASTEXITCODE -ne 0) { throw 'SINGLE_MEMBERSHIP_GATE_FAILED' }
} finally {
  Remove-Item Env:C4G_SINGLE_MEMBERSHIP_GATE_URL -ErrorAction SilentlyContinue
  & docker rm -f $container *> $null
}
