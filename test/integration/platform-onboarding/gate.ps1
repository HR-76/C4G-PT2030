param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$tag='c4g-manual-activation-proof:26.8.0'
$pg="c4g-onboarding-pg-$PID"
$kc="c4g-onboarding-kc-$PID"
$password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
try {
 if(-not $SkipBuild){& docker build --tag $tag (Join-Path $PSScriptRoot 'keycloak');if($LASTEXITCODE -ne 0){throw 'Proof image build failed'}}
 & docker run --detach --name $pg --label c4g.proof=manual-onboarding --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p 127.0.0.1:5598:5432 postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Disposable PostgreSQL unavailable'}
 $env:KC_BOOTSTRAP_ADMIN_PASSWORD=[Guid]::NewGuid().ToString('N')
 $env:C4G_PROOF_BRIDGE_SECRET=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $kc --label c4g.proof=manual-onboarding --env KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD --env C4G_PROOF_BRIDGE_SECRET -p 127.0.0.1:8283:8080 $tag start-dev --hostname=http://localhost:8283 --http-access-log-enabled=false | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Disposable Keycloak unavailable'}
 $env:F13_S2_DISPOSABLE_PROOF='C4G_F13_S2_DISPOSABLE_V1'
 $env:F13_S2_ADMIN_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:5598/postgres"
 $env:DIRECTORY_SLICE_ONLY='1';$env:PILOT_PEOPLE_SLICE='1';$env:PLATFORM_ONBOARDING_PROOF='1'
 $ready=$false
 for($i=0;$i -lt 90;$i++){
  try{$r=Invoke-WebRequest -UseBasicParsing 'http://localhost:8283/realms/master/.well-known/openid-configuration';if($r.StatusCode -eq 200){$ready=$true;break}}catch{}
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'Disposable Keycloak did not become ready'}
 & node (Join-Path $PSScriptRoot '../c4g/runtime-gate.js')
 if($LASTEXITCODE -ne 0){throw 'Isolated onboarding proof failed'}
} finally {
 Remove-Item Env:KC_BOOTSTRAP_ADMIN_PASSWORD,Env:C4G_PROOF_BRIDGE_SECRET,Env:F13_S2_DISPOSABLE_PROOF,Env:F13_S2_ADMIN_URL,Env:DIRECTORY_SLICE_ONLY,Env:PILOT_PEOPLE_SLICE,Env:PLATFORM_ONBOARDING_PROOF -ErrorAction SilentlyContinue
 # Only the unique disposable resources created by this invocation.
 & docker rm --force --volumes $kc $pg *> $null
}
