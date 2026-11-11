param([switch]$Demo)
$ErrorActionPreference='Stop'
$container="c4g-funding-flow-$PID"
$secret=[Guid]::NewGuid().ToString('N')
try {
  & docker run --detach --name $container --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p '127.0.0.1:5559:5432' postgres:17-alpine | Out-Null
  if($LASTEXITCODE-ne 0){throw 'Could not create funding disposable PostgreSQL.'}
  $ready=$false
  for($i=0;$i-lt 40;$i++){& docker exec $container pg_isready -U c4g_f12_admin -d postgres *> $null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Seconds 1}
  if(-not $ready){throw 'Funding PostgreSQL not ready.'}
  $env:F13_S2_ADMIN_URL="postgresql://c4g_f12_admin:$secret@127.0.0.1:5559/postgres"
  $env:F13_S2_DISPOSABLE_PROOF='C4G_F13_S2_DISPOSABLE_V1'
  $env:FUNDING_SLICE_ONLY='1'
  if($Demo){$env:FUNDING_DEMO_HOLD='1'}
  & node (Join-Path $PSScriptRoot '../c4g/runtime-gate.js')
  if($LASTEXITCODE-ne 0){throw 'Funding flow gate failed.'}
} finally {
  Remove-Item Env:F13_S2_ADMIN_URL,Env:F13_S2_DISPOSABLE_PROOF,Env:FUNDING_SLICE_ONLY,Env:FUNDING_DEMO_HOLD -ErrorAction SilentlyContinue
  & docker rm -f $container *> $null
}
