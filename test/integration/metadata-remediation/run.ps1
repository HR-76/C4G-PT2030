param([ValidateSet('A','B')][string]$Variant,[ValidatePattern('^[a-z0-9-]+$')][string]$Report,[switch]$Proof)
$ErrorActionPreference='Stop'
if($Proof -and $Variant -ne 'B'){throw 'PROOF_REQUIRES_B'}
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$out=Join-Path $root "context/reviews/$Report"
if(Test-Path -LiteralPath $out){throw 'REPORT_ALREADY_EXISTS'}
New-Item -ItemType Directory -Path $out | Out-Null
$oldOptions=$env:NODE_OPTIONS
function Fingerprint {
 $files=@(Get-ChildItem -LiteralPath (Join-Path $root 'backend/src'),(Join-Path $root 'frontend/src'),(Join-Path $root 'backend/database'),$PSScriptRoot,(Join-Path $root 'test/integration/http-contention'),(Join-Path $root 'test/integration/http-oidc') -File -Recurse)
 $files+=Get-Item -LiteralPath (Join-Path $root 'backend/package-lock.json'),(Join-Path $root 'frontend/package-lock.json')
 return @($files | Sort-Object FullName | ForEach-Object {[PSCustomObject]@{path=$_.FullName.Substring($root.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}})
}
$before=Fingerprint
$before | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'source-manifest.json')
@{variant=$Variant;proof=[bool]$Proof;images=@(& docker image inspect postgres:17-alpine quay.io/keycloak/keycloak:26.8.0 --format '{{.Id}}')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'run-config.json')
try {
 $env:METADATA_VARIANT=$Variant
 $env:METADATA_PROOF=if($Proof){'1'}else{'0'}
 $env:NODE_OPTIONS=($oldOptions+' --require "'+((Join-Path $PSScriptRoot 'preload.cjs') -replace '\\','/')+'"').Trim()
 & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'test/integration/http-contention/profile.ps1') -Report $Report
 if($LASTEXITCODE -ne 0){throw 'METADATA_DIAGNOSTIC_FAILED'}
} finally {
 $env:NODE_OPTIONS=$oldOptions
 Remove-Item Env:METADATA_VARIANT,Env:METADATA_PROOF -ErrorAction SilentlyContinue
 $after=Fingerprint
 $unchanged=($before | ConvertTo-Json -Compress) -ceq ($after | ConvertTo-Json -Compress)
 @{unchanged=$unchanged} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'integrity.json')
 if(-not $unchanged){throw 'SOURCE_CHANGED_DURING_MEASUREMENT'}
}
