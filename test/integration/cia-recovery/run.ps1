param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='cia-recovery-20261109')
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
if(Test-Path -LiteralPath (Join-Path $root "context/reviews/$Report")){throw 'REPORT_ALREADY_EXISTS'}
$run=[Guid]::NewGuid().ToString('N'); $container="c4g-cia-restore-$run"; $created=$false
$objectContainer="c4g-cia-objects-$run"; $objectCreated=$false
$names=@('POSTGRES_PASSWORD','HTTP_PROOF_ADMIN_URL','HTTP_PROOF_RUN','CIA_REPORT','CIA_CONTAINER','MINIO_ROOT_USER','MINIO_ROOT_PASSWORD','CIA_OBJECT_PORT')
$previous=@{}; foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
  & docker image inspect postgres:18-alpine --format '{{.Id}}' *> $null
  if($LASTEXITCODE -ne 0){throw 'POSTGRES_IMAGE_REQUIRED'}
  & docker image inspect minio/minio:RELEASE.2024-01-16T16-07-38Z --format '{{.Id}}' *> $null
  if($LASTEXITCODE -ne 0){throw 'MINIO_IMAGE_REQUIRED'}
  $env:MINIO_ROOT_USER='proof'+[Guid]::NewGuid().ToString('N'); $env:MINIO_ROOT_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  & docker run --detach --pull never --name $objectContainer --label "c4g.cia-recovery=$run" --env MINIO_ROOT_USER --env MINIO_ROOT_PASSWORD -p '127.0.0.1::9000' minio/minio:RELEASE.2024-01-16T16-07-38Z server /data | Out-Null
  if($LASTEXITCODE -ne 0){throw 'MINIO_START_FAILED'}; $objectCreated=$true
  $objectPort=& docker port $objectContainer 9000/tcp
  if($LASTEXITCODE -ne 0 -or $objectPort -notmatch '^127\.0\.0\.1:(\d+)$'){throw 'OBJECT_PORT_INVALID'}
  $env:CIA_OBJECT_PORT=$Matches[1]
  $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  & docker run --detach --pull never --name $container --label "c4g.cia-restore=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p '127.0.0.1::5432' postgres:18-alpine | Out-Null
  if($LASTEXITCODE -ne 0){throw 'POSTGRES_START_FAILED'}; $created=$true
  $portText=& docker port $container 5432/tcp
  if($LASTEXITCODE -ne 0 -or $portText -notmatch '^127\.0\.0\.1:(\d+)$'){throw 'PORT_INVALID'}
  $portNumber=$Matches[1]
  $ready=$false
  for($attempt=0;$attempt -lt 60;$attempt++){
    & docker exec $container pg_isready -U proof_admin -d postgres *> $null
    if($LASTEXITCODE -eq 0){$ready=$true;break}; Start-Sleep -Milliseconds 500
  }
  if(-not $ready){throw 'POSTGRES_NOT_READY'}
  $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${portNumber}/postgres"
  $env:HTTP_PROOF_RUN=$run; $env:CIA_REPORT=$Report; $env:CIA_CONTAINER=$container
  & node (Join-Path $PSScriptRoot 'restore.cjs')
  if($LASTEXITCODE -ne 0){throw 'RECOVERY_PROOF_FAILED'}
  & docker image inspect postgres:18-alpine minio/minio:RELEASE.2024-01-16T16-07-38Z --format '{{.Id}}' | Set-Content -LiteralPath (Join-Path $root "context/reviews/$Report/image.txt")
} finally {
  foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
  $cleanupFailures=@()
  if($created){
    try {
      $labels=& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json
      if($LASTEXITCODE -ne 0 -or $labels.'c4g.cia-restore' -ne $run){throw 'CLEANUP_OWNERSHIP_UNCONFIRMED'}
      & docker rm --force --volumes $container *> $null
      if($LASTEXITCODE -ne 0){throw 'CLEANUP_FAILED'}
      Write-Output 'OWNED_CONTAINER_REMOVED'
    } catch {$cleanupFailures+='POSTGRES_CLEANUP_FAILED'}
  }
  if($objectCreated){
    try {
      $labels=& docker inspect --format '{{json .Config.Labels}}' $objectContainer | ConvertFrom-Json
      if($LASTEXITCODE -ne 0 -or $labels.'c4g.cia-recovery' -ne $run){throw 'OBJECT_CLEANUP_OWNERSHIP_UNCONFIRMED'}
      & docker rm --force --volumes $objectContainer *> $null
      if($LASTEXITCODE -ne 0){throw 'OBJECT_CLEANUP_FAILED'}
      Write-Output 'OWNED_OBJECT_CONTAINER_REMOVED'
    } catch {$cleanupFailures+='OBJECT_CLEANUP_FAILED'}
  }
  if($cleanupFailures.Count){throw ($cleanupFailures -join ',')}
}
