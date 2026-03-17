"""
index.html を正しい構造に修正するスクリプト。
問題: nav の終わり (line 164) の直後に古い壊れたコンテンツが入り込んでいる。
解決: line 1-164 (クリーンなヘッダー+ナビ) と line 243以降 (クリーンなmain+script) を組み合わせる。
"""

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# 165行目から242行目 (main開始前の壊れた重複部分) を確認
print("\n--- Lines 164-246 (area to fix) ---")
for i in range(163, 246):
    if i < len(lines):
        print(f"  {i+1}: {lines[i].rstrip()[:100]}")
