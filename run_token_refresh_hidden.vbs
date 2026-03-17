Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptPath = WScript.Arguments(0)
dirPath = fso.GetParentFolderName(scriptPath)
pythonExe = dirPath & "\venv\Scripts\python.exe"

If fso.FileExists(pythonExe) Then
    cmd = """" & pythonExe & """ """ & scriptPath & """ --background"
Else
    cmd = "python """ & scriptPath & """ --background"
End If

WshShell.Run cmd, 0, False
Set WshShell = Nothing
