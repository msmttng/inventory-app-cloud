with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.splitlines()

print('Lines:', len(lines))

pairs = [
    ("id=\"app\"", "div#app (double quote)"),
    ("id='app'",  "div#app (single quote)"),
    ('<body',     'body tags'),
    ('</body>',   'closing body'),
    ('<main',     'main tags'),
    ('mount(',    'Vue mount'),
]
for pattern, desc in pairs:
    count = content.count(pattern)
    status = 'OK' if count <= 1 else 'ISSUE'
    print(f'  [{status}] {desc}: {count}')

# Check for broken Vue activeTab directives
broken = [i+1 for i, line in enumerate(lines) if 'search\\' in line and 'activeTab' in line]
print('  Broken search Vue attr lines:', broken[:3] if broken else 'none')
