param([string]$OutputFile,[string]$StopFile,[int]$RunnerPid)
$ErrorActionPreference='Stop'
$excludedNames='^(Idle|System|Registry|vmmem.*|vmcompute|vmwp|com\.docker\..*|docker|dockerd)$'
$logical=[Environment]::ProcessorCount
$previous=@{}
$excluded=0
Get-Process | ForEach-Object {
 if($_.Id -eq $PID -or $_.Id -eq $RunnerPid -or $_.ProcessName -match $excludedNames){$excluded++}
 elseif($null -ne $_.CPU){$previous[$_.Id]=[double]$_.CPU}
}
$baselineIds=@($previous.Keys)
$last=[DateTime]::UtcNow
$report=[ordered]@{startedAt=$last.ToString('o');logicalCpus=$logical;trackedInitialProcesses=$baselineIds.Count;excludedPlatformProcesses=$excluded;samples=@();status='RUNNING';limits=@('Fixed initial process set; CPU from newly created unrelated processes is not attributed.','Docker/WSL platform processes are excluded because they host the measured fixture.','Inaccessible process CPU counters are not covered. No process command line or environment is read.')}
try {
 while(-not (Test-Path -LiteralPath $StopFile)){
  Start-Sleep -Seconds 1
  $now=[DateTime]::UtcNow;$seconds=($now-$last).TotalSeconds;$cpu=0.0;$observed=0
  Get-Process | ForEach-Object {
   if($previous.ContainsKey($_.Id) -and $null -ne $_.CPU){$value=[double]$_.CPU;$cpu += [Math]::Max(0,$value-$previous[$_.Id]);$previous[$_.Id]=$value;$observed++}
  }
  $report.samples+=,[ordered]@{startedAt=$last.ToString('o');finishedAt=$now.ToString('o');cpuPercent=100*$cpu/$seconds/$logical;observedProcesses=$observed;intervalMs=$seconds*1000}
  $last=$now
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputFile -Encoding UTF8
 }
 $report.status='COMPLETE'
} catch {$report.status='FAILED';$report.errorCode='BACKGROUND_SAMPLING_FAILED'}
finally {$report.finishedAt=[DateTime]::UtcNow.ToString('o');$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputFile -Encoding UTF8}
