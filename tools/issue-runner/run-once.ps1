param(
  [string]$ExecMode = 'dry-run'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot '.runner\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$LogPath = Join-Path $LogDir "$Timestamp.log"

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $LogPath -Append
}

Write-Log "issue-runner start"

try {
  Write-Log "git pull --ff-only"
  git pull --ff-only 2>&1 | Tee-Object -FilePath $LogPath -Append

  Write-Log "node tools/issue-runner/runner.cjs poll --exec-mode $ExecMode"
  node tools/issue-runner/runner.cjs poll --exec-mode $ExecMode 2>&1 | Tee-Object -FilePath $LogPath -Append

  Write-Log "issue-runner complete"
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  throw
}
