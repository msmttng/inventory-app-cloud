@echo off
:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)

echo ===================================================
echo Pharmacy Inventory AutoExtract - Task Setup
echo ===================================================
echo.

set "TASK_NAME=Pharmacy_Inventory_AutoExtract"
set "DIR=%~dp0"
set "VBS_PATH=%DIR%run_hidden.vbs"
set "PY_PATH=%DIR%extract_data.py"

echo [Task Info]
echo Task Name : %TASK_NAME%
echo VBS Path  : %VBS_PATH%
echo PY Path   : %PY_PATH%
echo.

echo Registering the background task (every 15 minutes)...
echo.

schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%VBS_PATH%\" \"%PY_PATH%\"" /sc minute /mo 15 /rl highest /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Task registered successfully! 
    echo Extraction will run automatically every 15 minutes in the background.
) else (
    echo.
    echo [FAILED] Could not register the task!
)

echo.
pause
