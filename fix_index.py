import os

with open('index_final.html', 'r', encoding='utf-8') as f:
    final_content = f.read()

header = final_content.split('<!-- PLACEHOLDER_MAIN -->')[0]

with open('index.html', 'r', encoding='utf-8') as f:
    orig_content = f.read()

main_start = orig_content.find('<main')
script_start = orig_content.find('<script')

if main_start != -1 and script_start != -1:
    main_block = orig_content[main_start:script_start]
    
    # 1. Replace the corrupted backslashes with double quotes
    main_block = main_block.replace('\\\\', '"')
    
    # 2. Fix the corrupted vue tab directives
    main_block = main_block.replace("<div v-if='activeTab === \" search\"'>", "<div v-if=\"activeTab === 'search'\">")
    main_block = main_block.replace("<div v-if='activeTab === \"shelf\"'>", "<div v-if=\"activeTab === 'shelf'\">")
    main_block = main_block.replace("<div v-if='activeTab === \" alert\"'>", "<div v-if=\"activeTab === 'alert'\">")
    main_block = main_block.replace("<div v-if='activeTab === \"return\"'>", "<div v-if=\"activeTab === 'return'\">")
    main_block = main_block.replace("<div v-if='activeTab === \"dead\"'>", "<div v-if=\"activeTab === 'dead'\">")
    main_block = main_block.replace("<div v-if='activeTab === \"live\"'>", "<div v-if=\"activeTab === 'live'\">")
    
    # 3. Fix the extra closing tag that causes <main> to end prematurely
    main_block = main_block.replace("</div>\n            <div v-if='alternativeResults.length > 0'", "            <div v-if='alternativeResults.length > 0'")

    script_block = orig_content[script_start:]
    
    # 4. Save the fixed version
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(header + main_block + script_block)
    print("FIX APPLIED")
else:
    print("HTML STRUCTURE INVALID")
