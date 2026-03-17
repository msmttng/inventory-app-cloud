import os
import requests

gas_url = ''
with open('.env') as f:
    for line in f:
        if 'GAS_WEB_APP' in line:
            gas_url = line.split('=')[1].strip()

# strip quotes out since .env might contain them
gas_url = gas_url.strip('"').strip("'")

csv = "発注日,状態,メーカー,品名,規格,単位,数量,発注先,納品予定\n"
# Using an existing medicine name to match against MedOrder items in getMinusStocks
csv += "2024/02/17 12:00:00,完了,,アムロジピン錠5mg「トーワ」,,錠,100,メディセオ,02/18\n"
csv += "2024/02/17 10:00:00,完了,,ロキソプロフェンNa錠60mg「トーワ」,,錠,50,メディセオ,入荷未定\n"

print(f"Uploading to GAS: {gas_url[:30]}...")
res = requests.post(gas_url, params={'type': 'history'}, data=csv.encode('utf-8'))
print("Response:", res.status_code)
