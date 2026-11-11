$ErrorActionPreference='Stop'
$root=(Resolve-Path "$PSScriptRoot/../../..").Path
$out=Join-Path $root 'context/reviews/c6-dedicated-slo/observer-selftest'
if(Test-Path -LiteralPath $out){throw 'SELFTEST_REPORT_EXISTS'}
New-Item -ItemType Directory -Path $out | Out-Null
$map=@{1=[double]10};$value=[double]10.125
$old=[Math]::Max(0,$value-$map[1])
$corrected=[Math]::Max([double]0,[double]($value-$map[1]))
if($old -ne 0 -or $corrected -ne 0.125){throw 'FRACTIONAL_REGRESSION_NOT_VERIFIED'}
$negative=[Math]::Max([double]0,[double]([double]9.5-$map[1]))
if($negative -ne 0){throw 'NEGATIVE_DELTA_NOT_CLAMPED'}
$reportPath=Join-Path $out 'samples.json';$stop=Join-Path $out 'stop'
$job=Start-Job -FilePath (Join-Path $PSScriptRoot 'background.ps1') -ArgumentList $reportPath,$stop,0
try {
 $deadline=[DateTime]::UtcNow.AddSeconds(10)
 while(-not (Test-Path -LiteralPath $reportPath)){if([DateTime]::UtcNow -gt $deadline){throw 'OBSERVER_NOT_STARTED'};Start-Sleep -Milliseconds 100}
 for($attempt=0;$attempt -lt 3;$attempt++){
  $watch=[Diagnostics.Stopwatch]::StartNew()
  while($watch.ElapsedMilliseconds -lt 400){[void][Math]::Sqrt(1234567.89)}
  Start-Sleep -Milliseconds 700
 }
} finally {
 Set-Content -LiteralPath $stop -Value 'stop' -Encoding ASCII
 Wait-Job -Job $job -Timeout 10 | Out-Null
 if($job.State -eq 'Running'){Stop-Job -Job $job}
 Remove-Job -Job $job
}
$observations=Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
if($observations.status -ne 'COMPLETE' -or $observations.cpuCounterVersion -ne 'fractional-double-v2'){throw 'OBSERVER_VERSION_FAILED'}
if(-not @($observations.samples | Where-Object {$_.cpuPercent -gt 0 -and $_.observedProcesses -gt 0}).Count){throw 'KNOWN_ACTIVITY_NOT_OBSERVED'}
[ordered]@{status='PASS';oldOverloadResult=$old;correctedOverloadResult=$corrected;negativeDelta=$negative;actualSamples=$observations.samples.Count;maxCpuPercent=($observations.samples.cpuPercent|Measure-Object -Maximum).Maximum;limits=@('Controlled activity checks nonzero telemetry; it does not calibrate every host process counter.')} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'result.json') -Encoding UTF8
Write-Output 'PASS fractional CPU regression and live observer smoke check'
