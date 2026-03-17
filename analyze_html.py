"""
index.html を正しい構造に修正するスクリプト。
問題: <div id='app'> が2重になっており、Vue.jsが空の最初のdivにマウントされていた。
解決: 正しいナビ部分 (index_final.html から) と、正しいメインコンテンツ部分 (index.html から) を組み合わせる。
"""

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()
total = len(lines)
print(f"Total lines: {total}")

# 二つのdiv#appがある位置を探す
app_divs = []
for i, line in enumerate(lines):
    if "id='app'" in line or 'id="app"' in line:
        app_divs.append(i + 1)
        print(f"  div#app found at line {i+1}: {line.strip()[:80]}")

# mainタグの位置
mains = []
for i, line in enumerate(lines):
    if "<main" in line:
        mains.append(i + 1)
        print(f"  <main> found at line {i+1}: {line.strip()[:80]}")

# scriptタグ位置 (Vueアプリコード)
scripts = []
for i, line in enumerate(lines):
    if "<script>" in line or "<script>\r" in line:
        scripts.append(i + 1)
        print(f"  <script> found at line {i+1}")

# return tab
for i, line in enumerate(lines):
    if 'activeTab === "return"' in line or "activeTab === 'return'" in line:
        print(f"  return tab at line {i+1}")
        break

# dead tab
for i, line in enumerate(lines):
    if 'activeTab === "dead"' in line or "activeTab === 'dead'" in line:
        print(f"  dead tab at line {i+1}")
        break
