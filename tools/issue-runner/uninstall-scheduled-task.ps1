param(
  [string]$TaskName = 'AgentKanbanIssueRunner'
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "OK: scheduled task not found: $TaskName"
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "OK: uninstalled scheduled task $TaskName"
