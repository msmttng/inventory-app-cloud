"""
index.html の構造修正スクリプト。
Line 165-242 の壊れた重複コンテンツを削除し、
Line 1-164 (クリーンなヘッダー+ナビ) の直後に
Line 243 以降 (mainコンテンツ+script) を繋げる。
"""

with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Original: {len(lines)} lines")

# Line 1-164: クリーンなヘッダー+ナビ (0-indexed: 0-163)
clean_top = lines[0:164]

# Line 165-242: 壊れた重複部分 → 削除 (0-indexed: 164-241)
print(f"Removing lines 165-242 ({242-164} lines of broken content)")

# Line 243以降: mainコンテンツ+script (0-indexed: 242-)
rest = lines[242:]

# 結合
fixed_lines = clean_top + rest

print(f"Fixed: {len(fixed_lines)} lines")

# 保存
with open('index.html', 'w', encoding='utf-8', newline='\r\n') as f:
    f.writelines(fixed_lines)

# 確認: 新しいライン164-170を表示
print("\n--- New lines 163-170 (junction area) ---")
for i in range(162, min(170, len(fixed_lines))):
    print(f"  {i+1}: {fixed_lines[i].rstrip()[:100]}")

print("\nDone!")
