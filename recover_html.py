import os
import re

search_dir = r"C:\Users\masam\.gemini\antigravity\brain\4d14f413-325c-4a3e-a690-0c52779815fa"
target_file = r"C:\Users\masam\.gemini\antigravity\scratch\inventory_app\index_restored.html"

print("Searching for original index.html...")
for root, dirs, files in os.walk(search_dir):
    for f in files:
        if 'cortex' in f or 'log' in f:
            path = os.path.join(root, f)
            try:
                try:
                    text = open(path, 'r', encoding='utf-8').read()
                except:
                    text = open(path, 'r', encoding='shift_jis').read()
                
                # Check for the view_file command output that contains the exact full version
                if 'File Path: `file:///C:/Users/masam/.gemini/antigravity/scratch/inventory_app/index.html`' in text and 'Total Lines: 525' in text:
                    print(f"Found original content in {path}")
                    lines = text.splitlines()
                    start_idx = -1
                    end_idx = -1
                    for i, line in enumerate(lines):
                        if line.startswith('1: <!DOCTYPE html>'):
                            start_idx = i
                        elif start_idx != -1 and line.startswith('The above content shows the entire, complete file contents'):
                            end_idx = i - 1
                            break
                            
                    if start_idx != -1 and end_idx != -1:
                        html_lines = []
                        for i in range(start_idx, end_idx + 1):
                            # The format was "123: <div>..."
                            match = re.match(r'^\d+: (.*)', lines[i])
                            if match:
                                html_lines.append(match.group(1))
                            else:
                                html_lines.append(lines[i])
                        
                        with open(target_file, 'w', encoding='utf-8') as out:
                            out.write('\n'.join(html_lines))
                        print(f"Recovered to {target_file}")
                        exit(0)
            except Exception as e:
                pass
print("Not found")
