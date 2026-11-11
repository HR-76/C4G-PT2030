$ErrorActionPreference = 'Continue'
$repoRoot = Resolve-Path "$PSScriptRoot/../../.."
$tempPath = Join-Path $repoRoot '.tmp/f2-integration'
$envFile = Join-Path $tempPath '.env'
$failures = [Collections.Generic.List[string]]::new()

if (Test-Path -LiteralPath $envFile) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
  }
}

& node "$PSScriptRoot/process-lifecycle.js" stop-all
if ($LASTEXITCODE -ne 0) { $failures.Add('Validated F2 process teardown failed; no port-selected process was terminated.') }

foreach ($name in @('F2_CENTRAL_PASSWORD','F2_LEGACY_PASSWORD','F2_KEYCLOAK_ADMIN_PASSWORD','F2_USER_PASSWORD','F2_ADMIN_PASSWORD','F2_ADMIN_TOTP_SECRET')) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    [Environment]::SetEnvironmentVariable($name, 'teardown-placeholder', 'Process')
  }
}
if (-not $env:F2_SECRET_DIR) { $env:F2_SECRET_DIR = $tempPath.Replace('\','/') }

$composeArgs = @('compose', '-p', 'c4g-f2-integration')
if (Test-Path -LiteralPath $envFile) { $composeArgs += @('--env-file', $envFile) }
$composeArgs += @('-f', "$PSScriptRoot/compose.yaml", 'down', '--volumes', '--remove-orphans')
& docker @composeArgs
if ($LASTEXITCODE -ne 0) { $failures.Add('Disposable Docker teardown failed.') }

$remainingContainers = @(docker ps -aq --filter 'label=com.docker.compose.project=c4g-f2-integration')
$remainingVolumes = @(docker volume ls -q --filter 'label=com.docker.compose.project=c4g-f2-integration')
$remainingNetworks = @(docker network ls -q --filter 'label=com.docker.compose.project=c4g-f2-integration')
if ($LASTEXITCODE -ne 0 -or $remainingContainers.Count -gt 0 -or $remainingVolumes.Count -gt 0 -or $remainingNetworks.Count -gt 0) {
  $failures.Add('Disposable Docker resources remain after teardown.')
}

function Remove-F2SensitiveArtifacts {
  foreach ($name in @('.env','mkcert-rootCA.pem','localhost.crt','localhost.key','api.stdout.log','api.stderr.log','frontend.stdout.log','frontend.stderr.log')) {
    $target = Join-Path $tempPath $name
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  }
  $playwrightPath = Join-Path $tempPath 'playwright'
  if (Test-Path -LiteralPath $playwrightPath) {
    $resolvedPlaywright = (Resolve-Path -LiteralPath $playwrightPath).Path
    $resolvedTempRoot = if (Test-Path -LiteralPath $tempPath) { (Resolve-Path -LiteralPath $tempPath).Path } else { $null }
    if (-not $resolvedTempRoot -or -not $resolvedPlaywright.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove an unexpected Playwright path.'
    }
    Remove-Item -LiteralPath $resolvedPlaywright -Recurse -Force
  }
}

if ($failures.Count -gt 0) {
  Remove-F2SensitiveArtifacts
  throw ($failures -join ' ')
}

if (Test-Path -LiteralPath $tempPath) {
  $resolvedTemp = (Resolve-Path -LiteralPath $tempPath).Path
  $resolvedRoot = (Resolve-Path -LiteralPath $repoRoot).Path
  if (-not $resolvedTemp.StartsWith((Join-Path $resolvedRoot '.tmp'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove an unexpected teardown path.'
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
