Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "C:\Users\masam\.gemini\antigravity\scratch\inventory_app"
objShell.Run "run_extract_hidden.bat", 0, True
Set objShell = Nothing
