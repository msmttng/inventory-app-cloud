@echo off
cd /d %~dp0

:: Read .env file and export variables
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "%%A=%%B"
)

echo Starting data extraction...
python extract_data.py

echo Done.
pause
