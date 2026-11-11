param([ValidatePattern('^[a-z0-9-]+$')][string]$Report='dashboard-c1-stages')
$ErrorActionPreference='Stop'
$taskOriginalNodeOptions=$env:NODE_OPTIONS
$taskObserver=(Join-Path $PSScriptRoot 'stageObserver.js').Replace('\','/')
try {
 $env:NODE_OPTIONS=([string]$taskOriginalNodeOptions+' --require="'+$taskObserver+'"').Trim()
 & (Join-Path $PSScriptRoot '../http-contention/profile.ps1') -Mode standard -Report $Report
} finally {
 if($null -eq $taskOriginalNodeOptions){Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue}
 else{$env:NODE_OPTIONS=$taskOriginalNodeOptions}
}
