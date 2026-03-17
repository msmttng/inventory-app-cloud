@echo off
REM change directory to the project folder
cd /d "C:\Users\masam\.gemini\antigravity\scratch\inventory-app-cloud"

echo ----------------------------------------
echo Running generate_state.py...
echo ----------------------------------------

python generate_state.py

echo.
echo ----------------------------------------
echo Processing complete. Press any key to exit.
pause
