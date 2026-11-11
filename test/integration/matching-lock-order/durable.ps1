param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='matching-durable-20261110')
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
if(Test-Path -LiteralPath (Join-Path $root "context/reviews/$Report")){throw 'REPORT_ALREADY_EXISTS'}
$run=[Guid]::NewGuid().ToString('N'); $container="c4g-matching-durable-$run"; $created=$false
$names=@('POSTGRES_PASSWORD','HTTP_PROOF_ADMIN_URL','HTTP_PROOF_RUN','MATCHING_INTEGRATED_REPORT','MATCHING_DURABLE_CONTAINER')
$previous=@{}; foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
 & docker image inspect postgres:17-alpine --format '{{.Id}}' *> $null
 if($LASTEXITCODE -ne 0){throw 'POSTGRES_IMAGE_REQUIRED'}
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --pull never --name $container --label "c4g.matching-durable=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p '127.0.0.1::5432' postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'POSTGRES_START_FAILED'}; $created=$true
 $portText=& docker port $container 5432/tcp
 if($LASTEXITCODE -ne 0 -or $portText -notmatch '^127\.0\.0\.1:(\d+)$'){throw 'PORT_INVALID'}
 $portNumber=$Matches[1]; $ready=$false
 for($attempt=0;$attempt -lt 60;$attempt++){& docker exec $container pg_isready -U proof_admin -d postgres *> $null; if($LASTEXITCODE -eq 0){$ready=$true;break}; Start-Sleep -Milliseconds 500}
 if(-not $ready){throw 'POSTGRES_NOT_READY'}
 $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${portNumber}/postgres"
 $env:HTTP_PROOF_RUN=$run; $env:MATCHING_INTEGRATED_REPORT=$Report; $env:MATCHING_DURABLE_CONTAINER=$container
 & node (Join-Path $PSScriptRoot 'durable.cjs')
 if($LASTEXITCODE -ne 0){throw 'MATCHING_DURABLE_FAILED'}
} finally {
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
 if($created){$labels=& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $labels.'c4g.matching-durable' -ne $run){throw 'CLEANUP_OWNERSHIP_UNCONFIRMED'}
  & docker rm --force --volumes $container *> $null
  if($LASTEXITCODE -ne 0){throw 'CLEANUP_FAILED'}
  Write-Output 'OWNED_CONTAINER_REMOVED'
 }
}
