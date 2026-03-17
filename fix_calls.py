"""
index.html の google.script.run.doPost() 呼び出しを
直接named関数の呼び出しに変換する
"""
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    # lastUpdated
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'lastUpdated' }) } })",
        ".getLastUpdated()"
    ),
    # search
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'search', query: searchQuery.value }) } })",
        ".searchMedicine(searchQuery.value)"
    ),
    # summary (shelf)
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'summary' }) } })",
        ".getShelfSummary()"
    ),
    # return
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'return' }) } })",
        ".getReturnData()"
    ),
    # dead
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'dead' }) } })",
        ".getDeadData()"
    ),
    # live - note this uses a dynamic page variable
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'live', page: page }) } })",
        ".getLiveStocks(page)"
    ),
    # Also the livePage refresh call
    (
        ".doPost({ postData: { contents: JSON.stringify({ action: 'live', page: livePage }) } })",
        ".getLiveStocks(livePage)"
    ),
]

fixes = 0
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        print(f"Fixed: {old[:60]}")
        fixes += 1
    else:
        print(f"NOT FOUND: {old[:60]}")

with open('index.html', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print(f"\nTotal fixes: {fixes}")

# Verify no doPost calls remain
remaining = [i+1 for i, line in enumerate(content.splitlines()) if '.doPost(' in line and 'function' not in line]
print(f"Remaining .doPost() calls: {remaining}")
