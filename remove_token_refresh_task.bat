@echo off
:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)

echo ===================================================
echo Removing Pharmacy Token Refresh Task
echo ===================================================
echo.

schtasks /delete /tn "Pharmacy_Token_Refresh" /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [SUCCESS] Task "Pharmacy_Token_Refresh" has been removed!
) else (
    echo.
    echo [ERROR] Could not remove the task or it does not exist.
)

echo.
pause
