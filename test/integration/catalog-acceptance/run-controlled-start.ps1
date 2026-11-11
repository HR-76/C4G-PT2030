param([ValidateRange(4,100)][int]$Samples=12,[ValidateSet('all','revocation','sessions')][string]$Scope='all',[ValidatePattern('^[a-z0-9-]+$')][string]$Report='catalog-read-acceptance-load',[Parameter(Mandatory=$true)][string]$UiBuild,[switch]$Controls,[switch]$Durable,[switch]$Load,[switch]$Profile,[switch]$ProfileOnly,[switch]$SqlOnly,[switch]$SharedSessionReads,[switch]$SessionProfile,[switch]$CoalesceTouches)
$ErrorActionPreference='Stop'
if($CoalesceTouches){$Durable=$true}
if($SharedSessionReads){$Durable=$true}
if($SqlOnly){$Profile=$true;$Durable=$true}
if($ProfileOnly){$Profile=$true;$Load=$true;$Durable=$true}
if($Load -and -not $Durable){throw 'LOAD_REQUIRES_DURABLE_REHEARSAL'}
if($Durable){$Controls=$true}
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
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
$pgPort=FreePort; $kcPort=FreePort
$created=@()
$env:CATALOG_ACCEPTANCE_UI=(Resolve-Path -LiteralPath $UiBuild).Path
if(-not(Test-Path -LiteralPath (Join-Path $env:CATALOG_ACCEPTANCE_UI 'index.html'))){throw 'ISOLATED_UI_BUILD_MISSING'}
$env:CATALOG_COALESCE_TOUCHES=if($CoalesceTouches){'1'}else{'0'}
$env:CATALOG_SESSION_PROFILE=if($SessionProfile){'1'}else{'0'}
$env:CATALOG_SHARED_SESSION_READS=if($SharedSessionReads){'1'}else{'0'}
$env:CATALOG_SQL_ONLY=if($SqlOnly){'1'}else{'0'}
$env:CATALOG_PHASE_PROFILE=if($Profile){'1'}else{'0'}
$env:CATALOG_PROFILE_ONLY=if($ProfileOnly){'1'}else{'0'}
$env:CATALOG_DURABLE_REHEARSAL=if($Durable){'1'}else{'0'}
$env:CATALOG_DURABLE_LOAD=if($Load){'1'}else{'0'}
$env:CATALOG_CONTROL_REHEARSAL=if($Controls){'1'}else{'0'}
try {
 $env:POSTGRES_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $pg --label "c4g.http-proof=$run" --env POSTGRES_PASSWORD --env POSTGRES_USER=proof_admin --env POSTGRES_DB=postgres -p "127.0.0.1:${pgPort}:5432" postgres:18-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_POSTGRES_START_FAILED'}; $created+=$pg
 $pgReady=$false
 for($attempt=0;$attempt -lt 60;$attempt++){
  & docker exec $pg pg_isready -U proof_admin -d postgres *> $null
  if($LASTEXITCODE -eq 0){$pgReady=$true;break}
  Start-Sleep -Milliseconds 500
 }
 if(-not $pgReady){throw 'ISOLATED_POSTGRES_NOT_READY'}
 $env:KC_BOOTSTRAP_ADMIN_PASSWORD=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $kc --label "c4g.http-proof=$run" --env KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD --mount "type=bind,source=$certs/localhost.crt,target=/certs/localhost.crt,readonly" --mount "type=bind,source=$certs/localhost.key,target=/certs/localhost.key,readonly" -p "127.0.0.1:${kcPort}:8443" quay.io/keycloak/keycloak:26.8.0 start-dev "--hostname=https://localhost:$kcPort" --https-certificate-file=/certs/localhost.crt --https-certificate-key-file=/certs/localhost.key --http-access-log-enabled=false | Out-Null
 if($LASTEXITCODE -ne 0){throw 'ISOLATED_KEYCLOAK_START_FAILED'}; $created+=$kc
 $env:HTTP_PROOF_ADMIN_URL="postgresql://proof_admin:$($env:POSTGRES_PASSWORD)@127.0.0.1:${pgPort}/postgres"
 $env:HTTP_PROOF_KEYCLOAK="https://localhost:$kcPort"
 $env:HTTP_PROOF_RUN=$run
 $env:HTTP_PROOF_SAMPLES=[string]$Samples
 $env:HTTP_PROOF_SCOPE=$Scope
 $env:HTTP_PROOF_REPORT=$Report
 $env:HTTP_PROOF_TLS=$certs
 $env:NODE_EXTRA_CA_CERTS=Join-Path $certs 'mkcert-rootCA.pem'
 & node (Join-Path $PSScriptRoot 'controlled-start-e2e.cjs')
 if($LASTEXITCODE -ne 0){throw 'HTTP_OIDC_GATE_FAILED; see sanitized results.json'}
} finally {
 $cleanup=@{ownedContainersRemoved=$true;ownedContainersCreated=$created.Count;run=$run}
 foreach($container in $created) {
  $labels=(& docker inspect --format '{{json .Config.Labels}}' $container | ConvertFrom-Json)
  if($LASTEXITCODE -eq 0 -and $labels.'c4g.http-proof' -eq $run){& docker rm --force --volumes $container *> $null; if($LASTEXITCODE -ne 0){$cleanup.ownedContainersRemoved=$false}} else {$cleanup.ownedContainersRemoved=$false}
 }
 $reportFolder=Join-Path $root ('context/reviews/catalog-read-acceptance-load/'+$run)
 New-Item -ItemType Directory -Force -Path $reportFolder | Out-Null
 $cleanup | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportFolder 'cleanup.json') -Encoding utf8
 Remove-Item Env:CATALOG_COALESCE_TOUCHES,Env:CATALOG_SESSION_PROFILE,Env:CATALOG_SHARED_SESSION_READS,Env:CATALOG_SQL_ONLY,Env:CATALOG_PHASE_PROFILE,Env:CATALOG_PROFILE_ONLY,Env:CATALOG_DURABLE_REHEARSAL,Env:CATALOG_DURABLE_LOAD,Env:CATALOG_CONTROL_REHEARSAL,Env:CATALOG_ACCEPTANCE_UI,Env:POSTGRES_PASSWORD,Env:KC_BOOTSTRAP_ADMIN_PASSWORD,Env:HTTP_PROOF_ADMIN_URL,Env:HTTP_PROOF_KEYCLOAK,Env:HTTP_PROOF_RUN,Env:HTTP_PROOF_SAMPLES,Env:HTTP_PROOF_SCOPE,Env:HTTP_PROOF_REPORT,Env:HTTP_PROOF_TLS,Env:NODE_EXTRA_CA_CERTS -ErrorAction SilentlyContinue
}