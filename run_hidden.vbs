Set WshShell = CreateObject("WScript.Shell")
' 第1引数に渡されたPythonスクリプトを --background フラグ付きで非表示(0)で実行
WshShell.Run "python """ & WScript.Arguments(0) & """ --background", 0, False
Set WshShell = Nothing
