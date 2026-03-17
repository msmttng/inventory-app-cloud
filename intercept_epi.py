import asyncio
import os
from playwright.async_api import async_playwright
import urllib.parse

async def intercept_orderepi():
    epi_email = os.environ.get("ORDER_EPI_ID", "000877242")
    epi_password = os.environ.get("ORDER_EPI_PASSWORD", "m1m1m1m1")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await context.new_page()

        async def on_request(request):
            url = request.url.lower()
            if "login" in url or "servlet" in url or "orderhistory" in url or request.method == "POST":
                print(f"\n[REQ] {request.method} {request.url}")
                if request.post_data:
                    # try to decode x-www-form-urlencoded
                    try:
                        decoded = urllib.parse.unquote(request.post_data)
                        print(f"Data: {decoded}")
                    except:
                        print(f"Data: {request.post_data[:200]}")

        async def on_response(response):
            url = response.url.lower()
            if "login" in url or "servlet" in url or "orderhistory" in url:
                print(f"[RES] {response.status} {response.url}")
                
        page.on("request", on_request)
        page.on("response", on_response)

        print("Navigating to Order-EPI...")
        await page.goto("https://www.order-epi.com/order/", wait_until="domcontentloaded")
        
        print("Logging in...")
        if await page.locator("#USER_ID").count() > 0:
            await page.fill("#USER_ID", epi_email)
            await page.fill("#ID_PASSWD", epi_password)
            await page.press("#ID_PASSWD", "Enter")
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(2)
        
        print("Clicking history...")
        try:
            await page.locator("span", has_text="発注履歴").first.click(timeout=10000)
            await page.wait_for_load_state("networkidle")
            await asyncio.sleep(5)
        except Exception as click_err:
            print(f"Error clicking: {click_err}")
            await page.goto("https://www.order-epi.com/order/servlet/InvokerServlet?s2=OrderHistoryList", wait_until="domcontentloaded")
            await asyncio.sleep(3)
        
        print("Done capturing.")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(intercept_orderepi())
