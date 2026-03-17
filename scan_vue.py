"""
Scans index.html for all broken Vue directives and lists them.
"""
with open('index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")
print("\n--- All v-if / v-else / activeTab directives ---")
for i, line in enumerate(lines):
    stripped = line.strip()
    if 'activeTab' in stripped and ('v-if' in stripped or '@click' in stripped):
        print(f"  Line {i+1}: {stripped[:120]}")

print("\n--- Lines containing backslash + quote (potential broken Vue attrs) ---")
count = 0
for i, line in enumerate(lines):
    if "\\'" in line or '\\"' in line or "\\ " in line:
        if 'v-if' in line or ':class' in line or 'v-for' in line or 'v-model' in line:
            print(f"  Line {i+1}: {line.strip()[:120]}")
            count += 1
print(f"Total: {count}")
