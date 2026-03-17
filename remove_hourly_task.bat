@echo off
:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)

echo ===================================================
echo Pharmacy Inventory AutoExtract - Remove Task
echo ===================================================
echo.

set "TASK_NAME=Pharmacy_Inventory_AutoExtract"

echo Removing the background hourly task...
echo.

schtasks /delete /tn "%TASK_NAME%" /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Task removed successfully!
    echo Automatic extraction has been stopped.
) else (
    echo.
    echo [FAILED] Could not remove the task!
)

echo.
pause
