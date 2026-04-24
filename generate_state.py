"""
state.json 再生成ツール
- ヘッド付きブラウザを起動し、ユーザーが手動でLooker Studioにログインする
- ログイン完了後にEnterを押すと state.json として保存される
"""
import asyncio
import os
import json
import base64
from playwright.async_api import async_playwright

LOOKER_STUDIO_URL = "https://lookerstudio.google.com/reporting/fd3dd8c8-38ab-4cc0-bad4-c23552bb7209/page/p_9rj9sjgqvc?pli=1"
STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")

import msvcrt

async def wait_for_enter(prompt):
    print(prompt, end="", flush=True)
    # 溜まっている入力バッファをクリア
    while msvcrt.kbhit():
        msvcrt.getch()
    # Enterが押されるまで非同期に待機
    while True:
        if msvcrt.kbhit():
            key = msvcrt.getch()
            if key in (b'\r', b'\n'):
                print()
                break
        await asyncio.sleep(0.1)

async def main():
    print("=" * 60)
    print("  Looker Studio ログイン状態 再生成ツール")
    print("=" * 60)
    print()
    print("1. ブラウザが起動します")
    print("2. Looker Studio が開いたら、Googleアカウントでログインしてください")
    print("3. レポート画面（グラフが表示された画面）が表示されたら")
    print("   このターミナルに戻り、Enterキーを押してください")
    print()
    
    await wait_for_enter(">>> Enterキーを押してブラウザを起動します... ")
    print()

    async with async_playwright() as p:
        user_data_path = r"C:\Users\masam\.gemini\antigravity\scratch\playwright_profile"
        if not os.path.exists(user_data_path):
            os.makedirs(user_data_path, exist_ok=True)

        # 永続プロファイルを使ってヘッド付きで起動（ローカル保存用）
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_path,
            channel="chrome",
            headless=False,  # GUIを表示
            no_viewport=True,
            args=[
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
            ]
        )
        if len(ctx.pages) > 0:
            page = ctx.pages[0]
        else:
            page = await ctx.new_page()

        print("ブラウザを起動しました。Looker Studio を開いています...")
        await page.goto(LOOKER_STUDIO_URL, wait_until="domcontentloaded")
        print(f"ブラウザURL: {page.url}")
        print()
        print(">>> Looker Studio のレポート画面が表示されたら、")
        print("    このターミナルで Enter を押してください")
        print()

        # ユーザーが手動ログインするのを待つ
        await wait_for_enter(">>> ログイン完了後、Enter を押してください... ")

        # 現在のセッション状態を保存
        await ctx.storage_state(path=STATE_PATH)
        print(f"\n✅ state.json を保存しました: {STATE_PATH}")

        # Base64エンコード（GitHub Secrets 用）
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            state_data = f.read()

        b64_state = base64.b64encode(state_data.encode("utf-8")).decode("utf-8")

        print()
        print("=" * 60)
        print("GitHub Secrets 用の Base64 文字列（GOOGLE_AUTH_STATE_BASE64）:")
        print("=" * 60)
        print(b64_state[:100] + "... (省略)")
        print()

        # b64 をファイルにも保存（ターミナルからコピーしにくい場合のために）
        b64_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state_b64.txt")
        with open(b64_path, "w", encoding="utf-8") as f:
            f.write(b64_state)
        print(f"\nBase64文字列をファイルに保存しました: {b64_path}")

        # GitHubに自動アップロード
        print("\nGitHub Secrets (クラウド側) を自動更新しています...")
        try:
            import subprocess
            # ghコマンドでSecretsを直接セット（リポジトリ名は msmttng/inventory-app-cloud を指定）
            cmd = f'gh secret set GOOGLE_AUTH_STATE_BASE64 --repo msmttng/inventory-app-cloud < "{b64_path}"'
            proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if proc.returncode == 0:
                print("✅ GitHub Secrets への自動反映が完了しました！手動でのペースト作業は【不要】です！")
            else:
                print("⚠️ 自動反映に失敗しました（ghコマンドエラー）。手動で以下にペーストしてください。")
                print("GitHub Secrets: https://github.com/msmttng/inventory-app-cloud/settings/secrets/actions")
        except Exception as e:
            print("⚠️ 自動反映に失敗しました。手動でペーストしてください。")

        print("\n✅ 完了！ローカル実行用の state.json も最新化されています。")

        await ctx.close()

if __name__ == "__main__":
    import traceback
    try:
        asyncio.run(main())
    except Exception as e:
        print("\n[エラーが発生しました]")
        traceback.print_exc()
    finally:
        print("\n--- 処理が終了しました ---")
        os.system("pause")
