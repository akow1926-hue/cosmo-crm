function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    setupHeaders(sheet);

    if (!e || !e.postData || !e.postData.contents) {
      return respondJson({ error: 'No payload received' }, 400);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'upsert';

    if (action === 'batch_sync' && Array.isArray(payload.orders)) {
      payload.orders.forEach(function(o) {
        upsertOrderRow(sheet, o);
      });
      return respondJson({ success: true, count: payload.orders.length });
    }

    const order = payload.order;
    if (!order || !order.id) {
      return respondJson({ error: 'Order ID is required' }, 400);
    }

    if (action === 'delete') {
      deleteOrderRow(sheet, order.id, order.delete_reason);
    } else {
      upsertOrderRow(sheet, order);
    }

    return respondJson({ success: true, id: order.id, action: action });
  } catch (err) {
    return respondJson({ error: err.toString() }, 500);
  }
}

function doGet(e) {
  return respondJson({ status: 'active', app: 'BAROKOT CRM Google Sheets Integration', timestamp: new Date().toISOString() });
}

function respondJson(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = [
      'ID \u0417\u0430\u043a\u0430\u0437\u0430',
      '\u0414\u0430\u0442\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f',
      '\u041a\u043b\u0438\u0435\u043d\u0442',
      '\u0422\u0435\u043b\u0435\u0444\u043e\u043d',
      '\u0410\u0434\u0440\u0435\u0441',
      '\u0420\u0430\u0439\u043e\u043d',
      '\u0421\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043a\u0430\u0437\u0430',
      '\u043c\u00b2',
      '\u0421\u0443\u043c\u043c\u0430 (\u0441\u0443\u043c)',
      '\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e (\u0441\u0443\u043c)',
      '\u0421\u043f\u043e\u0441\u043e\u0431 \u043e\u043f\u043b\u0430\u0442\u044b',
      '\u041a\u0443\u0440\u044c\u0435\u0440 / \u042d\u043a\u0438\u043f\u0430\u0436',
      '\u041c\u0430\u0441\u0442\u0435\u0440 \u0446\u0435\u0445\u0430',
      '\u0414\u0430\u0442\u0430 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438',
      '\u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435 \u0434\u0438\u0441\u043f\u0435\u0442\u0447\u0435\u0440\u0430'
    ];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#013E37');
    headerRange.setFontColor('#FFEFB3');
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
