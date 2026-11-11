param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='browse-fingerprint-20261109')
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$folder=Join-Path $root "context/reviews/$Report"
if(Test-Path -LiteralPath $folder){throw 'REPORT_ALREADY_EXISTS'}
$run=[Guid]::NewGuid().ToString('N')
$container="c4g-browse-fingerprint-$run"
$previousPassword=$env:POSTGRES_PASSWORD
$created=$false
try {
  # Require an existing image: no registry download and no published ports.
  & docker image inspect postgres:18-alpine --format '{{.Id}}' *> $null
  if($LASTEXITCODE -ne 0){throw 'POSTGRES_IMAGE_REQUIRED'}
  $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  & docker run --detach --pull never --network none --name $container --label "c4g.browse-fingerprint=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=proof postgres:18-alpine | Out-Null
  if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'}
  $created=$true
  $ready=$false
  for($attempt=0;$attempt -lt 60;$attempt++){
    & docker exec $container pg_isready -U proof_admin -d proof *> $null
    if($LASTEXITCODE -eq 0){$ready=$true;break}
    Start-Sleep -Milliseconds 500
  }
  if(-not $ready){throw 'ISOLATED_POSTGRES_NOT_READY'}
  New-Item -ItemType Directory -Path $folder | Out-Null
  & docker image inspect postgres:18-alpine --format '{{.Id}}' | Set-Content -LiteralPath (Join-Path $folder 'image.txt')
  Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'measure.sql'),(Join-Path $root 'backend/src/applications/browseSql.js') | Select-Object Path,Hash | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'sources.json')
  # psql uses only the container's local socket; SQL is piped without host mounts.
  Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'measure.sql') | & docker exec -i $container psql -X -A -t -U proof_admin -d proof -v ON_ERROR_STOP=1 -f - 2>&1 | Set-Content -LiteralPath (Join-Path $folder 'plans.txt')
  if($LASTEXITCODE -ne 0){throw 'FINGERPRINT_MEASUREMENT_FAILED'}
  Write-Output "MEASUREMENT_COMPLETE $Report"
} finally {
  $env:POSTGRES_PASSWORD=$previousPassword
  if($created){
    $labels=& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or $labels.'c4g.browse-fingerprint' -ne $run){throw 'CLEANUP_OWNERSHIP_UNCONFIRMED'}
    & docker rm --force --volumes $container *> $null
    if($LASTEXITCODE -ne 0){throw 'ISOLATED_CLEANUP_FAILED'}
  }
}
