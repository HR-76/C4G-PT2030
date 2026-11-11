param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='authority-short-groups')
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$run=[Guid]::NewGuid().ToString('N')
$container="c4g-authority-short-groups-$run"
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
$created=$false
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $container --label "c4g.authority-short-groups-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'}; $created=$true
 $ready=$false
 for($attempt=0;$attempt -lt 60;$attempt++){
  & docker exec $container pg_isready -U proof_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Milliseconds 500
 }
 if(-not $ready){throw 'ISOLATED_POSTGRES_NOT_READY'}
 $env:AUTHORITY_SHORT_GROUPS_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${port}/postgres"
 $env:AUTHORITY_SHORT_GROUPS_RUN=$run
 $env:AUTHORITY_SHORT_GROUPS_REPORT=$Report
 & node (Join-Path $PSScriptRoot 'proof.js')
 if($LASTEXITCODE -ne 0){throw 'AUTHORITY_SHORT_GROUPS_PROOF_FAILED; see sanitized postgres-short-groups.json'}
} finally {
 if($created){
  $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
  if($LASTEXITCODE -eq 0 -and $labels.'c4g.authority-short-groups-proof' -eq $run){& docker rm --force --volumes $container *> $null}
 }
 Remove-Item Env:POSTGRES_PASSWORD,Env:AUTHORITY_SHORT_GROUPS_ADMIN_URL,Env:AUTHORITY_SHORT_GROUPS_RUN,Env:AUTHORITY_SHORT_GROUPS_REPORT -ErrorAction SilentlyContinue
}
