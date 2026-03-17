import asyncio
import os
from datetime import datetime
from dateutil.relativedelta import relativedelta
from playwright.async_api import async_playwright

DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))

async def test_date_picker_dom():
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
        
        print("Clicking '入出庫履歴/入庫'...")
        try:
            await page.locator("text='入出庫履歴'").first.click(timeout=5000)
            await asyncio.sleep(2)
            await page.locator("text='入庫'").first.click(timeout=5000)
        except Exception:
            await page.locator("text='入庫履歴'").first.click(timeout=15000)
        
        await asyncio.sleep(8)
        
        current_year_str = datetime.now().strftime("%Y/")
        date_control = page.locator(f"text=/{current_year_str}/").first
        
        if await date_control.count() > 0:
            print("Found date control! Clicking...")
            await date_control.click()
            await asyncio.sleep(2)
            
            print("Taking screenshot of date picker popup...")
            await page.screenshot(path=os.path.join(DOWNLOAD_DIR, "debug_date_picker_popup.png"))
            
            html = await page.content()
            with open(os.path.join(DOWNLOAD_DIR, "debug_date_picker_popup.html"), "w", encoding="utf-8") as f:
                f.write(html)
            print("Saved HTML and screenshot.")
            
        await browser_context.close()

if __name__ == "__main__":
    asyncio.run(test_date_picker_dom())
