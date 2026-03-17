import sys

def main():
    with open('index.html', 'r', encoding='utf-8') as f:
        text = f.read()

    # Step 1: Fix typos in customOrder
    text = text.replace('‰œ” ã', 'Œ®” ã')
    text = text.replace('“V”‰‰E‰œ’I', '“V”‰‰E‰¡’I')

    # Step 2: Extract current HTML for the shelf tab
    start_tag = '<div v-if=\"activeTab === \'shelf\'\">'
    end_tag = '<div v-if=\"activeTab === \'alert\'\">'
    
    start_idx = text.find(start_tag)
    end_idx = text.find(end_tag)

    if start_idx != -1 and end_idx != -1:
        old_shelf_html = text[start_idx:end_idx]
        
        # New Shelf HTML without 'grouping' (hierarchyData)
        new_shelf_html = '''<div v-if=\"activeTab === 'shelf'\">
        <div v-if=\"shelfLoading\" class=\"glass-card rounded-2xl p-12 text-center\"><i class=\"fa-solid fa-circle-notch spinner text-4xl text-indigo-400 block mb-4\"></i><p class=\"text-gray-400\">’I”Ôƒf[ƒ^‚ğ“Ç‚İ‚İ’†...</p></div>
        <div v-else-if=\"shelfError\" class=\"bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded-r-lg flex items-start\"><i class=\"fa-solid fa-triangle-exclamation text-red-500 mt-1 mr-3\"></i><p class=\"text-red-700\">{{ shelfError }}</p></div>
        <div v-else-if=\"shelfData.length > 0\">
          <div class=\"glass-card rounded-xl p-4 mb-4 flex flex-col gap-3\">
            <div class=\"relative w-full\"><i class=\"fa-solid fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm\"></i><input v-model=\"shelfFilter\" type=\"text\" placeholder=\"’I”Ô‚Ü‚½‚Í–ò•i–¼‚Åi‚è‚İ...\" class=\"w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 bg-white\" /></div>
            <div class=\"flex flex-wrap items-center gap-2\"><span class=\"text-xs font-semibold text-gray-400 mr-1\">•À‚Ñ‘Ö‚¦F</span><button v-for=\"opt in sortOptions\" :key=\"opt.value\" @click=\"shelfSort = opt.value\" class=\"text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all\" :class=\"shelfSort === opt.value ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-400 hover:text-indigo-600'\"><i :class=\"opt.icon\" class=\"mr-1\"></i>{{ opt.label }}</button><div class=\"ml-auto flex items-center gap-2\"><span class=\"text-xs font-bold text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5\">{{ lowStockThreshold }}ŒÂˆÈ‰º‚ÅŒx</span><span class=\"text-xs font-medium bg-indigo-100 text-indigo-800 py-1 px-3 rounded-full\">{{ filteredShelfData.length }}’I</span></div></div>
          </div>
          <div class=\"space-y-3\">
            <div v-for=\"(shelf, si) in filteredShelfData\" :key=\"si\" class=\"glass-card rounded-xl overflow-hidden shelf-card fade-in\" :style=\"'animation-delay:' + (si * 0.04) + 's'\">
              <button class=\"w-full flex items-center justify-between p-4 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left\" @click=\"toggleShelf(si)\">
                <div class=\"flex items-center gap-3\"><div class=\"w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0\"><i class=\"fa-solid fa-layer-group text-white text-sm\"></i></div><div><div class=\"font-bold text-indigo-800 text-base\">{{ shelf.shelf }}</div><div class=\"text-xs text-indigo-500 flex items-center gap-2 mt-0.5\"><span>{{ shelf.items.length }}•i–Ú</span><span v-if=\"shelfLowStockCount(shelf) > 0\" class=\"text-amber-600 flex items-center gap-1 low-stock-pulse\"><i class=\"fa-solid fa-triangle-exclamation text-xs\"></i>‚í‚¸‚© {{ shelfLowStockCount(shelf) }}Œ</span></div></div></div>
                <i class=\"fa-solid transition-transform duration-200 text-indigo-400\" :class=\"openedShelves.has(si) ? 'fa-chevron-up' : 'fa-chevron-down'\"></i>
              </button>
              <div v-if=\"openedShelves.has(si)\" class=\"border-t border-indigo-100\">
                <div v-for=\"(item, ii) in shelf.items\" :key=\"ii\" class=\"flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors\" :class=\"{ 'bg-amber-50 hover:bg-amber-100': isLowStock(item.stock) }\">
                  <div class=\"flex-1 min-w-0 mr-4\"><span class=\"text-sm text-gray-700 font-medium truncate block\">{{ item.name }}</span></div>
                  <div class=\"shrink-0 flex items-center gap-2\"><span v-if=\"isLowStock(item.stock)\" class=\"text-xs font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1 low-stock-pulse\"><i class=\"fa-solid fa-triangle-exclamation text-xs\"></i>‚í‚¸‚©</span><span class=\"font-bold text-base min-w-[44px] text-right\" :class=\"isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-700'\">{{ item.stock !== '' ? item.stock : '-' }}</span><span class=\"text-xs text-gray-400 w-4\">ŒÂ</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      '''
        
        text = text.replace(old_shelf_html, new_shelf_html)

    # Step 3: Remove unused hierarchyData references in Vue script
    # Just removing it from the return statement is sufficient or modifying its body.
    # The return object of setup
    # Because openedGroups is no longer used, we can just leave it as is to not break everything.

    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print('Done replacing.')

if __name__ == '__main__':
    main()
