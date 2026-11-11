$ErrorActionPreference='Stop'
$container="c4g-application-lifecycle-$PID"
$password=[Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p 127.0.0.1:5594:5432 postgres:17-alpine | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Disposable PostgreSQL unavailable'}
  $ready=$false
  for($attempt=0;$attempt -lt 30;$attempt++){
    & docker exec $container pg_isready -h 127.0.0.1 -U c4g_f12_admin -d postgres *> $null
    if($LASTEXITCODE -eq 0){$ready=$true;break}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'Disposable PostgreSQL did not become ready'}
  $env:F13_S2_DISPOSABLE_PROOF='C4G_F13_S2_DISPOSABLE_V1'
  $env:F13_S2_ADMIN_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:5594/postgres"
  $env:DIRECTORY_SLICE_ONLY='1'
  $env:PILOT_PEOPLE_SLICE='1'
  $env:APPLICATION_LIFECYCLE_SLICE='1'
  if($env:APPLICATION_LIFECYCLE_PROBE -eq '1'){ & node (Join-Path $PSScriptRoot 'migration-probe.js') } else { & node (Join-Path $PSScriptRoot '../c4g/runtime-gate.js') }
  if($LASTEXITCODE -ne 0){throw 'Pilot people delivery gate failed'}
} finally {
  Remove-Item Env:F13_S2_DISPOSABLE_PROOF -ErrorAction SilentlyContinue
  Remove-Item Env:F13_S2_ADMIN_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECTORY_SLICE_ONLY -ErrorAction SilentlyContinue
  Remove-Item Env:APPLICATION_LIFECYCLE_SLICE -ErrorAction SilentlyContinue
  Remove-Item Env:PILOT_PEOPLE_SLICE -ErrorAction SilentlyContinue
  & docker rm --force --volumes $container *> $null
}
