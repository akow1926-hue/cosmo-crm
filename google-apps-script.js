/**
 * Google Apps Script Webhook — Barokot CRM & Cosmo Cleaning Multi-Brand Integration
 * 
 * Автоматически разделяет заказы по вкладкам:
 * - Вкладка "Barokot" (заказы BRK-XXXX от бренда Barokot)
 * - Вкладка "Cosmo" (заказы CSM-XXXX от бренда Cosmo Cleaning)
 * 
 * Если вкладка не существует, скрипт автоматически создает её с фирменным стилем!
 */

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (!e || !e.postData || !e.postData.contents) {
      return respondJson({ error: 'No payload received' }, 400);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'upsert';

    if (action === 'batch_sync' && Array.isArray(payload.orders)) {
      payload.orders.forEach(function(o) {
        const sheet = getTargetSheet(ss, payload, o);
        setupHeaders(sheet, sheet.getName());
        upsertOrderRow(sheet, o);
      });
      return respondJson({ success: true, count: payload.orders.length });
    }

    const order = payload.order;
    if (!order || !order.id) {
      return respondJson({ error: 'Order ID is required' }, 400);
    }

    const sheet = getTargetSheet(ss, payload, order);
    setupHeaders(sheet, sheet.getName());

    if (action === 'delete') {
      deleteOrderRow(sheet, order.id, order.delete_reason);
    } else {
      upsertOrderRow(sheet, order);
    }

    return respondJson({ success: true, id: order.id, action: action, sheet: sheet.getName() });
  } catch (err) {
    return respondJson({ error: err.toString() }, 500);
  }
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets().map(function(s) { return s.getName(); });
    return respondJson({
      status: 'active',
      app: 'Barokot & Cosmo CRM Multi-Brand Google Sheets Integration',
      sheets: sheets,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return respondJson({
      status: 'active',
      app: 'Barokot & Cosmo CRM Multi-Brand Google Sheets Integration',
      error: err.toString(),
      timestamp: new Date().toISOString()
    });
  }
}

function respondJson(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Определяет или создает целевую вкладку (Barokot / Cosmo)
 */
function getTargetSheet(ss, payload, order) {
  let sheetName = (payload && payload.sheet_name) || (order && order.sheet_name);
  if (!sheetName) {
    const brand = String((payload && payload.brand) || (order && order.brand) || '').toUpperCase();
    const orderId = String((order && order.id) || '').toUpperCase();
    if (brand.includes('COSMO') || orderId.startsWith('CSM-')) {
      sheetName = 'Cosmo';
    } else {
      sheetName = 'Barokot';
    }
  }

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    setupHeaders(sheet, sheetName);
  }
  return sheet;
}

function setupHeaders(sheet, sheetName) {
  if (sheet.getLastRow() === 0) {
    const headers = [
      'ID Заказа',
      'Дата создания',
      'Клиент',
      'Телефон',
      'Адрес',
      'Район',
      'Статус заказа',
      'м²',
      'Сумма (сум)',
      'Оплачено (сум)',
      'Способ оплаты',
      'Курьер / Экипаж',
      'Мастер цеха',
      'Дата доставки',
      'Примечание диспетчера'
    ];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    
    // Брендовый стиль шапки таблицы
    const isCosmo = String(sheetName || '').toLowerCase().includes('cosmo');
    if (isCosmo) {
      headerRange.setBackground('#0369A1'); // Oceanic Blue
      headerRange.setFontColor('#FFFFFF');
    } else {
      headerRange.setBackground('#013E37'); // Barokot Deep Emerald
      headerRange.setFontColor('#FFEFB3'); // Gold
    }
    
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 130);
    sheet.setColumnWidth(5, 220);
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 160);
    sheet.setColumnWidth(8, 70);
    sheet.setColumnWidth(9, 120);
    sheet.setColumnWidth(10, 120);
    sheet.setColumnWidth(11, 110);
    sheet.setColumnWidth(12, 140);
    sheet.setColumnWidth(13, 130);
    sheet.setColumnWidth(14, 110);
    sheet.setColumnWidth(15, 200);
  }
}

function upsertOrderRow(sheet, o) {
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(o.id).trim()) {
      rowIndex = i + 1;
      break;
    }
  }

  const paidAmount = o.paid ? (o.total_price || 0) : (o.paid_amount || 0);
  const paymentMethodRu = (o.payment_method === 'cash' || !o.payment_method) ? 'Наличные' : (o.payment_method.toUpperCase());

  const rowValues = [
    String(o.id || ''),
    String(o.created_at || new Date().toLocaleDateString('ru-RU')),
    String(o.client_name || ''),
    String(o.client_phone || ''),
    String(o.client_address || ''),
    String(o.district || 'Сиёб'),
    String(o.stage_ru || o.stage || 'Принят'),
    Number(o.total_m2) || 0,
    Number(o.total_price) || 0,
    Number(paidAmount) || 0,
    paymentMethodRu,
    String(o.courier_name || 'Не назначен'),
    String(o.washer_name || 'Цех'),
    String(o.delivery_date || ''),
    String(o.notes || '')
  ];

  if (rowIndex !== -1) {
    const range = sheet.getRange(rowIndex, 1, 1, rowValues.length);
    range.setValues([rowValues]);
    range.setFontColor('#000000');
  } else {
    sheet.appendRow(rowValues);
  }
}

function deleteOrderRow(sheet, orderId, reason) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(orderId).trim()) {
      const rowIndex = i + 1;
      sheet.getRange(rowIndex, 7).setValue('🗑️ [УДАЛЕН]: ' + (reason || 'В корзине'));
      sheet.getRange(rowIndex, 1, 1, 15).setFontColor('#888888');
      break;
    }
  }
}
