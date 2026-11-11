$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/../../..").Path
$privateFolder = Join-Path $repoRoot '.tmp/local-platform'
New-Item -ItemType Directory -Force -Path $privateFolder | Out-Null
$accountSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls $privateFolder /inheritance:r /grant:r "*${accountSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger a configuração privada local.' }
& node (Join-Path $PSScriptRoot 'setup.js')
exit $LASTEXITCODE
