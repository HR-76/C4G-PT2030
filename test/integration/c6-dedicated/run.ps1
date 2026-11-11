param([ValidateSet('c6-dedicated-slo','c6-dedicated-slo-repeat','c6-regression-20261027-01')][string]$Report='c6-dedicated-slo',[ValidateSet('c6-ded','c6-dedr','c6-reg1')][string]$Prefix='c6-ded')
$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$out=Join-Path $root "context/reviews/$Report"
$protocol=Get-Content (Join-Path $out 'protocol.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($protocol.admissionSlo.approvalStatus -ne 'APPROVED_BY_USER' -or $protocol.host.identifier -ne 'current-workstation'){throw 'HOST_AND_SLO_APPROVAL_REQUIRED'}
$approvedPolicy=Get-Content (Join-Path $PSScriptRoot 'policy.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($criterion in $approvedPolicy.slo.PSObject.Properties){
 if($protocol.admissionSlo.($criterion.Name) -cne $criterion.Value){throw 'C6_SLO_POLICY_DRIFT'}
}
if($env:NODE_OPTIONS){throw 'NODE_OPTIONS_MUST_BE_EMPTY'}
if(Test-Path (Join-Path $out 'host-control.json')){throw 'REPORT_ALREADY_EXISTS'}
function HostConfig {
 $info=(& docker info --format '{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}');if($LASTEXITCODE -ne 0){throw 'DOCKER_INFO_FAILED'}
 $power=(& powercfg /getactivescheme);if($LASTEXITCODE -ne 0){throw 'POWER_PLAN_READ_FAILED'}
 $guid=[regex]::Match(($power -join ''),'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}').Value
 if(-not $guid){throw 'POWER_PLAN_INVALID'}
 $pg=(& docker image inspect --format '{{.Id}}' postgres:17-alpine);if($LASTEXITCODE -ne 0){throw 'PG_IMAGE_MISSING'}
 $kc=(& docker image inspect --format '{{.Id}}' quay.io/keycloak/keycloak:26.8.0);if($LASTEXITCODE -ne 0){throw 'KC_IMAGE_MISSING'}
 return [ordered]@{docker=($info -join '');powerPlan=$guid;postgresImage=$pg;keycloakImage=$kc}
}
$initial=HostConfig
$existing=@(& docker ps --format '{{.ID}}|{{.Names}}');if($LASTEXITCODE -ne 0){throw 'CONTAINER_INVENTORY_FAILED'}
$expectedNames=@('c4g-postgres17-dev','c4g-collabora-code')
if($existing.Count -ne 2){throw 'UNEXPECTED_ACTIVE_CONTAINERS'}
$targets=@()
foreach($line in $existing){$parts=$line.Split('|');if($parts.Count -ne 2 -or $parts[1] -notin $expectedNames){throw 'UNEXPECTED_ACTIVE_CONTAINER'}
 $state=(& docker inspect --format '{{.State.Running}}|{{.State.Paused}}' $parts[0]);if($LASTEXITCODE -ne 0 -or $state -ne 'true|false'){throw 'CONTAINER_STATE_NOT_ADMITTED'}
 $targets+=,[ordered]@{id=$parts[0];name=$parts[1];pausedByThisRun=$false;resumed=$false}
}
$order=@();foreach($pair in $protocol.pairs){foreach($v in $pair){$order+=if($v -eq 'A'){'before'}elseif($v -eq 'B'){'after'}else{throw 'INVALID_ORDER'}}}
if($order.Count -ne 12){throw 'INVALID_ORDER_LENGTH'}
$control=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o');order=$order;initial=$initial;containers=$targets;runs=@();status='RUNNING';cleanupErrors=@();slo=$protocol.admissionSlo;hostControls=$protocol.hostControls}
function SaveControl {$control | ConvertTo-Json -Depth 14 | Set-Content (Join-Path $out 'host-control.json') -Encoding UTF8}
function AssertPaused {
 $active=@(& docker ps --format '{{.ID}}');if($LASTEXITCODE -ne 0){throw 'CONTAINER_INVENTORY_FAILED'}
 if((($active|Sort-Object)-join ',') -ne (($targets.id|Sort-Object)-join ',')){throw 'UNEXPECTED_RUNNING_CONTAINER'}
 foreach($target in $targets){$state=(& docker inspect --format '{{.State.Paused}}' $target.id);if($LASTEXITCODE -ne 0 -or $state -ne 'true'){throw 'RESERVED_HOST_CONTAINER_DRIFT'}}
}
SaveControl
$paused=@();$job=$null
$stopFile=Join-Path $out 'background.stop'
try {
 foreach($target in $targets){& docker pause $target.id | Out-Null;if($LASTEXITCODE -ne 0){throw 'CONTAINER_PAUSE_FAILED'};$target.pausedByThisRun=$true;$paused+=,$target;SaveControl}
 AssertPaused
 $job=Start-Job -FilePath (Join-Path $PSScriptRoot 'background.ps1') -ArgumentList (Join-Path $out 'background.json'),$stopFile,$PID
 $protocol.executionStatus='RUNNING';$protocol.status='RUNNING_RESERVED_LOCAL_WINDOW';$protocol | ConvertTo-Json -Depth 14 | Set-Content (Join-Path $out 'protocol.json') -Encoding UTF8
 for($i=0;$i -lt $order.Count;$i++){
  $variant=$order[$i];$runReport="$Prefix-$($i+1)-$variant";$dir=Join-Path $root "context/reviews/$runReport"
  if(Test-Path -LiteralPath $dir){throw 'REPORT_ALREADY_EXISTS'}
  AssertPaused;$config=HostConfig
  if(($config|ConvertTo-Json -Compress) -ne ($initial|ConvertTo-Json -Compress)){throw 'HOST_CONFIGURATION_DRIFT'}
  New-Item -ItemType Directory -Path $dir | Out-Null
  $idle=$false
  for($attempt=1;$attempt -le 6;$attempt++){
   & node (Join-Path $PSScriptRoot 'hostCheck.js') (Join-Path $dir "idle-$attempt.json")
   if($LASTEXITCODE -eq 0){$idle=$true;break}
   if($LASTEXITCODE -ne 2){throw 'HOST_PROBE_FAILED'}
   Start-Sleep -Seconds 5
  }
  if(-not $idle){throw 'HOST_IDLE_NOT_REACHED'}
  if($job.State -ne 'Running'){throw 'BACKGROUND_OBSERVER_STOPPED'}
  $entry=[ordered]@{index=$i+1;variant=$variant;report=$runReport;config=$config;externalCpuBefore=0;startedAt=[DateTime]::UtcNow.ToString('o');status='RUNNING'}
  $control.runs+=,$entry;SaveControl
  $env:C6_VARIANT=$variant;$env:C6_EXTERNAL_CONTAINERS='';$env:NODE_OPTIONS='--require="'+(Join-Path $PSScriptRoot 'preload.js').Replace('\','/')+'"'
  Write-Output "START $runReport"
  try {
   & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '../http-contention/profile.ps1') -Mode capacity -Report $runReport > (Join-Path $dir 'profile.log') 2>&1
   $code=$LASTEXITCODE
  }finally{Remove-Item Env:NODE_OPTIONS,Env:C6_VARIANT,Env:C6_EXTERNAL_CONTAINERS -ErrorAction SilentlyContinue}
  $entry.finishedAt=[DateTime]::UtcNow.ToString('o');$entry.exitCode=$code;$entry.status=if($code -eq 0){'COMPLETE'}else{'FAIL'};SaveControl
  if($code -ne 0){throw 'CAPACITY_RUN_FAILED'}
  & node (Join-Path $PSScriptRoot '../http-contention/summarize.js') (Join-Path $dir 'results.json') > (Join-Path $dir 'summary.log') 2>&1
  if($LASTEXITCODE -ne 0){throw 'SUMMARY_FAILED'}
  AssertPaused;Write-Output "COMPLETE $runReport"
 }
 $final=HostConfig;if(($final|ConvertTo-Json -Compress) -ne ($initial|ConvertTo-Json -Compress)){throw 'FINAL_HOST_CONFIGURATION_DRIFT'}
 $control.final=$final;$control.status='COMPLETE'
}catch{$control.status='FAILED';$control.errorCode=if($_.Exception.Message -match '^[A-Z_]+$'){$_.Exception.Message}else{'RUNNER_FAILED'};throw}
finally {
 Remove-Item Env:NODE_OPTIONS,Env:C6_VARIANT,Env:C6_EXTERNAL_CONTAINERS -ErrorAction SilentlyContinue
 if($job){Set-Content -LiteralPath $stopFile -Value 'stop' -Encoding ASCII;Wait-Job -Job $job -Timeout 10 | Out-Null;if($job.State -eq 'Running'){Stop-Job -Job $job};Remove-Job -Job $job}
 foreach($target in $paused){& docker unpause $target.id | Out-Null
  if($LASTEXITCODE -eq 0){$target.resumed=$true}else{$control.cleanupErrors+='CONTAINER_RESUME_FAILED'}
 }
 $control.finishedAt=[DateTime]::UtcNow.ToString('o');SaveControl
 $protocol.executionStatus=$control.status;$protocol.status=if($control.status -eq 'COMPLETE'){'COMPLETE_PENDING_GATE'}else{'EXECUTION_FAILED'};$protocol | ConvertTo-Json -Depth 14 | Set-Content (Join-Path $out 'protocol.json') -Encoding UTF8
 if($control.cleanupErrors.Count){throw 'HOST_RESTORE_FAILED'}
}
# Approval runs only after the finally block has restored the host.
& node (Join-Path $PSScriptRoot 'analyze.js') $Report > (Join-Path $out 'analysis.log') 2>&1
if($LASTEXITCODE -ne 0){throw 'C6_ANALYSIS_FAILED'}
$gateOutput=& node (Join-Path $PSScriptRoot 'gate.js') (Join-Path $out 'comparison.json')
$gateExit=$LASTEXITCODE
$gateOutput | Set-Content (Join-Path $out 'regression-gate.json') -Encoding UTF8
if($gateExit -ne 0){throw 'C6_REGRESSION_GATE_FAILED'}
