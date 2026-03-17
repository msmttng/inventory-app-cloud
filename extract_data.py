import asyncio
import os
import requests  # type: ignore
import json
import base64
from datetime import datetime
from playwright.async_api import async_playwright  # type: ignore

# 設定
GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwDhj91LpWaF6OWhTmr6hbYLgScu0tlBcs2Y4nyXvg2WAwybHYGd5-V579tf0I5_H2dCQ/exec"
LOOKER_STUDIO_URL = "https://lookerstudio.google.com/reporting/fd3dd8c8-38ab-4cc0-bad4-c23552bb7209/page/p_9rj9sjgqvc?pli=1"
DOWNLOAD_DIR = "/tmp/downloads" if os.name != 'nt' else os.environ.get('TEMP', '.')

if not os.path.exists(DOWNLOAD_DIR):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def report_status(status_msg: str):
    try:
        requests.post(GAS_WEB_APP_URL, params={'type': 'medorder_status'}, data=status_msg.encode('utf-8'))
        print(f"[{datetime.now()}] Status reported: {status_msg}")
    except Exception as e:
        print(f"[{datetime.now()}] Status report failed: {e}")

def send_log(log_msg: str):
    try:
        requests.post(GAS_WEB_APP_URL, params={'type': 'execution_log'}, data=log_msg.encode('utf-8'))
        print(f"[{datetime.now()}] Log sent: {log_msg}")
    except Exception as e:
        print(f"[{datetime.now()}] Log send failed: {e}")

async def extract_looker_studio(browser, state_path):
    print(f"\n[{datetime.now()}] --- PHASE 1: Looker Studio からのデータ抽出 ---")
    browser_context = None
    try:
        if state_path and os.path.exists(state_path):
            browser_context = await browser.new_context(storage_state=state_path, viewport={'width': 1920, 'height': 1080})
        else:
            print(f"[{datetime.now()}] ⚠️ Looker Studio: 認証情報（state.json）がありません。失敗する可能性があります。")
            browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})

        page = await browser_context.new_page()
        await page.goto(LOOKER_STUDIO_URL, wait_until="domcontentloaded")
        await page.wait_for_url("**/reporting/**", timeout=30000)
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
        await asyncio.sleep(5)
        
        # 在庫日次
        await page.locator("text='在庫 - 日次'").first.click(timeout=30000)
        table_title = page.locator("text='品目別の在庫数'").first
        await table_title.wait_for(state="visible", timeout=60000)
        await asyncio.sleep(3)
        
        box = await table_title.bounding_box()
        if box:
            await page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height'] + 50, button="right")
        else:
            await table_title.click(button="right")
        
        await page.locator("text=/グラフをエクスポート/").first.click()
        await page.locator("text=/データのエクスポート/").first.click()
        await page.locator("text='CSV'").first.click()
        
        async with page.expect_download() as download_info:
            await page.locator("role=button[name='エクスポート']").click()
        download = await download_info.value
        current_date = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_path = os.path.join(DOWNLOAD_DIR, f"inventory_export_{current_date}.csv")
        await download.save_as(file_path)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            requests.post(GAS_WEB_APP_URL, params={'type': 'inventory'}, data=f.read().encode('utf-8'))
        print(f"[{datetime.now()}] Looker Studio Inventory: Success")

        # 不動品/返品
        await page.locator("text='在庫 - 不動品'").first.click(timeout=30000)
        
        # 返品推奨品
        tt_return = page.locator("text='返品推奨品'").first
        await tt_return.wait_for(state="visible", timeout=30000)
        await tt_return.click(button="right")
        await page.locator("text=/グラフをエクスポート/").first.click()
        await page.locator("text=/データのエクスポート/").first.click()
        await page.locator("text='CSV'").first.click()
        async with page.expect_download() as d_info_ret:
            await page.locator("role=button[name='エクスポート']").click()
        d_ret = await d_info_ret.value
        f_ret = os.path.join(DOWNLOAD_DIR, f"return_export_{current_date}.csv")
        await d_ret.save_as(f_ret)
        with open(f_ret, 'r', encoding='utf-8') as f:
            requests.post(GAS_WEB_APP_URL, params={'type': 'return'}, data=f.read().encode('utf-8'))

        # 不動在庫
        tt_dead = page.locator("text='不動在庫の可能性がある品目'").first
        await tt_dead.wait_for(state="visible", timeout=30000)
        await tt_dead.click(button="right")
        await page.locator("text=/グラフをエクスポート/").first.click()
        await page.locator("text=/データのエクスポート/").first.click()
        await page.locator("text='CSV'").first.click()
        async with page.expect_download() as d_info_dead:
            await page.locator("role=button[name='エクスポート']").click()
        d_dead = await d_info_dead.value
        f_dead = os.path.join(DOWNLOAD_DIR, f"dead_stock_export_{current_date}.csv")
        await d_dead.save_as(f_dead)
        with open(f_dead, 'r', encoding='utf-8') as f:
            requests.post(GAS_WEB_APP_URL, params={'type': 'dead'}, data=f.read().encode('utf-8'))

        await page.close()
        return "Looker Studio Success"
    except Exception as e:
        err_msg = f"Looker Studio Error: {e}"
        print(f"[{datetime.now()}] ⚠️ {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()


async def extract_medorder(browser):
    print(f"\n[{datetime.now()}] --- PHASE 2: MedOrder トークンと薬品名同期 ---")
    browser_context = None
    try:
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        medorder_token = None
        report_status("Processing")
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
                print(f"[{datetime.now()}] 自動ログイン試行中...")
                await m_page.fill("#user_email", email)
                await m_page.fill("#user_password", password)
                await m_page.click("input[type='submit']")
                await m_page.wait_for_load_state("domcontentloaded")
            else:
                report_status("Login Required")
                print(f"[{datetime.now()}] ⚠️ 認証情報なし。ログインが必要です。")
        
        for _ in range(30):
            if medorder_token: break
            await asyncio.sleep(1)
        
        if medorder_token:
            t_val: str = str(medorder_token)
            requests.post(GAS_WEB_APP_URL, params={'type': 'medorder_token'}, data=t_val.encode('utf-8'))
            
            print(f"[{datetime.now()}] 薬品名マップの完全同期を開始します...")
            headers = {'Authorization': f'Bearer {medorder_token}', 'Accept': 'application/json'}
            item_name_map = {}
            all_ids = set()
            
            api_base = "https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/stocks?items=500&page="
            res = requests.get(api_base + "1", headers=headers, timeout=15)
            if res.status_code == 200:
                data = res.json()
                for item in data:
                    if item.get('stockable_item_id'): all_ids.add(str(item.get('stockable_item_id')))
                
                header_total_pages = res.headers.get('x-total-pages') or res.headers.get('X-Total-Pages')
                total_pages = int(header_total_pages) if header_total_pages else 1
                
                print(f"[{datetime.now()}] 在庫データ: 全 {total_pages} ページをスキャン中...")
                for p_idx in range(2, total_pages + 1):
                    res_p = requests.get(api_base + str(p_idx), headers=headers, timeout=15)
                    if res_p.status_code == 200:
                        for item in res_p.json():
                            if item.get('stockable_item_id'): all_ids.add(str(item.get('stockable_item_id')))
            
            id_list = list(all_ids)
            print(f"[{datetime.now()}] 全 {len(id_list)} 件の薬品名を解決中...")
            for i in range(0, len(id_list), 50):
                chunk = id_list[i:i+50]
                master_url = f"https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?ids={','.join(chunk)}"
                res_m = requests.get(master_url, headers=headers, timeout=15)
                if res_m.status_code == 200:
                    for mitem in res_m.json():
                        item_name_map[str(mitem.get('id'))] = {
                            'name': mitem.get('name'),
                            'unit': mitem.get('unit_name') or '個'
                        }
                await asyncio.sleep(0.5)
            
            if item_name_map:
                print(f"[{datetime.now()}] 薬品名マップ {len(item_name_map)}件 を送信中...")
                requests.post(GAS_WEB_APP_URL, params={'type': 'medorder_names'}, data=json.dumps(item_name_map, ensure_ascii=False).encode('utf-8'))
            
            report_status("OK")
            await m_page.close()
            return "MedOrder Success"
        else:
            status = "Login Required" if "users/sign_in" in m_page.url else "Timeout"
            report_status(status)
            raise RuntimeError(f"Token capture failed: {status}")

    except Exception as e:
        report_status("Error")
        err_msg = f"MedOrder Error: {e}"
        print(f"[{datetime.now()}] ⚠️ {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()


async def extract_orderepi(browser):
    print(f"\n[{datetime.now()}] --- PHASE 3: Order EPI からの発注履歴抽出 ---")
    epi_email = os.environ.get("ORDER_EPI_ID")
    epi_password = os.environ.get("ORDER_EPI_PASSWORD")
    
    if not epi_email or not epi_password:
        print(f"[{datetime.now()}] ⚠️ ORDER_EPI_ID または ORDER_EPI_PASSWORD が設定されていないため、Phase 3はスキップします。")
        return "OrderEPI Skipped"

    browser_context = None
    try:
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        repo_page = await browser_context.new_page()
        await repo_page.goto("https://www.order-epi.com/order/", wait_until="domcontentloaded")
        
        if "login" in repo_page.url.lower() or "id" in repo_page.url.lower() or await repo_page.locator("#USER_ID").count() > 0:
            print(f"[{datetime.now()}] Order-EPI 自動ログイン試行...")
            if await repo_page.locator("#USER_ID").count() > 0:
                 await repo_page.fill("#USER_ID", epi_email)
                 await repo_page.fill("#ID_PASSWD", epi_password)
                 await repo_page.press("#ID_PASSWD", "Enter")
                 await repo_page.wait_for_load_state("domcontentloaded")
                 await asyncio.sleep(2)
        
        print(f"[{datetime.now()}] 発注履歴ボタンをクリックします...")
        try:
            await repo_page.locator("span", has_text="発注履歴").first.click(timeout=10000)
            await repo_page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(5)
        except Exception as click_err:
            print(f"[{datetime.now()}] ⚠️ 画面上の発注履歴ボタンが見つからないかクリックに失敗しました。: {click_err}")
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
                                date_str = f"'{datetime.now().year}/{date_parts[0]} {date_parts[1]}"
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
                        print(f"[{datetime.now()}] Order-EPI 履歴テーブルを発見しました (約 {count} 行)")
                        table_found = True
                        break
            except Exception as e:
                pass
        
        if table_found and added_rows > 0:
            csv_data = "発注日,状態,メーカー,品名,規格,単位,数量,発注先\n" + csv_data_body
            requests.post(GAS_WEB_APP_URL, params={'type': 'history'}, data=csv_data.encode('utf-8'))
            print(f"[{datetime.now()}] Order-EPI History: Success ({added_rows} rows)")
            await repo_page.close()
            return f"OrderEPI Success ({added_rows} rows)"
        else:
             print(f"[{datetime.now()}] ⚠️ Order-EPI 履歴テーブルが見つかりませんでした。")
             raise RuntimeError("OrderEPI Hitory table not found")
    except Exception as e:
        err_msg = f"Order-EPI Error: {e}"
        print(f"[{datetime.now()}] ⚠️ {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()


async def run_extraction():
    print(f"[{datetime.now()}] Looker Studio & MedOrder データ抽出を開始します... (GitHub Actions Cloud Mode)")
    
    state_path = None
    b64_state = os.environ.get("GOOGLE_AUTH_STATE_BASE64")
    if b64_state:
        try:
            state_json = base64.b64decode(b64_state).decode('utf-8')
            state_path = os.path.join(DOWNLOAD_DIR, "state.json")
            with open(state_path, "w", encoding="utf-8") as f:
                f.write(state_json)
            print(f"[{datetime.now()}] Google認証状態ファイルを復元しました。")
        except Exception as e:
            print(f"[{datetime.now()}] ⚠️ 認証状態の復元に失敗しました: {e}")
    else:
        print(f"[{datetime.now()}] ⚠️ GOOGLE_AUTH_STATE_BASE64 が設定されていません。Looker Studioの取得に失敗する可能性があります。")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--start-maximized', '--disable-blink-features=AutomationControlled']
        )

        # 3つのPhaseを非同期で同時に走らせる
        results = await asyncio.gather(
            extract_looker_studio(browser, state_path),
            extract_medorder(browser),
            extract_orderepi(browser),
            return_exceptions=True
        )

        await browser.close()
        
        # エラーの集計
        failures = []
        for res in results:
            if isinstance(res, Exception):
                failures.append(str(res))
        
        if len(failures) > 0:
            error_details = ' | '.join(failures)
            # Some failed
            raise RuntimeError(f"一部のフェーズが失敗しました: {error_details}")

        return "データ抽出とトークン更新が正常に完了しました。"

async def main():
    max_retries = 3
    for attempt in range(max_retries):
        try:
            msg = await run_extraction()
            print(f"[{datetime.now()}] 🎉 {msg}")
            send_log(msg)
            break
        except Exception as e:
            err_msg = f"試行 {attempt+1} 失敗: {e}"
            print(f"[{datetime.now()}] ⚠️ {err_msg}")
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 10
                print(f"[{datetime.now()}] {wait_time}秒後に再試行します...")
                report_status(f"Retrying ({attempt+1})")
                await asyncio.sleep(wait_time)
            else:
                fatal_msg = f"最大試行回数に達しました。最終エラー: {e}"
                print(f"[{datetime.now()}] ❌ {fatal_msg}")
                report_status("Fatal Error")
                send_log(fatal_msg)

if __name__ == "__main__":
    asyncio.run(main())
