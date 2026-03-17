"""
Rebuilds index.html replacing the corrupted search/shelf/alert middle section (lines 166-264)
with clean HTML, keeping the clean nav (1-165) and clean tabs (265+).
"""

CLEAN_MIDDLE = """      <div v-if="activeTab === 'search'">
        <div class="glass-card rounded-2xl p-4 sm:p-6 mb-4">
          <form @submit.prevent="performSearch" class="mb-4">
            <div class="relative flex items-center w-full h-14 rounded-xl bg-white overflow-hidden border-2 border-indigo-100 focus-within:border-indigo-500 focus-within:shadow-lg transition-all duration-300">
              <div class="grid place-items-center h-full w-12 text-indigo-400"><i class="fa-solid fa-magnifying-glass"></i></div>
              <input v-model="searchQuery" class="h-full w-full outline-none text-gray-700 pr-2 placeholder-gray-400 bg-transparent text-lg font-medium" type="text" id="search" placeholder="薬の名前を入力してください..." autocomplete="off" :disabled="isLoading" autofocus />
              <button type="button" v-if="searchQuery.length > 0 && !isLoading" @click="clearSearch" class="h-full px-4 text-gray-400 hover:text-red-500 transition-colors"><i class="fa-solid fa-xmark"></i></button>
              <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white h-full px-6 font-semibold text-sm sm:text-base min-w-[90px] flex items-center justify-center transition-colors" :disabled="isLoading || searchQuery.trim() === ''" :class="{ 'opacity-50 cursor-not-allowed': isLoading || searchQuery.trim() === '' }">
                <span v-if="!isLoading">検索</span>
                <i v-else class="fa-solid fa-circle-notch spinner text-lg"></i>
              </button>
            </div>
          </form>
          <div class="border-t border-gray-100 pt-4">
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-gray-500 flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation text-amber-400"></i>在庫わずか警告ライン</label>
              <span class="text-sm font-bold text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-3 py-0.5">{{ lowStockThreshold }} 個以下</span>
            </div>
            <input type="range" v-model.number="lowStockThreshold" min="0" max="100" step="1" />
            <div class="flex justify-between text-xs text-gray-300 mt-1"><span>0</span><span>50</span><span>100</span></div>
          </div>
        </div>
        <div v-if="errorMsg" class="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded-r-lg flex items-start fade-in"><i class="fa-solid fa-triangle-exclamation text-red-500 mt-1 mr-3"></i><p class="text-red-700">{{ errorMsg }}</p></div>
        <div v-if="hasSearched && !isLoading">
          <div v-if="results.length === 0" class="glass-card rounded-2xl p-10 text-center fade-in flex flex-col items-center"><div class="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4"><i class="fa-solid fa-box-open text-3xl text-gray-300"></i></div><h3 class="text-lg font-medium text-gray-900 mb-1">見つかりませんでした</h3><p class="text-gray-500 text-sm">「{{ lastSearchedQuery }}」に一致する薬は登録されていません。</p></div>
          <div v-else>
            <div class="flex justify-between items-center mb-3 px-2"><h2 class="text-lg font-semibold text-gray-700">検索結果</h2><div class="flex items-center gap-2"><span v-if="lowStockCount > 0" class="text-xs font-medium bg-amber-100 text-amber-700 py-1 px-3 rounded-full flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i> 在庫わずか {{ lowStockCount }}件</span><span class="text-xs font-medium bg-indigo-100 text-indigo-800 py-1 px-3 rounded-full">合致 {{ primaryResults.length }}件 <span v-if="alternativeResults.length > 0">/ 代替 {{ alternativeResults.length }}件</span></span></div></div>
            <div class="space-y-3 mb-6">
              <div v-for="(item, index) in primaryResults" :key="'p'+index" class="glass-card rounded-xl p-5 border-l-4 border-indigo-500 hover:shadow-md transition-shadow fade-in" :class="{ 'low-stock-border': isLowStock(item.stock) }" :style="'animation-delay:' + (index * 0.04) + 's'">
                <div class="flex justify-between items-start gap-4 mb-3"><div class="flex-1 min-w-0 pr-2 pb-1 sm:pb-0"><div class="flex items-center gap-2 mb-1 flex-wrap"><span class="text-xs text-indigo-500 font-bold tracking-wider uppercase">薬品名</span><span v-if="item.type && item.type.includes('後発')" class="text-[10px] font-bold text-teal-700 bg-teal-100 border border-teal-200 rounded px-1.5 py-0.5">後発品</span><span v-if="item.type && item.type.includes('先発')" class="text-[10px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5">先発品</span><span v-if="isLowStock(item.stock)" class="text-xs font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i> 在庫わずか</span></div><h3 class="text-lg sm:text-xl font-bold text-gray-900 leading-tight break-words">{{ item.name }}</h3></div><div class="shrink-0 flex items-start"><div class="rounded-lg p-2 sm:p-3 min-w-[70px] sm:min-w-[90px] text-center border transition-colors flex flex-col justify-center" :class="isLowStock(item.stock) ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'"><div class="text-[10px] sm:text-xs font-medium mb-1" :class="isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-500'"><i class="fa-solid fa-cubes mr-1" :class="isLowStock(item.stock) ? 'text-amber-400' : 'text-gray-400'"></i>在庫数</div><div class="text-xl sm:text-2xl font-bold" :class="isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-800'">{{ item.stock !== '' ? item.stock : '-' }}</div></div></div></div>
                <div class="bg-indigo-50 rounded-lg px-3 py-2.5 border border-indigo-100 flex items-start sm:items-center flex-col sm:flex-row shadow-inner"><div class="text-[11px] sm:text-xs text-indigo-500 font-bold whitespace-nowrap mr-3 mb-1 sm:mb-0"><i class="fa-solid fa-layer-group mr-1.5 opacity-70"></i>棚番:</div><div class="text-sm sm:text-base font-bold text-indigo-800 break-words leading-tight">{{ item.shelf !== '' ? item.shelf : '-' }}</div></div>
              </div>
            </div>
            <div v-if="alternativeResults.length > 0" class="mt-8 fade-in" style="animation-delay: 0.3s">
              <div class="flex items-center gap-2 mb-3 px-2"><i class="fa-solid fa-code-compare text-teal-500"></i><h2 class="text-md font-bold text-gray-700">同じ成分の代替薬 <span class="text-xs font-normal text-gray-400 ml-1">（{{ alternativeResults.length }}件）</span></h2></div>
              <div class="space-y-3">
                <div v-for="(item, index) in alternativeResults" :key="'a'+index" class="glass-card rounded-xl p-4 border-l-4 border-teal-400 hover:shadow-md transition-shadow bg-gradient-to-r from-teal-50/30 to-transparent" :class="{ 'low-stock-border': isLowStock(item.stock) }">
                  <div class="flex justify-between items-start gap-4 mb-3"><div class="flex-1 min-w-0 pr-2 pb-1 sm:pb-0"><div class="flex items-center gap-2 mb-1 flex-wrap"><span class="text-[10px] font-bold text-teal-700 bg-teal-100 border border-teal-200 rounded px-1.5 py-0.5">代替提案</span><span v-if="item.type && item.type.includes('後発')" class="text-[10px] font-bold text-teal-700 bg-teal-100 border border-teal-200 rounded px-1.5 py-0.5">後発品</span><span v-if="item.type && item.type.includes('先発')" class="text-[10px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5">先発品</span><span v-if="isLowStock(item.stock)" class="text-xs font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i> わずか</span></div><h3 class="text-base sm:text-lg font-bold text-gray-800 leading-tight break-words">{{ item.name }}</h3></div><div class="shrink-0 flex items-start"><div class="rounded-lg p-2 min-w-[65px] sm:min-w-[80px] text-center border transition-colors flex flex-col justify-center" :class="isLowStock(item.stock) ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'"><div class="text-[10px] font-medium mb-0.5" :class="isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-500'">在庫</div><div class="text-lg sm:text-xl font-bold" :class="isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-800'">{{ item.stock !== '' ? item.stock : '-' }}</div></div></div></div>
                  <div class="bg-teal-50 rounded-lg px-3 py-2.5 border border-teal-100 flex items-start sm:items-center flex-col sm:flex-row shadow-inner"><div class="text-[11px] sm:text-xs text-teal-600 font-bold whitespace-nowrap mr-3 mb-1 sm:mb-0"><i class="fa-solid fa-layer-group mr-1.5 opacity-70"></i>棚番:</div><div class="text-sm sm:text-base font-bold text-teal-800 break-words leading-tight">{{ item.shelf !== '' ? item.shelf : '-' }}</div></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!hasSearched && !isLoading" class="glass-card rounded-2xl p-10 text-center text-gray-400 mt-2"><i class="fa-solid fa-magnifying-glass text-4xl mb-4 opacity-20 block"></i><p>上部の検索窓に薬の名前を入力して検索してください</p></div>
      </div>
      <div v-if="activeTab === 'shelf'">
        <div v-if="shelfLoading" class="glass-card rounded-2xl p-12 text-center"><i class="fa-solid fa-circle-notch spinner text-4xl text-indigo-400 block mb-4"></i><p class="text-gray-400">棚番データを読み込み中...</p></div>
        <div v-else-if="shelfError" class="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded-r-lg flex items-start"><i class="fa-solid fa-triangle-exclamation text-red-500 mt-1 mr-3"></i><p class="text-red-700">{{ shelfError }}</p></div>
        <div v-else-if="shelfData.length > 0">
          <div class="glass-card rounded-xl p-4 mb-4 flex flex-col gap-3">
            <div class="relative w-full"><i class="fa-solid fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i><input v-model="shelfFilter" type="text" placeholder="棚番または薬品名で絞り込み..." class="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 bg-white" /></div>
            <div class="flex flex-wrap items-center gap-2"><span class="text-xs font-semibold text-gray-400 mr-1">並び替え：</span><button v-for="opt in sortOptions" :key="opt.value" @click="shelfSort = opt.value" class="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all" :class="shelfSort === opt.value ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-400 hover:text-indigo-600'"><i :class="opt.icon" class="mr-1"></i>{{ opt.label }}</button><div class="ml-auto flex items-center gap-2"><span class="text-xs font-bold text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">{{ lowStockThreshold }}個以下で警告</span><span class="text-xs font-medium bg-indigo-100 text-indigo-800 py-1 px-3 rounded-full">{{ hierarchyData.length }}グループ / {{ filteredShelfData.length }}棚</span></div></div>
          </div>
          <div class="space-y-3">
            <div v-for="(group, gi) in hierarchyData" :key="gi" class="glass-card rounded-xl overflow-hidden shelf-card fade-in" :style="'animation-delay:' + (gi * 0.04) + 's'">
              <button class="w-full flex items-center justify-between p-4 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left" @click="toggleGroup(gi)">
                <div class="flex items-center gap-3"><div class="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0"><i class="fa-solid fa-box-open text-white text-sm"></i></div><div><div class="font-bold text-indigo-800 text-base">{{ group.groupName }}</div><div class="text-xs text-indigo-500 flex items-center gap-2 mt-0.5"><span>{{ group.shelves.length }}棚 / {{ group.totalItems }}品目</span><span v-if="group.lowStockTotal > 0" class="text-amber-600 flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i>在庫わずか {{ group.lowStockTotal }}件</span></div></div></div>
                <i class="fa-solid transition-transform duration-200 text-indigo-400" :class="openedGroups.has(gi) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
              </button>
              <div v-if="openedGroups.has(gi)" class="border-t border-indigo-100 divide-y divide-gray-100">
                <div v-for="(shelf, si) in group.shelves" :key="si">
                  <button class="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left" @click="toggleShelf(gi + '-' + si)">
                    <div class="flex items-center gap-3"><div class="w-7 h-7 bg-gray-100 rounded-md flex items-center justify-center shrink-0"><i class="fa-solid fa-layer-group text-gray-400 text-xs"></i></div><div><div class="font-semibold text-gray-800 text-sm">{{ shelf.shelf }}</div><div class="text-xs text-gray-400 flex items-center gap-2"><span>{{ shelf.items.length }}品目</span><span v-if="shelfLowStockCount(shelf) > 0" class="text-amber-500 flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i>わずか {{ shelfLowStockCount(shelf) }}件</span></div></div></div>
                    <i class="fa-solid transition-transform duration-200 text-gray-300 text-xs" :class="openedShelves.has(gi + '-' + si) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                  </button>
                  <div v-if="openedShelves.has(gi + '-' + si)" class="border-t border-gray-100">
                    <div v-for="(item, ii) in shelf.items" :key="ii" class="flex items-center justify-between pl-14 pr-4 py-2.5 hover:bg-gray-50 transition-colors" :class="{ 'bg-amber-50 hover:bg-amber-100': isLowStock(item.stock) }">
                      <div class="flex-1 min-w-0 mr-4"><span class="text-sm text-gray-700 font-medium truncate block">{{ item.name }}</span></div>
                      <div class="shrink-0 flex items-center gap-2"><span v-if="isLowStock(item.stock)" class="text-xs font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5 flex items-center gap-1 low-stock-pulse"><i class="fa-solid fa-triangle-exclamation text-xs"></i>わずか</span><span class="font-bold text-base min-w-[44px] text-right" :class="isLowStock(item.stock) ? 'text-amber-600' : 'text-gray-700'">{{ item.stock !== '' ? item.stock : '-' }}</span><span class="text-xs text-gray-400 w-4">個</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="activeTab === 'alert'">
        <div v-if="shelfLoading" class="glass-card rounded-2xl p-12 text-center"><i class="fa-solid fa-circle-notch spinner text-4xl text-red-400 block mb-4"></i><p class="text-gray-400">データを読み込み中...</p></div>
        <div v-else>
          <div class="glass-card rounded-xl p-4 mb-4"><div class="flex items-center justify-between mb-2"><label class="text-xs font-semibold text-gray-500 flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation text-amber-400"></i>在庫わずかの基準</label><span class="text-sm font-bold text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-3 py-0.5">{{ lowStockThreshold }} 個以下</span></div><input type="range" v-model.number="lowStockThreshold" min="0" max="100" step="1" /><div class="flex justify-between text-xs text-gray-300 mt-1"><span>0</span><span>50</span><span>100</span></div></div>
          <div class="flex flex-wrap items-center gap-2 mb-4"><span class="text-xs font-semibold text-gray-400 mr-1">並び替え：</span><button v-for="opt in alertSortOptions" :key="opt.value" @click="alertSort = opt.value" class="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all" :class="alertSort === opt.value ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-400 hover:text-indigo-600'"><i :class="opt.icon" class="mr-1"></i>{{ opt.label }}</button></div>
          <div class="relative mb-4"><i class="fa-solid fa-layer-group absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm"></i><input v-model="alertShelfFilter" type="text" placeholder="棚番で絞り込み（例：軟軟、センター）..." class="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-indigo-400 bg-white" /><button v-if="alertShelfFilter" @click="alertShelfFilter = ''" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-red-400 transition-colors"><i class="fa-solid fa-xmark text-sm"></i></button></div>
          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="glass-card rounded-xl p-4 text-center border-l-4 border-red-500"><div class="text-3xl font-black text-red-600">{{ alertData.zero.length }}</div><div class="text-xs font-semibold text-gray-500 mt-1 flex items-center justify-center gap-1"><i class="fa-solid fa-circle-xmark text-red-400"></i> 在庫ゼロ</div></div>
            <div class="glass-card rounded-xl p-4 text-center border-l-4 border-amber-400"><div class="text-3xl font-black text-amber-600">{{ alertData.low.length }}</div><div class="text-xs font-semibold text-gray-500 mt-1 flex items-center justify-center gap-1"><i class="fa-solid fa-triangle-exclamation text-amber-400"></i> 在庫わずか</div></div>
          </div>
          <div v-if="alertData.zero.length > 0" class="mb-4">
            <h2 class="text-sm font-bold text-red-600 flex items-center gap-2 mb-2 px-1"><i class="fa-solid fa-circle-xmark"></i> 在庫ゼロ（{{ alertData.zero.length }}件）</h2>
            <div class="glass-card rounded-xl overflow-hidden"><div v-for="(item, i) in alertData.zero" :key="'z'+i" class="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-red-50 transition-colors fade-in"><div class="flex-1 min-w-0 mr-3"><div class="font-semibold text-gray-800 text-sm truncate">{{ item.name }}</div><div class="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><i class="fa-solid fa-layer-group text-xs"></i> {{ item.shelf }}</div></div><div class="shrink-0 text-xl font-black text-red-600">0 <span class="text-xs font-normal text-gray-400">個</span></div></div></div>
          </div>
          <div v-if="alertData.low.length > 0" class="mb-4">
            <h2 class="text-sm font-bold text-amber-600 flex items-center gap-2 mb-2 px-1"><i class="fa-solid fa-triangle-exclamation"></i> 在庫わずか（{{ alertData.low.length }}件）</h2>
            <div class="glass-card rounded-xl overflow-hidden"><div v-for="(item, i) in alertData.low" :key="'l'+i" class="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-amber-50 transition-colors fade-in"><div class="flex-1 min-w-0 mr-3"><div class="font-semibold text-gray-800 text-sm truncate">{{ item.name }}</div><div class="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><i class="fa-solid fa-layer-group text-xs"></i> {{ item.shelf }}</div></div><div class="shrink-0 text-xl font-black text-amber-600">{{ item.stock }} <span class="text-xs font-normal text-gray-400">個</span></div></div></div>
          </div>
        </div>
      </div>
"""

with open('index.html', 'r', encoding='utf-8') as f:
    all_lines = f.readlines()

print(f"Total lines: {len(all_lines)}")

# Lines 1-165 = indices 0-164 (clean header+nav+main opening)
top = all_lines[0:165]  # ends with <main> open + corrupted search div

# Line 265 onwards = index 264 (clean return tab onwards)
# But let's find it precisely
return_line_idx = None
for i, line in enumerate(all_lines):
    if 'activeTab === "return"' in line:
        return_line_idx = i
        print(f"Clean return section starts at line {i+1}")
        break

if return_line_idx is None:
    print("ERROR: Could not find return tab")
    exit(1)

rest = all_lines[return_line_idx:]

# Combine
fixed = top + [CLEAN_MIDDLE + '\n'] + rest

with open('index.html', 'w', encoding='utf-8', newline='\r\n') as f:
    f.writelines(fixed)

print(f"Done! New file: {sum(1 for _ in fixed)} lines")
