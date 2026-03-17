import asyncio
import os
import requests
from datetime import datetime
from test_medipal6 import run as get_medipal

async def run():
    print("Extracting Medipal dates...")
    med_data = await get_medipal()
    
    delivery_map = {d["name"]: d["status"] for d in med_data}
    
    # We will upload a dummy history row to test the mapping
    GAS_URL = os.environ.get("GAS_WEB_APP_URL", "https://script.google.com/macros/s/AKfycbz_d3N7Z0G9g4H_Nq7Xj6T21Z6A3M_LhS_45L6T2M3A2L/exec")
    if not GAS_URL:
        with open('.env') as f:
            for line in f:
               if 'GAS_WEB_APP_URL' in line:
                   GAS_URL = line.split('=')[1].strip()
                   
    # Create test data
    test_rows = [
        ["'2024/02/17 12:00:00", "完了", "メーカA", "メトクロプラミド錠5mg「タイヨー」", "", "錠", "100", "アルフレッサ", delivery_map.get("メトクロプラミド錠5mg「タイヨー」", "2/18")],
        ["'2024/02/17 10:00:00", "完了", "メーカB", "テスト薬品", "", "錠", "50", "スズケン", "入荷未定"]
    ]
    
    csv = "発注日,状態,メーカー,品名,規格,単位,数量,発注先,納品予定\n"
    for r in test_rows:
        csv += ",".join(r) + "\n"
        
    print("Uploading to GAS...")
    res = requests.post(GAS_URL, params={'type': 'history'}, data=csv.encode('utf-8'))
    print("Response:", res.status_code)

if __name__ == "__main__":
    asyncio.run(run())
