$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path "$PSScriptRoot/../../.."
$tempRoot = Join-Path $repoRoot '.tmp/f2-integration'

try {
  & "$PSScriptRoot/up.ps1"
  $envFile = Join-Path $tempRoot '.env'
  Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
  $playwrightRoot = Join-Path $tempRoot 'playwright'
  npm install --prefix $playwrightRoot --no-save --ignore-scripts --silent playwright-core@1.56.1
  if ($LASTEXITCODE -ne 0) { throw 'Temporary playwright-core installation failed.' }
  & node "$PSScriptRoot/gate.js"
  if ($LASTEXITCODE -ne 0) { throw 'F2 integration gate failed.' }
} finally {
  & "$PSScriptRoot/down.ps1"
}
