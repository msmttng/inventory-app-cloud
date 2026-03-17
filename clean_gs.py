"""
Code.gs のクリーンアップ: 重複した古いdoPostの断片 (lines 183-360) を削除する
"""
with open('Code.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Original: {len(lines)} lines")

# Keep: lines 1-181 (new doPost) + blank line + lines 361+ (getLastUpdated and onwards)
# Remove: lines 183-360 (orphaned old doPost code)
# 0-indexed: keep 0-180, skip 181-359, keep 360+

clean = lines[0:181] + ['\n'] + lines[360:]

print(f"Clean: {len(clean)} lines")
print(f"Removed: {len(lines) - len(clean)} orphan lines")

# Verify the junction
print("\n--- Junction area (lines 178-185 of cleaned file) ---")
for i in range(177, min(185, len(clean))):
    print(f"  {i+1}: {clean[i].rstrip()}")

with open('Code.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(clean)

print("\nDone!")
