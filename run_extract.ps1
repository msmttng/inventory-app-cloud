# スクリプトの場所をカレントディレクトリに設定
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $PSScriptRoot

Write-Host "実行を開始します..." -ForegroundColor Cyan

# 仮想環境のPythonで実行
if (Test-Path ".\venv\Scripts\python.exe") {
    & ".\venv\Scripts\python.exe" extract_data.py
} else {
    Write-Host "[エラー] 仮想環境が見つかりません。" -ForegroundColor Red
}

Write-Host "処理が終了しました。"
pause
