param(
  [string]$ExecMode = 'dry-run',
  [string]$RunnerId = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot '.runner\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$LockPath = Join-Path $ProjectRoot '.runner\issue-runner.lock'
$LockMaxAgeMinutes = 120

$Timestamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$LogPath = Join-Path $LogDir "$Timestamp.log"

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $LogPath -Append
}

Write-Log "issue-runner start"

try {
  if (Test-Path $LockPath) {
    $lock = Get-Item $LockPath
    $age = (Get-Date) - $lock.LastWriteTime
    if ($age.TotalMinutes -lt $LockMaxAgeMinutes) {
      Write-Log "another runner appears active; lock age $([Math]::Round($age.TotalMinutes, 2)) minute(s), skipping"
      exit 0
    }

    Write-Log "stale lock found; removing $LockPath"
    Remove-Item -LiteralPath $LockPath -Force
  }

  Set-Content -Encoding UTF8 -Path $LockPath -Value @(
    "pid=$PID"
    "started=$(Get-Date -Format o)"
    "execMode=$ExecMode"
    "runnerId=$RunnerId"
  )

  Write-Log "git pull --ff-only"
  git pull --ff-only 2>&1 | Tee-Object -FilePath $LogPath -Append

  $runnerArgs = @('tools/issue-runner/runner.cjs', 'poll', '--exec-mode', $ExecMode)
  if ($RunnerId) {
    $runnerArgs += @('--runner-id', $RunnerId)
  }

  Write-Log "node $($runnerArgs -join ' ')"
  & node @runnerArgs 2>&1 | Tee-Object -FilePath $LogPath -Append

  Write-Log "issue-runner complete"
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  throw
} finally {
  if (Test-Path $LockPath) {
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
}
