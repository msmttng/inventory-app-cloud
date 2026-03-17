import os
import json
import requests

def run():
    with open('.env', 'r', encoding='utf-8') as f:
        env_content = f.read()
    
    token = None
    for line in env_content.split('\n'):
        if line.startswith('MEDORDER_TOKEN='):
            token = line.split('=', 1)[1].strip()
            break
            
    if not token:
        print("No token found")
        return
        
    url = 'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=10'
    res = requests.get(url, headers={'Authorization': f'Bearer {token}'})
    data = res.json()
    
    extracted = []
    for order in data:
        for item in order.get('items', []):
            extracted.append({
                'order_id': order.get('id'),
                'state': order.get('state'),
                'item_name': item.get('orderable_item', {}).get('name'),
                'delivers_on': item.get('delivers_on'),
                'shipping_date': item.get('shipping_date'),
                'delivery_date': item.get('delivery_date')
            })
            
    print(json.dumps(extracted, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    run()
