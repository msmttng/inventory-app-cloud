/**
 * 薬の在庫・棚番検索アプリ (Google Apps Script バックエンド) + GS1スキャナーAPI統合版
 */

const SHEET_INVENTORY = '表';
const SHEET_RETURN_RECOMMENDED = '返品推奨品';
const SHEET_POTENTIAL_DEAD = '不動在庫の可能性';
const SHEET_ORDER_HISTORY = '発注履歴';
const SHEET_MEDORDER_NAMES = 'MedOrder名前';
const SHEET_MHLW_SUPPLY = 'MHLW_Supply';
const SHEET_MEMOS = '薬品メモ';
const SHEET_RECEIVE_HISTORY = '納品履歴';
const SHEET_PENDING_DELIVERIES = '未納未定';
const SHEET_GS1_MASTER = '変換マスター'; // ★GS1変換用のマスターシート名

// ── dealer_id → 発注先名 マップ ──
const DEALER_MAP = {
  '31': 'メディセオ',
  '36': 'スズケン',
  '46': '東邦',
  '58': 'アルフレッサ',
};

function doGet(e) {
  if (e && e.parameter && e.parameter.debug === 'receive_headers') {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECEIVE_HISTORY);
    if (!sheet) return ContentService.createTextOutput('no sheet');
    const headers = sheet.getRange(1, 1, 1, 15).getValues()[0];
    const data = getReceiveHistoryData().slice(0, 5);
    return ContentService.createTextOutput(JSON.stringify({headers: headers, parsed: data}));
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('薬の在庫・棚番検索')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const csvDataString = e.postData ? e.postData.contents : JSON.stringify(e);

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
      if (action === 'allLastUpdated') {
        const props = PropertiesService.getScriptProperties();
        const result = {
          global: props.getProperty('LAST_UPDATED') || '',
          inventory: props.getProperty('LAST_UPDATED_inventory') || '',
          return: props.getProperty('LAST_UPDATED_return') || '',
          dead: props.getProperty('LAST_UPDATED_dead') || '',
          history: props.getProperty('LAST_UPDATED_history') || '',
          receive_history: props.getProperty('LAST_UPDATED_receive_history') || '',
          collabo_history: props.getProperty('LAST_UPDATED_collabo_history') || '',
          epi_delivery: props.getProperty('LAST_UPDATED_epi_delivery') || '',
        };
        return ContentService.createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // ============================================
      // ★新規追加: iPhoneのGS1スキャナーからのPOSTリクエスト処理
      // ============================================
      if (action === 'search_gs1') {
        const results = searchMedicineByGS1(payload.gtin, payload.rawCode);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // ============================================
      // ★新規追加: NSIPS連動（PythonウォッチャーからのPOSTリクエスト処理）
      // ============================================
      if (action === 'sync_nsips') {
        const results = processNsipsSync(payload.mode, payload.items || []);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // ============================================
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
      if (action === 'receive_history') {
        const results = getReceiveHistoryData();
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'history_debug') {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('発注履歴');
        const data = sheet ? sheet.getDataRange().getValues() : [];
        return ContentService.createTextOutput(JSON.stringify(data))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'mhlw_debug') {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MHLW_SUPPLY);
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
      if (action === 'pending_deliveries') {
        const results = getGenericSheetData(SHEET_PENDING_DELIVERIES);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'live') {
        const results = getLiveStocks(payload.page || 1);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'mhlw_sync') {
        const mhlwData = payload.data || [];
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let mhlwSheet = ss.getSheetByName(SHEET_MHLW_SUPPLY);
        if (!mhlwSheet) mhlwSheet = ss.insertSheet(SHEET_MHLW_SUPPLY);
        mhlwSheet.clear();
        mhlwSheet.appendRow(['薬品名', '流通ステータス', 'YJコード', '更新日時']);
        const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
        const rows = mhlwData.map(item => [item.name, item.status, item.yjCode, now]);
        if (rows.length > 0) {
          mhlwSheet.getRange(2, 1, rows.length, 4).setValues(rows);
        }
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'sync_dashboard') {
        const pendingItems = payload.items || [];
        PropertiesService.getScriptProperties().setProperty('DASHBOARD_PENDING_LIST', JSON.stringify(pendingItems));
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'get_memos' || action === 'save_memo' || action === 'delete_memo') {
         // モックAPI
         return ContentService.createTextOutput(JSON.stringify({})).setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'get_minus_stocks') {
         return ContentService.createTextOutput(JSON.stringify({items: []})).setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'search_mhlw' || action === 'searchMhlw') {
         const results = searchMhlw(payload.query || '');
         return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'send_alert') {
         const userEmail = Session.getEffectiveUser().getEmail();
         const subject = "【在庫アプリ警告】" + (payload.subject || "エラー通知");
         const body = payload.message || "システムエラーが発生しました。";
         if (userEmail) {
             MailApp.sendEmail({
                 to: userEmail,
                 subject: subject,
                 body: body
             });
         }
         return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);
      }

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
    
    // DEBUG: return headers
    if ((e.parameter || {}).debug === 'receive_headers') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECEIVE_HISTORY);
      if (!sheet) return ContentService.createTextOutput('no sheet');
      return ContentService.createTextOutput(JSON.stringify(sheet.getRange(1, 1, 1, 15).getValues()[0]));
    }

    const csvData = Utilities.parseCsv(csvDataString);
    const dataType = (e.parameter || {}).type || 'inventory';

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

    if (dataType === 'medorder_status') {
      const status = csvDataString.trim();
      PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', status);
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success', message: 'ステータスを更新しました'
      })).setMimeType(ContentService.MimeType.JSON);
    }

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
    else if (dataType === 'receive_history') targetSheetName = SHEET_RECEIVE_HISTORY;
    else if (dataType === 'collabo_history') targetSheetName = 'CollaboHistory';
    else if (dataType === 'epi_delivery') targetSheetName = 'EpiDelivery';
    else if (dataType === 'pending_deliveries') targetSheetName = SHEET_PENDING_DELIVERIES;

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(targetSheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(targetSheetName);

    if (csvData.length > 0 && csvData[0].length > 1) {
      sheet.clearContents();
      sheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);
      clearDataCache_(targetSheetName); // ★キャッシュ無効化
      
      // 日次の納品データを在庫に自動加算
      if (dataType === 'receive_history') {
        processIncomingDeliveries(csvData);
      }
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error', message: '受信したCSVデータが空、または形式が正しくありません。'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let updatedAt = undefined;
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    updatedAt = Utilities.formatDate(jstNow, 'UTC', 'yyyy/MM/dd HH:mm');
    const scriptProps = PropertiesService.getScriptProperties();
    scriptProps.setProperty('LAST_UPDATED', updatedAt);
    scriptProps.setProperty('LAST_UPDATED_' + dataType, updatedAt);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: `${targetSheetName}のデータを更新しました`,
      rows: csvData.length,
      updatedAt: updatedAt
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ======================================================================
// ★新規追加機能: 納品データの在庫自動加算
// ======================================================================
function processIncomingDeliveries(csvData) {
  if (!csvData || csvData.length < 2) return;
  
  const headers = csvData[0];
  let dateIdx = -1, nameIdx = -1, supplierIdx = -1, qtyIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (h.includes('日付') || h.includes('納品日')) dateIdx = i;
    if (h.includes('薬品名') || h.includes('商品') || h.includes('品名')) nameIdx = i;
    if (h.includes('卸') || h.includes('取引先')) supplierIdx = i;
    if (h.includes('数量')) qtyIdx = i;
  }
  
  if (dateIdx === -1 || nameIdx === -1 || qtyIdx === -1) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName(SHEET_INVENTORY);
  if (!inventorySheet) return;
  
  let processedSheet = ss.getSheetByName('ProcessedDeliveries');
  if (!processedSheet) {
    processedSheet = ss.insertSheet('ProcessedDeliveries');
    processedSheet.appendRow(['DeliveryID', 'DateProcessed']);
  }
  
  const processedData = processedSheet.getDataRange().getValues();
  const processedSet = new Set();
  for (let i = 1; i < processedData.length; i++) {
    processedSet.add(String(processedData[i][0]).trim());
  }

  const now = new Date();
  const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // Ensure robust JST
  const m = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstNow.getUTCDate()).padStart(2, '0');
  const todaySlash = m + '/' + d;

  const invData = inventorySheet.getDataRange().getValues();
  const invHeaders = invData[0];
  let invNameIdx = -1, invStockIdx = -1;
  for (let i = 0; i < invHeaders.length; i++) {
    const h = String(invHeaders[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (h.includes('薬品') || h.includes('品名')) invNameIdx = i;
    if (h.includes('在庫数')) invStockIdx = i;
  }
  if (invNameIdx === -1 || invStockIdx === -1) return;

  const newProcessedIds = [];
  const updates = [];
  let addedCount = 0;

  for (let i = 1; i < csvData.length; i++) {
    const row = csvData[i];
    const dateStr = String(row[dateIdx]).trim();
    const nameStr = String(row[nameIdx]).trim();
    const supStr = supplierIdx !== -1 ? String(row[supplierIdx]).trim() : '';
    const qtyStr = String(row[qtyIdx]).trim();
    
    // Check if delivery is for TODAY (or already marked as '完了' but we just strictly check todaySlash)
    if (dateStr === todaySlash) {
      const deliveryId = dateStr + '_' + nameStr + '_' + supStr + '_' + qtyStr;
      if (!processedSet.has(deliveryId)) {
        const qty = parseFloat(qtyStr);
        if (isNaN(qty) || qty <= 0) continue;
        
        // Find in inventory
        let foundRowIdx = -1;
        for (let j = 1; j < invData.length; j++) {
          const invName = String(invData[j][invNameIdx] || '').trim();
          if (invName && (invName.includes(nameStr) || nameStr.includes(invName))) {
            foundRowIdx = j;
            break;
          }
        }
        
        if (foundRowIdx !== -1) {
          const currentStock = parseFloat(invData[foundRowIdx][invStockIdx]) || 0;
          const newStock = currentStock + qty;
          updates.push({ r: foundRowIdx + 1, c: invStockIdx + 1, val: newStock });
          
          processedSet.add(deliveryId);
          newProcessedIds.push([deliveryId, now.toISOString()]);
          
          invData[foundRowIdx][invStockIdx] = newStock; // update in-memory
          addedCount++;
        }
      }
    }
  }

  if (updates.length > 0) {
    updates.forEach(u => inventorySheet.getRange(u.r, u.c).setValue(u.val));
    clearDataCache_(SHEET_INVENTORY);
    
    const nowStamp = Utilities.formatDate(jstNow, 'UTC', 'yyyy/MM/dd HH:mm:ss');
    PropertiesService.getScriptProperties().setProperty('LAST_UPDATED_inventory', nowStamp);
    PropertiesService.getScriptProperties().setProperty('LAST_UPDATED', nowStamp);
  }
  
  if (newProcessedIds.length > 0) {
    processedSheet.getRange(processedSheet.getLastRow() + 1, 1, newProcessedIds.length, 2).setValues(newProcessedIds);
  }
}

// ======================================================================
// ★新規追加: GAS キャッシュ高速化ユーティリティ
// ======================================================================
function getCachedData_(sheetName, isDisplay = false) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'CACHE_' + sheetName + (isDisplay ? '_DISP' : '');
  const cached = cache.get(cacheKey + '_1');
  
  if (cached) {
    let fullString = '';
    let i = 1;
    while (true) {
      const chunk = cache.get(cacheKey + '_' + i);
      if (!chunk) break;
      fullString += chunk;
      i++;
    }
    try {
      return JSON.parse(fullString);
    } catch (e) { } // JSONパース失敗時は再取得へ
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const data = isDisplay ? sheet.getDataRange().getDisplayValues() : sheet.getDataRange().getValues();
  
  const jsonString = JSON.stringify(data);
  const chunkSize = 90000; // CacheServiceの上限100KB回避
  for (let i = 0; i < jsonString.length; i += chunkSize) {
    let chunk = jsonString.substring(i, i + chunkSize);
    cache.put(cacheKey + '_' + (Math.floor(i / chunkSize) + 1), chunk, 300); // 5分保持
  }
  return data;
}

function clearDataCache_(sheetName) {
  const cache = CacheService.getScriptCache();
  for (let i = 1; i <= 30; i++) {
    cache.remove('CACHE_' + sheetName + '_' + i);
    cache.remove('CACHE_' + sheetName + '_DISP_' + i);
  }
}
// ======================================================================

// ======================================================================
// ★新規追加機能: GS1スキャナーからのGTIN検索＆入庫履歴を含めた在庫照会ロジック
// ======================================================================
function searchMedicineByGS1(gtin, rawCode) {
  const gtinString = String(gtin).trim();
  
  // 1. 変換マスターからYJコードを取得 (キャッシュ高速化)
  const masterData = getCachedData_(SHEET_GS1_MASTER, true);
  if (!masterData) {
    return { status: 'error', message: '「' + SHEET_GS1_MASTER + '」シートが見つかりません。作成してGTIN・YJコード・薬品名の列を設けてください。' };
  }
  let targetYjCode = null;
  let targetProductName = "名称未登録";

  // A列:GTIN, B列:YJコード, C列:商品名 を想定
  for (let i = 1; i < masterData.length; i++) {
    const rowGtin = String(masterData[i][0]).trim();
    if (rowGtin === gtinString || rowGtin.includes(gtinString)) {
      targetYjCode = String(masterData[i][1]).trim();
      targetProductName = String(masterData[i][2] || '').trim();
      break;
    }
  }

  if (!targetYjCode) {
    return { status: 'error', gtin: gtinString, message: 'マスターデータに該当のGS1コードが登録されていません' };
  }

  // 2. 在庫表をYJコードで検索 (キャッシュ高速化)
  // ★変更点1: 検索先を再度「表」に変更 (Looker Studioデータは「表」に自動更新されるため)
  const invData = getCachedData_(SHEET_INVENTORY, false);
  if (!invData) return { status: 'error', message: '「' + SHEET_INVENTORY + '」が見つかりません' };
  
  const headers = invData[0];
  
  let yjColIdx = -1, nameColIdx = -1, stockColIdx = -1, shelfColIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.toUpperCase().includes('YJ')) yjColIdx = i;
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品')) nameColIdx = i;
    if (header === '在庫数' || header.includes('在庫数')) stockColIdx = i;
    if (header === '棚番' || header.includes('棚番')) shelfColIdx = i;
  }

  if (yjColIdx === -1) return { status: 'error', message: '在庫表（Sheet1）にYJコードの列がありません' };

  let matchedRow = null;
  let exactMatchFound = false;
  let substituteMatchFound = false;

  // ★変更点2: 厳格なピッタリ一致（バーコード対応）を最優先で検索
  for (let i = 1; i < invData.length; i++) {
    const row = invData[i];
    const rowYj = String(row[yjColIdx] || '').trim();
    if (rowYj && (rowYj === targetYjCode || rowYj.includes(targetYjCode))) {
      exactMatchFound = true;
      matchedRow = row;
      break;
    }
  }

  // ★変更点3: ピッタリ一致がない場合のみ、先頭9桁で代替品を探す
  if (!exactMatchFound && targetYjCode.length >= 9) {
    const prefix9 = targetYjCode.substring(0, 9);
    for (let i = 1; i < invData.length; i++) {
      const row = invData[i];
      const rowYj = String(row[yjColIdx] || '').trim();
      if (rowYj && rowYj.length >= 9 && rowYj.substring(0, 9) === prefix9) {
        substituteMatchFound = true;
        matchedRow = row;
        break;
      }
    }
  }

  if (matchedRow) {
    const actualName = matchedRow[nameColIdx] || targetProductName;
      
    // 3. 入庫履歴（納品履歴）を取得し、名前で紐付けする
    let lastDeliveryStr = "--";
    try {
      const recHistory = getReceiveHistoryData(); // 既存の納品履歴取得関数
      const matchRec = recHistory.find(r => r.name && (r.name.includes(actualName) || actualName.includes(r.name)));
      if (matchRec) {
        lastDeliveryStr = matchRec.receiveDate + ' (' + matchRec.wholesaler + ')';
      }
    } catch (e) {
      console.error("履歴取得エラー:", e);
    }

    return {
      status: 'ok',
      gtin: gtinString,
      yjCode: targetYjCode,
      productName: actualName,
      stock: stockColIdx !== -1 ? matchedRow[stockColIdx] : 0,
      shelf: shelfColIdx !== -1 ? matchedRow[shelfColIdx] : "未設定",
      lastDeliveryDate: lastDeliveryStr,
      rawCode: rawCode,
      isSubstitute: substituteMatchFound  // ★新規フラグ
    };
  }

  return {
    status: 'ok',
    gtin: gtinString,
    yjCode: targetYjCode,
    productName: targetProductName,
    stock: 0,
    shelf: "登録なし",
    lastDeliveryDate: "--",
    message: "在庫表には未登録の医薬品です"
  };
}
// ======================================================================

// ======================================================================
// ★新規追加機能: NSIPS処方データからの在庫自動引き落とし＆ロールバック機能
// ======================================================================
function processNsipsSync(mode, items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventorySheet = ss.getSheetByName(SHEET_INVENTORY);
  if (!inventorySheet) return { status: 'error', message: '「' + SHEET_INVENTORY + '」シートが見つかりません' };
  
  const orderHistorySheet = ss.getSheetByName(SHEET_ORDER_HISTORY);
  
  const invData = inventorySheet.getDataRange().getValues();
  const headers = invData[0];
  
  let yjColIdx = -1, nameColIdx = -1, stockColIdx = -1, thresholdColIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.toUpperCase().includes('YJ')) yjColIdx = i;
    if (header.includes('薬品') || header.includes('品名')) nameColIdx = i;
    if (header === '在庫数' || header.includes('在庫数')) stockColIdx = i;
    if (header.includes('発注点') || header.includes('しきい値')) thresholdColIdx = i;
  }

  if (yjColIdx === -1 || stockColIdx === -1) {
    return { status: 'error', message: '在庫表にYJコードまたは在庫数の列がありません' };
  }

  let processedCount = 0;
  const updates = []; 
  const autoOrderItems = [];
  const cancelOrderNames = [];

  for (let item of items) {
    const targetYj = String(item.yjCode).trim();
    const qty = parseFloat(item.qty) || 0;
    if (!targetYj || qty <= 0) continue;

    for (let i = 1; i < invData.length; i++) {
      const rowYj = String(invData[i][yjColIdx] || '').trim();
      // フルYJコード、またはYJの前9桁が一致するかで判定
      if (rowYj && (rowYj === targetYj || rowYj.includes(targetYj) || targetYj.includes(rowYj.substring(0,9)))) {
        let currentStock = parseFloat(invData[i][stockColIdx]) || 0;
        let newStock = currentStock;
        const productName = invData[i][nameColIdx];

        if (mode === 'dispense') {
          newStock = currentStock - qty;
          let threshold = 0;
          if (thresholdColIdx !== -1) {
              threshold = parseFloat(invData[i][thresholdColIdx]) || 0;
          }
          // 発注点を下回った場合、自動発注キューに追加
          if (currentStock > threshold && newStock <= threshold) {
              autoOrderItems.push({ name: productName, yj: targetYj, qty: 1 });
          }
        } else if (mode === 'cancel') {
          newStock = currentStock + qty;
          cancelOrderNames.push(productName);
        }

        updates.push({ rowIdx: i + 1, colIdx: stockColIdx + 1, newVal: newStock });
        processedCount++;
        break; // 同一薬目は1行と仮定
      }
    }
  }

  // スプレッドシートの一括更新
  updates.forEach(upd => {
    inventorySheet.getRange(upd.rowIdx, upd.colIdx).setValue(upd.newVal);
  });
  
  // ★キャッシュ無効化 (NSIPSの在庫変動をリアルタイム反映させるため)
  clearDataCache_(SHEET_INVENTORY);

  // 発注履歴（MedOrder連携）シートへの自動追加・削除処理
  if (orderHistorySheet && orderHistorySheet.getLastRow() > 0) {
    const orderHeaders = orderHistorySheet.getRange(1, 1, 1, orderHistorySheet.getLastColumn()).getValues()[0];
    let oDateCol = -1, oNameCol = -1, oQtyCol = -1, oStatusCol = -1, oMemoCol = -1;
    
    for (let i = 0; i < orderHeaders.length; i++) {
       const h = String(orderHeaders[i]).replace(/[\s　]/g, '');
       if (h.includes('発注日') || h.includes('日付')) oDateCol = i;
       if (h.includes('品名') || h.includes('商品')) oNameCol = i;
       if (h.includes('数量') || h.includes('数')) oQtyCol = i;
       if (h.includes('状態') || h.includes('ステータス')) oStatusCol = i;
       if (h.includes('メモ') || h.includes('備考')) oMemoCol = i;
    }

    if (mode === 'dispense' && autoOrderItems.length > 0) {
      const nowStrJST = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
      autoOrderItems.forEach(order => {
          const newRow = new Array(orderHeaders.length).fill('');
          if (oDateCol !== -1) newRow[oDateCol] = nowStrJST;
          if (oNameCol !== -1) newRow[oNameCol] = order.name;
          if (oQtyCol !== -1) newRow[oQtyCol] = order.qty;
          if (oStatusCol !== -1) newRow[oStatusCol] = "未発注";
          if (oMemoCol !== -1) newRow[oMemoCol] = "NSIPS在庫マイナスによる自動検知";
          orderHistorySheet.appendRow(newRow);
      });
    } else if (mode === 'cancel' && cancelOrderNames.length > 0 && oNameCol !== -1 && oStatusCol !== -1) {
      const orderData = orderHistorySheet.getDataRange().getValues();
      for (let i = orderData.length - 1; i >= 1; i--) {
         const st = String(orderData[i][oStatusCol]);
         const nm = String(orderData[i][oNameCol]);
         if (st === "未発注" && cancelOrderNames.includes(nm)) {
             orderHistorySheet.getRange(i + 1, oStatusCol + 1).setValue("NSIPS処方キャンセル");
             const idx = cancelOrderNames.indexOf(nm);
             if (idx > -1) cancelOrderNames.splice(idx, 1);
             if (cancelOrderNames.length === 0) break;
         }
      }
    }
  }

  // タイムスタンプ更新
  const nowStamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('LAST_UPDATED_inventory', nowStamp);
  PropertiesService.getScriptProperties().setProperty('LAST_UPDATED', nowStamp);

  return { status: 'success', message: `${processedCount}件の在庫同期(${mode})が完了しました` };
}
// ======================================================================


// ----------------------------------------------------------------------
// ↓↓↓ 以下の関数はユーザー様からご提供いただいた既存の関数をそのまま保持 ↓↓↓
// ----------------------------------------------------------------------

function getLastUpdated() {
  const val = PropertiesService.getScriptProperties().getProperty('LAST_UPDATED');
  return { time: val || '' };
}

function getAllLastUpdated() {
  const props = PropertiesService.getScriptProperties();
  return {
    global: props.getProperty('LAST_UPDATED') || '',
    inventory: props.getProperty('LAST_UPDATED_inventory') || '',
    return: props.getProperty('LAST_UPDATED_return') || '',
    dead: props.getProperty('LAST_UPDATED_dead') || '',
    history: props.getProperty('LAST_UPDATED_history') || '',
    receive_history: props.getProperty('LAST_UPDATED_receive_history') || '',
    collabo_history: props.getProperty('LAST_UPDATED_collabo_history') || '',
    epi_delivery: props.getProperty('LAST_UPDATED_epi_delivery') || '',
  };
}

function getReturnData() {
  return getGenericSheetData(SHEET_RETURN_RECOMMENDED);
}

function getDeadData() {
  return getGenericSheetData(SHEET_POTENTIAL_DEAD);
}

function getPendingDeliveries() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PENDING_DELIVERIES);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const h = String(headers[j]).trim();
      let v = row[j];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, "JST", "MM/dd HH:mm");
      }
      obj[h] = String(v || '').trim();
    }
    obj.name = obj['品名'] || '';
    obj.supplier = obj['卸名'] || '';
    obj.status = obj['ステータス'] || '';
    obj.qty = obj['数量'] || '';
    if (obj.name) results.push(obj);
  }
  return results;
}

function getReceiveHistoryData() {
  const data = getCachedData_(SHEET_RECEIVE_HISTORY, false);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  let dateColIdx = -1, nameColIdx = -1, wholesalerColIdx = -1;
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header === '入庫日付' || header.includes('日付') || header.includes('納品日')) dateColIdx = i;
    if (header === '医薬品名' || header.includes('薬品名') || header.includes('品名') || header.includes('商品')) nameColIdx = i;
    if (header === '卸名' || header.includes('卸') || header.includes('取引先')) wholesalerColIdx = i;
  }

  if (nameColIdx === -1) return [];

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medicineName = String(row[nameColIdx] || '').trim();
    if (!medicineName) continue;
    
    let dateStr = '';
    const dateVal = dateColIdx !== -1 ? row[dateColIdx] : '';
    if (dateVal instanceof Date) {
      dateStr = Utilities.formatDate(dateVal, 'JST', 'yyyy/MM/dd');
    } else {
      dateStr = String(dateVal).replace(/^'/, '');
    }
    
    results.push({
      receiveDate: dateStr,
      name: medicineName,
      wholesaler: wholesalerColIdx !== -1 ? String(row[wholesalerColIdx]).trim() : ''
    });
  }
  return results;
}

function getMhlwSupplyMap_() {
  const mhlwMap = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MHLW_SUPPLY);
    if (!sheet) return mhlwMap;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        const medName = String(data[i][0] || '').trim();
        const status = String(data[i][1] || '').trim();
        if (medName) mhlwMap[normalizeText(medName)] = status;
    }
  } catch(e) {}
  return mhlwMap;
}

function searchMedicine(query) {
  if (!query || query.trim() === '') return [];

  const data = getCachedData_(SHEET_INVENTORY, false);
  if (!data || data.length === 0) return [];
  const headers = data[0];

  let nameColIdx = -1, stockColIdx = -1, shelfColIdx = -1, yjColIdx = -1;
  let typeColIdx = -1, unitColIdx = -1, oldestStockColIdx = -1;

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

  const mhlwMap = getMhlwSupplyMap_();
  const keywords = query.trim().split(/[\s\u3000]+/).filter(k => k).map(normalizeText);
  const primaryResults = [];
  const primaryYjPrefixes = new Set();
  const primaryRowIndices = new Set();
  
  // 納品予定データの取得 (UI表示用)
  const receiveMap = {};
  try {
    const recHistory = getReceiveHistoryData();
    for (const rec of recHistory) {
      if (rec.name) {
        if (!receiveMap[rec.name]) receiveMap[rec.name] = [];
        receiveMap[rec.name].push({ date: rec.receiveDate, source: rec.wholesaler });
      }
    }
  } catch (e) {}

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const normalizedName = normalizeText(String(row[nameColIdx] || ''));
    if (keywords.every(kw => normalizedName.includes(kw))) {
      const yjCode = yjColIdx !== -1 ? String(row[yjColIdx] || '').trim() : '';
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      
      let supplyStatus = '';
      if (mhlwMap[normalizedName]) {
          supplyStatus = mhlwMap[normalizedName];
      } else {
          const shortName = normalizedName.substring(0, 10);
          for (const key in mhlwMap) {
              if (key.startsWith(shortName) || normalizedName.startsWith(key)) {
                  supplyStatus = mhlwMap[key];
                  break;
              }
          }
      }

      const rawName = String(row[nameColIdx] || '');
      let nextDeliveryStr = '';
      if (receiveMap[rawName]) {
         const latest = receiveMap[rawName][0];
         nextDeliveryStr = latest.date + (latest.source ? ` (${latest.source})` : '');
      } else {
         for (const recName in receiveMap) {
            if (rawName.includes(recName) || recName.includes(rawName)) {
               const latest = receiveMap[recName][0];
               nextDeliveryStr = latest.date + (latest.source ? ` (${latest.source})` : '');
               break;
            }
         }
      }

      primaryResults.push({
        name: rawName,
        stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
        shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
        yjCode: yjCode,
        type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
        unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '',
        oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
        supplyStatus: supplyStatus,
        nextDelivery: nextDeliveryStr,
        isPrimary: true
      });
      primaryRowIndices.add(i);
      if (yjPrefix) primaryYjPrefixes.add(yjPrefix);
    }
  }

  const alternativeResults = [];
  if (primaryYjPrefixes.size > 0) {
    for (let i = 1; i < data.length; i++) {
      if (primaryRowIndices.has(i)) continue;
      const row = data[i];
      const yjCode = yjColIdx !== -1 ? String(row[yjColIdx] || '').trim() : '';
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      if (yjPrefix && primaryYjPrefixes.has(yjPrefix)) {
        const normalizedName = normalizeText(String(row[nameColIdx] || ''));
        let supplyStatus = '';
        if (mhlwMap[normalizedName]) {
            supplyStatus = mhlwMap[normalizedName];
        } else {
            const shortName = normalizedName.substring(0, 10);
            for (const key in mhlwMap) {
                if (key.startsWith(shortName) || normalizedName.startsWith(key)) {
                    supplyStatus = mhlwMap[key];
                    break;
                }
            }
        }
        const rawNameAlt = String(row[nameColIdx] || '');
        let nextDeliveryStrAlt = '';
        if (receiveMap[rawNameAlt]) {
           const latest = receiveMap[rawNameAlt][0];
           nextDeliveryStrAlt = latest.date + (latest.source ? ` (${latest.source})` : '');
        } else {
           for (const recName in receiveMap) {
              if (rawNameAlt.includes(recName) || recName.includes(rawNameAlt)) {
                 const latest = receiveMap[recName][0];
                 nextDeliveryStrAlt = latest.date + (latest.source ? ` (${latest.source})` : '');
                 break;
              }
           }
        }

        alternativeResults.push({
          name: rawNameAlt,
          stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
          shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
          yjCode: yjCode,
          type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
          unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '個',
          oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
          supplyStatus: supplyStatus,
          nextDelivery: nextDeliveryStrAlt,
          isPrimary: false
        });
      }
    }
  }

  return [...primaryResults, ...alternativeResults];
}

function getShelfSummary() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return [];
  const headers = data[0];

  let nameColIdx = -1, stockColIdx = -1, shelfColIdx = -1;
  let unitColIdx = -1, usageColIdx = -1, oldestStockColIdx = -1;

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
    if (!shelfMap[shelfKey]) shelfMap[shelfKey] = { shelf: shelfKey, items: [] };
    shelfMap[shelfKey].items.push({ name: medicineName, stock, unit, usage, oldestStock });
  }

  return Object.values(shelfMap);
}

/**
 * 推定最古在庫使用期限から期限切れ・期限切迫（半年以内）を返す
 * @returns {{ expired: Array, nearExpiry: Array }}
 */
function getExpiryData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);
  if (!sheet) return { expired: [], nearExpiry: [] };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { expired: [], nearExpiry: [] };
  const headers = data[0];

  let nameColIdx = -1, stockColIdx = -1, shelfColIdx = -1;
  let priceColIdx = -1, stockValueColIdx = -1;
  let expiryDateColIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品') || header.includes('品目')) nameColIdx = i;
    if (header === '在庫数' || header.includes('在庫数')) stockColIdx = i;
    if (header === '棚番' || header.includes('棚番')) shelfColIdx = i;
    if (header === '薬価' || header.includes('薬価')) priceColIdx = i;
    if (header === '在庫金額' || header.includes('在庫金額')) stockValueColIdx = i;
    // 「推定最古在庫使用期限」列を検索
    if (header.includes('使用期限') || header.includes('推定最古在庫使用期限') || header.includes('期限日')) expiryDateColIdx = i;
  }

  if (nameColIdx === -1 || expiryDateColIdx === -1) {
    return { expired: [], nearExpiry: [], error: '「推定最古在庫使用期限」列が見つかりません' };
  }

  const now = new Date();
  const sixMonthsLater = new Date(now);
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

  const expired = [];
  const nearExpiry = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medicineName = String(row[nameColIdx] || '').trim();
    if (!medicineName) continue;

    const expiryRaw = row[expiryDateColIdx];
    if (!expiryRaw) continue;

    let expiryDate;
    if (expiryRaw instanceof Date) {
      expiryDate = expiryRaw;
    } else {
      const parsed = new Date(String(expiryRaw).replace(/\//g, '-'));
      if (isNaN(parsed.getTime())) continue;
      expiryDate = parsed;
    }

    const stock = stockColIdx !== -1 ? row[stockColIdx] : '';
    const shelf = shelfColIdx !== -1 ? String(row[shelfColIdx] || '').trim() : '';
    const price = priceColIdx !== -1 ? parseFloat(String(row[priceColIdx] || '').replace(/[^0-9.]/g, '')) || 0 : 0;
    const stockValue = stockValueColIdx !== -1 ? parseFloat(String(row[stockValueColIdx] || '').replace(/[^0-9.]/g, '')) || 0 : 0;

    // 期限日を「YYYY/MM/DD」形式でフォーマット
    const y = expiryDate.getFullYear();
    const m = String(expiryDate.getMonth() + 1).padStart(2, '0');
    const d = String(expiryDate.getDate()).padStart(2, '0');
    const expiryStr = y + '/' + m + '/' + d;

    const item = {
      name: medicineName,
      stock: String(stock),
      shelf: shelf,
      expiryDate: expiryStr,
      price: price,
      priceStr: price > 0 ? price.toLocaleString('ja-JP') + '円' : '',
      stockValue: stockValue,
      stockValueStr: stockValue > 0 ? '¥' + Math.round(stockValue).toLocaleString('ja-JP') : '',
    };

    if (expiryDate < now) {
      expired.push(item);
    } else if (expiryDate <= sixMonthsLater) {
      nearExpiry.push(item);
    }
  }

  return { expired, nearExpiry };
}

function getGenericSheetData(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];

  let nameColIdx = -1, stockColIdx = -1, shelfColIdx = -1;
  let unitColIdx = -1, priceColIdx = -1, stockValueColIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).replace(/\uFEFF/g, '').replace(/[\s\u3000]/g, '');
    if (header.includes('薬品') || header.includes('品名') || header.includes('商品') || header.includes('品目')) nameColIdx = i;
    if (header === '在庫数' || header === '在庫') stockColIdx = i;
    if (header === '棚番' || header === '棚') shelfColIdx = i;
    if (header === '単位' || header.includes('単位')) unitColIdx = i;
    if (header === '薬価') priceColIdx = i;
    if (header === '在庫金額') stockValueColIdx = i;
  }

  if (nameColIdx === -1) return [];

  const results = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medicineName = String(row[nameColIdx] || '').trim();
    if (!medicineName) continue;
    const rawPrice = priceColIdx !== -1 ? String(row[priceColIdx] || '') : '';
    const price = parseFloat(rawPrice.replace(/[^\d.]/g, '')) || 0;
    const rawStockValue = stockValueColIdx !== -1 ? String(row[stockValueColIdx] || '') : '';
    const stockValue = parseFloat(rawStockValue.replace(/[^\d.]/g, '')) || 0;
    results.push({
      name: medicineName,
      stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
      shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
      unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '個',
      price, priceStr: rawPrice,
      stockValue, stockValueStr: rawStockValue
    });
  }
  return results;
}

function getReturnRecommended() {
  return getGenericSheetData(SHEET_RETURN_RECOMMENDED);
}

function getPotentialDeadStock() {
  return getGenericSheetData(SHEET_POTENTIAL_DEAD);
}

function normalizeText(text) {
  if (!text) return '';
  let normalized = String(text).normalize('NFKC').toLowerCase();
  normalized = normalized.replace(/[-－‑—–ｰ]/g, 'ー');
  return normalized.replace(/[\u30a1-\u30f6]/g, function(match) {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
}

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

function getRecentOrderedItemIds_(token, days) {
  const orderedIds = new Set();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  try {
    const url = 'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=200';
    const options = {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      muteHttpExceptions: true
    };
    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() === 200) {
      const orders = JSON.parse(res.getContentText());
      orders.forEach(order => {
        const orderDate = new Date(order.ordered_at || order.created_at || '');
        if (orderDate >= cutoff && order.state !== 'canceled') {
          (order.items || []).forEach(item => {
            if (item.orderable_item && item.orderable_item.stockable_item_id) {
              orderedIds.add(String(item.orderable_item.stockable_item_id));
            }
          });
        }
      });
    }
  } catch(e) {
    console.error('getRecentOrderedItemIds_ error:', e);
  }
  return orderedIds;
}

function getEpiDeliveryDates_() {
  const map = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EpiDelivery');
    if (!sheet) return map;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return map;
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      const date = String(data[i][1] || '').trim();
      if (name && date) {
        map[normalizeText(name)] = date;
      }
    }
  } catch(e) {}
  return map;
}

function getRecentEpiOrderedNames_(days) {
  const names = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDER_HISTORY);
    if (!sheet) return names;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return names;

    const headers = data[0];
    let dateCol = -1, nameCol = -1, statusCol = -1, deliveryCol = -1;
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).replace(/[\s　]/g, '');
      if (h.includes('発注日') || h.includes('日付')) dateCol = i;
      if (h.includes('品名') || h.includes('商品') || h.includes('薬品')) nameCol = i;
      if (h.includes('状態') || h.includes('ステータス') || h.includes('状況')) statusCol = i;
      if (h.includes('納品予定') || h.includes('配送日')) deliveryCol = i;
    }
    if (dateCol === -1 || nameCol === -1) return names;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[nameCol]) continue;
      const status = statusCol !== -1 ? String(row[statusCol]) : '';
      if (status.includes('キャンセル')) continue;

      let dateVal = row[dateCol];
      let orderDate;
      if (dateVal instanceof Date) {
        orderDate = dateVal;
      } else {
        orderDate = new Date(String(dateVal).replace(/^'/, ''));
      }
      if (!isNaN(orderDate.getTime()) && orderDate >= cutoff) {
        names.push({
          name: String(row[nameCol]).trim(),
          deliveryDate: deliveryCol !== -1 ? String(row[deliveryCol]).trim() : ''
        });
      }
    }
  } catch(e) {}
  return names;
}

function getCollaboHistoryDates_(days=7) {
  const dates = [];
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CollaboHistory');
    if (!sheet) return dates;
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return dates;
    
    const headers = data[0];
    const dateCol = headers.indexOf('発注日');
    const nameCol = headers.indexOf('品名');
    const deliveryCol = headers.indexOf('納品予定');
    const statusCol = headers.indexOf('状態');
    
    if (dateCol === -1 || nameCol === -1) return dates;
    
    const now = new Date();
    const cutoff = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const status = String(row[statusCol] || '');
      if (status.includes('キャンセル')) continue;
      
      let dateVal = row[dateCol];
      let orderDate;
      if (dateVal instanceof Date) {
        orderDate = dateVal;
      } else {
        orderDate = new Date(String(dateVal).replace(/^'/, ''));
      }
      
      if (!isNaN(orderDate.getTime()) && orderDate >= cutoff) {
        dates.push({
          name: String(row[nameCol]).trim(),
          deliveryDate: deliveryCol !== -1 ? String(row[deliveryCol]).trim() : '',
          source: 'collabo'
        });
      }
    }
  } catch(e) {}
  return dates;
}

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
    const res1 = UrlFetchApp.fetch(baseUrl + '1', options);
    if (res1.getResponseCode() === 401) return { error: 'トークンが期限切れです。extract_data.pyを再実行してください.' };
    if (res1.getResponseCode() !== 200) return { error: 'APIエラー: ' + res1.getResponseCode() };

    const headers1 = res1.getHeaders();
    const totalPages = Number(headers1['x-total-pages'] || headers1['X-Total-Pages'] || 1);
    const allData = JSON.parse(res1.getContentText());

    for (let p = 2; p <= totalPages; p++) {
      const res = UrlFetchApp.fetch(baseUrl + p, options);
      if (res.getResponseCode() === 200) {
        JSON.parse(res.getContentText()).forEach(item => allData.push(item));
      }
      Utilities.sleep(200);
    }

    const nameMap = getNameMap_();
    const recentOrderedIds = getRecentOrderedItemIds_(token, 7);
    const recentEpiOrders = getRecentEpiOrderedNames_(7);
    const collaboHistoryDates = getCollaboHistoryDates_(7);
    const epiDeliveryMap = getEpiDeliveryDates_();

    const minusItems = allData
      .filter(stock => (stock.quantity || 0) < 0)
      .map(stock => {
        const item = mapStockItem_(stock, nameMap);
        const orderedViaMedOrder = recentOrderedIds.has(item.stockable_item_id);
        const normalizedItemName = normalizeText(item.name);
        const shortItem = normalizedItemName.substring(0, 8);
        
        let deliveryDate = '';
        let matchedSource = '';

        const orderedViaEpi = recentEpiOrders.some(epiOrder => {
          const normalizedEpiName = normalizeText(epiOrder.name);
          if (!normalizedItemName || !normalizedEpiName) return false;
          const shortEpi  = normalizedEpiName.substring(0, 8);
          const isMatch = shortItem === shortEpi
              || normalizedItemName.includes(normalizedEpiName)
              || normalizedEpiName.includes(normalizedItemName);
          
          if (isMatch && !deliveryDate) deliveryDate = epiOrder.deliveryDate || '';
          return isMatch;
        });
        
        if (orderedViaEpi && !deliveryDate) {
          for (const [epiNorm, epiDate] of Object.entries(epiDeliveryMap)) {
            const shortEpiDel = epiNorm.substring(0, 8);
            if (shortItem === shortEpiDel || normalizedItemName.includes(epiNorm) || epiNorm.includes(normalizedItemName)) {
              deliveryDate = epiDate;
              break;
            }
          }
        }
        
        let orderedViaCollabo = false;
        if (!deliveryDate || deliveryDate === '取得前') {
          orderedViaCollabo = collaboHistoryDates.some(pdItem => {
            const normalizedPdName = normalizeText(pdItem.name);
            if (!normalizedItemName || !normalizedPdName) return false;
            const shortPd = normalizedPdName.substring(0, 8);
            const isMatch = shortItem === shortPd || normalizedItemName.includes(normalizedPdName) || normalizedPdName.includes(normalizedItemName);
            
            if (isMatch) {
              deliveryDate = pdItem.deliveryDate || '';
              matchedSource = pdItem.source;
            }
            return isMatch;
          });
        }

        item.isOrdered = orderedViaMedOrder || orderedViaEpi || orderedViaCollabo;
        if (orderedViaEpi) item.orderSource = 'OrderEPI';
        else if (orderedViaCollabo) item.orderSource = 'Collabo Portal';
        else if (orderedViaMedOrder) item.orderSource = 'MedOrder';
        else item.orderSource = '';

        item.deliveryDate = deliveryDate;
        return item;
      })
      .sort((a, b) => {
        if (a.isOrdered !== b.isOrdered) return a.isOrdered ? 1 : -1;
        return a.quantity - b.quantity;
      });

    return { items: minusItems };
  } catch(e) {
    return { error: e.toString() };
  }
}

function searchMhlw(query) {
  if (!query || query.trim() === '') return [];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_MHLW_SUPPLY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const keywords = query.trim().split(/[\s\u3000]+/).filter(k => k).map(normalizeText);
  const primaryResults = [];
  const primaryYjPrefixes = new Set();
  const primaryRowIndices = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const medName = String(row[0] || '').trim();
    if (!medName) continue;
    
    const normalizedName = normalizeText(medName);
    if (keywords.every(kw => normalizedName.includes(kw))) {
      const yjCode = String(row[2] || '').trim();
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      
      primaryResults.push({
        name: medName,
        supplyStatus: String(row[1] || '').trim() || '通常出荷',
        yjCode: yjCode,
        stock: '',
        shelf: '',
        type: '',
        unit: '個',
        isPrimary: true
      });
      primaryRowIndices.add(i);
      if (yjPrefix) primaryYjPrefixes.add(yjPrefix);
    }
  }
  return primaryResults;
}

function getLiveStocks(page) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  const health = {
    updatedAt: props.getProperty('MEDORDER_TOKEN_UPDATED_AT') || '',
    status: props.getProperty('MEDORDER_STATUS') || 'Unknown'
  };

  if (!token) return { error: 'トークン未設定。', health };

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
    if (statusCode === 401) return { error: 'トークン期限切れ', code: 401, health };
    if (statusCode !== 200) return { error: `APIエラー ${statusCode}`, code: statusCode, health };

    const respHeaders = response.getHeaders();
    const data = JSON.parse(response.getContentText());
    const totalCount  = respHeaders['x-total-count']  || respHeaders['X-Total-Count']  || null;
    const totalPages  = respHeaders['x-total-pages']  || respHeaders['X-Total-Pages']  || null;
    const currentPage = respHeaders['x-current-page'] || respHeaders['X-Current-Page'] || pageNum;

    const nameMap = getNameMap_();
    const items = data.map(stock => mapStockItem_(stock, nameMap));

    return {
      items,
      totalCount:  Number(totalCount)  || items.length,
      totalPages:  Number(totalPages)  || 1,
      currentPage: Number(currentPage) || pageNum,
      health
    };
  } catch(e) {
    return { error: e.toString(), health: { status: 'Error', updatedAt: '' } };
  }
}

function getOrderHistory() {
  const results = [];

  // 1. OrderEPI のデータをシートから取得
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
              dateStr = String(dateVal).replace(/^'/, '');
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
        headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
        muteHttpExceptions: true
      };
      const res = UrlFetchApp.fetch(url, options);
      if (res.getResponseCode() === 200) {
        const medData = JSON.parse(res.getContentText());
        const nameMap = getNameMap_();

        medData.forEach(order => {
          const oDate = order.ordered_at || order.created_at || '';
          const status = order.state === 'completed' ? '完了'
            : order.state === 'canceled' ? 'キャンセル'
            : order.state || '';

          if (order.items && order.items.length > 0) {
            order.items.forEach(item => {
              const stockableId = item.orderable_item
                ? String(item.orderable_item.stockable_item_id) : '';
              const itemInfo = nameMap[stockableId];
              const dealerId = String(item.dealer_id || '');
              const supplierName = DEALER_MAP[dealerId] || ('卸ID:' + dealerId);

              results.push({
                source: 'MedOrder',
                orderDate: oDate,
                name: itemInfo ? itemInfo.name : ('ID:' + stockableId),
                quantity: item.quantity || '',
                status: status,
                maker: '',
                supplier: supplierName
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
    return db - da;
  });

  return results;
}


/**
 * マスターAPIを利用して薬品名マップを再構築する関数
 */
function rebuildNameMapViaMasterApi() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  if (!token) return { status: 'error', message: 'ERROR: トークン未設定。extract_data.pyを実行してください。' };

  const allIds = new Set();
  const apiBase = 'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/stocks?items=500&page=';
  const options = {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    muteHttpExceptions: true
  };

  try {
    let res = UrlFetchApp.fetch(apiBase + '1', options);
    if (res.getResponseCode() !== 200) return { status: 'error', message: 'ERROR: 在庫APIエラー: ' + res.getResponseCode() };

    let data = JSON.parse(res.getContentText());
    data.forEach(item => { if (item.stockable_item_id) allIds.add(String(item.stockable_item_id)); });

    const headersObj = res.getHeaders();
    const totalPages = parseInt(headersObj['x-total-pages'] || headersObj['X-Total-Pages'] || '1', 10);

    for (let p = 2; p <= totalPages; p++) {
      let pRes = UrlFetchApp.fetch(apiBase + p, options);
      if (pRes.getResponseCode() === 200) {
        JSON.parse(pRes.getContentText()).forEach(item => {
          if (item.stockable_item_id) allIds.add(String(item.stockable_item_id));
        });
      }
    }

    const idList = Array.from(allIds);
    const nameMapRows = [];

    // マスターAPIは一度に大量にリクエストするとエラーになる可能性があるためチャンクに分割
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50);
      const masterUrl = `https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?ids=${chunk.join(',')}`;
      let mRes = UrlFetchApp.fetch(masterUrl, options);
      if (mRes.getResponseCode() === 200) {
        JSON.parse(mRes.getContentText()).forEach(mItem => {
          nameMapRows.push([String(mItem.id), mItem.name || '', mItem.unit_name || mItem.unit || '個']);
        });
      }
      Utilities.sleep(500); // 連続リクエストによる負荷を避ける
    }

    if (nameMapRows.length === 0) return { status: 'error', message: 'ERROR: 薬品名を取得できませんでした。' };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_MEDORDER_NAMES);
    if (!sheet) sheet = ss.insertSheet(SHEET_MEDORDER_NAMES);
    sheet.clearContents();
    sheet.appendRow(['stockable_item_id', 'name', 'unit']);
    sheet.getRange(2, 1, nameMapRows.length, 3).setValues(nameMapRows);

    return { status: 'success', message: `薬品名マップ (${nameMapRows.length}件) をマスターAPIから同期しました。` };
  } catch(e) {
    return { status: 'error', message: 'ERROR: ' + e.toString() };
  }
}

// 在庫マイナス ＆ ダッシュボード通知
// ══════════════════════════════════════

function checkNegativeStockAndNotify() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  const alertEmail = props.getProperty('ALERT_EMAIL') || 'masamitting@gmail.com';

  const results = { minusItems: [], dashboardItems: [] };

  // 1. 在庫マイナスチェック (MedOrder)
  if (token) {
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
      const res1 = UrlFetchApp.fetch(baseUrl + '1', options);
      if (res1.getResponseCode() === 200) {
        const headers1 = res1.getHeaders();
        const totalPages = Number(headers1['x-total-pages'] || headers1['X-Total-Pages'] || 1);
        const allData = JSON.parse(res1.getContentText());

        for (let p = 2; p <= totalPages; p++) {
          const res = UrlFetchApp.fetch(baseUrl + p, options);
          if (res.getResponseCode() === 200) {
            JSON.parse(res.getContentText()).forEach(item => allData.push(item));
          }
          Utilities.sleep(100);
        }

        const nameMap = getNameMap_();
        results.minusItems = allData
          .filter(s => (s.quantity || 0) < 0)
          .map(s => {
            const id = String(s.stockable_item_id || '');
            const info = nameMap[id];
            const name = info ? info.name : ('ID:' + id);
            return name + ' (' + s.quantity + ')';
          })
          .sort();
      }
    } catch(e) {
      console.error('minus stock fetch error: ' + e);
    }
  }

  // 2. ダッシュボード未納・未定チェック
  const dashboardJson = props.getProperty('DASHBOARD_PENDING_LIST') || '[]';
  results.dashboardItems = JSON.parse(dashboardJson).sort();

  // 3. 通知判定
  if (results.minusItems.length === 0 && results.dashboardItems.length === 0) {
    console.log('checkNegativeStockAndNotify: 通知対象なし');
    props.deleteProperty('LAST_NOTIFICATION_HASH');
    return;
  }

  // ハッシュで前回の内容と比較（重複通知防止）
  const currentHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(results))
                        .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  const lastHash = props.getProperty('LAST_NOTIFICATION_HASH');
  
  if (currentHash === lastHash) {
    console.log('checkNegativeStockAndNotify: 内容に変更がないためスキップ');
    return;
  }

  // 4. メール送信
  const now = new Date();
  const jst = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  
  let htmlBody = '<div style="font-family:sans-serif;max-width:600px;line-height:1.6;">'
               + '<h2 style="color:#1e3a8a;border-bottom:2px solid #3b82f6;padding-bottom:8px;">🔔 定期通知 (' + jst + ')</h2>';

  if (results.minusItems.length > 0) {
    htmlBody += '<h3 style="color:#dc2626;margin-top:20px;">⚠️ 在庫マイナス (' + results.minusItems.length + '件)</h3>'
             + '<table style="border-collapse:collapse;width:100%;">'
             + results.minusItems.map(n => '<tr><td style="padding:6px 12px;border-bottom:1px solid #fee2e2;background:#fff5f5;font-size:14px;">' + n + '</td></tr>').join('')
             + '</table>';
  }

  if (results.dashboardItems.length > 0) {
    htmlBody += '<h3 style="color:#d97706;margin-top:20px;">📦 ダッシュボード 未納・未定 (' + results.dashboardItems.length + '件)</h3>'
             + '<table style="border-collapse:collapse;width:100%;">'
             + results.dashboardItems.map(n => '<tr><td style="padding:6px 12px;border-bottom:1px solid #fef3c7;background:#fffbeb;font-size:14px;">' + n + '</td></tr>').join('')
             + '</table>';
  }

  htmlBody += '<p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:10px;">この通知は在庫・棚番検索アプリから自動送信されています。</p>'
            + '</div>';

  MailApp.sendEmail({
    to: alertEmail,
    subject: '【通知】在庫マイナス(' + results.minusItems.length + '件) / 未納・未定(' + results.dashboardItems.length + '件)',
    htmlBody: htmlBody
  });

  props.setProperty('LAST_NOTIFICATION_HASH', currentHash);
  console.log('checkNegativeStockAndNotify: 送信完了');
}

/**
 * 通知トリガーをセットアップ（2時間おき）
 */
function setupAlertTrigger() {
  removeAlertTrigger();
  ScriptApp.newTrigger('checkNegativeStockAndNotify')
    .timeBased()
    .everyHours(2)
    .create();
  PropertiesService.getScriptProperties().setProperties({
    'ALERT_EMAIL': 'masamitting@gmail.com',
    'LAST_NOTIFICATION_HASH': ''
  });
  return '通知トリガーを設定しました（2時間おき）';
}

/**
 * 通知トリガーを削除
 */
function removeAlertTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'checkNegativeStockAndNotify' || fn === 'checkZeroStockAndNotify') {
      ScriptApp.deleteTrigger(t);
    }
  });
  return '通知トリガーを削除しました';
}

/**
 * 初回のメール送信権限を承認するためのテスト実行用関数
 */
function testSendEmail() {
  const userEmail = Session.getEffectiveUser().getEmail();
  if (!userEmail) {
    Logger.log("ユーザーが見つかりません。");
    return;
  }
  MailApp.sendEmail({
    to: userEmail,
    subject: "【テスト】権限の承認完了",
    body: "このメールが届いていれば、メール送信権限の承認は成功しています。\n在庫アプリからのアラートがこのアドレスに届くようになります。"
  });
  Logger.log("テストメールを送信しました！");
}
