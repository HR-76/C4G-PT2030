param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='audit-dashboard-contention')
$ErrorActionPreference='Stop'
$run=[Guid]::NewGuid().ToString('N')
$container="c4g-audit-dashboard-$run"
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
$created=$false
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $container --label "c4g.audit-dashboard-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${port}:5432" postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'}; $created=$true
 $ready=$false
 for($attempt=0;$attempt -lt 60;$attempt++){
  & docker exec $container pg_isready -U proof_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$ready=$true;break}
  Start-Sleep -Milliseconds 500
 }
 if(-not $ready){throw 'ISOLATED_POSTGRES_NOT_READY'}
 $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${port}/postgres"
 $env:HTTP_PROOF_RUN=$run
 $env:AUDIT_DASHBOARD_REPORT=$Report
 & node (Join-Path $PSScriptRoot 'proof.js')
 if($LASTEXITCODE -ne 0){throw 'AUDIT_DASHBOARD_PROOF_FAILED; see sanitized postgres-proof.json'}
} finally {
 if($created){
  $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
  if($LASTEXITCODE -eq 0 -and $labels.'c4g.audit-dashboard-proof' -eq $run){& docker rm --force --volumes $container *> $null}
 }
 Remove-Item Env:POSTGRES_PASSWORD,Env:HTTP_PROOF_ADMIN_URL,Env:HTTP_PROOF_RUN,Env:AUDIT_DASHBOARD_REPORT -ErrorAction SilentlyContinue
}
