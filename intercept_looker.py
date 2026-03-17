import asyncio
import os
import json
import base64
from playwright.async_api import async_playwright

LOOKER_STUDIO_URL = "https://lookerstudio.google.com/reporting/fd3dd8c8-38ab-4cc0-bad4-c23552bb7209/page/p_9rj9sjgqvc?pli=1"

async def intercept_looker_studio():
    state_path = "state.json"
    if not os.path.exists(state_path):
        b64_state = os.environ.get("GOOGLE_AUTH_STATE_BASE64")
        if b64_state:
            with open(state_path, "w", encoding="utf-8") as f:
                f.write(base64.b64decode(b64_state).decode('utf-8'))

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(storage_state=state_path, viewport={'width': 1920, 'height': 1080})
        page = await context.new_page()

        # Intercept and print export-related requests
        async def on_request(request):
            if "export" in request.url.lower() or "csv" in request.url.lower() or "batchexecute" in request.url.lower():
                print(f"\n[INTERCEPT] POST Request: {request.url}")
                print(f"Headers: {request.headers}")
                if request.post_data:
                    print(f"Payload Preview: {request.post_data[:500]}...")

        async def on_response(response):
            if "export" in response.url.lower() or "csv" in response.url.lower() or "batchexecute" in response.url.lower():
                print(f"\n[INTERCEPT] Response: {response.status} from {response.url}")

        page.on("request", on_request)
        page.on("response", on_response)

        print("Navigating to Looker Studio...")
        await page.goto(LOOKER_STUDIO_URL, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=60000)
        
        print("Clicking export flow to trigger API calls...")
        await page.locator("text='在庫 - 日次'").first.click()
        table_title = page.locator("text='品目別の在庫数'").first
        await table_title.wait_for(state="visible", timeout=60000)
        await asyncio.sleep(2)
        
        await table_title.click(button="right")
        await page.locator("text=/グラフをエクスポート/").first.click()
        await page.locator("text=/データのエクスポート/").first.click()
        await page.locator("text='CSV'").first.click()
        
        async with page.expect_download() as download_info:
            await page.locator("role=button[name='エクスポート']").click()
        download = await download_info.value
        print(f"Downloaded {download.suggested_filename}")
        
        await asyncio.sleep(5)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(intercept_looker_studio())
