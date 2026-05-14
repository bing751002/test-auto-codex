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

function Invoke-LoggedNative {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = $FilePath
  $processInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
  $processInfo.WorkingDirectory = (Get-Location).Path
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  [void]$process.Start()

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ($stdout) {
    $stdout.TrimEnd() | Tee-Object -FilePath $LogPath -Append
  }
  if ($stderr) {
    $stderr.TrimEnd() | Tee-Object -FilePath $LogPath -Append
  }

  if ($process.ExitCode -ne 0) {
    throw "$FilePath exited with code $($process.ExitCode)"
  }
}

function ConvertTo-NativeArgument {
  param([string]$Value)
  if ($null -eq $Value) {
    return '""'
  }
  if ($Value -notmatch '[\s"]') {
    return $Value
  }
  return '"' + $Value.Replace('"', '\"') + '"'
}

Write-Log "issue-runner start"

try {
  if (Test-Path $LockPath) {
    $lock = Get-Item $LockPath
    $age = (Get-Date) - $lock.LastWriteTime
    if ($age.TotalMinutes -lt $LockMaxAgeMinutes) {
      Write-Log "another runner appears active; lock age $([Math]::Round($age.TotalMinutes, 2)) minute(s), posting heartbeat"
      $heartbeatArgs = @('tools/issue-runner/runner.cjs', 'heartbeat')
      if ($RunnerId) {
        $heartbeatArgs += @('--runner-id', $RunnerId)
      }
      Invoke-LoggedNative -FilePath 'node' -Arguments $heartbeatArgs
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
  Invoke-LoggedNative -FilePath 'git' -Arguments @('pull', '--ff-only')

  $runnerArgs = @('tools/issue-runner/runner.cjs', 'poll', '--exec-mode', $ExecMode)
  if ($RunnerId) {
    $runnerArgs += @('--runner-id', $RunnerId)
  }

  Write-Log "node $($runnerArgs -join ' ')"
  Invoke-LoggedNative -FilePath 'node' -Arguments $runnerArgs

  Write-Log "issue-runner complete"
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  throw
} finally {
  if (Test-Path $LockPath) {
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  }
}
