
// ==========================================
// ★ GitHub Pages 用の GAS 互換プロキシ層 ★
// GAS以外の環境で google.script.run が存在しない場合、自動的に
// GAS Web App へ POST(fetch) して同等の動作を実現します。
// ==========================================
if (typeof google === 'undefined') {
  window.google = { script: { run: {} } };
  
  // clasp deployments の最新のWeb App URL
  const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwp7WfGg5Md1-or1ihfVPH_KuMBQw41BVnUzR9iACTv0m8iG2DpLcnW-0Ui2zBFrTJWUg/exec';

  const buildRun = (successHandler, failureHandler) => {
    return new Proxy({}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') return (fn) => buildRun(fn, failureHandler);
        if (prop === 'withFailureHandler') return (fn) => buildRun(successHandler, fn);
        if (prop === 'withUserObject') return () => buildRun(successHandler, failureHandler); // 未使用だが一応
        
        return (...args) => {
          let action = prop;
          if (prop === 'getShelfSummary') action = 'summary';
          if (prop === 'getReturnData') action = 'return';
          if (prop === 'getDeadData') action = 'dead';
          if (prop === 'getLiveStocks') action = 'live';
          if (prop === 'getPendingDeliveries') action = 'pending_deliveries';
          if (prop === 'getReceiveHistoryData') action = 'receive_history';
          if (prop === 'getOrderHistory') action = 'history';
          if (prop === 'getMinusStocks') action = 'get_minus_stocks';
          if (prop === 'getExpiryData') action = 'expiry';
          if (prop === 'requestTokenRefreshFromUI') action = 'request_token_refresh';
          if (prop === 'getLastUpdated') action = 'lastUpdated';
          if (prop === 'getAllLastUpdated') action = 'allLastUpdated';
          if (prop === 'addUnmatchedMedicineToInventory') action = 'add_unmatched_medicine';
          
          let payload = { action: action };
          if (prop === 'getLiveStocks' && args.length > 0) payload.page = args[0];
          if (prop === 'saveMemo' && args.length > 1) { payload.name = args[0]; payload.memo = args[1]; }
          if (prop === 'deleteMemo' && args.length > 0) payload.name = args[0];
          if (prop === 'addUnmatchedMedicineToInventory' && args.length > 0) payload.params = args[0];
          
          fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain' }
          })
          .then(res => res.json())
          .then(data => { if (successHandler) successHandler(data); })
          .catch(err => {
            console.error('GAS Proxy Error:', err);
            if (failureHandler) failureHandler(err);
          });
        };
      }
    });
  };
  
  window.google.script.run = buildRun(null, null);
  
  // URL解析用のモック (必要最低限)
  window.google.script.url = {
    getLocation: (callback) => {
      const params = new URLSearchParams(window.location.search);
      let pObj = {};
      for(let [k,v] of params) pObj[k] = v;
      callback({ parameter: pObj });
    }
  };
}

const { createApp, ref, computed, onMounted } = Vue;
createApp({
  setup() {
    const activeTab = ref('search');
    const searchQuery = ref(''); const lastSearchedQuery = ref(''); const results = ref([]);
    const isLoading = ref(false); const hasSearched = ref(false); const errorMsg = ref('');
    const enifSet = ref(new Set());
    const supplyQuery = ref(''); const supplyLastSearchedQuery = ref(''); const supplyResults = ref([]);
    const supplyIsLoading = ref(false); const supplyHasSearched = ref(false); const supplyErrorMsg = ref('');
    const lastUpdated = ref(''); 
    const systemHealthStatus = ref('ok');
    const lowStockThreshold = ref(10);
    const tabUpdatedTimes = ref({ inventory: '', return: '', dead: '', history: '', receive_history: '', collabo_history: '', epi_delivery: '' });
    const shelfData = ref([]); const shelfLoading = ref(false); const shelfError = ref('');
    const shelfFilter = ref(''); const shelfSort = ref('shelf');
    const openedShelves = ref(new Set()); const shelfSummaryOpen = ref('');
    const returnData = ref([]); const returnLoading = ref(false); const returnError = ref(''); const returnFilterStr = ref('');
    const deadData = ref([]); const deadLoading = ref(false); const deadError = ref(''); const deadFilterStr = ref('');
    const liveData = ref([]); const liveLoading = ref(false); const liveError = ref(''); const liveFilterStr = ref('');
    const livePage = ref(1); const liveTotalCount = ref(0); const liveTotalPages = ref(1);
    const isScraping = ref(false);
    const isReloadingAll = ref(false);
    const histModalOpen = ref(false);
    const histModalItem = ref(null);
    const histModalData = ref([]);
    const histModalLoading = ref(false);
    const histModalError = ref('');
    const adjustModalOpen = ref(false);
    const adjustModalItem = ref(null);
    const adjustStockValue = ref('');
    const isAdjusting = ref(false);
    
    // ── 未登録薬品（メンテナンス）関連 ──
    const unmatchedItems = ref([]);
    const selectedUnmatchedItems = ref([]);
    const unmatchedLoading = ref(false);
    const unmatchedError = ref('');
    const addUnmatchedModalOpen = ref(false);
    const isSubmittingUnmatched = ref(false);
    const unmatchedForm = ref({ id: '', name: '', yjCode: '', shelf: '', unit: '', type: '' });
    
    const openAdjustModal = (item) => {
      adjustModalItem.value = item;
      const stockVal = item.stock !== undefined ? item.stock : (item.quantity !== undefined ? item.quantity : 0);
      adjustStockValue.value = String(stockVal).replace(/,/g, '');
      adjustModalOpen.value = true;
    };
    
    const submitAdjustment = async () => {
      if (!adjustModalItem.value) return;
      isAdjusting.value = true;
      try {
        const item = adjustModalItem.value;
        const oldStockStr = String(item.stock).replace(/,/g, '');
        const oldStock = parseFloat(oldStockStr) || 0;
        const newStockStr = String(adjustStockValue.value).replace(/,/g, '');
        const newStock = parseFloat(newStockStr);
        if (isNaN(newStock)) throw new Error('数値を入力してください');
        
        // 1. PATCH /inventory
        const invRes = await fetch(supaUrl + '/inventory?yj_code=eq.' + encodeURIComponent(item.yjCode || item.yj_code), {
          method: 'PATCH',
          headers: supaHeaders,
          body: JSON.stringify({ stock: newStock })
        });
        if (!invRes.ok) throw new Error('在庫の更新に失敗しました');
        
        // 2. POST /transaction_history
        const diff = newStock - oldStock;
        if (diff !== 0) {
          const histRecord = {
            id: crypto.randomUUID(),
            transaction_date: new Date().toISOString(),
            yj_code: item.yjCode || item.yj_code,
            name: item.name,
            transaction_type: '在庫調整(手動)',
            qty_in: diff > 0 ? diff : 0,
            qty_out: diff < 0 ? Math.abs(diff) : 0,
            stock_balance: newStock,
            partner: '手動調整',
            unique_hash: crypto.randomUUID()
          };
          await fetch(supaUrl + '/transaction_history', {
            method: 'POST',
            headers: supaHeaders,
            body: JSON.stringify(histRecord)
          });
        }
        
        // Update local state
        item.stock = newStock;
        if (item.quantity !== undefined) item.quantity = newStock;
        adjustModalOpen.value = false;
        alert('在庫を調整しました！');
      } catch (err) {
        alert('エラー: ' + err.message);
      } finally {
        isAdjusting.value = false;
      }
    };
    const histModalTab = ref('all');
    const inHistCount = computed(() => histModalData.value.filter(h => h.transaction_type.includes('納品')).length);
    const outHistCount = computed(() => histModalData.value.filter(h => h.transaction_type.includes('調剤')).length);
    const otherHistCount = computed(() => histModalData.value.filter(h => !h.transaction_type.includes('納品') && !h.transaction_type.includes('調剤')).length);
    const filteredHistModalData = computed(() => {
      if (histModalTab.value === 'in') return histModalData.value.filter(h => h.transaction_type.includes('納品'));
      if (histModalTab.value === 'out') return histModalData.value.filter(h => h.transaction_type.includes('調剤'));
      if (histModalTab.value === 'other') return histModalData.value.filter(h => !h.transaction_type.includes('納品') && !h.transaction_type.includes('調剤'));
      return histModalData.value;
    });
    const alertShelfFilter = ref(''); const alertUsageFilter = ref(''); const alertUnitFilter = ref('');
    const alertSort = ref('shelf'); const returnSort = ref('shelf'); const deadSort = ref('shelf');

    // ── メモ機能 ──
    const memos = ref({});
    const editingMemo = ref('');  // 現在編集中の薬品名
    const editingMemoText = ref('');
    const memoSaving = ref(false);

    const loadMemos = () => {
      if (typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run.withSuccessHandler(data => { memos.value = data || {}; }).withFailureHandler(() => {}).getMemos();
      }
    };
    const toggleMemoEdit = (itemName) => {
      if (editingMemo.value === itemName) { editingMemo.value = ''; return; }
      editingMemo.value = itemName;
      editingMemoText.value = memos.value[itemName] || '';
    };
    const saveMemoAction = (itemName) => {
      memoSaving.value = true;
      if (typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run.withSuccessHandler(() => {
          if (editingMemoText.value.trim()) memos.value[itemName] = editingMemoText.value.trim();
          else delete memos.value[itemName];
          editingMemo.value = '';
          memoSaving.value = false;
        }).withFailureHandler(() => { memoSaving.value = false; }).saveMemo(itemName, editingMemoText.value);
      } else {
        if (editingMemoText.value.trim()) memos.value[itemName] = editingMemoText.value.trim();
        else delete memos.value[itemName];
        editingMemo.value = '';
        memoSaving.value = false;
      }
    };

    const unitFilterOptions = [
      { value:'固形剤', label:'💊 固形剤', units:['錠','カプセル','丸','シート','ブリスター'] },
      { value:'液剤',   label:'💧 液剤',   units:['ML'] },
      { value:'散剤',   label:'🧂 散剤・軟膏', units:['G','包','袋'] },
      { value:'その他単位', label:'📦 外用・その他', units:['瓶','キット','個','枚','本','管'] },
    ];
    const alertSortOptions = [
      { label:'棚番順', value:'shelf', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬品名順', value:'name', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'在庫数順', value:'stock', icon:'fa-solid fa-arrow-down-1-9' }
    ];
    const genericSortOptions = [
      { label:'棚番順', value:'shelf', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬価順', value:'price', icon:'fa-solid fa-arrow-down-9-1' },
      { label:'在庫金額順', value:'stockValue', icon:'fa-solid fa-arrow-down-9-1' }
    ];

    // ── 納品履歴 ──
    const receiveData     = ref([]);
    const receiveLoading  = ref(false);
    const receiveError    = ref('');
    const receiveFilterStr= ref('');
    const loadReceiveData = async (force) => {
      if(!force && receiveData.value.length>0) return;
      receiveLoading.value = true; receiveError.value = '';
      try {
        const tUrl = supaUrl + '/transaction_history?transaction_type=ilike.*納品*&order=transaction_date.desc&limit=2000';
        const res = await fetch(tUrl, {headers: supaHeaders});
        if (!res.ok) throw new Error('Supabase Error: ' + res.statusText);
        const rawData = await res.json();
        
        const groups = {};
        rawData.forEach(r => {
          const dateStr = (r.transaction_date || '').substring(0, 10).replace(/-/g, '/');
          const partner = r.partner || '不明';
          const key = dateStr + '_' + partner;
          
          if (!groups[key]) {
            groups[key] = {
              receiveDate: dateStr,
              wholesaler: partner,
              totalQuantity: 0,
              items: [],
              isOpen: false
            };
          }
          
          const qty = parseFloat(r.qty_in) || 0;
          groups[key].totalQuantity += qty;
          groups[key].items.push({
            name: r.name,
            quantity: qty,
            stockBalance: r.stock_balance
          });
        });
        
        receiveData.value = Object.values(groups).sort((a, b) => {
          const dateA = new Date(a.receiveDate).getTime();
          const dateB = new Date(b.receiveDate).getTime();
          if(dateA !== dateB) return dateB - dateA;
          return a.wholesaler.localeCompare(b.wholesaler, 'ja');
        });
      } catch(e) {
        receiveError.value = 'エラー: ' + (e.message || e);
        // Fallback to dummy data
        receiveData.value = [
          { receiveDate: '2026/05/15', wholesaler: 'アルフレッサ', totalQuantity: 15, items: [{name: 'ダミー薬品A 10mg', quantity: 10, stockBalance: 100}, {name: 'ダミー薬品B 5mg', quantity: 5, stockBalance: 20}], isOpen: false }
        ];
      } finally {
        receiveLoading.value = false;
      }
    };
    const toggleReceiveGroup = (group) => {
      group.isOpen = !group.isOpen;
    };
    const switchToReceiveTab = () => { activeTab.value = 'receive'; loadReceiveData(false); };
    const filteredReceiveData = computed(() => {
      let d = [...receiveData.value];
      if(receiveFilterStr.value) {
        const q = receiveFilterStr.value.toLowerCase();
        d = d.filter(g => g.wholesaler.toLowerCase().includes(q) || g.items.some(i => (i.name||'').toLowerCase().includes(q)));
      }
      return d;
    });

    // ── 履歴タブ専用 ──
    const historyData     = ref([]);
    const historyLoading  = ref(false);
    const historyError    = ref('');
    const historySystem   = ref('MedOrder');   // 'MedOrder' | 'OrderEPI'
    const historySupplier = ref('');           // '' | 'メディセオ' | 'アルフレッサ' | 'スズケン' | '東邦'
    const historyStatus   = ref('');
    const historyFilterStr= ref('');
    const historySort     = ref('date_desc');

    const historySortOptions = [
      { label:'新しい順', value:'date_desc', icon:'fa-solid fa-arrow-down-wide-short' },
      { label:'古い順',   value:'date_asc',  icon:'fa-solid fa-arrow-up-wide-short' },
      { label:'薬品名順', value:'name',      icon:'fa-solid fa-arrow-down-a-z' },
      { label:'発注数順', value:'qty',       icon:'fa-solid fa-arrow-down-9-1' },
    ];

    const medorderCount  = computed(() => historyData.value.filter(i=>i.source==='MedOrder').length);
    const orderepiCount  = computed(() => historyData.value.filter(i=>i.source==='OrderEPI').length);

    const filteredHistoryData = computed(() => {
      let d = historyData.value.filter(i => i.source === historySystem.value);
      if (historySupplier.value) d = d.filter(i => (i.supplier||'').includes(historySupplier.value));
      if (historyStatus.value)   d = d.filter(i => (i.status||'').includes(historyStatus.value));
      if (historyFilterStr.value.trim()) {
        const q = historyFilterStr.value.toLowerCase();
        d = d.filter(i => (i.name||'').toLowerCase().includes(q) || (i.maker||'').toLowerCase().includes(q));
      }
      const s = historySort.value;
      if (s==='date_desc') d.sort((a,b)=>new Date(b.orderDate)-new Date(a.orderDate));
      else if (s==='date_asc') d.sort((a,b)=>new Date(a.orderDate)-new Date(b.orderDate));
      else if (s==='name') d.sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true}));
      else if (s==='qty')  d.sort((a,b)=>b.quantity-a.quantity);
      return d;
    });
    const historyFilteredTotal = computed(()=>filteredHistoryData.value.length);

    const supplierBadgeClass = (sup) => {
      if (!sup) return 'badge-unknown';
      if (sup.includes('メディセオ')) return 'badge-mediseio';
      if (sup.includes('アルフレッサ')) return 'badge-alfresa';
      if (sup.includes('スズケン')) return 'badge-suzuken';
      if (sup.includes('東邦')) return 'badge-toho';
      return 'badge-unknown';
    };
    const statusBadgeClass = (st) => {
      if (!st) return 'bg-gray-100 text-gray-500';
      if (st.includes('完了')) return 'bg-green-100 text-green-700';
      if (st.includes('キャンセル')) return 'bg-gray-200 text-gray-600';
      return 'bg-cyan-100 text-cyan-700';
    };
    const formatHistoryDate = (dStr) => {
      if (!dStr) return '';
      try {
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return dStr;
        return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      } catch(e) { return dStr; }
    };
    const formatPendingDate = (dStr) => {
      if (!dStr) return '';
      try {
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return String(dStr).split(' GMT')[0];
        return `${('0'+(d.getMonth()+1)).slice(-2)}/${('0'+d.getDate()).slice(-2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      } catch(e) { return dStr; }
    };
    const loadHistoryData = (force) => {
      if (!force && historyData.value.length>0) return Promise.resolve(historyData.value);
      historyLoading.value = true; historyError.value = '';
      return new Promise((resolve, reject) => {
        if (typeof google!=='undefined' && google.script && google.script.run) {
          google.script.run
            .withSuccessHandler(data => {
              historyData.value = data||[];
              historyLoading.value=false;
              resolve(historyData.value);
            })
            .withFailureHandler(err  => {
              historyError.value='エラー: '+(err.message||err);
              historyLoading.value=false;
              reject(err);
            })
            .getOrderHistory();
        } else {
          // ── ローカルテスト用ダミーデータ ──
          setTimeout(()=>{
            historyData.value = [
              { source:'MedOrder', orderDate:'2026-03-14T10:30:00Z', name:'アムロジピン錠5mg「トーワ」', quantity:100, status:'完了',  supplier:'メディセオ',   maker:'東和薬品' },
              { source:'MedOrder', orderDate:'2026-03-13T09:00:00Z', name:'メトホルミン塩酸塩錠250mg', quantity:50,  status:'処理中', supplier:'アルフレッサ', maker:'共和薬品' },
              { source:'MedOrder', orderDate:'2026-03-12T14:45:00Z', name:'カルベジロール錠2.5mg「サワイ」', quantity:30, status:'完了', supplier:'スズケン', maker:'沢井製薬' },
              { source:'MedOrder', orderDate:'2026-03-11T11:20:00Z', name:'エソメプラゾールカプセル20mg', quantity:20, status:'キャンセル', supplier:'メディセオ', maker:'AZ' },
              { source:'MedOrder', orderDate:'2026-03-10T08:00:00Z', name:'ロスバスタチン錠5mg「KN」', quantity:60, status:'完了', supplier:'アルフレッサ', maker:'小林化工' },
              { source:'OrderEPI', orderDate:'2026-03-14T08:15:00Z', name:'ヒルドイドソフト軟膏0.3%', quantity:10, status:'完了', supplier:'スズケン', maker:'マルホ' },
              { source:'OrderEPI', orderDate:'2026-03-13T15:30:00Z', name:'キシロカインゼリー2%', quantity:5,  status:'処理中', supplier:'メディセオ', maker:'AZ' },
              { source:'OrderEPI', orderDate:'2026-03-12T10:00:00Z', name:'リンデロン-VG軟膏0.12%', quantity:8,  status:'完了', supplier:'アルフレッサ', maker:'塩野義製薬' },
              { source:'OrderEPI', orderDate:'2026-03-11T13:00:00Z', name:'テルビナフィン塩酸塩クリーム1%', quantity:12, status:'キャンセル', supplier:'スズケン', maker:'日本ジェネリック' },
            ];
            historyLoading.value=false;
            resolve(historyData.value);
          }, 500);
        }
      });
    };
    const switchToHistoryTab = () => { activeTab.value='history'; loadHistoryData(true); };

    // ── 棚番グループマップ ──
    const prefixGroupMap = [
      { prefix:'汎用左',group:'汎用左' },{ prefix:'汎用右',group:'汎用右' },{ prefix:'引出し',group:'引出し' },
      { prefix:'汎用横',group:'汎用横' },{ prefix:'軟膏',group:'軟膏' },{ prefix:'ｾﾝﾀｰ 下 左',group:'ｾﾝﾀｰ 下 左' },
      { prefix:'ｾﾝﾀｰ 下 右',group:'ｾﾝﾀｰ 下 右' },{ prefix:'ｸﾗｲｱﾝﾄ下',group:'ｸﾗｲｱﾝﾄ下' },
      { prefix:'ｸﾗｲｱﾝﾄ上',group:'ｸﾗｲｱﾝﾄ上' },{ prefix:'ｻｰﾊﾞｰ下',group:'ｻｰﾊﾞｰ下' },
      { prefix:'天秤上',group:'天秤上' },{ prefix:'天秤下',group:'天秤下' },{ prefix:'天秤右横',group:'天秤右横' },
      { prefix:'湿布',group:'湿布' },{ prefix:'センター前',group:'センター前' },{ prefix:'コンテナ',group:'コンテナ' },
      { prefix:'冷蔵庫',group:'冷蔵庫' },{ prefix:'漢方',group:'漢方' },{ prefix:'靴箱上',group:'靴箱上' },
      { prefix:'麻薬',group:'麻薬' },{ prefix:'毒薬庫',group:'毒薬庫' },{ prefix:'販売済み',group:'販売済み' },
      { prefix:'期限切迫',group:'期限切迫' },{ prefix:'期限切れ',group:'期限切れ' },
    ];
    const getShelfGroup = (s) => {
      const n = String(s||'').trim();
      for(let i=0;i<prefixGroupMap.length;i++){
        if(n.startsWith(prefixGroupMap[i].prefix)) return {key:prefixGroupMap[i].group,order:i};
        if(prefixGroupMap[i].prefix==='引出し'&&n.includes('引出し')) return {key:'引出し',order:i};
      }
      return {key:n||'（棚番なし）',order:prefixGroupMap.length};
    };
    const shelfOrderIndex = (s) => getShelfGroup(s).order;
    const getGroupKey = (c) => getShelfGroup(String(c||'').split(',')[0].trim());

    const normalizeUnit = (unit) => {
      const u = String(unit||'').trim();
      if(/^カプセル$/i.test(u)||/^capsule$/i.test(u)) return 'C';
      if(/^キット$/i.test(u)||/^kit$/i.test(u)) return 'K';
      return u;
    };
    const extractBottleVol = (str) => {
      if(!str) return null;
      const m = String(str).match(/(\d+(?:\.\d+)?)\s*ml/i);
      return m ? parseFloat(m[1]) : null;
    };

    const isEnifTarget = (item) => {
      if (!item || !item.name) return false;
      return enifSet.value.has(normalizeForSearch(item.name));
    };

    // ── 点眼薬 表示変換（優先条件4段階） ──
    const convertEyedrop = (stock, oldestStock, unit, name) => {
      const stockNum = parseFloat(stock);
      const u = String(unit||'').trim();
      if (isNaN(stockNum)) return { displayStock: '-', displayUnit: u || '不明' };
      if (u === '瓶') return { displayStock: String(stock), displayUnit: '瓶' };
      const volFromOldest = extractBottleVol(oldestStock);
      if (volFromOldest && volFromOldest > 0) {
        const b = stockNum / volFromOldest;
        return { displayStock: Number.isInteger(b) ? String(b) : b.toFixed(1), displayUnit: '瓶' };
      }
      const volFromName = extractBottleVol(name);
      if (volFromName && volFromName > 0) {
        const b = stockNum / volFromName;
        return { displayStock: Number.isInteger(b) ? String(b) : b.toFixed(1), displayUnit: '瓶' };
      }
      return { displayStock: String(stock), displayUnit: 'mL' };
    };

    const isLowStock = (stock) => {
      if(stock===''||stock==='不明'||stock===null) return false;
      const s=parseFloat(stock); return !isNaN(s)&&s<=lowStockThreshold.value;
    };

    const getAlertItems = (opts={}) => {
      const zero=[],low=[];
      shelfData.value.forEach(s=>{
        if(opts.shelfFilter&&!s.shelf.toLowerCase().includes(opts.shelfFilter.toLowerCase())) return;
        s.items.forEach(item=>{
          const stock=parseFloat(item.stock);
          if(isNaN(stock)||stock<0) return;
          if(opts.usageFilter){const u=String(item.usage||'').trim();if(opts.usageFilter==='その他'){if(u==='内'||u==='外') return;}else{if(u!==opts.usageFilter) return;}}
          if(opts.unitFilter){if(opts.unitFilter==='点眼'){if(!item.name.includes('点眼')) return;}else{const unit=String(item.unit||'').trim();const grp=unitFilterOptions.find(o=>o.value===opts.unitFilter);if(grp&&!grp.units.some(u=>unit.toUpperCase()===u.toUpperCase())) return;if(opts.unitFilter==='液剤'&&item.name.includes('点眼')) return;}}
          let displayStock=String(item.stock),displayUnit=normalizeUnit(item.unit);
          if(item.name.includes('点眼')){const c=convertEyedrop(item.stock,item.oldestStock,item.unit,item.name);displayStock=c.displayStock;displayUnit=c.displayUnit;}
          const entry={...item,shelf:s.shelf,displayUnit,displayStock};
          if(stock===0) zero.push(entry); else if(parseFloat(displayStock)<=lowStockThreshold.value) low.push(entry);
        });
      });
      const sorter=opts.sortBy==='name'?(a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true}):opts.sortBy==='stock'?(a,b)=>parseFloat(a.stock)-parseFloat(b.stock):(a,b)=>{const iA=shelfOrderIndex(a.shelf),iB=shelfOrderIndex(b.shelf);if(iA!==iB) return iA-iB;return a.shelf.localeCompare(b.shelf,'ja',{numeric:true,sensitivity:'base'});};
      return {zero:zero.sort(sorter),low:low.sort(sorter),total:zero.length+low.length};
    };
    const shelfSummary = computed(()=>getAlertItems({sortBy:'name'}));
    const alertData = computed(()=>getAlertItems({usageFilter:alertUsageFilter.value,unitFilter:alertUnitFilter.value,shelfFilter:alertShelfFilter.value,sortBy:alertSort.value}));

    const escapeHtml = (str) => String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const highlightText = (text) => {
      const f=shelfFilter.value.trim(); const safe=escapeHtml(text);
      if(!f) return safe;
      const re=f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return safe.replace(new RegExp(re,'gi'),m=>`<mark style="background:#fde68a;color:#92400e;border-radius:2px;padding:0 1px;">${escapeHtml(m)}</mark>`);
    };

    const groupedShelfData = computed(()=>{
      const map=new Map();
      shelfData.value.forEach(shelf=>{
        const name=String(shelf.shelf||'').trim();
        if(shelfFilter.value){const f=shelfFilter.value.toLowerCase();if(!name.toLowerCase().includes(f)&&!shelf.items.some(i=>i.name.toLowerCase().includes(f))) return;}
        const {key,order}=getGroupKey(name);
        if(!map.has(key)) map.set(key,{groupName:key,order,items:[]});
        shelf.items.forEach(item=>map.get(key).items.push({...item,shelf:name}));
      });
      return Array.from(map.values()).sort((a,b)=>{if(a.order!==b.order) return a.order-b.order;return a.groupName.localeCompare(b.groupName,'ja',{numeric:true,sensitivity:'base'});});
    });
    const groupLowStockCount = (g)=>g.items.filter(i=>isLowStock(i.stock)).length;
    const toggleShelf = (id)=>{if(openedShelves.value.has(id)) openedShelves.value.delete(id);else openedShelves.value.add(id);};

    onMounted(()=>{
      if(typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run.withSuccessHandler(r=>{if(r&&r.time) lastUpdated.value=r.time;}).withFailureHandler(()=>{}).getLastUpdated();
        google.script.run.withSuccessHandler(r=>{
          if(r) {
            tabUpdatedTimes.value = {
              inventory: r.inventory || r.global || '',
              return: r.return || '',
              dead: r.dead || '',
              history: r.history || '',
              receive_history: r.receive_history || '',
              collabo_history: r.collabo_history || '',
              epi_delivery: r.epi_delivery || '',
            };
          }
        }).withFailureHandler(()=>{}).getAllLastUpdated();
        
        // URLパラメータのチェック（history=薬品名 で直接入出庫履歴を開く）
        const handleHistoryParam = (drugName) => {
          searchQuery.value = drugName;
          setTimeout(() => {
            openTransactionHistory({ name: drugName });
          }, 500);
        };

        if (window.INITIAL_HISTORY && !window.INITIAL_HISTORY.includes('initialHistory')) {
          handleHistoryParam(window.INITIAL_HISTORY);
        } else if(google.script.url && google.script.url.getLocation) {
          google.script.url.getLocation(function(location) {
            if (location && location.parameter && location.parameter.history) {
              handleHistoryParam(location.parameter.history);
            }
          });
        }
      }
      if (typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run.withSuccessHandler(data => {
          if(data && Array.isArray(data)) {
            const tempSet = new Set(enifSet.value);
            data.forEach(d => {
              if (d.name) tempSet.add(normalizeForSearch(d.name));
            });
            enifSet.value = tempSet;
          }
        }).withFailureHandler(()=>{}).get_enif_list();
      }
      loadMemos();
      loadUnmatchedData(); // 初回未読バッジ用
      document.getElementById('search')?.focus();
    });

    const triggerScrape = () => {
      if (isScraping.value) return;
      if (!confirm('クラウドから最新の在庫情報を取得しますか？\n（取得には約3〜5分かかります）')) return;
      
      isScraping.value = true;
      if (typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run
          .withSuccessHandler(res => {
            isScraping.value = false;
            if (res && res.status === 'success') {
              alert(res.message);
            } else {
              if (res && res.message && String(res.message).includes('404')) {
                alert('エラーが発生しました: ' + res.message + '\n\nGitHubの連携設定に問題があります。リポジトリが存在しないか、Tokenの設定(GITHUB_PAT)が誤っている可能性があります。');
              } else {
                alert('エラーが発生しました: ' + (res ? res.message : '不明なエラー'));
              }
            }
          })
          .withFailureHandler(err => {
            isScraping.value = false;
            alert('通信エラーが発生しました: ' + err.message);
          })
          .triggerGitHubWorkflow();
      } else {
        setTimeout(() => {
          isScraping.value = false;
          alert('ダミー: 在庫情報取得リクエストを送信しました');
        }, 1500);
      }
    };

    // 薬品名から後発品を判定する
    // 根拠: 厚労省規定により後発品の名称には必ず「会社名略称」が含まれる
    // 先発品はブランド名のみで「会社名」は含まない
    const GENERIC_COMPANY_PATTERNS = [
      'トーワ','サワイ','日医工','ニプロ','テバ','DSEP','JG','TCK','オーハラ',
      'クラシエ','アメル','科研','ケミファ','武田テバ','あすか','明治','フソー',
      'YD','KN','AFP','DK','EE','NIG','CMX','Me','NS','ILS','FFP','GE','HD',
      'タイヨー','日新','大興','杏林','日本化薬','センジュ','タカタ','イワキ',
      '東洋カプセル','共和','三和','辰巳','第一三共','長生堂','日本ジェネリック',
      'キョーリン','ファイザー','MED','マイラン','ヴィアトリス','SW','TYK',
      'CH','TC','KY','ST','NK','NP','TS','HK','KO','TTS','AA','ACE'
    ];
    const inferTypeFromName = (name) => {
      if (!name) return null;
      // 「○○」パターンを検索
      const matches = name.match(/「([^」]+)」/g);
      if (!matches) return null;
      for (const m of matches) {
        const inner = m.slice(1, -1); // 「」を除去
        if (GENERIC_COMPANY_PATTERNS.some(p => inner.includes(p))) {
          return '後発品';
        }
      }
      return null; // 判定不能の場合はDBの値をそのまま使う
    };
    const applyTypeCorrection = (items) => {
      items.forEach(r => {
        const inferred = inferTypeFromName(r.name || '');
        if (inferred) r.type = inferred;
        // 「」あり but 会社名リストに未登録の場合も後発品とみなす
        else if ((r.name || '').match(/「[^」]+」/)) r.type = '後発品';
      });
    };


    const supaUrl = 'https://jscqmecctsijqxihnxwi.supabase.co/rest/v1';
    const supaKey = 'sb_publishable_GbXD31EVyWQALFA5yV_akQ_8nVkebe5';
    const supaHeaders = { 
      'apikey': supaKey, 
      'Authorization': 'Bearer ' + supaKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    };

    const checkSystemHealth = async () => {
       try {
          const res = await fetch(supaUrl + '/inventory?yj_code=eq.SYS_HEALTH_001', {headers: supaHeaders});
          if(res.ok) {
             const data = await res.json();
             if(data.length > 0 && data[0].shelf) {
                const health = JSON.parse(data[0].shelf);
                const now = new Date();
                const nsipsTime = new Date(health.nsips_watcher || 0);
                const medorderTime = new Date(health.medorder_sync || 0);
                // If nsips is more than 2 hours old, or medorder is more than 3 hours old
                if ((now - nsipsTime) > 2 * 60 * 60 * 1000 || (now - medorderTime) > 3 * 60 * 60 * 1000) {
                   systemHealthStatus.value = 'error';
                } else {
                   systemHealthStatus.value = 'ok';
                }
             }
          }
       } catch(e) {
          console.error('Health check failed', e);
       }
    };
    checkSystemHealth();
    setInterval(checkSystemHealth, 5 * 60 * 1000); // Check every 5 mins

    const performSearch = async ()=>{
      if(!searchQuery.value.trim()) return;
      isLoading.value=true; errorMsg.value=''; hasSearched.value=true; lastSearchedQuery.value=searchQuery.value;
      try {
        const hiraToKata = str => str.replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60));
        const kataToHira = str => str.replace(/[\u30A1-\u30F6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
        
        const kws = searchQuery.value.trim().split(/[\s\u3000]+/).filter(k=>k).map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
        const andFilter = 'and=(' + kws.map(k => 'or(name.ilike.*' + encodeURIComponent(hiraToKata(k)) + '*,name.ilike.*' + encodeURIComponent(kataToHira(k)) + '*)').join(',') + ')';
        
        const [invRes, mhlwRes] = await Promise.all([
          fetch(supaUrl + '/inventory?' + andFilter + '&select=name,yj_code,stock,shelf,unit,type,price,oldest_stock', {headers: supaHeaders}),
          fetch(supaUrl + '/mhlw_supply?' + andFilter + '&select=yj_code,name,status', {headers: supaHeaders})
        ]);
        const primaryInv = await invRes.json();
        const mhlwData = await mhlwRes.json();

        const yjPrefixes = new Set();
        mhlwData.forEach(d => { if(d.yj_code) yjPrefixes.add(String(d.yj_code).substring(0,9)); });
        primaryInv.forEach(d => { if(d.yj_code) yjPrefixes.add(String(d.yj_code).substring(0,9)); });

        let altInv = [];
        let altMhlw = [];
        if(yjPrefixes.size > 0 && yjPrefixes.size < 50) {
          const orFilter = Array.from(yjPrefixes).map(p=>`yj_code.ilike.${p}*`).join(',');
          const [altRes, altMhlwRes] = await Promise.all([
            fetch(`${supaUrl}/inventory?or=(${orFilter})&select=name,yj_code,stock,shelf,unit,type,price,oldest_stock`, {headers: supaHeaders}),
            fetch(`${supaUrl}/mhlw_supply?or=(${orFilter})&select=yj_code,name,status`, {headers: supaHeaders})
          ]);
          altInv = await altRes.json();
          altMhlw = await altMhlwRes.json();
        }

        const finalResults = [];
        const pNames = new Set(primaryInv.map(i=>i.name));
        primaryInv.forEach(i => finalResults.push({...i, yjCode: i.yj_code, isPrimary:true}));
        
        const altNames = new Set();
        altInv.forEach(i => { 
          if(!pNames.has(i.name)) { 
            finalResults.push({...i, yjCode: i.yj_code, isPrimary:false}); 
            altNames.add(i.name); 
          } 
        });

        const localHitCount = primaryInv.length + altInv.length;
        if (localHitCount === 0) {
          mhlwData.sort((a,b) => a.name.length - b.name.length);
          const topMhlw = mhlwData.slice(0, 50);
          topMhlw.forEach(i => {
            if(!pNames.has(i.name) && !altNames.has(i.name)) {
              finalResults.push({ name: i.name, yj_code: i.yj_code, yjCode: i.yj_code, status: i.status, isPrimary: true, isNotRegistered: true, stock: '', shelf: '', unit: '' });
              pNames.add(i.name);
            }
          });

          if (topMhlw.length < 50) {
            altMhlw.sort((a,b) => a.name.length - b.name.length);
            const topAlt = altMhlw.slice(0, 50 - topMhlw.length);
            topAlt.forEach(i => {
              if(!pNames.has(i.name) && !altNames.has(i.name)) {
                finalResults.push({ name: i.name, yj_code: i.yj_code, yjCode: i.yj_code, status: i.status, isPrimary: false, isNotRegistered: true, stock: '', shelf: '', unit: '' });
                altNames.add(i.name);
              }
            });
          }
        }

        if(finalResults.length > 0) {
          const withYj = finalResults.filter(r => r.yj_code).map(r => `"${r.yj_code}"`);
          const sMap = {};
          
          if(withYj.length > 0) {
            const chunkSize = 30;
            for (let i = 0; i < withYj.length; i += chunkSize) {
              const chunk = withYj.slice(i, i + chunkSize);
              const yjStr = chunk.join(',');
              const sRes = await fetch(`${supaUrl}/mhlw_supply?yj_code=in.(${encodeURIComponent(yjStr)})&select=yj_code,status`, {headers: supaHeaders});
              if(sRes.ok) {
                const sData = await sRes.json();
                sData.forEach(s => sMap[s.yj_code] = s.status);
              }
            }
          }
          
          const cleanName = (name) => name.replace(/[★☆]/g, '').trim();
          const noYjNames = finalResults.filter(r => !r.yj_code).map(r => `"${cleanName(r.name)}"`);
          if(noYjNames.length > 0) {
            const chunkSize = 30;
            for (let i = 0; i < noYjNames.length; i += chunkSize) {
              const chunk = noYjNames.slice(i, i + chunkSize);
              const nStr = chunk.join(',');
              const sRes2 = await fetch(`${supaUrl}/mhlw_supply?name=in.(${encodeURIComponent(nStr)})&select=name,status`, {headers: supaHeaders});
              if(sRes2.ok) {
                const sData2 = await sRes2.json();
                sData2.forEach(s => sMap[s.name] = s.status);
              }
            }
          }

          finalResults.forEach(r => {
            let status = null;
            if (r.yj_code && sMap[r.yj_code]) status = sMap[r.yj_code];
            else if (sMap[cleanName(r.name)]) status = sMap[cleanName(r.name)];
            
            if (status) {
              r.supplyStatus = status.replace(/^[A-Z]/, '');
            } else {
              r.supplyStatus = '通常出荷';
            }
          });
        }
        applyTypeCorrection(finalResults);

        // ── 発注履歴との突合（発注済みバッジ） ──
        try {
          // historyDataが空の場合はGAS経由で取得を試みる
          if (historyData.value.length === 0 && !historyLoading.value) {
            await loadHistoryData(false);
          }
          if (historyData.value.length > 0) {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const recentOrders = historyData.value.filter(h => {
              const d = new Date(h.orderDate);
              return !isNaN(d.getTime()) && d >= sevenDaysAgo;
            });
            // 薬品名（正規化）→最新の発注情報 のマップ
            const orderMap = {};
            recentOrders.forEach(h => {
              const norm = normalizeForSearch(h.name);
              if (!orderMap[norm] || new Date(h.orderDate) > new Date(orderMap[norm].orderDate)) {
                orderMap[norm] = h;
              }
            });
            finalResults.forEach(r => {
              const norm = normalizeForSearch(r.name);
              const match = orderMap[norm];
              if (match) {
                r.isOrdered = true;
                r.orderDate = match.orderDate;
                r.orderSource = match.source;     // 'MedOrder' or 'OrderEPI'
                r.orderSupplier = match.supplier;
              }
            });
          }
        } catch(e) { console.warn('発注履歴突合エラー', e); }

        // ── 速報データを取得して付与 ──
        try {
          const today = new Date().toISOString().slice(0, 10);
          const todayStart = `${today}T00:00:00+09:00`;
          const sokuhoRes = await fetch(
            `${supaUrl}/transaction_history?transaction_type=eq.%E7%B4%8D%E5%93%81(%E9%80%9F%E5%A0%B1)&transaction_date=gte.${encodeURIComponent(todayStart)}&select=name,yj_code,qty_in,stock_balance`,
            {headers: supaHeaders}
          );
          if (sokuhoRes.ok) {
            const sokuhoData = await sokuhoRes.json();
            // 品名→最新速報レコード のマップ
            const sokuhoMap = {};
            sokuhoData.forEach(s => {
              if (s.yj_code && !sokuhoMap[s.yj_code]) sokuhoMap[s.yj_code] = s;
              if (s.name && !sokuhoMap[s.name]) sokuhoMap[s.name] = s;
            });
            finalResults.forEach(r => {
              const hit = (r.yj_code && sokuhoMap[r.yj_code]) ? sokuhoMap[r.yj_code] : sokuhoMap[r.name];
              if (hit && parseFloat(hit.qty_in) > 0) {
                r.sokuhoQty = hit.qty_in;  // 速報加算量
                // 速報前の在庫 = 現在stock - 速報加算量
                const currentStock = parseFloat(r.stock);
                if (!isNaN(currentStock)) {
                  const base = currentStock - parseFloat(hit.qty_in);
                  r.sokuhoBaseStock = Number.isInteger(base) ? base : Math.round(base * 100) / 100;
                }
              }
            });
          }
        } catch(e) { console.warn('速報データ取得失敗', e); }

        results.value = finalResults;
      } catch(e) {
        errorMsg.value = '検索中にエラー: ' + e;
      } finally {
        isLoading.value = false;
      }
    };
    const clearSearch = ()=>{searchQuery.value='';results.value=[];hasSearched.value=false;};
    
    const performSupplySearch = async (overrideYjCode = null)=>{
      if(!supplyQuery.value.trim() && !overrideYjCode) return;
      supplyIsLoading.value=true; supplyErrorMsg.value=''; supplyHasSearched.value=true; supplyLastSearchedQuery.value=supplyQuery.value;
      try {
        let primaryMhlw = [];
        if (typeof overrideYjCode === 'string' && overrideYjCode) {
            const yj = overrideYjCode.substring(0,9);
            const mhlwRes = await fetch(`${supaUrl}/mhlw_supply?yj_code=ilike.${yj}*&select=name,yj_code,status`, {headers: supaHeaders});
            primaryMhlw = await mhlwRes.json();
        } else {
            const hiraToKata = str => str.replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60));
            const kataToHira = str => str.replace(/[\u30A1-\u30F6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60));
            
            const kws = supplyQuery.value.trim().split(/[\s\u3000]+/).filter(k=>k).map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
            const andFilter = 'and=(' + kws.map(k => 'or(name.ilike.*' + encodeURIComponent(hiraToKata(k)) + '*,name.ilike.*' + encodeURIComponent(kataToHira(k)) + '*)').join(',') + ')';
            
            const mhlwRes = await fetch(supaUrl + '/mhlw_supply?' + andFilter + '&select=name,yj_code,status', {headers: supaHeaders});
            primaryMhlw = await mhlwRes.json();
        }

        primaryMhlw.sort((a,b)=>a.name.length - b.name.length);
        if(primaryMhlw.length > 100) primaryMhlw = primaryMhlw.slice(0, 100);

        const yjPrefixes = new Set();
        primaryMhlw.forEach(d => { if(d.yj_code) yjPrefixes.add(String(d.yj_code).substring(0,9)); });

        let altMhlw = [];
        if(yjPrefixes.size > 0 && yjPrefixes.size < 50) {
          const orFilter = Array.from(yjPrefixes).map(p=>`yj_code.ilike.${p}*`).join(',');
          const altRes = await fetch(`${supaUrl}/mhlw_supply?or=(${orFilter})&select=name,yj_code,status`, {headers: supaHeaders});
          const altData = await altRes.json();
          const pNames = new Set(primaryMhlw.map(i=>i.name));
          altData.forEach(d => { if(!pNames.has(d.name)) altMhlw.push(d); });
        }
        
        const finalResults = [];
        primaryMhlw.forEach(i => finalResults.push({
            ...i,
            yjCode: i.yj_code,
            isPrimary: true,
            supplyStatus: i.status ? i.status.replace(/^[A-Za-z]+[．.]/, '') : '通常出荷'
        }));
        altMhlw.forEach(i => finalResults.push({
            ...i,
            yjCode: i.yj_code,
            isPrimary: false,
            supplyStatus: i.status ? i.status.replace(/^[A-Za-z]+[．.]/, '') : '通常出荷'
        }));

        if(finalResults.length > 0) {
          const chunkSize = 30;
          for (let i = 0; i < finalResults.length; i += chunkSize) {
            const chunk = finalResults.slice(i, i + chunkSize);
            const nStr = chunk.map(r=>`"${r.name}"`).join(',');
            const iRes = await fetch(`${supaUrl}/inventory?name=in.(${encodeURIComponent(nStr)})&select=name,shelf,stock`, {headers: supaHeaders});
            if(iRes.ok) {
              const iData = await iRes.json();
              const iMap = {}; iData.forEach(s=>iMap[s.name]=s);
              chunk.forEach(r => {
                if(iMap[r.name]) { r.shelf = iMap[r.name].shelf; r.stock = iMap[r.name].stock; r.stockFound = true; }
                else { r.shelf = r.shelf || ''; r.stock = r.stock !== undefined ? r.stock : ''; r.stockFound = false; }
              });
            }
          }
        }
        supplyResults.value = finalResults;
      } catch(e) {
        supplyErrorMsg.value = '検索中にエラー: ' + e;
      } finally {
        supplyIsLoading.value = false;
      }
    };
    const clearSupplySearch = ()=>{supplyQuery.value='';supplyResults.value=[];supplyHasSearched.value=false;};

    // --- ソート機能 ---
    const supplySort = ref('normal_first'); // デフォルトを「通常出荷優先」に設定
    const supplySortOptions = [
      { label:'薬品名順', value:'name', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'通常出荷優先', value:'normal_first', icon:'fa-solid fa-truck-fast' },
      { label:'制限あり優先', value:'limited_first', icon:'fa-solid fa-triangle-exclamation' }
    ];
    const getSupplyStatusWeight = (status) => {
      if (!status) return 99;
      if (status.includes('通常出荷')) return 1;
      if (status.includes('限定出荷')) return 2;
      if (status.includes('出荷停止')) return 3;
      return 10;
    };
    const sortSupplyResults = (resultsArray) => {
      let d = [...resultsArray];
      if (supplySort.value === 'name') {
        d.sort((a,b) => (a.name||'').localeCompare(b.name||'','ja',{numeric:true}));
      } else if (supplySort.value === 'normal_first') {
        d.sort((a,b) => {
          const wA = getSupplyStatusWeight(a.supplyStatus);
          const wB = getSupplyStatusWeight(b.supplyStatus);
          if (wA !== wB) return wA - wB; // 1, 2, 3 の昇順
          return (a.name||'').localeCompare(b.name||'','ja',{numeric:true});
        });
      } else if (supplySort.value === 'limited_first') {
        d.sort((a,b) => {
          const wA = getSupplyStatusWeight(a.supplyStatus);
          const wB = getSupplyStatusWeight(b.supplyStatus);
          if (wA !== wB) return wB - wA; // 3, 2, 1 の降順
          return (a.name||'').localeCompare(b.name||'','ja',{numeric:true});
        });
      }
      return d;
    };

    const primarySupplyResults = computed(() => sortSupplyResults(supplyResults.value.filter(r=>r.isPrimary)));
    const alternativeSupplyResults = computed(() => sortSupplyResults(supplyResults.value.filter(r=>!r.isPrimary)));
    const primaryResults = computed(()=>results.value.filter(r=>r.isPrimary));
    const alternativeResults = computed(()=>results.value.filter(r=>!r.isPrimary));
    const lowStockCount = computed(()=>results.value.filter(r=>isLowStock(r.stock)).length);

    const switchToSupplyTab = () => {
      activeTab.value = 'supply';
      if (searchQuery.value.trim() && (supplyQuery.value !== searchQuery.value || !supplyHasSearched.value)) {
        supplyQuery.value = searchQuery.value;
        performSupplySearch();
      }
    };

    const searchSupplyFromBadge = (item) => {
      if (!item) return;
      activeTab.value = 'supply';
      
      const match = item.name.match(/^([^A-Za-z0-9０-９]+)/);
      supplyQuery.value = searchQuery.value || (match ? match[1].trim() : item.name);
      
      const yj = item.yjCode || item.yj_code;
      if (yj) {
        performSupplySearch(yj);
      } else {
        performSupplySearch();
      }
    };

    const switchToShelfTab = ()=>{activeTab.value='shelf';if(shelfData.value.length===0) loadShelfData();};
    const loadShelfData = async () => {
      shelfLoading.value = true;
      shelfError.value = '';
      try {
        const fallbackToGas = () => {
          google.script.run
            .withSuccessHandler(d => { shelfData.value = d || []; shelfLoading.value = false; })
            .withFailureHandler(e => { shelfError.value = 'エラー: ' + e; shelfLoading.value = false; })
            .getShelfSummary();
        };

        const checkRes = await fetch(`${supaUrl}/inventory?select=updated_at&order=updated_at.desc&limit=1`, { headers: supaHeaders });
        if (!checkRes.ok) throw new Error('Supabase check failed');
        const checkData = await checkRes.json();
        const latestUpdated = checkData.length > 0 ? checkData[0].updated_at : null;
        
        let cachedData = null;
        try {
          const cachedStr = localStorage.getItem('inv_cache');
          const cachedMeta = localStorage.getItem('inv_cache_meta');
          if (cachedStr && cachedMeta === latestUpdated) {
            cachedData = JSON.parse(cachedStr);
          }
        } catch(e){}

        let inventoryList = cachedData;
        
        if (!inventoryList) {
          let allData = [];
          let offset = 0;
          const limit = 1000;
          const selectCols = 'name,stock,unit,shelf,yj_code,price,oldest_stock,type';
          
          while(true) {
            const res = await fetch(`${supaUrl}/inventory?select=${selectCols}&limit=${limit}&offset=${offset}`, { headers: supaHeaders });
            if (!res.ok) throw new Error('Supabase fetch failed');
            const batch = await res.json();
            if (!batch || batch.length === 0) break;
            
            const formattedBatch = batch.map(row => ({
              name: row.name || '',
              stock: row.stock || '',
              unit: row.unit || '',
              shelf: row.shelf || '',
              yjCode: row.yj_code || '',
              price: row.price || '',
              oldestStock: row.oldest_stock || '',
              type: row.type || ''
            }));
            allData = allData.concat(formattedBatch);
            
            if (batch.length < limit) break;
            offset += limit;
          }
          
          inventoryList = allData;
          try {
            localStorage.setItem('inv_cache', JSON.stringify(inventoryList));
            if (latestUpdated) localStorage.setItem('inv_cache_meta', latestUpdated);
          } catch(e){}
        }
        shelfData.value = inventoryList;
        shelfLoading.value = false;
      } catch (err) {
        console.warn('Supabase fetch failed, falling back to GAS', err);
        google.script.run
          .withSuccessHandler(d => { shelfData.value = d || []; shelfLoading.value = false; })
          .withFailureHandler(e => { shelfError.value = 'エラー: ' + e; shelfLoading.value = false; })
          .getShelfSummary();
      }
    };
    const switchToAlertTab = ()=>{activeTab.value='alert';if(shelfData.value.length===0) loadShelfData();};

    const rdSubTab = Vue.ref('return');
    const expirySubTab = Vue.ref('expired');
    const expiryFilterStr = Vue.ref('');
    const rdSortOptions = [
      { label:'棚番順', value:'shelf', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬品名順', value:'name', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬価順', value:'price', icon:'fa-solid fa-arrow-down-9-1' },
      { label:'購入日順', value:'purchaseDate', icon:'fa-solid fa-calendar-days' },
      { label:'卸名順', value:'supplier', icon:'fa-solid fa-truck' }
    ];
    const expirySortOptions = [
      { label:'使用期限順', value:'expiry', icon:'fa-solid fa-calendar-times' },
      { label:'棚番順', value:'shelf', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬品名順', value:'name', icon:'fa-solid fa-arrow-down-a-z' },
      { label:'薬価順', value:'price', icon:'fa-solid fa-arrow-down-9-1' }
    ];
    const expirySort = Vue.ref('expiry');

    const switchToReturnDeadTab = ()=>{
      activeTab.value='returnDead';
      if(returnData.value.length===0) loadReturnData();
      if(deadData.value.length===0) loadDeadData();
    };
    const loadReturnData = ()=>{returnLoading.value=true;returnError.value='';google.script.run.withSuccessHandler(d=>{returnData.value=d||[];returnLoading.value=false;}).withFailureHandler(e=>{returnError.value='エラー: '+e;returnLoading.value=false;}).getReturnData();};
    const filteredReturnData = computed(()=>{
      let d=[...returnData.value];
      if(returnFilterStr.value){const f=returnFilterStr.value.toLowerCase();d=d.filter(i=>(i.name||'').toLowerCase().includes(f)||(i.shelf||'').toLowerCase().includes(f));}
      if(returnSort.value==='shelf') d.sort((a,b)=>{const iA=shelfOrderIndex(a.shelf),iB=shelfOrderIndex(b.shelf);if(iA!==iB) return iA-iB;return a.shelf.localeCompare(b.shelf,'ja',{numeric:true,sensitivity:'base'});});
      else if(returnSort.value==='name') d.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja',{numeric:true}));
      else if(returnSort.value==='price') d.sort((a,b)=>b.price-a.price);
      else if(returnSort.value==='stockValue') d.sort((a,b)=>b.stockValue-a.stockValue);
      else if(returnSort.value==='purchaseDate') d.sort((a,b)=>new Date(b.lastPurchaseDate||0).getTime()-new Date(a.lastPurchaseDate||0).getTime());
      else if(returnSort.value==='supplier') d.sort((a,b)=>(a.supplier||'').localeCompare(b.supplier||'','ja',{numeric:true}));
      return d;
    });

    const loadDeadData = async ()=>{
      deadLoading.value=true;
      deadError.value='';
      try {
        // Fetch Dead Stock metadata
        const metaRes = await fetch(supaUrl + '/inventory?yj_code=eq.SYS_DEAD_STOCK', {headers: supaHeaders});
        if(!metaRes.ok) throw new Error("Metadata fetch failed");
        const metaJson = await metaRes.json();
        
        let dead = [];
        if(metaJson.length > 0 && metaJson[0].shelf) {
           const parsed = JSON.parse(metaJson[0].shelf);
           if(parsed.dead_items) {
               dead = parsed.dead_items;
           }
        }


        // Fetch GAS Data for LOT, Supplier, Last Purchase Date enrichment
        const getGasDeadData = () => new Promise(resolve => {
          if (typeof google === 'undefined' || !google.script || !google.script.run) { resolve([]); return; }
          google.script.run.withSuccessHandler(d => resolve(d||[])).withFailureHandler(() => resolve([])).getDeadData();
        });
        const gasDeadData = await getGasDeadData();
        const gasMap = {};
        gasDeadData.forEach(g => { gasMap[g.name] = g; });
        
        // Enrich
        const enriched = dead.map(item => {
           let price = parseFloat(item.price) || 0;
           let extra = gasMap[item.name] || {};
           return {
               ...item,
               price: price,
               stockValue: price * parseFloat(item.stock),
               lot: extra.lot || '',
               supplier: extra.supplier || '',
               lastPurchaseDate: extra.lastPurchaseDate || ''
           };
        });
        
        deadData.value = enriched;
      } catch (err) {
        deadError.value = 'エラー: ' + err.message;
      } finally {
        deadLoading.value = false;
      }
    };
    const filteredDeadData = computed(()=>{
      let d=[...deadData.value];
      if(deadFilterStr.value){const f=deadFilterStr.value.toLowerCase();d=d.filter(i=>(i.name||'').toLowerCase().includes(f)||(i.shelf||'').toLowerCase().includes(f));}
      if(deadSort.value==='shelf') d.sort((a,b)=>{const iA=shelfOrderIndex(a.shelf),iB=shelfOrderIndex(b.shelf);if(iA!==iB) return iA-iB;return a.shelf.localeCompare(b.shelf,'ja',{numeric:true,sensitivity:'base'});});
      else if(deadSort.value==='name') d.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja',{numeric:true}));
      else if(deadSort.value==='price') d.sort((a,b)=>b.price-a.price);
      else if(deadSort.value==='stockValue') d.sort((a,b)=>b.stockValue-a.stockValue);
      else if(deadSort.value==='purchaseDate') d.sort((a,b)=>new Date(b.lastPurchaseDate||0).getTime()-new Date(a.lastPurchaseDate||0).getTime());
      else if(deadSort.value==='supplier') d.sort((a,b)=>(a.supplier||'').localeCompare(b.supplier||'','ja',{numeric:true}));
      return d;
    });

    const expiryLoading = Vue.ref(false);
    const expiryError = Vue.ref('');
    const expiryExpiredItems = Vue.ref([]);
    const expiryNearItems = Vue.ref([]);

    const loadExpiryData = ()=>{
      expiryLoading.value=true; expiryError.value='';
      google.script.run
        .withSuccessHandler(r=>{
          if(r.error){ expiryError.value=r.error; expiryLoading.value=false; return; }
          expiryExpiredItems.value = r.expired || [];
          expiryNearItems.value = r.nearExpiry || [];
          expiryLoading.value=false;
        })
        .withFailureHandler(e=>{ expiryError.value='エラー: '+e; expiryLoading.value=false; })
        .getExpiryData();
    };

    const filteredExpiryItems = computed(()=>{
      const source = expirySubTab.value==='expired' ? expiryExpiredItems.value : expiryNearItems.value;
      let d=[...source];
      if(expiryFilterStr.value){const f=expiryFilterStr.value.toLowerCase();d=d.filter(i=>(i.name||'').toLowerCase().includes(f)||(i.shelf||'').toLowerCase().includes(f));}
      if(expirySort.value==='expiry') d.sort((a,b)=>{
        const da=a.expiryDate?new Date(a.expiryDate.replace(/\//g,'-')):new Date(9999,0,1);
        const db=b.expiryDate?new Date(b.expiryDate.replace(/\//g,'-')):new Date(9999,0,1);
        return da-db;
      });
      else if(expirySort.value==='shelf') d.sort((a,b)=>{const iA=shelfOrderIndex(a.shelf),iB=shelfOrderIndex(b.shelf);if(iA!==iB) return iA-iB;return (a.shelf||'').localeCompare(b.shelf||'','ja',{numeric:true,sensitivity:'base'});});
      else if(expirySort.value==='name') d.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ja',{numeric:true}));
      else if(expirySort.value==='price') d.sort((a,b)=>(b.price||0)-(a.price||0));
      return d;
    });
    const switchToExpiryTab = ()=>{ activeTab.value='expiry'; if(expiryExpiredItems.value.length===0&&expiryNearItems.value.length===0&&!expiryLoading.value) loadExpiryData(); };

    const switchToLiveTab = ()=>{activeTab.value='live';if(liveData.value.length===0) loadLiveData(1);};
    const loadLiveData = (page)=>{liveLoading.value=true;liveError.value='';google.script.run.withSuccessHandler(r=>{if(r.error){liveError.value=r.error;}else{liveData.value=r.items||[];liveTotalCount.value=r.totalCount||0;liveTotalPages.value=r.totalPages||1;livePage.value=page;}liveLoading.value=false;}).withFailureHandler(e=>{liveError.value='API接続エラー: '+e;liveLoading.value=false;}).getLiveStocks(page);};
    const filteredLiveData = computed(()=>{if(!liveFilterStr.value) return liveData.value;const f=liveFilterStr.value.toLowerCase();return liveData.value.filter(i=>(i.name&&i.name.toLowerCase().includes(f))||(i.yj_code&&i.yj_code.includes(f)));});
    const liveNextPage = ()=>{if(livePage.value<liveTotalPages.value) loadLiveData(livePage.value+1);};
    const livePrevPage = ()=>{if(livePage.value>1) loadLiveData(livePage.value-1);};

    const pendingData     = ref([]);
    const pendingLoading  = ref(false);
    const pendingError    = ref('');
    const pendingFilterStr= ref('');
    
    const loadPendingData = (force) => {
      if(!force && pendingData.value.length>0) return;
      pendingLoading.value = true; pendingError.value = '';
      if(typeof google!=='undefined'&&google.script&&google.script.run) {
        google.script.run
          .withSuccessHandler(d => { pendingData.value = d||[]; pendingLoading.value=false; })
          .withFailureHandler(e => { pendingError.value = 'エラー: '+(e.message||e); pendingLoading.value=false; })
          .getPendingDeliveries();
      } else {
        setTimeout(() => {
          pendingData.value = [
             {"品名": "テスト薬1", "卸名": "Medipal", "ステータス": "出荷調整", "数量": "2"},
             {"品名": "テスト薬2", "卸名": "Alf", "ステータス": "入荷未定", "数量": "5"}
          ];
          pendingLoading.value = false;
        }, 500);
      }
    };
    const switchToPendingTab = () => { activeTab.value = 'pending'; loadPendingData(false); };
    const filteredPendingData = computed(() => {
      let d = [...pendingData.value];
      if(pendingFilterStr.value) {
        const q = pendingFilterStr.value.toLowerCase();
        d = d.filter(i => (i['品名']||i.name||'').toLowerCase().includes(q) || (i['卸名']||i.supplier||'').toLowerCase().includes(q));
      }
      return d;
    });

    const groupedPendingData = computed(() => {
      const groups = {};
      for (const item of filteredPendingData.value) {
        const sup = item['卸名'] || item.supplier || '未分類';
        if (!groups[sup]) groups[sup] = [];
        groups[sup].push(item);
      }
      return Object.keys(groups).map(k => ({ supplier: k, items: groups[k] }));
    });

    const minusLoading = ref(false); const minusError = ref(''); const minusItems = ref([]); const minusOrderFilter = ref('');
    const switchToMinusTab = ()=>{activeTab.value='minus';if(minusItems.value.length===0&&!minusLoading.value) loadMinusData();};
    const loadMinusData = async () => {
      minusLoading.value = true;
      minusError.value = '';
      try {
        const res = await fetch(supaUrl + '/minus_ledger?select=*&status=not.eq.復旧確認済み（入庫）', { headers: supaHeaders });
        if (!res.ok) throw new Error('HTTP Error ' + res.status);
        let items = await res.json();
        
        if (items.length > 0) {
          try {
            const chunkSize = 30;
            const sMap = {};
            for (let i = 0; i < items.length; i += chunkSize) {
              const chunk = items.slice(i, i + chunkSize);
              const nStr = chunk.map(it => '"' + it.name.replace(/"/g, '\\"') + '"').join(',');
              const iRes = await fetch(supaUrl + '/inventory?name=in.(' + encodeURIComponent(nStr) + ')&select=name,stock', { headers: supaHeaders });
              if (iRes.ok) {
                const iData = await iRes.json();
                iData.forEach(s => { sMap[s.name] = parseFloat(s.stock); });
              }
            }
            items = items.filter(it => {
              if (sMap[it.name] !== undefined) {
                if (sMap[it.name] >= 0) return false; // リアルタイム在庫が0以上ならマイナス台帳から非表示にする
                it.quantity = sMap[it.name];
              }
              return true;
            });
          } catch(e) { console.error('Supabase check error', e); }
        }

        // 直近（過去7日）の発注履歴マップを作成
        try {
          if (historyData.value.length === 0 && !historyLoading.value) {
            await loadHistoryData(false);
          }
        } catch(e) {}

        const orderMap = {};
        if (historyData.value.length > 0) {
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const recentOrders = historyData.value.filter(h => {
            const d = new Date(h.orderDate);
            return !isNaN(d.getTime()) && d >= sevenDaysAgo;
          });
          recentOrders.forEach(h => {
            const norm = normalizeForSearch(h.name);
            if (!orderMap[norm] || new Date(h.orderDate) > new Date(orderMap[norm].orderDate)) {
              orderMap[norm] = h;
            }
          });
        }
        
        // 互換性のためキーをマッピング、及び発注履歴との突合
        items.forEach(item => {
          item.isOrdered = item.is_ordered;
          item.orderStatus = item.status;
          item.deliveryDate = item.delivery_date;

          const norm = normalizeForSearch(item.name);
          const match = orderMap[norm];
          if (match) {
            item.isOrdered = true;
            item.orderDate = match.orderDate;
            item.orderSource = match.source;
            item.orderSupplier = match.supplier;
          }
        });

        minusItems.value = items;
      } catch (err) {
        minusError.value = 'API接続エラー: ' + err.message;
      } finally {
        minusLoading.value = false;
      }
    };
    const minusData = computed(()=>minusItems.value);
    const filteredMinusData = computed(()=>{
      if (!minusOrderFilter.value) return minusItems.value;
      if (minusOrderFilter.value === 'ordered') return minusItems.value.filter(i=>i.isOrdered);
      if (minusOrderFilter.value === 'unordered') return minusItems.value.filter(i=>!i.isOrdered);
      return minusItems.value;
    });
    const minusOrderedCount = computed(()=>minusItems.value.filter(i=>i.isOrdered).length);
    const minusUnorderedCount = computed(()=>minusItems.value.filter(i=>!i.isOrdered).length);

    // ── 未登録薬品（メンテナンス）関連メソッド ──
    const unmatchedData = computed(() => unmatchedItems.value);
    
    const switchToUnmatchedTab = () => {
      activeTab.value = 'unmatched';
      loadUnmatchedData();
    };

    const loadUnmatchedData = async () => {
      unmatchedLoading.value = true;
      unmatchedError.value = '';
      try {
        const res = await fetch(supaUrl + '/unmatched_ledger?select=*&order=last_scanned_at.desc', { headers: supaHeaders });
        if (!res.ok) throw new Error('Supabase data fetch failed');
        const data = await res.json();
        unmatchedItems.value = data || [];
        selectedUnmatchedItems.value = []; // データ読み込み時に選択リセット
      } catch (err) {
        unmatchedError.value = 'ログ取得エラー: ' + err.message;
      } finally {
        unmatchedLoading.value = false;
      }
    };

    const openAddUnmatchedModal = (item) => {
      // 会社名略称を含むかによる先発後発タイプの簡易推測
      let inferredType = '';
      const inferred = inferTypeFromName(item.raw_name);
      if (inferred) {
        inferredType = inferred;
      } else if (item.raw_name.includes('「')) {
        inferredType = '後発品';
      }

      unmatchedForm.value = {
        id: item.id,
        name: item.raw_name,
        yjCode: item.yj_code || '',
        shelf: '',
        unit: '個',
        type: inferredType
      };
      addUnmatchedModalOpen.value = true;
    };

    const submitAddUnmatched = () => {
      if (!unmatchedForm.value.name.trim()) {
        alert('薬品名を入力してください');
        return;
      }
      isSubmittingUnmatched.value = true;
      
      const payloadParams = {
        name: unmatchedForm.value.name,
        yjCode: unmatchedForm.value.yjCode,
        shelf: unmatchedForm.value.shelf,
        unit: unmatchedForm.value.unit,
        type: unmatchedForm.value.type
      };

      if (typeof google !== 'undefined' && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(async (res) => {
            if (res.status === 'success') {
              try {
                // Supabase unmatched_ledger から削除
                const delRes = await fetch(supaUrl + '/unmatched_ledger?id=eq.' + unmatchedForm.value.id, {
                  method: 'DELETE',
                  headers: supaHeaders
                });
                if (!delRes.ok) throw new Error('DELETE failed');
                
                unmatchedItems.value = unmatchedItems.value.filter(it => it.id !== unmatchedForm.value.id);
                addUnmatchedModalOpen.value = false;
                alert('在庫マスタに追記し、未登録リストから除外しました！');
              } catch (e) {
                console.error(e);
                alert('スプレッドシートへの追加は完了しましたが、Supabaseからの削除に失敗しました: ' + e.message);
                addUnmatchedModalOpen.value = false;
              }
            } else {
              alert('追加エラー: ' + res.message);
            }
            isSubmittingUnmatched.value = false;
          })
          .withFailureHandler((err) => {
            alert('通信エラー: ' + err.message);
            isSubmittingUnmatched.value = false;
          })
          .addUnmatchedMedicineToInventory(payloadParams);
      } else {
        // ローカルデバッグモードのモック動作
        setTimeout(async () => {
          try {
            // Supabase 側の DELETE
            const delRes = await fetch(supaUrl + '/unmatched_ledger?id=eq.' + unmatchedForm.value.id, {
              method: 'DELETE',
              headers: supaHeaders
            });
            if (delRes.ok) {
              unmatchedItems.value = unmatchedItems.value.filter(it => it.id !== unmatchedForm.value.id);
              addUnmatchedModalOpen.value = false;
              alert('[デバッグモード] マスタへ追加しました（SupabaseからDELETE完了）');
            } else {
              throw new Error('Supabase DELETE failed');
            }
          } catch(e) {
            alert('Supabaseからの削除に失敗しました: ' + e.message);
            addUnmatchedModalOpen.value = false;
          }
          isSubmittingUnmatched.value = false;
        }, 1000);
      }
    };

    const excludeNoise = async (item) => {
      if (!confirm('この薬品「' + item.raw_name + '」を未登録リストから完全に除外しますか？\n（在庫マスタには追加されません）')) return;
      try {
        const delRes = await fetch(supaUrl + '/unmatched_ledger?id=eq.' + item.id, {
          method: 'DELETE',
          headers: supaHeaders
        });
        if (delRes.ok) {
          unmatchedItems.value = unmatchedItems.value.filter(it => it.id !== item.id);
          alert('除外しました。');
        } else {
          throw new Error('DELETE failed');
        }
      } catch (e) {
        alert('除外に失敗しました: ' + e.message);
      }
    };
    
    const selectAllUnmatched = computed({
      get: () => unmatchedItems.value.length > 0 && selectedUnmatchedItems.value.length === unmatchedItems.value.length,
      set: (val) => {
        if (val) {
          selectedUnmatchedItems.value = unmatchedItems.value.map(item => item.id);
        } else {
          selectedUnmatchedItems.value = [];
        }
      }
    });

    const bulkExcludeNoise = async () => {
      if (selectedUnmatchedItems.value.length === 0) return;
      if (!confirm(`選択した ${selectedUnmatchedItems.value.length} 件の薬品を未登録リストから完全に除外しますか？\n（在庫マスタには追加されません）`)) return;
      
      try {
        const ids = selectedUnmatchedItems.value.join(',');
        const delRes = await fetch(`${supaUrl}/unmatched_ledger?id=in.(${ids})`, {
          method: 'DELETE',
          headers: supaHeaders
        });
        if (delRes.ok) {
          unmatchedItems.value = unmatchedItems.value.filter(it => !selectedUnmatchedItems.value.includes(it.id));
          selectedUnmatchedItems.value = [];
          alert('選択した項目を除外しました。');
        } else {
          throw new Error('DELETE failed');
        }
      } catch (e) {
        alert('一括除外に失敗しました: ' + e.message);
      }
    };

    const openOrderEpi = async (itemName) => {
      if (!itemName) return;
      const searchKeyword = normalizeForSearch(itemName);
      try {
        if (navigator.clipboard) await navigator.clipboard.writeText(searchKeyword);
      } catch (err) { console.error(err); }
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) {
        window.location.href = "orderepi://";
      } else {
        window.open("https://www.order-epi.com/order/?mq=" + encodeURIComponent(searchKeyword), "_blank");
      }
    };

    const tokenRefreshState = ref('idle'); // idle | requesting | done | error

    const requestTokenRefresh = () => {
      if (tokenRefreshState.value === 'requesting' || tokenRefreshState.value === 'done') return;
      tokenRefreshState.value = 'requesting';
      google.script.run
        .withSuccessHandler((result) => {
          tokenRefreshState.value = 'done';
          setTimeout(() => { tokenRefreshState.value = 'idle'; }, 6000);
        })
        .withFailureHandler((err) => {
          console.error('Token refresh request failed:', err);
          tokenRefreshState.value = 'error';
          setTimeout(() => { tokenRefreshState.value = 'idle'; }, 5000);
        })
        .requestTokenRefreshFromUI();
    };

    const openTohoEnif = (itemName) => {
      if (!itemName) return;

      const searchKeyword = normalizeForSearch(itemName);
      try {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(searchKeyword).catch(e=>console.error(e));
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = searchKeyword;
          textArea.style.position = "fixed";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try { document.execCommand('copy'); } catch (err) {}
          document.body.removeChild(textArea);
        }
      } catch (err) {}
      window.open("https://i-enif.tohoyk.co.jp/webhis/Home/Hm10Login?mq=" + encodeURIComponent(searchKeyword), "_blank");
    };

    const openOrderMedorder = async (itemName) => {
      if (!itemName) return;
      const searchKeyword = normalizeForSearch(itemName);
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(searchKeyword);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = searchKeyword;
          textArea.style.position = "fixed";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try { document.execCommand('copy'); } catch (err) { console.error('Fallback copy failed', err); }
          document.body.removeChild(textArea);
        }
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
      window.open("https://app.medorder.jp/pharmacies/20/order#add?mq=" + encodeURIComponent(searchKeyword), "_blank");
    };


    const openTransactionHistory = async (item) => {
      histModalItem.value = item;
      histModalOpen.value = true;
      histModalLoading.value = true;
      histModalError.value = '';
      histModalData.value = [];
      histModalTab.value = 'all';
      try {
        const base = supaUrl + '/transaction_history?order=transaction_date.desc&limit=50';
        let data = [];
        
        if (item.yjCode || item.yj_code) {
          const res = await fetch(base + '&yj_code=eq.' + encodeURIComponent(item.yjCode || item.yj_code), { headers: supaHeaders });
          if (res.ok) data = await res.json();
        }
        
        // YJコードでヒットしない場合、またはYJコードがない場合は薬品名でフォールバック検索
        if (data.length === 0 && item.name) {
          const resName = await fetch(base + '&name=eq.' + encodeURIComponent(item.name), { headers: supaHeaders });
          if (resName.ok) data = await resName.json();
        }
        
        histModalData.value = data;
      } catch(e) {
        histModalError.value = e.message;
      } finally {
        histModalLoading.value = false;
      }
    };

    const normalizeForSearch = (name) => {
      if (!name) return "";
      let n = name.replace(/^[\(（].*?[\)）]\s*/, "");
      n = n.replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
      
      const match = n.match(/^(.*?(?:\d+(?:\.\d+)?(?:mg|μg|mcg|%|g|mL|ml|kg)))(.*)$/);
      if (match) {
        const base = match[1];
        const rest = match[2];
        const makerMatch = rest.match(/「.*?」/);
        if (makerMatch) {
          n = base + makerMatch[0];
        } else {
          n = base;
        }
      }
      
      n = n.replace(/[\s\u3000]/g, '');
      return n.normalize('NFKC');
    };

    // ── 一括更新 ──
    const reloadAllData = () => {
      if (isReloadingAll.value) return;
      isReloadingAll.value = true;
      let completed = 0;
      const totalTasks = 6; // マイナス在庫はタブ開時のみ取得（遅延ロード）
      const checkDone = () => { completed++; if (completed >= totalTasks) {
        isReloadingAll.value = false;
        // タブ別更新日時を再取得
        if (typeof google!=='undefined'&&google.script&&google.script.run) {
          google.script.run.withSuccessHandler(r=>{
            if(r&&r.time) lastUpdated.value=r.time;
          }).withFailureHandler(()=>{}).getLastUpdated();
          google.script.run.withSuccessHandler(r=>{
            if(r) {
              tabUpdatedTimes.value = {
                inventory: r.inventory || r.global || '',
                return: r.return || '',
                dead: r.dead || '',
                history: r.history || '',
                receive_history: r.receive_history || '',
                collabo_history: r.collabo_history || '',
                epi_delivery: r.epi_delivery || '',
              };
            }
          }).withFailureHandler(()=>{}).getAllLastUpdated();
        }
      }};

      if (typeof google!=='undefined'&&google.script&&google.script.run) {
        // 棚番 (在庫)
        loadShelfData().then(checkDone).catch(checkDone);
        // 返品
        google.script.run.withSuccessHandler(d=>{ returnData.value=d||[]; checkDone(); }).withFailureHandler(()=>{ checkDone(); }).getReturnData();
        // 不動
        google.script.run.withSuccessHandler(d=>{ deadData.value=d||[]; checkDone(); }).withFailureHandler(()=>{ checkDone(); }).getDeadData();
        // 発注履歴
        google.script.run.withSuccessHandler(d=>{ historyData.value=d||[]; checkDone(); }).withFailureHandler(()=>{ checkDone(); }).getOrderHistory();
        // 未納未定
        google.script.run.withSuccessHandler(d=>{ pendingData.value=d||[]; checkDone(); }).withFailureHandler(()=>{ checkDone(); }).getPendingDeliveries();
        // 納品履歴
        google.script.run.withSuccessHandler(d=>{ receiveData.value=d||[]; checkDone(); }).withFailureHandler(()=>{ checkDone(); }).getReceiveHistoryData();
        // マイナス在庫: タブを開いたときのみ loadMinusData() で取得（遅延ロード）
        // 起動時に取得すると GAS 呼び出し数が増え、表示遅延の原因になるため除外。
      } else {
        isReloadingAll.value = false;
        alert('ダミーモード: 一括更新は実行できません');
      }
    };

    // ── データ鮮度チェック ──
    const isDataStale = computed(() => {
      const inv = tabUpdatedTimes.value.inventory;
      if (!inv) return false; // まだ読み込み中
      // 'yyyy/MM/dd HH:mm' 形式をパース
      const d = new Date(inv.replace(/\//g, '-'));
      if (isNaN(d.getTime())) return false;
      const diffMs = Date.now() - d.getTime();
      return diffMs > 2 * 60 * 60 * 1000; // 2時間以上
    });
    const staleHoursText = computed(() => {
      const inv = tabUpdatedTimes.value.inventory;
      if (!inv) return '';
      const d = new Date(inv.replace(/\//g, '-'));
      if (isNaN(d.getTime())) return '';
      const diffMs = Date.now() - d.getTime();
      const hours = Math.floor(diffMs / (60 * 60 * 1000));
      if (hours < 1) return Math.floor(diffMs / (60 * 1000)) + '分前';
      if (hours < 24) return hours + '時間前';
      return Math.floor(hours / 24) + '日前';
    });

    return {
      activeTab, searchQuery, lastSearchedQuery, results, isLoading, hasSearched, errorMsg, lastUpdated, systemHealthStatus, lowStockThreshold, tabUpdatedTimes,
      supplyQuery, supplyLastSearchedQuery, supplyResults, supplyIsLoading, supplyHasSearched, supplyErrorMsg, performSupplySearch, clearSupplySearch,
      primarySupplyResults, alternativeSupplyResults, supplySort, supplySortOptions, switchToSupplyTab, searchSupplyFromBadge,
      isScraping, triggerScrape, isReloadingAll, reloadAllData,
      performSearch, clearSearch, primaryResults, alternativeResults, lowStockCount, isLowStock,
      normalizeUnit, convertEyedrop,
      switchToReturnDeadTab, rdSubTab, returnData, returnLoading, returnError, returnFilterStr, filteredReturnData, returnSort,
      deadData, deadLoading, deadError, deadFilterStr, filteredDeadData, deadSort, rdSortOptions,
      switchToExpiryTab, expirySubTab, expirySort, expiryFilterStr, expirySortOptions,
      expiryLoading, expiryError, loadExpiryData,
      expiryExpiredItems, expiryNearItems, filteredExpiryItems,
      switchToHistoryTab, historyData, historyLoading, historyError,
      switchToReceiveTab, receiveData, receiveLoading, receiveError, receiveFilterStr, filteredReceiveData, loadReceiveData, toggleReceiveGroup,
      switchToPendingTab, pendingData, pendingLoading, pendingError, pendingFilterStr, filteredPendingData, groupedPendingData, loadPendingData,
      historySystem, historySupplier, historyStatus, historyFilterStr, historySort, historySortOptions,
      filteredHistoryData, historyFilteredTotal, medorderCount, orderepiCount,
      loadHistoryData, supplierBadgeClass, statusBadgeClass, formatHistoryDate, formatPendingDate,
      switchToMinusTab, loadMinusData, minusData, minusLoading, minusError,
      filteredMinusData, minusOrderFilter, minusOrderedCount, minusUnorderedCount,
      genericSortOptions, openOrderEpi, openOrderMedorder, openTohoEnif, normalizeForSearch,
      memos, editingMemo, editingMemoText, memoSaving, loadMemos, toggleMemoEdit, saveMemoAction,
      isDataStale, staleHoursText, isEnifTarget,
      tokenRefreshState, requestTokenRefresh,
      histModalOpen, histModalItem, histModalData, histModalLoading, histModalError, openTransactionHistory, histModalTab, filteredHistModalData, inHistCount, outHistCount, otherHistCount, adjustModalOpen, adjustModalItem, adjustStockValue, isAdjusting, openAdjustModal, submitAdjustment,
      unmatchedItems, unmatchedLoading, unmatchedError, addUnmatchedModalOpen, isSubmittingUnmatched, unmatchedForm, unmatchedData, switchToUnmatchedTab, loadUnmatchedData, openAddUnmatchedModal, submitAddUnmatched, excludeNoise, selectedUnmatchedItems, selectAllUnmatched, bulkExcludeNoise,
    };
  }
}).mount('#app');
