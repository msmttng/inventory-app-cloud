import asyncio
import os
import sys
import requests  # type: ignore
import json
import base64
from datetime import datetime, timedelta
from playwright.async_api import async_playwright  # type: ignore

# Load .env manually if it exists
if os.path.exists(".env"):
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            if line.strip() and not line.startswith("#") and "=" in line:
                key, value = line.strip().split("=", 1)
                os.environ[key] = value

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
            print(f"[{datetime.now()}] [WARNING] Looker Studio: 認証情報（state.json）がありません。失敗する可能性があります。")
            browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})

        page = await browser_context.new_page()
        await page.goto(LOOKER_STUDIO_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # ── accountchooser / ログインページの自動処理 ──
        for _ in range(10):  # 最大10回リダイレクトを追跡
            current_url = page.url
            if "accountchooser" in current_url or "accounts.google.com" in current_url:
                print(f"[{datetime.now()}] Googleアカウント選択ページを検出: {current_url[:80]}")
                # 最初のアカウント行をクリック（Signed out でもクリックして進む）
                try:
                    account_btn = page.locator("li[aria-label], [data-email], .account-name").first
                    if await account_btn.count() > 0:
                        await account_btn.click(timeout=5000)
                    else:
                        # テキストで探す
                        await page.locator("text=masamitting@gmail.com").first.click(timeout=5000)
                    await asyncio.sleep(3)
                    print(f"[{datetime.now()}] アカウントクリック後URL: {page.url[:80]}")
                except Exception as acc_err:
                    print(f"[{datetime.now()}] [WARNING] アカウント選択クリック失敗: {acc_err}")
                    break
            elif "reporting" in current_url:
                print(f"[{datetime.now()}] Looker Studio レポートページに到達: {current_url[:80]}")
                break
            else:
                await asyncio.sleep(2)

        # /reporting/ URL に到達するまで最大90秒待つ
        try:
            await page.wait_for_url("**/reporting/**", timeout=90000)
        except Exception:
            print(f"[{datetime.now()}] [WARNING] /reporting/ への到達タイムアウト。現在のURL: {page.url[:100]}")
            raise
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
        await asyncio.sleep(10)  # Looker Studio のチャート描画完了を待つ
        
        # ── CSVクリック共通ヘルパー ──
        async def click_csv_option(pg):
            """エクスポートダイアログの CSV 選択肢を複数の方法で確実にクリックする"""
            # ダイアログが完全に描画されるのを待つ（4秒で余裕を持たせる）
            await asyncio.sleep(4)

            # 戦略1: JS で全要素を走査して textContent が厳密に 'CSV' のものをクリック
            clicked = await pg.evaluate("""
                () => {
                    const all = Array.from(document.querySelectorAll('*'));
                    // 子要素なし（葉ノード）でテキストが 'CSV' の要素を優先
                    const exact = all.find(el => {
                        const t = el.textContent.trim();
                        return t === 'CSV' && el.children.length === 0;
                    });
                    if (exact) { exact.click(); return 'leaf'; }
                    // 次点: textContent が 'CSV' の最初の要素
                    const loose = all.find(el => el.textContent.trim() === 'CSV');
                    if (loose) { loose.click(); return 'loose'; }
                    return null;
                }
            """)
            if clicked:
                print(f"[{datetime.now()}] CSV JS click 成功 (strategy: {clicked})")
                return

            print(f"[{datetime.now()}] JS click失敗 - XPath で再試行")
            # 戦略2: XPath でテキストが完全一致するノードの親要素をクリック
            try:
                await pg.locator("xpath=(//*[normalize-space(text())='CSV'])[1]").click(timeout=8000, force=True)
                print(f"[{datetime.now()}] CSV XPath click 成功")
                return
            except Exception:
                pass

            print(f"[{datetime.now()}] XPath click失敗 - キーボード Tab で試行")
            # 戦略3: Tab キーでフォーカスを当ててEnterで選択
            try:
                for _ in range(5):
                    focused_text = await pg.evaluate("document.activeElement ? document.activeElement.textContent.trim() : ''")
                    if focused_text == 'CSV':
                        await pg.keyboard.press("Enter")
                        print(f"[{datetime.now()}] CSV Tab+Enter 成功")
                        return
                    await pg.keyboard.press("Tab")
                    await asyncio.sleep(0.3)
            except Exception:
                pass

            # 戦略4: 最終フォールバック - ロケーター
            print(f"[{datetime.now()}] 最終フォールバック: ロケーター試行")
            await pg.locator("text=/^CSV$/").first.click(timeout=10000, force=True)

        # ── 在庫日次 (1日1回のみ実行する制限を追加) ──
        lock_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inventory_daily_lock.txt")
        today_str = datetime.now().strftime("%Y%m%d")
        already_run_today = False
        
        if os.path.exists(lock_file):
            with open(lock_file, "r", encoding="utf-8") as lf:
                if lf.read().strip() == today_str:
                    already_run_today = True

        if already_run_today:
            print(f"[{datetime.now()}] [INFO] 在庫日次データは本日すでに抽出・送信済みのためスキップします。")
            send_log("在庫日次の抽出は1日1回制限のためスキップされました。")
        else:
            try:
                await page.locator("text='在庫 - 日次'").first.click(timeout=30000)
                table_title = page.locator("text='品目別の在庫数'").first
                await table_title.wait_for(state="visible", timeout=60000)
                await asyncio.sleep(5)  # チャートデータ描画完了を待つ
                
                box = await table_title.bounding_box()
                if box:
                    # データエリア（タイトルの 50px 下）を右クリック（実績あり）
                    await page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height'] + 50, button="right")
                else:
                    await table_title.click(button="right")
                await asyncio.sleep(1)
                
                await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000, force=True)
                await page.locator("text=/データのエクスポート/").first.click(timeout=30000, force=True)
                await click_csv_option(page)
                
                async with page.expect_download() as download_info:
                    await page.locator("role=button[name='エクスポート']").click(force=True)
                download = await download_info.value
                current_date = datetime.now().strftime("%Y%m%d_%H%M%S")
                file_path = os.path.join(DOWNLOAD_DIR, f"inventory_export_{current_date}.csv")
                await download.save_as(file_path)
                with open(file_path, 'r', encoding='utf-8') as f:
                    requests.post(GAS_WEB_APP_URL, params={'type': 'inventory'}, data=f.read().encode('utf-8'))
                print(f"[{datetime.now()}] Looker Studio Inventory: Success")
                
                # 成功時に本日の日付をロックファイルに書き込む
                with open(lock_file, "w", encoding="utf-8") as lf:
                    lf.write(today_str)
                    
            except Exception as e_inv:
                err = f"在庫日次エクスポート失敗: {e_inv}"
                print(f"[{datetime.now()}] [ERROR] {err}")
                send_log(f"Phase1 CRITICAL: {err}")
                try:
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(1)
                except Exception:
                    pass
                # 在庫データは最重要 — 失敗を伝播してGitHub Actionsを失敗させる
                raise RuntimeError(err) from e_inv

        async def export_table_to_csv(title_text, export_type):
            """セクションタイトル直下にある最初のtdセルを右クリックしてCSVエクスポート"""
            title_el = page.locator(f"text='{title_text}'").first
            await title_el.wait_for(state="visible", timeout=60000)
            await asyncio.sleep(2)
            title_box = await title_el.bounding_box()
            if not title_box:
                raise RuntimeError(f"'{title_text}' bounding_box が取得できません")

            # タイトルより下にある最初の td を右クリックターゲットとする
            all_tds = await page.locator("td").all()
            target_box = None
            for td in all_tds:
                box = await td.bounding_box()
                if box and box['y'] > title_box['y'] + title_box['height'] + 10:
                    target_box = box
                    break

            if target_box:
                cx = target_box['x'] + target_box['width'] / 2
                cy = target_box['y'] + target_box['height'] / 2
                print(f"[{datetime.now()}] 右クリック座標: ({cx:.0f}, {cy:.0f}) for '{title_text}'")
                await page.mouse.click(cx, cy, button="right")
            else:
                # Looker Studio は div ベースのテーブル（td なし）
                # 不動品ページはタイトル下にサマリーカードがあるため 200px 下が実際のテーブルデータエリア
                print(f"[{datetime.now()}] td が見つからないためタイトルの 200px 下を右クリック")
                await page.mouse.click(
                    title_box['x'] + title_box['width'] / 2,
                    title_box['y'] + title_box['height'] + 200,
                    button="right"
                )

            await asyncio.sleep(1)
            menu_count = await page.locator("text=/グラフをエクスポート/").count()
            if menu_count == 0:
                # y+200 でも試みる（不動品ページで実績あり）
                print(f"[{datetime.now()}] '{title_text}': y+50/+200 共に失敗。y+200 で再試行...")
                await page.mouse.click(
                    title_box['x'] + title_box['width'] / 2,
                    title_box['y'] + title_box['height'] + 200,
                    button="right"
                )
                await asyncio.sleep(1)
                menu_count2 = await page.locator("text=/グラフをエクスポート/").count()
                if menu_count2 == 0:
                    await page.keyboard.press("Escape")
                    raise RuntimeError(f"'{title_text}': グラフをエクスポートメニューが表示されませんでした")

            await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000, force=True)
            await page.locator("text=/データのエクスポート/").first.click(timeout=30000, force=True)
            await click_csv_option(page)
            date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            async with page.expect_download() as dl_info:
                await page.locator("role=button[name='エクスポート']").click(force=True)
            dl = await dl_info.value
            f_path = os.path.join(DOWNLOAD_DIR, f"{export_type}_export_{date_str}.csv")
            await dl.save_as(f_path)
            with open(f_path, 'r', encoding='utf-8') as f:
                requests.post(GAS_WEB_APP_URL, params={'type': export_type}, data=f.read().encode('utf-8'))
            print(f"[{datetime.now()}] Looker Studio {title_text}: Success")

        # 不動品タブへ移動
        try:
            await page.keyboard.press("Escape")  # 念のためダイアログを閉じる
        except Exception:
            pass
        await page.locator("text='在庫 - 不動品'").first.click(timeout=30000)
        await asyncio.sleep(15)  # チャート描画完了を待つ
        # さらにテーブルデータが描画されるまで待機
        try:
            await page.locator("text='不動在庫の可能性がある品目'").first.wait_for(state="visible", timeout=30000)
            await asyncio.sleep(5)  # 追加描画待機
        except Exception:
            await asyncio.sleep(5)

        # 不動在庫（上のテーブル）
        try:
            await export_table_to_csv('不動在庫の可能性がある品目', 'dead')
        except Exception as e_dead:
            print(f"[{datetime.now()}] [WARNING] 不動在庫エクスポートをスキップ: {e_dead}")
        await asyncio.sleep(3)
        # 返品推奨品（下のテーブル）
        try:
            await export_table_to_csv('返品推奨品', 'return')
        except Exception as e_ret:
            print(f"[{datetime.now()}] [WARNING] 返品推奨品エクスポートをスキップ: {e_ret}")

        # ── 納品実績タブ（入庫 - 日次）──
        try:
            await page.keyboard.press("Escape")  # 念のためダイアログを閉じる
        except Exception:
            pass
        try:
            # 「入庫 - 日次」タブをクリック
            await page.locator("text='入庫 - 日次'").first.click(timeout=30000)
            await asyncio.sleep(15)  # チャート描画完了を待つ
            
            # テーブルタイトルを探す（品目別の入庫 or 類似のタイトル）
            receive_title = None
            for candidate in ['品目別の入庫数', '品目別の入庫', '入庫品目', '入庫一覧']:
                try:
                    loc = page.locator(f"text='{candidate}'").first
                    await loc.wait_for(state="visible", timeout=10000)
                    receive_title = candidate
                    break
                except Exception:
                    continue
            
            if receive_title:
                await asyncio.sleep(5)  # データ描画完了を待つ
                await export_table_to_csv(receive_title, 'receive_history')
                print(f"[{datetime.now()}] Looker Studio 納品実績: Success (title='{receive_title}')")
            else:
                # タイトルが見つからない場合、ページ上の最初のテーブルを右クリックして試行
                print(f"[{datetime.now()}] [WARNING] 納品実績テーブルのタイトルが見つかりません。テーブル直接エクスポートを試みます。")
                await asyncio.sleep(5)
                # ページ中央付近のテーブル領域を右クリック
                box = await page.locator("td, [role='cell'], .cell").first.bounding_box()
                if box:
                    await page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height']/2, button="right")
                    await asyncio.sleep(1)
                    await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000, force=True)
                    await page.locator("text=/データのエクスポート/").first.click(timeout=30000, force=True)
                    await click_csv_option(page)
                    date_str_r = datetime.now().strftime("%Y%m%d_%H%M%S")
                    async with page.expect_download() as dl_info_r:
                        await page.locator("role=button[name='エクスポート']").click(force=True)
                    dl_r = await dl_info_r.value
                    f_path_r = os.path.join(DOWNLOAD_DIR, f"receive_export_{date_str_r}.csv")
                    await dl_r.save_as(f_path_r)
                    with open(f_path_r, 'r', encoding='utf-8') as f:
                        requests.post(GAS_WEB_APP_URL, params={'type': 'receive_history'}, data=f.read().encode('utf-8'))
                    print(f"[{datetime.now()}] Looker Studio 納品実績(フォールバック): Success")
                else:
                    print(f"[{datetime.now()}] [WARNING] 納品実績テーブル要素が見つかりません")
        except Exception as e_recv:
            print(f"[{datetime.now()}] [WARNING] 納品実績エクスポートをスキップ: {e_recv}")

        await page.close()
        return "Looker Studio Success"
    except Exception as e:
        err_msg = f"Looker Studio Error: {e}"
        print(f"[{datetime.now()}] [WARNING] {err_msg}")
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
        await asyncio.sleep(2)
        
        current_url = m_page.url
        # users/sign_in (旧) または auth0.com (新) のログインページを検出
        if "users/sign_in" in current_url or "auth0.com" in current_url:
            email = os.environ.get("MEDORDER_EMAIL")
            password = os.environ.get("MEDORDER_PASSWORD")
            if email and password:
                print(f"[{datetime.now()}] 自動ログイン試行中... (URL: {current_url[:60]})")
                if "auth0.com" in current_url:
                    # Auth0 ログインフォーム
                    await m_page.fill("input[name='email']", email)
                    await m_page.fill("input[name='password']", password)
                    await m_page.click("button:has-text('LOG IN'), button[type='submit']")
                else:
                    # 旧ログインフォーム
                    await m_page.fill("#user_email", email)
                    await m_page.fill("#user_password", password)
                    await m_page.click("input[type='submit']")
                await m_page.wait_for_load_state("domcontentloaded")
                await asyncio.sleep(3)
                print(f"[{datetime.now()}] ログイン後URL: {m_page.url[:80]}")
                # ログイン後、stocks ページへ再ナビゲートして API リクエストを発火させる
                if "stocks" not in m_page.url:
                    print(f"[{datetime.now()}] stocks ページへ再ナビゲート中...")
                    await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="domcontentloaded")
                    await asyncio.sleep(5)
                    print(f"[{datetime.now()}] 再ナビゲート後URL: {m_page.url[:80]}")
            else:
                report_status("Login Required")
                print(f"[{datetime.now()}] [WARNING] 認証情報なし。ログインが必要です。")
        
        for _ in range(60):  # 60秒待機
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
        print(f"[{datetime.now()}] [WARNING] {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()


async def extract_orderepi(browser):
    print(f"\n[{datetime.now()}] --- PHASE 3: Order EPI / Medipal 配送予定テーブルの直接取得 ---")
    epi_email = os.environ.get("ORDER_EPI_ID")
    epi_password = os.environ.get("ORDER_EPI_PASSWORD")
    
    if not epi_email or not epi_password:
        print(f"[{datetime.now()}] [WARNING] ORDER_EPI_ID または ORDER_EPI_PASSWORD が設定されていないため、Phase 3はスキップします。")
        return {"status": "OrderEPI Skipped", "delivery_map": {}}

    browser_context = None
    try:
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await browser_context.new_page()
        from bs4 import BeautifulSoup
        
        # ── STEP 1: medipal-app.com にログインし、配送予定テーブルを直接取得 ──
        print(f"[{datetime.now()}] Medipal 配送予定テーブルにアクセス中...")
        await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet", wait_until="domcontentloaded")
        
        # ログインフォームがあればログイン（最大10秒待機）
        try:
            await page.wait_for_selector('input[placeholder="ID"]', timeout=10000)
            print(f"[{datetime.now()}] Medipal ログインフォーム検出 → ログイン中...")
            await page.fill('input[placeholder="ID"]', epi_email)
            await page.fill('input[type="password"]', epi_password)
            await page.click('button:has-text("ログイン")')
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(3)
        except Exception as e:
            print(f"[{datetime.now()}] Medipal: 既にログイン済みか、ログインフォームなし: {e}")
        
        # ── 配送予定テーブルを解析 ──
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        today_str = datetime.now().strftime("%m/%d")
        tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%m/%d")
        import re as _re
        
        # 薬品名 → 配送予定日 のマップを作成
        # テーブル列構成: [0]=番号, [1]=メーカー+JAN, [2]=品名規格, [3]=受注日時, [4]=数量, [5]=配送予定
        delivery_status_map = {}
        for row in soup.select("tr"):
            name_a = row.find('a', id=lambda x: x and x.startswith('hnmy'))
            if not name_a:
                continue
            
            name = name_a.text.strip().replace('\n', ' ').strip()
            if not name:
                continue
            
            row_text = row.get_text().replace('\n', '')
            tds = row.select('td')
            delivery_date = ""
            
            if "本日" in row_text:
                delivery_date = today_str
            elif "明日" in row_text:
                delivery_date = tomorrow_str
            elif "入荷未定" in row_text or "出荷調整" in row_text:
                delivery_date = "入荷未定"
            elif len(tds) > 5:
                raw = tds[5].get_text().replace('\xa0', ' ').strip()
                # MM/DD 形式の日付を抽出
                m = _re.search(r'(\d{1,2}/\d{1,2})', raw)
                if m:
                    delivery_date = m.group(1)
                elif "パターン" in raw:
                    delivery_date = "" # 日付ではないため空にする
                elif raw:
                    delivery_date = raw
            
            if delivery_date:
                delivery_status_map[name] = delivery_date
        
        print(f"[{datetime.now()}] Medipal 配送予定テーブル: {len(delivery_status_map)} 件取得")
        
        if not delivery_status_map:
            # 配送予定データがゼロの場合はページ構造が変わった可能性あり
            print(f"[{datetime.now()}] [WARNING] 配送予定データが0件です。ログイン失敗の可能性があります。")
            raise RuntimeError("Medipal delivery table empty (login may have failed)")
        
        # ── STEP 2: 取得した配送予定マップを CSV に変換して GAS の epi_delivery シートへ送信 ──
        # このデータを GAS 側で normalizeText によりマイナス在庫の薬品名とマッチングする
        csv_lines = ["品名,配送予定日"]
        for name, delivery_date in delivery_status_map.items():
            name_clean = name.replace(',', '').replace('\n', ' ').strip()
            date_clean = delivery_date.replace(',', '').strip()
            csv_lines.append(f"{name_clean},{date_clean}")
        
        csv_data = "\n".join(csv_lines)
        resp = requests.post(GAS_WEB_APP_URL, params={'type': 'epi_delivery'}, data=csv_data.encode('utf-8'))
        print(f"[{datetime.now()}] EPI Delivery Map: GAS送信完了 ({len(delivery_status_map)} 件, status={resp.status_code})")
        
        # ── STEP 3: order-epi.com の発注履歴も引き続き取得（発注済み判定用） ──
        # ※ 納品予定日は上記 epi_delivery から取得するため、ここでは品名・発注日のみを送る
        await page.goto("https://www.order-epi.com/order/", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        if await page.locator("#USER_ID").count() > 0:
            print(f"[{datetime.now()}] Order-EPI ログイン試行...")
            await page.fill("#USER_ID", epi_email)
            await page.fill("#ID_PASSWD", epi_password)
            await page.press("#ID_PASSWD", "Enter")
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(2)
        
        # 発注履歴ページへ移動
        try:
            await page.locator("span", has_text="発注履歴").first.click(timeout=10000)
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(5)
        except Exception as click_err:
            print(f"[{datetime.now()}] [WARNING] 発注履歴ボタンが見つからないかクリック失敗: {click_err}")
            await page.goto("https://www.medipal-app.com/App/servlet/InvokerServlet?s2=OrderHistoryList", wait_until="domcontentloaded")
            await asyncio.sleep(3)
        
        # 発注履歴テーブルを読み取る
        csv_data_body = ""
        added_rows = 0
        table_found = False
        
        for frame in page.frames:
            try:
                rows_locator = frame.locator("table.listTable tr, table.grid tr, table tr")
                count = await rows_locator.count()
                if count <= 1:
                    continue
                
                for i in range(count):
                    texts = await rows_locator.nth(i).locator("td").all_inner_texts()
                    if len(texts) < 7:
                        continue
                    
                    # 発注履歴テーブル列: [2]=メーカー, [3]=品名, [4]=数量, [5]=発注先, [6]=発注日
                    date_raw = texts[6].replace('\n', ' ').replace(',', '').replace('\xa0', ' ').strip()
                    date_parts = [p for p in date_raw.split(' ') if p]
                    if len(date_parts) >= 2:
                        date_str = f"'{datetime.now().year}/{date_parts[0]} {date_parts[1]}"
                    else:
                        date_str = f"'{date_raw}"
                    
                    maker_str = texts[2].replace('\n', ' ').replace(',', '').strip()
                    name_str = texts[3].replace('\n', ' ').replace(',', '').strip()
                    qty_str = texts[4].replace('\n', ' ').replace(',', '').strip()
                    supplier_str = texts[5].replace('\n', ' ').replace(',', '').strip()
                    
                    # 納品予定日はここでは空（GAS側が epi_delivery シートからlookupする）
                    csv_data_body += f"{date_str},完了,{maker_str},{name_str},,,{qty_str},{supplier_str},\n"
                    added_rows += 1
                
                if added_rows > 0:
                    print(f"[{datetime.now()}] Order-EPI 発注履歴テーブル発見 ({count} 行)")
                    table_found = True
                    break
            except Exception:
                pass
        
        if table_found and added_rows > 0:
            csv_data = "発注日,状態,メーカー,品名,規格,単位,数量,発注先,納品予定\n" + csv_data_body
            requests.post(GAS_WEB_APP_URL, params={'type': 'history'}, data=csv_data.encode('utf-8'))
            print(f"[{datetime.now()}] Order-EPI History: Success ({added_rows} rows)")
        else:
            print(f"[{datetime.now()}] [WARNING] Order-EPI 発注履歴テーブルが見つかりませんでした（配送予定データは送信済み）")
        
        await page.close()
        return {"status": f"OrderEPI Success (delivery={len(delivery_status_map)}, history={added_rows} rows)", "delivery_map": delivery_status_map}
        
    except Exception as e:
        err_msg = f"Order-EPI Error: {e}"
        print(f"[{datetime.now()}] [WARNING] {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()

async def extract_collabo(browser):
    print(f"\n[{datetime.now()}] --- PHASE 4: Collabo Portal からの発注履歴抽出 ---")
    collabo_id = os.environ.get("COLLABO_ID")
    collabo_password = os.environ.get("COLLABO_PASSWORD")
    
    if not collabo_id or not collabo_password:
        print(f"[{datetime.now()}] [WARNING] COLLABO_ID または COLLABO_PASSWORD が設定されていないため、Phase 4はスキップします。")
        return {"status": "Collabo Skipped", "delivery_items": []}

    browser_context = None
    try:
        browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await browser_context.new_page()
        
        print(f"[{datetime.now()}] Collabo Portal ログインページへアクセス中...")
        await page.goto("https://szgp-app1.collaboportal.com/frontend#/", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        
        # ログインフォームの処理
        if await page.locator("input[placeholder='ログインID']").count() > 0 or await page.locator("input[type='password']").count() > 0:
            print(f"[{datetime.now()}] Collabo Portal ログインシーケンス開始...")
            
            # fill ID (assuming input with type text or similar, check placeholder)
            await page.fill("input[placeholder='ログインID'], input[type='text'], input[name='loginId']", collabo_id)
            await page.fill("input[type='password']", collabo_password)
            await page.click("button:has-text('ログイン'), button[type='submit']")
            await page.wait_for_load_state("domcontentloaded")
            await asyncio.sleep(5)
            
        print(f"[{datetime.now()}] Collabo Portal NoukiSearchへアクセス中...")
        await page.goto("https://szgp-app1.collaboportal.com/frontend#/NoukiSearch", wait_until="networkidle")
        await asyncio.sleep(5) # wait for data to fetch
        
        from bs4 import BeautifulSoup
        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")
        
        # Extract items from the table using playwright locators
        table_rows = page.locator("table tr")
        count = await table_rows.count()
        
        csv_data_body = ""
        added_rows = 0
        collabo_delivery_items = []
        
        if count > 0:
            for i in range(count):
                texts = await table_rows.nth(i).locator("td").all_inner_texts()
                # Indexes: 0:No 1:受付日時 2:'' 3:商品コード 4:メーカー 5:品名・規格・容量 6:発注数 7:納品予定数 8:納品予定日 9:状況
                if len(texts) >= 9:
                     # Skip header
                     if '品名' in texts[5] or '受付' in texts[1]:
                         continue
                         
                     name_col = texts[5]
                     qty_col = texts[6]
                     date_col = texts[8]
                     maker_col = texts[4]
                     status_col = texts[9]
                     
                     # Extract MM/DD from date_col
                     import re
                     date_match = re.search(r'(\d{1,2}/\d{1,2})', date_col)
                     delivery_date = date_match.group(1) if date_match else "取得前"
                     
                     if "出荷調整" in status_col or "未定" in status_col:
                         delivery_date = "入荷未定"
                     
                     # Clean name
                     name_clean = name_col.replace('\n', ' ').strip()
                     if name_clean:
                         csv_data_body += f"'{datetime.now().strftime('%Y/%m/%d')},完了,{maker_col},{name_clean},,箱,{qty_col},Collabo,{delivery_date}\n"
                         collabo_delivery_items.append({"name": name_clean, "date": delivery_date, "source": "スズケン"})
                         added_rows += 1
                         
        if added_rows > 0:
            csv_data = "発注日,状態,メーカー,品名,規格,単位,数量,発注先,納品予定\n" + csv_data_body
            requests.post(GAS_WEB_APP_URL, params={'type': 'collabo_history'}, data=csv_data.encode('utf-8'))
            print(f"[{datetime.now()}] Collabo Portal History: Success ({added_rows} rows)")
            return {"status": f"Collabo Success ({added_rows} rows)", "delivery_items": collabo_delivery_items}
        else:
            print(f"[{datetime.now()}] [WARNING] Collabo Portal 履歴テーブルデータが空か見つかりませんでした。")
            return {"status": "Collabo Success (0 rows)", "delivery_items": collabo_delivery_items}
            
    except Exception as e:
        err_msg = f"Collabo Portal Error: {e}"
        print(f"[{datetime.now()}] [WARNING] {err_msg}")
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
            print(f"[{datetime.now()}] [WARNING] 認証状態の復元に失敗しました: {e}")
    else:
        # ローカル実行時は state.json をフォールバックとして使う
        local_state = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")
        if os.path.exists(local_state):
            state_path = local_state
            print(f"[{datetime.now()}] ローカルの state.json を使用します: {local_state}")
        else:
            print(f"[{datetime.now()}] [WARNING] GOOGLE_AUTH_STATE_BASE64 が設定されておらず、state.json も見つかりません。Looker Studioの取得に失敗する可能性があります。")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--start-maximized', '--disable-blink-features=AutomationControlled']
        )

        # 4つのPhaseを非同期で同時に走らせる
        results = await asyncio.gather(
            extract_looker_studio(browser, state_path),
            extract_medorder(browser),
            extract_orderepi(browser),
            extract_collabo(browser),
            return_exceptions=True
        )

        await browser.close()
        
        # エラーの集計
        failures = []
        for res in results:
            if isinstance(res, Exception):
                failures.append(str(res))
        
        # ── 納品履歴の統合送信 ──
        # Phase 3 (OrderEPI/Medipal) と Phase 4 (Collabo) の納品予定データを統合
        try:
            receive_csv_lines = ["納品日,商品名,取引先"]
            
            # Medipal 配送予定データ (results[2] = extract_orderepi)
            epi_result = results[2]
            if isinstance(epi_result, dict) and epi_result.get("delivery_map"):
                for name, date in epi_result["delivery_map"].items():
                    name_clean = name.replace(',', '').strip()
                    date_clean = date.replace(',', '').strip()
                    receive_csv_lines.append(f"{date_clean},{name_clean},メディセオ")
            
            # Collabo 納品予定データ (results[3] = extract_collabo)
            collabo_result = results[3]
            if isinstance(collabo_result, dict) and collabo_result.get("delivery_items"):
                for item in collabo_result["delivery_items"]:
                    name_clean = item["name"].replace(',', '').strip()
                    date_clean = item["date"].replace(',', '').strip()
                    source = item.get("source", "スズケン")
                    receive_csv_lines.append(f"{date_clean},{name_clean},{source}")
            
            if len(receive_csv_lines) > 1:
                receive_csv = "\n".join(receive_csv_lines)
                resp = requests.post(GAS_WEB_APP_URL, params={'type': 'receive_history'}, data=receive_csv.encode('utf-8'))
                print(f"[{datetime.now()}] 納品履歴統合送信: {len(receive_csv_lines) - 1} 件 (status={resp.status_code})")
            else:
                print(f"[{datetime.now()}] [WARNING] 納品履歴データが0件のため送信スキップ")
        except Exception as e_recv:
            print(f"[{datetime.now()}] [WARNING] 納品履歴統合送信エラー: {e_recv}")
        
        if len(failures) > 0:
            error_details = ' | '.join(failures)
            raise RuntimeError(f"一部のフェーズが失敗しました: {error_details}")

        return "データ抽出とトークン更新が正常に完了しました。"

async def main():
    max_retries = 3
    for attempt in range(max_retries):
        try:
            msg = await run_extraction()
            print(f"[{datetime.now()}] [OK] {msg}")
            send_log(msg)
            break
        except Exception as e:
            err_msg = f"試行 {attempt+1} 失敗: {e}"
            print(f"[{datetime.now()}] [WARNING] {err_msg}")
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 10
                print(f"[{datetime.now()}] {wait_time}秒後に再試行します...")
                report_status(f"Retrying ({attempt+1})")
                await asyncio.sleep(wait_time)
            else:
                fatal_msg = f"最大試行回数に達しました。最終エラー: {e}"
                print(f"[{datetime.now()}] [ERROR] {fatal_msg}")
                report_status("Fatal Error")
                send_log(fatal_msg)
                sys.exit(1)  # GitHub Actionsを失敗させてメール通知をトリガー

if __name__ == "__main__":
    asyncio.run(main())
