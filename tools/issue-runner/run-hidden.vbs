Option Explicit

Dim fso, shell, scriptDir, projectRoot, runScript, execMode, runnerId, command, exitCode

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
runScript = fso.BuildPath(scriptDir, "run-once.ps1")

execMode = "dry-run"
If WScript.Arguments.Count > 0 Then
  execMode = WScript.Arguments.Item(0)
End If

runnerId = ""
If WScript.Arguments.Count > 1 Then
  runnerId = WScript.Arguments.Item(1)
End If

shell.CurrentDirectory = projectRoot
command = "powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Quote(runScript) & " -ExecMode " & Quote(execMode)
If runnerId <> "" Then
  command = command & " -RunnerId " & Quote(runnerId)
End If
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
