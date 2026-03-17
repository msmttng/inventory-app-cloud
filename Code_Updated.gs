/**
 * 薬の在庫・棚番検索アプリ (Google Apps Script バックエンド)
 * ユーザーがスプレッドシートを開き、「拡張機能」>「Apps Script」にこのコードを貼り付けてデプロイします。
 */

// スプレッドシートのシート名を指定
const SHEET_INVENTORY = '表'; // もしくは実際のシート名に変更してください
const SHEET_RETURN_RECOMMENDED = '返品推奨品';
const SHEET_POTENTIAL_DEAD = '不動在庫の可能性';
const SHEET_ORDER_HISTORY = '発注履歴';
const SHEET_MEDORDER_NAMES = 'MedOrder名前'; // stockable_item_id → 薬品名 のマップ

/**
 * WebアプリにアクセスしたときにUI(index.html)を返す関数 (GETリクエスト用)
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('薬の在庫・棚番検索')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * データ更新リクエストを受け取る関数 (POSTリクエスト用)
 * Python等の外部スクリプトからCSVデータを受信し、シートを上書きします
 */
function doPost(e) {
  try {
    const csvDataString = e.postData ? e.postData.contents : JSON.stringify(e);
    
    // ──────────────────────────────────────────────────────
    // フロントエンド(Vue.js) からの google.script.run 呼び出し
    // JSON payload { action: 'search'|'summary'|'return'|'dead'|'live'|'lastUpdated' }
    // ──────────────────────────────────────────────────────
    if (csvDataString && csvDataString.trim().startsWith('{')) {
      let payload;
      try {
        payload = JSON.parse(csvDataString);
      } catch(parseErr) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error', message: 'JSONパースエラー: ' + parseErr.toString()
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      const action = payload.action;
      
      if (action === 'lastUpdated') {
        const val = PropertiesService.getScriptProperties().getProperty('LAST_UPDATED');
        return ContentService.createTextOutput(JSON.stringify({ time: val || '' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'search') {
        const results = searchMedicine(payload.query || '');
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'summary') {
        const results = getShelfSummary();
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'history') {
        const results = getOrderHistory();
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'history_debug') {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('発注履歴');
        const data = sheet ? sheet.getDataRange().getValues() : [];
        return ContentService.createTextOutput(JSON.stringify(data))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'return') {
        const results = getGenericSheetData(SHEET_RETURN_RECOMMENDED);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'dead') {
        const results = getGenericSheetData(SHEET_POTENTIAL_DEAD);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'history') {
        const results = getOrderHistory();
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'live') {
        const results = getLiveStocks(payload.page || 1);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // jsonだが既知のactionでない場合 → Pythonスクリプトからの特殊JSON
      const dataType2 = (e.parameter || {}).type || payload.type || '';
      if (dataType2 === 'medorder_names') {
        const namesObj = payload;
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet2 = ss.getSheetByName(SHEET_MEDORDER_NAMES);
        if (!sheet2) sheet2 = ss.insertSheet(SHEET_MEDORDER_NAMES);
        sheet2.clearContents();
        sheet2.appendRow(['stockable_item_id', 'name', 'unit']);
        const rows = Object.entries(namesObj).map(([id, info]) => {
          if (typeof info === 'object') return [id, info.name, info.unit || '個'];
          return [id, info, '個'];
        });
        if (rows.length > 0) sheet2.getRange(2, 1, rows.length, 3).setValues(rows);
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success', message: `薬品名マップ${rows.length}件を保存しました`
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: '不明なアクション: ' + action
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ──────────────────────────────────────────────────────
    // Python スクリプトからの CSV データ受信処理
    // ──────────────────────────────────────────────────────
    const csvData = Utilities.parseCsv(csvDataString);
    
    // Get type parameter from URL (?type=inventory, ?type=return, ?type=dead)
    const dataType = (e.parameter || {}).type || 'inventory'; 
    
    // MedOrder Bearerトークンの保存処理
    if (dataType === 'medorder_token') {
      const token = csvDataString.trim();
      const props = PropertiesService.getScriptProperties();
      props.setProperty('MEDORDER_TOKEN', token);
      props.setProperty('MEDORDER_TOKEN_UPDATED_AT', new Date().toISOString());
      props.setProperty('MEDORDER_STATUS', 'OK');
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', message: 'MedOrderトークンを保存しました'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // MedOrder ステータスの更新処理
    if (dataType === 'medorder_status') {
      const status = csvDataString.trim();
      PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', status);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', message: 'ステータスを更新しました'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 実行履歴（ログ）の保存処理
    if (dataType === 'execution_log') {
      const logMsg = csvDataString.trim();
      const props = PropertiesService.getScriptProperties();
      const logsJson = props.getProperty('EXECUTION_HISTORY') || '[]';
      const logs = JSON.parse(logsJson);
      logs.unshift({ time: new Date().toISOString(), message: logMsg });
      if (logs.length > 15) logs.pop();
      props.setProperty('EXECUTION_HISTORY', JSON.stringify(logs));
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', message: 'ログを保存しました'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let targetSheetName = SHEET_INVENTORY;
    if (dataType === 'return') targetSheetName = SHEET_RETURN_RECOMMENDED;
    else if (dataType === 'dead') targetSheetName = SHEET_POTENTIAL_DEAD;
    else if (dataType === 'history') targetSheetName = SHEET_ORDER_HISTORY;
    
    
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(targetSheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(targetSheetName);
    
    if (csvData.length > 0 && csvData[0].length > 1) {
      sheet.clearContents();
      sheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: '受信したCSVデータが空、または形式が正しくありません。'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    let updatedAt = undefined;
    if (dataType === 'inventory') {
      const now = new Date();
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstNow = new Date(now.getTime() + jstOffset);
      updatedAt = Utilities.formatDate(jstNow, 'UTC', 'yyyy/MM/dd HH:mm');
      PropertiesService.getScriptProperties().setProperty('LAST_UPDATED', updatedAt);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'success', 
      message: `${targetSheetName}のデータを更新しました`,
      rows: csvData.length,
      updatedAt: updatedAt
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'error', 
      message: error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getLastUpdated() {
  const val = PropertiesService.getScriptProperties().getProperty('LAST_UPDATED');
  return { time: val || '' };
}

/** フロントエンド用: 返品推奨品データ取得 */
function getReturnData() {
  return getGenericSheetData(SHEET_RETURN_RECOMMENDED);
}

/** フロントエンド用: 不動在庫データ取得 */
function getDeadData() {
  return getGenericSheetData(SHEET_POTENTIAL_DEAD);
}

/**
 * 薬の名前で検索を行い、結果を返す関数
 */
function searchMedicine(query) {
  if (!query || query.trim() === '') {
    return [];
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return [];
  const headers = data[0];
  
  let nameColIdx = -1;
  let stockColIdx = -1;
  let shelfColIdx = -1;
  let yjColIdx = -1;
  let typeColIdx = -1;
  let unitColIdx = -1;
  let oldestStockColIdx = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品') || header.includes('品目')) nameColIdx = i;
    if (header === '在庫数' || header.includes('在庫数')) stockColIdx = i;
    if (header === '棚番' || header.includes('棚番')) shelfColIdx = i;
    if (header.toUpperCase().includes('YJ')) yjColIdx = i;
    if (header.includes('先／後') || header.includes('先/後')) typeColIdx = i;
    if (header === '単位' || header.includes('単位')) unitColIdx = i;
    if (header.includes('推定最古') || header.includes('最古在庫')) oldestStockColIdx = i;
  }
  
  if (nameColIdx === -1) {
    throw new Error('Error: 「薬品名」の列が見つかりません。現在の1行目: ' + JSON.stringify(headers));
  }

  // スペース（全角・半角）で区切って複数キーワードにAND検索
  const keywords = query.trim().split(/[\s\u3000]+/).filter(k => k).map(normalizeText);
  const primaryResults = [];
  const primaryYjPrefixes = new Set();
  const primaryRowIndices = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const normalizedName = normalizeText(String(row[nameColIdx] || ''));
    
    // 全てのキーワードが含まれる場合のみヒット (主検索)
    if (keywords.every(kw => normalizedName.includes(kw))) {
       const yjCode = yjColIdx !== -1 ? String(row[yjColIdx] || '').trim() : '';
       const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
       
       primaryResults.push({
         name: String(row[nameColIdx] || ''),
         stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
         shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
         yjCode: yjCode,
         type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
         unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '',
         oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
         isPrimary: true
       });
       
       primaryRowIndices.add(i);
       if (yjPrefix) primaryYjPrefixes.add(yjPrefix);
    }
  }
  
  // 代替薬（同じYJコード上9桁）の検索
  const alternativeResults = [];
  if (primaryYjPrefixes.size > 0) {
    for (let i = 1; i < data.length; i++) {
      if (primaryRowIndices.has(i)) continue; // すでに主検索でヒットしているものは除外
      
      const row = data[i];
      const yjCode = yjColIdx !== -1 ? String(row[yjColIdx] || '').trim() : '';
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      
      if (yjPrefix && primaryYjPrefixes.has(yjPrefix)) {
        alternativeResults.push({
          name: String(row[nameColIdx] || ''),
          stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
          shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
          yjCode: yjCode,
          type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
          unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '個',
          oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
          isPrimary: false
        });
      }
    }
  }
  
  // 主検索結果と代替薬結果を結合して返す
  return [...primaryResults, ...alternativeResults];
}

/**
 * 棚番ごとに在庫データをグループ化して返す関数
 * ★ usage（用法区分）と unit（単位）を各アイテムに付与
 */
function getShelfSummary() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return [];
  const headers = data[0];
  
  let nameColIdx = -1;
  let stockColIdx = -1;
  let shelfColIdx = -1;
  let unitColIdx = -1;
  let usageColIdx = -1; // 用法区分列（内/外）
  let oldestStockColIdx = -1; // 推定最古在庫列
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品') || header.includes('品目')) nameColIdx = i;
    if (header === '在庫数' || header.includes('在庫数')) stockColIdx = i;
    if (header === '棚番' || header.includes('棚番')) shelfColIdx = i;
    if (header === '単位' || header.includes('単位')) unitColIdx = i;
    if (header === '用法区分' || header.includes('用法')) usageColIdx = i;
    if (header.includes('推定最古') || header.includes('最古在庫')) oldestStockColIdx = i;
  }
  
  if (nameColIdx === -1) {
    throw new Error('Error: 「薬品名」の列が見つかりません。現在の1行目: ' + JSON.stringify(headers));
  }
  
  // 棚番でグループ化
  const shelfMap = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medicineName = String(row[nameColIdx] || '').trim();
    if (!medicineName) continue;
    
    const stock = stockColIdx !== -1 ? row[stockColIdx] : '不明';
    const shelf = shelfColIdx !== -1 ? String(row[shelfColIdx] || '').trim() : '不明';
    const shelfKey = shelf || '（棚番なし）';
    
    const unit = unitColIdx !== -1 ? String(row[unitColIdx] || '').trim() : '';
    const usage = usageColIdx !== -1 ? String(row[usageColIdx] || '').trim() : '';
    const oldestStock = oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '').trim() : '';
    
    if (!shelfMap[shelfKey]) {
      shelfMap[shelfKey] = { shelf: shelfKey, items: [] };
    }
    shelfMap[shelfKey].items.push({ name: medicineName, stock: stock, unit: unit, usage: usage, oldestStock: oldestStock });
  }
  
  // ソートせずそのまま配列に変換（フロントエンド側でソートする）
  return Object.values(shelfMap);
}

/**
 * 汎用的なシートデータ取得関数 (返品推奨品 / 不動在庫用)
 */
function getGenericSheetData(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return []; // Header only
  
  const headers = data[0];
  let nameColIdx = -1;
  let stockColIdx = -1;
  let shelfColIdx = -1;
  let unitColIdx = -1;
  let priceColIdx = -1;
  let stockValueColIdx = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品') || header.includes('品目')) nameColIdx = i;
    if (header === '在庫数' || header === '在庫') stockColIdx = i;
    if (header === '棚番' || header === '棚') shelfColIdx = i;
    if (header === '単位' || header.includes('単位')) unitColIdx = i;
    if (header === '薬価') priceColIdx = i;
    if (header === '在庫金額') stockValueColIdx = i;
  }
  
  if (nameColIdx === -1) {
    return [];
  }
  
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medicineName = String(row[nameColIdx] || '').trim();
    if (!medicineName) continue;
    
    // 薬価と在庫金額の抽出（ソート用に数値化）
    const rawPrice = priceColIdx !== -1 ? String(row[priceColIdx] || '') : '';
    const price = parseFloat(rawPrice.replace(/[^\d.]/g, '')) || 0;
    
    const rawStockValue = stockValueColIdx !== -1 ? String(row[stockValueColIdx] || '') : '';
    const stockValue = parseFloat(rawStockValue.replace(/[^\d.]/g, '')) || 0;
    
    results.push({
      name: medicineName,
      stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
      shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
      unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '個',
      price: price,
      priceStr: rawPrice,
      stockValue: stockValue,
      stockValueStr: rawStockValue
    });
  }
  return results;
}

/**
 * 返品推奨品のデータを取得
 */
function getReturnRecommended() {
  return getGenericSheetData(SHEET_RETURN_RECOMMENDED);
}

/**
 * 不動在庫の可能性のある品目のデータを取得
 */
function getPotentialDeadStock() {
  return getGenericSheetData(SHEET_POTENTIAL_DEAD);
}

/**
 * 文字列の揺れを吸収するための正規化関数
 * 1. NFKC正規化（全角英数を半角、半角カナを全角カタカナに変換）
 * 2. 小文字化
 * 3. 全角カタカナをひらがなに変換
 */
function normalizeText(text) {
  if (!text) return "";
  let normalized = String(text)
    .normalize('NFKC')
    .toLowerCase();
  
  return normalized.replace(/[\u30a1-\u30f6]/g, function(match) {
    var chr = match.charCodeAt(0) - 0x60;
    return String.fromCharCode(chr);
  });
}

/**
 * 薬品名マップをシートから取得する共通ヘルパー
 */
function getNameMap_() {
  const nameMap = {};
  try {
    const nmSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MEDORDER_NAMES);
    if (nmSheet) {
      const nmData = nmSheet.getDataRange().getValues();
      for (let i = 1; i < nmData.length; i++) {
        const id = String(nmData[i][0]).trim();
        const name = String(nmData[i][1]).trim();
        const unit = String(nmData[i][2] || '個').trim();
        if (id && name) nameMap[id] = { name, unit };
      }
    }
  } catch(e) {}
  return nameMap;
}

/**
 * APIレスポンスの1件を整形する共通ヘルパー
 */
function mapStockItem_(stock, nameMap) {
  let orderItems = [];
  try {
    orderItems = typeof stock.order_items === 'string'
      ? JSON.parse(stock.order_items) : (stock.order_items || []);
  } catch(e) {}
  let scheduledStocks = {};
  try {
    scheduledStocks = typeof stock.scheduled_stocks === 'string'
      ? JSON.parse(stock.scheduled_stocks) : (stock.scheduled_stocks || {});
  } catch(e) {}
  const firstOrder = orderItems.length > 0 ? orderItems[0] : {};
  const stockableId = String(stock.stockable_item_id || '');
  let fallbackName = '';
  if (stock.stockable_item && stock.stockable_item.name) fallbackName = stock.stockable_item.name;
  else if (stock.item && stock.item.name) fallbackName = stock.item.name;
  const itemInfo = nameMap[stockableId];
  return {
    id: stock.id,
    name: itemInfo ? itemInfo.name : (fallbackName || `ID:${stockableId}`),
    unit: itemInfo ? itemInfo.unit : '個',
    stockable_item_id: stockableId,
    quantity: stock.quantity || 0,
    nextDelivery: (scheduledStocks.predelivery || 0) > 0 ? scheduledStocks.predelivery : null,
    lot: firstOrder.lot || '',
    expiry: firstOrder.expires_on || '',
    last_action: stock.last_action || '',
    last_acted_at: stock.last_acted_at || '',
    updated_at: stock.updated_at || ''
  };
}

/**
 * MedOrder API 全ページを走査してマイナス在庫だけ返す
 */
function getMinusStocks() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  if (!token) return { error: 'トークン未設定。extract_data.pyを実行してください。' };

  const baseUrl = 'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/stocks?items=500&page=';
  const options = {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      'Origin': 'https://app.medorder.jp',
      'Referer': 'https://app.medorder.jp/'
    },
    muteHttpExceptions: true
  };

  try {
    // 1ページ目を取得して総ページ数を確認
    const res1 = UrlFetchApp.fetch(baseUrl + '1', options);
    if (res1.getResponseCode() === 401) return { error: 'トークンが期限切れです。extract_data.pyを再実行してください.' };
    if (res1.getResponseCode() !== 200) return { error: 'APIエラー: ' + res1.getResponseCode() };

    const headers1 = res1.getHeaders();
    const totalPages = Number(headers1['x-total-pages'] || headers1['X-Total-Pages'] || 1);
    const allData = JSON.parse(res1.getContentText());

    // 残りのページを取得
    for (let p = 2; p <= totalPages; p++) {
      const res = UrlFetchApp.fetch(baseUrl + p, options);
      if (res.getResponseCode() === 200) {
        JSON.parse(res.getContentText()).forEach(item => allData.push(item));
      }
      Utilities.sleep(200);
    }

    const nameMap = getNameMap_();
    const minusItems = allData
      .filter(stock => (stock.quantity || 0) < 0)
      .map(stock => mapStockItem_(stock, nameMap))
      .sort((a, b) => a.quantity - b.quantity); // 小さい順（より深いマイナスが上）

    return { items: minusItems };
  } catch(e) {
    return { error: e.toString() };
  }
}

/**
 * MedOrder APIプロキシ: GASサーバー側から呼び出すことでCORSを回避
 * 薬品名は「表」シートのデータから stockable_item_id をキーにルックアップ
 */
function getLiveStocks(page) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  const health = {
    updatedAt: props.getProperty('MEDORDER_TOKEN_UPDATED_AT') || '',
    status: props.getProperty('MEDORDER_STATUS') || 'Unknown'
  };

  if (!token) {
    return { error: 'トークン未設定。extract_data.pyを実行してください。', health: health };
  }
  
  const pageNum = page || 1;
  const url = `https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/stocks?items=500&page=${pageNum}`;
  
  const options = {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      'Origin': 'https://app.medorder.jp',
      'Referer': 'https://app.medorder.jp/'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 401) {
      return { error: 'トークンが期限切れです。extract_data.pyを再実行してください。', code: 401, health: health };
    }
    if (statusCode !== 200) {
      return { error: `APIエラー: ${statusCode}`, code: statusCode, health: health };
    }
    
    const respHeaders = response.getHeaders();
    const data = JSON.parse(response.getContentText());
    
    const totalCount = respHeaders['x-total-count'] || respHeaders['X-Total-Count'] || null;
    const totalPages = respHeaders['x-total-pages'] || respHeaders['X-Total-Pages'] || null;
    const currentPage = respHeaders['x-current-page'] || respHeaders['X-Current-Page'] || pageNum;

    // extract_data.pyが保存した 薬品名マップ (stockable_item_id → 薬品名) をシートから取得
    const nameMap = getNameMap_();
    const items = data.map(stock => mapStockItem_(stock, nameMap));
    
    return {
      items: items,
      totalCount: Number(totalCount) || items.length,
      totalPages: Number(totalPages) || 1,
      currentPage: Number(currentPage) || pageNum,
      health: health
    };
    
  } catch (e) {
    return { error: e.toString(), health: { status: 'Error', updatedAt: '' } };
  }
}

/**
 * MedOrderAPI と OrderEPI(シート経由)の発注履歴データを取得・結合する
 */
function getOrderHistory() {
  const results = [];
  
  // 1. Order-EPI のデータをシートから取得
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDER_HISTORY);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        const headers = data[0];
        let dateCol = -1, nameCol = -1, qtyCol = -1, statusCol = -1, makerCol = -1, supplierCol = -1;
        for (let i = 0; i < headers.length; i++) {
          const h = String(headers[i]).replace(/[\s　]/g, '');
          if (h.includes('発注日') || h.includes('日付')) dateCol = i;
          if (h.includes('品名') || h.includes('商品') || h.includes('薬品')) nameCol = i;
          if (h.includes('数量') || h.includes('発注数')) qtyCol = i;
          if (h.includes('状態') || h.includes('ステータス') || h.includes('状況')) statusCol = i;
          if (h.includes('メーカー') || h.includes('製造')) makerCol = i;
          if (h.includes('発注先') || h.includes('卸')) supplierCol = i;
        }
        
        if (dateCol !== -1 && nameCol !== -1) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row[nameCol]) continue;
            
            let dateVal = row[dateCol];
            let dateStr = '';
            if (dateVal instanceof Date) {
              dateStr = Utilities.formatDate(dateVal, 'JST', 'yyyy/MM/dd HH:mm:ss');
            } else {
              dateStr = String(dateVal).replace(/^'/, ""); // Remove the apostrophe if present
            }
            results.push({
              source: 'OrderEPI',
              orderDate: dateStr,
              name: String(row[nameCol]),
              quantity: qtyCol !== -1 ? row[qtyCol] : '',
              status: statusCol !== -1 ? String(row[statusCol]) : '',
              maker: makerCol !== -1 ? String(row[makerCol]) : '',
              supplier: supplierCol !== -1 ? String(row[supplierCol]) : ''
            });
          }
        }
      }
    }
  } catch(e) {
    console.error('OrderEPI history read error:', e);
  }

  // 2. MedOrder API から履歴を取得
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  if (token) {
    try {
      const url = 'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=100';
      const options = {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json'
        },
        muteHttpExceptions: true
      };
      const res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() === 200) {
        const medData = JSON.parse(res.getContentText());
        const nameMap = getNameMap_();
        
        medData.forEach(order => {
          const oDate = order.ordered_at || order.created_at || '';
          const status = order.state === 'completed' ? '完了' : (order.state === 'canceled' ? 'キャンセル' : order.state);
          
          if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
              const stockableId = item.orderable_item ? String(item.orderable_item.stockable_item_id) : '';
              const itemInfo = nameMap[stockableId];
              results.push({
                source: 'MedOrder',
                orderDate: oDate,
                name: itemInfo ? itemInfo.name : 'ID:' + stockableId,
                quantity: item.quantity || '',
                status: status,
                maker: '',
                supplier: 'スズケン'
              });
            });
          }
        });
      }
    } catch(e) {
      console.error('MedOrder history API error:', e);
    }
  }

  // 3. 日付降順でソート
  results.sort((a, b) => {
    const da = new Date(a.orderDate).getTime() || 0;
    const db = new Date(b.orderDate).getTime() || 0;
    return db - da; // 降順
  });

  return results;
}

/**
 * 実行履歴を取得
 */
function getExecutionHistory() {
  const props = PropertiesService.getScriptProperties();
  const logsJson = props.getProperty('EXECUTION_HISTORY') || '[]';
  return JSON.parse(logsJson);
}

/**
 * MedOrderの健康状態を個別に取得する関数 (フロントエンド用)
 */
function getMedOrderHealth() {
  const props = PropertiesService.getScriptProperties();
  return {
    updatedAt: props.getProperty('MEDORDER_TOKEN_UPDATED_AT') || '',
    status: props.getProperty('MEDORDER_STATUS') || 'Unknown'
  };
}

/**
 * トークンの有効性をチェックし、期限切れならステータスを更新する関数
 * トリガー設定して定期実行（例: 毎時）することを想定
 */
function checkTokenExpiry() {
  const result = getLiveStocks(1);
  if (result.code === 401 || (result.error && result.error.includes('期限切れ'))) {
    console.warn('MedOrder token is expired. Setting status to NEEDS_UPDATE.');
    PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', 'NEEDS_UPDATE');
  } else if (result.items) {
    console.log('MedOrder token is valid.');
    // もしステータスが NEEDS_UPDATE またはエラーなら OK に戻す
    const currentStatus = PropertiesService.getScriptProperties().getProperty('MEDORDER_STATUS');
    if (currentStatus !== 'OK' && currentStatus !== 'Processing') {
      PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', 'OK');
    }
  }
}

/**
 * 薬品名マッピングをMaster APIから再構築する
 */
function rebuildNameMapViaMasterApi() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  if (!token) {
    return { status: 'error', message: 'ERROR: トークン未設定。extract_data.pyを実行してください。' };
  }
  
  const allIds = new Set();
  const apiBase = "https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/stocks?items=500&page=";
  const options = {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    // 最初のページを取得して総ページ数を確認
    let res = UrlFetchApp.fetch(apiBase + "1", options);
    if (res.getResponseCode() !== 200) {
      return { status: 'error', message: 'ERROR: 在庫APIエラー: ' + res.getResponseCode() };
    }
    
    let data = JSON.parse(res.getContentText());
    data.forEach(item => { if (item.stockable_item_id) allIds.add(String(item.stockable_item_id)); });
    
    const headersObj = res.getHeaders();
    const totalPages = parseInt(headersObj['x-total-pages'] || headersObj['X-Total-Pages'] || '1', 10);
    
    // 残りのページを取得
    for (let p = 2; p <= totalPages; p++) {
      let pRes = UrlFetchApp.fetch(apiBase + p, options);
      if (pRes.getResponseCode() === 200) {
        let pData = JSON.parse(pRes.getContentText());
        pData.forEach(item => { if (item.stockable_item_id) allIds.add(String(item.stockable_item_id)); });
      }
    }
    
    const idList = Array.from(allIds);
    const nameMapRows = [];
    
    // 50件ずつMaster APIに問い合わせて名前を解決
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50);
      const masterUrl = `https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?ids=${chunk.join(',')}`;
      let mRes = UrlFetchApp.fetch(masterUrl, options);
      if (mRes.getResponseCode() === 200) {
        let mData = JSON.parse(mRes.getContentText());
        mData.forEach(mItem => {
           nameMapRows.push([String(mItem.id), mItem.name || '', mItem.unit_name || mItem.unit || '個']);
        });
      }
      Utilities.sleep(500); // 念のためレートリミット回避
    }
    
    if (nameMapRows.length === 0) {
      return { status: 'error', message: 'ERROR: 薬品名を取得できませんでした。' };
    }
    
    // シートに保存
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_MEDORDER_NAMES);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_MEDORDER_NAMES);
    }
    sheet.clearContents();
    sheet.appendRow(['stockable_item_id', 'name', 'unit']);
    sheet.getRange(2, 1, nameMapRows.length, 3).setValues(nameMapRows);
    
    return { status: 'success', message: `薬品名マップ (${nameMapRows.length}件) をマスターAPIから同期しました。` };
    
  } catch (e) {
    return { status: 'error', message: 'ERROR: ' + e.toString() };
  }
}