param(
  [string]$TaskName = 'AgentKanbanIssueRunner',
  [int]$IntervalMinutes = 1,
  [ValidateSet('dry-run', 'codex')]
  [string]$ExecMode = 'dry-run',
  [string]$RunnerId = $env:COMPUTERNAME
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$RunScript = Join-Path $ProjectRoot 'tools\issue-runner\run-once.ps1'
$HiddenRunner = Join-Path $ProjectRoot 'tools\issue-runner\run-hidden.vbs'

if (-not (Test-Path $RunScript)) {
  throw "run script not found: $RunScript"
}

if (-not (Test-Path $HiddenRunner)) {
  throw "hidden runner not found: $HiddenRunner"
}

$Action = New-ScheduledTaskAction `
  -Execute 'wscript.exe' `
  -Argument "//B //Nologo `"$HiddenRunner`" $ExecMode $RunnerId" `
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
  -Description 'Poll GitHub issues for agent-kanban requests.' `
  -Force | Out-Null

Write-Host "OK: installed scheduled task $TaskName every $IntervalMinutes minute(s), exec mode: $ExecMode, runner id: $RunnerId"
Write-Host "Run now:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
