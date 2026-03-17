import asyncio
import os
import json
from datetime import datetime
from playwright.async_api import async_playwright
import requests

async def check_medorder_delivery(browser):
    email = os.environ.get("MEDORDER_EMAIL")
    password = os.environ.get("MEDORDER_PASSWORD")
    if not email or not password:
        print("Missing credentials")
        return

    context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
    m_page = await context.new_page()
    medorder_token = None

    async def capture_token(request):
        nonlocal medorder_token
        if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in request.url:
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                medorder_token = auth.replace("Bearer ", "")

    m_page.on("request", capture_token)
    await m_page.goto("https://app.medorder.jp/users/sign_in", wait_until="domcontentloaded")
    
    await m_page.fill("#user_email", email)
    await m_page.fill("#user_password", password)
    await m_page.click("input[type='submit']")
    await m_page.wait_for_load_state("domcontentloaded")
    
    await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="networkidle")

    for _ in range(15):
        if medorder_token: break
        await asyncio.sleep(1)

    if medorder_token:
        print("Token acquired. Fetching sample orders with state=shipping...")
        headers = {'Authorization': f'Bearer {medorder_token}', 'Accept': 'application/json'}
        # Fetch a few recent, active orders to see their data structure
        for state in ['shipping', 'new', 'completed']:
            print(f"\n--- Checking Orders State: {state} ---")
            api_url = f"https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=10&state={state}"
            res = requests.get(api_url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                extracted = []
                for order in data:
                    for item in order.get('items', []):
                        extracted.append({
                            'order_id': order.get('id'),
                            'item_name': item.get('orderable_item', {}).get('name') if item.get('orderable_item') else 'Unknown',
                            'quantity': item.get('quantity'),
                            'delivers_on': item.get('delivers_on'),
                            'shipping_date': item.get('shipping_date'),
                            'delivery_date': item.get('delivery_date')
                        })
                print(json.dumps(extracted, indent=2, ensure_ascii=False))
            else:
                print(f"API Error {state}: {res.status_code}")
                
    await context.close()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        await check_medorder_delivery(browser)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
