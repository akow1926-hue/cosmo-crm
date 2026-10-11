const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// No-cache middleware so updates in HTML/JS are immediately visible without browser caching issues
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Priority: serve root directory first, then public directory
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// ================= БАЗА ДАННЫХ (TURSO CLOUD + LOCAL SQLITE) =================
const isTurso = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let dbClient;
let dbMode = 'local_file_sqlite';
let dbLocation = '';

if (isTurso) {
  dbMode = 'turso_cloud';
  dbLocation = process.env.TURSO_DATABASE_URL;
  dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
} else {
  const localDbPath = isVercel ? '/tmp/barokot.db' : path.join(__dirname, 'barokot.db');
  dbMode = isVercel ? 'vercel_tmp_sqlite' : 'local_file_sqlite';
  dbLocation = localDbPath;
  dbClient = createClient({
    url: `file:${localDbPath.replace(/\\/g, '/')}`
  });
}

// Функция санитизации аргументов SQL (libsql выбрасывает TypeError, если передан undefined)
function sanitizeSqlArgs(args) {
  const flat = Array.isArray(args) ? args.flat() : [args];
  return flat.map(arg => (arg === undefined ? null : arg));
}

// Универсальная обертка базы данных
const db = {
  async all(sql, args = []) {
    const flatArgs = sanitizeSqlArgs(args);
    const res = await dbClient.execute({ sql, args: flatArgs });
    return res.rows;
  },
  async get(sql, args = []) {
    const flatArgs = sanitizeSqlArgs(args);
    const res = await dbClient.execute({ sql, args: flatArgs });
    return res.rows[0] || null;
  },
  async run(sql, args = []) {
    const flatArgs = sanitizeSqlArgs(args);
    const res = await dbClient.execute({ sql, args: flatArgs });
    return {
      lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
      changes: res.rowsAffected || 0
    };
  },
  async exec(sql) {
    return await dbClient.executeMultiple(sql);
  },
  prepare(sql) {
    return {
      async all(...args) {
        const flatArgs = sanitizeSqlArgs(args);
        const res = await dbClient.execute({ sql, args: flatArgs });
        return res.rows;
      },
      async get(...args) {
        const flatArgs = sanitizeSqlArgs(args);
        const res = await dbClient.execute({ sql, args: flatArgs });
        return res.rows[0] || null;
      },
      async run(...args) {
        const flatArgs = sanitizeSqlArgs(args);
        const res = await dbClient.execute({ sql, args: flatArgs });
        return {
          lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : 0,
          changes: res.rowsAffected || 0
        };
      }
    };
  }
};

let isInitialized = false;
let initPromise = null;

async function initDatabase() {
  if (isInitialized) return;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT NOT NULL,
      phone TEXT,
      base_salary INTEGER DEFAULT 4000000,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      price INTEGER NOT NULL,
      icon TEXT DEFAULT 'Layers'
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      client_address TEXT NOT NULL,
      district TEXT DEFAULT 'Сиёб',
      landmark TEXT DEFAULT '',
      language TEXT DEFAULT 'Русский',
      time_slot TEXT DEFAULT 'В любое время',
      urgent INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      pickup_date TEXT,
      delivery_date TEXT,
      delivery_time TEXT,
      stage TEXT NOT NULL DEFAULT 'pickup',
      courier_name TEXT,
      washer_name TEXT,
      dispatcher_name TEXT,
      paid INTEGER DEFAULT 0,
      paid_amount INTEGER DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      underpaid_reason TEXT DEFAULT '',
      total_m2 REAL DEFAULT 0,
      total_price INTEGER DEFAULT 0,
      carpets_json TEXT NOT NULL,
      extras_json TEXT,
      gps_location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      deleted_by TEXT,
      delete_reason TEXT,
      rating INTEGER DEFAULT 0,
      review_text TEXT DEFAULT '',
      completed_date TEXT,
      sms_sent_stages TEXT DEFAULT '',
      tg_sent INTEGER DEFAULT 0,
      photos_json TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      address TEXT,
      district TEXT,
      landmark TEXT,
      language TEXT DEFAULT 'Русский',
      tier TEXT DEFAULT 'Standard',
      discount_percent INTEGER DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      total_spent INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      gps_location TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS salary_advances (
      id TEXT PRIMARY KEY,
      employee_id INTEGER,
      employee_name TEXT NOT NULL,
      employee_role TEXT,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      method TEXT DEFAULT 'Наличные',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      method TEXT DEFAULT 'Наличные'
    );

    CREATE TABLE IF NOT EXISTS courier_locations (
      courier_name TEXT PRIMARY KEY,
      lat REAL,
      lng REAL,
      speed REAL,
      battery INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      actor_name TEXT,
      action TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      client_phone TEXT NOT NULL,
      client_name TEXT,
      caller_name TEXT NOT NULL,
      caller_role TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courier_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      courier_name TEXT NOT NULL,
      shift_date TEXT NOT NULL,
      orders_count INTEGER DEFAULT 0,
      total_delivered_sum INTEGER DEFAULT 0,
      cash_collected INTEGER DEFAULT 0,
      click_collected INTEGER DEFAULT 0,
      payme_collected INTEGER DEFAULT 0,
      debts_total INTEGER DEFAULT 0,
      expenses_total INTEGER DEFAULT 0,
      net_cash_submitted INTEGER DEFAULT 0,
      status TEXT DEFAULT 'accepted',
      accepted_by TEXT,
      accepted_at TEXT,
      notes TEXT
    );
  `);

  const tryAddCol = async (table, colDef) => {
    try {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
    } catch (e) {
      // Column already exists
    }
  };

  await tryAddCol('clients', 'gps_location TEXT DEFAULT ""');
  await tryAddCol('employees', 'base_salary INTEGER DEFAULT 4000000');
  await tryAddCol('employees', "status TEXT DEFAULT 'active'");
  await tryAddCol('orders', 'district TEXT DEFAULT "Сиёб"');
  await tryAddCol('orders', 'landmark TEXT DEFAULT ""');
  await tryAddCol('orders', 'language TEXT DEFAULT "Русский"');
  await tryAddCol('orders', 'time_slot TEXT DEFAULT "В любое время"');
  await tryAddCol('orders', 'urgent INTEGER DEFAULT 0');
  await tryAddCol('orders', 'delivery_date TEXT');
  await tryAddCol('orders', 'delivery_time TEXT');
  await tryAddCol('orders', 'courier_name TEXT');
  await tryAddCol('orders', 'washer_name TEXT');
  await tryAddCol('orders', 'dispatcher_name TEXT');
  await tryAddCol('orders', 'paid_amount INTEGER DEFAULT 0');
  await tryAddCol('orders', 'underpaid_reason TEXT DEFAULT ""');
  await tryAddCol('orders', 'gps_location TEXT DEFAULT ""');
  await tryAddCol('orders', 'is_deleted INTEGER DEFAULT 0');
  await tryAddCol('orders', 'deleted_at TEXT');
  await tryAddCol('orders', 'deleted_by TEXT');
  await tryAddCol('orders', 'delete_reason TEXT');
  await tryAddCol('orders', 'rating INTEGER DEFAULT 0');
  await tryAddCol('orders', 'review_text TEXT DEFAULT ""');
  await tryAddCol('orders', 'completed_date TEXT');
  await tryAddCol('orders', 'sms_sent_stages TEXT DEFAULT ""');
  await tryAddCol('orders', 'tg_sent INTEGER DEFAULT 0');
  await tryAddCol('orders', 'sms_sent INTEGER DEFAULT 0');
  await tryAddCol('orders', "photos_json TEXT DEFAULT '[]'");

  // Миграции для courier_shifts
  await tryAddCol('courier_shifts', 'orders_count INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'total_delivered_sum INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'cash_collected INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'click_collected INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'payme_collected INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'debts_total INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'card_collected INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'expenses_total INTEGER DEFAULT 0');
  await tryAddCol('courier_shifts', 'status TEXT DEFAULT "accepted"');
  await tryAddCol('courier_shifts', 'accepted_by TEXT DEFAULT ""');
  await tryAddCol('courier_shifts', 'accepted_at TEXT DEFAULT ""');
  await tryAddCol('courier_shifts', 'notes TEXT DEFAULT ""');

  // Начальные сотрудники (строго при первой инициализации системы)
  const isSeededRow = await db.get("SELECT value FROM settings WHERE key = 'initial_staff_seeded'");
  if (!isSeededRow) {
    const empRow = await db.get('SELECT COUNT(*) as count FROM employees');
    if (!empRow || empRow.count === 0) {
      await db.run('INSERT INTO employees (name, role, pin, phone, base_salary, status) VALUES (?, ?, ?, ?, ?, ?)', ['Акобир (Руководитель)', 'admin', '0000', '+998 95 032 33 30', 6000000, 'active']);
      await db.run('INSERT INTO employees (name, role, pin, phone, base_salary, status) VALUES (?, ?, ?, ?, ?, ?)', ['Мадина (Диспетчер)', 'dispatcher', '1111', '+998 91 555-44-33', 3500000, 'active']);
      await db.run('INSERT INTO employees (name, role, pin, phone, base_salary, status) VALUES (?, ?, ?, ?, ?, ?)', ['Дамир (Курьер / Доставка)', 'courier', '2222', '+998 20 002 20 99', 4500000, 'active']);
      await db.run('INSERT INTO employees (name, role, pin, phone, base_salary, status) VALUES (?, ?, ?, ?, ?, ?)', ['Шерзод (Мастер цеха)', 'washer', '3333', '+998 93 333-22-11', 4000000, 'active']);
    }
    await db.run("INSERT INTO settings (key, value) VALUES ('initial_staff_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  }

  // Наполнение каталога услуг
  const svcRow = await db.get('SELECT COUNT(*) as count FROM services');
  if (!svcRow || svcRow.count === 0) {
    const services = [
      ['S-1', 'Gilam Standart', 'Ковры', 'м²', 16000, 'Layers'],
      ['S-2', 'Gilam Srochna', 'Ковры', 'м²', 22000, 'Sparkles'],
      ['S-3', 'Gilam No standart (Шёлк / Ручной)', 'Ковры', 'м²', 25000, 'Layers'],
      ['S-4', 'Kurpacha', 'Текстиль', 'метр', 15000, 'Bed'],
      ['S-5', 'Kurpa (Одеяло стеганое)', 'Текстиль', 'шт', 80000, 'Bed'],
      ['S-6', 'Adyol (1-спальный плед)', 'Текстиль', 'шт', 60000, 'Bed'],
      ['S-7', 'Adyol (2-спальный евро)', 'Текстиль', 'шт', 80000, 'Bed'],
      ['S-8', 'Yostiq (Подушка пуховая)', 'Текстиль', 'шт', 15000, 'Feather'],
      ['S-9', 'Parda Vilur (Бархатные шторы)', 'Шторы', 'метр', 20000, 'Sun'],
      ['S-10', 'Parda Tur (Тюль)', 'Шторы', 'метр', 18000, 'Sun'],
      ['S-11', 'Overlok (Обработка края)', 'Доп. услуги', 'метр', 20000, 'Tag']
    ];
    for (const s of services) {
      await db.run('INSERT INTO services (id, name, category, unit, price, icon) VALUES (?, ?, ?, ?, ?, ?)', s);
    }
  }

  // Системные настройки
  const setSettingIfMissing = async (key, val) => {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) {
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, val]);
    }
  };

  await setSettingIfMissing('company_name', 'COSMO CRM');
  await setSettingIfMissing('company_phone', '+998 95 032 33 30');
  await setSettingIfMissing('courier_phone', '+998 20 002 20 99');
  await setSettingIfMissing('company_address', 'г. Самарканд, ул. Мирзо Улугбека, 45');
  await setSettingIfMissing('tg_bot_token', '');
  await setSettingIfMissing('tg_chat_id', '');
  await setSettingIfMissing('eskiz_email', '');
  await setSettingIfMissing('eskiz_token', '');
  await setSettingIfMissing('eskiz_from', '4546');
  await setSettingIfMissing('google_sheets_webhook_url', 'https://script.google.com/macros/s/AKfycbz74Jtn1LCkIrtwDYjJegO0wstTqMPUoiY7B0xxr30sicHdpGofrILWO7qVrCbrAoVP/exec');
  await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('workshop_coordinates', '39.588503, 66.928409')");

  // Принудительное обновление актуальных контактов компании и курьера
  try {
    await db.run("UPDATE settings SET value = '+998 95 032 33 30' WHERE key = 'company_phone'");
    await db.run("UPDATE settings SET value = '+998 20 002 20 99' WHERE key = 'courier_phone'");
    await db.run("UPDATE employees SET phone = '+998 20 002 20 99' WHERE role = 'courier'");
    await db.run("UPDATE employees SET phone = '+998 95 032 33 30' WHERE role = 'admin'");
  } catch (e) {}

  // Очистка локальной таблицы orders (система работает исключительно с Google Таблицами)
  try {
    await db.run('DELETE FROM orders');
  } catch (e) {}

  isInitialized = true;
  // Фоновая первоначальная загрузка актуальных заказов из Google Таблиц
  syncOrdersFromGoogleSheets(true).catch(e => console.warn('Init sheets sync notice:', e.message));
}

initPromise = initDatabase().catch(err => console.error('Database initialization error:', err));

// Middleware готовности БД
app.use(async (req, res, next) => {
  if (initPromise) await initPromise;
  next();
});

// ================= RATE LIMITING ДЛЯ PIN =================
const pinAttempts = new Map();

function checkPinRateLimit(ip) {
  const now = Date.now();
  const rec = pinAttempts.get(ip);
  if (rec && rec.lockedUntil && now < rec.lockedUntil) {
    return { allowed: false, waitSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

function recordPinFailure(ip) {
  const now = Date.now();
  const rec = pinAttempts.get(ip) || { count: 0, resetAt: now + 60000 };
  rec.count++;
  if (rec.count >= 5) {
    rec.lockedUntil = now + 5 * 60000;
  }
  pinAttempts.set(ip, rec);
}

// ================= HELPER FUNCTIONS: TELEGRAM & ESKIZ SMS =================
async function sendTelegramNotification(text) {
  try {
    const tokenRow = await db.get("SELECT value FROM settings WHERE key = 'tg_bot_token'");
    const chatRow = await db.get("SELECT value FROM settings WHERE key = 'tg_chat_id'");
    const token = tokenRow?.value || process.env.TG_BOT_TOKEN;
    const chatId = chatRow?.value || process.env.TG_CHAT_ID;
    if (!token || !chatId) return { success: false, reason: 'Токен бота или ID чата не настроены' };

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      })
    });
    const data = await res.json();
    if (!data.ok && (data.description || '').toLowerCase().includes('parse')) {
      // Fallback: send as plain text without Markdown if markdown parsing failed
      const plainRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: false
        })
      });
      const plainData = await plainRes.json();
      return { success: plainData.ok, data: plainData };
    }
    return { success: data.ok, data };
  } catch (err) {
    console.error('Telegram send error:', err);
    return { success: false, error: err.message };
  }
}

// ================= GLOBAL ESKIZ.UZ AUTO-AUTHENTICATION & TOKEN REFRESH =================
async function loginToEskiz(forcedEmail = null, forcedPassword = null) {
  try {
    const emailRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_email'");
    const passRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_password'");

    const email = forcedEmail || emailRow?.value || process.env.ESKIZ_EMAIL;
    const pass = forcedPassword || passRow?.value || process.env.ESKIZ_PASSWORD;

    if (!email || !pass) return null;

    const authFormData = new URLSearchParams();
    authFormData.append('email', String(email).trim());
    authFormData.append('password', String(pass).trim());

    const authRes = await fetch('https://notify.eskiz.uz/api/auth/login', {
      method: 'POST',
      body: authFormData
    });
    const authData = await authRes.json();

    if (authRes.ok && authData?.data?.token) {
      const freshToken = authData.data.token;
      await db.run("INSERT INTO settings (key, value) VALUES ('eskiz_email', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(email).trim()]);
      await db.run("INSERT INTO settings (key, value) VALUES ('eskiz_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(pass).trim()]);
      await db.run("INSERT INTO settings (key, value) VALUES ('eskiz_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [freshToken]);
      console.log('✅ Eskiz.uz token successfully refreshed and saved to settings');
      return freshToken;
    } else {
      console.warn('Eskiz login rejected:', authData?.message || authRes.statusText);
    }
  } catch (authErr) {
    console.warn('Auto Eskiz login network error:', authErr.message);
  }
  return null;
}

async function sendEskizSms(phone, message, orderId) {
  try {
    const tokenRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_token'");
    const fromRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_from'");
    const emailRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_email'");
    const passRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_password'");

    let token = tokenRow?.value || process.env.ESKIZ_TOKEN;
    const from = fromRow?.value || process.env.ESKIZ_FROM || '4546';
    const email = emailRow?.value || process.env.ESKIZ_EMAIL;
    const pass = passRow?.value || process.env.ESKIZ_PASSWORD;

    // inner loginToEskiz delegated to global loginToEskiz

    if (!token) {
      token = await loginToEskiz();
    }

    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 9) cleanPhone = '998' + cleanPhone;

    if (!token) {
      console.log(`[SMS SIMULATED (Токен Eskiz не настроен) -> ${cleanPhone}]: ${message}`);
      if (orderId) {
        await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
          [orderId, 'Система (SMS)', `Симуляция SMS (Eskiz не настроен) на ${cleanPhone}`, new Date().toISOString()]);
      }
      return { success: false, simulated: true, cleanPhone, message, reason: 'Токен Eskiz.uz не настроен в Настройках CRM' };
    }

    const formData = new URLSearchParams();
    formData.append('mobile_phone', cleanPhone);
    formData.append('message', message);
    formData.append('from', from);

    let res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (res.status === 401) {
      const freshToken = await loginToEskiz();
      if (freshToken) {
        token = freshToken;
        res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
      }
    }

    const data = await res.json();

    if (orderId) {
      await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
        [orderId, 'Система (SMS)', `Отправлено SMS на ${cleanPhone}: ${res.ok ? 'Успешно' : 'Ошибка: ' + (data?.message || res.statusText)}`, new Date().toISOString()]);
    }
    return { success: res.ok, simulated: false, data, error: res.ok ? null : (data?.message || res.statusText) };
  } catch (err) {
    console.error('Eskiz SMS error:', err);
    return { success: false, simulated: false, error: err.message };
  }
}

function formatSmsMessage(type, order, carpets, totalM2, totalPrice) {
  const client = (order?.client_name || 'Mijoz').trim();
  const orderId = order?.id || '';
  const courier = (cleanCourierName(order?.courier_name) || 'Haydovchi').trim();
  const trackingUrl = `https://cosmo-crm.uz/#track-${orderId}`;
  const sum = Number(totalPrice || order?.total_price || 0).toLocaleString('ru-RU');
  
  let itemsStr = 'Gilam';
  if (Array.isArray(carpets) && carpets.length > 0) {
    itemsStr = carpets.map(c => `${c.name || 'Gilam'} (${c.area ? c.area + ' m²' : (c.qty || 1) + ' dona'})`).join(', ');
  } else if (order?.carpets_json) {
    try {
      const parsed = JSON.parse(order.carpets_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        itemsStr = parsed.map(c => `${c.name || 'Gilam'} (${c.area ? c.area + ' m²' : (c.qty || 1) + ' dona'})`).join(', ');
      }
    } catch(e) {}
  }

  const isUzbek = (order?.language || '').toLowerCase().includes('uz') || (order?.language || '').toLowerCase().includes('o\'z') || !order?.language;

  if (type === 'created') {
    if (isUzbek) {
      return `Assalomu alaykum ${client}\n\nBuyurtmangiz qabul qilindi: #${orderId}\nHolati: Qabul qilindi\nKuryer: ${courier}\n\nBuyurtmani kuzatish: ${trackingUrl}\n\nBuyurtmangiz tayyor bo'lishi bilan haydovchimiz siz bilan bog'lanadi.\n\nHurmat bilan, Cosmo CRM\nGilam yuvish markazi\n+998 20 002 2099`;
    }
    return `COSMO: Ваш заказ #${orderId} принят в работу. Курьер: ${courier}. Отслеживание: ${trackingUrl}. Тел: +998 20 002 2099`;
  }

  if (type === 'measured') {
    if (isUzbek) {
      return `Assalomu alaykum ${client}\n\nBuyurtmangiz raqami: #${orderId}\n\nBuyurtma tarkibi:\n${itemsStr}\n\nUmumiy summa: ${sum} so'm\nHolati: O'lchandi\nKuryer: ${courier}\n\nBuyurtmani kuzatish: ${trackingUrl}\n\nBuyurtmangiz tayyor bo'lishi bilan haydovchimiz siz bilan bog'lanadi.\n\nHurmat bilan, Cosmo CRM\nGilam yuvish markazi\n+998 20 002 2099`;
    }
    return `COSMO: Заказ #${orderId} замерен: ${itemsStr}. Площадь: ${(totalM2 || 0).toFixed(2)} м². Сумма к оплате: ${sum} сум. Статус: В стирке. Тел: +998 20 002 2099`;
  }

  if (type === 'ready') {
    if (isUzbek) {
      const cleanId = String(orderId || '').replace(/^#/, '');
      return `Assalomu alaykum ${client}\n\nBuyurtmangiz - ${cleanId}\n\nBuyurtma tarkibi:\n\n${itemsStr}\n\nStatusi: Yuvildi!\n\nJami: ${sum} so'm\n\nHaydovchi: ${courier}\n\nBuyurtmangiz tayyor bo'lishi bilan xodimlarimiz siz bilan bog'lanishadi.\n\nBiz bilan bog'lanish: +998 20 002 2099`;
    }
    return `COSMO: Заказ #${orderId} постиран и готов к доставке. К оплате: ${sum} сум. Курьер: ${courier}. Тел: +998 20 002 2099`;
  }

  if (type === 'delivered') {
    if (isUzbek) {
      return `Assalomu alaykum ${client}. Buyurtmangiz #${orderId} muvaffaqiyatli yetkazildi. Rahmat! Cosmo CRM: +998 20 002 2099`;
    }
    return `COSMO: Заказ #${orderId} успешно доставлен. Спасибо за доверие! Оцените наш сервис: ${trackingUrl}`;
  }

  return `COSMO: Заказ #${orderId}. Тел: +998 20 002 2099`;
}

function formatTelegramOrderCard(order) {
  if (!order) return '';
  let carpets = [];
  try { carpets = Array.isArray(order.carpets) ? order.carpets : JSON.parse(order.carpets_json || '[]'); } catch (e) { carpets = []; }
  let extras = [];
  try { extras = Array.isArray(order.extras) ? order.extras : JSON.parse(order.extras_json || '[]'); } catch (e) { extras = []; }
  const carpetLines = carpets.map((c, i) => `  • Ковер #${i + 1}: ${c.length || '?'} × ${c.width || '?'} м (${(c.area || 0).toFixed(1)} м²) — ${(c.total || c.price || 0).toLocaleString('ru-RU')} сум`).join('\n');
  const extrasLine = extras.length > 0 ? `\n✨ *Доп. услуги:* ${extras.join(', ')}` : '';
  const gpsLink = order.gps_location && order.gps_location.includes(',')
    ? `\n🧭 [Яндекс.Навигатор](https://yandex.ru/maps/?rtext=~${order.gps_location.trim()}&rtt=auto) | [Google Maps](https://www.google.com/maps/dir/?api=1&destination=${order.gps_location.trim()}&travelmode=driving)`
    : '';
  const trackLink = `https://barokot-crm.vercel.app/#track-${order.id}`;

  return `📦 *НОВЫЙ ВЫЕЗД: ЗАКАЗ #${order.id}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Клиент:* ${order.client_name}\n` +
    `📞 *Телефон:* ${order.client_phone}\n` +
    `📍 *Адрес:* ${order.client_address}\n` +
    `🏘️ *Район:* ${order.district || 'Самарканд'} ${order.landmark ? `(Ориентир: ${order.landmark})` : ''}\n` +
    `🕒 *Время:* ${order.time_slot || 'В любое время'}\n` +
    `🚚 *Экипаж:* ${order.courier_name || 'Не назначен'}\n` +
    `💰 *Сумма:* ${(order.total_price || 0).toLocaleString('ru-RU')} сум (${order.paid ? '✅ Оплачено' : '💵 Оплата при доставке'})\n` +
    (carpetLines ? `\n📋 *Изделия:*\n${carpetLines}` : '') +
    extrasLine +
    (order.notes ? `\n💬 *Примечание:* ${order.notes}` : '') +
    gpsLink +
    `\n📱 [Онлайн-трекинг заказа](${trackLink})`;
}

// ================= HELPER FUNCTIONS: GOOGLE SHEETS SYNC =================
const DEFAULT_GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbz74Jtn1LCkIrtwDYjJegO0wstTqMPUoiY7B0xxr30sicHdpGofrILWO7qVrCbrAoVP/exec';
const DEFAULT_GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1-B_5nuofUe4XZhPMliyXoksdcKH9fbGcYifmddSWMf4/gviz/tq?tqx=out:csv&sheet=Cosmo';

async function getGoogleSheetsWebhookUrl() {
  try {
    const row = await db.get("SELECT value FROM settings WHERE key = 'google_sheets_webhook_url'");
    if (row && row.value && row.value.trim().startsWith('http')) {
      return row.value.trim();
    }
  } catch (e) {}
  return process.env.GOOGLE_SHEETS_WEBHOOK_URL || DEFAULT_GOOGLE_SHEETS_URL;
}

const STAGE_LABELS_RU = {
  'pickup': '1. К забору',
  'in_shop': '2. В цеху',
  'dusting': '2. В цеху',
  'washing': '2. В цеху',
  'drying': '2. В цеху',
  'ready': '3. Готов к доставке',
  'delivery': '3. Готов к доставке',
  'delivered': '4. Доставлен',
  'cancelled': 'Отменен'
};

const STAGE_RU_TO_EN = {
  'Забор ковров (Выезд)': 'pickup',
  'Забор': 'pickup',
  '1. Забор': 'pickup',
  'К забору': 'pickup',
  '1. К забору': 'pickup',
  'Ожидает забора': 'pickup',
  '1. Ожидает забора': 'pickup',
  'Ожидает': 'pickup',
  'Заявка': 'pickup',
  'Новая заявка': 'pickup',
  'Новый': 'pickup',
  'Принята': 'pickup',
  'Принят': 'pickup',
  'Прием': 'pickup',
  'Выезд': 'pickup',
  '1. Выезд': 'pickup',
  'Заявка принята': 'pickup',
  'Стирка / В цехе': 'in_shop',
  'Стирка в цехе': 'in_shop',
  'В цеху': 'in_shop',
  'В цехе': 'in_shop',
  '2. В цеху': 'in_shop',
  '2. Стирка / В цехе': 'in_shop',
  '2. Стирка': 'in_shop',
  'Выбивание пыли': 'in_shop',
  'Сушильная камера': 'in_shop',
  'Стирка': 'in_shop',
  'Цех': 'in_shop',
  'Стираются': 'in_shop',
  'Сушатся': 'in_shop',
  '3. Готов в цеху': 'ready',
  'Готов к доставке': 'ready',
  '3. Готов к доставке': 'ready',
  'Готов в цеху': 'ready',
  'Готов': 'ready',
  '3. Готов': 'ready',
  'Постиран': 'ready',
  'Доставка клиенту': 'ready',
  'На доставке': 'ready',
  'В авто': 'ready',
  '3. На доставке': 'ready',
  'Доставка': 'ready',
  'В машине': 'ready',
  'Доставлен / Оплачен': 'delivered',
  '4. Доставлен': 'delivered',
  'Доставлен': 'delivered',
  'Выполнен': 'delivered',
  '4. Выполнен': 'delivered',
  'Завершен': 'delivered',
  'Оплачен': 'delivered',
  'Отменен': 'cancelled',
  'Отмена': 'cancelled'
};

function normalizeStage(stage) {
  if (!stage) return 'pickup';
  const str = String(stage).trim();
  if (STAGE_RU_TO_EN[str]) return STAGE_RU_TO_EN[str];
  const lower = str.toLowerCase();
  if (['pickup', 'забор', '1. забор', 'к забору', '1. к забору', 'ожидает забора', '1. ожидает забора', 'ожидает', 'заявка', 'новая заявка', 'новый', 'принят', 'принята', 'прием', 'выезд', '1. выезд', 'new', 'pending', 'created', 'lead'].includes(lower)) return 'pickup';
  if (['in_shop', 'measuring', 'замер', 'dusting', 'washing', 'drying', 'in_wash', 'wash', 'в цеху', 'в цехе', 'стирка / в цехе', 'стирка в цехе', 'стирка', 'цех', '2. в цеху', '2. стирка / в цехе', '2. стирка', 'стираются', 'сушатся', 'сушильная камера', 'выбивание пыли'].includes(lower)) return 'in_shop';
  if (['ready', 'готов к доставке', 'готов', 'готов в цеху', '3. готов к доставке', '3. готов', '3. готов в цеху', 'постиран', 'delivery', 'на доставке', 'в авто', '3. на доставке', 'доставка', 'в машине', 'доставка клиенту'].includes(lower)) return 'ready';
  if (['delivered', 'доставлен', 'доставлен / оплачен', 'выполнен', '4. доставлен', '4. выполнен', 'завершен', 'оплачен', 'done', 'completed'].includes(lower)) return 'delivered';
  if (['cancelled', 'canceled', 'отменен', 'отмена'].includes(lower)) return 'cancelled';
  return str;
}

function cleanMojibake(str) {
  if (!str) return '';
  let s = String(str);
  s = s.replace(/РќР°Р»РёС‡РЅС‹Рµ/g, 'Наличные');
  s = s.replace(/РќРµ РЅР°Р·РЅР°С‡РµРЅ/g, 'Не назначен');
  s = s.replace(/Р¦РµС…/g, 'Цех');
  s = s.replace(/РЎРёС‘Р±/g, 'Сиёб');
  s = s.replace(/РџСЂРёРЅСЏС‚/g, 'Принят');
  s = s.replace(/рџ—‘пёЏ\s*\[РЈР”РђР›Р•Рќ\]/g, '🗑️ [УДАЛЕН]');
  s = s.replace(/\[РЈР”РђР›Р•Рќ\]/g, '🗑️ [УДАЛЕН]');
  return s.trim();
}

function cleanCourierName(name) {
  if (!name) return '';
  const s = cleanMojibake(name);
  const lower = s.toLowerCase();
  if (
    lower === 'не назначен' ||
    lower.includes('не назначен') ||
    lower.includes('свободн') ||
    lower.includes('экипаж не назначен') ||
    lower.includes('рќр') ||
    lower === '--' ||
    lower === '-' ||
    lower === 'null' ||
    lower === 'undefined'
  ) {
    return '';
  }
  return s;
}

// ================= GOOGLE SHEETS AS PRIMARY ORDERS STORE =================
let ordersMemory = [];
let lastSheetsSyncTime = 0;
let isSyncingFromSheets = false;

// Надежный парсер CSV по спецификации RFC-4180 с поддержкой многострочных полей в кавычках
function parseCsvProper(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      if (currentRow.some(f => f.trim().length > 0)) rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.trim().length > 0)) rows.push(currentRow);
  }
  return rows;
}

function findCachedOrder(id) {
  return ordersMemory.find(o => String(o.id).trim() === String(id).trim());
}

function upsertCachedOrder(order) {
  const targetId = String(order.id).trim();
  const idx = ordersMemory.findIndex(o => String(o.id).trim() === targetId);
  if (idx !== -1) {
    ordersMemory[idx] = { ...ordersMemory[idx], ...order };
  } else {
    ordersMemory.unshift(order);
  }
}

function removeCachedOrder(id) {
  ordersMemory = ordersMemory.filter(o => String(o.id).trim() !== String(id).trim());
}

// Очередь асинхронной синхронизации в Google Таблицы (устраняет задержку HTTP ответов и защищает от 429/lock)
const sheetsSyncQueue = [];
let isProcessingSheetsQueue = false;

function enqueueSheetsSync(order, action = 'upsert') {
  if (!order || !order.id) return;
  const targetId = String(order.id).trim();
  const idx = sheetsSyncQueue.findIndex(item => String(item.order.id).trim() === targetId);
  if (idx !== -1) {
    sheetsSyncQueue[idx] = { order, action, timestamp: Date.now() };
  } else {
    sheetsSyncQueue.push({ order, action, timestamp: Date.now() });
  }
  setImmediate(processSheetsQueue);
}

async function processSheetsQueue() {
  if (isProcessingSheetsQueue || sheetsSyncQueue.length === 0) return;
  isProcessingSheetsQueue = true;
  try {
    while (sheetsSyncQueue.length > 0) {
      const item = sheetsSyncQueue.shift();
      try {
        await syncOrderToGoogleSheets(item.order, item.action);
      } catch (e) {
        console.warn(`[SheetsQueue] Error syncing order #${item.order?.id}:`, e.message);
      }
      if (sheetsSyncQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    }
  } finally {
    isProcessingSheetsQueue = false;
  }
}

async function syncOrdersFromGoogleSheets(force = false) {
  const now = Date.now();
  if (!force && (now - lastSheetsSyncTime < 10000)) return ordersMemory;
  if (isSyncingFromSheets) return ordersMemory;
  isSyncingFromSheets = true;
  lastSheetsSyncTime = now;

  try {
    const sep = DEFAULT_GOOGLE_SHEETS_CSV_URL.includes('?') ? '&' : '?';
    const fetchUrl = `${DEFAULT_GOOGLE_SHEETS_CSV_URL}${sep}_cb=${Date.now()}`;
    const res = await fetch(fetchUrl, {
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) {
      isSyncingFromSheets = false;
      return ordersMemory;
    }
    const csvText = await res.text();
    const rows = parseCsvProper(csvText);
    if (rows.length <= 1) {
      ordersMemory = [];
      isSyncingFromSheets = false;
      return ordersMemory;
    }

    const loadedOrders = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const id = String(r[0] || '').trim();
      if (!id || id === 'номер ID' || id === 'ID Заказа' || id === 'CSM-TEST' || id === 'BRK-TEST') continue;

      const stageRaw = String(r[6] || '').trim();
      const isDeleted = (
        stageRaw.toLowerCase().includes('удален') ||
        stageRaw.includes('РЈР”РђР›Р•Рќ') ||
        stageRaw.includes('рџ') ||
        stageRaw.includes('🗑') ||
        stageRaw.includes('Очистка') ||
        stageRaw.toLowerCase().includes('корзин')
      ) ? 1 : 0;
      const cleanStageRaw = cleanMojibake(stageRaw
        .replace(/🗑️\s*\[УДАЛЕН\]:\s*|\[УДАЛЕН\]:\s*|\[УДАЛЕН\]/gi, '')
        .replace(/рџ[^\s]*\s*\[РЈР”РђР›Р•Рќ\]:\s*|\[РЈР”РђР›Р•Рќ\]:\s*/gi, '')
        .replace(/Очистка всех заказов/gi, '')
        .trim());
      const stage = normalizeStage(cleanStageRaw || 'pickup');

      const createdAt = String(r[1] || '').trim() || new Date().toLocaleDateString('ru-RU');
      const clientName = cleanMojibake(String(r[2] || '').trim());
      const rawPhone = String(r[3] || '').replace(/^'/, '').trim();
      const clientPhone = rawPhone.startsWith('#') ? '+998 95 032 33 30' : rawPhone;
      const clientAddress = cleanMojibake(String(r[4] || '').trim());
      const district = cleanMojibake(String(r[5] || 'Сиёб').trim()) || 'Сиёб';
      const totalM2 = parseFloat(String(r[7] || '').replace(',', '.')) || 0;
      const totalPrice = parseInt(String(r[8] || '').replace(/\D/g, ''), 10) || 0;
      const paidAmount = parseInt(String(r[9] || '').replace(/\D/g, ''), 10) || 0;
      const paid = (paidAmount >= totalPrice && totalPrice > 0) ? 1 : 0;
      const rawMethod = String(r[10] || 'cash').toLowerCase().trim();
      let paymentMethod = 'cash';
      if (rawMethod.includes('click')) paymentMethod = 'click';
      else if (rawMethod.includes('payme')) paymentMethod = 'payme';
      else if (rawMethod.includes('card') || rawMethod.includes('карт')) paymentMethod = 'card';
      paymentMethod = cleanMojibake(paymentMethod);
      const courierName = cleanCourierName(r[11] || '');
      const washerName = cleanMojibake(String(r[12] || '').trim()) || 'Цех';
      const deliveryDate = String(r[13] || '').trim();
      const notes = cleanMojibake(String(r[14] || '').trim());

      const existingMem = findCachedOrder(id);
      const carpets = (existingMem && existingMem.carpets && existingMem.carpets.length > 0)
        ? existingMem.carpets
        : [{ name: 'Ковер', area: totalM2, price: 16000, total: totalPrice }];

      loadedOrders.push({
        id,
        client_name: clientName,
        client_phone: clientPhone,
        client_address: clientAddress,
        district,
        stage,
        total_m2: totalM2,
        total_price: totalPrice,
        paid_amount: paidAmount,
        paid: Boolean(paid),
        payment_method: paymentMethod,
        courier_name: courierName,
        washer_name: washerName,
        dispatcher_name: existingMem ? existingMem.dispatcher_name : 'Диспетчер',
        delivery_date: deliveryDate,
        delivery_time: existingMem ? existingMem.delivery_time : '',
        notes,
        carpets,
        carpets_json: JSON.stringify(carpets),
        extras: existingMem ? existingMem.extras : [],
        extras_json: existingMem ? existingMem.extras_json : '[]',
        photos: existingMem ? existingMem.photos : [],
        photos_json: existingMem ? existingMem.photos_json : '[]',
        created_at: createdAt,
        pickup_date: existingMem ? existingMem.pickup_date : createdAt,
        is_deleted: Boolean(isDeleted),
        landmark: existingMem ? existingMem.landmark : '',
        language: existingMem ? existingMem.language : 'Русский',
        time_slot: existingMem ? existingMem.time_slot : 'В любое время',
        urgent: existingMem ? Boolean(existingMem.urgent) : false,
        gps_location: existingMem ? existingMem.gps_location : '',
        sms_sent_stages: existingMem ? existingMem.sms_sent_stages : '',
        tg_sent: existingMem ? existingMem.tg_sent : 0,
        rating: existingMem ? existingMem.rating : 0,
        review_text: existingMem ? existingMem.review_text : '',
        completed_date: stage === 'delivered' ? (existingMem?.completed_date || deliveryDate || new Date().toISOString()) : null
      });
    }

    // Сохраняем недавние локальные заказы (до 60 сек), чтобы они не затирались при задержке экспорта Google Sheets
    const recentLocalOrders = ordersMemory.filter(o => o.created_locally_at && (Date.now() - o.created_locally_at < 60000));
    const loadedIds = new Set(loadedOrders.map(o => o.id));
    const preserved = recentLocalOrders.filter(o => !loadedIds.has(o.id));
    ordersMemory = [...preserved, ...loadedOrders];
  } catch (err) {
    console.warn('Sync from Google Sheets error:', err.message);
  } finally {
    isSyncingFromSheets = false;
  }
  return ordersMemory;
}

async function syncOrderToGoogleSheets(order, action = 'upsert') {
  try {
    const webhookUrl = await getGoogleSheetsWebhookUrl();
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return { success: false, reason: 'Google Sheets webhook URL not configured' };
    }

    const payloadOrder = {
      ...order,
      brand: 'COSMO',
      sheet_name: 'Cosmo',
      client_phone: order.client_phone ? ("'" + String(order.client_phone).replace(/^'/, '')) : '',
      stage_ru: STAGE_LABELS_RU[order.stage] || order.stage || 'Принят'
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        brand: 'COSMO',
        sheet_name: 'Cosmo',
        order: payloadOrder
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(6000)
    });

    const data = await res.json().catch(() => null);
    return { success: res.ok, data };
  } catch (err) {
    console.warn('Google Sheets sync notice:', err.message);
    return { success: false, error: err.message };
  }
}

async function syncAllOrdersToGoogleSheets() {
  try {
    const webhookUrl = await getGoogleSheetsWebhookUrl();
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
      return { success: false, reason: 'Google Sheets webhook URL not configured' };
    }

    const activeOrders = ordersMemory.filter(o => !o.is_deleted);
    const formattedOrders = activeOrders.map(o => ({
      ...o,
      stage_ru: STAGE_LABELS_RU[o.stage] || o.stage || 'Принят'
    }));

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'batch_sync',
        orders: formattedOrders
      }),
      redirect: 'follow'
    });

    const data = await res.json().catch(() => null);
    return { success: res.ok, count: activeOrders.length, data };
  } catch (err) {
    console.warn('Google Sheets batch sync notice:', err.message);
    return { success: false, error: err.message };
  }
}

// ================= API ENDPOINTS =================

// 1. Авторизация по PIN-коду
app.post('/api/auth/pin', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rate = checkPinRateLimit(ip);
  if (!rate.allowed) {
    return res.status(429).json({ error: `Слишком много неверных попыток. Подождите ${rate.waitSec} сек.` });
  }

  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'Введите PIN-код' });

  const emp = await db.get("SELECT id, name, role, phone, base_salary, status FROM employees WHERE pin = ? AND (status = 'active' OR status IS NULL)", [String(pin)]);
  if (!emp) {
    recordPinFailure(ip);
    return res.status(401).json({ error: 'Неверный PIN-код. Проверьте код и попробуйте снова.' });
  }

  pinAttempts.delete(ip);
  const token = require('node:crypto').randomBytes(24).toString('hex');
  res.json({ success: true, token, user: emp });
});

// 2. Сотрудники
app.get('/api/employees', async (req, res) => {
  const rows = await db.all('SELECT id, name, role, phone, base_salary, status FROM employees ORDER BY id ASC');
  res.json(rows);
});

app.post('/api/employees', async (req, res) => {
  const { name, role, pin, phone, base_salary } = req.body;
  if (!name || !role || !pin) return res.status(400).json({ error: 'Заполните обязательные поля сотрудника' });
  const cleanPin = String(pin).trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'PIN-код сотрудника должен состоять ровно из 4 цифр' });
  }

  const info = await db.run('INSERT INTO employees (name, role, pin, phone, base_salary, status) VALUES (?, ?, ?, ?, ?, ?)',
    [String(name).trim(), String(role).trim(), cleanPin, String(phone || '').trim(), Math.max(0, Number(base_salary) || 4000000), 'active']);

  res.json({ success: true, id: info.lastInsertRowid });
});

app.put('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  const { name, role, pin, phone, base_salary, status } = req.body;
  const existing = await db.get('SELECT * FROM employees WHERE id = ?', [Number(id)]);
  if (!existing) return res.status(404).json({ error: 'Сотрудник не найден' });

  const cleanPin = pin ? String(pin).trim() : existing.pin;
  if (pin && !/^\d{4}$/.test(cleanPin)) {
    return res.status(400).json({ error: 'PIN-код должен состоять ровно из 4 цифр' });
  }

  await db.run(`
    UPDATE employees 
    SET name = ?, role = ?, pin = ?, phone = ?, base_salary = ?, status = ?
    WHERE id = ?
  `, [
    String(name || existing.name).trim(),
    String(role || existing.role).trim(),
    cleanPin,
    String(phone !== undefined ? phone : existing.phone).trim(),
    Math.max(0, Number(base_salary !== undefined ? base_salary : existing.base_salary) || 4000000),
    status || existing.status || 'active',
    Number(id)
  ]);

  res.json({ success: true });
});

app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM employees WHERE id = ?', [Number(id)]);
  res.json({ success: true });
});

// 3. Каталог услуг и тарифов
app.get('/api/services', async (req, res) => {
  const rows = await db.all('SELECT * FROM services ORDER BY rowid ASC');
  res.json(rows);
});

app.post('/api/services', async (req, res) => {
  const { id, name, category, unit, price, icon } = req.body;
  const serviceId = id || `S-${Date.now().toString().slice(-4)}`;
  await db.run('INSERT INTO services (id, name, category, unit, price, icon) VALUES (?, ?, ?, ?, ?, ?)',
    [serviceId, name, category || 'Ковры', unit || 'м²', Number(price) || 0, icon || 'Layers']);
  res.json({ success: true, id: serviceId });
});

app.put('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category, unit, price, icon } = req.body;
  await db.run('UPDATE services SET name = ?, category = ?, unit = ?, price = ?, icon = ? WHERE id = ?',
    [name, category, unit, Number(price), icon || 'Layers', id]);
  res.json({ success: true });
});

app.delete('/api/services/:id', async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM services WHERE id = ?', [id]);
  res.json({ success: true });
});

// 4. Заказы (Единый источник истины: Google Таблицы)
app.get('/api/orders', async (req, res) => {
  const { stage, district, search, deleted, includeDeleted, refresh } = req.query;

  if (refresh === '1' || refresh === 'true' || ordersMemory.length === 0) {
    await syncOrdersFromGoogleSheets(Boolean(refresh));
  } else {
    syncOrdersFromGoogleSheets(false).catch(() => {});
  }

  const isTrash = deleted === '1' || deleted === 'true' || includeDeleted === 'true' || includeDeleted === '1';
  let list = ordersMemory.filter(o => isTrash ? o.is_deleted : !o.is_deleted);

  if (stage && stage !== 'all') {
    list = list.filter(o => o.stage === stage);
  }

  if (district && district !== 'all') {
    list = list.filter(o => o.district === district);
  }

  if (search) {
    const s = search.toLowerCase();
    list = list.filter(o =>
      (o.id && o.id.toLowerCase().includes(s)) ||
      (o.client_name && o.client_name.toLowerCase().includes(s)) ||
      (o.client_phone && o.client_phone.toLowerCase().includes(s)) ||
      (o.client_address && o.client_address.toLowerCase().includes(s))
    );
  }

  res.json(list);
});

app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  let order = findCachedOrder(id);
  if (!order) {
    await syncOrdersFromGoogleSheets(true);
    order = findCachedOrder(id);
  }
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(order);
});

// Создание нового заказа
app.post('/api/orders', async (req, res) => {
  const {
    custom_id, client_name, client_phone, client_address, district, landmark, language,
    time_slot, urgent, pickup_date, delivery_date, delivery_time,
    stage, courier_name, washer_name, dispatcher_name,
    carpets, extras, notes, gps_location
  } = req.body;

  const trimmedName = String(client_name || '').trim();
  const trimmedPhone = String(client_phone || '').trim();
  const trimmedAddress = String(client_address || '').trim();

  if (!trimmedName || !trimmedPhone || !trimmedAddress) {
    return res.status(400).json({ error: 'Заполните обязательные поля: имя, телефон и адрес' });
  }

  let orderId = '';
  if (custom_id && String(custom_id).trim()) {
    const candidateId = String(custom_id).trim();
    if (findCachedOrder(candidateId)) {
      return res.status(400).json({ error: `Заказ с номером "${candidateId}" уже существует!` });
    }
    orderId = candidateId;
  } else {
    let maxNum = 1000;
    ordersMemory.forEach(row => {
      if (row.id && (row.id.startsWith('CSM-') || row.id.startsWith('BRK-'))) {
        const num = parseInt(row.id.replace(/^(CSM-|BRK-)/, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    orderId = `CSM-${maxNum + 1}`;
  }

  const items = Array.isArray(carpets) && carpets.length > 0 ? carpets : [
    { name: 'Gilam Standart', unit: 'м²', qty: 1, price: 16000, total: 0 }
  ];

  let totalM2 = 0;
  let totalPrice = 0;

  items.forEach(c => {
    if (!c || typeof c !== 'object') return;
    const area = parseFloat(c.area) || (parseFloat(c.length || 0) * parseFloat(c.width || 0)) || 0;
    totalM2 += Math.max(0, area);
    if (c.unit === 'шт' || c.unit === 'комплект') {
      totalPrice += Math.max(0, parseFloat(c.qty) || 1) * Math.max(0, parseFloat(c.price) || 0);
    } else if (c.total) {
      totalPrice += Math.max(0, parseFloat(c.total) || 0);
    } else if (area > 0) {
      totalPrice += Math.max(0, area * (parseFloat(c.price) || 16000));
    }
  });

  if (urgent) totalPrice = Math.round(totalPrice * 1.2);

  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;

  // Синхронизация клиента и наследование GPS
  const cleanPhone = trimmedPhone;
  const existingClient = await db.get('SELECT id, total_orders, total_spent, gps_location FROM clients WHERE phone = ?', [cleanPhone]);
  let finalGps = (gps_location || '').trim();
  if (!finalGps && existingClient && existingClient.gps_location && existingClient.gps_location.includes(',')) {
    finalGps = existingClient.gps_location.trim();
  }

  const createdOrder = {
    id: orderId,
    client_name: trimmedName,
    client_phone: trimmedPhone,
    client_address: trimmedAddress,
    district: String(district || 'Сиёб').trim(),
    landmark: String(landmark || '').trim(),
    language: String(language || 'Русский').trim(),
    time_slot: String(time_slot || 'В любое время').trim(),
    urgent: Boolean(urgent),
    created_at: dateStr,
    pickup_date: pickup_date || dateStr,
    delivery_date: delivery_date || '',
    delivery_time: delivery_time || '',
    stage: stage ? normalizeStage(stage) : 'pickup',
    courier_name: cleanCourierName(courier_name),
    washer_name: String(washer_name || '').trim(),
    dispatcher_name: String(dispatcher_name || 'Диспетчер').trim(),
    paid: false,
    paid_amount: 0,
    payment_method: 'cash',
    underpaid_reason: '',
    total_m2: +totalM2.toFixed(2),
    total_price: totalPrice,
    carpets: items,
    carpets_json: JSON.stringify(items),
    extras: extras || [],
    extras_json: JSON.stringify(extras || []),
    photos: [],
    photos_json: '[]',
    notes: notes || '',
    gps_location: finalGps,
    sms_sent_stages: 'pickup',
    tg_sent: 1,
    is_deleted: false,
    rating: 0,
    review_text: '',
    completed_date: null,
    created_locally_at: Date.now()
  };

  upsertCachedOrder(createdOrder);

  if (existingClient) {
    await db.run(`
      UPDATE clients 
      SET total_orders = total_orders + 1, total_spent = total_spent + ?, address = ?, district = ?, landmark = ?,
          gps_location = CASE WHEN ? != '' THEN ? ELSE gps_location END
      WHERE id = ?
    `, [totalPrice, trimmedAddress, district || 'Сиёб', landmark || '', finalGps, finalGps, existingClient.id]);
  } else {
    const newClientId = `CL-${Date.now().toString().slice(-4)}`;
    await db.run(`
      INSERT INTO clients (id, name, phone, address, district, landmark, language, tier, discount_percent, total_orders, total_spent, notes, gps_location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [newClientId, trimmedName, cleanPhone, trimmedAddress, district || 'Сиёб', landmark || '', language || 'Русский', 'Standard', 0, 1, totalPrice, 'Создан из заказа ' + orderId, finalGps]);
  }

  // Аудит
  try {
    await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
      [orderId, dispatcher_name || 'Диспетчер', `Создан заказ #${orderId}`, new Date().toISOString()]);
  } catch(e) {}

  // Автоматические уведомления и прямая запись в Google Таблицы (через неблокирующую очередь)
  sendTelegramNotification(formatTelegramOrderCard(createdOrder)).catch(e => console.warn('TG auto notify err:', e.message));
  const smsMsg = formatSmsMessage('created', createdOrder, items, totalM2, totalPrice);
  sendEskizSms(trimmedPhone, smsMsg, orderId).catch(e => console.warn('SMS auto notify err:', e.message));
  enqueueSheetsSync(createdOrder, 'upsert');

  res.json({ success: true, orderId, id: orderId, total_price: totalPrice });
});

// Обновление заказа
app.put('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const {
    new_id,
    client_name, client_phone, client_address, district, landmark, language,
    time_slot, urgent, pickup_date, delivery_date, delivery_time,
    stage, courier_name, washer_name, dispatcher_name, paid, paid_amount, payment_method, underpaid_reason,
    carpets, extras, notes, gps_location
  } = req.body;

  let currentId = id;
  let order = findCachedOrder(id);
  if (!order) {
    await syncOrdersFromGoogleSheets(true);
    order = findCachedOrder(id);
  }
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  if (new_id && String(new_id).trim() && String(new_id).trim() !== id) {
    const targetNewId = String(new_id).trim();
    if (findCachedOrder(targetNewId)) {
      return res.status(400).json({ error: `Заказ с номером "${targetNewId}" уже существует!` });
    }
    removeCachedOrder(id);
    order.id = targetNewId;
    currentId = targetNewId;
  }

  let totalM2 = 0;
  let totalPrice = 0;

  if (Array.isArray(carpets)) {
    carpets.forEach(c => {
      const area = parseFloat(c.area) || (parseFloat(c.length || 0) * parseFloat(c.width || 0)) || 0;
      totalM2 += area;
      if (c.unit === 'шт' || c.unit === 'комплект') {
        totalPrice += Math.max(0, parseFloat(c.qty) || 1) * Math.max(0, parseFloat(c.price) || 0);
      } else if (c.total) {
        totalPrice += Math.max(0, parseFloat(c.total) || 0);
      } else if (area > 0) {
        totalPrice += Math.max(0, area * (parseFloat(c.price) || 16000));
      }
    });
  }

  if (urgent) totalPrice = Math.round(totalPrice * 1.2);

  let finalCarpets = order.carpets;
  let finalTotalM2 = order.total_m2;
  let finalTotalPrice = order.total_price;

  if ((order.total_m2 > 0 || order.total_price > 0) && totalM2 === 0 && totalPrice === 0) {
    finalCarpets = order.carpets;
    finalTotalM2 = order.total_m2;
    finalTotalPrice = order.total_price;
  } else if (Array.isArray(carpets) && carpets.length > 0) {
    finalCarpets = carpets;
    finalTotalM2 = +totalM2.toFixed(2);
    finalTotalPrice = totalPrice;
  }

  const finalPaidAmount = paid_amount !== undefined ? Number(paid_amount) : order.paid_amount;
  const isPaid = paid !== undefined ? Boolean(paid) : (finalPaidAmount >= finalTotalPrice);
  const newStage = normalizeStage(stage || order.stage);
  const newCourier = cleanCourierName(courier_name !== undefined ? courier_name : order.courier_name);

  order.client_name = client_name !== undefined ? String(client_name).trim() : order.client_name;
  order.client_phone = client_phone !== undefined ? String(client_phone).trim() : order.client_phone;
  order.client_address = client_address !== undefined ? String(client_address).trim() : order.client_address;
  order.district = district !== undefined ? String(district).trim() : order.district;
  order.landmark = landmark !== undefined ? String(landmark).trim() : order.landmark;
  order.language = language !== undefined ? String(language).trim() : order.language;
  order.time_slot = time_slot !== undefined ? String(time_slot).trim() : order.time_slot;
  order.urgent = urgent !== undefined ? Boolean(urgent) : order.urgent;
  order.pickup_date = pickup_date !== undefined ? pickup_date : order.pickup_date;
  order.delivery_date = delivery_date !== undefined ? delivery_date : order.delivery_date;
  order.delivery_time = delivery_time !== undefined ? delivery_time : order.delivery_time;
  order.stage = newStage;
  order.courier_name = newCourier;
  order.washer_name = washer_name !== undefined ? String(washer_name).trim() : order.washer_name;
  order.dispatcher_name = dispatcher_name !== undefined ? String(dispatcher_name).trim() : order.dispatcher_name;
  order.paid = isPaid;
  order.paid_amount = finalPaidAmount;
  order.payment_method = payment_method !== undefined ? payment_method : order.payment_method;
  order.underpaid_reason = underpaid_reason !== undefined ? String(underpaid_reason).trim() : order.underpaid_reason;
  order.total_m2 = finalTotalM2;
  order.total_price = finalTotalPrice;
  order.carpets = finalCarpets;
  order.carpets_json = JSON.stringify(finalCarpets);
  if (extras) {
    order.extras = extras;
    order.extras_json = JSON.stringify(extras);
  }
  order.notes = notes !== undefined ? notes : order.notes;
  order.gps_location = gps_location !== undefined ? gps_location : order.gps_location;

  upsertCachedOrder(order);

  // Синхронизация GPS клиента
  const phone = client_phone || order.client_phone;
  if (gps_location && String(gps_location).includes(',') && phone) {
    try {
      await db.run('UPDATE clients SET gps_location = ? WHERE phone = ?', [String(gps_location).trim(), phone]);
    } catch (e) {}
  }

  // Уведомления SMS/TG
  const sentStages = order.sms_sent_stages ? order.sms_sent_stages.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (newStage === 'ready' && !sentStages.includes('ready')) {
    const readySms = formatSmsMessage('ready', { ...order, courier_name: newCourier, id: currentId }, finalCarpets, finalTotalM2, finalTotalPrice);
    sendEskizSms(phone, readySms, currentId).catch(e => console.warn('SMS ready err:', e.message));
    sentStages.push('ready');
    order.sms_sent_stages = sentStages.join(',');

    const readyTgMsg = `🧼 *ЗАКАЗ #${currentId} ГОТОВ К ДОСТАВКЕ!*\n` +
      `👤 Клиент: ${order.client_name}\n` +
      `📍 Адрес: ${order.client_address || 'Самарканд'} (${order.district || 'Сиёб'})\n` +
      `💰 К оплате: ${Number(finalTotalPrice || 0).toLocaleString('ru-RU')} сум\n` +
      `🚚 Курьер доставки: ${newCourier || 'Любой свободный'}\n` +
      `👤 Сотрудник: ${String(washer_name || dispatcher_name || 'Администратор').trim()}`;
    sendTelegramNotification(readyTgMsg).catch(e => console.warn('TG ready notify err:', e.message));
  } else if (newStage === 'delivered' && !sentStages.includes('delivered')) {
    const delSms = formatSmsMessage('delivered', { ...order, courier_name: newCourier, id: currentId }, finalCarpets, finalTotalM2, finalTotalPrice);
    sendEskizSms(phone, delSms, currentId).catch(e => console.warn('SMS delivered err:', e.message));
    sentStages.push('delivered');
    order.sms_sent_stages = sentStages.join(',');
  }

  enqueueSheetsSync(order, 'upsert');

  res.json({ success: true, id: currentId });
});

// Быстрое переключение этапа заказа (Kanban & Порталы)
app.patch('/api/orders/:id/stage', async (req, res) => {
  const { id } = req.params;
  const { stage, actor_name, courier_name, delivery_date, notes, carpets, gps_location } = req.body;
  let order = findCachedOrder(id);
  if (!order) {
    await syncOrdersFromGoogleSheets(true);
    order = findCachedOrder(id);
  }
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  if (Array.isArray(carpets) && carpets.length > 0) {
    order.carpets = carpets;
    order.carpets_json = JSON.stringify(carpets);
    order.total_m2 = carpets.reduce((sum, it) => sum + (Number(it.area) || ((Number(it.length) || 0) * (Number(it.width) || 0)) || 0), 0);
    const calcPrice = carpets.reduce((sum, it) => sum + (Number(it.total) || Number(it.price) || 0), 0);
    if (calcPrice > 0) order.total_price = calcPrice;
  }

  const oldStage = order.stage;
  const normalizedStage = normalizeStage(stage || order.stage);
  const newCourier = cleanCourierName(courier_name !== undefined ? courier_name : order.courier_name);
  order.stage = normalizedStage;
  order.courier_name = newCourier;
  if (delivery_date) order.delivery_date = delivery_date;
  if (notes) order.notes = notes;
  if (gps_location !== undefined && gps_location !== null) order.gps_location = gps_location;
  if (normalizedStage === 'delivered') order.completed_date = order.completed_date || new Date().toISOString();

  upsertCachedOrder(order);

  // Синхронизация GPS
  if (order.gps_location && String(order.gps_location).includes(',') && order.client_phone) {
    try {
      await db.run('UPDATE clients SET gps_location = ? WHERE phone = ?', [String(order.gps_location).trim(), order.client_phone]);
    } catch (e) {}
  }

  // Уведомления
  const sentStages = order.sms_sent_stages ? order.sms_sent_stages.split(',').map(s => s.trim()).filter(Boolean) : [];
  let smsResult = null;
  const phone = order.client_phone;

  if (normalizedStage === 'ready' && !sentStages.includes('ready')) {
    if (phone) {
      const readySms = formatSmsMessage('ready', { ...order, courier_name: newCourier, id }, order.carpets, order.total_m2, order.total_price);
      smsResult = await sendEskizSms(phone, readySms, id).catch(e => console.warn('SMS ready err:', e.message));
      sentStages.push('ready');
      order.sms_sent_stages = sentStages.join(',');
    }

    const readyTgMsg = `🧼 *ЗАКАЗ #${id} ГОТОВ К ДОСТАВКЕ!*\n` +
      `👤 Клиент: ${order.client_name}\n` +
      `📍 Адрес: ${order.client_address || 'Самарканд'} (${order.district || 'Сиёб'})\n` +
      `💰 К оплате: ${(Number(order.total_price) || 0).toLocaleString('ru-RU')} сум\n` +
      `🚚 Курьер доставки: ${newCourier || 'Любой свободный'}\n` +
      `👤 Сотрудник: ${String(actor_name || 'Мастер цеха').trim()}`;
    sendTelegramNotification(readyTgMsg).catch(e => console.warn('TG ready notify err:', e.message));
  } else if (normalizedStage === 'delivered' && !sentStages.includes('delivered')) {
    if (phone) {
      const delSms = formatSmsMessage('delivered', { ...order, courier_name: newCourier, id }, order.carpets, order.total_m2, order.total_price);
      smsResult = await sendEskizSms(phone, delSms, id).catch(e => console.warn('SMS delivered err:', e.message));
      sentStages.push('delivered');
      order.sms_sent_stages = sentStages.join(',');
    }
  }

  try {
    await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
      [id, actor_name || 'Сотрудник', `Смена статуса: ${oldStage} -> ${stage}`, new Date().toISOString()]);
  } catch(e) {}

  enqueueSheetsSync(order, 'upsert');

  res.json({ success: true, order, sms_simulated: Boolean(smsResult?.simulated) });
});

// Назначение / Принятие заказа курьером (1 клик)
app.patch('/api/orders/:id/assign-courier', async (req, res) => {
  const { id } = req.params;
  const { courier_name, actor_name } = req.body;
  let order = findCachedOrder(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const cleanedCourier = cleanCourierName(courier_name);
  order.courier_name = cleanedCourier;
  upsertCachedOrder(order);

  const actor = actor_name || cleanedCourier || 'Курьер';
  try {
    await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
      [id, actor, `Назначен курьер: ${cleanedCourier || 'Свободный экипаж'}`, new Date().toISOString()]);
  } catch (e) {}

  enqueueSheetsSync(order, 'upsert');
  res.json({ success: true, order, courier_name: cleanedCourier });
});

// Обновление GPS локации и адреса
app.patch('/api/orders/:id/location', async (req, res) => {
  const { id } = req.params;
  const { gps_location, client_address, district, landmark } = req.body;
  let order = findCachedOrder(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  if (gps_location !== undefined) order.gps_location = gps_location;
  if (client_address !== undefined) order.client_address = client_address;
  if (district !== undefined) order.district = district;
  if (landmark !== undefined) order.landmark = landmark;

  upsertCachedOrder(order);

  if (gps_location && String(gps_location).includes(',') && order.client_phone) {
    try {
      await db.run('UPDATE clients SET gps_location = ? WHERE phone = ?', [String(gps_location).trim(), order.client_phone]);
    } catch (e) {}
  }

  enqueueSheetsSync(order, 'upsert');
  res.json({ success: true, order });
});

// Мастер цеха: Сохранение замеров изделий & перевод заказа курьеру
app.patch('/api/orders/:id/measurements', async (req, res) => {
  try {
    const { id } = req.params;
    const { carpets, washer_name } = req.body;

    let order = findCachedOrder(id);
    if (!order) {
      await syncOrdersFromGoogleSheets(true);
      order = findCachedOrder(id);
    }
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    if (!Array.isArray(carpets) || carpets.length === 0) {
      return res.status(400).json({ error: 'Заполните замеры хотя бы одного изделия' });
    }

    let totalM2 = 0;
    let totalPrice = 0;

    const validCarpets = carpets.filter(c => c && typeof c === 'object');
    if (validCarpets.length === 0) {
      return res.status(400).json({ error: 'Нет корректных данных об изделиях' });
    }

    const measuredCarpets = validCarpets.map((c, idx) => {
      const rawW = parseFloat(c.width);
      const rawL = parseFloat(c.length);
      const w = isNaN(rawW) || rawW < 0 ? 0 : rawW;
      const l = isNaN(rawL) || rawL < 0 ? 0 : rawL;
      const unitStr = String(c.unit || 'м²').trim().toLowerCase();
      const isSqm = unitStr === 'м²' || unitStr === 'м2' || unitStr === 'm2' || unitStr === 'кв.м' || unitStr === 'кв м' || !c.unit;
      const isMeter = unitStr === 'метр' || unitStr === 'м' || unitStr === 'пог.м' || unitStr === 'метр (пог.м)';
      const p = Math.max(0, parseFloat(c.price) || 14000);

      let area = 0;
      let itemTotal = 0;

      if (isSqm) {
        area = +(w * l).toFixed(2);
        itemTotal = +(area * p).toFixed(0);
        totalM2 += area;
      } else if (isMeter) {
        area = +l.toFixed(2);
        itemTotal = +(l * p).toFixed(0);
      } else {
        const qty = Math.max(1, parseFloat(c.qty) || 1);
        area = qty;
        itemTotal = +(qty * p).toFixed(0);
      }

      totalPrice += itemTotal;

      return {
        name: String(c.name || `Изделие #${idx + 1}`).trim(),
        unit: isSqm ? 'м²' : (isMeter ? 'метр' : 'шт'),
        width: w,
        length: l,
        qty: Math.max(1, parseFloat(c.qty) || 1),
        area: area,
        price: p,
        total: itemTotal,
        defects: String(c.defects || '').trim()
      };
    });

    if (order.urgent) {
      totalPrice = Math.round(totalPrice * 1.2);
    }

    const targetStage = normalizeStage(req.body.stage || 'ready');
    let assignedCourier = cleanCourierName(order.courier_name || '');
    if (req.body.courier_name && String(req.body.courier_name).trim()) {
      assignedCourier = cleanCourierName(req.body.courier_name);
    }

    order.carpets = measuredCarpets;
    order.carpets_json = JSON.stringify(measuredCarpets);
    order.total_m2 = +totalM2.toFixed(2);
    order.total_price = totalPrice;
    order.washer_name = String(washer_name || 'Мастер цеха').trim();
    order.stage = targetStage;
    order.courier_name = assignedCourier;

    upsertCachedOrder(order);

    try {
      await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
        [id, String(washer_name || 'Мастер цеха').trim(), `Внесены замеры: ${totalM2.toFixed(2)} м², сумма: ${totalPrice.toLocaleString()} сум (этап: ${targetStage}, курьер: ${assignedCourier || 'Не назначен'})`, new Date().toISOString()]);
    } catch (e) {}

    const sentStages = order.sms_sent_stages ? order.sms_sent_stages.split(',').map(s => s.trim()).filter(Boolean) : [];
    let smsResult = null;
    const phone = order.client_phone;

    if (targetStage === 'ready' && !sentStages.includes('ready')) {
      if (phone) {
        const readySms = formatSmsMessage('ready', { ...order, courier_name: assignedCourier, id }, measuredCarpets, totalM2, totalPrice);
        smsResult = await sendEskizSms(phone, readySms, id).catch(e => console.warn('SMS ready err:', e.message));
        sentStages.push('ready');
        order.sms_sent_stages = sentStages.join(',');
      }
    }

    if (targetStage === 'ready') {
      const readyTgMsg = `🧼 *ЗАКАЗ #${id} ЗАМЕРЕН И ГОТОВ К ДОСТАВКЕ!*\n` +
        `👤 Клиент: ${order.client_name}\n` +
        `📍 Адрес: ${order.client_address || 'Самарканд'} (${order.district || 'Сиёб'})\n` +
        `📐 Изделий: ${measuredCarpets.length} шт | Площадь: ${totalM2.toFixed(2)} м²\n` +
        `💰 К оплате: ${totalPrice.toLocaleString('ru-RU')} сум\n` +
        `🚚 Курьер доставки: ${assignedCourier || 'Любой свободный'}\n` +
        `🧼 Мастер цеха: ${String(washer_name || 'Мастер цеха').trim()}`;
      sendTelegramNotification(readyTgMsg).catch(e => console.warn('TG ready notify err:', e.message));
    }

    enqueueSheetsSync(order, 'upsert');

    res.json({
      success: true,
      total_m2: +totalM2.toFixed(2),
      total_price: totalPrice,
      stage: targetStage,
      carpets: measuredCarpets,
      courier_name: assignedCourier,
      sms_simulated: Boolean(smsResult?.simulated),
      sms_sent: Boolean(smsResult && !smsResult.simulated && smsResult.success),
      sms_reason: smsResult?.reason || null
    });
  } catch (err) {
    console.error('Error saving measurements:', err);
    res.status(500).json({ error: 'Ошибка сохранения замеров: ' + err.message });
  }
});

// Курьер: Завершение доставки с приемом оплаты
app.patch('/api/orders/:id/delivery-complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { paid_amount, payment_method, underpaid_reason, courier_name } = req.body;

    let order = findCachedOrder(id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const total = Number(order.total_price) || 0;
    const paidAmt = Math.max(0, Number(paid_amount) || 0);
    const isFullyPaid = paidAmt >= total;
    const finalCourier = courier_name || order.courier_name || 'Курьер';

    order.stage = 'delivered';
    order.paid = isFullyPaid;
    order.paid_amount = paidAmt;
    order.payment_method = String(payment_method || 'cash').trim();
    order.underpaid_reason = String(underpaid_reason || '').trim();
    order.completed_date = new Date().toISOString();
    order.courier_name = finalCourier;

    upsertCachedOrder(order);

    if (paidAmt > 0) {
      try {
        await db.run('INSERT INTO transactions (id, type, title, amount, date, method) VALUES (?, ?, ?, ?, ?, ?)',
          [`TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`, 'in', `Оплата заказа #${id} (${finalCourier})`, paidAmt, new Date().toLocaleString('ru-RU'), String(payment_method || 'Наличные')]);
      } catch (e) {}
    }

    try {
      await db.run('INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)',
        [id, String(finalCourier).trim(), `Доставка завершена. Оплачено: ${paidAmt.toLocaleString()} сум (${payment_method || 'cash'})`, new Date().toISOString()]);
    } catch (e) {}

    const sentStages = String(order.sms_sent_stages || '').split(',');
    if (!sentStages.includes('delivered')) {
      const phone = order.client_phone;
      if (phone) {
        const delSms = formatSmsMessage('delivered', { ...order, courier_name: finalCourier, id }, null, order.total_m2, total);
        sendEskizSms(phone, delSms, id).catch(e => console.warn('SMS delivered err:', e.message));
        sentStages.push('delivered');
        order.sms_sent_stages = sentStages.join(',');
      }
    }

    enqueueSheetsSync(order, 'upsert');

    res.json({ success: true, fully_paid: isFullyPaid, remaining_debt: Math.max(0, total - paidAmt) });
  } catch (err) {
    console.error('Error during delivery complete:', err);
    res.status(500).json({ error: 'Ошибка сохранения завершения доставки: ' + err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { reason, deleted_by } = req.body || {};
  let order = findCachedOrder(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  order.is_deleted = true;
  order.deleted_at = new Date().toISOString();
  order.deleted_by = deleted_by || 'Администратор';
  order.delete_reason = reason || 'Удален пользователем';

  upsertCachedOrder(order);

  enqueueSheetsSync({ id, delete_reason: reason || 'Удален пользователем' }, 'delete');

  res.json({ success: true, id });
});

app.post('/api/orders/:id/restore', async (req, res) => {
  const { id } = req.params;
  let order = findCachedOrder(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  order.is_deleted = false;
  order.deleted_at = null;
  order.deleted_by = null;
  order.delete_reason = null;

  upsertCachedOrder(order);

  enqueueSheetsSync(order, 'upsert');
  res.json({ success: true });
});

app.delete('/api/orders/:id/permanent', async (req, res) => {
  const { id } = req.params;
  removeCachedOrder(id);
  enqueueSheetsSync({ id, delete_reason: 'Удален навсегда' }, 'delete');
  res.json({ success: true });
});

app.post('/api/orders/trash/clear', async (req, res) => {
  const trashed = ordersMemory.filter(o => o.is_deleted);
  ordersMemory = ordersMemory.filter(o => !o.is_deleted);
  trashed.forEach(t => {
    enqueueSheetsSync({ id: t.id, delete_reason: 'Очистка корзины' }, 'delete');
  });
  res.json({ success: true });
});

app.post('/api/orders/:id/review', async (req, res) => {
  const { id } = req.params;
  const { rating, review_text } = req.body;
  let order = findCachedOrder(id);
  if (order) {
    order.rating = Number(rating) || 5;
    order.review_text = String(review_text || '').trim();
    upsertCachedOrder(order);
    enqueueSheetsSync(order, 'upsert');
  }
  res.json({ success: true });
});

// ================= ФОТОФИКСАЦИЯ И ДЕФЕКТЫ ИЗДЕЛИЙ =================
app.get('/api/orders/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    let order = findCachedOrder(id);
    if (!order) {
      await syncOrdersFromGoogleSheets(true);
      order = findCachedOrder(id);
    }
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ photos: order.photos || [] });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения фото: ' + err.message });
  }
});

app.post('/api/orders/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { photo, caption, stage, taken_by } = req.body;
    if (!photo) {
      return res.status(400).json({ error: 'Изображение не передано' });
    }

    let order = findCachedOrder(id);
    if (!order) {
      await syncOrdersFromGoogleSheets(true);
      order = findCachedOrder(id);
    }
    if (!order) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const photoId = `ph_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const author = String(taken_by || 'Сотрудник').trim();
    const cleanCaption = String(caption || '').trim();
    const currentStage = stage || order.stage || 'pickup';
    const stageLabel = (currentStage === 'washer' || currentStage === 'in_shop' || currentStage === 'washing')
      ? 'Цех / Замер'
      : (currentStage === 'ready' || currentStage === 'delivery' || currentStage === 'delivered' ? 'Доставка' : 'Забор у клиента');

    let photoUrl = '';
    if (typeof photo === 'string' && photo.startsWith('data:image')) {
      try {
        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
        const ext = photo.startsWith('data:image/png') ? 'png' : 'jpg';
        const cleanId = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${cleanId}_${photoId}.${ext}`;
        const uploadDir = path.join(__dirname, 'public', 'uploads', 'photos');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        fs.writeFileSync(path.join(uploadDir, filename), base64Data, 'base64');
        photoUrl = `/uploads/photos/${filename}`;
      } catch (fsErr) {
        console.warn('Filesystem photo write notice (falling back to data URL):', fsErr.message);
        photoUrl = photo;
      }
    } else {
      photoUrl = photo;
    }

    let photosList = Array.isArray(order.photos) ? order.photos : [];

    const newPhotoObj = {
      id: photoId,
      url: photoUrl,
      caption: cleanCaption,
      stage: currentStage,
      stage_label: stageLabel,
      taken_by: author,
      created_at: new Date().toISOString()
    };

    photosList.unshift(newPhotoObj);
    order.photos = photosList;
    order.photos_json = JSON.stringify(photosList);
    upsertCachedOrder(order);

    try {
      await db.run(`
        INSERT INTO audit_logs (order_id, actor_name, action, created_at)
        VALUES (?, ?, ?, ?)
      `, [id, author, `Добавлено фото (${stageLabel}): ${cleanCaption || 'без описания'}`, new Date().toISOString()]);
    } catch (auditErr) {}

    res.json({ success: true, photo: newPhotoObj, photos: photosList });
  } catch (err) {
    console.error('Error saving photo:', err);
    res.status(500).json({ error: 'Ошибка сохранения фото: ' + err.message });
  }
});

app.delete('/api/orders/:id/photos/:photoId', async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const { deleted_by } = req.body || {};
    let order = findCachedOrder(id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    let photosList = Array.isArray(order.photos) ? order.photos : [];
    const photoToDelete = photosList.find(p => p.id === photoId);
    photosList = photosList.filter(p => p.id !== photoId);

    order.photos = photosList;
    order.photos_json = JSON.stringify(photosList);
    upsertCachedOrder(order);

    if (photoToDelete && photoToDelete.url && photoToDelete.url.startsWith('/uploads/photos/')) {
      try {
        const filePath = path.join(__dirname, 'public', photoToDelete.url);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (unlinkErr) {}
    }

    try {
      await db.run(`
        INSERT INTO audit_logs (order_id, actor_name, action, created_at)
        VALUES (?, ?, ?, ?)
      `, [id, deleted_by || 'Сотрудник', `Удалено фото (${photoToDelete?.caption || photoId})`, new Date().toISOString()]);
    } catch (e) {}

    res.json({ success: true, photos: photosList });
  } catch (err) {
    console.error('Error deleting photo:', err);
    res.status(500).json({ error: 'Ошибка удаления фото: ' + err.message });
  }
});

// 5. Звонки и телефония (Android Telephony Gateway)
let latestIncomingCall = null;
let incomingCallTimer = null;
let recentTelephonyCalls = [];

async function handleIncomingTelephonyCall(rawPhone, source = 'android', extraName = '') {
  const cleanDigits = String(rawPhone || '').replace(/\D/g, '');
  const last9 = cleanDigits.slice(-9);
  let formattedPhone = String(rawPhone || '').trim();
  if (cleanDigits.length === 9) {
    formattedPhone = `+998 ${cleanDigits.slice(0, 2)} ${cleanDigits.slice(2, 5)}-${cleanDigits.slice(5, 7)}-${cleanDigits.slice(7, 9)}`;
  } else if (cleanDigits.length === 12 && cleanDigits.startsWith('998')) {
    formattedPhone = `+998 ${cleanDigits.slice(3, 5)} ${cleanDigits.slice(5, 8)}-${cleanDigits.slice(8, 10)}-${cleanDigits.slice(10, 12)}`;
  }

  let client = null;
  let activeOrder = null;
  let totalOrdersCount = 0;
  let totalSpentSum = 0;

  if (last9 && last9.length >= 7) {
    try {
      // 1. Поиск в таблице clients
      client = await db.get(`
        SELECT * FROM clients 
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')') LIKE ? 
        ORDER BY total_orders DESC LIMIT 1
      `, [`%${last9}`]);

      // 2. Статистика по заказам
      const orderStats = await db.get(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(total_price), 0) as spent 
        FROM orders 
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(client_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')') LIKE ?
      `, [`%${last9}`]);

      totalOrdersCount = (orderStats?.cnt) || (client?.total_orders) || 0;
      totalSpentSum = (orderStats?.spent) || (client?.total_spent) || 0;

      // 3. Активный текущий заказ в работе
      activeOrder = await db.get(`
        SELECT id, stage, total_price, client_name, client_address, courier_name, created_at, paid, paid_amount 
        FROM orders 
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(client_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')') LIKE ? 
          AND stage NOT IN ('delivered', 'cancelled')
        ORDER BY created_at DESC LIMIT 1
      `, [`%${last9}`]);

      // 4. Если в clients нет, но есть история в orders
      if (!client) {
        const prevOrder = await db.get(`
          SELECT client_name, client_phone, client_address, district, landmark, language 
          FROM orders 
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(client_phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')') LIKE ? 
          ORDER BY created_at DESC LIMIT 1
        `, [`%${last9}`]);

        if (prevOrder) {
          client = {
            name: prevOrder.client_name,
            phone: prevOrder.client_phone,
            address: prevOrder.client_address,
            district: prevOrder.district || 'Сиёб',
            landmark: prevOrder.landmark || '',
            language: prevOrder.language || 'Русский',
            total_orders: totalOrdersCount,
            total_spent: totalSpentSum,
            tier: totalOrdersCount >= 5 ? 'VIP' : (totalOrdersCount >= 2 ? 'Постоянный' : 'Standard'),
            is_from_orders: true
          };
        }
      }
    } catch (dbErr) {
      console.warn('Telephony client lookup warning:', dbErr.message);
    }
  }

  // Если передан extraName и клиента нет в базе
  if (!client && extraName) {
    client = {
      name: extraName,
      phone: formattedPhone,
      address: '',
      district: 'Сиёб',
      landmark: '',
      language: 'Русский',
      total_orders: 0,
      total_spent: 0,
      tier: 'Новый'
    };
  }

  // Запись в call_logs
  try {
    await db.run(`
      INSERT INTO call_logs (order_id, client_phone, client_name, caller_name, caller_role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      activeOrder?.id || null,
      formattedPhone,
      client?.name || 'Новый клиент',
      `Android Gateway (${source})`,
      'telephony',
      new Date().toISOString()
    ]);
  } catch (e) {
    console.warn('Telephony call_log insert notice:', e.message);
  }

  const callId = `call_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  latestIncomingCall = {
    id: callId,
    phone: rawPhone,
    formattedPhone,
    cleanDigits,
    last9,
    isExisting: !!client,
    client: client ? {
      name: client.name,
      phone: client.phone || formattedPhone,
      address: client.address || '',
      district: client.district || '',
      landmark: client.landmark || '',
      total_orders: totalOrdersCount,
      total_spent: totalSpentSum,
      tier: client.tier || (totalOrdersCount >= 5 ? 'VIP' : (totalOrdersCount >= 2 ? 'Постоянный' : 'Standard')),
      notes: client.notes || ''
    } : null,
    activeOrder: activeOrder ? {
      id: activeOrder.id,
      stage: activeOrder.stage,
      total_price: activeOrder.total_price || 0,
      paid: activeOrder.paid || 0,
      paid_amount: activeOrder.paid_amount || 0,
      courier_name: activeOrder.courier_name || 'Не назначен',
      created_at: activeOrder.created_at
    } : null,
    timestamp: Date.now(),
    source
  };

  recentTelephonyCalls.unshift({ ...latestIncomingCall });
  if (recentTelephonyCalls.length > 20) recentTelephonyCalls.pop();

  if (incomingCallTimer) clearTimeout(incomingCallTimer);
  incomingCallTimer = setTimeout(() => {
    if (latestIncomingCall && latestIncomingCall.id === callId) {
      latestIncomingCall = null;
    }
  }, 45000);

  // Оповещение в Telegram
  try {
    const stageNamesRu = {
      pickup: 'Забор у клиента',
      sorting: 'Сортировка/Измерение',
      washing: 'Стирка в цеху',
      drying: 'Сушка/Оверлок',
      packaging: 'Упаковка/Готов',
      delivery: 'Доставка клиенту'
    };

    const clientBadge = client
      ? `⭐ <b>Клиент:</b> ${client.name}\n📊 Заказов: <b>${totalOrdersCount}</b> | Сумма: <b>${Number(totalSpentSum).toLocaleString()} сум</b>\n📍 Адрес: <code>${client.address || 'Не указан'}</code>`
      : `🆕 <b>Новый клиент</b> (впервые звонит)`;

    const activeOrderBadge = activeOrder
      ? `\n📦 <b>Активный заказ:</b> #${activeOrder.id} [${stageNamesRu[activeOrder.stage] || activeOrder.stage}]`
      : '';

    const tgAlert = `📞 <b>ВХОДЯЩИЙ ЗВОНОК НА ТЕЛЕФОН!</b>\n` +
      `Номер: <code>${formattedPhone}</code>\n` +
      `${clientBadge}${activeOrderBadge}\n` +
      `⚡ <i>Откройте CRM: окно быстрого заказа уже активно!</i>`;

    sendTelegramNotification(tgAlert).catch(e => console.warn('TG call notify warning:', e.message));
  } catch (tgErr) {
    console.warn('Telegram telephony notification error:', tgErr.message);
  }

  return latestIncomingCall;
}

// Android Webhook: Входящий вызов
app.post('/api/telephony/incoming', async (req, res) => {
  try {
    const rawPhone = (req.body?.phone || req.body?.number || req.body?.caller_number || req.body?.from || req.query?.phone || req.query?.number || '').toString().trim();
    if (!rawPhone) {
      return res.status(400).json({ error: 'Номер телефона обязателен (параметр phone или number)' });
    }
    const source = req.body?.source || req.query?.source || 'android';
    const extraName = req.body?.name || req.query?.name || '';
    const callData = await handleIncomingTelephonyCall(rawPhone, source, extraName);
    res.json({ success: true, call: callData });
  } catch (err) {
    console.error('Telephony incoming error:', err);
    res.status(500).json({ error: 'Ошибка обработки звонка: ' + err.message });
  }
});

// Текущий активный входящий звонок (для поллинга в UI)
app.get('/api/telephony/active', (req, res) => {
  res.json({
    activeCall: latestIncomingCall,
    recentCalls: recentTelephonyCalls.slice(0, 5)
  });
});

// Скрыть / отклонить звонок
app.post('/api/telephony/dismiss', (req, res) => {
  latestIncomingCall = null;
  res.json({ success: true });
});

// Симуляция звонка для тестирования UI
app.post('/api/telephony/simulate', async (req, res) => {
  try {
    const testPhone = req.body?.phone || '+998901234567';
    const testName = req.body?.name || 'Шерзод (Тестовый звонок)';
    const callData = await handleIncomingTelephonyCall(testPhone, 'simulation', testName);
    res.json({ success: true, call: callData, message: 'Тестовый звонок успешно запущен' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка симуляции: ' + err.message });
  }
});

app.post('/api/calls', async (req, res) => {
  const { order_id, client_phone, client_name, caller_name, caller_role } = req.body;
  if (!client_phone) return res.status(400).json({ error: 'Номер телефона обязателен' });

  const info = await db.run(`
    INSERT INTO call_logs (order_id, client_phone, client_name, caller_name, caller_role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [order_id || null, client_phone, client_name || '', caller_name || 'Сотрудник', caller_role || '', new Date().toISOString()]);

  res.json({ success: true, id: info.lastInsertRowid });
});

app.get('/api/calls', async (req, res) => {
  const { order_id } = req.query;
  let rows;
  if (order_id) {
    rows = await db.all('SELECT * FROM call_logs WHERE order_id = ? ORDER BY id DESC', [order_id]);
  } else {
    rows = await db.all('SELECT * FROM call_logs ORDER BY id DESC LIMIT 100');
  }
  res.json(rows);
});

// 6. Клиенты
app.get('/api/clients', async (req, res) => {
  const rows = await db.all('SELECT * FROM clients ORDER BY total_orders DESC');
  res.json(rows);
});

app.post('/api/clients', async (req, res) => {
  const { name, phone, address, district, landmark, language, tier, notes, gps_location } = req.body;
  const id = `CL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  await db.run(`
    INSERT INTO clients (id, name, phone, address, district, landmark, language, tier, discount_percent, total_orders, total_spent, notes, gps_location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, name, phone, address, district || 'Сиёб', landmark || '', language || 'Русский', tier || 'Standard', 0, 0, 0, notes || '', gps_location || '']);
  res.json({ success: true, id });
});

app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, address, district, landmark, language, tier, discount_percent, notes, gps_location } = req.body;
  await db.run(`
    UPDATE clients 
    SET name = ?, phone = ?, address = ?, district = ?, landmark = ?, language = ?, tier = ?, discount_percent = ?, notes = ?, gps_location = ?
    WHERE id = ?
  `, [name, phone, address, district, landmark, language, tier, Number(discount_percent) || 0, notes, gps_location, id]);
  res.json({ success: true });
});

app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  await db.run('DELETE FROM clients WHERE id = ?', [id]);
  res.json({ success: true });
});

// 7. Финансы, Авансы и Долги клиентов
app.get('/api/finance/overview', async (req, res) => {
  const orders = ordersMemory.filter(o => !o.is_deleted);
  const advancesRow = await db.get('SELECT SUM(amount) as total FROM salary_advances');
  const advances = advancesRow?.total || 0;
  const empRow = await db.get("SELECT SUM(base_salary) as total FROM employees WHERE status = 'active'");
  const employees = empRow?.total || 0;

  let totalRevenue = 0;
  let paidRevenue = 0;
  let clientDebts = 0;

  orders.forEach(o => {
    const tPrice = Number(o.total_price) || 0;
    totalRevenue += tPrice;
    const paid = o.paid ? tPrice : (Number(o.paid_amount) || 0);
    paidRevenue += paid;
    if (paid < tPrice && o.stage !== 'cancelled') {
      clientDebts += (tPrice - paid);
    }
  });

  res.json({
    totalRevenue,
    paidRevenue,
    clientDebts,
    totalSalaries: employees,
    paidAdvances: advances,
    cashInRegister: Math.max(0, paidRevenue - advances)
  });
});

app.get('/api/stats', (req, res) => {
  const activeOrders = ordersMemory.filter(o => !o.is_deleted);
  const stageCounts = {
    pickup: 0,
    in_shop: 0,
    washing: 0,
    drying: 0,
    delivery: 0,
    completed: 0,
    cancelled: 0
  };
  let totalRevenue = 0;
  let paidRevenue = 0;
  let clientDebts = 0;
  let totalM2 = 0;

  activeOrders.forEach(o => {
    const st = o.stage || 'pickup';
    if (stageCounts[st] !== undefined) stageCounts[st]++;
    else stageCounts[st] = (stageCounts[st] || 0) + 1;

    const tPrice = Number(o.total_price) || 0;
    totalRevenue += tPrice;
    const paid = o.paid ? tPrice : (Number(o.paid_amount) || 0);
    paidRevenue += paid;
    if (paid < tPrice && o.stage !== 'cancelled') {
      clientDebts += (tPrice - paid);
    }
    totalM2 += Number(o.total_m2) || 0;
  });

  res.json({
    total_orders: activeOrders.length,
    total_m2: +totalM2.toFixed(2),
    total_revenue: totalRevenue,
    paid_revenue: paidRevenue,
    client_debts: clientDebts,
    stages: stageCounts,
    last_sheets_sync: lastSheetsSyncTime ? new Date(lastSheetsSyncTime).toISOString() : null
  });
});

app.get('/api/finance/advances', async (req, res) => {
  const rows = await db.all('SELECT * FROM salary_advances ORDER BY date DESC');
  res.json(rows);
});

app.post('/api/finance/advances', async (req, res) => {
  const { employee_id, employee_name, employee_role, amount, date, note, method } = req.body;
  const numAmount = Math.floor(Number(amount));
  if (!employee_name || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Укажите сотрудника и корректную положительную сумму аванса' });
  }

  const id = `ADV-${Date.now().toString().slice(-4)}`;
  const dateStr = date || new Date().toISOString().split('T')[0];
  const methodStr = String(method || 'Наличные').trim();

  await db.run(`
    INSERT INTO salary_advances (id, employee_id, employee_name, employee_role, amount, date, note, method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, employee_id || null, String(employee_name).trim(), String(employee_role || '').trim(), numAmount, dateStr, String(note || '').trim(), methodStr, new Date().toLocaleString('ru-RU')]);

  await db.run(`
    INSERT INTO transactions (id, type, title, amount, date, method) VALUES (?, ?, ?, ?, ?, ?)
  `, [`TX-${Date.now().toString().slice(-5)}`, 'out', `Выдан аванс: ${employee_name}`, numAmount, new Date().toLocaleString('ru-RU'), methodStr]);

  res.json({ success: true, id });
});

app.get('/api/finance/debts', async (req, res) => {
  const debts = ordersMemory
    .filter(o => !o.is_deleted && (!o.paid || Number(o.paid_amount || 0) < Number(o.total_price || 0)) && o.stage !== 'cancelled')
    .map(o => ({
      id: o.id,
      client_name: o.client_name,
      client_phone: o.client_phone,
      client_address: o.client_address,
      total_price: Number(o.total_price) || 0,
      paid_amount: Number(o.paid_amount) || 0,
      underpaid_reason: o.underpaid_reason || '',
      delivery_date: o.delivery_date || '',
      courier_name: o.courier_name || '',
      debt_amount: Math.max(0, (Number(o.total_price) || 0) - (Number(o.paid_amount) || 0))
    }))
    .filter(o => o.debt_amount > 0);

  res.json(debts);
});

app.post('/api/finance/debts/pay', async (req, res) => {
  const { order_id, amount, method, notes } = req.body;
  const numAmount = Math.floor(Number(amount));
  if (!order_id || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Укажите номер заказа и корректную положительную сумму доплаты' });
  }

  let order = findCachedOrder(order_id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const total = Number(order.total_price) || 0;
  const currentPaid = Number(order.paid_amount) || 0;
  const remainingDebt = Math.max(0, total - currentPaid);
  if (numAmount > remainingDebt) {
    return res.status(400).json({ error: `Сумма доплаты превышает остаток долга (${remainingDebt.toLocaleString()} сум)` });
  }

  const newPaid = currentPaid + numAmount;
  const isFullyPaid = newPaid >= total;

  order.paid = isFullyPaid;
  order.paid_amount = newPaid;
  if (isFullyPaid) order.underpaid_reason = '';
  upsertCachedOrder(order);

  try {
    await db.run(`
      INSERT INTO transactions (id, type, title, amount, date, method) VALUES (?, ?, ?, ?, ?, ?)
    `, [`TX-${Date.now().toString().slice(-5)}`, 'in', `Погашение долга по заказу #${order_id}`, numAmount, new Date().toLocaleString('ru-RU'), String(method || 'Наличные').trim()]);
  } catch (e) {}

  try {
    await db.run(`
      INSERT INTO audit_logs (order_id, actor_name, action, created_at) VALUES (?, ?, ?, ?)
    `, [order_id, 'Бухгалтерия / Касса', `Погашение долга: +${numAmount.toLocaleString()} сум (${method || 'Наличные'})`, new Date().toISOString()]);
  } catch (e) {}

  enqueueSheetsSync(order, 'upsert');

  res.json({ success: true, new_paid: newPaid, fully_paid: isFullyPaid });
});

// ================= 8. ВЕЧЕРНЯЯ СДАЧА КАССЫ КУРЬЕРОМ (Z-ОТЧЕТ) =================
app.get('/api/finance/courier-shift', async (req, res) => {
  try {
    const { courier_name, date } = req.query;
    if (!courier_name) return res.status(400).json({ error: 'Укажите курьера' });

    const shiftDate = date || new Date().toISOString().slice(0, 10);
    const dateFormattedRu = shiftDate.split('-').reverse().join('.');

    // Все заказы курьера на доставку со стадией delivered из кэша Google Таблиц
    const orders = ordersMemory.filter(o =>
      o.courier_name === courier_name &&
      !o.is_deleted &&
      o.stage === 'delivered' &&
      (
        o.delivery_date === shiftDate || o.delivery_date === dateFormattedRu ||
        (o.completed_date && (o.completed_date.includes(shiftDate) || o.completed_date.includes(dateFormattedRu))) ||
        (o.created_at && o.created_at.includes(dateFormattedRu))
      )
    );

    let totalOrders = orders.length;
    let totalDeliveredSum = 0;
    let cashCollected = 0;
    let clickCollected = 0;
    let paymeCollected = 0;
    let cardCollected = 0;
    let debtsTotal = 0;
    const debtsList = [];

    orders.forEach(o => {
      const price = Number(o.total_price) || 0;
      const paid = Number(o.paid_amount) || 0;
      totalDeliveredSum += price;

      const method = (o.payment_method || 'cash').toLowerCase();
      if (method === 'click') clickCollected += paid;
      else if (method === 'payme') paymeCollected += paid;
      else if (method === 'card') cardCollected += paid;
      else cashCollected += paid;

      const debt = Math.max(0, price - paid);
      if (debt > 0) {
        debtsTotal += debt;
        debtsList.push({
          order_id: o.id,
          client_name: o.client_name,
          client_phone: o.client_phone,
          debt_amount: debt,
          reason: o.underpaid_reason || 'Не указана'
        });
      }
    });

    // Служебные расходы курьера за день (бензин, ремонт)
    const advances = await db.all(`
      SELECT * FROM salary_advances 
      WHERE employee_name = ? 
        AND (date = ? OR date = ? OR created_at LIKE ?)
    `, [courier_name, shiftDate, dateFormattedRu, `%${dateFormattedRu}%`]);

    let expensesTotal = 0;
    advances.forEach(a => {
      expensesTotal += Number(a.amount) || 0;
    });

    const netCash = Math.max(0, cashCollected - expensesTotal);

    // Проверка, была ли смена уже принята
    const existingShift = await db.get(`
      SELECT * FROM courier_shifts 
      WHERE courier_name = ? AND shift_date = ?
    `, [courier_name, shiftDate]);

    res.json({
      courier_name,
      shift_date: shiftDate,
      shift_date_ru: dateFormattedRu,
      orders_count: totalOrders,
      total_delivered_sum: totalDeliveredSum,
      cash_collected: cashCollected,
      click_collected: clickCollected,
      payme_collected: paymeCollected,
      card_collected: cardCollected,
      debts_total: debtsTotal,
      debts_list: debtsList,
      expenses_total: expensesTotal,
      expenses_list: advances,
      net_cash_submitted: netCash,
      is_accepted: Boolean(existingShift),
      shift_record: existingShift || null
    });
  } catch (err) {
    console.error('Error in courier-shift summary:', err);
    res.status(500).json({ error: err.message });
  }
});

const handleCourierShiftAccept = async (req, res) => {
  try {
    const { courier_name, date, net_cash, actor_name, notes, orders_count, cash_collected, click_collected, payme_collected, card_collected, debts_total, debts_list, expenses_total, expense_note } = req.body;
    if (!courier_name || !date) return res.status(400).json({ error: 'Укажите курьера и дату' });

    const shiftDate = date;
    const dateFormattedRu = shiftDate.split('-').reverse().join('.');
    const currentTimeRu = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const actor = actor_name || req.user?.name || 'Курьер';
    const amount = Number(net_cash) >= 0 ? Number(net_cash) : Math.max(0, (Number(cash_collected) || 0) - (Number(expenses_total) || 0));

    // Автоматическая фиксация расхода курьера (ГСМ/бензин) в авансах и транзакциях, если передан расход > 0
    if (Number(expenses_total) > 0) {
      const existingAdv = await db.get(
        `SELECT id FROM salary_advances WHERE (employee_name = ? OR LOWER(employee_name) = LOWER(?)) AND date = ? AND (note LIKE '%ГСМ%' OR note LIKE '%расход%' OR note = ?)`,
        [courier_name, courier_name, shiftDate, expense_note || 'Служебный расход за смену (ГСМ)']
      );
      if (!existingAdv) {
        const advId = `ADV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await db.run(`
          INSERT INTO salary_advances (id, employee_id, employee_name, employee_role, amount, date, note, method, created_at)
          VALUES (?, NULL, ?, 'courier', ?, ?, ?, 'Наличные', ?)
        `, [advId, courier_name, Number(expenses_total), shiftDate, expense_note || 'Служебный расход за смену (ГСМ)', new Date().toISOString()]);

        await db.run(`
          INSERT INTO transactions (id, type, title, amount, date, method)
          VALUES (?, 'out', ?, ?, ?, 'Наличные')
        `, [`TX-EXP-${Date.now()}`, `ГСМ/Расход курьера ${courier_name} за смену ${shiftDate}`, Number(expenses_total), new Date().toLocaleString('ru-RU')]);
      }
    }

    const totalDelivered = (Number(cash_collected) || 0) + (Number(click_collected) || 0) + (Number(payme_collected) || 0) + (Number(card_collected) || 0) + (Number(debts_total) || 0);

    const existingShift = await db.get(
      'SELECT id FROM courier_shifts WHERE (courier_name = ? OR LOWER(courier_name) = LOWER(?)) AND shift_date = ?',
      [courier_name, courier_name, shiftDate]
    );

    if (existingShift) {
      await db.run(`
        UPDATE courier_shifts
        SET orders_count = ?, total_delivered_sum = ?, cash_collected = ?,
            click_collected = ?, payme_collected = ?, card_collected = ?,
            debts_total = ?, expenses_total = ?, net_cash_submitted = ?,
            status = 'accepted', accepted_by = ?, accepted_at = ?, notes = ?
        WHERE id = ?
      `, [
        Number(orders_count) || 0,
        totalDelivered,
        Number(cash_collected) || 0,
        Number(click_collected) || 0,
        Number(payme_collected) || 0,
        Number(card_collected) || 0,
        Number(debts_total) || 0,
        Number(expenses_total) || 0,
        amount,
        actor,
        new Date().toISOString(),
        notes || '',
        existingShift.id
      ]);
    } else {
      await db.run(`
        INSERT INTO courier_shifts (
          courier_name, shift_date, orders_count, total_delivered_sum, cash_collected,
          click_collected, payme_collected, card_collected, debts_total, expenses_total, net_cash_submitted,
          status, accepted_by, accepted_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)
      `, [
        courier_name,
        shiftDate,
        Number(orders_count) || 0,
        totalDelivered,
        Number(cash_collected) || 0,
        Number(click_collected) || 0,
        Number(payme_collected) || 0,
        Number(card_collected) || 0,
        Number(debts_total) || 0,
        Number(expenses_total) || 0,
        amount,
        actor,
        new Date().toISOString(),
        notes || ''
      ]);
    }

    // Фиксация поступления чистых наличных в журнал кассы
    if (amount > 0) {
      const existingTx = await db.get('SELECT id FROM transactions WHERE title LIKE ?', [`%${shiftDate}%${courier_name}%`]);
      if (!existingTx) {
        await db.run(`
          INSERT INTO transactions (id, type, title, amount, date, method)
          VALUES (?, 'in', ?, ?, ?, 'Наличные')
        `, [`TX-SHIFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`, `Сдача кассы курьером ${courier_name} за ${shiftDate}`, amount, new Date().toLocaleString('ru-RU')]);
      } else {
        await db.run('UPDATE transactions SET amount = ? WHERE id = ?', [amount, existingTx.id]);
      }
    }

    // ФОРМИРОВАНИЕ И ОТПРАВКА Z-ОТЧЕТА В TELEGRAM
    const companyRow = await db.get("SELECT value FROM settings WHERE key = 'company_name'");
    const companyName = companyRow?.value || 'COSMO CRM';
    const nonCash = (Number(click_collected) || 0) + (Number(payme_collected) || 0) + (Number(card_collected) || 0);

    let debtsSummary = '';
    if (Array.isArray(debts_list) && debts_list.length > 0) {
      debtsSummary = debts_list.map((d, i) => `  ${i + 1}. *${d.client_name || 'Клиент'}* (#${d.order_id || ''}) — *${Number(d.debt_amount || 0).toLocaleString('ru-RU')} сум* (${d.reason || 'не указана'})`).join('\n');
    }

    const zReportTg = 
`🧾 *ВЕЧЕРНИЙ Z-ОТЧЕТ: СДАЧА КАССЫ*
━━━━━━━━━━━━━━━━━━━━
🏢 *${companyName}*
👤 *Курьер:* ${courier_name}
📅 *Дата:* ${dateFormattedRu}   🕒 *Время:* ${currentTimeRu}
👤 *Зафиксировал:* ${actor}

📦 *Доставлено заказов:* ${Number(orders_count) || 0} шт.
💰 *Общий чек доставок:* ${totalDelivered.toLocaleString('ru-RU')} сум

💵 *Наличные от клиентов:* ${(Number(cash_collected) || 0).toLocaleString('ru-RU')} сум
💳 *Click:* ${(Number(click_collected) || 0).toLocaleString('ru-RU')} сум
📱 *Payme:* ${(Number(payme_collected) || 0).toLocaleString('ru-RU')} сум
💳 *Карта / Терминал:* ${(Number(card_collected) || 0).toLocaleString('ru-RU')} сум
📊 *Всего безнал:* ${nonCash.toLocaleString('ru-RU')} сум
${Number(expenses_total) > 0 ? `⛽ *Служебные расходы (ГСМ):* -${Number(expenses_total).toLocaleString('ru-RU')} сум\n   _Причина: ${expense_note || 'ГСМ / бензин / авто'}_\n` : ''}━━━━━━━━━━━━━━━━━━━━
💵 *К СДАЧЕ В ГЛАВНУЮ КАССУ:*
👉 *${amount.toLocaleString('ru-RU')} сум*
━━━━━━━━━━━━━━━━━━━━
${Number(debts_total) > 0 ? `⚠️ *Остаток долга клиентов (${debts_list?.length || 1} шт):* ${Number(debts_total).toLocaleString('ru-RU')} сум\n${debtsSummary}` : '✅ *Все заказы оплачены на 100%, долгов нет!*'}
${notes ? `\n📝 *Примечание курьера:* ${notes}` : ''}
✅ _Касса успешно проведена в CRM_`;

    sendTelegramNotification(zReportTg).catch(e => console.warn('TG z-report notification error:', e.message));

    // Двойное уведомление напрямую на телефон Акобира через Jimmy Bridge
    try {
      const { exec } = require('child_process');
      const bridgeText = zReportTg.replace(/"/g, "'").replace(/\n/g, '\\n');
      exec(`python C:\\Users\\AKOBIR\\jimmy_telegram\\jimmy_bridge.py report --title "Вечерний Z-отчет: ${courier_name}" --text "${bridgeText}" --status success`, (err) => {
        if (err) console.warn('Bridge notification error:', err.message);
      });
    } catch (e) {}

    res.json({
      success: true,
      message: `Касса успешно принята! В кассу поступило: ${amount.toLocaleString('ru-RU')} сум. Z-отчет отправлен руководителю в Telegram!`,
      net_cash: amount,
      orders_count: Number(orders_count) || 0,
      total_delivered: totalDelivered
    });
  } catch (err) {
    console.error('Error accepting courier shift:', err);
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/finance/courier-shift/accept', handleCourierShiftAccept);
app.post('/api/courier/submit-shift', handleCourierShiftAccept);

app.get('/api/finance/courier-shifts', async (req, res) => {
  const rows = await db.all('SELECT * FROM courier_shifts ORDER BY id DESC LIMIT 50');
  res.json(rows);
});

// ================= 9. TELEGRAM & SMS ИНТЕГРАЦИИ =================
app.post('/api/telegram/broadcast', async (req, res) => {
  const { message, text, target, sender } = req.body;
  const rawMsg = (message || text || '').trim();
  if (!rawMsg) return res.status(400).json({ error: 'Текст сообщения обязателен' });

  const targetLabel = target === 'all' || !target ? 'Всем экипажам' : target;
  const senderLabel = sender || 'Диспетчер';
  const formatted = `📢 *СООБЩЕНИЕ ДИСПЕТЧЕРА (${targetLabel})*\nОт: ${senderLabel}\n\n${rawMsg}\n\n🕒 _${new Date().toLocaleString('ru-RU')}_`;

  const result = await sendTelegramNotification(formatted);
  res.json(result);
});

app.post('/api/telegram/notify-order', async (req, res) => {
  const { orderId } = req.body;
  let order = findCachedOrder(orderId);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const cardText = formatTelegramOrderCard(order);
  const result = await sendTelegramNotification(cardText);
  if (result.success) {
    order.tg_sent = 1;
    upsertCachedOrder(order);
  }
  res.json({ success: result.success, text: cardText, error: result.error });
});

app.post('/api/telegram/test', async (req, res) => {
  const msg = `🔔 *Тестовое уведомление COSMO CRM*\nСвязь с Telegram-ботом работает корректно!\n📅 ${new Date().toLocaleString('ru-RU')}`;
  const result = await sendTelegramNotification(msg);
  res.json(result);
});

app.post('/api/sms/send', async (req, res) => {
  const { phone, message, orderId } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Телефон и текст сообщения обязательны' });

  const result = await sendEskizSms(phone, message, orderId);
  res.json(result);
});

app.post('/api/sms/test', async (req, res) => {
  const { phone, message } = req.body;
  const testPhone = phone || '+998950323330';
  const msg = message || `Assalomu alaykum Test\n\nBuyurtmangiz qabul qilindi: #TEST\nHolati: Qabul qilindi\nKuryer: Haydovchi\n\nBuyurtmani kuzatish: https://crmcosmo.company\n\nBuyurtmangiz tayyor bo'lishi bilan haydovchimiz siz bilan bog'lanadi.\n\nHurmat bilan, Cosmo CRM\nGilam yuvish markazi\n+998 20 002 20 99`;
  const result = await sendEskizSms(testPhone, msg);
  res.json(result);
});

// Eskiz.uz Авторизация (получение JWT токена по email и паролю)
app.post('/api/sms/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' });

  try {
    const token = await loginToEskiz(email, password);
    if (token) {
      res.json({ success: true, token, message: 'Авторизация в Eskiz.uz прошла успешно! Токен сохранен.' });
    } else {
      res.status(400).json({ success: false, error: 'Ошибка авторизации в Eskiz.uz (неверный email или пароль)' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eskiz.uz Проверка живого баланса и лимитов (с автоматическим переподключением)
app.get('/api/sms/balance', async (req, res) => {
  try {
    let tokenRow = await db.get("SELECT value FROM settings WHERE key = 'eskiz_token'");
    let token = tokenRow?.value;

    if (!token) {
      token = await loginToEskiz();
    }
    if (!token) return res.json({ configured: false, balance: 0, smsCount: 0, message: 'Токен Eskiz не настроен' });

    let apiRes = await fetch('https://notify.eskiz.uz/api/user/get-limit', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // If 401 Unauthorized / token expired, automatically re-login!
    if (apiRes.status === 401) {
      console.log('Eskiz token expired during balance check, refreshing...');
      const freshToken = await loginToEskiz();
      if (freshToken) {
        token = freshToken;
        apiRes = await fetch('https://notify.eskiz.uz/api/user/get-limit', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    }

    const data = await apiRes.json().catch(() => null);

    if (apiRes.ok && data?.data) {
      const balance = Number(data.data.balance || 0);
      const smsCount = Math.floor(balance / 100);
      res.json({ success: true, configured: true, balance, smsCount, raw: data.data });
    } else {
      res.json({ success: false, configured: true, error: data?.message || 'Не удалось получить баланс' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Журнал отправки SMS
app.get('/api/sms/logs', async (req, res) => {
  try {
    const logs = await db.all(`
      SELECT id, order_id, actor_name, action, created_at 
      FROM audit_logs 
      WHERE actor_name = 'Система (SMS)' OR action LIKE '%SMS%' 
      ORDER BY id DESC 
      LIMIT 30
    `);
    res.json(logs || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Управление авто-триггерами SMS
app.get('/api/sms/triggers', async (req, res) => {
  const row = await db.get("SELECT value FROM settings WHERE key = 'sms_triggers'");
  try {
    const triggers = row?.value ? JSON.parse(row.value) : {
      created: true,
      measured: true,
      ready: true,
      delivered: true
    };
    res.json(triggers);
  } catch (e) {
    res.json({ created: true, measured: true, ready: true, delivered: true });
  }
});

app.post('/api/sms/triggers', async (req, res) => {
  const triggers = req.body || {};
  await db.run("INSERT INTO settings (key, value) VALUES ('sms_triggers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(triggers)]);
  res.json({ success: true, triggers });
});

// Управление шаблонами сообщений SMS
app.get('/api/sms/templates', async (req, res) => {
  const row = await db.get("SELECT value FROM settings WHERE key = 'sms_templates'");
  try {
    const templates = row?.value ? JSON.parse(row.value) : null;
    res.json(templates || [
      { id: 'created', title: 'Создание заказа', text: 'BAROKOT: Ваша заявка #{orderId} принята в работу! Отслеживание статуса: {trackingUrl}' },
      { id: 'measured', title: 'Замер в цеху', text: 'BAROKOT: Заказ #{orderId} замерен: {area} м². Сумма к оплате: {amount} сум. Скоро привезем!' },
      { id: 'ready', title: 'Готов к доставке', text: 'BAROKOT: Заказ #{orderId} постиран и готов к доставке. К оплате: {amount} сум. Курьер свяжется с вами.' },
      { id: 'delivered', title: 'Доставлен и закрыт', text: 'BAROKOT: Заказ #{orderId} успешно доставлен. Спасибо за доверие! Оцените наш сервис: {trackingUrl}' }
    ]);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/sms/templates', async (req, res) => {
  const templates = req.body;
  if (!Array.isArray(templates)) return res.status(400).json({ error: 'Шаблоны должны быть массивом' });
  await db.run("INSERT INTO settings (key, value) VALUES ('sms_templates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(templates)]);
  res.json({ success: true, templates });
});

// Google Таблицы: Тестовый запрос и пакетная синхронизация
app.post('/api/integrations/google-sheets/test', async (req, res) => {
  const testOrder = {
    id: 'CSM-TEST',
    created_at: new Date().toLocaleDateString('ru-RU'),
    client_name: 'Тестовый Клиент (COSMO CRM)',
    client_phone: '+998 95 032 33 30',
    client_address: 'г. Самарканд, ул. Регистан, 1',
    district: 'Сиёб',
    stage: 'pickup',
    stage_ru: 'Тест связи (Успешно)',
    total_m2: 12.5,
    total_price: 175000,
    paid: 1,
    paid_amount: 175000,
    payment_method: 'click',
    courier_name: 'Дамир (Курьер)',
    washer_name: 'Шерзод (Цех)',
    delivery_date: new Date(Date.now() + 3 * 86400000).toLocaleDateString('ru-RU'),
    notes: 'Проверка двусторонней интеграции с Google Sheets'
  };

  const result = await syncOrderToGoogleSheets(testOrder, 'upsert');
  res.json(result);
});

app.post('/api/integrations/google-sheets/sync-all', async (req, res) => {
  const result = await syncAllOrdersToGoogleSheets();
  res.json(result);
});

app.post('/api/integrations/google-sheets/pull', async (req, res) => {
  await syncOrdersFromGoogleSheets(true);
  const activeCount = ordersMemory.filter(o => !o.is_deleted).length;
  res.json({ success: true, count: activeCount });
});

// Статус базы данных (Google Sheets Primary)
app.get('/api/db/status', (req, res) => {
  res.json({
    mode: 'google_sheets_primary',
    orders_source: 'Google Sheets (Cosmo)',
    local_db: dbMode,
    isTurso,
    isVercel,
    location: dbLocation ? (dbLocation.startsWith('libsql://') ? dbLocation.replace(/(:\/\/)(.*)(@)/, '$1***$3') : path.basename(dbLocation)) : 'unknown'
  });
});

// GPS
app.post('/api/gps/update', async (req, res) => {
  const { courier_name, lat, lng, speed, battery } = req.body;
  if (!courier_name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Имя курьера и координаты обязательны' });
  }

  await db.run(`
    INSERT INTO courier_locations (courier_name, lat, lng, speed, battery, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(courier_name) DO UPDATE SET
      lat = excluded.lat,
      lng = excluded.lng,
      speed = excluded.speed,
      battery = excluded.battery,
      updated_at = excluded.updated_at
  `, [courier_name, Number(lat), Number(lng), Number(speed) || 0, Number(battery) || 100, new Date().toISOString()]);

  res.json({ success: true });
});

app.get('/api/gps/locations', async (req, res) => {
  const rows = await db.all('SELECT * FROM courier_locations');
  res.json(rows);
});

// Настройки
app.get('/api/settings', async (req, res) => {
  const rows = await db.all('SELECT * FROM settings');
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});

app.post('/api/settings', async (req, res) => {
  const settingsObj = req.body;
  for (const [key, value] of Object.entries(settingsObj)) {
    await db.run(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, String(value || '')]);
  }
  res.json({ success: true });
});

// Резервное копирование и экспорт
app.get('/api/backup/export', async (req, res) => {
  const employees = await db.all('SELECT id, name, role, phone, base_salary, status FROM employees');
  const services = await db.all('SELECT * FROM services');
  const orders = ordersMemory;
  const clients = await db.all('SELECT * FROM clients');
  const salary_advances = await db.all('SELECT * FROM salary_advances');
  const transactions = await db.all('SELECT * FROM transactions');
  const settings = await db.all('SELECT * FROM settings');
  const courier_shifts = await db.all('SELECT * FROM courier_shifts');

  const backupData = {
    appName: 'COSMO CRM',
    version: '2.5.0',
    exportDate: new Date().toISOString(),
    data: {
      employees,
      services,
      orders,
      clients,
      salary_advances,
      transactions,
      settings,
      courier_shifts
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=cosmo_backup_${Date.now()}.json`);
  res.json(backupData);
});

app.post('/api/backup/import', async (req, res) => {
  const backupPayload = req.body;
  const data = backupPayload?.data || backupPayload;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Неверный формат бэкапа' });

  try {
    if (Array.isArray(data.services)) {
      for (const s of data.services) {
        if (s && s.id) {
          await db.run('INSERT OR REPLACE INTO services (id, name, category, unit, price, icon) VALUES (?, ?, ?, ?, ?, ?)',
            [String(s.id), String(s.name || ''), String(s.category || 'Ковры'), String(s.unit || 'м²'), Number(s.price) || 0, String(s.icon || 'Layers')]);
        }
      }
    }

    if (Array.isArray(data.clients)) {
      for (const c of data.clients) {
        if (c && c.id) {
          await db.run('INSERT OR REPLACE INTO clients (id, name, phone, address, district, landmark, language, tier, discount_percent, total_orders, total_spent, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [String(c.id), String(c.name || ''), String(c.phone || ''), String(c.address || ''), String(c.district || 'Сиёб'), String(c.landmark || ''), String(c.language || 'Русский'), String(c.tier || 'Standard'), Number(c.discount_percent) || 0, Number(c.total_orders) || 0, Number(c.total_spent) || 0, String(c.notes || '')]);
        }
      }
    }

    if (Array.isArray(data.orders)) {
      ordersMemory = data.orders.map(o => ({
        ...o,
        stage: normalizeStage(o.stage || 'pickup'),
        is_deleted: Boolean(o.is_deleted)
      }));
      syncAllOrdersToGoogleSheets().catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error during backup restore:', err);
    res.status(500).json({ error: 'Ошибка восстановления базы данных: ' + err.message });
  }
});

// Глобальный перехват ошибок
app.use((err, req, res, next) => {
  console.error('[CRITICAL SERVER ERROR]:', err);
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Некорректный формат JSON' });
  }
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

process.on('uncaughtException', (err) => console.error('CRITICAL UNCAUGHT EXCEPTION:', err));
process.on('unhandledRejection', (reason) => console.error('CRITICAL UNHANDLED REJECTION:', reason));

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`✨ COSMO CRM Enterprise running on port ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`📱 Network URL (Телефон): http://192.168.2.106:${PORT}`);
    console.log(`📦 Database: ${dbMode} (${dbLocation})`);
    console.log(`===============================================`);
  });
}

module.exports = app;
