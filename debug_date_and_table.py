import asyncio
import os
from datetime import datetime
from dateutil.relativedelta import relativedelta
from playwright.async_api import async_playwright

DOWNLOAD_DIR = os.path.dirname(os.path.abspath(__file__))

async def test_date_and_table():
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
        
        # Click the Date Control box
        print("Finding Date Range component...")
        # Since the current month format is "2026/03/01 - 2026/03/31", we can match "2026/" since it's unique
        current_year_str = datetime.now().strftime("%Y/")
        date_control = page.locator(f"text=/{current_year_str}/").first
        
        if await date_control.count() > 0:
            print("Found date control! Clicking...")
            await date_control.click()
            await asyncio.sleep(2)
            
            # Click the Start Date input box inside the Looker Studio popup
            print("Finding Start Date input...")
            # Usually Looker studio has class names or aria-labels for the start date, or we can just double click the first input
            inputs = page.locator("input[type='text']")
            if await inputs.count() >= 2:
                print("Setting 6 months ago...")
                six_months_ago = (datetime.now() - relativedelta(months=6)).replace(day=1)
                start_date_str = six_months_ago.strftime("%Y/%m/%d")
                
                await inputs.nth(0).click()
                await page.keyboard.press("Control+A")
                await page.keyboard.type(start_date_str)
                await asyncio.sleep(1)
                
                # Click Apply button
                print("Applying date range...")
                apply_btn = page.locator("text='適用'").first
                if await apply_btn.count() > 0:
                    await apply_btn.click()
                else:
                    await page.mouse.click(0,0) # Click outside to close and apply
                await asyncio.sleep(5)
        
        print("Finding '品目別の購入金額' table headers...")
        item_table_header = page.locator("text='医薬品名'").first
        await item_table_header.scroll_into_view_if_needed()
        await item_table_header.click(button="right")
        
        await asyncio.sleep(2)
        print("Exporting...")
        await page.locator("text=/グラフをエクスポート/").first.click()
        await page.locator("text=/データのエクスポート/").first.click()
        await page.locator("text='CSV'").first.click()
        
        async with page.expect_download() as d_info_receive:
            await page.locator("button", has_text="エクスポート").last.click()
        d_receive = await d_info_receive.value
        f_receive = os.path.join(DOWNLOAD_DIR, f"debug_receive_export.csv")
        await d_receive.save_as(f_receive)
        print("Successfully exported '品目別の購入金額' ! Saved to", f_receive)
            
        await browser_context.close()

if __name__ == "__main__":
    asyncio.run(test_date_and_table())
