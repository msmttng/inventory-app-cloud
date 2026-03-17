"""
Fixes all broken Vue v-if activeTab directives in index.html.
The broken patterns are things like:
  v-if='activeTab === \\shelf\\'
  v-if='activeTab === " alert\\'
  v-if='activeTab === " search\\'
"""
import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all broken activeTab v-if patterns
# Pattern: v-if='activeTab === \TABNAME\' or v-if='activeTab === " TABNAME\'
replacements = [
    # Broken shelf
    ("v-if='activeTab === \\shelf\\'", "v-if=\"activeTab === 'shelf'\""),
    # Broken alert (with extra quote)
    ("v-if='activeTab === \" alert\\'", "v-if=\"activeTab === 'alert'\""),
    # Broken search (with extra quote)  
    ("v-if='activeTab === \" search\\'", "v-if=\"activeTab === 'search'\""),
    # Broken live
    ("v-if='activeTab === \\live\\'", "v-if=\"activeTab === 'live'\""),
    # Broken dead
    ("v-if='activeTab === \\dead\\'", "v-if=\"activeTab === 'dead'\""),
    # Broken return
    ("v-if='activeTab === \\return\\'", "v-if=\"activeTab === 'return'\""),
]

fixes = 0
for old, new in replacements:
    if old in content:
        content = content.replace(old, new)
        print(f"Fixed: {old[:60]}")
        fixes += 1

# Also fix alertShelfFilter = \\ reset button
content = content.replace("@click='alertShelfFilter = \\\\'", '@click="alertShelfFilter = \'\'"')

with open('index.html', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print(f"\nTotal fixes applied: {fixes}")

# Verify
lines = content.splitlines()
broken = [i+1 for i, line in enumerate(lines) if "activeTab ===" in line and ("\\'>" in line or '\\ >' in line)]
print(f"Remaining broken activeTab lines: {broken}")
