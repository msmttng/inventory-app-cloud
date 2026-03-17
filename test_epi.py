import asyncio
from playwright.async_api import async_playwright
import os
import requests
import datetime

GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec"

async def test_orderepi():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        
        epi_email = os.environ.get("ORDER_EPI_ID", "000877242")
        epi_password = os.environ.get("ORDER_EPI_PASSWORD", "m1m1m1m1")
        
        try:
            repo_page = await browser_context.new_page()
            await repo_page.goto("https://www.order-epi.com/order/", wait_until="domcontentloaded")
            
            print("Login check...")
            if "login" in repo_page.url.lower() or "id" in repo_page.url.lower() or await repo_page.locator("#USER_ID").count() > 0:
                print("Order-EPI login trial...")
                if await repo_page.locator("#USER_ID").count() > 0:
                     await repo_page.fill("#USER_ID", epi_email)
                     await repo_page.fill("#ID_PASSWD", epi_password)
                     await repo_page.press("#ID_PASSWD", "Enter")
                     await repo_page.wait_for_load_state("domcontentloaded")
                     await asyncio.sleep(2)
            
            print("Click history...")
            try:
                await repo_page.locator("span", has_text="発注履歴").first.click(timeout=10000)
                await repo_page.wait_for_load_state("domcontentloaded")
                await asyncio.sleep(5)
            except Exception as click_err:
                print(f"Error clicking: {click_err}")
                await repo_page.goto("https://www.order-epi.com/order/servlet/InvokerServlet?s2=OrderHistoryList", wait_until="domcontentloaded")
                await asyncio.sleep(3)
            
            table_found = False
            csv_data_body = ""
            added_rows = 0
            for frame in repo_page.frames:
                try:
                    rows_locator = frame.locator("table.listTable tr, table.grid tr, table tr")
                    count = await rows_locator.count()
                    if count > 1:
                        for i in range(count):
                            texts = await rows_locator.nth(i).locator("td").all_inner_texts()
                            if len(texts) >= 7:
                                date_raw = texts[6].replace('\n', ' ').replace(',', '').replace('\xa0', ' ').strip()
                                date_parts = [p for p in date_raw.split(' ') if p]
                                if len(date_parts) >= 2:
                                    date_str = f"'{datetime.datetime.now().year}/{date_parts[0]} {date_parts[1]}"
                                else:
                                    date_str = f"'{date_raw}"
                                status_str = "完了"
                                maker_str = texts[2].replace('\n', ' ').replace(',', '').strip()
                                name_str = texts[3].replace('\n', ' ').replace(',', '').strip()
                                unit_str = ""
                                qty_str = texts[4].replace('\n', ' ').replace(',', '').strip()
                                supplier_str = texts[5].replace('\n', ' ').replace(',', '').strip()
                                csv_data_body += f"{date_str},{status_str},{maker_str},{name_str},,{unit_str},{qty_str},{supplier_str}\n"
                                added_rows += 1
                        
                        if added_rows > 0:
                            print(f"EPI History Table Found ({count} rows)")
                            table_found = True
                            break
                except Exception as e:
                    pass
            
            if table_found and added_rows > 0:
                csv_data = "発注日,状態,メーカー,品名,規格,単位,数量,発注先\n" + csv_data_body
                print(f"Order-EPI History: Success ({added_rows} rows)")
                # Output brief logic
                print(csv_data[:300])
                res = requests.post(GAS_WEB_APP_URL, params={'type': 'history'}, data=csv_data.encode('utf-8'))
                print("GAS upload status:", res.status_code)
            else:
                 print("⚠️ Order-EPI 履歴テーブルが見つかりませんでした。")
            await repo_page.close()
        except Exception as e:
            print(f"⚠️ Order-EPI Error: {e}")
            
        await browser.close()

asyncio.run(test_orderepi())
