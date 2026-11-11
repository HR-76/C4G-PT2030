$ErrorActionPreference = 'Stop'
$previous = $env:CRITERIA_GATE
try {
  $env:CRITERIA_GATE = '1'
  & (Join-Path $PSScriptRoot '../f13/editorial-ui-gate.ps1') -Port 5576
} finally {
  if ($null -eq $previous) { Remove-Item Env:CRITERIA_GATE -ErrorAction SilentlyContinue }
  else { $env:CRITERIA_GATE = $previous }
}
