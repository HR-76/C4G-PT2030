# Registers (or removes) the daily chat retention task in the Windows Task Scheduler.
# Runs backend\scripts\localPlatform\chatRetentionRun.js every day at 03:00 (machine time; keep the PC on Lisbon time).
# Usage:  powershell -NoProfile -File scheduleChatRetention.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'C4G chat retention'
if ($Remove) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; 'REMOVED' } else { 'NOT_REGISTERED' }
  return
}
$backend = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = (Resolve-Path (Join-Path $backend '..')).Path
$logDirectory = Join-Path $root '.tmp\local-platform\logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$node = (Get-Command node).Source
$log = Join-Path $logDirectory 'chat-retention.log'
# cmd keeps the redirect simple; the log holds counts and event names only, never chat text.
$arguments = "/c `"`"$node`" scripts\localPlatform\chatRetentionRun.js >> `"$log`" 2>&1`""
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arguments -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -Daily -At '03:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Deletes team chat history 90 days after an application closes (C4G).' -Force | Out-Null
"REGISTERED $taskName daily 03:00; log $log"
