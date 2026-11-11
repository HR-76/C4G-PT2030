param([ValidateSet('Inspect','Stop','Start')][string]$Action='Inspect',[int]$ExpectedId=0,[string]$ExpectedCreated='', [string]$LogPrefix='')
$ErrorActionPreference='Stop'
$rootPath=Split-Path $PSScriptRoot -Parent
$nodePath='C:\Program Files\nodejs\node.exe'
if($Action -eq 'Start'){
  $logRoot=[IO.Path]::GetFullPath((Join-Path $rootPath '.tmp/local-platform'))+[IO.Path]::DirectorySeparatorChar
  $resolved=[IO.Path]::GetFullPath($LogPrefix)
  if(-not $resolved.StartsWith($logRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'LOG_PATH_REFUSED'}
  $running=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -match '(?:^|\s)scripts/start-local\.cjs\s*$'})
  if($running.Count -ne 0){throw 'SUPERVISOR_ALREADY_PRESENT'}
  $started=Start-Process -FilePath $nodePath -ArgumentList 'scripts/start-local.cjs' -WorkingDirectory $rootPath -WindowStyle Hidden -RedirectStandardOutput ($resolved+'.out.log') -RedirectStandardError ($resolved+'.err.log') -PassThru
  @{id=$started.Id;started=$true} | ConvertTo-Json -Compress
  exit 0
}
$all=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
$roots=@($all | Where-Object {$_.CommandLine -match '(?:^|\s)scripts/start-local\.cjs\s*$'})
if($roots.Count -ne 1){throw 'UNIQUE_SUPERVISOR_REQUIRED'}
$supervisor=$roots[0]
$created=$supervisor.CreationDate.ToUniversalTime().ToString('o')
if($ExpectedId -and ($supervisor.ProcessId -ne $ExpectedId -or $created -ne $ExpectedCreated)){throw 'SUPERVISOR_CHANGED'}
$tree=@($supervisor);$changed=$true
while($changed){$changed=$false;foreach($process in $all){if($process.ParentProcessId -in $tree.ProcessId -and $process.ProcessId -notin $tree.ProcessId){$tree+= $process;$changed=$true}}}
$allowed=@(
 ('"'+$nodePath+'" '+(Join-Path $rootPath 'backend/node_modules/nodemon/bin/nodemon.js').Replace('/','\')+' --exitcrash scripts/startDev.js'),
 ('"'+$nodePath+'" scripts/startDev.js'),
 ('"'+$nodePath+'" scripts/localPlatform/worker.js'),
 ('"'+$nodePath+'" '+(Join-Path $rootPath 'frontend/node_modules/vite/bin/vite.js').Replace('/','\')),
 ('"'+$nodePath+'" '+(Join-Path $rootPath 'backend/scripts/localPlatform/admissionWorker.js').Replace('/','\')+' '+(Join-Path $rootPath '.tmp/local-platform/admissions/worker.json').Replace('/','\'))
)
foreach($process in $tree){
 if($process.ExecutablePath -ne $nodePath){throw 'EXECUTABLE_REFUSED'}
 if($process.ProcessId -ne $supervisor.ProcessId -and $process.CommandLine -notin $allowed){throw 'UNKNOWN_DESCENDANT'}
}
foreach($port in @(3000,5000)){
 # This Windows provider reports the listening endpoint with an empty State;
 # RemotePort=0 identifies the bound endpoint. HTTP readiness is checked by caller.
 $listeners=@(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object {$_.RemotePort -eq 0})
 if($listeners.Count -eq 0 -or @($listeners | Where-Object {$_.OwningProcess -notin $tree.ProcessId}).Count){throw 'PORT_OWNER_MISMATCH'}
}
$result=@{id=[int]$supervisor.ProcessId;created=$created;descendants=@($tree.ProcessId);verified=$true}
if($Action -eq 'Stop'){
 # The caller holds table locks and has verified no running work. This is the
 # same Windows termination mechanism used by the existing local supervisor.
 & taskkill /PID $supervisor.ProcessId /T /F *> $null
 if($LASTEXITCODE -ne 0){throw 'SUPERVISOR_STOP_FAILED'}
 $result.stopped=$true
}
$result | ConvertTo-Json -Compress
