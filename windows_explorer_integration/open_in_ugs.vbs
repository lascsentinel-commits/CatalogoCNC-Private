' Lanzador silencioso sin ventana negra de consola para clic derecho -> Abrir en UGS
Set objArgs = WScript.Arguments
If objArgs.Count > 0 Then
    Set fso = CreateObject("Scripting.FileSystemObject")
    scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
    psScript = fso.BuildPath(scriptDir, "open_in_ugs.ps1")
    targetFile = objArgs(0)
    cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psScript & """ -TargetFile """ & targetFile & """"
    Set shell = CreateObject("WScript.Shell")
    shell.Run cmd, 0, False
End If
