import asyncio
import os
from playwright.async_api import async_playwright

async def run():
    print("Starting Medipal test with clicks...")
    with open('.env', 'r', encoding='utf-8') as f:
        for line in f:
            if '=' in line:
                k, v = line.strip().split('=', 1)
                os.environ[k] = v
                
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        c = await b.new_context(viewport={'width': 1920, 'height': 1080})
        page = await c.new_page()
        await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet", wait_until="domcontentloaded")
        
        # Proper Medipal login filling
        await page.fill('input[placeholder="ID"]', os.environ.get('ORDER_EPI_ID'))
        await page.fill('input[type="password"]', os.environ.get('ORDER_EPI_PASSWORD'))
        await page.click('button:has-text("ログイン")')
        
        print("Clicked login, waiting...")
        await page.wait_for_timeout(8000)
            
        print("Current URL:", page.url)
        await page.screenshot(path="medipal_test3.png")
        html = await page.content()
        with open("debug_medipal_full3.html", "w", encoding="utf-8") as f:
            f.write(html)
            
        await b.close()

if __name__ == "__main__":
    asyncio.run(run())
