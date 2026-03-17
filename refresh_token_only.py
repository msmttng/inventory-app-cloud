import asyncio
import os
import argparse
import requests  # type: ignore
from datetime import datetime
from playwright.async_api import async_playwright  # type: ignore

GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec"
DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))

def load_env():
    env_path = os.path.join(DOWNLOAD_DIR, '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    os.environ[key.strip()] = value.strip()

load_env()

async def run_token_refresh(is_headless):
    print(f"[{datetime.now()}] MedOrder トークン更新専用処理を開始します... (Headless: {is_headless})")
    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data Automation")
    
    async with async_playwright() as p:
        browser_context = None
        try:
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir,
                channel="chrome",
                headless=is_headless,
                args=['--start-maximized', '--disable-blink-features=AutomationControlled'],
                ignore_default_args=["--enable-automation"]
            )
            
            try:
                medorder_token = None
                m_page = await browser_context.new_page()

                async def capture_token(request):
                    nonlocal medorder_token
                    if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in request.url:
                        auth = request.headers.get("authorization", "")
                        if auth.startswith("Bearer ") and not medorder_token:
                            medorder_token = auth.replace("Bearer ", "")

                m_page.on("request", capture_token)
                await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
                
                # 自動ログイン
                if "users/sign_in" in m_page.url:
                    email = os.environ.get("MEDORDER_EMAIL")
                    password = os.environ.get("MEDORDER_PASSWORD")
                    if email and password:
                        print(f"[{datetime.now()}] 自動ログイン試行中...")
                        await m_page.fill("#user_email", email)
                        await m_page.fill("#user_password", password)
                        await m_page.click("input[type='submit']")
                        await m_page.wait_for_load_state("domcontentloaded")
                    else:
                        print(f"[{datetime.now()}] ⚠️ 認証情報なし。ログインが必要です。")
                
                # トークン待ち
                for _ in range(30):
                    if medorder_token: break
                    await asyncio.sleep(1)
                
                if medorder_token:
                    # トークン保存
                    t_val: str = str(medorder_token)
                    requests.post(GAS_WEB_APP_URL, params={'type': 'medorder_token'}, data=t_val.encode('utf-8'))
                    print(f"[{datetime.now()}] トークンをGASに送信しました。")
                else:
                    print(f"[{datetime.now()}] ⚠️ トークン取得に失敗しました。")

                await m_page.close()
            except Exception as e:
                print(f"[{datetime.now()}] ⚠️ MedOrder Error: {e}")

        except Exception as launch_err:
             print(f"[{datetime.now()}] ⚠️ ブラウザ起動エラー (データ抽出と競合している可能性があります): {launch_err}")
             raise launch_err
        finally:
            if browser_context:
                await browser_context.close()

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--background', action='store_true')
    args = parser.parse_args()
    
    max_retries = 2
    for attempt in range(max_retries):
        try:
            await run_token_refresh(args.background)
            print(f"[{datetime.now()}] トークン更新タスク終了。")
            break
        except Exception as e:
            print(f"[{datetime.now()}] ⚠️  試行 {attempt+1} 失敗。")
            if attempt < max_retries - 1:
                await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())
