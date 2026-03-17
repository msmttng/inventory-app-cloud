import asyncio
import os
import re
from playwright.async_api import async_playwright

DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))

async def test_date_picker():
    user_data_dir = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data Automation")
    async with async_playwright() as p:
        browser_context = await p.chromium.launch_persistent_context(
            user_data_dir,
            channel="chrome",
            headless=False,
            args=['--start-maximized', '--disable-blink-features=AutomationControlled'],
            ignore_default_args=["--enable-automation"]
        )
        page = await browser_context.new_page()
        print("Navigating to Looker Studio...")
        await page.goto("https://lookerstudio.google.com/reporting/fd3dd8c8-38ab-4cc0-bad4-c23552bb7209/page/p_9rj9sjgqvc?pli=1", timeout=60000)
        await asyncio.sleep(5)
        
        print("Clicking '入出庫履歴'...")
        try:
            await page.locator("text='入出庫履歴'").first.click(timeout=5000)
            await asyncio.sleep(2)
            await page.locator("text='入庫'").first.click(timeout=5000)
        except Exception:
            await page.locator("text='入庫履歴'").first.click(timeout=15000)
        
        await asyncio.sleep(5)
        
        print("Finding Date Range component...")
        # Match text like "2026/03/01 - 2026/03/31"
        date_pattern = re.compile(r"\d{4}/\d{2}/\d{2}\s*-\s*\d{4}/\d{2}/\d{2}")
        date_control = page.locator("text", has_text=date_pattern).first
        
        if await date_control.count() > 0:
            print("Found date control. Clicking...")
            await date_control.click()
            await asyncio.sleep(3)
        else:
            print("Date control NOT found via regex text match.")
            
        print("Taking screenshot...")
        await page.screenshot(path=os.path.join(DOWNLOAD_DIR, "debug_date_picker.png"))
        
        html = await page.content()
        with open(os.path.join(DOWNLOAD_DIR, "debug_date_picker.html"), "w", encoding="utf-8") as f:
            f.write(html)
            
        print("Successfully saved date picker debug info.")
        await browser_context.close()

if __name__ == "__main__":
    asyncio.run(test_date_picker())
