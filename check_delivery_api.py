import asyncio
import os
import json
from datetime import datetime
from playwright.async_api import async_playwright

async def check_medorder_delivery(browser):
    print(f"\n[{datetime.now()}] --- Checking MedOrder token and API response ---")
    browser_context = None
    try:
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        medorder_token = None
        m_page = await browser_context.new_page()

        async def capture_token(request):
            nonlocal medorder_token
            if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in request.url:
                auth = request.headers.get("authorization", "")
                if auth.startswith("Bearer ") and not medorder_token:
                    medorder_token = auth.replace("Bearer ", "")

        m_page.on("request", capture_token)
        await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
        
        if "users/sign_in" in m_page.url:
            email = os.environ.get("MEDORDER_EMAIL")
            password = os.environ.get("MEDORDER_PASSWORD")
            if email and password:
                print(f"[{datetime.now()}] Login...")
                await m_page.fill("#user_email", email)
                await m_page.fill("#user_password", password)
                await m_page.click("input[type='submit']")
                await m_page.wait_for_load_state("domcontentloaded")
            else:
                print(f"[{datetime.now()}] Login required but no credentials")
        
        for _ in range(30):
            if medorder_token: break
            await asyncio.sleep(1)
        
        if medorder_token:
            import requests # fallback to synchronous requests for the api call
            print(f"[{datetime.now()}] Token acquired. Fetching active orders...")
            
            headers = {'Authorization': f'Bearer {medorder_token}', 'Accept': 'application/json'}
            api_url = "https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?state=shipping&items=50"
            res = requests.get(api_url, headers=headers)
            
            if res.status_code == 200:
                data = res.json()
                extracted = []
                for order in data:
                    for item in order.get('items', []):
                        # Safely handle None for orderable_item
                        orderable = item.get('orderable_item')
                        name = orderable.get('name') if orderable else "Unknown"
                        
                        extracted.append({
                            'order_id': order.get('id'),
                            'item_name': name,
                            'quantity': item.get('quantity'),
                            'delivers_on': item.get('delivers_on'),
                            'shipping_date': item.get('shipping_date'),
                            'delivery_date': item.get('delivery_date')
                        })
                print("\n--- DELIVERY SCHEDULE RESULTS ---")
                print(json.dumps(extracted, indent=2, ensure_ascii=False))
            else:
                print(f"API Error: {res.status_code}")
                
            await m_page.close()
            return True
        else:
            print("Token capture failed")
            return False

    except Exception as e:
        print(f"[{datetime.now()}] Error: {e}")
    finally:
        if browser_context:
            await browser_context.close()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--start-maximized', '--disable-blink-features=AutomationControlled']
        )
        await check_medorder_delivery(browser)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
