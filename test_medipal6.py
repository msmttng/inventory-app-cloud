import asyncio
import os
import json
from datetime import datetime, timedelta
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

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
        
        await page.fill('input[placeholder="ID"]', medipal_id)
        await page.fill('input[type="password"]', medipal_pw)
        await page.click('button:has-text("ログイン")')
        await page.wait_for_timeout(5000)
            
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        # Only target rows that have an ID starting with 'hnmy' inside an 'a' tag.
        # This is a much safer way to find the actual medicine rows.
        rows = soup.select("tr")
        print(f"Total TRs: {len(rows)}")
        
        data = []
        for row in rows:
            name_a_tag = row.select_one("a[id^='hnmy']")
            if not name_a_tag:
                continue
                
            name = name_a_tag.text.strip().replace('\n', ' ')
            
            # The delivery status is the 5th TD after the name, or we can look for "本日", "明日" in the entire row
            row_text = row.text.replace('\n', '')
            
            status = "確認中"
            today_str = datetime.now().strftime("%m/%d")
            tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%m/%d")
            
            if "本日" in row_text:
                status = today_str
            elif "明日" in row_text:
                status = tomorrow_str
            elif row.select_one("span") and '入荷未定' in row.select_one("span").text:
                status = "入荷未定"
            elif "入荷未定" in row_text or "出荷調整" in row_text:
                status = "入荷未定"
            else:
                # Try getting the 6th TD (index 5)
                tds = row.select("td")
                if len(tds) > 5:
                    status = tds[5].text.strip()
                    
            print(f"Name: {name[:20]}, Status: {status}")
            data.append({"name": name, "status": status})
            
        await browser.close()
        print(f"Final Count: {len(data)}")
        return data

if __name__ == "__main__":
    asyncio.run(run())
