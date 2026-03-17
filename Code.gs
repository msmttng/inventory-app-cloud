/**
 * 薬の在庫・棚番検索アプリ (Google Apps Script バックエンド)
 */

const SHEET_INVENTORY = '表';
const SHEET_RETURN_RECOMMENDED = '返品推奨品';
const SHEET_POTENTIAL_DEAD = '不動在庫の可能性';
const SHEET_ORDER_HISTORY = '発注履歴';
const SHEET_MEDORDER_NAMES = 'MedOrder名前';
const SHEET_MHLW_SUPPLY = 'MHLW_Supply';
const SHEET_MEMOS = '薬品メモ';
const SHEET_RECEIVE_HISTORY = '納品履歴';

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
      if (action === 'live') {
        const results = getLiveStocks(payload.page || 1);
        return ContentService.createTextOutput(JSON.stringify(results))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'mhlw_sync') {
        // payload.data contains the dictionary of {"Medicine Name": "Status"}
        const mhlwData = payload.data || {};
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let mhlwSheet = ss.getSheetByName(SHEET_MHLW_SUPPLY);
        if (!mhlwSheet) mhlwSheet = ss.insertSheet(SHEET_MHLW_SUPPLY);
        mhlwSheet.clear();
        mhlwSheet.appendRow(['薬品名', '流通ステータス', '更新日時']);
        const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
        const rows = Object.keys(mhlwData).map(name => [name, mhlwData[name], now]);
        if (rows.length > 0) {
          mhlwSheet.getRange(2, 1, rows.length, 3).setValues(rows);
        }
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action === 'sync_dashboard') {
        const pendingItems = payload.items || []; // Array of strings (medicine names)
        PropertiesService.getScriptProperties().setProperty('DASHBOARD_PENDING_LIST', JSON.stringify(pendingItems));
        return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
          .setMimeType(ContentService.MimeType.JSON);
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
      status: 'error', message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getLastUpdated() {
  const val = PropertiesService.getScriptProperties().getProperty('LAST_UPDATED');
  return { time: val || '' };
}

function getReturnData() {
  return getGenericSheetData(SHEET_RETURN_RECOMMENDED);
}

function getDeadData() {
  return getGenericSheetData(SHEET_POTENTIAL_DEAD);
}

function getReceiveHistoryData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECEIVE_HISTORY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
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

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return [];
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

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const normalizedName = normalizeText(String(row[nameColIdx] || ''));
    if (keywords.every(kw => normalizedName.includes(kw))) {
      const yjCode = yjColIdx !== -1 ? String(row[yjColIdx] || '').trim() : '';
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      
      // MHLWステータスマッチング (前方一致など簡易検索)
      let supplyStatus = '';
      if (mhlwMap[normalizedName]) {
          supplyStatus = mhlwMap[normalizedName];
      } else {
          // 部分一致フォールバック（最初の10文字など）
          const shortName = normalizedName.substring(0, 10);
          for (const key in mhlwMap) {
              if (key.startsWith(shortName) || normalizedName.startsWith(key)) {
                  supplyStatus = mhlwMap[key];
                  break;
              }
          }
      }

      primaryResults.push({
        name: String(row[nameColIdx] || ''),
        stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
        shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
        yjCode: yjCode,
        type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
        unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '',
        oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
        supplyStatus: supplyStatus,
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
        alternativeResults.push({
          name: String(row[nameColIdx] || ''),
          stock: stockColIdx !== -1 ? row[stockColIdx] : '不明',
          shelf: shelfColIdx !== -1 ? row[shelfColIdx] : '不明',
          yjCode: yjCode,
          type: typeColIdx !== -1 ? String(row[typeColIdx] || '') : '',
          unit: unitColIdx !== -1 ? String(row[unitColIdx] || '') : '個',
          oldestStock: oldestStockColIdx !== -1 ? String(row[oldestStockColIdx] || '') : '',
          supplyStatus: supplyStatus,
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
  // ハイフンなどをすべて長音（ー）に統一
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

/**
 * 直近N日間のMedOrder発注に含まれる stockable_item_id の Set を返す
 */
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
        // キャンセル済みは除外、期間内のみ
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

/**
 * 直近N日間の OrderEPI 発注履歴シートから薬品名リストを返す
 */
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
      // キャンセルは除外
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
  } catch(e) {
    console.error('getRecentEpiOrderedNames_ error:', e);
  }
  return names;
}

function getCollaboHistoryDates_(days=7) {
  const dates = [];
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CollaboHistory');
    if (!sheet) return dates;
    
    // Header includes: 発注日, 状態, メーカー, 品名, 規格, 単位, 数量, 発注先, 納品予定
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
  } catch(e) {
    console.error('getCollaboHistoryDates_ error:', e);
  }
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

    // ── 発注済みチェック：直近7日間の注文を取得 ──
    const recentOrderedIds = getRecentOrderedItemIds_(token, 7);
    const recentEpiOrders = getRecentEpiOrderedNames_(7);
    const collaboHistoryDates = getCollaboHistoryDates_(7);

    const minusItems = allData
      .filter(stock => (stock.quantity || 0) < 0)
      .map(stock => {
        const item = mapStockItem_(stock, nameMap);

        // MedOrder 発注チェック (stockable_item_id で完全一致)
        const orderedViaMedOrder = recentOrderedIds.has(item.stockable_item_id);

        // OrderEPI と Collabo の納品予定を統合チェック
        const normalizedItemName = normalizeText(item.name);
        const shortItem = normalizedItemName.substring(0, 8);
        
        let deliveryDate = '';
        let matchedSource = ''; // 'OrderEPI' or 'Collabo' etc.

        // 1. OrderEPI をチェック
        const orderedViaEpi = recentEpiOrders.some(epiOrder => {
          const normalizedEpiName = normalizeText(epiOrder.name);
          if (!normalizedItemName || !normalizedEpiName) return false;
          const shortEpi  = normalizedEpiName.substring(0, 8);
          const isMatch = shortItem === shortEpi
              || normalizedItemName.includes(normalizedEpiName)
              || normalizedEpiName.includes(normalizedItemName);
          
          if (isMatch) {
            deliveryDate = epiOrder.deliveryDate || '';
          }
          return isMatch;
        });
        
        // 2. Collabo をチェック (OrderEPIで日付が取れなかった場合などを補完)
        let orderedViaCollabo = false;
        if (!deliveryDate || deliveryDate === '取得前') {
          orderedViaCollabo = collaboHistoryDates.some(pdItem => {
            const normalizedPdName = normalizeText(pdItem.name);
            if (!normalizedItemName || !normalizedPdName) return false;
            const shortPd = normalizedPdName.substring(0, 8);
            const isMatch = shortItem === shortPd
                || normalizedItemName.includes(normalizedPdName)
                || normalizedPdName.includes(normalizedItemName);
            
            if (isMatch) {
              deliveryDate = pdItem.deliveryDate || '';
              matchedSource = pdItem.source; // e.g. 'collabo'
            }
            return isMatch;
          });
        }

        item.isOrdered = orderedViaMedOrder || orderedViaEpi || orderedViaCollabo;
        
        // 優先度表示: OrderEPI > Collabo > MedOrder
        if (orderedViaEpi) {
          item.orderSource = 'OrderEPI';
        } else if (orderedViaCollabo) {
          item.orderSource = 'Collabo Portal';
        } else if (orderedViaMedOrder) {
          item.orderSource = 'MedOrder';
        } else {
          item.orderSource = '';
        }

        item.deliveryDate = deliveryDate;
        return item;
      })
      .sort((a, b) => {
        // 未発注を先に表示（目立たせる）
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

  const alternativeResults = [];
  if (primaryYjPrefixes.size > 0) {
    for (let i = 1; i < data.length; i++) {
      if (primaryRowIndices.has(i)) continue;
      const row = data[i];
      const yjCode = String(row[2] || '').trim();
      const yjPrefix = yjCode.length >= 9 ? yjCode.substring(0, 9) : null;
      if (yjPrefix && primaryYjPrefixes.has(yjPrefix)) {
        alternativeResults.push({
          name: String(row[0] || '').trim(),
          supplyStatus: String(row[1] || '').trim() || '通常出荷',
          yjCode: yjCode,
          stock: '',
          shelf: '',
          type: '',
          unit: '個',
          isPrimary: false
        });
      }
    }
  }

  return [...primaryResults, ...alternativeResults].slice(0, 100);
}

function getLiveStocks(page) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('MEDORDER_TOKEN');
  const health = {
    updatedAt: props.getProperty('MEDORDER_TOKEN_UPDATED_AT') || '',
    status: props.getProperty('MEDORDER_STATUS') || 'Unknown'
  };

  if (!token) return { error: 'トークン未設定。extract_data.pyを実行してください。', health };

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
    if (statusCode === 401) return { error: 'トークンが期限切れです。extract_data.pyを再実行してください。', code: 401, health };
    if (statusCode !== 200) return { error: `APIエラー: ${statusCode}`, code: statusCode, health };

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

/**
 * MedOrder API と OrderEPI(シート経由) の発注履歴を取得・結合する
 */
function getOrderHistory() {
  const results = [];

  // 1. OrderEPI のデータをシートから取得
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDER_HISTORY);
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        const headers = data[0];
        let dateCol = -1, nameCol = -1, qtyCol = -1, statusCol = -1, makerCol = -1, supplierCol = -1, deliveryCol = -1;
        for (let i = 0; i < headers.length; i++) {
          const h = String(headers[i]).replace(/[\s　]/g, '');
          if (h.includes('発注日') || h.includes('日付')) dateCol = i;
          if (h.includes('品名') || h.includes('商品') || h.includes('薬品')) nameCol = i;
          if (h.includes('数量') || h.includes('発注数')) qtyCol = i;
          if (h.includes('状態') || h.includes('ステータス') || h.includes('状況')) statusCol = i;
          if (h.includes('メーカー') || h.includes('製造')) makerCol = i;
          if (h.includes('発注先') || h.includes('卸')) supplierCol = i;
          if (h.includes('納品予定') || h.includes('配送日')) deliveryCol = i;
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
              supplier: supplierCol !== -1 ? String(row[supplierCol]) : '',
              deliveryDate: deliveryCol !== -1 ? String(row[deliveryCol]) : ''
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

function debugMedOrderOrderFields() {
  const token = PropertiesService.getScriptProperties().getProperty('MEDORDER_TOKEN');
  if (!token) { Logger.log('トークン未設定'); return; }
  const res = UrlFetchApp.fetch(
    'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=3',
    { method:'GET', headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}, muteHttpExceptions:true }
  );
  const data = JSON.parse(res.getContentText());
  if (data.length > 0) {
    Logger.log('--- order[0] の全フィールド ---');
    Logger.log(JSON.stringify(data[0], null, 2));
  } else {
    Logger.log('履歴データが0件です');
  }
}

function debugAllDealerIds() {
  const token = PropertiesService.getScriptProperties().getProperty('MEDORDER_TOKEN');
  const res = UrlFetchApp.fetch(
    'https://medorder-api.pharmacloud.jp/api/v2/pharmacy/pharmacies/20/orders?items=100',
    { method:'GET', headers:{'Authorization':'Bearer '+token,'Accept':'application/json'}, muteHttpExceptions:true }
  );
  const data = JSON.parse(res.getContentText());
  const dealerMap = {};
  data.forEach(order => {
    (order.items || []).forEach(item => {
      const id = String(item.dealer_id || '');
      if (!dealerMap[id]) dealerMap[id] = 0;
      dealerMap[id]++;
    });
  });
  Logger.log('dealer_id別 件数: ' + JSON.stringify(dealerMap));
}

function getExecutionHistory() {
  const props = PropertiesService.getScriptProperties();
  const logsJson = props.getProperty('EXECUTION_HISTORY') || '[]';
  return JSON.parse(logsJson);
}

function getMedOrderHealth() {
  const props = PropertiesService.getScriptProperties();
  return {
    updatedAt: props.getProperty('MEDORDER_TOKEN_UPDATED_AT') || '',
    status: props.getProperty('MEDORDER_STATUS') || 'Unknown'
  };
}

function checkTokenExpiry() {
  const result = getLiveStocks(1);
  if (result.code === 401 || (result.error && result.error.includes('期限切れ'))) {
    console.warn('MedOrder token is expired.');
    PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', 'NEEDS_UPDATE');
  } else if (result.items) {
    const currentStatus = PropertiesService.getScriptProperties().getProperty('MEDORDER_STATUS');
    if (currentStatus !== 'OK' && currentStatus !== 'Processing') {
      PropertiesService.getScriptProperties().setProperty('MEDORDER_STATUS', 'OK');
    }
  }
}

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

    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50);
      const masterUrl = `https://medorder-api.pharmacloud.jp/api/v2/master/stockable_items?ids=${chunk.join(',')}`;
      let mRes = UrlFetchApp.fetch(masterUrl, options);
      if (mRes.getResponseCode() === 200) {
        JSON.parse(mRes.getContentText()).forEach(mItem => {
          nameMapRows.push([String(mItem.id), mItem.name || '', mItem.unit_name || mItem.unit || '個']);
        });
      }
      Utilities.sleep(500);
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

/**
 * GitHub Actionsを手動トリガーする
 */
function triggerGitHubWorkflow() {
  const props = PropertiesService.getScriptProperties();
  const pat = props.getProperty('GITHUB_PAT');
  const repo = props.getProperty('GITHUB_REPO') || 'msmttng/inventory-app-cloud';
  
  if (!pat) {
    return { status: 'error', message: 'GitHubのPersonal Access Token (GITHUB_PAT) が設定されていません。GASのスクリプトプロパティから設定してください。' };
  }

  const workflowId = 'main.yml'; // workflowのファイル名
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`;

  const payload = {
    ref: 'main' // 実行するブランチ名
  };

  const options = {
    method: 'POST',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 204) {
      return { status: 'success', message: 'クラウドへの在庫取得リクエストを送信しました。データが更新されるまで約2〜5分かかります。' };
    } else {
      let errorMsg = '不明なエラー';
      try {
        const errJson = JSON.parse(response.getContentText());
        errorMsg = errJson.message || response.getContentText();
      } catch (e) {
        errorMsg = response.getContentText();
      }
      return { status: 'error', message: `APIエラー (${statusCode}): ${errorMsg}` };
    }
  } catch (e) {
    return { status: 'error', message: `リクエスト失敗: ${e.toString()}` };
  }
}

// ══════════════════════════════════════
// 薬品メモ機能
// ══════════════════════════════════════

function getMemos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MEMOS);
  if (!sheet) return {};
  const data = sheet.getDataRange().getValues();
  const memos = {};
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const memo = String(data[i][1] || '').trim();
    if (name && memo) memos[name] = memo;
  }
  return memos;
}

function saveMemo(medicineName, memoText) {
  if (!medicineName) return { status: 'error', message: '薬品名が指定されていません' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_MEMOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEMOS);
    sheet.appendRow(['薬品名', 'メモ']);
  }
  const data = sheet.getDataRange().getValues();
  const name = medicineName.trim();
  const memo = (memoText || '').trim();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === name) {
      if (memo === '') {
        sheet.deleteRow(i + 1);
        return { status: 'success', message: 'メモを削除しました' };
      } else {
        sheet.getRange(i + 1, 2).setValue(memo);
        return { status: 'success', message: 'メモを更新しました' };
      }
    }
  }

  if (memo !== '') {
    sheet.appendRow([name, memo]);
    return { status: 'success', message: 'メモを保存しました' };
  }
  return { status: 'success', message: '変更なし' };
}

// ══════════════════════════════════════
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
