$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path "$PSScriptRoot/../../.."
$tempRoot = Join-Path $repoRoot '.tmp/f2-integration'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

function New-Secret([int]$bytes = 32) {
  $buffer = [byte[]]::new($bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function New-Base32Secret([int]$characters = 32) {
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  $buffer = [byte[]]::new($characters)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  -join ($buffer | ForEach-Object { $alphabet[$_ -band 31] })
}

$centralPassword = New-Secret
$legacyPassword = New-Secret
$keycloakAdminPassword = New-Secret
$userPassword = New-Secret 12
$adminPassword = New-Secret 12
$adminTotpSecret = New-Base32Secret
$sessionSecret = New-Secret 48
$secretPath = $tempRoot.Replace('\\','/')
$mkcertCommand = Get-Command mkcert -ErrorAction SilentlyContinue
$mkcertPath = if ($mkcertCommand) { $mkcertCommand.Source } else { $null }
if (-not $mkcertPath) {
  $mkcertPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\mkcert.exe'
}
if (-not (Test-Path -LiteralPath $mkcertPath)) { throw 'mkcert is required for the disposable F2 HTTPS environment.' }
$mkcertCaRoot = & $mkcertPath -CAROOT
$mkcertRootCa = Join-Path $mkcertCaRoot 'rootCA.pem'
if (-not (Test-Path -LiteralPath $mkcertRootCa)) { throw 'The mkcert root CA is not installed.' }
$localRootCa = Join-Path $tempRoot 'mkcert-rootCA.pem'
Copy-Item -LiteralPath $mkcertRootCa -Destination $localRootCa -Force
& $mkcertPath -cert-file (Join-Path $tempRoot 'localhost.crt') -key-file (Join-Path $tempRoot 'localhost.key') localhost 127.0.0.1 '::1' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "mkcert certificate generation failed with exit code $LASTEXITCODE" }
$envFile = Join-Path $tempRoot '.env'
$envLines = @(
  "F2_CENTRAL_PASSWORD=$centralPassword"
  "F2_LEGACY_PASSWORD=$legacyPassword"
  "F2_KEYCLOAK_ADMIN_PASSWORD=$keycloakAdminPassword"
  "F2_USER_PASSWORD=$userPassword"
  "F2_ADMIN_PASSWORD=$adminPassword"
  "F2_ADMIN_TOTP_SECRET=$adminTotpSecret"
  "F2_SECRET_DIR=$secretPath"
  'AUTH_MODE=oidc'
  'NODE_ENV=production'
  'PUBLIC_APP_URL=https://localhost:8443'
  'OIDC_ISSUER=https://localhost:8443/realms/c4g-test'
  'OIDC_REDIRECT_URI=https://localhost:8443/api/auth/oidc/callback'
  'OIDC_POST_LOGOUT_REDIRECT_URI=https://localhost:8443/login'
  'OIDC_CLIENT_ID=c4g-local'
  "SESSION_SECRET=$sessionSecret"
  'SESSION_IDLE_MS=300000'
  'SESSION_ABSOLUTE_MS=1800000'
  'OIDC_TRANSACTION_MS=120000'
  'AUTH_POLICY_VERSION=f2-integration-stepup-v1'
  'AUTH_ASSURANCE_POLICY_JSON={"recent-auth":{"mfa":false,"maxAgeSeconds":300,"acceptedAcr":["c4g-loa1","c4g-loa2"],"acceptedAmr":["pwd"],"amrMode":"any"},"recent-mfa":{"mfa":true,"maxAgeSeconds":2,"acceptedAcr":["c4g-loa2"],"acceptedAmr":["otp"],"amrMode":"all"}}'
  'PRIVILEGED_LOGIN_ASSURANCE_CATEGORY=recent-mfa'
  'OIDC_PRIVILEGED_ROLE_NAMES=C4G_ADMIN,SUPPORT,ORG_ADMIN'
  'SESSION_COOKIE_NAME=__Host-c4g_session'
  'DB_HOST=127.0.0.1'
  'DB_PORT=5442'
  'DB_NAME=c4g_legacy'
  'DB_USER=c4g_legacy'
  "DB_PASSWORD=$legacyPassword"
  'CENTRAL_DB_HOST=127.0.0.1'
  'CENTRAL_DB_PORT=5441'
  'CENTRAL_DB_NAME=c4g_central'
  'CENTRAL_DB_USER=c4g_central'
  "CENTRAL_DB_PASSWORD=$centralPassword"
  "NODE_EXTRA_CA_CERTS=$localRootCa"
  'DISABLE_NOTIFICATION_SCHEDULER=true'
  'DISABLE_EU_FUNDING_CRON=true'
)
[IO.File]::WriteAllLines($envFile, $envLines, (New-Object Text.UTF8Encoding($false)))

docker compose --env-file $envFile -f "$PSScriptRoot/compose.yaml" up -d

$readyDeadline = (Get-Date).AddMinutes(2)
do {
  docker compose --env-file $envFile -f "$PSScriptRoot/compose.yaml" exec -T central-db pg_isready -U c4g_central -d c4g_central *> $null
  $centralReady = $LASTEXITCODE -eq 0
  docker compose --env-file $envFile -f "$PSScriptRoot/compose.yaml" exec -T legacy-db pg_isready -U c4g_legacy -d c4g_legacy *> $null
  $legacyReady = $LASTEXITCODE -eq 0
  $keycloakStatus = & curl.exe -s -o NUL -w '%{http_code}' 'http://127.0.0.1:8080/realms/c4g-test/.well-known/openid-configuration'
  if ($centralReady -and $legacyReady -and $keycloakStatus -eq '200') { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $readyDeadline)
if (-not $centralReady -or -not $legacyReady -or $keycloakStatus -ne '200') { throw 'Disposable dependencies did not become ready before the startup deadline.' }

Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
$env:NODE_EXTRA_CA_CERTS = $localRootCa
& node "$PSScriptRoot/migration-gate.js"
if ($LASTEXITCODE -ne 0) { throw 'Central migration forward/rollback gate failed.' }
& "$PSScriptRoot/configure-keycloak.ps1" -EnvFile $envFile

& node "$PSScriptRoot/process-lifecycle.js" start-all
if ($LASTEXITCODE -ne 0) { throw 'Disposable Node processes failed readiness.' }

Write-Output "F2 integration started. Synthetic credentials are stored only in $envFile"
