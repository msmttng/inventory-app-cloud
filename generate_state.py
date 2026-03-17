import asyncio
import os
import json
import base64
import subprocess
from playwright.async_api import async_playwright

async def main():
    print("=== Google Login State Extractor ===")
    print("Googleのセキュリティによるブロックを回避するため、")
    print("普段ローカルで成功している自動化用のChromeプロファイルから直接ログイン状態を抽出します。")
    print("======================================\n")
    
    input("準備ができたら Enterキーを押してください...")

    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data Automation")
    
    if not os.path.exists(user_data_dir):
        print(f"\n[エラー] 既存のプロファイルが見つかりません: {user_data_dir}")
        print("元のローカル用スクリプトが一度も実行されていない可能性があります。")
        return

    # 安全のため裏で動いているChromeを終了しておく
    subprocess.call('taskkill /F /IM chrome.exe', shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    await asyncio.sleep(1)

    print("\nプロファイルを読み込んでいます...")

    async with async_playwright() as p:
        try:
            # 既存の自動化プロファイルを使用（普段LookerStudioをダウンロードできている環境）
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir,
                channel="chrome",  # ローカルのChrome実体を使う
                headless=True,     # ヘッドレスでOK
                args=['--disable-blink-features=AutomationControlled'],
                ignore_default_args=["--enable-automation"]
            )
            
            # Profileから状態（Cookie等）をエクスポート
            state_path = "state.json"
            await browser_context.storage_state(path=state_path)
            await browser_context.close()
            
            # 保存した状態ファイルをBase64エンコード
            with open(state_path, "r", encoding="utf-8") as f:
                state_data = f.read()
                
            b64_state = base64.b64encode(state_data.encode("utf-8")).decode("utf-8")
            
            print("\n\n" + "="*50)
            print("✅ ログイン状態の抽出に成功しました！")
            print("以下の非常に長い Base64 文字列をすべてコピーして、")
            print("GitHub Secrets の [ GOOGLE_AUTH_STATE_BASE64 ] に登録してください。")
            print("="*50 + "\n")
            
            print(b64_state)
            
            print("\n" + "="*50)
            print("※ ターミナルからすべてコピーするのが難しい場合は、")
            print("   同じフォルダに作成された state.json を自分でBase64変換ツールのサイトに")
            print("   かけて変換していただいても構いません。")
            print("="*50)
            
        except Exception as e:
            print(f"\n[エラー] {e}")
            print("Chromeプロセスが競合している可能性があります。")

if __name__ == "__main__":
    asyncio.run(main())
