$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$gateId=[Guid]::NewGuid().ToString('N')
$container="c4g-funding-temporal-$gateId"
$secret=[Guid]::NewGuid().ToString('N')
$evidence=Join-Path $root "output/funding-temporal-20261028/gate-$gateId"
$createdId=$null
$previousTarget=$env:FUNDING_TEST_DATABASE_URL
New-Item -ItemType Directory -Path $evidence | Out-Null
Push-Location $evidence
try {
  $createdId=(& docker run --detach --name $container --label "c4g.funding-temporal=$gateId" --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=funding_temporal -p '127.0.0.1:5562:5432' postgres:17-alpine)
  if($LASTEXITCODE-ne 0){$createdId=$null;throw 'CALIBRATION_CONTAINER_START_FAILED'}
  $ready=$false
  for($i=0;$i-lt 40;$i++){
    try { & docker exec $createdId pg_isready -U c4g_f12_admin -d funding_temporal *> $null } catch { Start-Sleep -Seconds 1; continue }
    if($LASTEXITCODE-eq 0){$ready=$true;break}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'CALIBRATION_POSTGRES_NOT_READY'}
  $env:FUNDING_TEST_DATABASE_URL="postgresql://c4g_f12_admin:$secret@127.0.0.1:5562/funding_temporal"
  & node (Join-Path $PSScriptRoot 'temporal.js') *> (Join-Path $evidence 'gate.log')
  if($LASTEXITCODE-ne 0){throw 'COVERAGE_P2_GATE_FAILED_SEE_LOCAL_EVIDENCE'}
  Write-Output 'COVERAGE_P2_GATE_PASS'
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $evidence 'wrapper-error.log')
  throw
} finally {
  $env:FUNDING_TEST_DATABASE_URL=$previousTarget
  if($createdId){
    $owned=(& docker inspect --format '{{json .Config.Labels}}' $createdId | ConvertFrom-Json)
    if($LASTEXITCODE-ne 0 -or $owned.'c4g.funding-temporal'-ne $gateId){throw 'CALIBRATION_CONTAINER_OWNERSHIP_UNCONFIRMED'}
    & docker rm -f $createdId *> $null
    if($LASTEXITCODE-ne 0){throw 'CALIBRATION_CLEANUP_FAILED'}
  }
  Pop-Location
}
