@echo off
setlocal
title Python Data Extractor

REM スクリプトが存在するディレクトリに移動
cd /d "%~dp0"

echo 実行を開始します...
echo -----------------------------------------

REM 仮想環境のPythonを使用して実行
if exist ".\venv\Scripts\python.exe" (
    ".\venv\Scripts\python.exe" extract_data.py
) else (
    echo [エラー] 仮想環境 (venv) が見つかりません。
    echo extract_data.py を直接実行するか、venvを作成してください。
)

echo -----------------------------------------
echo 処理が終了しました。
pause