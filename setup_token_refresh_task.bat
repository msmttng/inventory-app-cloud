@echo off
:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)

echo ===================================================
echo Pharmacy Token Refresh - Task Setup
echo ===================================================
echo.

set "TASK_NAME=Pharmacy_Token_Refresh"
set "DIR=%~dp0"
set "VBS_PATH=%DIR%run_token_refresh_hidden.vbs"
set "PY_PATH=%DIR%refresh_token_only.py"

echo [Task Info]
echo Task Name : %TASK_NAME%
echo VBS Path  : %VBS_PATH%
echo PY Path   : %PY_PATH%
echo.

echo Registering the background token refresh task (every 20 minutes)...
echo.

schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%VBS_PATH%\" \"%PY_PATH%\"" /sc minute /mo 20 /rl highest /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Task registered successfully! 
    echo Token refresh will run automatically every 20 minutes in the background.
) else (
    echo.
    echo [FAILED] Could not register the task!
)

echo.
pause
