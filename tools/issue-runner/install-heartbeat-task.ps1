param(
  [string]$TaskName = 'AgentKanbanIssueRunnerHeartbeat',
  [int]$IntervalMinutes = 5,
  [string]$RunnerId = $env:COMPUTERNAME
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$HeartbeatScript = Join-Path $ProjectRoot 'tools\issue-runner\run-heartbeat.ps1'
$HiddenRunner = Join-Path $ProjectRoot 'tools\issue-runner\run-hidden.vbs'

if (-not (Test-Path $HeartbeatScript)) {
  throw "heartbeat script not found: $HeartbeatScript"
}

if (-not (Test-Path $HiddenRunner)) {
  throw "hidden runner not found: $HiddenRunner"
}

# The hidden VBS launcher routes through run-once.ps1, so register a direct
# PowerShell action for heartbeat to avoid the poll lock. WindowStyle Hidden
# keeps it from flashing.
$Action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -NonInteractive -ExecutionPolicy Bypass -File `"$HeartbeatScript`" -RunnerId `"$RunnerId`"" `
  -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description 'Post still-running heartbeat comments for stuck issue-runner jobs.' `
  -Force | Out-Null

Write-Host "OK: installed scheduled task $TaskName every $IntervalMinutes minute(s)"
Write-Host "Run now:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
