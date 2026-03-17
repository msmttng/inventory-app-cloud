with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()

# Find the 返品 and 不動 UI sort button sections
print("=== 返品 (return) tab sort button area ===")
for i, line in enumerate(lines):
    if 'returnSort' in line or ('return' in line.lower() and 'sort' in line.lower()):
        print(f"Line {i+1}: {line.strip()[:120]}")

print()
print("=== 不動 (dead) tab sort button area ===")
for i, line in enumerate(lines):
    if 'deadSort' in line or ('dead' in line.lower() and 'sort' in line.lower()):
        print(f"Line {i+1}: {line.strip()[:120]}")
