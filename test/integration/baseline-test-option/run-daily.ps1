param([ValidatePattern('^[a-z0-9-]+$')][Parameter(Mandatory=$true)][string]$Report)
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$reportFolder=Join-Path $root "context/reviews/$Report"
if(Test-Path -LiteralPath $reportFolder){throw 'REPORT_ALREADY_EXISTS'}
$previousNodeOptions=$env:NODE_OPTIONS
$loader=(Join-Path $PSScriptRoot '../browse-browser/preload.cjs').Replace('\','/')
$env:NODE_OPTIONS=($previousNodeOptions+' --require "'+$loader+'"').Trim()
$run=[Guid]::NewGuid().ToString('N')
$pg="c4g-http-pg-$run"; $kc="c4g-http-kc-$run"
$certs=Join-Path $root '.tmp/f2-integration'
foreach($file in @('localhost.crt','localhost.key','mkcert-rootCA.pem')) {
 if(-not (Test-Path -LiteralPath (Join-Path $certs $file))){throw 'ISOLATED_TEST_TLS_MISSING'}
}
function FreePort {
 $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
 $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop(); return $port
}
$pgPort=FreePort; while($pgPort -in @(5432,5433)){$pgPort=FreePort}; $kcPort=FreePort
$created=@()
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --pull never --name $pg --label "c4g.http-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${pgPort}:5432" postgres:18-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'}; $created+=$pg
 $pgReady=$false
 for($attempt=0;$attempt -lt 60;$attempt++){
  & docker exec $pg pg_isready -U proof_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$pgReady=$true;break}
  Start-Sleep -Milliseconds 500
 }
 if(-not $pgReady){throw 'ISOLATED_POSTGRES_NOT_READY'}
 $env:KC_BOOTSTRAP_ADMIN_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --pull never --name $kc --label "c4g.http-proof=$run" --env KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD --mount "type=bind,source=$certs/localhost.crt,target=/certs/localhost.crt,readonly" --mount "type=bind,source=$certs/localhost.key,target=/certs/localhost.key,readonly" -p "127.0.0.1:${kcPort}:8443" quay.io/keycloak/keycloak:26.8.0 start-dev "--hostname=https://localhost:$kcPort" --https-certificate-file=/certs/localhost.crt --https-certificate-key-file=/certs/localhost.key --http-access-log-enabled=false | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_KEYCLOAK_START_FAILED'}; $created+=$kc
 $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${pgPort}/postgres"
 $env:HTTP_PROOF_KEYCLOAK="https://localhost:$kcPort"
 $env:HTTP_PROOF_RUN=$run
 $env:HTTP_CONTENTION_MODE='standard'
 $env:PAGE_ONLY='1'; $env:PAGE_VARIANT='B'
 $env:HTTP_PROOF_REPORT=$Report
 $env:HTTP_PROOF_TLS=$certs
 $env:NODE_EXTRA_CA_CERTS=Join-Path $certs 'mkcert-rootCA.pem'
 & node (Join-Path $PSScriptRoot '../browse-browser/profile.cjs')
 $profileExit=$LASTEXITCODE
 $images=@(& docker image inspect postgres:18-alpine quay.io/keycloak/keycloak:26.8.0 --format '{{.Id}}')
 if(Test-Path -LiteralPath $reportFolder){@{variant=$env:PAGE_VARIANT;images=$images;wrapperHash=(Get-FileHash -LiteralPath $PSCommandPath).Hash}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $reportFolder 'run-config.json') -Encoding UTF8}
 if($profileExit -ne 0){throw 'HTTP_CONTENTION_PROFILE_FAILED; see sanitized results.json'}
} finally {
 $env:NODE_OPTIONS=$previousNodeOptions
 $cleanupFailed=$false
 foreach($container in $created) {
  try {
   $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
   if($LASTEXITCODE -ne 0 -or $labels.'c4g.http-proof' -ne $run){throw 'OWNERSHIP_UNCONFIRMED'}
   & docker rm --force --volumes $container *> $null
   if($LASTEXITCODE -ne 0){throw 'REMOVE_FAILED'}
  } catch {$cleanupFailed=$true}
 }
 Remove-Item Env:POSTGRES_PASSWORD,Env:KC_BOOTSTRAP_ADMIN_PASSWORD,Env:HTTP_PROOF_ADMIN_URL,Env:HTTP_PROOF_KEYCLOAK,Env:HTTP_PROOF_RUN,Env:HTTP_CONTENTION_MODE,Env:HTTP_PROOF_REPORT,Env:HTTP_PROOF_TLS,Env:NODE_EXTRA_CA_CERTS,Env:PAGE_ONLY,Env:PAGE_VARIANT -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath $reportFolder){@{status=$(if($cleanupFailed){'FAIL'}else{'PASS'});run=$run;containers=$created}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $reportFolder 'cleanup.json') -Encoding UTF8}
 if($cleanupFailed){throw 'OWNED_CLEANUP_FAILED'}
}
