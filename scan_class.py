"""
Scans and fixes broken :class bindings with backslash-escaped quotes.
For example: :class='shelfSort === opt.value ? \bg-indigo-600 ... \ : \...\' 
"""

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.splitlines()

# Find lines with backslash-quoted :class bindings
print("=== Lines with backslash in :class or v-for bindings ===")
problem_lines = []
for i, line in enumerate(lines):
    if ":class='" in line and "\\" in line:
        problem_lines.append(i+1)
        print(f"  Line {i+1}: {line.strip()[:120]}")
    elif "v-for=" in line and "\\" in line:
        problem_lines.append(i+1)
        print(f"  Line {i+1}: {line.strip()[:120]}")
    elif ":key='" in line and "\\" in line:
        problem_lines.append(i+1)
        print(f"  Line {i+1}: {line.strip()[:120]}")

print(f"\nTotal problem lines: {len(problem_lines)}")
