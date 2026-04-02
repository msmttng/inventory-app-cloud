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
GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxRmB7n67cNfGBfQaXXLwK3_QXIupiF-90c6AZsWa4IhaPspf4DkvXw-mTS2kVb1AL_jw/exec"
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

async def extract_looker_studio(p, browser, state_path):
    print(f"\n[{datetime.now()}] --- PHASE 1: Looker Studio からのデータ抽出 ---")
    browser_context = None
    try:
        user_data_path = r"C:\Users\masam\.gemini\antigravity\scratch\playwright_profile"
        
        # 実行環境がローカルかクラウド(GitHub Actions等)かを判定
        is_cloud = os.environ.get("GITHUB_ACTIONS") or os.environ.get("GOOGLE_AUTH_STATE_BASE64")
        
        if is_cloud:
            print(f"[{datetime.now()}] [INFO] クラウド環境のため、従来通り state.json を使用します。")
            if state_path and os.path.exists(state_path):
                browser_context = await browser.new_context(storage_state=state_path, viewport={'width': 1920, 'height': 1080})
            else:
                print(f"[{datetime.now()}] [WARNING] Looker Studio: 認証情報（state.json）がありません。失敗する可能性があります。")
                browser_context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
            page = await browser_context.new_page()
        else:
            print(f"[{datetime.now()}] [INFO] ローカル環境のため、永続プロファイルを使用します: {user_data_path}")
            if not os.path.exists(user_data_path):
                os.makedirs(user_data_path, exist_ok=True)
            
            browser_context = await p.chromium.launch_persistent_context(
                user_data_dir=user_data_path,
                channel="chrome",
                headless=True, # バックグラウンドで実行するように変更
                no_viewport=True,
                args=['--start-maximized', '--disable-blink-features=AutomationControlled']
            )
            if len(browser_context.pages) > 0:
                page = browser_context.pages[0]
            else:
                page = await browser_context.new_page()

        await page.goto(LOOKER_STUDIO_URL, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # ── accountchooser / ログインページの自動処理 ──
        for _ in range(10):  # 最大10回リダイレクトを追跡
            current_url = page.url
            if "accountchooser" in current_url or "accounts.google.com" in current_url:
                print(f"[{datetime.now()}] Googleアカウント選択ページを検出: {current_url[:80]}")
                # state.json 失効を通知
                send_log("⚠️ Google認証(state.json)が失効しています。generate_state.py で再生成してください。")
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
            # ダイアログが完全に描画されるのを待つ（ポーリング: 最大15秒）
            # 成功ログ: H2:データのエクスポート + LABEL:CSV が表示される
            dialog_ready = False
            for _wait in range(15):
                try:
                    has_csv = await pg.evaluate("""
                        () => {
                            const all = Array.from(document.querySelectorAll('*'));
                            return all.some(el => {
                                const t = el.textContent.trim();
                                return t.includes('CSV') && el.children.length === 0 && t.length < 20;
                            });
                        }
                    """)
                    if has_csv:
                        dialog_ready = True
                        print(f"[{datetime.now()}] エクスポートダイアログ描画完了 ({_wait+1}秒)")
                        break
                except Exception:
                    pass
                await asyncio.sleep(1)
            if not dialog_ready:
                print(f"[{datetime.now()}] [WARNING] エクスポートダイアログのCSV描画を15秒待機しましたが検出できません")

            # デバッグ: ダイアログ周辺のテキストを出力
            try:
                dialog_texts = await pg.evaluate("""
                    () => {
                        const texts = [];
                        document.querySelectorAll('*').forEach(el => {
                            const t = el.textContent.trim();
                            if (t && (t.includes('CSV') || t.includes('csv') || t.includes('Google') || t.includes('エクスポート') || t.includes('形式')) && t.length < 80 && el.children.length === 0) {
                                texts.push(el.tagName + ':' + t);
                            }
                        });
                        return [...new Set(texts)].slice(0, 20);
                    }
                """)
                print(f"[{datetime.now()}] ダイアログ内テキスト: {dialog_texts}")
            except Exception:
                pass

            # 戦略1: JS で全要素を走査して CSV を含むものをクリック
            clicked = await pg.evaluate("""
                () => {
                    const all = Array.from(document.querySelectorAll('*'));
                    // 完全一致（葉ノード）
                    const exact = all.find(el => el.textContent.trim() === 'CSV' && el.children.length === 0);
                    if (exact) { exact.click(); return 'leaf-exact'; }
                    // CSV を含む短いテキスト（葉ノード）
                    const partial = all.find(el => {
                        const t = el.textContent.trim();
                        return t.includes('CSV') && el.children.length === 0 && t.length < 20;
                    });
                    if (partial) { partial.click(); return 'leaf-partial:' + partial.textContent.trim(); }
                    // 完全一致（子要素あり）
                    const loose = all.find(el => el.textContent.trim() === 'CSV');
                    if (loose) { loose.click(); return 'loose'; }
                    return null;
                }
            """)
            if clicked:
                print(f"[{datetime.now()}] CSV JS click 成功 (strategy: {clicked})")
                return

            print(f"[{datetime.now()}] JS click失敗 - ラジオボタン・リスト項目で再試行")
            # 戦略2: ダイアログ内のラジオボタンまたは選択肢の2番目をクリック（CSVは通常2番目）
            clicked2 = await pg.evaluate("""
                () => {
                    const radios = document.querySelectorAll('input[type="radio"]');
                    if (radios.length >= 2) { radios[1].click(); return 'radio-2nd'; }
                    const items = document.querySelectorAll('[role="option"], [role="radio"], [role="menuitemradio"]');
                    if (items.length >= 2) { items[1].click(); return 'role-2nd'; }
                    const matRadios = document.querySelectorAll('[class*="radio"], [class*="Radio"]');
                    if (matRadios.length >= 2) { matRadios[1].click(); return 'class-radio-2nd'; }
                    return null;
                }
            """)
            if clicked2:
                print(f"[{datetime.now()}] CSV ラジオ/リスト click 成功 (strategy: {clicked2})")
                return

            print(f"[{datetime.now()}] ラジオ失敗 - XPath で再試行")
            # 戦略3: XPath（完全一致 → 部分一致）
            for xpath_expr, label in [
                ("(//*[normalize-space(text())='CSV'])[1]", "exact"),
                ("(//*[contains(text(),'CSV')])[1]", "contains"),
            ]:
                try:
                    await pg.locator(f"xpath={xpath_expr}").click(timeout=5000, force=True)
                    print(f"[{datetime.now()}] CSV XPath click 成功 ({label})")
                    return
                except Exception:
                    pass

            print(f"[{datetime.now()}] XPath失敗 - キーボード Tab で試行")
            # 戦略4: Tab キーでフォーカスを当ててEnterで選択
            try:
                for _ in range(8):
                    focused_text = await pg.evaluate("document.activeElement ? document.activeElement.textContent.trim() : ''")
                    if 'CSV' in focused_text:
                        await pg.keyboard.press("Enter")
                        print(f"[{datetime.now()}] CSV Tab+Enter 成功")
                        return
                    await pg.keyboard.press("Tab")
                    await asyncio.sleep(0.3)
            except Exception:
                pass

            # 戦略5: 最終フォールバック — CSV が見つからなければデフォルト形式でエクスポート
            print(f"[{datetime.now()}] CSV選択をスキップし、デフォルト形式でエクスポートを試行します")
            try:
                await pg.locator("text=/CSV/i").first.click(timeout=5000, force=True)
                print(f"[{datetime.now()}] CSV locator click 成功")
            except Exception:
                print(f"[{datetime.now()}] [WARNING] CSV選択不可 — デフォルト形式でエクスポートを続行")

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
                
                await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000)
                await asyncio.sleep(0.5)
                await page.locator("text=/データのエクスポート/").first.click(timeout=30000)
                await click_csv_option(page)
                
                async with page.expect_download() as download_info:
                    await page.locator("role=button[name='エクスポート']").click()
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

            await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000)
            await asyncio.sleep(0.5)
            await page.locator("text=/データのエクスポート/").first.click(timeout=30000)
            await click_csv_option(page)
            date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
            async with page.expect_download() as dl_info:
                await page.locator("role=button[name='エクスポート']").click()
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
                    await page.locator("text=/グラフをエクスポート/").first.click(timeout=30000)
                    await asyncio.sleep(0.5)
                    await page.locator("text=/データのエクスポート/").first.click(timeout=30000)
                    await click_csv_option(page)
                    date_str_r = datetime.now().strftime("%Y%m%d_%H%M%S")
                    async with page.expect_download() as dl_info_r:
                        await page.locator("role=button[name='エクスポート']").click()
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
        await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="networkidle")
        await asyncio.sleep(3)
        
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
                await m_page.wait_for_load_state("networkidle", timeout=30000)
                await asyncio.sleep(3)
                print(f"[{datetime.now()}] ログイン後URL: {m_page.url[:80]}")
                # ログイン後、stocks ページへ再ナビゲートして API リクエストを発火させる
                if "stocks" not in m_page.url:
                    print(f"[{datetime.now()}] stocks ページへ再ナビゲート中...")
                    await m_page.goto("https://app.medorder.jp/pharmacies/20/stocks", wait_until="networkidle")
                    await asyncio.sleep(3)
                    print(f"[{datetime.now()}] 再ナビゲート後URL: {m_page.url[:80]}")
            else:
                report_status("Login Required")
                print(f"[{datetime.now()}] [WARNING] 認証情報なし。ログインが必要です。")
        
        # --- トークン取得: ネットワークスニッファー優先 ---
        # Auth0 SPA SDK はトークンをLocalStorageに保存しない（メモリ内管理）。
        # networkidle 完了時点で capture_token コールバックが Bearer を捕捉済みのはず。
        if medorder_token:
            print(f"[{datetime.now()}] ネットワークスニッファーでトークンを捕捉済み。")
        else:
            # Tier 2: 強制的にAPI fetchを発火してスニッファーに捕捉させる
            print(f"[{datetime.now()}] ネットワークスニッファーでトークン未取得。強制フェッチを実行(Tier 2)...")
            try:
                await m_page.evaluate("fetch('https://medorder-api.pharmacloud.jp/api/v2/pharmacy', {credentials: 'include'})")
                for _ in range(10):
                    if medorder_token:
                        print(f"[{datetime.now()}] 強制フェッチによりトークンを捕捉しました。")
                        break
                    await asyncio.sleep(1)
            except Exception as e:
                print(f"[{datetime.now()}] 強制フェッチに失敗: {e}")
        
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
            
            # --- FETCH DELIVERIES VIA API ---
            print(f"[{datetime.now()}] MedOrder納品履歴APIを取得中...")
            deliveries_csv = []
            try:
                d_res = requests.get("https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/sdcvan_delivery_d_records?status=20&page=1", headers=headers, timeout=15)
                if d_res.status_code == 200:
                    d_data = d_res.json()
                    for item in d_data:
                        dn = item.get('name', '').replace(',', ' ').strip()
                        dd = item.get('slipped_on', '')
                        dq = item.get('quantity', '')
                        dealer_code = str(item.get('s_record', {}).get('dealer_code', ''))
                        
                        # medorder dealer codes to names (guessing based on typical codes)
                        dealer_name = 'MedOrder卸'
                        if dealer_code.startswith('9'):
                            if '156' in dealer_code: dealer_name = 'スズケン'
                            elif '122' in dealer_code: dealer_name = 'メディセオ'
                            elif '960' in dealer_code: dealer_name = 'アルフレッサ'
                            elif '261' in dealer_code: dealer_name = '東邦薬品'
                        deliveries_csv.append(f"{dd},{dn},{dealer_name},{dq}")
                print(f"[{datetime.now()}] 納品履歴 {len(deliveries_csv)}件 取得完了")
            except Exception as de:
                print(f"[{datetime.now()}] 納品履歴API取得エラー: {de}")

            # --- FETCH ORDERS VIA API ---
            print(f"[{datetime.now()}] MedOrder発注履歴APIを取得中...")
            orders_csv = []
            try:
                # v2/pharmacy/pharmacies/20/orders
                o_res = requests.get("https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?status=completed&page=1", headers=headers, timeout=15)
                if o_res.status_code == 200:
                    o_data = o_res.json()
                    for order in o_data:
                        odate_raw = order.get('ordered_at', '')[:10].replace('-', '/')
                        status = '完了' if order.get('state') == 'completed' else order.get('state', '')
                        for i_obj in order.get('items', []):
                            item_id = str(i_obj.get('orderable_item', {}).get('stockable_item_id', ''))
                            qty = i_obj.get('quantity', '')
                            dealer_id = str(i_obj.get('dealer_id', ''))
                            
                            # Map item_id
                            n_obj = item_name_map.get(item_id, {})
                            item_name = n_obj.get('name', '名称不明').replace(',', ' ')
                            
                            # DEALER_MAP in GAS: 31:メディセオ, 36:スズケン, 46:東邦, 58:アルフレッサ
                            d_name = 'アルフレッサ' if dealer_id == '58' else 'メディセオ' if dealer_id == '31' else 'スズケン' if dealer_id == '36' else '東邦' if dealer_id == '46' else dealer_id
                            
                            orders_csv.append(f"{odate_raw},{status},,{item_name},,,{qty},{d_name},")
                print(f"[{datetime.now()}] 発注履歴 {len(orders_csv)}件 取得完了")
            except Exception as oe:
                print(f"[{datetime.now()}] 発注履歴API取得エラー: {oe}")
            
            report_status("OK")
            await m_page.close()
            return {"status": "MedOrder Success", "deliveries": deliveries_csv, "orders": orders_csv}
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
            print(f"[{datetime.now()}] Order-EPI History: Success ({added_rows} rows)")
        else:
            print(f"[{datetime.now()}] [WARNING] Order-EPI 発注履歴テーブルが見つかりませんでした")
        
        await page.close()
        return {"status": f"OrderEPI Success", "orders": csv_data_body.splitlines(), "delivery_map": delivery_status_map}

        
    except Exception as e:
        err_msg = f"Order-EPI Error: {e}"
        print(f"[{datetime.now()}] [WARNING] {err_msg}")
        raise RuntimeError(err_msg)
    finally:
        if browser_context:
            await browser_context.close()


async def extract_pharma_dashboard():
    print(f"[{datetime.now()}] --- PHASE 4: Pharma Dashboard 未納未定データ取得 ---")
    try:
        res = requests.get("https://msmttng.github.io/pharma-dashboard/pharma_data.json", timeout=15)
        if res.status_code == 200:
            data = res.json()
            missing_items = []
            
            def clean_status(st):
                st = st.replace("ﾒｰｶｰ入荷未定 注文取消時 要連絡", "")
                st = st.replace("メーカー入荷未定 注文取消時 要連絡", "")
                st = st.replace("限定出荷品 (出荷調整品)", "出荷調整")
                st = st.replace("限定出荷品(出荷調整品)", "出荷調整")
                st = st.replace("メーカー出荷調整品：入荷未定", "出荷調整")
                st = st.replace("出荷停止・入荷未定", "出荷停止")
                st = st.replace("出荷一時停止・入荷未定", "出荷停止")
                st = " ".join(st.split())
                if not st: return "未定"
                return st

            def get_sort_key(date_str):
                if not date_str: return "0000/00/00 00:00"
                try:
                    mm = int(date_str.split('/')[0])
                    cur_mm = datetime.now().month
                    year = datetime.now().year
                    if mm > cur_mm + 1:
                        year -= 1
                    return f"{year}/{date_str}"
                except:
                    return f"9999/{date_str}"

            def add_if_pending(date_str, name, supplier, stat, qty):
                if '調達' in stat or '未定' in stat:
                    clean_st = clean_status(stat)
                    sort_key = get_sort_key(date_str)
                    missing_items.append((sort_key, [date_str, name, supplier, clean_st, qty]))

            # extract Medipal missing
            for item in data.get('medipal', []):
                add_if_pending(item.get('date', ''), item.get('name', ''), "Medipal", item.get('remarks', ''), item.get('order_qty', ''))
                
            # extract Collabo missing
            for item in data.get('collabo', []):
                status_remarks = f"{item.get('status','')} {item.get('remarks','')}".strip()
                add_if_pending(item.get('date', ''), item.get('name', ''), "Collabo", status_remarks, item.get('order_qty', ''))
                
            # extract Alf missing
            for item in data.get('alfweb', []):
                add_if_pending(item.get('date', ''), item.get('name', ''), "Alf", item.get('status', ''), item.get('order_qty', ''))

            if missing_items:
                missing_items.sort(key=lambda x: x[0], reverse=True)
                csv_lines = ["日付,品名,卸名,ステータス,数量"]
                for _, mi in missing_items:
                    csv_lines.append(",".join(str(m).replace(',', '') for m in mi))
                csv_data = "\n".join(csv_lines)
                requests.post(GAS_WEB_APP_URL, params={'type': 'pending_deliveries'}, data=csv_data.encode('utf-8'))
                print(f"[{datetime.now()}] Pharma Dashboard 取得・送信完了 ({len(missing_items)}件)")
            else:
                print(f"[{datetime.now()}] Pharma Dashboard: 未納データは0件でした。")
            return "Pharma Dashboard Success"
        else:
            print(f"[{datetime.now()}] [WARNING] Pharma Dashboard API HTTP={res.status_code}")
            return "Pharma Dashboard Error"
    except Exception as e:
        print(f"[{datetime.now()}] [WARNING] Pharma Dashboard 取得エラー: {e}")
        return "Pharma Dashboard Error"

async def extract_mhlw_supply_status():
    print(f"[{datetime.now()}] 厚労省 医薬品安定供給状況APIからのデータ取得を開始します...")
    try:
        url = "https://iyakuhin-kyokyu.mhlw.go.jp/api/info-site/supply-status-report"
        headers = {"User-Agent": "Mozilla/5.0"}
        
        loop = asyncio.get_event_loop()
        res = await loop.run_in_executor(None, lambda: requests.get(url, headers=headers))
        
        if res.status_code == 200:
            resp_json = res.json()
            data = resp_json.get("data", [])
            payload_data = []
            for row in data:
                payload_data.append({
                    "name": row.get("product_nm", ""),
                    "status": row.get("shipment_volume_current_status_nm", ""),
                    "yjCode": row.get("yj_cd", "")
                })
            
            payload = {
                "action": "mhlw_sync",
                "data": payload_data
            }
            
            post_res = await loop.run_in_executor(None, lambda: requests.post(GAS_WEB_APP_URL, json=payload))
            if post_res.status_code == 200:
                 print(f"[{datetime.now()}] 厚労省データのGAS送信完了 ({len(payload_data)}件)")
                 return "MHLW Supply Success"
            else:
                 print(f"[{datetime.now()}] [WARNING] 厚労省データのGAS送信失敗 HTTP={post_res.status_code}")
                 return "MHLW Supply Send Error"
        else:
             print(f"[{datetime.now()}] [WARNING] 厚労省API取得失敗 HTTP={res.status_code}")
             return "MHLW Supply Fetch Error"
    except Exception as e:
        print(f"[{datetime.now()}] [WARNING] 厚労省APIエラー: {e}")
        return "MHLW Supply Error"


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

        # 5つのPhaseを非同期で同時に走らせる
        results = await asyncio.gather(
            extract_looker_studio(p, browser, state_path),
            extract_medorder(browser),
            extract_orderepi(browser),
            extract_pharma_dashboard(),
            extract_mhlw_supply_status(),
            
            return_exceptions=True
        )

        await browser.close()
        
        # エラーの集計
        failures = []
        for res in results:
            if isinstance(res, Exception):
                failures.append(str(res))
        
        
        # ── 発注履歴と納品履歴の統合送信 ──
        try:
            m_res = results[1] # MedOrder
            e_res = results[2] # OrderEPI
            
            # Combine Orders
            history_rows = []
            if isinstance(m_res, dict) and "orders" in m_res:
                history_rows.extend(m_res["orders"])
            if isinstance(e_res, dict) and "orders" in e_res:
                history_rows.extend(e_res["orders"])
                
            if history_rows:
                csv_data = "発注日,状態,メーカー,品名,規格,単位,数量,発注先,納品予定\n" + "\n".join(history_rows)
                requests.post(GAS_WEB_APP_URL, params={'type': 'history'}, data=csv_data.encode('utf-8'))
                print(f"[{datetime.now()}] 発注履歴統合送信: {len(history_rows)} 件")

            # Combine Deliveries
            receive_rows = []
            if isinstance(m_res, dict) and "deliveries" in m_res:
                receive_rows.extend(m_res["deliveries"])
                
            if receive_rows:
                # GAS expects Date, Name, Supplier, Qty for processIncomingDeliveries (index finding)
                csv_data = "納品日,薬品名,取引先,数量\n" + "\n".join(receive_rows)
                requests.post(GAS_WEB_APP_URL, params={'type': 'receive_history'}, data=csv_data.encode('utf-8'))
                print(f"[{datetime.now()}] 納品実績(MedOrder)送信: {len(receive_rows)} 件")

        except Exception as e_comb:
            print(f"[{datetime.now()}] [WARNING] 統合送信エラー: {e_comb}")
            
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
