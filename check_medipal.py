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
        
        await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet", wait_until="networkidle")
        
        if await page.locator('input[type="text"]').count() > 0:
            await page.fill('input[type="text"]', medipal_id)
            await page.fill('input[type="password"]', medipal_pw)
            await page.click('.btnLogin, input[type="image"][src*="login"]')
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(5)
            
        print(f"Current URL: {page.url}")
        
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        container = soup.select_one("section#cFooter") or soup
        items_raw = container.select("tr")
        print(f"Found {len(items_raw)} rows.")
        
        data = []
        for row in items_raw:
            if not row.text.strip(): continue
            name_el = row.select_one("td.MstHnm i, td.MstHnm span") or row.select_one("a[id^='hnmy']")
            if not name_el: continue
            name = name_el.text.strip()
            
            status = ""
            if row.select_one("img[src*='honjitu.png']"):
                status = "本日"
            elif row.select_one("img[src*='asita.png']"):
                status = "明日"
            elif row.select_one("img[src*='mingo.png']"):
                status = "明後日"
            elif "メーカー出荷調整品：入荷未定" in row.text:
                status = "入荷未定(出荷調整)"
            elif row.select_one(".MstKpnErr"):
                status = "入荷未定"
            else:
                tds = row.select("td")
                if len(tds) > 0:
                    last_td = tds[-1].text.strip()
                    if last_td:
                        status = last_td
                if not status:
                    status = "確認中"
                    
            print(f"Name: {name}, Status: {status}")
            data.append({"name": name, "status": status})
            
        await browser.close()
        return data

if __name__ == "__main__":
    asyncio.run(run())
