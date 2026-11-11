$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$out=Join-Path $root 'context/reviews/c6-alternating-host'
if($env:NODE_OPTIONS){throw 'NODE_OPTIONS_MUST_BE_EMPTY_FOR_COMPARISON'}
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
$external=@(& docker ps --format '{{.ID}}');if($LASTEXITCODE -ne 0){throw 'CONTAINER_INVENTORY_FAILED'}
$control=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o');order=@('before','after','before','after','before','after');initial=$initial;externalContainerCount=$external.Count;runs=@();status='RUNNING'}
function SaveControl { $control | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $out 'host-control.json') -Encoding UTF8 }
SaveControl
try {
 for($i=0;$i -lt 6;$i++){
  $variant=$control.order[$i];$report="c6-ab-$($i+1)-$variant";$dir=Join-Path $root "context/reviews/$report"
  if(Test-Path -LiteralPath $dir){throw 'REPORT_ALREADY_EXISTS'}
  $config=HostConfig
  if(($config|ConvertTo-Json -Compress) -ne ($initial|ConvertTo-Json -Compress)){throw 'HOST_CONFIGURATION_DRIFT'}
  $nowContainers=@(& docker ps --format '{{.ID}}');if($LASTEXITCODE -ne 0){throw 'CONTAINER_INVENTORY_FAILED'}
  if((($external|Sort-Object)-join ',') -ne (($nowContainers|Sort-Object)-join ',')){throw 'BACKGROUND_CONTAINER_SET_DRIFT'}
  New-Item -ItemType Directory -Path $dir | Out-Null
  $idle=$false
  for($attempt=1;$attempt -le 3;$attempt++){
   & node (Join-Path $PSScriptRoot 'hostCheck.js') (Join-Path $dir "idle-$attempt.json")
   if($LASTEXITCODE -eq 0){$idle=$true;break}
   if($LASTEXITCODE -ne 2){throw 'HOST_PROBE_FAILED'}
   Start-Sleep -Seconds 5
  }
  if(-not $idle){throw 'HOST_IDLE_NOT_REACHED'}
  $externalCpu=0.0
  if($external.Count){
   $stats=@(& docker stats --no-stream --format '{{.CPUPerc}}' @external);if($LASTEXITCODE -ne 0){throw 'BACKGROUND_STATS_FAILED'}
   if($stats.Count -ne $external.Count){throw 'BACKGROUND_STATS_COUNT'}
   foreach($value in $stats){$externalCpu += [double]::Parse($value.Replace('%',''),[Globalization.CultureInfo]::InvariantCulture)}
  }
  if($externalCpu -gt 10){throw 'BACKGROUND_CONTAINERS_BUSY'}
  $entry=[ordered]@{index=$i+1;variant=$variant;report=$report;config=$config;externalCpuBefore=$externalCpu;startedAt=[DateTime]::UtcNow.ToString('o');status='RUNNING'}
  $control.runs+=,$entry;SaveControl
  $env:C6_VARIANT=$variant;$env:C6_EXTERNAL_CONTAINERS=$external -join ','
  $env:NODE_OPTIONS='--require="'+(Join-Path $PSScriptRoot 'preload.js').Replace('\','/')+'"'
  Write-Output "START $report"
  try {
   & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '../http-contention/profile.ps1') -Mode capacity -Report $report > (Join-Path $dir 'profile.log') 2>&1
   $code=$LASTEXITCODE
  } finally {Remove-Item Env:NODE_OPTIONS,Env:C6_VARIANT,Env:C6_EXTERNAL_CONTAINERS -ErrorAction SilentlyContinue}
  $entry.finishedAt=[DateTime]::UtcNow.ToString('o');$entry.exitCode=$code;$entry.status=if($code -eq 0){'COMPLETE'}else{'FAIL'};SaveControl
  if($code -ne 0){throw 'CAPACITY_RUN_FAILED'}
  & node (Join-Path $PSScriptRoot '../http-contention/summarize.js') (Join-Path $dir 'results.json') > (Join-Path $dir 'summary.log') 2>&1
  if($LASTEXITCODE -ne 0){throw 'SUMMARY_FAILED'}
  Write-Output "COMPLETE $report"
 }
 $final=HostConfig
 if(($final|ConvertTo-Json -Compress) -ne ($initial|ConvertTo-Json -Compress)){throw 'FINAL_HOST_CONFIGURATION_DRIFT'}
 $finalContainers=@(& docker ps --format '{{.ID}}')
 if((($external|Sort-Object)-join ',') -ne (($finalContainers|Sort-Object)-join ',')){throw 'FINAL_CONTAINER_SET_DRIFT'}
 $control.final=$final;$control.status='COMPLETE'
} finally {
 Remove-Item Env:NODE_OPTIONS,Env:C6_VARIANT,Env:C6_EXTERNAL_CONTAINERS -ErrorAction SilentlyContinue
 $control.finishedAt=[DateTime]::UtcNow.ToString('o');SaveControl
}
