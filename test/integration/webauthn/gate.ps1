$ErrorActionPreference = 'Stop'
$run = [Guid]::NewGuid().ToString('N')
$container = "c4g-webauthn-proof-$run"
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$created = $false
try {
  $env:KC_BOOTSTRAP_ADMIN_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $env:WEBAUTHN_PROOF_ORIGIN = "http://localhost:$port"
  & docker run --detach --name $container --label "c4g.webauthn-proof=$run" --env KC_BOOTSTRAP_ADMIN_USERNAME=proof-admin --env KC_BOOTSTRAP_ADMIN_PASSWORD -p "127.0.0.1:${port}:8080" quay.io/keycloak/keycloak:26.8.0 start-dev "--hostname=$env:WEBAUTHN_PROOF_ORIGIN" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ISOLATED_KEYCLOAK_START_FAILED' }
  $created = $true
  & node (Join-Path $PSScriptRoot 'keycloak-proof.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'WEBAUTHN_PROOF_FAILED' }
} finally {
  if ($created) {
    $info = (& docker inspect $container | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -eq 0 -and $info.Config.Labels.'c4g.webauthn-proof' -eq $run) { & docker rm --force --volumes $container | Out-Null }
  }
  Remove-Item Env:KC_BOOTSTRAP_ADMIN_PASSWORD, Env:WEBAUTHN_PROOF_ORIGIN -ErrorAction SilentlyContinue
}
