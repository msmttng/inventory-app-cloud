"""
Rebuilds index.html by:
1. Keeping lines 1-165 (<!DOCTYPE> through <nav> and opening <main>) - these are CLEAN
2. Replacing lines 166-362 (corrupted search/shelf/alert tabs in main) with clean HTML
3. Keeping lines 363+ (clean return/dead tabs + footer + script)
"""

with open('index.html', 'r', encoding='utf-8') as f:
    all_lines = f.readlines()

print(f"Original: {len(all_lines)} lines")

# Show where return tab starts (should be our anchor)
for i, line in enumerate(all_lines):
    if 'activeTab === "return"' in line or "activeTab === 'return'" in line:
        print(f"  return tab div at line {i+1}")
        break

# Show lines around that
for i in range(max(0, i-3), min(len(all_lines), i+3)):
    print(f"  {i+1}: {all_lines[i].rstrip()[:80]}")
