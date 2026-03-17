Set WshShell = CreateObject("WScript.Shell")
strPath = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
WshShell.CurrentDirectory = strPath

' 仮想環境のPythonパスを確認
strPython = "venv\Scripts\python.exe"

' コマンドの準備 (ウィンドウを表示して実行、完了まで待機)
' 第2引数: 1 = ウィンドウを表示, 0 = 非表示
' 第3引数: True = 完了まで待機
WshShell.Run "cmd /c """ & strPython & """ extract_data.py & pause", 1, True
