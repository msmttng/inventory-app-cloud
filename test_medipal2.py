import asyncio
import os
from playwright.async_api import async_playwright

async def run():
    with open('.env', 'r', encoding='utf-8') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                os.environ[k] = v
                
    medipal_id = os.environ.get("ORDER_EPI_ID")
    medipal_pw = os.environ.get("ORDER_EPI_PASSWORD")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await context.new_page()
        
        await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet", wait_until="networkidle")
        
        await page.fill('input[type="text"]', medipal_id)
        await page.fill('input[type="password"]', medipal_pw)
        await page.click('input[type="image"][src*="login"]')
        
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(5)
        
        print(f"Current URL: {page.url}")
        html = await page.content()
        with open("debug_medipal.html", "w", encoding="utf-8") as out:
            out.write(html)
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
