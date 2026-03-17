import asyncio
import os
import ctypes
from playwright.async_api import async_playwright

async def get_state():
    print("ブラウザを起動しています...")
    # Get local Chrome user data path to borrow existing login if possible.
    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data Automation")
    
    async with async_playwright() as p:
        try:
            # Try to launch with existing profile
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,
                channel="chrome",
                args=["--start-maximized"]
            )
        except Exception as e:
            print("専用プロファイルの起動に失敗しました。一時プロファイルで起動します。")
            browser = await p.chromium.launch(headless=False, channel="chrome", args=["--start-maximized"])
            browser_context = await browser.new_context()

        page = await browser_context.new_page()
        
        print("\n==============================================")
        print("Looker Studio のページを開きます。")
        print("表示された画面で必要に応じてGoogleにログインし、")
        print("表のデータ等が表示される状態にしてください。")
        print("確認できたら、このコマンドプロンプトで Enter キーを押すか、")
        print("表示されたダイアログ の OK ボタン を押してください。")
        print("==============================================\n")
        
        await page.goto("https://lookerstudio.google.com/reporting/fd3dd8c8-38ab-4cc0-bad4-c23552bb7209/page/p_9rj9sjgqvc?pli=1")
        
        # Wait for user confirmation
        ctypes.windll.user32.MessageBoxW(0, "Looker Studioの画面を開きました。\nログインを完了し、表データが正常に表示されるのを確認したら「OK」を押してください。", "認証確認", 0)

        print("認証状態を保存しています...")
        # Save storage state into the file.
        state_path = os.path.join(os.getcwd(), "state.json")
        await browser_context.storage_state(path=state_path)
        
        await browser_context.close()
        
        print(f"\n✅ 成功: 認証状態を {state_path} に保存しました！")
        print("続けて、PowerShell で以下のコマンドを実行してBase64をコピーしてください：\n")
        print("[Convert]::ToBase64String([IO.File]::ReadAllBytes(\"state.json\")) | clip")

if __name__ == "__main__":
    asyncio.run(get_state())
