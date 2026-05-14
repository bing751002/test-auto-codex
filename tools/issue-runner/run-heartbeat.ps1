param(
  [string]$RunnerId = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot '.runner\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$LogPath = Join-Path $LogDir "heartbeat-$Timestamp.log"

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Out-File -FilePath $LogPath -Append -Encoding utf8
}

Write-Log "heartbeat start"

$runnerArgs = @('tools/issue-runner/runner.cjs', 'heartbeat')
if ($RunnerId) {
  $runnerArgs += @('--runner-id', $RunnerId)
}

Write-Log "node $($runnerArgs -join ' ')"
$output = & node @runnerArgs 2>&1
$output | Out-File -FilePath $LogPath -Append -Encoding utf8

Write-Log "heartbeat complete"
