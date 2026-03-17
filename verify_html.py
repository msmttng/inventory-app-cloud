with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.splitlines()

print(f"Lines: {len(lines)}")

# Check for duplicate structures
issues = 0
for pattern, desc in [
    ("id='app'", "div#app count (should be 1)"),
    ('<body', 'body tags (should be 1)'),
    ('</body>', 'closing body tags (should be 1)'),
    ('<main', 'main tags (should be 1)'),
    ('mount(', 'Vue mount calls (should be 1)'),
]:
    count = content.count(pattern)
    status = 'OK' if count == 1 else 'PROBLEM'
    if status == 'PROBLEM':
        issues += 1
    print(f"  [{status}] {desc}: found {count}x")

# Check for broken Vue syntax (backslash-quoted activeTab checks)
broken_vue = []
for i, line in enumerate(lines):
    if "activeTab === \\ " in line or r"activeTab === \" in line:
        broken_vue.append(i+1)

if broken_vue:
    print(f"\n  [PROBLEM] Broken Vue syntax (backslash quotes) at lines: {broken_vue[:5]}")
    issues += 1
else:
    print(f"\n  [OK] No broken Vue syntax detected")

if issues == 0:
    print("\nFile looks GOOD!")
else:
    print(f"\nFound {issues} issue(s)")
