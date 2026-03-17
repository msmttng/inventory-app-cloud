import asyncio
import os
import json
import requests
from playwright.async_api import async_playwright

async def main():
    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data Automation")
    medorder_token = None

    async with async_playwright() as p:
        browser_context = await p.chromium.launch_persistent_context(
            user_data_dir,
            channel="chrome",
            headless=True
        )
        page = await browser_context.new_page()

        async def capture_token(request):
            nonlocal medorder_token
            if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in request.url:
                auth = request.headers.get("authorization", "")
                if auth.startswith("Bearer "):
                    medorder_token = auth.replace("Bearer ", "")

        page.on("request", capture_token)
        await page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
        
        for _ in range(20):
            if medorder_token:
                break
            await page.wait_for_timeout(1000)
            
        await browser_context.close()
        
    if medorder_token:
        print("Token obtained. Fetching Master API...")
        master_url = "https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?ids=28632,35974"
        res = requests.get(master_url, headers={'Authorization': f'Bearer {medorder_token}'})
        data = res.json()
        with open('test_api_out3.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print("Success")

asyncio.run(main())
