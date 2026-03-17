"""
Find all remaining backslash-corrupted Vue attribute values in index.html.
These are: \\word\\ patterns inside HTML attributes that should be 'word'
"""
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.splitlines()

print(f"Total lines: {len(lines)}")
print("\n=== Lines with backslash-quoted string patterns ===")
count = 0
for i, line in enumerate(lines):
    # Look for backslash-escaped strings inside Vue template expressions
    has_backslash_str = False
    # Pattern: \word\ (two backslashes wrapping a word)
    for char_idx in range(len(line)-2):
        if line[char_idx] == '\\' and line[char_idx+1] != '\\':
            # Single backslash before a word character
            has_backslash_str = True
            break
    
    if has_backslash_str and ('<' in line or '{{' in line):
        print(f"  Line {i+1}: {line.strip()[:120]}")
        count += 1

print(f"\nTotal: {count} lines with potential backslash corruption")
