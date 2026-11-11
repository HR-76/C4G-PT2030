$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$gateId=[Guid]::NewGuid().ToString('N')
$container="c4g-funding-resolution-$gateId"
$secret=[Guid]::NewGuid().ToString('N')
$evidence=Join-Path $root "output/funding-resolution-20261028/gate-$gateId"
$createdId=$null
$previousTarget=$env:FUNDING_TEST_DATABASE_URL
New-Item -ItemType Directory -Path $evidence | Out-Null
Push-Location $evidence
try {
  $createdId=(& docker run --detach --name $container --label "c4g.funding-resolution=$gateId" --env "POSTGRES_PASSWORD=$secret" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=funding_resolution -p '127.0.0.1:5563:5432' postgres:17-alpine)
  if($LASTEXITCODE-ne 0){$createdId=$null;throw 'RESOLUTION_CONTAINER_START_FAILED'}
  $ready=$false
  for($i=0;$i-lt 40;$i++){
    try { & docker exec $createdId pg_isready -U c4g_f12_admin -d funding_resolution *> $null } catch { Start-Sleep -Seconds 1; continue }
    if($LASTEXITCODE-eq 0){$ready=$true;break}
    Start-Sleep -Seconds 1
  }
  if(-not $ready){throw 'RESOLUTION_POSTGRES_NOT_READY'}
  $env:FUNDING_TEST_DATABASE_URL="postgresql://c4g_f12_admin:$secret@127.0.0.1:5563/funding_resolution"
  & node (Join-Path $PSScriptRoot 'resolution.js') *> (Join-Path $evidence 'gate.log')
  if($LASTEXITCODE-ne 0){throw 'RESOLUTION_GATE_FAILED_SEE_LOCAL_EVIDENCE'}
  $verification=Get-Content -LiteralPath (Join-Path $evidence 'verification.json') -Raw | ConvertFrom-Json
  if($verification.status-eq 'CALIBRATED'){Write-Output 'RESOLUTION_GATE_CALIBRATED'}else{Write-Output 'RESOLUTION_GATE_PASS'}
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $evidence 'wrapper-error.log')
  throw
} finally {
  $env:FUNDING_TEST_DATABASE_URL=$previousTarget
  if($createdId){
    $owned=(& docker inspect --format '{{json .Config.Labels}}' $createdId | ConvertFrom-Json)
    if($LASTEXITCODE-ne 0 -or $owned.'c4g.funding-resolution'-ne $gateId){throw 'RESOLUTION_CONTAINER_OWNERSHIP_UNCONFIRMED'}
    & docker rm -f $createdId *> $null
    if($LASTEXITCODE-ne 0){throw 'RESOLUTION_CLEANUP_FAILED'}
    if((& docker ps -a --filter "label=c4g.funding-resolution=$gateId" --format '{{.ID}}')){throw 'RESOLUTION_CONTAINER_REMAINS'}
  }
  Pop-Location
}
