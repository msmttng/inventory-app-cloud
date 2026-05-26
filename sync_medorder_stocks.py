"""
sync_medorder_stocks.py
========================
MedOrder 在庫タブ API をポーリングし、変更があった品目だけ Supabase inventory に UPSERT するデーモン。

【ハイブリッド在庫同期アーキテクチャ】
  朝1回    : Looker Studio -> 全1645品目のベースライン (sync_to_supabase.py / extract_data.py)
  日中5分毎: MedOrder在庫タブ (~500品目) -> アクティブ品目の最新在庫で差分UPSERT ← このスクリプト

【廃止されたもの】
  - sync_medorder_deliveries_history.py (納品→在庫加算)
  - 包装単位換算ロジック (MedOrder側が換算済み在庫値を返すため不要)
  - NSIPS出庫→在庫減算 (MedOrder側に反映済みのため不要)

【残すもの】
  - NSIPS -> transaction_history への出庫履歴記録 (在庫値の変更はしない)
  - Looker Studio 朝1回 (全品目ベースライン + 不動在庫・返品推奨)
  - GAS 棚番・マイナス在庫台帳 (MedOrder APIに棚番情報はない)
"""

import sys
import io
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import asyncio
import os
import json
import time
import requests
from datetime import datetime, timezone
from playwright.async_api import async_playwright

# ── 設定 ──────────────────────────────────────────────────────────────────
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV_PATH = os.path.join(_SCRIPT_DIR, ".env")
if os.path.exists(_ENV_PATH):
    with open(_ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip() and not line.startswith("#") and "=" in line:
                key, value = line.strip().split("=", 1)
                os.environ.setdefault(key, value)

SUPA_URL  = os.environ.get("SUPABASE_URL", "https://jscqmecctsijqxihnxwi.supabase.co/rest/v1")
SUPA_KEY  = os.environ.get("SUPABASE_KEY", "")
LOCAL_PROFILE = r"C:\Users\masam\.gemini\antigravity\scratch\playwright_profile"
PHARMACY_ID   = 20
API_BASE      = f"https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/{PHARMACY_ID}"
MASTER_BASE   = "https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items"

# ポーリング設定
POLL_INTERVAL_SEC = 5 * 60       # 5分
BUSINESS_HOUR_START = 8          # 08:00 以降に開始
BUSINESS_HOUR_END   = 20         # 20:00 以降は停止
TOKEN_REFRESH_INTERVAL = 60 * 60 # 1時間ごとにトークン再取得

# キャッシュファイル (薬品名マスター: 毎日1回更新で十分)
NAME_CACHE_FILE = os.path.join(_SCRIPT_DIR, "medorder_name_cache.json")

# ── ログ ──────────────────────────────────────────────────────────────────
def log(msg: str):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ── トークン取得 ─────────────────────────────────────────────────────────
async def get_medorder_token() -> str:
    """MedOrder にログインして Bearer トークンを取得する"""
    log("MedOrder: トークン取得中...")
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=LOCAL_PROFILE,
            headless=True,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"]
        )
        token = None
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        def _capture(req):
            nonlocal token
            if "medorder-api.pharmacloud.jp/api/v2/pharmacy" in req.url:
                auth = req.headers.get("authorization", "")
                if auth.startswith("Bearer ") and not token:
                    token = auth.replace("Bearer ", "")

        page.on("request", _capture)
        await page.goto(f"https://app.medorder.jp/pharmacies/{PHARMACY_ID}/stocks",
                        wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # ログインが必要な場合
        if "sign_in" in page.url or "auth0.com" in page.url:
            email    = os.environ.get("MEDORDER_EMAIL", "")
            password = os.environ.get("MEDORDER_PASSWORD", "")
            log("MedOrder: ログインフォーム検出 -> 自動ログイン中...")
            if "auth0.com" in page.url:
                await page.fill("input[name='email'], input[name='username']", email)
                await page.fill("input[name='password']", password)
                await page.click("button[type='submit']")
            else:
                await page.fill("#user_email", email)
                await page.fill("#user_password", password)
                await page.click("input[type='submit']")
            await page.wait_for_load_state("domcontentloaded", timeout=30000)
            await asyncio.sleep(3)
            if "stocks" not in page.url:
                await page.goto(f"https://app.medorder.jp/pharmacies/{PHARMACY_ID}/stocks",
                                wait_until="domcontentloaded")
                await asyncio.sleep(3)

        # トークン待機（最大30秒・強制フェッチ）
        for _ in range(30):
            if token:
                break
            try:
                await page.evaluate(
                    "fetch('https://medorder-api.pharmacloud.jp/api/v2/pharmacy', "
                    "{credentials: 'include'})"
                )
            except Exception:
                pass
            await asyncio.sleep(1)

        await ctx.close()

    if not token:
        raise RuntimeError("MedOrder トークン取得失敗")
    log(f"MedOrder: トークン取得成功")
    return token


# ── 名前キャッシュ ────────────────────────────────────────────────────────
def _load_name_cache() -> dict:
    if os.path.exists(NAME_CACHE_FILE):
        try:
            with open(NAME_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_name_cache(cache: dict):
    with open(NAME_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def resolve_names(token: str, item_ids: list, cache: dict) -> dict:
    """
    stockable_item_id -> {name, unit, yj_code} を解決する。
    キャッシュにあれば API を叩かない。
    """
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    missing_ids = [sid for sid in item_ids if sid not in cache]

    if missing_ids:
        log(f"名前解決: {len(missing_ids)} 件をマスターAPIから取得...")
        for i in range(0, len(missing_ids), 50):
            chunk = missing_ids[i:i+50]
            url = f"{MASTER_BASE}?ids={','.join(chunk)}"
            try:
                res = requests.get(url, headers=headers, timeout=15)
                if res.status_code == 200:
                    for item in res.json():
                        cache[str(item.get("id"))] = {
                            "name":     item.get("name", ""),
                            "unit":     item.get("unit_name") or "個",
                            "yj_code":  item.get("yj_code") or "",
                        }
            except Exception as e:
                log(f"  [WARNING] マスターAPI取得エラー: {e}")
            time.sleep(0.3)
        _save_name_cache(cache)

    return cache


# ── 在庫タブ全件取得 ─────────────────────────────────────────────────────
def fetch_stocks(token: str) -> list:
    """MedOrder 在庫タブ API から全ページのデータを取得する"""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    all_items = []
    page = 1
    while True:
        url = f"{API_BASE}/stocks?items=500&page={page}"
        try:
            res = requests.get(url, headers=headers, timeout=30)
        except requests.RequestException as e:
            log(f"[ERROR] /stocks API 通信エラー: {e}")
            break
        if res.status_code == 401:
            raise RuntimeError("TOKEN_EXPIRED")
        if res.status_code != 200:
            log(f"[ERROR] /stocks API HTTP {res.status_code}")
            break
        data = res.json()
        if not data:
            break
        all_items.extend(data)
        total_pages = int(res.headers.get("X-Total-Pages") or res.headers.get("x-total-pages") or 1)
        if page >= total_pages:
            break
        page += 1
    return all_items


# ── Supabase UPSERT ──────────────────────────────────────────────────────
def upsert_inventory(records: list):
    """変更があった品目だけ Supabase inventory テーブルに UPSERT する"""
    if not records:
        return
    supa_headers = {
        "apikey":        SUPA_KEY,
        "Authorization": f"Bearer {SUPA_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }
    # バッチ送信（一度に 200件まで）
    batch_size = 200
    for i in range(0, len(records), batch_size):
        batch = records[i:i+batch_size]
        try:
            r = requests.post(
                f"{SUPA_URL}/inventory?on_conflict=name",
                headers=supa_headers,
                json=batch,
                timeout=30
            )
            if r.status_code not in [200, 201]:
                log(f"[WARNING] Supabase UPSERT エラー: HTTP {r.status_code} {r.text[:200]}")
        except Exception as e:
            log(f"[ERROR] Supabase 通信エラー: {e}")


# ── メイン同期処理 (1サイクル) ───────────────────────────────────────────
def sync_once(token: str, name_cache: dict) -> dict:
    """
    1サイクル分の同期を実行する。
    Returns: 更新されたname_cache
    """
    started = datetime.now()

    # 1. MedOrder から在庫取得
    raw_items = fetch_stocks(token)
    if not raw_items:
        log("[WARNING] MedOrder から在庫データが取得できませんでした")
        return name_cache

    # 2. 薬品名を解決（キャッシュ活用）
    item_ids = list({str(item.get("stockable_item_id")) for item in raw_items
                     if item.get("stockable_item_id")})
    name_cache = resolve_names(token, item_ids, name_cache)

    # 3. MedOrder在庫 dict を作成 { name: {stock, lot, expires_on, last_action, last_acted_at} }
    medorder_map = {}
    for item in raw_items:
        sid  = str(item.get("stockable_item_id", ""))
        info = name_cache.get(sid, {})
        name = info.get("name", "")
        if not name:
            continue
        qty = item.get("quantity", 0)

        # ロット・期限は order_items リストの先頭から取得
        lot        = ""
        expires_on = ""
        order_items = item.get("order_items") or []
        if order_items:
            first = order_items[0]
            lot        = first.get("lot", "") or ""
            expires_on = first.get("expires_on", "") or ""

        medorder_map[name] = {
            "stock":         qty,
            "lot":           lot,
            "expiry":        expires_on,
            "last_action":   item.get("last_action") or "",
            "last_acted_at": item.get("last_acted_at") or "",
            "yj_code":       info.get("yj_code", ""),
            "unit":          info.get("unit", ""),
        }

    # 4. Supabase の現在値を取得して差分検知（50件ずつ分割してURL長制限を回避）
    supa_headers = {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}
    supa_map = {}
    name_list = list(medorder_map.keys())
    for i in range(0, len(name_list), 50):
        chunk = name_list[i:i+50]
        names_quoted = ",".join([f'"{n}"' for n in chunk])
        try:
            supa_res = requests.get(
                f"{SUPA_URL}/inventory?name=in.({names_quoted})"
                f"&select=name,stock,lot,expiry,last_action,last_acted_at,yj_code",
                headers=supa_headers,
                timeout=30
            )
            if supa_res.status_code == 200:
                for row in supa_res.json():
                    supa_map[row["name"]] = row
        except Exception as e:
            log(f"[WARNING] Supabase 現在値取得エラー (chunk {i//50+1}): {e}")


    # 5. 差分を検出してUPSERT対象を絞る
    upsert_records = []
    for name, mo in medorder_map.items():
        sb = supa_map.get(name, {})

        try:
            mo_qty = float(mo["stock"] or 0)
            sb_qty = float(str(sb.get("stock") or 0).replace(",", ""))
        except (ValueError, TypeError):
            mo_qty = 0
            sb_qty = 0

        # 在庫値が変わった、またはlot・期限・last_actionが変わった場合に更新
        stock_changed  = abs(mo_qty - sb_qty) > 0.01
        lot_changed    = mo["lot"]        != (sb.get("lot") or "")
        action_changed = mo["last_action"] != (sb.get("last_action") or "")

        if stock_changed or lot_changed or action_changed:
            record = {
                "name":           name,
                "stock":          str(int(mo_qty)) if float(mo_qty).is_integer() else str(round(mo_qty, 2)),
                "lot":            mo["lot"],
                "expiry":         mo["expiry"],
                "last_action":    mo["last_action"],
                "last_acted_at":  mo["last_acted_at"],
                "updated_at":     datetime.now(timezone.utc).isoformat(),
                # yj_code: MedOrderに存在してSupabaseが空の場合のみ更新、それ以外は空文字(Supabase側の既存値を上書きしない)
                "yj_code":        mo["yj_code"] if (mo["yj_code"] and not sb.get("yj_code")) else (sb.get("yj_code") or ""),
            }
            upsert_records.append(record)

    # 6. Supabase に UPSERT
    if upsert_records:
        upsert_inventory(upsert_records)
        elapsed = (datetime.now() - started).total_seconds()
        log(f"[SYNC] 更新: {len(upsert_records)} 件 / {len(medorder_map)} 件 ({elapsed:.1f}秒)")
        for r in upsert_records[:5]:
            log(f"  -> {r['name'][:30]}  stock={r['stock']}  action={r.get('last_action','')}")
        if len(upsert_records) > 5:
            log(f"  ... 他 {len(upsert_records)-5} 件")
    else:
        elapsed = (datetime.now() - started).total_seconds()
        log(f"[SYNC] 変更なし ({len(medorder_map)} 件チェック, {elapsed:.1f}秒)")

    return name_cache


# ── デーモンループ ────────────────────────────────────────────────────────
async def daemon():
    log("=" * 55)
    log("MedOrder 在庫タブ同期デーモン 起動")
    log(f"  ポーリング間隔: {POLL_INTERVAL_SEC // 60} 分")
    log(f"  稼働時間: {BUSINESS_HOUR_START}:00 - {BUSINESS_HOUR_END}:00")
    log("=" * 55)

    if not SUPA_KEY:
        log("[ERROR] SUPABASE_KEY が設定されていません (.env を確認)")
        return

    name_cache     = _load_name_cache()
    token          = None
    last_token_at  = 0
    cycle          = 0

    while True:
        now_h = datetime.now().hour

        # 営業時間外はスリープ
        if not (BUSINESS_HOUR_START <= now_h < BUSINESS_HOUR_END):
            log(f"営業時間外 ({now_h}時) -> 30分スリープ")
            await asyncio.sleep(30 * 60)
            continue

        # トークン更新（起動時 + 1時間毎）
        now_ts = time.time()
        if token is None or (now_ts - last_token_at) > TOKEN_REFRESH_INTERVAL:
            try:
                token         = await get_medorder_token()
                last_token_at = now_ts
                name_cache    = _load_name_cache()  # キャッシュも再読み込み
            except Exception as e:
                log(f"[ERROR] トークン取得失敗: {e}  -> 5分後にリトライ")
                await asyncio.sleep(5 * 60)
                continue

        # 同期実行
        cycle += 1
        log(f"--- サイクル #{cycle} 開始 ---")
        try:
            name_cache = sync_once(token, name_cache)
        except RuntimeError as e:
            if "TOKEN_EXPIRED" in str(e):
                log("[INFO] トークン期限切れ -> 再取得します")
                token = None
                continue
            log(f"[ERROR] sync_once 失敗: {e}")
        except Exception as e:
            log(f"[ERROR] 予期しないエラー: {e}")

        # 次のサイクルまでスリープ
        await asyncio.sleep(POLL_INTERVAL_SEC)


# ── エントリポイント ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="MedOrder在庫タブ同期デーモン")
    parser.add_argument("--once", action="store_true", help="1回だけ実行して終了")
    parser.add_argument("--interval", type=int, default=5, help="ポーリング間隔(分) デフォルト: 5")
    args = parser.parse_args()

    if args.interval != 5:
        POLL_INTERVAL_SEC = args.interval * 60

    if args.once:
        # 1回実行モード（デバッグ・動作確認用）
        async def _once():
            log("=== 1回実行モード ===")
            token      = await get_medorder_token()
            name_cache = _load_name_cache()
            sync_once(token, name_cache)
            log("=== 完了 ===")
        asyncio.run(_once())
    else:
        asyncio.run(daemon())
