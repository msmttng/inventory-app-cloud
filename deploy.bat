@echo off
chcp 65001 >nul
echo ===================================================
echo inventory-app deploy script
echo ===================================================
echo.
echo [1/2] Pushing code to GAS...
call npx @google/clasp push -f

echo.
echo [2/2] Deploying to Production URL (AKfycbwp...)...
call npx @google/clasp deploy -i AKfycbwp7WfGg5Md1-or1ihfVPH_KuMBQw41BVnUzR9iACTv0m8iG2DpLcnW-0Ui2zBFrTJWUg -d "Auto deployment via deploy.bat"

echo.
echo ===================================================
echo Deployment completed! URL unchanged.
echo https://script.google.com/macros/s/AKfycbwp7WfGg5Md1-or1ihfVPH_KuMBQw41BVnUzR9iACTv0m8iG2DpLcnW-0Ui2zBFrTJWUg/exec
echo ===================================================
pause
