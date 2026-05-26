import requests
import json
import time
import os
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

GAS_URL = 'https://script.google.com/macros/s/AKfycbwp7WfGg5Md1-or1ihfVPH_KuMBQw41BVnUzR9iACTv0m8iG2DpLcnW-0Ui2zBFrTJWUg/exec'
SUPA_URL = os.environ.get('SUPABASE_URL', 'https://jscqmecctsijqxihnxwi.supabase.co/rest/v1')
SUPA_KEY = os.environ.get('SUPABASE_KEY')
DISCORD_WEBHOOK_URL = os.environ.get('DISCORD_WEBHOOK_URL')

if not SUPA_KEY:
    raise RuntimeError('SUPABASE_KEY が .env に設定されていません')

# apikeyと併せて、重複発生時は上書き保存(UPSERT)を実行するPreferヘッダーを設定
headers = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates' # 重複した場合は自動更新(UPSERT)
}

def send_discord_alert(title, details, severity="ERROR"):
    """Discordの管理チャンネルへリッチなカード形式で通知を送る"""
    if not DISCORD_WEBHOOK_URL:
        print(f"[Discord Alert Skipped] {title}: {details}")
        return
    color = 15158332 if severity == "ERROR" else 3066993  # 赤 (Error) / 緑 (Success)
    payload = {
        "embeds": [{
            "title": f"{'🚨' if severity == 'ERROR' else '✅'} {title}",
            "description": details,
            "color": color,
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "footer": {"text": "MEDIXS 在庫同期システム"}
        }]
    }
    try:
        requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
    except Exception as e:
        print("Failed to send discord alert:", e)

def sync_mhlw():
    try:
        print('Fetching MHLW_SUPPLY from GAS (this may take 10-20 seconds)...')
        r = requests.post(GAS_URL, json={'action': 'mhlw_debug'}, allow_redirects=True, timeout=30)
        raw_data = json.loads(r.content.decode('utf-8'))
        print(f'Fetched {len(raw_data)} rows. Processing MHLW...')

        unique_records = {}
        for row in raw_data[1:]:
            name = str(row[0]).strip()
            if not name: continue
            unique_records[name] = {
                'name': name,
                'status': str(row[1]).strip() if len(row) > 1 else '',
                'yj_code': str(row[2]).strip() if len(row) > 2 else ''
            }

        records = list(unique_records.values())
        print(f'Prepared {len(records)} UNIQUE records for Supabase MHLW.')

        # 既存全削除(DELETE)は廃止し、UPSERTで段階更新
        batch_size = 1000
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            print(f'Uploading MHLW batch {i//batch_size + 1} ({len(batch)} items)...')
            r_supa = requests.post(f'{SUPA_URL}/mhlw_supply', headers=headers, json=batch, timeout=30)
            if r_supa.status_code not in [200, 201]:
                error_msg = f"MHLW Supabase Error: {r_supa.text}"
                print(error_msg)
                send_discord_alert("MHLW 同期エラー", error_msg, "ERROR")
            time.sleep(0.5)
        print('MHLW Sync Complete.')
    except Exception as e:
        error_msg = f"MHLW 同期中に例外が発生しました:\n{str(e)}"
        print(error_msg)
        send_discord_alert("MHLW 同期エラー", error_msg, "ERROR")


import re as _re

GENERIC_COMPANY_PATTERNS = [
    'トーワ','サワイ','日医工','ニプロ','テバ','DSEP','JG','TCK','オーハラ',
    'クラシエ','アメル','科研','ケミファ','武田テバ','あすか','明治','フソー',
    'YD','KN','AFP','DK','EE','NIG','CMX','Me','NS','ILS','FFP','GE','HD',
    'タイヨー','日新','大興','杏林','日本化薬','センジュ','タカタ','イワキ',
    '東洋カプセル','共和','三和','辰巳','第一三共','長生堂','日本ジェネリック',
    'キョーリン','ファイザー','MED','マイラン','ヴィアトリス','SW','TYK',
    'CH','TC','KY','ST','NK','NP','TS','HK','KO','TTS','AA','ACE'
]

def infer_type_from_name(name):
    """薬品名から先発/後発を判定する"""
    if not name:
        return None
    brackets = _re.findall(r'「([^」]+)」', name)
    if not brackets:
        return None
    for inner in brackets:
        if any(p in inner for p in GENERIC_COMPANY_PATTERNS):
            return '後発品'
    return '後発品'

def sync_inventory():
    try:
        print('Fetching Inventory from GAS...')
        r = requests.post(GAS_URL, json={'action': 'inventory_dump'}, allow_redirects=True, timeout=30)
        raw_data = json.loads(r.content.decode('utf-8'))
        print(f'Fetched {len(raw_data)} rows from Inventory.')

        if len(raw_data) < 2:
            return

        headers_row = raw_data[0]
        name_idx, stock_idx, shelf_idx, unit_idx, type_idx, price_idx, oldest_idx, yj_idx = -1, -1, -1, -1, -1, -1, -1, -1

        for i, h in enumerate(headers_row):
            h_str = str(h).replace('\uFEFF', '').replace(' ', '').replace('　', '').upper()
            if h_str == '医薬品名' or h_str == '薬品名' or h_str == '品名': name_idx = i
            elif h_str == '在庫数': stock_idx = i
            elif h_str == '棚番': shelf_idx = i
            elif h_str == '単位': unit_idx = i
            elif h_str == '先／後' or h_str == '先/後': type_idx = i
            elif h_str == '薬価': price_idx = i
            elif h_str == '推定最古在庫使用期限': oldest_idx = i
            elif h_str == 'YJコード': yj_idx = i

        unique_records = {}
        for row in raw_data[1:]:
            if name_idx == -1 or name_idx >= len(row): continue
            name = str(row[name_idx]).strip()
            if not name: continue
            
            normalized_name = name.replace(' ', '').replace('　', '').upper().replace('ｶﾌﾟｾﾙ', 'カプセル').replace('CAP', 'カプセル')
            
            yj = str(row[yj_idx]).strip() if yj_idx != -1 and yj_idx < len(row) else ''
            raw_type = str(row[type_idx]).strip() if type_idx != -1 and type_idx < len(row) else ''
            inferred_type = infer_type_from_name(name)
            final_type = inferred_type if inferred_type else raw_type
            new_stock = str(row[stock_idx]).strip() if stock_idx != -1 and stock_idx < len(row) else ''
            new_shelf = str(row[shelf_idx]).strip() if shelf_idx != -1 and shelf_idx < len(row) else ''
            new_unit = str(row[unit_idx]).strip() if unit_idx != -1 and unit_idx < len(row) else ''
            new_price = str(row[price_idx]).strip() if price_idx != -1 and price_idx < len(row) else ''
            new_oldest = str(row[oldest_idx]).strip() if oldest_idx != -1 and oldest_idx < len(row) else ''

            if normalized_name in unique_records:
                try:
                    curr_s = float(unique_records[normalized_name]['stock'] or 0)
                    add_s = float(new_stock or 0)
                    unique_records[normalized_name].update({
                        'stock': str(curr_s + add_s),
                        'shelf': new_shelf if new_shelf else unique_records[normalized_name]['shelf'],
                        'unit': new_unit if new_unit else unique_records[normalized_name]['unit'],
                        'oldest_stock': new_oldest if new_oldest else unique_records[normalized_name]['oldest_stock'],
                        'updated_at': datetime.now(timezone.utc).isoformat()
                    })
                    if ' ' in name or '　' in name:
                        unique_records[normalized_name]['name'] = name
                except ValueError:
                    pass
            else:
                unique_records[normalized_name] = {
                    'name': name,
                    'yj_code': yj,
                    'stock': new_stock,
                    'shelf': new_shelf,
                    'unit': new_unit,
                    'type': final_type,
                    'price': new_price,
                    'oldest_stock': new_oldest,
                    'updated_at': datetime.now(timezone.utc).isoformat()
                }

        print('Fetching Minus Stocks from Supabase minus_ledger...')
        try:
            r_minus = requests.get(f"{SUPA_URL}/minus_ledger?select=*&status=not.eq.復旧確認済み（入庫）", headers=headers, timeout=30)
            minus_items = r_minus.json() if r_minus.status_code == 200 else []
            print(f'Fetched {len(minus_items)} minus items.')
            for item in minus_items:
                name = item.get('name', '').strip()
                qty = str(item.get('quantity', ''))
                if not name: continue
                normalized_name = name.replace(' ', '').replace('　', '').upper().replace('ｶﾌﾟｾﾙ', 'カプセル').replace('CAP', 'カプセル')
                if normalized_name in unique_records:
                    unique_records[normalized_name]['stock'] = qty
                    if not unique_records[normalized_name].get('shelf'):
                        unique_records[normalized_name]['shelf'] = item.get('shelf') or 'マイナス在庫'
                else:
                    unique_records[normalized_name] = {
                        'name': name,
                        'yj_code': '',
                        'stock': qty,
                        'shelf': item.get('shelf') or 'マイナス在庫',
                        'unit': '不明',
                        'type': infer_type_from_name(name) or '',
                        'price': '',
                        'oldest_stock': ''
                    }
        except Exception as e:
            print('Error fetching minus stocks from Supabase:', e)

        records = list(unique_records.values())
        print(f'Prepared {len(records)} unique records for Inventory.')

        # 既存全削除は廃止し、UPSERTでダウンタイム0を実現
        batch_size = 1000
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            print(f'Uploading Inventory batch {i//batch_size + 1} ({len(batch)} items)...')
            r_supa = requests.post(f'{SUPA_URL}/inventory', headers=headers, json=batch, timeout=30)
            if r_supa.status_code not in [200, 201]:
                error_msg = f"Inventory Supabase Error: {r_supa.text}"
                print(error_msg)
                send_discord_alert("在庫同期エラー", error_msg, "ERROR")
            time.sleep(0.5)
        print('Inventory Sync Complete.')
        send_discord_alert("在庫同期成功", f"Supabaseとの全在庫データのUPSERT同期が完了しました。\n同期件数: {len(records)} 件", "SUCCESS")
    except Exception as e:
        error_msg = f"在庫同期中に例外が発生しました:\n{str(e)}"
        print(error_msg)
        send_discord_alert("在庫同期エラー", error_msg, "ERROR")

if __name__ == '__main__':
    print('Starting GAS -> Supabase Full Sync...')
    # 既存データの全削除処理(DELETE)はダウンタイムとデータ喪失のリスクがあるため廃止しました。
    # 常に resolution=merge-duplicates によるUPSERT(差分・上書き)で動作します。
    
    sync_mhlw()
    sync_inventory()
    print('All Sync Finished Successfully.')
