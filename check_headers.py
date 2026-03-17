import chardet

files = [
    'dead_stock_export_20260311_220126.csv',
    'return_export_20260311_220126.csv',
    'inventory_export_20260312_050629.csv'
]

for f in files:
    with open(f, 'rb') as rb:
        rawdata = rb.read(2048)
        result = chardet.detect(rawdata)
        encoding = result['encoding']
        print(f"{f}: {encoding}")
        rb.seek(0)
        try:
            content = rb.read(2048).decode(encoding)
            print(f"Header: {content.splitlines()[0]}")
        except Exception as e:
            print(f"Error reading {f}: {e}")
