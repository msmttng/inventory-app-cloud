from dotenv import load_dotenv
load_dotenv()
import asyncio
import os
import json
from datetime import datetime, timezone
from playwright.async_api import async_playwright
import urllib.request
import urllib.parse
import hashlib

SUPA_URL = os.environ.get('SUPABASE_URL', 'https://jscqmecctsijqxihnxwi.supabase.co/rest/v1')
SUPA_KEY = os.environ.get('SUPABASE_KEY', 'put_your_supabase_key_here')

async def get_medorder_deliveries(browser):
    print(f"\n[{datetime.now()}] --- Fetching MedOrder Deliveries for Today ---")
    browser_context = None
    try:
        medorder_token = None
        m_page = await browser.new_page()

        async def capture_token(request):
            nonlocal medorder_token
            if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in request.url:
                auth = request.headers.get("authorization", "")
                if auth.startswith("Bearer ") and not medorder_token:
                    medorder_token = auth.replace("Bearer ", "")

        m_page.on("request", capture_token)
        await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
        
        if "users/sign_in" in m_page.url or "auth0.com" in m_page.url:
            email = os.environ.get("MEDORDER_EMAIL")
            password = os.environ.get("MEDORDER_PASSWORD")
            if email and password:
                if "auth0.com" in m_page.url:
                    await m_page.fill("input[name='email'], input[name='username']", email)
                    await m_page.fill("input[name='password']", password)
                    await m_page.click("button:has-text('LOG IN'), button[type='submit']")
                else:
                    await m_page.fill("#user_email", email)
                    await m_page.fill("#user_password", password)
                    await m_page.click("input[type='submit']")
                await m_page.wait_for_load_state("domcontentloaded", timeout=30000)
                await asyncio.sleep(3)
                if "stocks" not in m_page.url:
                    await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
        
        for _ in range(30):
            if medorder_token: break
            await asyncio.sleep(1)
        
        if medorder_token:
            import requests
            headers = {'Authorization': f'Bearer {medorder_token}', 'Accept': 'application/json'}
            api_base = "https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/sdcvan_delivery_d_records?status=20&page="
            res = requests.get(api_base + "1", headers=headers)
            
            records = []
            if res.status_code == 200:
                data = res.json()
                total_pages = int(res.headers.get('X-Total-Pages') or res.headers.get('x-total-pages') or 1)
                if total_pages > 1:
                    max_p = min(total_pages, 10) # 10ページ(500件)まで取得
                    for p in range(2, max_p + 1):
                        res_p = requests.get(api_base + str(p), headers=headers)
                        if res_p.status_code == 200:
                            data.extend(res_p.json())
                            
                print(f"DEBUG: API returned {len(data)} deliveries.")
                today_str = datetime.now().strftime('%Y-%m-%d')
                
                jan_codes = [str(item.get('item_code')) for item in data if item.get('item_code')]
                jan_map = {}
                if jan_codes:
                    for i in range(0, len(jan_codes), 50):
                        chunk = jan_codes[i:i+50]
                        master_url = f"https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?jan_codes={','.join(chunk)}"
                        res_m = requests.get(master_url, headers=headers, timeout=15)
                        if res_m.status_code == 200:
                            for mitem in res_m.json():
                                for oitem in mitem.get('orderable_items', []):
                                    jc = str(oitem.get('jan_code', ''))
                                    yj = str(oitem.get('yj_code', ''))
                                    if jc:
                                        jan_map[str(oitem.get('jan_code'))] = {
                                            'name': mitem.get('name'),
                                            'yj_code': mitem.get('yj_code'),
                                            'pack_name': oitem.get('name')
                                        }

                gas_csv_rows = ["納品日,薬品名,取引先,数量,元データ名"]
                for record in data:
                    delivery_date = record.get('slipped_on', '')
                    # Only process today's deliveries
                    if delivery_date == today_str:
                        qty = float(record.get('quantity', 0))
                        jc = str(record.get('item_code', ''))
                        
                        m_info = jan_map.get(jc, {})
                        name = m_info.get('name') or record.get('name', 'Unknown')
                        yj_code = m_info.get('yj_code') or ""
                        
                        # Fetch current stock and unit
                        stock_balance = 0
                        inv_unit = ''
                        try:
                            if yj_code:
                                s_req = requests.get(f"{SUPA_URL}/inventory?yj_code=eq.{yj_code}&select=stock,unit", headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'})
                            else:
                                import urllib.parse
                                enc_name = urllib.parse.quote(name)
                                s_req = requests.get(f"{SUPA_URL}/inventory?name=eq.{enc_name}&select=yj_code,stock,unit", headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'})
                                
                            if s_req.status_code == 200 and len(s_req.json()) > 0:
                                if not yj_code:
                                    yj_code = s_req.json()[0].get('yj_code', '')
                                stock_balance = float(str(s_req.json()[0].get('stock', '0')).replace(',', ''))
                                inv_unit = str(s_req.json()[0].get('unit', ''))
                        except: pass

                        pack_name = m_info.get('pack_name')
                        if pack_name:
                            raw_name = pack_name.replace(',', ' ')
                        else:
                            raw_name = record.get('name', 'Unknown').replace(',', ' ')

                        dealer_code = str(record.get('s_record', {}).get('dealer_code', ''))
                        dealer_name = 'MedOrder卸(速報)'
                        if dealer_code.startswith('9'):
                            if '156' in dealer_code: dealer_name = 'スズケン(速報)'
                            elif '122' in dealer_code: dealer_name = 'メディセオ(速報)'
                            elif '960' in dealer_code: dealer_name = 'アルフレッサ(速報)'
                            elif '261' in dealer_code: dealer_name = '東邦薬品(速報)'

                        gas_dn = name.replace(',', ' ')
                        gas_dealer = dealer_name.replace('(速報)', '')

                        # --- 包装単位の換算ロジック ---
                        import re
                        pack_amount = 1
                        if raw_name:
                            normalized_raw = raw_name.upper().replace('×', 'X').replace('Ｘ', 'X')
                            normalized_raw = re.sub(r'\s+X\s+', 'X', normalized_raw)
                            normalized_raw = re.sub(r'\s+', ' ', normalized_raw, count=1)
                            
                            is_container = bool(re.search(r'瓶|本|筒|管|ｷｯﾄ|キット|ｼﾘﾝｼﾞ|シリンジ', inv_unit))
                            is_sachet = bool(re.search(r'包', inv_unit))

                            x_match = re.search(r'([0-9.]+)[^X\d]*X[^\d]*(\d+)(?:\s|$)', normalized_raw)
                            if x_match:
                                val1 = float(x_match.group(1))
                                val2 = float(x_match.group(2))
                                if is_container or is_sachet:
                                    pack_amount = val2
                                else:
                                    pack_amount = val1 * val2
                            else:
                                tokens = re.split(r'\s+', normalized_raw)
                                pack_str = ''
                                for token in reversed(tokens):
                                    if re.search(r'\d', token):
                                        pack_str = token
                                        break
                                if pack_str:
                                    num_match = re.search(r'(\d+)', pack_str)
                                    if num_match:
                                        val = float(num_match.group(1))
                                        if is_container:
                                            pack_amount = 1
                                        else:
                                            pack_amount = val

                        final_qty = qty * pack_amount
                        
                        raw_hash = f"{jc}_{delivery_date}_{qty}_{record.get('id')}"
                        unique_hash = hashlib.md5(raw_hash.encode('utf-8')).hexdigest()
                        
                        # Check if this delivery was already processed
                        chk_req = requests.get(f"{SUPA_URL}/transaction_history?unique_hash=eq.{unique_hash}&select=id", headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'})
                        is_new_delivery = True
                        if chk_req.status_code == 200 and len(chk_req.json()) > 0:
                            is_new_delivery = False
                            
                        if is_new_delivery:
                            new_stock = stock_balance + final_qty
                            
                            # Update inventory table stock
                            # 優先: yj_code で検索。0件ヒットなら name にフォールバック
                            patch_headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                                             'Content-Type': 'application/json',
                                             'Prefer': 'return=representation'}
                            new_stock_str = str(int(new_stock)) if float(new_stock).is_integer() else str(round(new_stock, 2))
                            patch_ok = False

                            if yj_code:
                                patch_url = f"{SUPA_URL}/inventory?yj_code=eq.{yj_code}"
                                p_req = requests.patch(patch_url, headers=patch_headers, json={'stock': new_stock_str})
                                if p_req.status_code in [200, 204] and len(p_req.json()) > 0:
                                    print(f"✅ 在庫加算成功(yj): {name} {stock_balance} -> {new_stock_str} (+{final_qty})")
                                    patch_ok = True
                                elif p_req.status_code in [200, 204] and len(p_req.json()) == 0:
                                    print(f"⚠️ yj_code({yj_code})で0件マッチ → name検索にフォールバック: {name}")

                            if not patch_ok:
                                # name フォールバック
                                patch_url_name = f"{SUPA_URL}/inventory?name=eq.{urllib.parse.quote(name)}"
                                p_req2 = requests.patch(patch_url_name, headers=patch_headers, json={'stock': new_stock_str})
                                if p_req2.status_code in [200, 204] and len(p_req2.json()) > 0:
                                    print(f"✅ 在庫加算成功(name): {name} {stock_balance} -> {new_stock_str} (+{final_qty})")
                                    patch_ok = True
                                else:
                                    print(f"❌ 在庫加算失敗(yj+name両方): {name} HTTP={p_req2.status_code}, body={p_req2.text[:100]}")

                            import uuid
                            record_id = str(uuid.uuid4())
                            
                            records.append({
                                'id': record_id,
                                'transaction_date': datetime.now(timezone.utc).isoformat(),
                                'yj_code': yj_code,
                                'name': name,
                                'transaction_type': '納品(速報)',
                                'qty_in': final_qty,
                                'qty_out': 0,
                                'stock_balance': new_stock,
                                'partner': dealer_name,
                                'unique_hash': unique_hash
                            })
                            
                            # DEBUG: Print to verify pack_name parsing
                            if 'カルボ' in gas_dn or 'NIG' in raw_name or 'サワシリン' in gas_dn:
                                print(f"DEBUG PACK_NAME: gas_dn='{gas_dn}' qty='{qty}' final_qty='{final_qty}' raw_name='{raw_name}' unit='{inv_unit}'")
                                
                            gas_csv_rows.append(f"{delivery_date},{gas_dn},{gas_dealer},{final_qty},{raw_name}")
                
                # Push to Supabase and GAS
                if records:
                    s_headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}', 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates'}
                    r_supa = requests.post(f'{SUPA_URL}/transaction_history?on_conflict=unique_hash', headers=s_headers, json=records)
                    print(f"Pushed {len(records)} delivery records to Supabase. Status: {r_supa.status_code}")
                    
                    gas_url = 'https://script.google.com/macros/s/AKfycbwp7WfGg5Md1-or1ihfVPH_KuMBQw41BVnUzR9iACTv0m8iG2DpLcnW-0Ui2zBFrTJWUg/exec'
                    gas_csv_data = "\n".join(gas_csv_rows)
                    
                    try:
                        r_gas = requests.post(gas_url, params={'type': 'receive_history'}, data=gas_csv_data.encode('utf-8'), timeout=60)
                        print(f"Pushed {len(records)} delivery records to GAS. Status: {r_gas.status_code}")
                        
                        resp_json = r_gas.json()
                        if resp_json.get('status') != 'success':
                            print(f"GAS API Error: {resp_json}")
                    except ValueError:
                        print(f"GAS API Response Error: HTTP {r_gas.status_code}")
                    except Exception as ge:
                        print(f"GAS Push Error: {ge}")

                else:
                    print("No new deliveries today.")
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
        pass

async def main():
    async with async_playwright() as p:
        LOCAL_PROFILE = r"C:\Users\masam\.gemini\antigravity\scratch\playwright_profile"
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=LOCAL_PROFILE,
            headless=True
        )
        await get_medorder_deliveries(browser)
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
