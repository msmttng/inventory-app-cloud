import asyncio
import os
from playwright.async_api import async_playwright

async def run():
    print("Testing Medipal extraction...")
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
        
        await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        if await page.locator('#USER_ID').count() > 0:
            await page.fill('#USER_ID', medipal_id)
            await page.fill('#ID_PASSWD', medipal_pw)
            await page.click('.btnLogin')
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(8)
            
        print(f"Current URL: {page.url}")
        
        await page.screenshot(path="medipal_test.png")
        
        html = await page.content()
        with open("debug_medipal.html", "w", encoding="utf-8") as out:
            out.write(html)
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
