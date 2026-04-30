@echo off
chcp 65001 >nul
echo ===================================================
echo inventory-app deploy script
echo ===================================================
echo.
echo [1/2] Pushing code to GAS...
call npx @google/clasp push -f

echo.
echo [2/2] Deploying to Production URL (AKfycbxRm...)...
call npx @google/clasp deploy -i AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw -d "Auto deployment via deploy.bat"

echo.
echo ===================================================
echo Deployment completed! URL unchanged.
echo https://script.google.com/macros/s/AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw/exec
echo ===================================================
pause
