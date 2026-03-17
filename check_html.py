with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()
print(f'Total lines: {len(lines)}')

checks = [
    'returnSort',
    'deadSort',
    'genericSortOptions',
    'filteredReturnData',
    'filteredDeadData',
    'stockValue',
    'returnSort === ',
    'deadSort === ',
]

for key in checks:
    found = key in content
    print(f'  {"OK" if found else "NG"}: {key}')
