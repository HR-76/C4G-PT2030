param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$pg="c4g-onboarding-real-pg-$PID"; $kc="c4g-onboarding-real-kc-$PID"
$password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$scratch=Join-Path $root ".tmp/onboarding-real-$PID"
$certs=Join-Path $root '.tmp/f2-integration'
if(-not (Test-Path (Join-Path $certs 'localhost.crt'))){throw 'Local test TLS certificate is missing'}
try {
 New-Item -ItemType Directory -Path $scratch -Force | Out-Null
 $isolatedCerts=Join-Path $scratch 'tls'
 New-Item -ItemType Directory -Path $isolatedCerts -Force | Out-Null
 foreach($certificate in @('localhost.crt','localhost.key','mkcert-rootCA.pem')){Copy-Item -LiteralPath (Join-Path $certs $certificate) -Destination (Join-Path $isolatedCerts $certificate)}
 if(-not $SkipBuild){& docker build --tag c4g-manual-activation-proof:26.8.0 (Join-Path $PSScriptRoot 'keycloak');if($LASTEXITCODE -ne 0){throw 'Isolated Keycloak build failed'}}
 & docker run --detach --name $pg --env "POSTGRES_PASSWORD=$password" --env POSTGRES_USER=c4g_f12_admin --env POSTGRES_DB=postgres -p 127.0.0.1:5598:5432 postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Isolated PostgreSQL failed'}
 $env:KC_BOOTSTRAP_ADMIN_PASSWORD=[Guid]::NewGuid().ToString('N')
 $env:C4G_PROOF_BRIDGE_SECRET=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 & docker run --detach --name $kc --env KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD --env C4G_PROOF_BRIDGE_SECRET --mount "type=bind,source=$isolatedCerts,target=/certs,readonly" -p 127.0.0.1:8283:8443 c4g-manual-activation-proof:26.8.0 start-dev --hostname=https://localhost:8283 --https-certificate-file=/certs/localhost.crt --https-certificate-key-file=/certs/localhost.key --http-access-log-enabled=false | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Isolated Keycloak failed'}
 $env:F13_S2_ADMIN_URL="postgresql://c4g_f12_admin:$password@127.0.0.1:5598/postgres"
 $env:ONBOARDING_JOURNAL_KEY=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
 $env:ONBOARDING_JOURNAL_DIR=$scratch
 $env:NODE_EXTRA_CA_CERTS=Join-Path $certs 'mkcert-rootCA.pem'
 $env:ONBOARDING_TLS_DIR=$certs
 $ready=$false
 for($i=0;$i -lt 90;$i++){try{$r=Invoke-WebRequest -UseBasicParsing 'https://localhost:8283/realms/master/.well-known/openid-configuration';if($r.StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Seconds 1}
 if(-not $ready){throw 'Isolated Keycloak not ready'}
 & node (Join-Path $PSScriptRoot 'real-gate.js')
 if($LASTEXITCODE -ne 0){throw 'Real onboarding gate failed'}
} finally {
 Remove-Item Env:F13_S2_ADMIN_URL,Env:KC_BOOTSTRAP_ADMIN_PASSWORD,Env:C4G_PROOF_BRIDGE_SECRET,Env:ONBOARDING_JOURNAL_KEY,Env:ONBOARDING_JOURNAL_DIR,Env:NODE_EXTRA_CA_CERTS,Env:ONBOARDING_TLS_DIR -ErrorAction SilentlyContinue
 & docker rm --force --volumes $kc $pg *> $null
 # Only this invocation's encrypted scratch directory, checked within workspace.
 $resolved=[IO.Path]::GetFullPath($scratch)
 if($resolved.StartsWith([IO.Path]::GetFullPath((Join-Path $root '.tmp'))+[IO.Path]::DirectorySeparatorChar) -and (Test-Path -LiteralPath $resolved)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
