// ================= BAROKOT CRM 2.0 ENTERPRISE APP SCRIPT =================

// State
let currentUser = null;
let currentPin = '';
let currentTab = 'dashboard';
let currentViewRole = 'admin'; // 'admin', 'dispatcher', 'courier', 'washer'
let activeOrders = [];
let allClients = [];
let allServices = [];
let allStaff = [];
let currentEditingOrder = null;
let activeCourierScope = 'pickups';
let activeWasherFilter = 'all';
let activeDispatcherFilter = 'all';
let activeCourierPortalTab = 'pickups';
let activeWasherPortalTab = 'all';
let courierPortalMap = null;
let courierMapMarkers = [];
let courierLiveGpsActive = true;
let leafletMap = null;
let mapMarkers = [];
let gpsTrackingInterval = null;
let publicRatingValue = 5;
let allCalls = [];
let locationPickerMap = null;
let locationPickerMarker = null;
let currentTargetLocOrderId = null;
let locationPickerTarget = 'direct_card'; // 'direct_card', 'pickup', 'order_form'
let suggestedGeoAddress = null;
let reverseGeocodeTimer = null;
let activePickupModalOrder = null;

const WORKSHOP_COORDINATES = [39.588238, 66.928319]; // Главный цех BAROKOT Самарканд
const DISTRICT_CENTERS = {
  // Городские районы
  'Бульвар / Центр': [39.6542, 66.9597],
  'Центр': [39.6542, 66.9597],
  'Сиёб': [39.6612, 66.9745],
  'Гагарина': [39.6480, 66.9290],
  'Вокзал': [39.6820, 66.9240],
  'Согдиана': [39.6380, 66.9120],
  'Микрорайон': [39.6520, 66.9050],
  'Саттепо': [39.6290, 66.9380],
  'Мотрид / Карасу': [39.6950, 66.9650],
  'Мархабо / Аэропорт': [39.6980, 66.9850],
  'Багишамал': [39.6450, 66.9350],

  // Туманы Самаркандской области
  'Самаркандский р-н': [39.5950, 66.9450],
  'Тайлакский р-н': [39.5750, 67.0850],
  'Пастдаргомский р-н': [39.7150, 66.6500],
  'Джамбайский р-н': [39.7600, 67.0900],
  'Акдарьинский р-н': [39.8100, 66.7500],
  'Булунгурский р-н': [39.7550, 67.2750],
  'Ургутский р-н': [39.4050, 67.2400],
  'Иштыханский р-н': [39.9650, 66.4900],
  'Каттакурганский р-н': [39.8950, 66.2550],
  'Пайарыкский р-н': [40.0150, 66.8500],
  'Нурабадский р-н': [39.6050, 66.2800],
  'Нарпайский р-н': [39.9800, 65.9200],
  'Кошрабадский р-н': [40.3550, 66.6450],
  'Пахтачийский р-н': [40.0200, 65.7100]
};

// ================= ROBUST DATE UTILITIES =================
function parseDateSafe(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const [, d, mon, y, h, min, sec] = m;
    const date = new Date(parseInt(y, 10), parseInt(mon, 10) - 1, parseInt(d, 10), parseInt(h || 0, 10), parseInt(min || 0, 10), parseInt(sec || 0, 10));
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

function formatDateSafe(val, withTime = false) {
  const d = parseDateSafe(val);
  if (!d) return val ? String(val) : '—';
  return withTime ? d.toLocaleString('ru-RU') : d.toLocaleDateString('ru-RU');
}

function toIsoDateSafe(val) {
  const d = parseDateSafe(val);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ================= STAGE & COURIER NORMALIZATION UTILITIES =================
function normalizeStage(stage) {
  if (!stage) return 'pickup';
  const s = String(stage).trim().toLowerCase();
  if (['pickup', 'забор', '1. забор', 'к забору', '1. к забору', 'ожидает забора', '1. ожидает забора', 'ожидает', 'заявка', 'новая заявка', 'новый', 'принят', 'принята', 'прием', 'выезд', '1. выезд', 'заявка принята', 'new', 'pending', 'created', 'lead'].includes(s)) return 'pickup';
  if (['in_shop', 'dusting', 'washing', 'drying', 'in_wash', 'wash', 'в цеху', 'в цехе', 'стирка / в цехе', 'стирка в цехе', 'стирка', 'цех', '2. в цеху', '2. стирка / в цехе', '2. стирка', 'стираются', 'сушатся'].includes(s)) return 'in_shop';
  if (['ready', 'готов к доставке', 'готов', 'готов в цеху', '3. готов к доставке', '3. готов', '3. готов в цеху', 'постиран', 'delivery', 'на доставке', 'в авто', '3. на доставке', 'доставка', 'в машине', 'доставка клиенту'].includes(s)) return 'ready';
  if (['delivered', 'доставлен', 'доставлен / оплачен', 'выполнен', '4. доставлен', '4. выполнен', 'завершен', 'оплачен', 'done', 'completed'].includes(s)) return 'delivered';
  if (['cancelled', 'canceled', 'отменен', 'отмена'].includes(s)) return 'cancelled';
  return s;
}

function isPickupStage(stage) {
  return normalizeStage(stage) === 'pickup';
}

function isShopStage(stage) {
  return normalizeStage(stage) === 'in_shop';
}

function isReadyOrDeliveryStage(stage) {
  return normalizeStage(stage) === 'ready';
}

function isDeliveredStage(stage) {
  return normalizeStage(stage) === 'delivered';
}

function normalizeDistrict(district) {
  if (!district) return '';
  const d = String(district).trim().toLowerCase();
  if (d.includes('бульвар') || d.includes('центр')) return 'Бульвар / Центр';
  if (d.includes('сиёб') || d.includes('сиаб')) return 'Сиёб';
  if (d.includes('гагарин')) return 'Гагарина';
  if (d.includes('вокзал') || d.includes('железнодорож') || d.includes('темир йул')) return 'Вокзал';
  if (d.includes('согдиана')) return 'Согдиана';
  if (d.includes('микрорайон') || d.includes('микр')) return 'Микрорайон';
  if (d.includes('саттепо') || d.includes('саттепа')) return 'Саттепо';
  if (d.includes('мотрид') || d.includes('карасу') || d.includes('qorasuv')) return 'Мотрид / Карасу';
  if (d.includes('мархабо') || d.includes('аэропорт') || d.includes('геофизик')) return 'Мархабо / Аэропорт';
  if (d.includes('багишамал') || d.includes('богишамол')) return 'Багишамал';

  // Туманы области
  if (d.includes('тайлак') || d.includes('toyloq')) return 'Тайлакский р-н';
  if (d.includes('пастдаргом') || d.includes('жума')) return 'Пастдаргомский р-н';
  if (d.includes('джамбай') || d.includes('jomboy')) return 'Джамбайский р-н';
  if (d.includes('акдарь') || d.includes('oqdaryo')) return 'Акдарьинский р-н';
  if (d.includes('булунгур')) return 'Булунгурский р-н';
  if (d.includes('ургут')) return 'Ургутский р-н';
  if (d.includes('иштыхан') || d.includes('ishtixon')) return 'Иштыханский р-н';
  if (d.includes('каттакурган')) return 'Каттакурганский р-н';
  if (d.includes('пайарык') || d.includes('челек')) return 'Пайарыкский р-н';
  if (d.includes('нурабад')) return 'Нурабадский р-н';
  if (d.includes('нарпай') || d.includes('акташ')) return 'Нарпайский р-н';
  if (d.includes('кошрабад')) return 'Кошрабадский р-н';
  if (d.includes('пахтачи') || d.includes('paxtachi')) return 'Пахтачийский р-н';
  if (d.includes('самаркандский') || d.includes('пригород')) return 'Самаркандский р-н';
  return String(district).trim();
}

function cleanCourierName(name) {
  if (!name) return '';
  const s = String(name).trim();
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

// Детерминированное смещение для заказов без точного GPS (никогда не скачет при обновлении страницы)
function getDeterministicOffset(idStr) {
  let hash = 0;
  const s = String(idStr || '0');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  const angle = (Math.abs(hash) % 360) * (Math.PI / 180);
  const radius = 0.002 + ((Math.abs(hash >> 3) % 100) / 100) * 0.004; // ~200м - 600м в пределах махалли
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

// Единый источник координат для карт и навигаторов
function getOrderCoordinatesWithFallback(order) {
  if (!order) return { coords: [39.6542, 66.9597], isExact: false, source: 'default' };

  // 1. Точные спутниковые GPS-координаты из заказа (зафиксированные курьером при заборе)
  if (order.gps_location && String(order.gps_location).includes(',')) {
    const parts = String(order.gps_location).split(',').map(s => parseFloat(s.trim()));
    if (!isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0) {
      return { coords: [parts[0], parts[1]], isExact: true, source: 'order' };
    }
  }

  // 2. Точные GPS-координаты из профиля клиента (из предыдущих зафиксированных заказов)
  if (Array.isArray(allClients) && order.client_phone) {
    const client = allClients.find(c => c.phone === order.client_phone);
    if (client && client.gps_location && String(client.gps_location).includes(',')) {
      const parts = String(client.gps_location).split(',').map(s => parseFloat(s.trim()));
      if (!isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0) {
        return { coords: [parts[0], parts[1]], isExact: true, source: 'client' };
      }
    }
  }

  // 3. Гарантированные детерминированные координаты района (абсолютно постоянны при перезагрузке F5)
  const districtName = order.district || 'Сиёб';
  const baseCenter = (DISTRICT_CENTERS && DISTRICT_CENTERS[districtName]) ? DISTRICT_CENTERS[districtName] : [39.6542, 66.9597];
  const offset = getDeterministicOffset(order.id);
  const approxCoords = [baseCenter[0] + offset[0], baseCenter[1] + offset[1]];

  return { coords: approxCoords, isExact: false, source: 'district' };
}

// ================= BULLETPROOF SVG ICON ENGINE (NEVER BLANK) =================
const SVG_ICONS = {
  'check': '<polyline points="20 6 9 17 4 12"></polyline>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
  'check-circle-2': '<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>',
  'package': '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
  'package-check': '<path d="m16 16 2 2 4-4"></path><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"></path><path d="m7.5 4.27 9 5.15"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
  'truck': '<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>',
  'map-pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>',
  'phone-call': '<path d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>',
  'navigation': '<polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>',
  'map': '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line>',
  'dollar-sign': '<line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
  'plus-circle': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line>',
  'trash-2': '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
  'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
  'edit-3': '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>',
  'search': '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
  'send': '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
  'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
  'crosshair': '<circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
  'qr-code': '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>',
  'printer': '<polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
  'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>',
  'ruler': '<path d="M21.3 15.3l-6.6-6.6a1 1 0 0 0-1.4 0l-1.6 1.6 1.4 1.4-1.4 1.4-1.4-1.4-1.6 1.6 1.4 1.4-1.4 1.4-1.4-1.4-1.6 1.6a1 1 0 0 0 0 1.4l6.6 6.6a1 1 0 0 0 1.4 0l8-8a1 1 0 0 0 0-1.4z"></path>',
  'arrow-left-right': '<polyline points="8 3 4 7 8 11"></polyline><polyline points="16 21 20 17 16 13"></polyline><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="17" x2="20" y2="17"></line>',
  'menu': '<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>',
  'clock': '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  'alert-circle': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
  'layers': '<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>',
  'bell': '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"></polyline>',
  'refresh-cw': '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
  'eye': '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
};

function getSvgIcon(name, extraClass = 'w-4 h-4', size = 18) {
  const content = SVG_ICONS[name] || SVG_ICONS['check'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block shrink-0 ${extraClass}">${content}</svg>`;
}

function refreshAllIcons() {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    try {
      lucide.createIcons();
    } catch (e) {}
  }
  // Bulletproof fallback: convert all remaining <i data-lucide="..."> to direct SVG
  document.querySelectorAll('i[data-lucide]').forEach(el => {
    const iconName = el.getAttribute('data-lucide');
    if (iconName && SVG_ICONS[iconName]) {
      const wrapper = document.createElement('span');
      wrapper.className = 'inline-flex items-center justify-center shrink-0';
      wrapper.innerHTML = getSvgIcon(iconName, el.className || 'w-4 h-4');
      el.parentNode.replaceChild(wrapper.firstElementChild, el);
    }
  });
}

// Floating Modern Toast Notification
function showToast(message, type = 'success') {
  let container = document.getElementById('app-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app-toast-container';
    container.className = 'fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const bgClass = type === 'error'
    ? 'bg-rose-700 text-white border-rose-900 shadow-rose-900/30'
    : (type === 'info'
      ? 'bg-emerald-deep text-butter border-emerald-deep/40 shadow-emerald-950/40'
      : 'bg-emerald-800 text-butter border-emerald-900 shadow-emerald-950/40');

  toast.className = `${bgClass} border px-4 py-3 rounded-2xl shadow-xl text-xs font-bold flex items-center gap-2 transform translate-y-3 opacity-0 transition-all duration-300 pointer-events-auto`;
  const icon = type === 'error' ? '⚠️' : (type === 'info' ? 'ℹ️' : '✅');
  toast.innerHTML = `
    <span class="text-sm shrink-0">${icon}</span>
    <span class="flex-1 leading-snug">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-3', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}
window.showToast = showToast;

// Theme & Eye Comfort Management
function toggleTheme() {
  const current = localStorage.getItem('barokot_theme') || 'ivory';
  const next = current === 'dark' ? 'ivory' : 'dark';
  setTheme(next);
}

function setTheme(themeName) {
  const body = document.body;
  const isDark = themeName === 'dark';

  if (isDark) {
    body.setAttribute('data-theme', 'dark');
    document.documentElement.classList.add('dark');
  } else if (themeName === 'pure') {
    body.setAttribute('data-theme', 'pure');
    document.documentElement.classList.remove('dark');
  } else {
    // Default: 'ivory' (Warm soothing ivory linen)
    body.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    themeName = 'ivory';
  }
  localStorage.setItem('barokot_theme', themeName);

  // Update 3-way switcher in top bar
  ['ivory', 'pure', 'dark'].forEach(t => {
    const btn = document.getElementById(`btn-theme-${t}`);
    if (btn) {
      if (t === themeName) {
        btn.classList.add('bg-white/25', 'text-white', 'shadow');
      } else {
        btn.classList.remove('bg-white/25', 'text-white', 'shadow');
      }
    }
  });

  // Update login screen theme buttons
  ['ivory', 'pure', 'dark'].forEach(t => {
    const btn = document.getElementById(`btn-login-theme-${t}`);
    if (btn) {
      if (t === themeName) {
        btn.classList.add('bg-emerald-deep', 'text-butter', 'shadow');
        btn.classList.remove('text-charcoal-muted');
      } else {
        btn.classList.remove('bg-emerald-deep', 'text-butter', 'shadow');
        btn.classList.add('text-charcoal-muted');
      }
    }
  });

  // Update 1-Click Quick Toggle button (icon & label)
  const quickIcon = document.getElementById('quick-theme-icon');
  const quickLabel = document.getElementById('quick-theme-label');
  const quickBtn = document.getElementById('btn-quick-theme-toggle');
  if (quickIcon && quickLabel) {
    if (isDark) {
      quickIcon.textContent = '☀️';
      quickLabel.textContent = 'Светлая';
      if (quickBtn) quickBtn.title = 'Переключить на мягкий дневной режим (Айвори)';
    } else {
      quickIcon.textContent = '🌙';
      quickLabel.textContent = 'Тёмная';
      if (quickBtn) quickBtn.title = 'Переключить на ночной изумрудный режим';
    }
  }

  // Update PIN dots glow color if on login screen
  updatePinDots();
}

// Initial Entry Point
document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved eye-comfort theme (default to warm soothing ivory)
  const savedTheme = localStorage.getItem('barokot_theme') || 'ivory';
  setTheme(savedTheme);

  // 1. Check if public client tracking URL (?track=BRK-XXXX or #track-BRK-XXXX)
  const urlParams = new URLSearchParams(window.location.search);
  const trackParam = urlParams.get('track');
  const hash = window.location.hash;
  const trackId = trackParam || (hash && hash.startsWith('#track-') ? hash.replace('#track-', '') : null);

  if (trackId) {
    showPublicTrackingScreen(trackId);
    return;
  }

  // 2. Check saved user in session
  const savedUser = localStorage.getItem('barokot_user');
  if (savedUser) {
    try {
      const parsed = JSON.parse(savedUser);
      if (parsed && typeof parsed === 'object' && parsed.name && parsed.role) {
        currentUser = parsed;
        launchApp();
        return;
      } else {
        localStorage.removeItem('barokot_user');
      }
    } catch (e) {
      console.warn('Corrupted barokot_user session cleared:', e);
      localStorage.removeItem('barokot_user');
    }
  }

  // Show login screen
  document.getElementById('login-screen').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
});

// ================= AUTHENTICATION & PIN KEYPAD =================

function enterPin(digit) {
  if (currentPin.length < 4) {
    currentPin += digit;
    updatePinDots();
    if (currentPin.length === 4) {
      setTimeout(verifyPin, 150);
    }
  }
}

function deletePin() {
  if (currentPin.length > 0) {
    currentPin = currentPin.slice(0, -1);
    updatePinDots();
  }
}

function clearPin() {
  currentPin = '';
  updatePinDots();
}

function updatePinDots() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) {
      if (i < currentPin.length) {
        dot.classList.remove('bg-transparent');
        dot.classList.add('bg-emerald-deep');
        if (isDark) {
          dot.style.backgroundColor = '#4FB8B4';
          dot.style.borderColor = '#4FB8B4';
          dot.style.boxShadow = '0 0 12px rgba(79, 184, 180, 0.8)';
        } else {
          dot.style.backgroundColor = '';
          dot.style.borderColor = '';
          dot.style.boxShadow = '';
        }
      } else {
        dot.classList.remove('bg-emerald-deep');
        dot.classList.add('bg-transparent');
        dot.style.backgroundColor = 'transparent';
        dot.style.borderColor = '';
        dot.style.boxShadow = '';
      }
    }
  }
}

async function verifyPin() {
  try {
    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentPin })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      currentUser = data.user;
      localStorage.setItem('barokot_user', JSON.stringify(currentUser));
      currentPin = '';
      updatePinDots();
      launchApp();
    } else {
      alert(data.error || 'Неверный PIN-код!');
      clearPin();
    }
  } catch (err) {
    alert('Ошибка авторизации. Проверьте подключение к серверу.');
    clearPin();
  }
}

function quickLogin(pin) {
  currentPin = pin;
  updatePinDots();
  verifyPin();
}

function logout() {
  if (gpsTrackingInterval) clearInterval(gpsTrackingInterval);
  if (liveSyncInterval) clearInterval(liveSyncInterval);
  localStorage.removeItem('barokot_user');
  currentUser = null;
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  clearPin();
}

// ================= APP INITIALIZATION =================

async function launchApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');

  // Update nav profile
  document.getElementById('nav-user-name').textContent = currentUser.name;
  const staffNameEl = document.getElementById('active-staff-name');
  if (staffNameEl) staffNameEl.textContent = currentUser.name;

  const roleLabels = {
    admin: 'Руководитель',
    dispatcher: 'Диспетчер',
    courier: 'Курьер',
    washer: 'Мастер цеха'
  };
  document.getElementById('nav-user-role').textContent = roleLabels[currentUser.role] || currentUser.role;
  const sidebarRoleEl = document.getElementById('sidebar-user-role');
  if (sidebarRoleEl) sidebarRoleEl.textContent = roleLabels[currentUser.role] || currentUser.role;

  initSidebarState();

  // Switch to dedicated role window
  applyRoleWindow(currentUser.role);

  if (currentUser.role === 'courier') {
    startCourierGpsTracking();
  }

  // Load initial datasets
  await loadInitialData();
  startLiveOrderSync();
  if (window.lucide) lucide.createIcons();
}

async function loadInitialData() {
  try {
    const [ordersRes, clientsRes, servicesRes, staffRes, callsRes] = await Promise.all([
      fetch('/api/orders'),
      fetch('/api/clients'),
      fetch('/api/services'),
      fetch('/api/employees'),
      fetch('/api/calls').catch(() => null)
    ]);

    activeOrders = await ordersRes.json();
    allClients = await clientsRes.json();
    allServices = await servicesRes.json();
    allStaff = await staffRes.json();
    if (callsRes && callsRes.ok) {
      try { allCalls = await callsRes.json(); } catch(e) { allCalls = []; }
    } else {
      allCalls = [];
    }

    // Populate dynamic staff selects
    populateStaffSelects();
    // Populate dynamic services selects
    populateServiceSelects();

    // Refresh active tab views (for Admin suite)
    renderDashboard();
    renderAnalytics();
    renderOrdersTable();
    renderKanban();
    renderArchive();
    renderClients();
    renderFinance();
    renderTariffs();
    renderStaff();
    updateTrashBadge();
    renderNotificationDrawer();
    refreshSmsBalance(false);
    loadIntegrationSettings();

    // Refresh dedicated role views
    renderDispatcherPortal();
    renderCourierPortal();
    renderWasherPortal();

    if (currentUser?.role === 'courier') renderCourierOrders();
    if (currentUser?.role === 'washer') renderWasherOrders();
  } catch (e) {
    console.error('Error loading initial data:', e);
  }
}

// ================= LIVE ORDER BACKGROUND SYNC & POLLING =================

let liveSyncInterval = null;

async function silentSyncOrders() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/orders');
    if (!res.ok) return;
    const freshOrders = await res.json();
    if (!Array.isArray(freshOrders)) return;

    // Check if anything changed in active orders
    const currentFingerprint = activeOrders.map(o => `${o.id}_${o.stage}_${o.courier_name}_${o.paid}_${o.total_price}`).join('|');
    const freshFingerprint = freshOrders.map(o => `${o.id}_${o.stage}_${o.courier_name}_${o.paid}_${o.total_price}`).join('|');

    if (currentFingerprint !== freshFingerprint) {
      activeOrders = freshOrders;
      // Do not interrupt user if any modal is currently open
      const anyModalOpen = document.querySelector('[id^="modal-"]:not(.hidden)');
      if (!anyModalOpen) {
        if (currentViewRole === 'courier' || currentUser.role === 'courier') {
          renderCourierPortal();
          if (currentUser.role === 'courier') renderCourierOrders();
        } else if (currentViewRole === 'dispatcher' || currentUser.role === 'dispatcher') {
          renderDispatcherPortal();
        } else if (currentViewRole === 'washer' || currentUser.role === 'washer') {
          renderWasherPortal();
        } else {
          renderDashboard();
          renderOrdersTable();
          renderKanban();
        }
        renderNotificationDrawer();
        updateTrashBadge();
      }
    }
  } catch (err) {
    // Silent catch on mobile flaky network
  }
}

function startLiveOrderSync() {
  if (liveSyncInterval) clearInterval(liveSyncInterval);
  liveSyncInterval = setInterval(silentSyncOrders, 6000);
}

async function manualRefreshData() {
  const refreshIcons = document.querySelectorAll('.refresh-spin-icon');
  refreshIcons.forEach(el => el.classList.add('animate-spin'));
  try {
    await loadInitialData();
    if (typeof showToast === 'function') {
      showToast('Данные успешно синхронизированы', 'success');
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast('Ошибка обновления данных', 'error');
    }
  } finally {
    setTimeout(() => {
      refreshIcons.forEach(el => el.classList.remove('animate-spin'));
    }, 600);
  }
}

// ================= ROLE WINDOWS & PORTALS CONTROLLER =================

function applyRoleWindow(role) {
  currentViewRole = role;

  const winAdmin = document.getElementById('window-admin');
  const winDisp = document.getElementById('window-dispatcher');
  const winCourier = document.getElementById('window-courier');
  const winWasher = document.getElementById('window-washer');

  const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');

  // Sidebar toggle only available in admin suite
  if (role === 'admin' && currentUser?.role === 'admin') {
    if (btnSidebarToggle) btnSidebarToggle.classList.remove('hidden');
  } else {
    if (btnSidebarToggle) btnSidebarToggle.classList.add('hidden');
  }

  // Hide all role windows first
  [winAdmin, winDisp, winCourier, winWasher].forEach(w => {
    if (w) w.classList.add('hidden');
  });

  if (role === 'admin') {
    if (winAdmin) winAdmin.classList.remove('hidden');
    switchTab(currentTab || 'dashboard');
  } else if (role === 'dispatcher') {
    if (winDisp) winDisp.classList.remove('hidden');
    const nameEl = document.getElementById('disp-portal-name');
    if (nameEl && currentUser) {
      const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim();
      nameEl.textContent = `${cleanName} (Диспетчер)`;
    }
    renderDispatcherPortal();
  } else if (role === 'courier') {
    if (winCourier) winCourier.classList.remove('hidden');
    const nameEl = document.getElementById('courier-portal-name');
    if (nameEl && currentUser) {
      const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim();
      nameEl.textContent = `${cleanName} (Курьер)`;
    }
    renderCourierPortal();
  } else if (role === 'washer') {
    if (winWasher) winWasher.classList.remove('hidden');
    const nameEl = document.getElementById('washer-portal-name');
    if (nameEl && currentUser) {
      const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim();
      nameEl.textContent = `${cleanName} (Мастер цеха)`;
    }
    renderWasherPortal();
  }

  updateRoleSwitcherUi(role);

  if (window.lucide) lucide.createIcons();
}

function updateRoleSwitcherUi(activeRole) {
  ['admin', 'dispatcher', 'courier', 'washer'].forEach(r => {
    const btn = document.getElementById(`btn-portal-switch-${r}`);
    if (btn) {
      if (r === activeRole) {
        btn.className = 'px-2.5 py-1 rounded-lg bg-butter text-emerald-deep shadow-xs flex items-center gap-1 font-bold';
      } else {
        btn.className = 'px-2.5 py-1 rounded-lg hover:bg-white/10 text-butter flex items-center gap-1 transition';
      }
    }
  });

  // Keep top switcher hidden as requested by the user
  const switcher = document.getElementById('nav-terminal-switcher');
  if (switcher) {
    switcher.classList.add('hidden');
    switcher.style.display = 'none';
  }

  const btnCourierAdmin = document.getElementById('btn-courier-to-admin');
  const btnWasherAdmin = document.getElementById('btn-washer-to-admin');
  const btnDispAdmin = document.getElementById('btn-disp-to-admin');
  [btnCourierAdmin, btnWasherAdmin, btnDispAdmin].forEach(b => {
    if (b) {
      if (currentUser?.role === 'admin') b.classList.remove('hidden');
      else b.classList.add('hidden');
    }
  });

  // Strictly control Mobile Bottom Nav: ONLY visible for Admin!
  const mobileBottomNav = document.getElementById('mobile-bottom-nav');
  if (mobileBottomNav) {
    if (activeRole === 'admin') {
      mobileBottomNav.classList.remove('hidden');
      mobileBottomNav.style.display = '';
    } else {
      mobileBottomNav.classList.add('hidden');
      mobileBottomNav.style.display = 'none';
    }
  }

  renderMobileBottomNav(activeRole);
}

let currentLiquidActiveIndex = -1;

function updateLiquidNavIndicator(activeIndex, animate = true) {
  const navItems = document.getElementById('liquid-nav-items');
  const indicator = document.getElementById('liquid-nav-indicator');
  if (!navItems || !indicator) return;

  // Center button (index 2) is a floating action button, indicator can hide or fade
  if (activeIndex < 0 || activeIndex === 2) {
    indicator.style.opacity = '0';
    currentLiquidActiveIndex = activeIndex;
    return;
  }

  const buttons = navItems.querySelectorAll('.liquid-nav-btn');
  const targetBtn = buttons[activeIndex];
  if (!targetBtn) {
    indicator.style.opacity = '0';
    return;
  }

  const navRect = navItems.getBoundingClientRect();
  const btnRect = targetBtn.getBoundingClientRect();

  if (navRect.width === 0 || btnRect.width === 0) {
    requestAnimationFrame(() => updateLiquidNavIndicator(activeIndex, false));
    return;
  }

  const targetLeft = btnRect.left - navRect.left;
  const targetWidth = btnRect.width;

  indicator.style.display = 'block';
  indicator.style.width = `${targetWidth}px`;
  indicator.style.opacity = '1';

  if (animate && currentLiquidActiveIndex >= 0 && currentLiquidActiveIndex !== activeIndex) {
    // Dynamic stretch towards movement direction
    indicator.classList.add('liquid-stretching');
    indicator.style.setProperty('--indicator-transform', `translateX(${targetLeft}px)`);
    indicator.style.transform = `translateX(${targetLeft}px)`;

    setTimeout(() => {
      indicator.classList.remove('liquid-stretching');
    }, 220);
  } else {
    indicator.style.transform = `translateX(${targetLeft}px)`;
  }

  currentLiquidActiveIndex = activeIndex;
}

function triggerLiquidRipple(event) {
  const btn = event.currentTarget;
  if (!btn) return;
  const circle = document.createElement('span');
  const diameter = Math.max(btn.clientWidth, btn.clientHeight);
  const radius = diameter / 2;
  const rect = btn.getBoundingClientRect();

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${(event.clientX ? event.clientX - rect.left : rect.width / 2) - radius}px`;
  circle.style.top = `${(event.clientY ? event.clientY - rect.top : rect.height / 2) - radius}px`;
  circle.classList.add('liquid-ripple');

  const oldRipple = btn.querySelector('.liquid-ripple');
  if (oldRipple) oldRipple.remove();

  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}

// Window resize listener to keep indicator aligned
window.addEventListener('resize', () => {
  if (currentLiquidActiveIndex >= 0) {
    updateLiquidNavIndicator(currentLiquidActiveIndex, false);
  }
});

function renderMobileBottomNav(role = currentViewRole || 'admin') {
  const navEl = document.getElementById('mobile-bottom-nav');
  if (!navEl) return;

  const currentRole = role || 'admin';

  // ПАНЕЛЬ ДОЛЖНА БЫТЬ ТОЛЬКО У АДМИНИСТРАТОРА! У курьера, мойщика и диспетчера - полностью скрыть!
  if (currentRole !== 'admin') {
    navEl.classList.add('hidden');
    navEl.style.display = 'none';
    return;
  }

  navEl.classList.remove('hidden');
  navEl.style.display = '';

  const navContainer = document.getElementById('liquid-nav-items');
  if (!navContainer) return;

  let activeIndex = -1;
  if (currentTab === 'dashboard') activeIndex = 0;
  else if (currentTab === 'orders') activeIndex = 1;
  else if (currentTab === 'kanban') activeIndex = 3;
  else activeIndex = 4; // Other tabs highlight "Меню"

  const tabs = [
    { id: 'dashboard', icon: '📊', label: 'Сводка', onClick: "switchTab('dashboard')" },
    { id: 'orders', icon: '📋', label: 'Заказы', onClick: "switchTab('orders')" },
    { id: 'new_order', isCenter: true, icon: '➕', label: 'Заказ', onClick: "openNewOrderModal()" },
    { id: 'kanban', icon: '🗂️', label: 'Канбан', onClick: "switchTab('kanban')" },
    { id: 'menu', icon: '☰', label: 'Меню', onClick: "toggleSidebar()" }
  ];

  navContainer.innerHTML = tabs.map((tab, idx) => {
    if (tab.isCenter) {
      return `
        <button type="button" 
                onclick="triggerLiquidRipple(event); ${tab.onClick};" 
                class="liquid-center-btn flex flex-col items-center justify-center w-12 h-12 -mt-5 bg-butter text-emerald-deep border-2 border-emerald-deep/20 rounded-2xl shadow-xl active:scale-95 transition shrink-0" 
                title="${tab.label}">
          <span class="text-xl leading-none font-bold">${tab.icon}</span>
          <span class="text-[9px] font-extrabold -mt-0.5">${tab.label}</span>
        </button>
      `;
    }

    const isActive = idx === activeIndex;
    return `
      <button type="button" 
              onclick="triggerLiquidRipple(event); ${tab.onClick};" 
              class="liquid-nav-btn flex flex-col items-center justify-center flex-1 py-1 min-h-[46px] ${isActive ? 'active' : ''}">
        <span class="liquid-icon text-lg leading-none ${tab.id === 'refresh' ? 'refresh-spin-icon' : ''}">${tab.icon}</span>
        <span class="liquid-label">${tab.label}</span>
      </button>
    `;
  }).join('');

  // Smoothly position liquid sliding capsule indicator
  requestAnimationFrame(() => {
    updateLiquidNavIndicator(activeIndex, true);
  });
}

// ================= SIDEBAR NAVIGATION MANAGEMENT =================

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar-panel');
  if (!sidebar) return;

  if (window.innerWidth < 768) {
    // Mobile Drawer Toggle
    const isClosed = sidebar.classList.contains('-translate-x-full');
    if (isClosed) {
      openMobileSidebar();
    } else {
      closeMobileSidebar();
    }
  } else {
    // Desktop Collapse Toggle
    toggleSidebarCollapse();
  }
}

function openMobileSidebar() {
  const sidebar = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('-translate-x-full');
  if (backdrop) backdrop.classList.remove('hidden');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar-panel');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (backdrop) backdrop.classList.add('hidden');
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar-panel');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('barokot_sidebar_collapsed', isCollapsed ? '1' : '0');

  const collapseIcon = document.getElementById('collapse-icon');
  if (collapseIcon) {
    collapseIcon.textContent = isCollapsed ? '▶' : '◀';
  }
}

function initSidebarState() {
  const isCollapsed = localStorage.getItem('barokot_sidebar_collapsed') === '1';
  const sidebar = document.getElementById('sidebar-panel');
  const collapseIcon = document.getElementById('collapse-icon');
  if (sidebar && isCollapsed && window.innerWidth >= 768) {
    sidebar.classList.add('collapsed');
    if (collapseIcon) collapseIcon.textContent = '▶';
  }
}

// ================= TAB SWITCHING =================

function switchTab(tabId) {
  currentTab = tabId;

  // Auto-close mobile drawer upon selecting tab on small screens
  if (window.innerWidth < 768) {
    closeMobileSidebar();
  }

  // Hide all views
  const views = [
    'dashboard', 'analytics', 'orders', 'kanban', 'archive', 'clients', 'calculator',
    'finance', 'tariffs', 'logistics', 'integrations', 'trash', 'staff'
  ];
  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
    const tabBtn = document.getElementById(`tab-${v}`);
    if (tabBtn) {
      tabBtn.classList.remove('bg-emerald-deep', 'text-butter', 'shadow');
      tabBtn.classList.add('text-emerald-deep');
    }
  });

  // Show active view
  const activeEl = document.getElementById(`view-${tabId}`);
  if (activeEl) activeEl.classList.remove('hidden');

  const activeTabBtn = document.getElementById(`tab-${tabId}`);
  if (activeTabBtn) {
    activeTabBtn.classList.add('bg-emerald-deep', 'text-butter', 'shadow');
    activeTabBtn.classList.remove('text-emerald-deep');
  }

  // View specific triggers
  if (tabId === 'analytics') {
    renderAnalytics();
  } else if (tabId === 'archive') {
    renderArchive();
  } else if (tabId === 'logistics') {
    setTimeout(initLogisticsMap, 100);
  } else if (tabId === 'trash') {
    loadTrashOrders();
  } else if (tabId === 'calculator') {
    recalculateCalcTotal();
  } else if (tabId === 'finance') {
    renderFinance();
    populateStaffSelects();
    const dateInput = document.getElementById('shift-date-input');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    loadCourierShiftsHistory();
  } else if (tabId === 'integrations') {
    loadIntegrationSettings();
    checkDbStatus();
    refreshSmsBalance(false);
  }

  renderMobileBottomNav('admin');
  if (window.lucide) lucide.createIcons();
}

// ================= VIEW 1: DASHBOARD =================

function renderDashboard() {
  let totalM2 = 0;
  let totalRevenue = 0;
  let paidRevenue = 0;
  let clientDebts = 0;
  let inShopCount = 0;
  let readyCount = 0;

  activeOrders.forEach(o => {
    totalM2 += Number(o.total_m2) || 0;
    const price = Number(o.total_price) || 0;
    totalRevenue += price;
    const paid = o.paid ? price : (Number(o.paid_amount) || 0);
    paidRevenue += paid;
    if (paid < price && o.stage !== 'cancelled') {
      clientDebts += (price - paid);
    }
    if (['in_shop', 'dusting', 'washing', 'drying'].includes(o.stage)) inShopCount++;
    if (['ready', 'delivery'].includes(o.stage)) readyCount++;
  });

  document.getElementById('stat-total-orders').textContent = activeOrders.length;
  document.getElementById('stat-total-m2').textContent = totalM2.toFixed(1);
  document.getElementById('stat-washing-count').textContent = inShopCount;
  document.getElementById('stat-drying-count').textContent = readyCount;
  document.getElementById('stat-total-revenue').textContent = totalRevenue.toLocaleString() + ' сум';
  document.getElementById('stat-paid-revenue').textContent = paidRevenue.toLocaleString();
  document.getElementById('stat-client-debts').textContent = clientDebts.toLocaleString() + ' сум';

  // Render urgent and recent list
  const urgentList = document.getElementById('dashboard-urgent-list');
  const urgentOrders = activeOrders.filter(o => o.urgent || o.stage === 'ready' || o.stage === 'pickup').slice(0, 5);

  if (urgentOrders.length === 0) {
    urgentList.innerHTML = '<div class="text-xs text-charcoal-muted italic py-4 text-center">Нет срочных или требующих внимания заказов</div>';
  } else {
    urgentList.innerHTML = urgentOrders.map(o => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-white border border-emerald-deep/15 hover:border-emerald-deep transition shadow-sm cursor-pointer" onclick="openEditOrderModal('${o.id}')">
        <div class="flex items-center space-x-3">
          <div class="w-9 h-9 rounded-xl ${o.urgent ? 'bg-rose-100 text-rose-700' : 'bg-emerald-deep/10 text-emerald-deep'} flex items-center justify-center font-bold text-xs">
            ${o.urgent ? '⚡' : '🏷️'}
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-xs text-emerald-deep">${o.id}</span>
              <span class="text-xs font-semibold text-charcoal-muted">${escapeHtml(o.client_name)}</span>
              ${o.urgent ? '<span class="text-[10px] bg-rose-600 text-white px-1.5 py-0.2 rounded font-bold">СРОЧНО</span>' : ''}
            </div>
            <div class="text-[11px] text-charcoal-muted flex items-center gap-2 mt-0.5">
              <span>📍 ${escapeHtml(o.district || 'Сиёб')}, ${escapeHtml(o.client_address)}</span>
              <span>•</span>
              <span class="font-mono font-bold">${(o.total_price || 0).toLocaleString()} сум</span>
            </div>
          </div>
        </div>
        <div class="text-right">
          ${getStageBadge(o.stage)}
        </div>
      </div>
    `).join('');
  }

  // Render recent audit log
  const auditList = document.getElementById('dashboard-audit-list');
  const recentOrders = activeOrders.slice(0, 6);
  auditList.innerHTML = recentOrders.map(o => `
    <div class="flex items-start gap-2 border-b border-emerald-deep/10 pb-2">
      <div class="w-2 h-2 rounded-full bg-emerald-deep mt-1.5 shrink-0"></div>
      <div>
        <div class="font-semibold text-emerald-deep">Заказ #${o.id} — ${getStageText(o.stage)}</div>
        <div class="text-[10px] text-charcoal-muted">${escapeHtml(o.client_name)} (${o.pickup_date || o.created_at})</div>
      </div>
    </div>
  `).join('');
}

// ================= VIEW 2: ORDERS TABLE =================

function renderOrdersTable(filteredList = null) {
  const tbody = document.getElementById('orders-table-body');
  const list = filteredList || activeOrders;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-charcoal-muted italic">Заказы не найдены</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(o => {
    const carpets = o.carpets || [];
    const carpetsDesc = carpets.length > 0
      ? carpets.map(c => `${c.name || 'Ковер'} (${(c.unit === 'м²' || !c.unit) ? (c.area || 0) + 'м²' : (c.qty || 1) + ' ' + (c.unit || 'шт')})`).join(', ')
      : 'Ковры (б/н)';

    const isPaid = o.paid;
    const paidBadge = isPaid
      ? '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Оплачен</span>'
      : (o.paid_amount > 0
        ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Частично (${(o.paid_amount).toLocaleString()})</span>`
        : '<span class="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Не оплачен</span>');

    const callsCount = getOrderCallCount(o.id, o.client_phone);
    const hasExactGps = Boolean(o.gps_location && o.gps_location.includes(','));
    const photosCount = (o.photos && Array.isArray(o.photos)) ? o.photos.length : 0;

    return `
      <tr class="hover:bg-butter-surface/60 transition cursor-pointer" onclick="openEditOrderModal('${o.id}')">
        <td class="py-3 px-4 font-mono font-bold text-emerald-deep whitespace-nowrap">
          ${o.id} ${o.urgent ? '<span class="text-rose-600 font-bold" title="Срочный">⚡</span>' : ''}
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-emerald-deep">${escapeHtml(o.client_name)}</div>
          <div class="flex items-center gap-1.5 mt-0.5" onclick="event.stopPropagation()">
            <button type="button" onclick="callClient('${o.id}', '${escapeHtml(o.client_phone)}', '${escapeHtml(o.client_name)}')" class="text-[11px] text-emerald-deep font-bold hover:underline font-mono flex items-center gap-0.5" title="Позвонить с фиксацией в CRM">
              📞 ${escapeHtml(o.client_phone)}
            </button>
            <button type="button" onclick="openCallHistoryModal('${o.id}', '${escapeHtml(o.client_phone)}', '${escapeHtml(o.client_name)}')" class="text-[9px] px-1.5 py-0.5 rounded font-bold ${callsCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-gray-100 text-charcoal-muted'} hover:opacity-80" title="Журнал звонков (${callsCount} вызовов)">
              ${callsCount > 0 ? `${callsCount} зв.` : '0'}
            </button>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="font-semibold text-emerald-deep flex items-center gap-1.5" onclick="event.stopPropagation()">
            <span class="cursor-pointer hover:underline" onclick="openNavigationModal('${o.id}')" title="Построить маршрут к клиенту">${escapeHtml(o.client_address)}</span>
            <button type="button" onclick="openNavigationModal('${o.id}')" class="text-[10px] px-1.5 py-0.5 rounded font-bold ${hasExactGps ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} hover:opacity-80" title="Маршрут к заказу (Яндекс / Google)">
              ${hasExactGps ? '🎯 GPS' : '📍 Район'}
            </button>
          </div>
          <div class="text-[10px] text-charcoal-muted">${escapeHtml(o.district || 'Сиёб')}${o.landmark ? ' (' + escapeHtml(o.landmark) + ')' : ''}</div>
          ${o.notes ? `<div class="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-0.5 max-w-[200px] truncate" title="Комментарий диспетчера: ${escapeHtml(o.notes)}">💬 ${escapeHtml(o.notes)}</div>` : ''}
        </td>
        <td class="py-3 px-4 max-w-[200px]" title="${escapeHtml(carpetsDesc)}">
          <div class="font-semibold text-emerald-deep flex items-center gap-1.5">
            <span>${o.total_m2 ? o.total_m2 + ' м²' : carpets.length + ' изд.'}</span>
            <button type="button" onclick="event.stopPropagation(); openMeasureModalForOrder('${o.id}')" class="text-[10px] text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-300 px-1.5 py-0.5 rounded font-bold transition" title="Внести / изменить замеры">📐 Замер</button>
          </div>
          <div class="text-[10px] text-charcoal-muted truncate">${escapeHtml(carpetsDesc)}</div>
          ${photosCount > 0 ? `<div class="mt-1" onclick="event.stopPropagation()"><button type="button" onclick="openOrderPhotosModal('${o.id}')" class="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200 transition inline-flex items-center gap-1">📸 ${photosCount} фото</button></div>` : ''}
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          ${getStageBadge(o.stage)}
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <div class="font-mono font-bold text-emerald-deep">${(o.total_price || 0).toLocaleString()} сум</div>
          <div class="mt-0.5">${paidBadge}</div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-charcoal-muted">
          ${escapeHtml(o.courier_name || 'Не назначен')}
        </td>
        <td class="py-3 px-4 text-right whitespace-nowrap" onclick="event.stopPropagation()">
          <button onclick="openMeasureModalForOrder('${o.id}')" title="Внести точные замеры изделий (длина × ширина)" class="p-1 text-sky-700 hover:bg-sky-100 rounded font-bold mr-0.5">
            📐
          </button>
          <button onclick="openOrderPhotosModal('${o.id}')" title="Фото ковра и дефектов (${photosCount})" class="p-1 text-blue-700 hover:bg-blue-100 rounded font-bold mr-0.5">
            📸
          </button>
          <button onclick="openCourierDeliveryModal('${o.id}')" title="Вручение клиенту и расчет" class="p-1 text-amber-700 hover:bg-amber-100 rounded font-bold mr-0.5">
            💰
          </button>
          <button onclick="printOrderReceipt('${o.id}')" title="Печать чека 80мм" class="p-1 text-charcoal-muted hover:text-emerald-deep rounded hover:bg-emerald-deep/10">
            🖨️
          </button>
          <button onclick="showQrForOrderId('${o.id}')" title="QR для клиента" class="p-1 text-charcoal-muted hover:text-emerald-deep rounded hover:bg-emerald-deep/10">
            📱
          </button>
          <button onclick="openEditOrderModal('${o.id}')" title="Редактировать" class="p-1 text-charcoal-muted hover:text-emerald-deep rounded hover:bg-emerald-deep/10">
            ✏️
          </button>
          <button onclick="deleteOrderToTrash('${o.id}')" title="Удалить в корзину" class="p-1 text-rose-600 hover:text-rose-800 rounded hover:bg-rose-100">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function applyOrdersFilter() {
  const stage = document.getElementById('filter-order-stage').value;
  const payment = document.getElementById('filter-order-payment').value;
  const urgent = document.getElementById('filter-order-urgent').checked;

  const filtered = activeOrders.filter(o => {
    if (stage !== 'all' && o.stage !== stage) return false;
    if (payment === 'paid' && !o.paid) return false;
    if (payment === 'unpaid' && (o.paid || o.paid_amount > 0)) return false;
    if (payment === 'partial' && (o.paid || !o.paid_amount)) return false;
    if (urgent && !o.urgent) return false;
    return true;
  });

  renderOrdersTable(filtered);
}

function handleGlobalSearch(query) {
  if (!query || !query.trim()) {
    renderOrdersTable();
    return;
  }
  const q = query.toLowerCase().trim();
  const matched = activeOrders.filter(o => 
    (o.id && o.id.toLowerCase().includes(q)) ||
    (o.client_name && o.client_name.toLowerCase().includes(q)) ||
    (o.client_phone && o.client_phone.includes(q)) ||
    (o.client_address && o.client_address.toLowerCase().includes(q)) ||
    (o.district && o.district.toLowerCase().includes(q))
  );

  if (currentTab !== 'orders') switchTab('orders');
  renderOrdersTable(matched);
}

// Hotkey Ctrl + K
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const input = document.getElementById('global-search-input');
    if (input) {
      input.focus();
      input.select();
    }
  }
});

// ================= VIEW 3: KANBAN BOARD (4 ЭТАПА) =================

function renderKanban() {
  const stages = ['pickup', 'in_shop', 'ready', 'delivered'];
  const counts = { pickup: 0, in_shop: 0, ready: 0, delivered: 0 };

  stages.forEach(st => {
    const col = document.getElementById(`kanban-col-${st}`);
    if (col) col.innerHTML = '';
  });

  activeOrders.forEach(o => {
    let st = normalizeStage(o.stage);
    if (st === 'delivery') st = 'ready';

    if (counts[st] !== undefined) counts[st]++;
    const photosCount = (o.photos && Array.isArray(o.photos)) ? o.photos.length : 0;
    const col = document.getElementById(`kanban-col-${st}`);
    if (col) {
      col.innerHTML += `
        <div class="bg-white rounded-xl p-3 border border-emerald-deep/15 shadow-sm space-y-2 hover:border-emerald-deep transition cursor-pointer" onclick="openEditOrderModal('${o.id}')">
          <div class="flex items-center justify-between text-[11px]">
            <div class="flex items-center gap-1.5">
              <span class="font-mono font-bold text-emerald-deep">#${escapeHtml(o.id)}</span>
              ${photosCount > 0 ? `<button type="button" onclick="event.stopPropagation(); openOrderPhotosModal('${o.id}')" class="text-[9px] px-1.5 py-0.2 rounded font-bold bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200" title="Фото изделий (${photosCount})">📸 ${photosCount}</button>` : ''}
            </div>
            ${o.urgent ? '<span class="text-rose-600 font-bold">⚡ СРОЧНО</span>' : ''}
          </div>
          <div class="font-bold text-xs text-emerald-deep truncate">${escapeHtml(o.client_name)}</div>
          <div class="text-[10px] text-charcoal-muted truncate">📍 ${escapeHtml(o.client_address)}</div>
          <div class="border-t border-dashed border-emerald-deep/15 pt-1.5 flex items-center justify-between text-[11px]">
            <span class="font-mono font-bold text-emerald-deep">${(o.total_price || 0).toLocaleString()} сум</span>
            <span class="text-[10px] text-charcoal-muted font-bold">${o.total_m2 ? o.total_m2 + ' м²' : '—'}</span>
          </div>
          <!-- Quick Move Buttons across 4 stages -->
          <div class="flex justify-between items-center pt-1 border-t border-emerald-deep/10 text-[10px]" onclick="event.stopPropagation()">
            <button onclick="advanceOrderStage('${o.id}', -1)" title="Шаг назад" class="text-charcoal-muted hover:text-emerald-deep px-1.5 py-0.5 rounded bg-butter-surface border">←</button>
            <button type="button" onclick="openMeasureModalForOrder('${o.id}')" class="text-sky-700 bg-sky-50 border border-sky-300 hover:bg-sky-100 px-1.5 py-0.5 rounded font-bold transition" title="Внести замеры изделий">📐 Замер</button>
            <span class="text-[9px] text-charcoal-muted">${escapeHtml(o.courier_name ? o.courier_name.split(' ')[0] : '—')}</span>
            <button onclick="advanceOrderStage('${o.id}', 1)" title="Шаг вперед" class="text-emerald-deep font-bold hover:bg-emerald-deep hover:text-butter px-1.5 py-0.5 rounded bg-butter border">→</button>
          </div>
        </div>
      `;
    }
  });

  stages.forEach(st => {
    const badge = document.getElementById(`kanban-badge-${st}`);
    if (badge) badge.textContent = counts[st];
  });
}

async function advanceOrderStage(orderId, direction) {
  const stages = ['pickup', 'in_shop', 'ready', 'delivered'];
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  let currentStage = normalizeStage(order.stage);
  if (currentStage === 'delivery') currentStage = 'ready';

  const currentIdx = stages.indexOf(currentStage);
  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= stages.length) return;

  const targetStage = stages[targetIdx];
  try {
    const res = await fetch(`/api/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: targetStage, actor_name: currentUser?.name || 'Администратор' })
    });
    if (res.ok) {
      order.stage = targetStage;
      renderKanban();
      renderOrdersTable();
      renderDashboard();
      renderDispatcherPortal();
      renderCourierPortal();
      renderWasherPortal();
    }
  } catch (e) {
    alert('Ошибка при смене этапа заказа.');
  }
}

// ================= VIEW 4: CLIENTS CRM =================

function renderClients() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;

  if (allClients.length === 0) {
    grid.innerHTML = '<div class="col-span-3 text-center py-8 text-charcoal-muted italic">База клиентов пуста</div>';
    return;
  }

  grid.innerHTML = allClients.map(c => {
    const tierBadge = c.tier === 'VIP'
      ? '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300">👑 VIP (10%)</span>'
      : (c.tier === 'Premier'
        ? '<span class="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-300">⭐ Premier (5%)</span>'
        : '<span class="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full">Standard (0%)</span>');

    const callsCount = getOrderCallCount('', c.phone);

    return `
      <div class="bg-butter-surface border-2 border-emerald-deep/15 rounded-2xl p-5 shadow-sm space-y-3 hover:border-emerald-deep transition">
        <div class="flex items-center justify-between">
          <div class="font-serif text-lg font-bold text-emerald-deep">${escapeHtml(c.name)}</div>
          ${tierBadge}
        </div>
        <div class="space-y-1.5 text-xs">
          <div class="flex items-center justify-between font-mono font-bold text-xs">
            <button type="button" onclick="callClient('', '${escapeHtml(c.phone)}', '${escapeHtml(c.name)}')" class="hover:underline flex items-center gap-1.5 text-emerald-deep" title="Позвонить клиенту с фиксацией в CRM">
              <i data-lucide="phone-call" class="w-3.5 h-3.5 text-emerald-deep"></i>
              <span>${escapeHtml(c.phone)}</span>
            </button>
            <button type="button" onclick="openCallHistoryModal('', '${escapeHtml(c.phone)}', '${escapeHtml(c.name)}')" class="text-[10px] px-2 py-0.5 rounded-full font-bold ${callsCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-gray-100 text-charcoal-muted'} hover:opacity-80" title="Журнал звонков (${callsCount} вызовов)">
              ${callsCount > 0 ? `📞 ${callsCount} зв.` : '0 зв.'}
            </button>
          </div>
          <div class="flex items-start justify-between gap-1 text-charcoal-muted">
            <div class="flex items-start gap-1.5 overflow-hidden">
              <i data-lucide="map-pin" class="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-deep"></i>
              <span>${escapeHtml(c.address || 'Самарканд')} ${c.landmark ? '(' + escapeHtml(c.landmark) + ')' : ''}</span>
            </div>
            ${c.gps_location ? `<span class="text-[10px] text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded font-bold shrink-0" title="GPS: ${escapeHtml(c.gps_location)}">🎯 GPS</span>` : ''}
          </div>
        </div>
        <div class="border-t border-emerald-deep/10 pt-2 flex items-center justify-between text-xs">
          <div>
            <span class="text-charcoal-muted">Заказов:</span>
            <b class="font-mono text-emerald-deep">${c.total_orders || 0}</b>
          </div>
          <div>
            <span class="text-charcoal-muted">LTV:</span>
            <b class="font-mono text-emerald-deep">${(c.total_spent || 0).toLocaleString()} сум</b>
          </div>
        </div>
        <div class="pt-1 flex gap-2">
          <button onclick="createOrderForClientId('${c.id}')" class="flex-1 py-1.5 bg-emerald-deep text-butter text-xs font-bold rounded-xl shadow hover:bg-emerald-hover transition">
            + Новый заказ
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function createOrderForClientId(clientId) {
  const client = allClients.find(c => String(c.id) === String(clientId));
  if (!client) return;
  openNewOrderModal();
  document.getElementById('order-client-name').value = client.name || '';
  document.getElementById('order-client-phone').value = client.phone || '';
  document.getElementById('order-client-address').value = client.address || '';
  document.getElementById('order-district').value = client.district || 'Сиёб';
  document.getElementById('order-landmark').value = client.landmark || '';
}

// ================= VIEW 5: CALCULATOR =================

function populateServiceSelects() {
  const calcSelects = document.querySelectorAll('.calc-service-select');
  calcSelects.forEach(sel => {
    const currentVal = sel.value;
    sel.innerHTML = allServices.map(s => `
      <option value="${s.id}" data-price="${s.price}" data-unit="${s.unit}">${s.name} (${s.price.toLocaleString()} сум / ${s.unit})</option>
    `).join('');
    if (currentVal) sel.value = currentVal;
  });
}

function addCalcRow() {
  const container = document.getElementById('calc-items-container');
  const div = document.createElement('div');
  div.className = 'flex flex-col sm:grid sm:grid-cols-12 gap-2 sm:items-center bg-white p-3 rounded-xl border border-emerald-deep/15';
  div.innerHTML = `
    <div class="w-full sm:col-span-4">
      <label class="text-[10px] font-bold text-charcoal-muted uppercase">Услуга</label>
      <select class="calc-service-select w-full p-2 text-xs rounded-lg border border-emerald-deep/20 bg-butter-surface font-semibold text-emerald-deep" onchange="recalculateCalcTotal()">
        ${allServices.map(s => `<option value="${s.id}" data-price="${s.price}" data-unit="${s.unit}">${s.name} (${s.price.toLocaleString()} сум / ${s.unit})</option>`).join('')}
      </select>
    </div>
    <div class="grid grid-cols-2 gap-2 sm:contents">
      <div class="sm:col-span-3">
        <label class="text-[10px] font-bold text-charcoal-muted uppercase">Длина (м) / Кол-во</label>
        <input type="number" step="0.1" value="2.5" class="calc-length-input w-full p-2 text-xs rounded-lg border border-emerald-deep/20 bg-butter-surface font-bold text-emerald-deep" oninput="recalculateCalcTotal()">
      </div>
      <div class="sm:col-span-3">
        <label class="text-[10px] font-bold text-charcoal-muted uppercase">Ширина (м)</label>
        <input type="number" step="0.1" value="2.0" class="calc-width-input w-full p-2 text-xs rounded-lg border border-emerald-deep/20 bg-butter-surface font-bold text-emerald-deep" oninput="recalculateCalcTotal()">
      </div>
    </div>
    <div class="flex sm:block justify-between items-center sm:col-span-2 sm:text-right pt-1 sm:pt-0 border-t sm:border-t-0 border-emerald-deep/10">
      <label class="text-[10px] font-bold text-charcoal-muted uppercase">Сумма:</label>
      <div class="calc-row-total text-xs font-mono font-bold text-emerald-deep sm:mt-1">0 сум</div>
    </div>
  `;
  container.appendChild(div);
  recalculateCalcTotal();
}

function recalculateCalcTotal() {
  const rows = document.querySelectorAll('#calc-items-container > div');
  let grandTotal = 0;
  let totalArea = 0;

  rows.forEach(row => {
    const sel = row.querySelector('.calc-service-select');
    const lengthInput = row.querySelector('.calc-length-input');
    const widthInput = row.querySelector('.calc-width-input');
    const rowTotal = row.querySelector('.calc-row-total');

    const opt = sel.options[sel.selectedIndex];
    const price = opt ? parseFloat(opt.getAttribute('data-price')) || 0 : 0;
    const unit = opt ? opt.getAttribute('data-unit') : 'м²';

    const rawLen = parseFloat(lengthInput.value);
    const rawWid = parseFloat(widthInput.value);
    const len = isNaN(rawLen) || rawLen < 0 ? 0 : rawLen;
    const wid = isNaN(rawWid) || rawWid < 0 ? 0 : rawWid;

    let cost = 0;
    if (unit === 'м²') {
      const area = len * wid;
      totalArea += area;
      cost = area * price;
    } else if (unit === 'метр') {
      cost = len * price;
    } else {
      cost = len * price; // pieces / sets
    }

    grandTotal += cost;
    if (rowTotal) rowTotal.textContent = Math.round(cost).toLocaleString() + ' сум';
  });

  const urgentCheck = document.getElementById('calc-urgent-check');
  if (urgentCheck && urgentCheck.checked) grandTotal *= 1.2;

  const ozonCheck = document.getElementById('calc-ozon-check');
  if (ozonCheck && ozonCheck.checked) grandTotal += 20000;

  const discountSelect = document.getElementById('calc-discount-select');
  const discountPercent = discountSelect ? parseFloat(discountSelect.value) || 0 : 0;
  if (discountPercent > 0) {
    grandTotal -= grandTotal * (discountPercent / 100);
  }

  document.getElementById('calc-total-m2').textContent = totalArea.toFixed(2);
  document.getElementById('calc-grand-total').textContent = Math.round(grandTotal).toLocaleString() + ' сум';
}

function exportCalcToNewOrder() {
  openNewOrderModal();
  const rows = document.querySelectorAll('#calc-items-container > div');
  const itemsContainer = document.getElementById('order-form-items-container');
  if (itemsContainer) itemsContainer.innerHTML = '';

  rows.forEach(row => {
    const sel = row.querySelector('.calc-service-select');
    const opt = sel ? sel.options[sel.selectedIndex] : null;
    const name = opt ? opt.text.split(' (')[0] : 'Gilam Standart';
    const price = opt ? opt.getAttribute('data-price') : 14000;
    const unit = opt ? opt.getAttribute('data-unit') : 'м²';

    addOrderFormItemRow({ name, price, unit, qty: 1 });
  });

  const urgentCheck = document.getElementById('calc-urgent-check');
  if (urgentCheck && urgentCheck.checked) {
    document.getElementById('order-urgent-check').checked = true;
  }
}

// ================= VIEW 6: FINANCE & SALARIES =================

async function renderFinance() {
  try {
    const [overviewRes, debtsRes, advancesRes] = await Promise.all([
      fetch('/api/finance/overview'),
      fetch('/api/finance/debts'),
      fetch('/api/finance/advances')
    ]);

    const overview = await overviewRes.json();
    const debts = await debtsRes.json();
    const advances = await advancesRes.json();

    document.getElementById('fin-total-revenue').textContent = (overview.totalRevenue || 0).toLocaleString() + ' сум';
    document.getElementById('fin-paid-revenue').textContent = (overview.paidRevenue || 0).toLocaleString() + ' сум';
    document.getElementById('fin-paid-advances').textContent = (overview.paidAdvances || 0).toLocaleString() + ' сум';
    document.getElementById('fin-client-debts').textContent = (overview.clientDebts || 0).toLocaleString() + ' сум';

    const cashInHand = Math.max(0, (overview.paidRevenue || 0) - (overview.paidAdvances || 0));
    const cashEl = document.getElementById('fin-cash-register');
    if (cashEl) cashEl.textContent = cashInHand.toLocaleString() + ' сум';

    // Render Debts List
    const debtsList = document.getElementById('finance-debts-list');
    if (debts.length === 0) {
      debtsList.innerHTML = '<div class="text-xs text-charcoal-muted italic py-4 text-center">Задолженностей клиентов нет</div>';
    } else {
      debtsList.innerHTML = debts.map(d => `
        <div class="bg-white p-3 rounded-xl border border-rose-200 shadow-sm flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-rose-800">${escapeHtml(d.client_name)} (#${d.id})</div>
            <div class="text-[10px] text-charcoal-muted">${escapeHtml(d.client_phone)} • ${escapeHtml(d.client_address)}</div>
            ${d.underpaid_reason ? `<div class="text-[10px] text-rose-700 italic mt-0.5">Причина: ${escapeHtml(d.underpaid_reason)}</div>` : ''}
          </div>
          <div class="text-right space-y-1">
            <div class="font-mono font-bold text-rose-700 text-sm">${(d.debt_amount || 0).toLocaleString()} сум</div>
            <button onclick="openPayDebtModal('${d.id}', ${d.debt_amount})" class="py-1 px-2.5 bg-emerald-deep text-butter font-bold rounded-lg text-[10px] hover:bg-emerald-hover shadow">
              Принять доплату
            </button>
          </div>
        </div>
      `).join('');
    }

    // Render Advances List
    const advList = document.getElementById('finance-advances-list');
    if (advances.length === 0) {
      advList.innerHTML = '<div class="text-xs text-charcoal-muted italic py-4 text-center">Авансы еще не выдавались</div>';
    } else {
      advList.innerHTML = advances.map(a => `
        <div class="bg-white p-3 rounded-xl border border-emerald-deep/15 shadow-sm flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-emerald-deep">${escapeHtml(a.employee_name)}</div>
            <div class="text-[10px] text-charcoal-muted">${a.date} • ${escapeHtml(a.method || 'Наличные')}</div>
            ${a.note ? `<div class="text-[10px] text-charcoal-muted italic mt-0.5">${escapeHtml(a.note)}</div>` : ''}
          </div>
          <div class="font-mono font-bold text-amber-700 text-sm">
            -${(a.amount || 0).toLocaleString()} сум
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.error('Error rendering finance:', e);
  }
}

function openAdvanceModal() {
  const select = document.getElementById('adv-staff-select');
  select.innerHTML = allStaff.map(s => `
    <option value="${s.id}" data-name="${s.name}" data-role="${s.role}">${s.name} (${s.role})</option>
  `).join('');
  document.getElementById('modal-advance').classList.remove('hidden');
}

async function handleAdvanceSubmit(e) {
  e.preventDefault();
  const select = document.getElementById('adv-staff-select');
  const opt = select.options[select.selectedIndex];
  const amount = document.getElementById('adv-amount').value;
  const method = document.getElementById('adv-method').value;
  const note = document.getElementById('adv-note').value;

  try {
    const res = await fetch('/api/finance/advances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: opt ? opt.value : null,
        employee_name: opt ? opt.getAttribute('data-name') : 'Сотрудник',
        employee_role: opt ? opt.getAttribute('data-role') : '',
        amount: Number(amount),
        method,
        note
      })
    });
    if (res.ok) {
      closeModal('modal-advance');
      renderFinance();
      alert('Аванс успешно зафиксирован в кассе!');
    } else {
      const err = await res.json();
      alert(err.error || 'Ошибка фиксации аванса.');
    }
  } catch (err) {
    alert('Ошибка фиксации аванса.');
  }
}

async function openPayDebtModal(orderId, remainingDebt) {
  const amountStr = prompt(`Введите сумму полученной доплаты по заказу #${orderId} (Остаток долга: ${remainingDebt.toLocaleString()} сум):`, remainingDebt);
  if (!amountStr) return;

  const amt = parseInt(amountStr.replace(/\D/g, ''), 10);
  if (isNaN(amt) || amt <= 0) {
    alert('Неверная сумма');
    return;
  }

  try {
    const res = await fetch('/api/finance/debts/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, amount: amt, method: 'Наличные' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✅ Доплата ${amt.toLocaleString()} сум успешно принята и внесена в кассу!`);
      await loadInitialData();
      renderFinance();
    } else {
      alert(data.error || 'Ошибка при проведении доплаты.');
    }
  } catch (e) {
    alert('Ошибка при проведении доплаты.');
  }
}

// ================= EVENING CASH RECONCILIATION & Z-REPORT =================
let currentCourierShiftData = null;

async function loadCourierShiftSummary() {
  const courierSelect = document.getElementById('shift-courier-select');
  const dateInput = document.getElementById('shift-date-input');
  const resultBox = document.getElementById('courier-shift-result-box');
  if (!resultBox) return;

  const courier = courierSelect ? courierSelect.value : '';
  const date = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);

  if (!courier) {
    alert('Пожалуйста, выберите курьера');
    return;
  }

  resultBox.innerHTML = `
    <div class="py-8 text-center text-charcoal-muted">
      <div class="inline-block animate-spin w-6 h-6 border-2 border-emerald-deep border-t-transparent rounded-full mb-2"></div>
      <p class="text-xs font-bold">Рассчитываем баланс смены для ${escapeHtml(courier)} за ${date}...</p>
    </div>
  `;

  try {
    const res = await fetch(`/api/finance/courier-shift?courier_name=${encodeURIComponent(courier)}&date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сервера при расчете смены');
    }

    const data = await res.json();
    currentCourierShiftData = data;

    const nonCash = (data.click_collected || 0) + (data.payme_collected || 0) + (data.card_collected || 0);

    let debtsHtml = '';
    if (data.debts_list && data.debts_list.length > 0) {
      debtsHtml = `
        <div class="mt-3 bg-rose-50/70 border border-rose-200 rounded-xl p-3 space-y-2">
          <div class="font-bold text-xs text-rose-800 flex items-center gap-1.5">
            <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-700"></i>
            <span>Недоплаты / долги клиентов за смену (${data.debts_list.length}):</span>
          </div>
          <div class="space-y-1 text-xs">
            ${data.debts_list.map(d => `
              <div class="flex items-center justify-between bg-white p-2 rounded-lg border border-rose-200/80">
                <div>
                  <span class="font-bold text-rose-900">${escapeHtml(d.client_name)}</span>
                  <span class="text-[10px] text-charcoal-muted font-mono ml-1">#${escapeHtml(d.order_id)}</span>
                  <span class="text-[10px] text-charcoal-muted ml-1">• ${escapeHtml(d.client_phone)}</span>
                  ${d.reason ? `<div class="text-[10px] text-rose-700 italic">Причина: ${escapeHtml(d.reason)}</div>` : ''}
                </div>
                <div class="font-mono font-bold text-rose-700 text-xs">
                  ${d.debt_amount.toLocaleString()} сум
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let expensesHtml = '';
    if (data.expenses_list && data.expenses_list.length > 0) {
      expensesHtml = `
        <div class="mt-3 bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
          <div class="font-bold text-xs text-amber-900 flex items-center gap-1.5">
            <i data-lucide="fuel" class="w-4 h-4 text-amber-700"></i>
            <span>Служебные расходы / ГСМ за день (${data.expenses_list.length}):</span>
          </div>
          <div class="space-y-1 text-xs">
            ${data.expenses_list.map(e => `
              <div class="flex items-center justify-between bg-white p-2 rounded-lg border border-amber-200/80">
                <div>
                  <span class="font-bold text-amber-950">${escapeHtml(e.note || 'Служебный расход')}</span>
                  <span class="text-[10px] text-charcoal-muted ml-1">(${e.method || 'Наличные'})</span>
                </div>
                <div class="font-mono font-bold text-amber-800 text-xs">
                  -${(Number(e.amount) || 0).toLocaleString()} сум
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    let actionBoxHtml = '';
    if (data.is_accepted) {
      const rec = data.shift_record || {};
      actionBoxHtml = `
        <div class="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
            <div>
              <span class="font-bold text-emerald-900">Смена успешно сдана и принята!</span>
              <div class="text-[11px] text-emerald-800 mt-0.5">
                Принял: <b>${escapeHtml(rec.accepted_by || 'Администратор')}</b> • ${rec.accepted_at ? formatDateSafe(rec.accepted_at, true) : ''}
              </div>
              ${rec.notes ? `<div class="text-[10px] text-emerald-700 italic mt-0.5">Примечание: ${escapeHtml(rec.notes)}</div>` : ''}
            </div>
          </div>
          <button type="button" onclick="printCourierZReport()" class="py-2 px-3.5 bg-emerald-deep text-butter font-bold rounded-xl text-xs hover:bg-emerald-hover transition shadow-sm flex items-center gap-1.5">
            <i data-lucide="printer" class="w-4 h-4"></i>
            Распечатать Z-отчет (80мм)
          </button>
        </div>
      `;
    } else {
      actionBoxHtml = `
        <div class="bg-white border-2 border-emerald-deep/25 rounded-xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="font-bold text-xs text-emerald-deep flex items-center gap-1.5">
              <i data-lucide="shield-check" class="w-4 h-4 text-emerald-deep"></i>
              Приёмка вечерней кассы и закрытие смены
            </div>
            <button type="button" onclick="printCourierZReport()" class="py-1.5 px-3 bg-white border border-emerald-deep/20 text-emerald-deep font-bold rounded-xl text-xs hover:bg-butter transition shadow-xs flex items-center gap-1.5">
              <i data-lucide="printer" class="w-4 h-4"></i>
              Предпросмотр Z-отчета (80мм)
            </button>
          </div>
          <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
            <input type="text" id="shift-notes-input" placeholder="Примечание к сдаче (например: всё сходится, сдано 1 450 000 сум)" class="flex-1 p-2 rounded-xl border border-emerald-deep/20 text-xs bg-white">
            <button type="button" onclick="acceptCourierShift()" class="w-full sm:w-auto py-2 px-5 bg-emerald-deep text-butter font-bold rounded-xl text-xs hover:bg-emerald-hover transition shadow flex items-center justify-center gap-1.5 whitespace-nowrap">
              <i data-lucide="check-circle-2" class="w-4 h-4"></i>
              Принять смену в кассу
            </button>
          </div>
        </div>
      `;
    }

    resultBox.innerHTML = `
      <!-- KPI Row -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <div class="theme-card border border-emerald-deep/20 rounded-xl p-3 shadow-xs">
          <div class="text-[10px] font-bold text-charcoal-muted uppercase">Доставлено</div>
          <div class="text-base font-bold font-mono text-emerald-deep mt-0.5">${data.orders_count} заказов</div>
        </div>
        <div class="theme-card border border-emerald-deep/20 rounded-xl p-3 shadow-xs">
          <div class="text-[10px] font-bold text-charcoal-muted uppercase">Общая сумма</div>
          <div class="text-base font-bold font-mono text-emerald-deep mt-0.5">${(data.total_delivered_sum || 0).toLocaleString()} сум</div>
        </div>
        <div class="theme-card border border-emerald-deep/20 rounded-xl p-3 shadow-xs bg-emerald-500/5">
          <div class="text-[10px] font-bold text-emerald-800 uppercase">💵 Наличные</div>
          <div class="text-base font-bold font-mono text-emerald-800 mt-0.5">${(data.cash_collected || 0).toLocaleString()} сум</div>
        </div>
        <div class="theme-card border border-emerald-deep/20 rounded-xl p-3 shadow-xs bg-blue-500/5">
          <div class="text-[10px] font-bold text-blue-800 uppercase">💳 Click / Payme</div>
          <div class="text-base font-bold font-mono text-blue-800 mt-0.5">${nonCash.toLocaleString()} сум</div>
        </div>
        <div class="theme-card border border-rose-300 rounded-xl p-3 shadow-xs bg-rose-500/5">
          <div class="text-[10px] font-bold text-rose-700 uppercase">⚠️ Долги клиентов</div>
          <div class="text-base font-bold font-mono text-rose-700 mt-0.5">${(data.debts_total || 0).toLocaleString()} сум</div>
        </div>
      </div>

      <!-- Net Cash Submitted Banner -->
      <div class="bg-gradient-to-r from-emerald-900 via-emerald-800 to-emerald-950 text-butter p-4 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase font-bold tracking-wider text-butter/80">Итого наличных к сдаче в главную кассу</div>
          <div class="text-[11px] text-butter/70 mt-0.5">
            Формула: Собрано налом (${(data.cash_collected || 0).toLocaleString()} сум) - ГСМ/Расходы (${(data.expenses_total || 0).toLocaleString()} сум)
          </div>
        </div>
        <div class="text-2xl sm:text-3xl font-mono font-extrabold text-butter tracking-tight">
          ${(data.net_cash_submitted || 0).toLocaleString()} <span class="text-base font-sans font-bold">сум</span>
        </div>
      </div>

      ${debtsHtml}
      ${expensesHtml}
      ${actionBoxHtml}
    `;

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    resultBox.innerHTML = `
      <div class="p-4 bg-rose-50 border border-rose-300 text-rose-800 rounded-xl text-xs space-y-1">
        <div class="font-bold flex items-center gap-1.5">
          <i data-lucide="alert-circle" class="w-4 h-4"></i>
          Ошибка формирования отчета смены
        </div>
        <div>${escapeHtml(err.message)}</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

async function acceptCourierShift() {
  if (!currentCourierShiftData) {
    alert('Сначала рассчитайте смену курьера');
    return;
  }

  const shift = currentCourierShiftData;
  const netCash = shift.net_cash_submitted || 0;
  const notes = document.getElementById('shift-notes-input')?.value || '';

  const confirmMsg = `Подтвердите приём кассы курьера ${shift.courier_name} за ${shift.shift_date_ru || shift.shift_date}:\n\n` +
    `• Доставлено заказов: ${shift.orders_count} шт\n` +
    `• Собрано наличными: ${(shift.cash_collected || 0).toLocaleString()} сум\n` +
    `• Вычтено расходов на ГСМ: -${(shift.expenses_total || 0).toLocaleString()} сум\n` +
    `• К оприходованию в кассу: ${netCash.toLocaleString()} сум\n\n` +
    `Внести сумму в журнал операций и закрыть смену?`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/finance/courier-shift/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courier_name: shift.courier_name,
        date: shift.shift_date,
        net_cash: netCash,
        actor_name: currentUser?.name || 'Администратор',
        notes: notes,
        orders_count: shift.orders_count,
        cash_collected: shift.cash_collected,
        click_collected: shift.click_collected,
        payme_collected: (shift.payme_collected || 0) + (shift.card_collected || 0),
        debts_total: shift.debts_total,
        expenses_total: shift.expenses_total
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      alert(data.message || 'Касса курьера успешно принята!');
      await renderFinance();
      await loadCourierShiftSummary();
      await loadCourierShiftsHistory();
    } else {
      alert(data.error || 'Ошибка при приеме кассы');
    }
  } catch (err) {
    alert('Ошибка при приеме кассы: ' + err.message);
  }
}

function printCourierZReport(customData) {
  const shift = customData || currentCourierShiftData;
  if (!shift) {
    alert('Нет данных для печати Z-отчета');
    return;
  }

  const printContainer = document.getElementById('printable-receipt');
  if (!printContainer) return;

  const now = new Date();
  const nonCash = (shift.click_collected || 0) + (shift.payme_collected || 0) + (shift.card_collected || 0);

  const debtsList = shift.debts_list || [];
  const debtsHtml = debtsList.length > 0 ? `
    <div style="border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; font-size: 9px;">
      <div style="font-weight: bold; margin-bottom: 2px;">РЕЕСТР ДОЛГОВ КЛИЕНТОВ (${debtsList.length}):</div>
      ${debtsList.map(d => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span style="max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(d.client_name)} (${escapeHtml(d.order_id)}):</span>
          <span style="font-weight: bold;">${(d.debt_amount || 0).toLocaleString()} сум</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const expensesList = shift.expenses_list || [];
  const expensesHtml = expensesList.length > 0 ? `
    <div style="border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; font-size: 9px;">
      <div style="font-weight: bold; margin-bottom: 2px;">СЛУЖЕБНЫЕ РАСХОДЫ / ГСМ:</div>
      ${expensesList.map(e => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>${escapeHtml(e.note || 'Аванс/ГСМ')}:</span>
          <span style="font-weight: bold;">-${(Number(e.amount) || 0).toLocaleString()} сум</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  const html = `
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.35; color: #000; width: 76mm; margin: 0 auto;">
      <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
        <div style="font-size: 16px; font-weight: 900; letter-spacing: 1px;">COSMO CRM</div>
        <div style="font-size: 12px; font-weight: 800; margin-top: 2px;">Z-ОТЧЕТ ЗАКРЫТИЯ СМЕНЫ</div>
        <div style="font-size: 9px; margin-top: 2px;">Сдача вечерней выручки экипажа</div>
      </div>

      <div style="font-size: 10px; margin-bottom: 6px;">
        <div><b>Курьер / Экипаж:</b> ${escapeHtml(shift.courier_name)}</div>
        <div><b>Дата смены:</b> ${shift.shift_date_ru || shift.shift_date}</div>
        <div><b>Печать отчета:</b> ${now.toLocaleDateString('ru-RU')} ${now.toLocaleTimeString('ru-RU')}</div>
      </div>

      <div style="border-top: 1px dashed #000; padding-top: 4px; margin-bottom: 6px; font-size: 10px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Доставлено заказов:</span>
          <b>${shift.orders_count || 0} шт</b>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
          <span>Общий объем заказов:</span>
          <b>${(shift.total_delivered_sum || 0).toLocaleString()} сум</b>
        </div>
      </div>

      <div style="border-top: 1px dashed #000; padding-top: 4px; margin-bottom: 6px; font-size: 10px;">
        <div style="font-weight: bold; margin-bottom: 3px;">СТРУКТУРА ОПЛАТ:</div>
        <div style="display: flex; justify-content: space-between;">
          <span>• Наличные собрано:</span>
          <b>${(shift.cash_collected || 0).toLocaleString()} сум</b>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
          <span>• Click:</span>
          <b>${(shift.click_collected || 0).toLocaleString()} сум</b>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
          <span>• Payme / Карта:</span>
          <b>${((shift.payme_collected || 0) + (shift.card_collected || 0)).toLocaleString()} сум</b>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
          <span>• Недоплаты / Долги:</span>
          <b>${(shift.debts_total || 0).toLocaleString()} сум</b>
        </div>
      </div>

      ${debtsHtml}
      ${expensesHtml}

      <div style="border-top: 1px dashed #000; padding-top: 4px; margin-bottom: 6px; font-size: 10px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Служебные расходы / ГСМ:</span>
          <b>-${(shift.expenses_total || 0).toLocaleString()} сум</b>
        </div>
      </div>

      <div style="border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; margin: 8px 0;">
        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 900;">
          <span>ИТОГО К СДАЧЕ В КАССУ:</span>
          <span>${(shift.net_cash_submitted || 0).toLocaleString()} сум</span>
        </div>
      </div>

      <div style="font-size: 9px; margin-top: 14px; padding-top: 6px; border-top: 1px dashed #000; line-height: 1.8;">
        <div>Сдал курьер: ____________________ (${escapeHtml(shift.courier_name)})</div>
        <div>Принял кассир: _________________ (${escapeHtml(currentUser?.name || 'Администратор')})</div>
      </div>

      <div style="text-align: center; margin-top: 10px; font-size: 8px; color: #555;">
        COSMO CRM Enterprise • Самарканд
      </div>
    </div>
  `;

  printContainer.innerHTML = html;
  printContainer.classList.remove('hidden');
  setTimeout(() => {
    window.print();
    printContainer.classList.add('hidden');
  }, 150);
}

async function loadCourierShiftsHistory() {
  const container = document.getElementById('courier-shifts-history-list');
  if (!container) return;

  try {
    const res = await fetch('/api/finance/courier-shifts');
    const shifts = await res.json();

    if (!Array.isArray(shifts) || shifts.length === 0) {
      container.innerHTML = '<div class="text-xs text-charcoal-muted italic py-3 text-center">Принятых смен в реестре пока нет</div>';
      return;
    }

    container.innerHTML = shifts.map(s => {
      const shiftDateRu = s.shift_date ? s.shift_date.split('-').reverse().join('.') : s.shift_date;
      const acceptedAt = s.accepted_at ? formatDateSafe(s.accepted_at, true) : '';
      const shiftJsonEscaped = JSON.stringify(s).replace(/"/g, '&quot;');
      return `
        <div class="bg-white p-3 rounded-xl border border-emerald-deep/15 shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-emerald-deep">${escapeHtml(s.courier_name)}</span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-deep/10 text-emerald-deep font-semibold">${shiftDateRu}</span>
              <span class="text-[10px] text-charcoal-muted font-medium">${s.orders_count} заказов</span>
            </div>
            <div class="text-[10px] text-charcoal-muted mt-1">
              Принял: <b>${escapeHtml(s.accepted_by || 'Администратор')}</b> • ${acceptedAt}
              ${s.notes ? ` • <span class="italic text-charcoal-muted/90">«${escapeHtml(s.notes)}»</span>` : ''}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <div class="font-mono font-bold text-emerald-deep text-sm">${(s.net_cash_submitted || 0).toLocaleString()} сум</div>
              <div class="text-[10px] text-charcoal-muted">наличными в кассу</div>
            </div>
            <button type="button" onclick='printHistoricalZReport(JSON.parse("${shiftJsonEscaped}"))' class="p-2 bg-emerald-deep/5 hover:bg-emerald-deep/10 text-emerald-deep rounded-lg transition" title="Печать Z-отчета">
              <i data-lucide="printer" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    container.innerHTML = '<div class="text-xs text-rose-700 italic py-2 text-center">Ошибка загрузки истории смен</div>';
  }
}

function printHistoricalZReport(shiftRecord) {
  const shiftData = {
    courier_name: shiftRecord.courier_name,
    shift_date: shiftRecord.shift_date,
    shift_date_ru: shiftRecord.shift_date ? shiftRecord.shift_date.split('-').reverse().join('.') : shiftRecord.shift_date,
    orders_count: shiftRecord.orders_count,
    total_delivered_sum: shiftRecord.total_delivered_sum,
    cash_collected: shiftRecord.cash_collected,
    click_collected: shiftRecord.click_collected,
    payme_collected: shiftRecord.payme_collected,
    card_collected: 0,
    debts_total: shiftRecord.debts_total,
    expenses_total: shiftRecord.expenses_total,
    net_cash_submitted: shiftRecord.net_cash_submitted,
    debts_list: [],
    expenses_list: []
  };
  printCourierZReport(shiftData);
}

// ================= VIEW 7: SERVICES & TARIFFS =================

function renderTariffs() {
  const tbody = document.getElementById('services-table-body');
  if (!tbody) return;

  tbody.innerHTML = allServices.map(s => `
    <tr class="hover:bg-butter-surface/50">
      <td class="py-2.5 px-4 font-mono font-bold text-emerald-deep">${s.id}</td>
      <td class="py-2.5 px-4 font-bold text-emerald-deep">${escapeHtml(s.name)}</td>
      <td class="py-2.5 px-4 text-charcoal-muted">${escapeHtml(s.category)}</td>
      <td class="py-2.5 px-4 font-semibold text-emerald-deep">${s.unit}</td>
      <td class="py-2.5 px-4 font-mono font-bold text-emerald-deep">${(s.price || 0).toLocaleString()} сум</td>
      <td class="py-2.5 px-4 text-right">
        <button onclick="editServicePrice('${s.id}', ${s.price})" class="py-1 px-2.5 text-xs font-bold bg-butter rounded-lg hover:bg-butter-dark text-emerald-deep">
          Изменить цену
        </button>
      </td>
    </tr>
  `).join('');
}

async function editServicePrice(id, currentPrice) {
  const newPriceStr = prompt('Введите новую цену за услугу (сум):', currentPrice);
  if (!newPriceStr) return;
  const newPrice = parseInt(newPriceStr.replace(/\D/g, ''), 10);
  if (isNaN(newPrice)) return;

  const svc = allServices.find(s => s.id === id);
  if (!svc) return;

  try {
    await fetch(`/api/services/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...svc, price: newPrice })
    });
    svc.price = newPrice;
    renderTariffs();
    populateServiceSelects();
  } catch (e) {
    alert('Ошибка сохранения цены');
  }
}

function openNewServiceModal() {
  const name = prompt('Наименование услуги (например: Стирка пледа):');
  if (!name) return;
  const unit = prompt('Единица измерения (м², шт, метр):', 'м²');
  if (!unit) return;
  const priceStr = prompt('Цена за единицу (сум):', '15000');
  if (priceStr === null) return;
  const price = parseInt(priceStr.replace(/\D/g, ''), 10) || 15000;

  fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), unit: unit.trim(), price, category: 'Ковры' })
  }).then(async (res) => {
    if (res.ok) {
      await loadInitialData();
      renderTariffs();
    } else {
      alert('Ошибка добавления услуги');
    }
  }).catch(() => alert('Ошибка добавления услуги'));
}

// ================= VIEW 8: LOGISTICS MAP & LEAFLET =================

function initLogisticsMap() {
  const mapContainer = document.getElementById('logistics-map');
  if (!mapContainer || typeof L === 'undefined') return;

  if (!leafletMap) {
    // Center at Samarkand / Central Plant
    leafletMap = L.map('logistics-map').setView([39.6542, 66.9597], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);
  } else {
    leafletMap.invalidateSize();
  }

  refreshMapMarkers();
}

async function refreshMapMarkers() {
  if (!leafletMap || typeof L === 'undefined') return;

  // Clear old markers
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];

  // Plot central plant
  const plantIcon = L.divIcon({
    className: 'plant-marker',
    html: `<div style="background:#04222B; color:#98D8D0; padding:4px 8px; border-radius:12px; font-weight:bold; font-size:11px; border:2px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,0.3);">🏭 ЦЕХ COSMO CRM</div>`,
    iconSize: [110, 30]
  });
  const plantMarker = L.marker([39.6542, 66.9597], { icon: plantIcon }).addTo(leafletMap)
    .bindPopup('<b>Главный технологический цех COSMO CRM</b><br>Самарканд, ул. Мирзо Улугбека');
  mapMarkers.push(plantMarker);

  // Plot active orders
  activeOrders.forEach(o => {
    const coordInfo = getOrderCoordinatesWithFallback(o);
    const lat = coordInfo.coords[0];
    const lng = coordInfo.coords[1];
    const isExactGps = coordInfo.isExact;

    const isUrgent = Boolean(o.urgent);
    const color = (o.stage === 'ready' || o.stage === 'delivery') ? '#1D8B94' : (['in_shop', 'washing', 'dusting', 'drying'].includes(o.stage) ? '#10606F' : '#4FB8B4');

    const markerIcon = L.divIcon({
      className: 'order-marker',
      html: `<div style="background:${color}; color:#fff; padding:3px 7px; border-radius:10px; font-weight:800; font-size:10px; border:${isExactGps ? '2px solid #98D8D0' : '2px solid #fff'}; box-shadow:${isExactGps ? '0 0 8px rgba(29,139,148,0.7)' : '0 2px 5px rgba(0,0,0,0.3)'}; white-space:nowrap;">${isExactGps ? '🎯' : '📍'} ${o.id} ${isUrgent ? '⚡' : ''}</div>`,
      iconSize: [68, 24]
    });

    const yandexUrl = isExactGps
      ? `https://yandex.com/maps/?rtext=~${lat},${lng}`
      : `https://yandex.com/maps/?rtext=~${encodeURIComponent(o.client_address + ', Самарканд')}`;
    const googleUrl = isExactGps
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.client_address + ', Самарканд')}`;

    const m = L.marker([lat, lng], { icon: markerIcon }).addTo(leafletMap)
      .bindPopup(`
        <div style="font-family:sans-serif; font-size:12px; min-width:210px; line-height:1.4; padding:3px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:4px;">
            <b style="color:#04222B; font-size:13px;">Заказ #${o.id}</b>
            <span style="font-size:10px; font-weight:bold; color:${color};">${escapeHtml(o.stage)}</span>
          </div>
          <b>Клиент:</b> ${escapeHtml(o.client_name)}<br>
          <b>Адрес:</b> ${escapeHtml(o.client_address)} (${escapeHtml(o.district || 'Самарканд')})<br>
          <b>Сумма:</b> ${(o.total_price || 0).toLocaleString()} сум (${o.paid ? 'Оплачен' : 'Не оплачен'})<br>
          
          ${o.notes ? `<div style="background:#FFFBEB; border:1px solid #FCD34D; color:#92400E; padding:3px 5px; border-radius:6px; font-size:11px; margin:4px 0;">💬 <b>Диспетчер:</b> ${escapeHtml(o.notes)}</div>` : ''}

          <div style="margin:4px 0; font-size:11px;">
            ${isExactGps ? `<span style="color:#1D8B94; font-weight:bold;">🎯 Точные GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>` : '<span style="color:#92400E;">📍 Приблизительный район</span>'}
          </div>

          <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
            <button type="button" onclick="callClient('${o.id}', '${escapeHtml(o.client_phone)}', '${escapeHtml(o.client_name)}')" style="background:#04222B; color:#98D8D0; border:none; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:bold; cursor:pointer;">📞 Позвонить (${escapeHtml(o.client_phone)})</button>
            <div style="display:flex; gap:4px;">
              <button type="button" onclick="navigateToOrder('${o.id}', 'yandex')" style="flex:1; background:#d97706; color:#fff; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">🧭 Яндекс</button>
              <button type="button" onclick="navigateToOrder('${o.id}', 'google')" style="flex:1; background:#2563eb; color:#fff; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">🗺️ Google</button>
              <button type="button" onclick="openNavigationModal('${o.id}')" style="flex:1; background:#04222B; color:#98D8D0; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">Подробнее</button>
            </div>
            <button type="button" onclick="openLocationModal('${o.id}', false)" style="background:#f3f4f6; color:#374151; border:1px solid #d1d5db; padding:3px 6px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">📍 ${isExactGps ? 'Изменить точку' : '🎯 Зафиксировать точку GPS'}</button>
          </div>
        </div>
      `);
    mapMarkers.push(m);
  });

  // Plot live couriers
  try {
    const locRes = await fetch('/api/gps/locations');
    const locations = await locRes.json();
    locations.forEach(loc => {
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number' || isNaN(loc.lat) || isNaN(loc.lng)) return;
      const courierDisplayName = (loc.courier_name || 'Курьер').trim().split(' ')[0];
      const courierIcon = L.divIcon({
        className: 'courier-marker',
        html: `<div style="background:#04222B; color:#98D8D0; padding:4px 9px; border-radius:12px; font-weight:800; font-size:11px; border:2px solid #98D8D0; box-shadow:0 0 10px rgba(29,139,148,0.8);">🚚 ${escapeHtml(courierDisplayName)}</div>`,
        iconSize: [90, 26]
      });
      const cm = L.marker([loc.lat, loc.lng], { icon: courierIcon }).addTo(leafletMap)
        .bindPopup(`<b>Курьер: ${escapeHtml(loc.courier_name || 'Курьер')}</b><br>Скорость: ${loc.speed || 0} км/ч<br>Батарея: ${loc.battery || 100}%`);
      mapMarkers.push(cm);
    });
  } catch (e) {}
}

let courierLastCoords = null;

function startCourierGpsTracking() {
  if (gpsTrackingInterval) clearInterval(gpsTrackingInterval);

  const sendGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      courierLastCoords = [pos.coords.latitude, pos.coords.longitude];
      fetch('/api/gps/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courier_name: (currentUser && currentUser.name) ? currentUser.name : 'Курьер',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed || 0,
          battery: 95
        })
      }).catch(() => {});
    }, () => {});
  };

  sendGps();
  gpsTrackingInterval = setInterval(sendGps, 20000);
}

function toggleGpsTracking(enabled) {
  const label = document.getElementById('gps-status-label');
  if (enabled) {
    startCourierGpsTracking();
    if (label) {
      label.textContent = 'Активен';
      label.className = 'text-butter font-bold';
    }
  } else {
    if (gpsTrackingInterval) clearInterval(gpsTrackingInterval);
    if (label) {
      label.textContent = 'Отключен';
      label.className = 'text-rose-300 font-bold';
    }
  }
}

// ================= CLIENT GPS LOCATION & CALL TRACKING =================

async function loadCallLogs() {
  try {
    const res = await fetch('/api/calls');
    if (res.ok) {
      allCalls = await res.json();
    }
  } catch (e) {
    console.warn('loadCallLogs error:', e);
  }
}

function getOrderCallCount(orderId, clientPhone) {
  if (!allCalls || allCalls.length === 0) return 0;
  const cleanPhone = clientPhone ? String(clientPhone).replace(/\s+/g, '') : '';
  return allCalls.filter(c => {
    if (orderId && String(c.order_id) === String(orderId)) return true;
    if (cleanPhone && c.client_phone && String(c.client_phone).replace(/\s+/g, '') === cleanPhone) return true;
    return false;
  }).length;
}

async function callClient(orderId, phone, clientName) {
  if (!phone) {
    alert('Номер телефона клиента не указан');
    return;
  }

  const cleanPhone = String(phone).replace(/\s+/g, '');
  const callerName = currentUser?.name || 'Сотрудник';
  const callerRole = currentUser?.role || 'courier';

  // Fix call in background
  try {
    fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId || '',
        client_phone: phone,
        client_name: clientName || '',
        caller_name: callerName,
        caller_role: callerRole
      })
    }).then(async res => {
      if (res.ok) {
        await loadCallLogs();
        if (typeof renderCourierPortalCards === 'function') renderCourierPortalCards();
        if (typeof renderDispatcherPortalOrders === 'function') renderDispatcherPortalOrders();
        if (typeof renderOrdersTable === 'function') renderOrdersTable();
        if (typeof renderClients === 'function') renderClients();
      }
    }).catch(err => console.warn('Call logging error:', err));
  } catch (e) {}

  // Open native dialer
  window.location.href = `tel:${cleanPhone}`;
}

async function openCallHistoryModal(orderId, clientPhone, clientName) {
  const modal = document.getElementById('modal-call-history');
  if (!modal) return;

  const subtitle = document.getElementById('calls-modal-subtitle');
  const clientEl = document.getElementById('calls-modal-client');
  const phoneEl = document.getElementById('calls-modal-phone');
  const totalCountEl = document.getElementById('calls-modal-total-count');
  const callBtn = document.getElementById('calls-modal-call-btn');
  const listContainer = document.getElementById('calls-modal-list');

  if (subtitle) subtitle.textContent = orderId ? `Заказ #${orderId}` : (clientPhone || 'Клиент');
  if (clientEl) clientEl.textContent = clientName || 'Клиент';
  if (phoneEl) phoneEl.textContent = clientPhone || '';

  if (callBtn) {
    callBtn.onclick = () => callClient(orderId, clientPhone, clientName);
  }

  if (listContainer) {
    listContainer.innerHTML = '<div class="py-6 text-center text-charcoal-muted text-xs animate-pulse">Загрузка журнала вызовов...</div>';
  }

  modal.classList.remove('hidden');

  try {
    let url = '/api/calls';
    const params = [];
    if (orderId) params.push(`order_id=${encodeURIComponent(orderId)}`);
    if (clientPhone) params.push(`client_phone=${encodeURIComponent(clientPhone)}`);
    if (params.length > 0) url += '?' + params.join('&');

    const res = await fetch(url);
    const calls = res.ok ? await res.json() : [];

    if (totalCountEl) totalCountEl.textContent = `Всего: ${calls.length}`;

    if (calls.length === 0) {
      listContainer.innerHTML = `
        <div class="py-6 text-center text-charcoal-muted theme-card rounded-2xl border border-emerald-deep/15">
          <p class="font-bold text-xs">Звонков клиенту пока не зафиксировано</p>
          <p class="text-[10px] mt-1 text-charcoal-muted/80">Нажмите «Позвонить сейчас», чтобы набрать номер и зафиксировать звонок в CRM</p>
        </div>
      `;
    } else {
      const roleBadges = {
        'courier': { label: 'Курьер', color: 'bg-amber-100 text-amber-800 border-amber-200' },
        'dispatcher': { label: 'Диспетчер', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
        'admin': { label: 'Руководитель', color: 'bg-purple-100 text-purple-800 border-purple-200' },
        'washer': { label: 'Цех/Мойщик', color: 'bg-blue-100 text-blue-800 border-blue-200' }
      };

      listContainer.innerHTML = calls.map(c => {
        const badge = roleBadges[c.caller_role] || { label: c.caller_role || 'Сотрудник', color: 'bg-gray-100 text-gray-800 border-gray-200' };
        const dateStr = formatDateSafe(c.created_at, true);

        return `
          <div class="p-2.5 rounded-2xl bg-white border border-emerald-deep/15 shadow-xs flex items-center justify-between gap-2">
            <div>
              <div class="flex items-center gap-1.5">
                <span class="font-bold text-emerald-deep text-xs">${escapeHtml(c.caller_name || 'Сотрудник')}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.color}">${badge.label}</span>
              </div>
              <div class="text-[10px] text-charcoal-muted mt-0.5">Звонок на <span class="font-mono font-semibold">${escapeHtml(c.client_phone)}</span></div>
            </div>
            <div class="text-right">
              <span class="font-mono text-[10px] text-charcoal-muted font-bold">${dateStr}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    if (listContainer) listContainer.innerHTML = `<div class="text-xs text-rose-600 text-center py-4 font-bold">Ошибка загрузки журнала вызовов</div>`;
  }

  if (window.lucide) lucide.createIcons();
}

function initLocationPickerMap(lat, lng) {
  const mapDiv = document.getElementById('location-picker-map');
  if (!mapDiv || typeof L === 'undefined') return;

  if (!locationPickerMap) {
    locationPickerMap = L.map('location-picker-map').setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(locationPickerMap);

    locationPickerMap.on('click', (e) => {
      const { lat: clickLat, lng: clickLng } = e.latlng;
      setLocationPickerMarker(clickLat, clickLng);
      performReverseGeocode(clickLat, clickLng);
    });
  } else {
    locationPickerMap.setView([lat, lng], 15);
    setTimeout(() => {
      if (locationPickerMap) locationPickerMap.invalidateSize();
    }, 100);
  }

  setLocationPickerMarker(lat, lng);
}

function setLocationPickerMarker(lat, lng) {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum)) return;

  const customIcon = L.divIcon({
    className: 'location-picker-pin',
    html: `<div style="background-color: #04222B; color: #98D8D0; border: 2px solid white; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.4); cursor: grab;">📍</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  if (!locationPickerMarker) {
    locationPickerMarker = L.marker([latNum, lngNum], { icon: customIcon, draggable: true }).addTo(locationPickerMap);
    locationPickerMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      updateLocationInputs(pos.lat, pos.lng);
      performReverseGeocode(pos.lat, pos.lng);
    });
  } else {
    locationPickerMarker.setLatLng([latNum, lngNum]);
  }

  updateLocationInputs(latNum, lngNum);
}

function updateLocationInputs(lat, lng) {
  const latFixed = Number(lat).toFixed(6);
  const lngFixed = Number(lng).toFixed(6);
  const latInput = document.getElementById('loc-input-lat');
  const lngInput = document.getElementById('loc-input-lng');
  const preview = document.getElementById('loc-coords-preview');
  const yandexBtn = document.getElementById('loc-floating-yandex-btn');

  if (latInput) latInput.value = latFixed;
  if (lngInput) lngInput.value = lngFixed;
  if (preview) preview.textContent = `${latFixed}, ${lngFixed}`;
  if (yandexBtn) yandexBtn.href = `https://yandex.com/maps/?rtext=~${latFixed},${lngFixed}`;
}

function updateLocationMarkerFromInputs() {
  const lat = parseFloat(document.getElementById('loc-input-lat')?.value);
  const lng = parseFloat(document.getElementById('loc-input-lng')?.value);
  if (!isNaN(lat) && !isNaN(lng) && locationPickerMap) {
    locationPickerMap.setView([lat, lng], 16);
    if (locationPickerMarker) locationPickerMarker.setLatLng([lat, lng]);
  }
}

function flyToPreset(coords, districtName) {
  if (!locationPickerMap) return;
  locationPickerMap.flyTo(coords, 16, { animate: true, duration: 0.8 });
  setLocationPickerMarker(coords[0], coords[1]);
  if (districtName) {
    const districtSel = document.getElementById('loc-input-district');
    if (districtSel) districtSel.value = districtName;
  }
  performReverseGeocode(coords[0], coords[1]);
}

async function searchAddressOnMap() {
  const input = document.getElementById('loc-search-input');
  const resultsContainer = document.getElementById('loc-search-results');
  if (!input || !resultsContainer) return;
  const query = input.value.trim();
  if (!query) return;

  resultsContainer.classList.remove('hidden');
  resultsContainer.innerHTML = '<div class="p-2 text-center text-charcoal-muted text-xs animate-pulse">🔍 Поиск адреса в Самарканде...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Самарканд, Узбекистан')}&countrycodes=uz&limit=5&accept-language=ru`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || data.length === 0) {
      resultsContainer.innerHTML = '<div class="p-2 text-center text-charcoal-muted text-xs">Ничего не найдено. Попробуйте другое название улицы.</div>';
      return;
    }

    resultsContainer.innerHTML = data.map(item => `
      <div onclick="selectSearchResult(${parseFloat(item.lat)}, ${parseFloat(item.lon)}, '${escapeHtml(item.display_name).replace(/'/g, "\\'")}')" class="p-2 hover:bg-emerald-deep/5 rounded-lg cursor-pointer text-xs border-b border-emerald-deep/5 last:border-b-0 flex items-start gap-1.5 transition">
        <span class="text-emerald-deep mt-0.5">📍</span>
        <span class="font-medium text-charcoal">${escapeHtml(item.display_name)}</span>
      </div>
    `).join('');
  } catch (err) {
    resultsContainer.innerHTML = '<div class="p-2 text-center text-rose-600 text-xs">Ошибка поиска адреса</div>';
  }
}

function selectSearchResult(lat, lng, displayName) {
  const resultsContainer = document.getElementById('loc-search-results');
  if (resultsContainer) resultsContainer.classList.add('hidden');

  if (locationPickerMap) {
    locationPickerMap.flyTo([lat, lng], 17, { animate: true, duration: 0.8 });
    setLocationPickerMarker(lat, lng);
  }

  const parts = displayName.split(',');
  const cleanStreet = parts[0]?.trim() || displayName;
  const addressInput = document.getElementById('loc-input-address');
  if (addressInput) addressInput.value = cleanStreet;

  detectAndSetDistrict(displayName);
  performReverseGeocode(lat, lng);
}

function detectAndSetDistrict(text) {
  const t = (text || '').toLowerCase();
  const districtSel = document.getElementById('loc-input-district');
  if (!districtSel) return;

  if (t.includes('сиёб') || t.includes('сиаб') || t.includes('регистан')) {
    districtSel.value = 'Сиёб';
  } else if (t.includes('бульвар') || t.includes('университет') || t.includes('центр')) {
    districtSel.value = 'Центр';
  } else if (t.includes('согдиана') || t.includes('гагарина')) {
    districtSel.value = 'Согдиана';
  } else if (t.includes('саттепо')) {
    districtSel.value = 'Саттепо';
  } else if (t.includes('микрорайон') || t.includes('микр')) {
    districtSel.value = 'Микрорайон';
  } else if (t.includes('вокзал') || t.includes('железнодорожн')) {
    districtSel.value = 'Железнодорожный';
  } else if (t.includes('богишамол') || t.includes('багишамал')) {
    districtSel.value = 'Багишамальский';
  }
}

function performReverseGeocode(lat, lng) {
  if (reverseGeocodeTimer) clearTimeout(reverseGeocodeTimer);
  const box = document.getElementById('loc-reverse-geocode-box');
  const textElem = document.getElementById('loc-detected-address-text');
  if (box) box.classList.add('hidden');

  reverseGeocodeTimer = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ru,uz`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data || !data.address) return;

      const addr = data.address;
      const street = addr.road || addr.street || addr.neighbourhood || addr.suburb || addr.quarter || '';
      const house = addr.house_number ? ` ${addr.house_number}` : '';
      const fullDetected = (street + house).trim();

      if (fullDetected && box && textElem) {
        textElem.textContent = fullDetected;
        box.classList.remove('hidden');

        let district = 'Сиёб';
        const rawText = JSON.stringify(addr);
        if (rawText.includes('Центр') || rawText.includes('Бульвар')) district = 'Центр';
        else if (rawText.includes('Согдиана') || rawText.includes('Гагарина')) district = 'Согдиана';
        else if (rawText.includes('Саттепо')) district = 'Саттепо';
        else if (rawText.includes('Микрорайон')) district = 'Микрорайон';
        else if (rawText.includes('Вокзал') || rawText.includes('железнодорожн')) district = 'Железнодорожный';
        else if (rawText.includes('Багишамал') || rawText.includes('богишамол')) district = 'Багишамальский';

        suggestedGeoAddress = { address: fullDetected, district };
      }
    } catch (e) {
      console.warn('Reverse geocode error:', e);
    }
  }, 400);
}

function applyReverseGeocodedAddress() {
  if (!suggestedGeoAddress) return;
  if (suggestedGeoAddress.address) {
    const addressInput = document.getElementById('loc-input-address');
    if (addressInput) addressInput.value = suggestedGeoAddress.address;
  }
  if (suggestedGeoAddress.district) {
    const districtSel = document.getElementById('loc-input-district');
    if (districtSel) districtSel.value = suggestedGeoAddress.district;
  }
  const box = document.getElementById('loc-reverse-geocode-box');
  if (box) box.classList.add('hidden');
}

function copyCurrentCoords() {
  const lat = document.getElementById('loc-input-lat')?.value;
  const lng = document.getElementById('loc-input-lng')?.value;
  if (!lat || !lng) return;
  const str = `${lat},${lng}`;
  navigator.clipboard.writeText(str).then(() => {
    const statusMsg = document.getElementById('loc-status-msg');
    if (statusMsg) {
      statusMsg.className = 'text-xs text-center font-bold text-emerald-700 block';
      statusMsg.textContent = `📋 Координаты скопированы: ${str}`;
      statusMsg.classList.remove('hidden');
      setTimeout(() => statusMsg.classList.add('hidden'), 2500);
    }
  }).catch(() => {
    alert(`Координаты: ${str}`);
  });
}

function detectCurrentGpsLocation() {
  const statusMsg = document.getElementById('loc-status-msg');
  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается вашим браузером');
    return;
  }

  if (statusMsg) {
    statusMsg.className = 'text-xs text-center font-bold text-amber-600 block animate-pulse';
    statusMsg.textContent = '⏳ Определение точных GPS-координат со спутника...';
    statusMsg.classList.remove('hidden');
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 0);

      updateLocationInputs(lat, lng);

      if (locationPickerMap) {
        locationPickerMap.setView([lat, lng], 17);
        setLocationPickerMarker(lat, lng);
      }

      performReverseGeocode(lat, lng);

      if (statusMsg) {
        statusMsg.className = 'text-xs text-center font-bold text-emerald-700 block';
        statusMsg.textContent = `🎯 Точные GPS координаты получены (точность ~${accuracy} м)! Нажмите «✓ Сохранить точку».`;
        statusMsg.classList.remove('hidden');
      }
    },
    (err) => {
      console.warn('Geolocation error:', err);
      if (statusMsg) {
        statusMsg.className = 'text-xs text-center font-bold text-rose-600 block';
        statusMsg.textContent = '⚠️ Не удалось получить GPS автоматически. Разрешите геолокацию в браузере или укажите точку на карте.';
        statusMsg.classList.remove('hidden');
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function openLocationModal(orderId, autoPrompt = false, target = 'direct_card') {
  locationPickerTarget = target;
  currentTargetLocOrderId = orderId;

  let lat = 39.6542;
  let lng = 66.9597;
  let clientName = 'Клиент';
  let clientAddress = '';
  let district = 'Сиёб';
  let landmark = '';

  if (orderId) {
    const order = activeOrders.find(o => String(o.id) === String(orderId));
    if (order) {
      clientName = order.client_name || 'Клиент';
      clientAddress = order.client_address || '';
      district = order.district || 'Сиёб';
      landmark = order.landmark || '';

      const coordInfo = getOrderCoordinatesWithFallback(order);
      lat = coordInfo.coords[0];
      lng = coordInfo.coords[1];
    }
  }

  if (target === 'pickup') {
    const pickupGps = document.getElementById('pickup-modal-gps-value')?.value;
    if (pickupGps && pickupGps.includes(',')) {
      const parts = pickupGps.split(',').map(s => parseFloat(s.trim()));
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
      }
    }
  }

  document.getElementById('loc-modal-order-subtitle').textContent = orderId ? `Заказ #${orderId}` : 'Локация клиента';
  document.getElementById('loc-modal-client-name').textContent = clientName;
  document.getElementById('loc-input-address').value = clientAddress;
  document.getElementById('loc-input-district').value = district;
  document.getElementById('loc-input-landmark').value = landmark;

  updateLocationInputs(lat, lng);

  const statusMsg = document.getElementById('loc-status-msg');
  if (statusMsg) statusMsg.classList.add('hidden');
  const searchResults = document.getElementById('loc-search-results');
  if (searchResults) searchResults.classList.add('hidden');
  const reverseBox = document.getElementById('loc-reverse-geocode-box');
  if (reverseBox) reverseBox.classList.add('hidden');

  document.getElementById('modal-order-location').classList.remove('hidden');

  setTimeout(() => {
    initLocationPickerMap(lat, lng);
    if (autoPrompt) {
      detectCurrentGpsLocation();
    }
  }, 150);
}

function openLocationModalForCurrentOrderForm() {
  locationPickerTarget = 'order_form';
  currentTargetLocOrderId = null;
  const clientName = document.getElementById('order-client-name')?.value || 'Клиент';
  const clientPhone = document.getElementById('order-client-phone')?.value || '';
  const clientAddress = document.getElementById('order-client-address')?.value || 'Самарканд';
  const currentGps = document.getElementById('order-form-gps-location')?.value || '';

  document.getElementById('loc-modal-order-subtitle').textContent = currentEditingOrder ? `Заказ #${currentEditingOrder.id}` : 'Новый заказ';
  document.getElementById('loc-modal-client-name').textContent = clientName;
  const phoneEl = document.getElementById('loc-modal-client-phone');
  if (phoneEl) phoneEl.textContent = clientPhone;
  const addrEl = document.getElementById('loc-modal-client-address');
  if (addrEl) addrEl.textContent = clientAddress;

  let lat = 39.6542;
  let lng = 66.9597;
  if (currentGps && currentGps.includes(',')) {
    const parts = currentGps.split(',').map(s => parseFloat(s.trim()));
    if (!isNaN(parts[0]) && !isNaN(parts[1])) {
      lat = parts[0];
      lng = parts[1];
    }
  }

  updateLocationInputs(lat, lng);

  const statusMsg = document.getElementById('loc-status-msg');
  if (statusMsg) statusMsg.classList.add('hidden');

  document.getElementById('modal-order-location').classList.remove('hidden');
  setTimeout(() => initLocationPickerMap(lat, lng), 150);
}

async function saveClientLocation() {
  const latVal = parseFloat(document.getElementById('loc-input-lat').value);
  const lngVal = parseFloat(document.getElementById('loc-input-lng').value);

  if (isNaN(latVal) || isNaN(lngVal)) {
    alert('Пожалуйста, укажите корректные координаты');
    return;
  }

  const gps_location = `${latVal.toFixed(6)},${lngVal.toFixed(6)}`;
  const address = document.getElementById('loc-input-address')?.value.trim();
  const district = document.getElementById('loc-input-district')?.value.trim();
  const landmark = document.getElementById('loc-input-landmark')?.value.trim();

  // 1. If saving for Courier Pickup Modal
  if (locationPickerTarget === 'pickup') {
    updatePickupModalGpsUi(gps_location);
    if (address) {
      const preview = document.getElementById('pickup-modal-address-preview');
      if (preview) preview.textContent = `Адрес: ${address} (${district || 'Самарканд'})`;
    }
    closeModal('modal-order-location');
    return;
  }

  // 2. If saving for order in modal-order
  if (locationPickerTarget === 'order_form' || !currentTargetLocOrderId) {
    const hiddenGps = document.getElementById('order-form-gps-location');
    const statusText = document.getElementById('order-form-gps-status');
    if (hiddenGps) hiddenGps.value = gps_location;
    if (statusText) statusText.textContent = `✅ Координаты: ${gps_location}`;
    if (address) {
      const orderAddr = document.getElementById('order-client-address');
      if (orderAddr && !orderAddr.value.trim()) orderAddr.value = address;
    }
    if (district) {
      const orderDist = document.getElementById('order-district');
      if (orderDist) orderDist.value = district;
    }
    closeModal('modal-order-location');
    return;
  }

  // 3. Direct card save (Courier or Dispatcher)
  try {
    const actorName = currentUser?.name || 'Курьер';
    const res = await fetch(`/api/orders/${currentTargetLocOrderId}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gps_location,
        client_address: address || undefined,
        district: district || undefined,
        landmark: landmark || undefined,
        actor_name: actorName
      })
    });

    if (res.ok) {
      // Update local state
      const targetOrder = activeOrders.find(o => String(o.id) === String(currentTargetLocOrderId));
      if (targetOrder) {
        targetOrder.gps_location = gps_location;
        if (address) targetOrder.client_address = address;
        if (district) targetOrder.district = district;
        if (landmark) targetOrder.landmark = landmark;
        const targetClient = allClients.find(c => c.phone === targetOrder.client_phone);
        if (targetClient) {
          targetClient.gps_location = gps_location;
          if (address) targetClient.address = address;
          if (district) targetClient.district = district;
        }
      }

      alert(`✅ Точная геолокация клиента для заказа #${currentTargetLocOrderId} сохранена!`);
      closeModal('modal-order-location');

      // Refresh cards
      if (currentTab === 'courier_portal' || currentUser?.role === 'courier') {
        renderCourierPortalCards();
        if (courierPortalMap) initCourierPortalMap();
      }
      if (currentTab === 'dispatcher_portal') renderDispatcherPortalOrders();
      if (currentTab === 'orders') renderOrdersTable();
      if (currentTab === 'map') refreshMapMarkers();
      if (currentTab === 'clients') renderClients();
    } else {
      const errData = await res.json().catch(() => ({}));
      alert('Ошибка при сохранении локации: ' + (errData.error || 'Неизвестная ошибка'));
    }
  } catch (err) {
    alert('Ошибка сети при сохранении локации');
  }
}

// ================= COURIER PICKUP & CHECKLIST WORKFLOW =================

function openPickupModal(orderId) {
  try {
    const order = activeOrders.find(o => String(o.id) === String(orderId));
    if (!order) {
      alert(`Заказ #${orderId} не найден`);
      return;
    }

    activePickupModalOrder = order;

    // Header & Badges
    const badge = document.getElementById('pickup-modal-id-badge');
    if (badge) badge.textContent = `#${order.id}`;

    const nameEl = document.getElementById('pickup-modal-client-name');
    if (nameEl) nameEl.textContent = order.client_name || 'Клиент';

    const phoneEl = document.getElementById('pickup-modal-client-phone');
    if (phoneEl) phoneEl.textContent = order.client_phone || '+998 ...';

    const callBtn = document.getElementById('pickup-modal-call-btn');
    if (callBtn) {
      callBtn.onclick = () => callClient(order.id, order.client_phone, order.client_name);
    }

    const addrEl = document.getElementById('pickup-modal-client-address');
    if (addrEl) {
      addrEl.textContent = `${order.client_address || 'Самарканд'} (${order.district || 'Сиёб'})${order.landmark ? ', ' + order.landmark : ''}`;
    }

    // Prominent Dispatcher Comment
    const notesBox = document.getElementById('pickup-modal-notes-box');
    const notesEl = document.getElementById('pickup-modal-notes');
    if (notesBox && notesEl) {
      if (order.notes && order.notes.trim()) {
        notesEl.textContent = order.notes.trim();
        notesBox.classList.remove('hidden');
      } else {
        notesBox.classList.add('hidden');
      }
    }

    // Form Inputs
    const orderIdInput = document.getElementById('pickup-modal-order-id');
    if (orderIdInput) orderIdInput.value = order.id;

    const condNotesInput = document.getElementById('pickup-modal-condition-notes');
    if (condNotesInput) condNotesInput.value = '';

    const daysSelect = document.getElementById('pickup-modal-delivery-days');
    if (daysSelect) daysSelect.value = '5';

    const pickupPhotosCount = (order.photos && Array.isArray(order.photos)) ? order.photos.length : 0;
    const pickupPhotosBadge = document.getElementById('pickup-modal-photos-count');
    if (pickupPhotosBadge) pickupPhotosBadge.textContent = `${pickupPhotosCount} фото`;

    // GPS Location Status
    let existingGps = order.gps_location || '';
    if (!existingGps) {
      const client = allClients.find(c => c.phone === order.client_phone);
      if (client && client.gps_location) existingGps = client.gps_location;
    }
    updatePickupModalGpsUi(existingGps);

    // Автоматический спутниковый захват GPS курьера при заборе
    if (!existingGps || !existingGps.includes(',')) {
      if (courierLastCoords && Array.isArray(courierLastCoords)) {
        const autoCoords = `${courierLastCoords[0].toFixed(6)},${courierLastCoords[1].toFixed(6)}`;
        updatePickupModalGpsUi(autoCoords);
        const badge = document.getElementById('pickup-gps-badge');
        if (badge) {
          badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
          badge.textContent = '🟢 GPS Курьера (Авто)';
        }
      }
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const accuracy = Math.round(pos.coords.accuracy || 0);
            const coords = `${lat.toFixed(6)},${lng.toFixed(6)}`;
            courierLastCoords = [lat, lng];
            if (activePickupModalOrder && String(activePickupModalOrder.id) === String(order.id)) {
              updatePickupModalGpsUi(coords);
              const badge = document.getElementById('pickup-gps-badge');
              if (badge) {
                badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
                badge.textContent = `🟢 GPS Телефона (~${accuracy}м)`;
              }
            }
          },
          (err) => {
            console.log('Pickup silent geolocation notice:', err?.message || err);
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
        );
      }
    }

    // Dynamic Items
    const itemsContainer = document.getElementById('pickup-modal-items-container');
    if (itemsContainer) {
      itemsContainer.innerHTML = '';
      let parsedCarpets = [];
      if (order.carpets) {
        if (typeof order.carpets === 'string') {
          try {
            parsedCarpets = JSON.parse(order.carpets);
          } catch (e) {
            parsedCarpets = [{ name: order.carpets, count: 1 }];
          }
        } else if (Array.isArray(order.carpets)) {
          parsedCarpets = order.carpets;
        }
      }

      if (Array.isArray(parsedCarpets) && parsedCarpets.length > 0) {
        parsedCarpets.forEach(item => addPickupModalItemRow(item));
      } else {
        addPickupModalItemRow({ name: 'Ковер (Стандарт)', count: 1 });
      }
    }

    // Show Modal
    const modal = document.getElementById('modal-courier-pickup');
    if (modal) modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error in openPickupModal:', err);
    alert('Ошибка открытия окна приёма: ' + err.message);
  }
}

function updatePickupModalGpsUi(gps) {
  const badge = document.getElementById('pickup-gps-badge');
  const display = document.getElementById('pickup-modal-coords-display');
  const preview = document.getElementById('pickup-modal-address-preview');
  const hiddenGps = document.getElementById('pickup-modal-gps-value');

  const hasGps = Boolean(gps && gps.includes(','));
  if (hiddenGps) hiddenGps.value = hasGps ? gps.trim() : '';

  if (hasGps) {
    if (badge) {
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
      badge.textContent = '🟢 Зафиксировано';
    }
    if (display) {
      display.textContent = gps.trim();
      display.className = 'font-mono text-emerald-800 font-bold';
    }
  } else {
    if (badge) {
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300';
      badge.textContent = '🟡 Не зафиксировано';
    }
    if (display) {
      display.textContent = 'Точка не выбрана';
      display.className = 'font-mono text-charcoal-muted';
    }
  }

  if (preview && activePickupModalOrder) {
    preview.textContent = `Адрес: ${activePickupModalOrder.client_address || 'Самарканд'} (${activePickupModalOrder.district || 'Сиёб'})`;
  }
}

function capturePickupPhoneGps() {
  const btn = document.getElementById('btn-pickup-phone-gps');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<span class="animate-pulse">⏳ Определение со спутника...</span>';

  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается вашим браузером');
    if (btn) btn.innerHTML = originalText;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 0);
      const coords = `${lat.toFixed(6)},${lng.toFixed(6)}`;

      updatePickupModalGpsUi(coords);
      const badge = document.getElementById('pickup-gps-badge');
      if (badge) badge.textContent = `🟢 GPS Телефона (~${accuracy}м)`;

      if (btn) btn.innerHTML = originalText;
      alert(`🎯 Точные координаты дома клиента (${coords}) успешно зафиксированы!`);
    },
    (err) => {
      console.warn('Pickup geolocation error:', err);
      if (btn) btn.innerHTML = originalText;
      alert('⚠️ Не удалось определить GPS автоматически. Разрешите доступ к геолокации или нажмите «🗺️ Выбрать на карте».');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function openPickupLocationPicker() {
  if (!activePickupModalOrder) return;
  openLocationModal(activePickupModalOrder.id, false, 'pickup');
}

function addPickupModalItemRow(item = {}) {
  const container = document.getElementById('pickup-modal-items-container');
  if (!container) return;

  const itemTypes = [
    'Ковер (Стандарт)',
    'Ковер (Шерсть / Шёлк)',
    'Плед',
    'Одеяло',
    'Шторы / Тюль',
    'Чехлы / Наматрасник',
    'Спец-чистка'
  ];

  const selectedName = item.name || item.type || 'Ковер (Стандарт)';
  const qty = item.qty || item.count || 1;
  const note = item.note || item.defect || '';

  const row = document.createElement('div');
  row.className = 'pickup-item-row flex items-center gap-2 p-2 bg-white rounded-xl border border-emerald-deep/15 shadow-xs';
  row.innerHTML = `
    <div class="flex-1">
      <select class="item-type-select w-full p-1.5 rounded-lg border border-emerald-deep/15 text-xs font-bold text-emerald-deep bg-white focus:ring-1 focus:ring-emerald-deep">
        ${itemTypes.map(t => `<option value="${t}" ${t === selectedName ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="w-20 flex items-center border border-emerald-deep/15 rounded-lg overflow-hidden bg-white">
      <button type="button" onclick="stepItemQty(this, -1)" class="w-6 py-1 bg-emerald-deep/5 hover:bg-emerald-deep/15 text-emerald-deep font-bold text-xs">-</button>
      <input type="number" min="1" max="99" value="${qty}" class="item-qty-input w-8 text-center text-xs font-bold border-0 p-0 focus:ring-0">
      <button type="button" onclick="stepItemQty(this, 1)" class="w-6 py-1 bg-emerald-deep/5 hover:bg-emerald-deep/15 text-emerald-deep font-bold text-xs">+</button>
    </div>
    <div class="flex-1">
      <input type="text" value="${escapeHtml(note)}" placeholder="Дефекты / пятна..." class="item-note-input w-full p-1.5 rounded-lg border border-emerald-deep/15 text-xs bg-white text-charcoal">
    </div>
    <button type="button" onclick="removePickupModalItemRow(this)" class="p-1.5 text-charcoal-muted hover:text-rose-600 rounded-lg transition" title="Удалить позицию">
      <i data-lucide="trash-2" class="w-4 h-4"></i>
    </button>
  `;

  container.appendChild(row);
  if (window.lucide) lucide.createIcons();
}

function stepItemQty(btn, delta) {
  const row = btn.closest('.pickup-item-row');
  if (!row) return;
  const input = row.querySelector('.item-qty-input');
  if (!input) return;
  let val = parseInt(input.value) || 1;
  val = Math.max(1, val + delta);
  input.value = val;
}

function removePickupModalItemRow(btn) {
  const container = document.getElementById('pickup-modal-items-container');
  const rows = container ? container.querySelectorAll('.pickup-item-row') : [];
  if (rows.length <= 1) {
    alert('Заказ должен содержать хотя бы одну позицию');
    return;
  }
  btn.closest('.pickup-item-row')?.remove();
}

function resolveItemServiceMeta(preset = {}) {
  const rawName = String(preset.name || preset.type || '').trim();
  const lowerName = rawName.toLowerCase();

  // Try exact match in allServices
  let matched = Array.isArray(allServices) ? allServices.find(s => s.name.toLowerCase() === lowerName) : null;
  if (!matched && Array.isArray(allServices)) {
    // Try partial match
    matched = allServices.find(s => lowerName.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(lowerName));
  }

  let unit = preset.unit || (matched ? matched.unit : null);
  let price = Number(preset.price) || (matched ? matched.price : null);

  if (!unit) {
    if (lowerName.includes('одеял') || lowerName.includes('адял') || lowerName.includes('адйял') || lowerName.includes('adyol') || lowerName.includes('kurpa') || lowerName.includes('плед') || lowerName.includes('подуш') || lowerName.includes('yostiq') || lowerName.includes('чехол') || lowerName.includes('наматрасник')) {
      unit = 'шт';
      if (!price) price = 70000;
    } else if (lowerName.includes('штор') || lowerName.includes('тюл') || lowerName.includes('parda') || lowerName.includes('kurpacha') || lowerName.includes('оверлок') || lowerName.includes('overlok')) {
      unit = 'метр';
      if (!price) price = 15000;
    } else {
      unit = 'м²';
      if (!price) price = 14000;
    }
  }

  if (!price) {
    price = unit === 'шт' ? 70000 : (unit === 'метр' ? 15000 : 14000);
  }

  const displayName = rawName || (unit === 'м²' ? 'Ковер' : (unit === 'шт' ? 'Одеяло' : 'Изделие'));

  return { displayName, unit, price, matched };
}

function getPickupModalItems() {
  const rows = document.querySelectorAll('#pickup-modal-items-container .pickup-item-row');
  const items = [];
  rows.forEach(row => {
    const name = row.querySelector('.item-type-select')?.value || 'Ковер (Стандарт)';
    const count = parseInt(row.querySelector('.item-qty-input')?.value, 10) || 1;
    const note = row.querySelector('.item-note-input')?.value.trim() || '';
    const meta = resolveItemServiceMeta({ name });
    items.push({
      name,
      type: meta.unit === 'м²' ? 'carpet' : 'textile',
      count,
      qty: count,
      unit: meta.unit,
      price: meta.price,
      note
    });
  });
  return items;
}

async function submitCourierPickupForm(e) {
  e.preventDefault();
  const orderId = document.getElementById('pickup-modal-order-id')?.value;
  if (!orderId) return;

  let gps_location = document.getElementById('pickup-modal-gps-value')?.value.trim();
  const days = parseInt(document.getElementById('pickup-modal-delivery-days')?.value) || 5;
  const condNotes = document.getElementById('pickup-modal-condition-notes')?.value.trim();
  let items = getPickupModalItems();

  if (!items || items.length === 0) {
    items = [{ name: 'Ковер (Стандарт)', type: 'carpet', count: 1, qty: 1 }];
  }

  // Если GPS ещё не зафиксирован, пробуем мгновенно получить с телефона курьера или последние координаты
  if (!gps_location || !gps_location.includes(',')) {
    if (courierLastCoords && Array.isArray(courierLastCoords)) {
      gps_location = `${courierLastCoords[0].toFixed(6)},${courierLastCoords[1].toFixed(6)}`;
      updatePickupModalGpsUi(gps_location);
    } else if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 2500,
            maximumAge: 10000
          });
        });
        if (pos && pos.coords) {
          gps_location = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
          courierLastCoords = [pos.coords.latitude, pos.coords.longitude];
          updatePickupModalGpsUi(gps_location);
        }
      } catch (e) {
        console.log('Pickup sync geolocation fallback:', e);
      }
    }
  }

  const hasExactGps = Boolean(gps_location && gps_location.includes(','));
  const finalGpsToSave = hasExactGps ? gps_location : undefined;

  const deliveryDateObj = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const delivery_date = deliveryDateObj.toISOString().split('T')[0];

  let combinedNotes = activePickupModalOrder?.notes || '';
  if (condNotes) {
    combinedNotes = combinedNotes ? `${combinedNotes} | Дефекты: ${condNotes}` : `Дефекты: ${condNotes}`;
  }

  const courierName = currentUser?.name || 'Курьер';
  const totalItemsCount = items.reduce((sum, it) => sum + (it.count || 1), 0);

  try {
    const res = await fetch(`/api/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'in_shop',
        actor_name: courierName,
        courier_name: courierName,
        delivery_date,
        notes: combinedNotes,
        carpets: items,
        gps_location: finalGpsToSave
      })
    });

    if (res.ok) {
      // Обновляем локальные данные заказа и клиента
      if (activePickupModalOrder && hasExactGps) {
        activePickupModalOrder.gps_location = gps_location;
        const cl = allClients.find(c => c.phone === activePickupModalOrder.client_phone);
        if (cl) cl.gps_location = gps_location;
      }
      closeModal('modal-courier-pickup');
      const gpsNotice = hasExactGps
        ? `\n🎯 Точные GPS-координаты зафиксированы: ${gps_location} (по ним будет строиться навигация при доставке)`
        : `\n📍 GPS-точка клиента не зафиксирована (маршрут будет строиться по адресу или центру района)`;
      alert(`✅ Заказ #${orderId} принят курьером в цех!\nИзделий: ${totalItemsCount} шт.\nСрок готовности: ${delivery_date}${gpsNotice}`);
      await loadInitialData();
      if (typeof renderCourierPortalCards === 'function') renderCourierPortalCards();
      if (typeof renderDispatcherPortalOrders === 'function') renderDispatcherPortalOrders();
      if (typeof renderOrdersTable === 'function') renderOrdersTable();
      if (typeof renderWasherPortal === 'function') renderWasherPortal();
      if (typeof renderKanban === 'function') renderKanban();
      if (typeof renderDashboard === 'function') renderDashboard();
    } else {
      const errData = await res.json().catch(() => ({}));
      alert('Ошибка приёма заказа: ' + (errData.error || 'Неизвестная ошибка'));
    }
  } catch (err) {
    alert('Ошибка сети при сохранении заказа: ' + (err?.message || ''));
  }
}

// ================= COURIER NAVIGATION & GPS ROUTING ENGINE =================



function buildNavigationUrls(coords, addressText = '') {
  const [lat, lng] = coords;
  // Яндекс Карты & Навигатор: маршрут от текущего местоположения (~) к точным координатам
  const yandexUrl = `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
  // Google Maps: маршрут от текущего местоположения к точным координатам
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  return { yandexUrl, googleUrl };
}

function navigateToOrder(orderId, provider = 'yandex') {
  const order = activeOrders.find(o => String(o.id) === String(orderId));
  if (!order) {
    alert(`Заказ #${orderId} не найден`);
    return;
  }

  const coordInfo = getOrderCoordinatesWithFallback(order);
  const { yandexUrl, googleUrl } = buildNavigationUrls(coordInfo.coords, order.client_address);
  const targetUrl = provider === 'google' ? googleUrl : yandexUrl;

  const appName = provider === 'google' ? 'Google Maps' : 'Яндекс Навигаторе';
  const pointType = coordInfo.isExact ? 'точным GPS-координатам дома' : 'координатам района';

  if (typeof showToast === 'function') {
    showToast(`🧭 Открываем маршрут к ${order.client_name} по ${pointType} в ${appName}...`);
  }

  window.open(targetUrl, '_blank');
}

let activeNavModalOrderId = null;

function openNavigationModal(orderId) {
  const order = activeOrders.find(o => String(o.id) === String(orderId));
  if (!order) {
    alert(`Заказ #${orderId} не найден`);
    return;
  }

  activeNavModalOrderId = orderId;
  const coordInfo = getOrderCoordinatesWithFallback(order);
  const { yandexUrl, googleUrl } = buildNavigationUrls(coordInfo.coords, order.client_address);

  const idBadge = document.getElementById('nav-modal-order-id');
  if (idBadge) idBadge.textContent = `#${order.id}`;

  const stageBadge = document.getElementById('nav-modal-stage-badge');
  if (stageBadge) {
    stageBadge.textContent = getStageLabelRu(order.stage);
    stageBadge.className = `text-[10px] font-bold px-2 py-0.5 rounded-full ${order.stage === 'pickup' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`;
  }

  const nameEl = document.getElementById('nav-modal-client-name');
  if (nameEl) nameEl.textContent = order.client_name || 'Клиент';

  const phoneEl = document.getElementById('nav-modal-client-phone');
  if (phoneEl) phoneEl.textContent = order.client_phone || '+998 ...';

  const callBtn = document.getElementById('nav-modal-call-btn');
  if (callBtn) callBtn.onclick = () => callClient(order.id, order.client_phone, order.client_name);

  const addrEl = document.getElementById('nav-modal-address');
  if (addrEl) {
    addrEl.textContent = `${order.client_address || 'Самарканд'} (${order.district || 'Сиёб'})`;
  }

  const landmarkRow = document.getElementById('nav-modal-landmark-row');
  const landmarkEl = document.getElementById('nav-modal-landmark');
  if (landmarkRow && landmarkEl) {
    if (order.landmark && order.landmark.trim()) {
      landmarkEl.textContent = order.landmark.trim();
      landmarkRow.classList.remove('hidden');
    } else {
      landmarkRow.classList.add('hidden');
    }
  }

  const coordsText = document.getElementById('nav-modal-coords-text');
  if (coordsText) coordsText.textContent = `${coordInfo.coords[0].toFixed(6)}, ${coordInfo.coords[1].toFixed(6)}`;

  const gpsBadge = document.getElementById('nav-modal-gps-badge');
  const gpsBox = document.getElementById('nav-modal-gps-box');
  const gpsDesc = document.getElementById('nav-modal-gps-desc');

  if (coordInfo.isExact) {
    if (gpsBadge) {
      gpsBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
      gpsBadge.textContent = '🟢 Точные координаты (GPS дома)';
    }
    if (gpsBox) {
      gpsBox.className = 'p-3 rounded-2xl border bg-emerald-50/70 border-emerald-300 text-xs space-y-1.5';
    }
    if (gpsDesc) {
      gpsDesc.textContent = '🎯 Маршрут строится от вашей текущей позиции прямо к точной точке дома клиента (зафиксированной курьером со спутника).';
    }
  } else {
    if (gpsBadge) {
      gpsBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300';
      gpsBadge.textContent = '🟡 Центр района';
    }
    if (gpsBox) {
      gpsBox.className = 'p-3 rounded-2xl border bg-amber-50/70 border-amber-300 text-xs space-y-1.5';
    }
    if (gpsDesc) {
      gpsDesc.textContent = '⚠️ Точная точка дома ещё не зафиксирована. Нажмите кнопку ниже или укажите точку при заборе ковра.';
    }
  }

  // Set URLs
  const yandexBtn = document.getElementById('nav-modal-yandex-btn');
  if (yandexBtn) {
    yandexBtn.href = yandexUrl;
    yandexBtn.onclick = () => {
      closeModal('modal-order-navigation');
      return true;
    };
  }

  const googleBtn = document.getElementById('nav-modal-google-btn');
  if (googleBtn) {
    googleBtn.href = googleUrl;
    googleBtn.onclick = () => {
      closeModal('modal-order-navigation');
      return true;
    };
  }

  // Quick edit pin button
  const editPinBtn = document.getElementById('nav-modal-edit-pin-btn');
  if (editPinBtn) {
    editPinBtn.onclick = () => {
      closeModal('modal-order-navigation');
      openLocationModal(order.id, false);
    };
  }

  // Quick phone GPS capture right from navigation modal
  const gpsPhoneBtn = document.getElementById('nav-modal-gps-phone-btn');
  if (gpsPhoneBtn) {
    gpsPhoneBtn.onclick = () => captureCurrentGpsForOrder(order.id);
  }

  const modal = document.getElementById('modal-order-navigation');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

async function captureCurrentGpsForOrder(orderId) {
  const order = activeOrders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается вашим браузером');
    return;
  }

  if (typeof showToast === 'function') {
    showToast('⏳ Определение спутниковых координат...');
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const coords = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      courierLastCoords = [lat, lng];

      try {
        const actorName = currentUser?.name || 'Курьер';
        const res = await fetch(`/api/orders/${orderId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gps_location: coords,
            actor_name: actorName
          })
        });

        if (res.ok) {
          order.gps_location = coords;
          const client = allClients.find(c => c.phone === order.client_phone);
          if (client) client.gps_location = coords;

          alert(`🎯 Точные GPS-координаты (${coords}) успешно зафиксированы для заказа #${orderId}!`);
          openNavigationModal(orderId);
          renderCourierPortalCards();
          if (typeof renderOrdersTable === 'function') renderOrdersTable();
        } else {
          alert('Не удалось сохранить GPS на сервере');
        }
      } catch (err) {
        alert('Ошибка связи с сервером при сохранении GPS: ' + err.message);
      }
    },
    (err) => {
      alert('⚠️ Не удалось определить координаты. Проверьте разрешение на геолокацию на телефоне.');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function copyNavModalCoords() {
  const text = document.getElementById('nav-modal-coords-text')?.textContent?.trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    if (typeof showToast === 'function') {
      showToast('📋 Координаты скопированы в буфер обмена: ' + text);
    } else {
      alert('Координаты скопированы: ' + text);
    }
  }).catch(() => {
    alert('Координаты: ' + text);
  });
}

// Explicit window bindings
window.openPickupModal = openPickupModal;
window.capturePickupPhoneGps = capturePickupPhoneGps;
window.openPickupLocationPicker = openPickupLocationPicker;
window.addPickupModalItemRow = addPickupModalItemRow;
window.removePickupModalItemRow = removePickupModalItemRow;
window.stepItemQty = stepItemQty;
window.getPickupModalItems = getPickupModalItems;
window.submitCourierPickupForm = submitCourierPickupForm;
window.advanceCourierPickup = advanceCourierPickup;
window.openNavigationModal = openNavigationModal;
window.navigateToOrder = navigateToOrder;
window.captureCurrentGpsForOrder = captureCurrentGpsForOrder;
window.copyNavModalCoords = copyNavModalCoords;

// ================= VIEW 9: INTEGRATIONS (SMS, TELEGRAM & TURSO DB) =================

async function checkDbStatus(showAlert = false) {
  const badge = document.getElementById('turso-status-badge');
  const modeEl = document.getElementById('turso-db-mode');
  const locEl = document.getElementById('turso-db-location');
  const syncEl = document.getElementById('turso-sync-state');

  try {
    const res = await fetch('/api/db/status');
    const data = await res.json();

    if (data.isTurso) {
      if (badge) {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1.5';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-600"></span> Turso Cloud LibSQL (Активно)';
      }
      if (modeEl) modeEl.textContent = 'Turso Cloud (libsql://)';
      if (syncEl) syncEl.textContent = '100% постоянное облачное хранение';
    } else {
      if (badge) {
        badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-900 border border-blue-300 flex items-center gap-1.5';
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-600"></span> Локальный SQLite (${data.mode})`;
      }
      if (modeEl) modeEl.textContent = data.mode === 'vercel_tmp_sqlite' ? 'Vercel /tmp (временный)' : 'Локальный файл SQLite';
      if (syncEl) syncEl.textContent = data.isVercel ? 'Рекомендуется настроить Turso' : 'Локальный сервер';
    }

    if (locEl) locEl.textContent = data.location || 'barokot.db';

    if (showAlert) {
      alert(`Статус базы данных:\n• Режим: ${data.mode}\n• Turso Cloud: ${data.isTurso ? 'ДА (Активно)' : 'НЕТ (Локальный)'}\n• Vercel окружение: ${data.isVercel ? 'ДА' : 'НЕТ'}\n• Источник: ${data.location}`);
    }
  } catch (err) {
    if (badge) {
      badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1.5';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-rose-600"></span> Ошибка связи с API';
    }
  }
}

async function loadIntegrationSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    const tgToken = document.getElementById('tg-bot-token');
    const tgChat = document.getElementById('tg-chat-id');
    const eskizEmail = document.getElementById('eskiz-email');
    const eskizPassword = document.getElementById('eskiz-password');
    const eskizToken = document.getElementById('eskiz-token');
    const eskizFrom = document.getElementById('eskiz-from');
    const sheetsUrlEl = document.getElementById('sheets-webhook-url');
    const statusBadge = document.getElementById('eskiz-connection-status-badge');

    if (tgToken && settings.tg_bot_token) tgToken.value = settings.tg_bot_token;
    if (tgChat && settings.tg_chat_id) tgChat.value = settings.tg_chat_id;
    if (eskizEmail && settings.eskiz_email) eskizEmail.value = settings.eskiz_email;
    if (eskizPassword && settings.eskiz_password) eskizPassword.value = settings.eskiz_password;
    if (eskizToken && settings.eskiz_token) eskizToken.value = settings.eskiz_token;
    if (eskizFrom && settings.eskiz_from) eskizFrom.value = settings.eskiz_from;

    if (statusBadge) {
      if (settings.eskiz_token) {
        statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shadow-2xs';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span><span>Подключен (Онлайн)</span>';
      } else if (settings.eskiz_email && settings.eskiz_password) {
        statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5 shadow-2xs';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-spin"></span><span>Авторизация...</span>';
        // Auto-login in background
        fetch('/api/sms/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: settings.eskiz_email, password: settings.eskiz_password })
        }).then(r => r.json()).then(d => {
          if (d.success && d.token) {
            statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shadow-2xs';
            statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span><span>Подключен (Онлайн)</span>';
            const tokInp = document.getElementById('eskiz-token');
            if (tokInp) tokInp.value = d.token;
            refreshSmsBalance(false);
          }
        }).catch(() => {});
      } else {
        statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-300 flex items-center gap-1.5';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span><span>Не подключен</span>';
      }
      return;
    }
    if (false) {
      if (settings.eskiz_token) {
        statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shadow-2xs';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span><span>Подключен (Онлайн)</span>';
      } else {
        statusBadge.className = 'text-[10px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-300 flex items-center gap-1.5';
        statusBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span><span>Не подключен</span>';
      }
    }

    if (sheetsUrlEl) {
      if (settings.google_sheets_webhook_url) {
        sheetsUrlEl.value = settings.google_sheets_webhook_url;
        updateSheetsBadge(true);
      } else {
        sheetsUrlEl.value = '';
        updateSheetsBadge(false);
      }
    }

    // Load SMS triggers
    try {
      const trigRes = await fetch('/api/sms/triggers');
      if (trigRes.ok) {
        const trigs = await trigRes.json();
        const elC = document.getElementById('sms-trigger-created');
        const elM = document.getElementById('sms-trigger-measured');
        const elR = document.getElementById('sms-trigger-ready');
        const elD = document.getElementById('sms-trigger-delivered');
        if (elC) elC.checked = Boolean(trigs.created ?? trigs.trigger_created ?? true);
        if (elM) elM.checked = Boolean(trigs.measured ?? trigs.trigger_measured ?? true);
        if (elR) elR.checked = Boolean(trigs.ready ?? trigs.trigger_ready ?? true);
        if (elD) elD.checked = Boolean(trigs.delivered ?? trigs.trigger_delivered ?? true);
      }
    } catch (te) {}

    // Load SMS audit log
    await loadSmsAuditLogs();
  } catch (err) {
    console.warn('Error loading integration settings:', err);
  }
}

async function loadSmsAuditLogs() {
  const container = document.getElementById('sms-audit-logs-container');
  if (!container) return;

  try {
    const res = await fetch('/api/sms/logs');
    const logs = res.ok ? await res.json() : [];

    if (!Array.isArray(logs) || logs.length === 0) {
      container.innerHTML = '<div class="text-charcoal-muted text-xs py-3 text-center bg-gray-50 dark:bg-black/20 rounded-xl border border-dashed border-emerald-deep/15">Отправок SMS пока не зафиксировано</div>';
      return;
    }

    container.innerHTML = logs.map(l => {
      const dateStr = formatDateSafe(l.created_at, true);
      const isSuccess = l.action.includes('Успешно') || l.action.includes('Отправлено SMS');
      const isSimulated = l.action.includes('Симуляция');
      const isError = l.action.includes('Ошибка') || l.action.includes('fail');

      let badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300';
      let statusIcon = '✅';
      let statusLabel = 'Отправлено';

      if (isSimulated) {
        badgeClass = 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300';
        statusIcon = '⚠️';
        statusLabel = 'Симуляция';
      } else if (isError && !isSuccess) {
        badgeClass = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300';
        statusIcon = '❌';
        statusLabel = 'Ошибка';
      }

      return `
        <div class="p-2 bg-white dark:bg-[#052129] border border-emerald-deep/15 rounded-xl flex items-center justify-between gap-2 shadow-2xs hover:bg-butter/20 transition">
          <div class="flex items-center gap-2 min-w-0 flex-1">
            <span class="text-xs shrink-0">${statusIcon}</span>
            <div class="min-w-0 flex-1">
              <div class="font-bold text-emerald-deep truncate text-xs">${escapeHtml(l.action)}</div>
              <div class="text-[10px] text-charcoal-muted flex items-center gap-2">
                <span>🕒 ${dateStr}</span>
                ${l.order_id ? `<span class="font-mono font-bold text-amber-800">Заказ #${escapeHtml(l.order_id)}</span>` : ''}
              </div>
            </div>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-md border ${badgeClass} shrink-0">${statusLabel}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="text-rose-600 text-xs py-2 text-center">Ошибка загрузки журнала SMS</div>';
  }
}

function updateSheetsBadge(isConnected) {
  const badge = document.getElementById('sheets-status-badge');
  if (!badge) return;
  if (isConnected) {
    badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-600"></span> Подключено (Синхронизация активна)';
  } else {
    badge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1.5';
    badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-400"></span> Не настроено';
  }
}

async function saveGoogleSheetsSettings() {
  const url = document.getElementById('sheets-webhook-url')?.value?.trim();
  if (url && !url.startsWith('https://script.google.com/')) {
    if (!confirm('Внимание: URL скрипта обычно начинается с https://script.google.com/macros/s/...\nПродолжить сохранение?')) {
      return;
    }
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_sheets_webhook_url: url || '' })
    });
    if (res.ok) {
      updateSheetsBadge(Boolean(url));
      showToast('✅ Настройки Google Таблиц успешно сохранены!');
    } else {
      showToast('Ошибка сохранения настроек Google Таблиц', 'error');
    }
  } catch (err) {
    showToast('Сетевая ошибка при сохранении', 'error');
  }
}

async function testGoogleSheetsSync() {
  const url = document.getElementById('sheets-webhook-url')?.value?.trim();
  if (!url) {
    showToast('Сначала вставьте URL веб-приложения Google Apps Script!', 'warning');
    return;
  }

  // Автосохранение введенного URL
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ google_sheets_webhook_url: url })
  });
  updateSheetsBadge(true);

  const btn = document.getElementById('btn-test-sheets');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin inline mr-1"></i> Проверка...';
  }

  try {
    const res = await fetch('/api/integrations/google-sheets/test', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ Тестовый заказ #BRK-TEST успешно добавлен в Google Таблицу!');
    } else {
      showToast('Ошибка связи: ' + (data.error || data.reason || 'Проверьте доступ "Все/Anyone" в Apps Script'), 'error');
    }
  } catch (err) {
    showToast('Ошибка отправки: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="send" class="w-3.5 h-3.5 inline mr-1"></i> Отправить тестовую строку';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}

async function syncAllOrdersToGoogleSheets() {
  const url = document.getElementById('sheets-webhook-url')?.value?.trim();
  if (!url) {
    showToast('Сначала вставьте и сохраните URL Google Таблицы!', 'warning');
    return;
  }

  if (!confirm('Выгрузить все активные заказы из CRM в Google Таблицу? Существующие строки обновятся.')) {
    return;
  }

  const btn = document.getElementById('btn-sync-all-sheets');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin inline mr-1"></i> Выгрузка заказов...';
  }

  try {
    const res = await fetch('/api/integrations/google-sheets/sync-all', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Успешно синхронизировано ${data.count} заказов в Google Таблицу!`);
    } else {
      showToast('Ошибка пакетной синхронизации: ' + (data.error || data.reason || 'Проверьте скрипт'), 'error');
    }
  } catch (err) {
    showToast('Сетевая ошибка при синхронизации: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="upload-cloud" class="w-3.5 h-3.5 inline mr-1"></i> Выгрузить все заказы в Таблицу';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}

async function copyGoogleAppsScriptCode() {
  const code = `function doPost(e) {
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
  return respondJson({ status: 'active', app: 'COSMO CRM Google Sheets Integration', timestamp: new Date().toISOString() });
}

function respondJson(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    const headers = [
      'ID \\u0417\\u0430\\u043a\\u0430\\u0437\\u0430',
      '\\u0414\\u0430\\u0442\\u0430 \\u0441\\u043e\\u0437\\u0434\\u0430\\u043d\\u0438\\u044f',
      '\\u041a\\u043b\\u0438\\u0435\\u043d\\u0442',
      '\\u0422\\u0435\\u043b\\u0435\\u0444\\u043e\\u043d',
      '\\u0410\\u0434\\u0440\\u0435\\u0441',
      '\\u0420\\u0430\\u0439\\u043e\\u043d',
      '\\u0421\\u0442\\u0430\\u0442\\u0443\\u0441 \\u0437\\u0430\\u043a\\u0430\\u0437\\u0430',
      '\\u043c\\u00b2',
      '\\u0421\\u0443\\u043c\\u043c\\u0430 (\\u0441\\u0443\\u043c)',
      '\\u041e\\u043f\\u043b\\u0430\\u0447\\u0435\\u043d\\u043e (\\u0441\\u0443\\u043c)',
      '\\u0421\\u043f\\u043e\\u0441\\u043e\\u0431 \\u043e\\u043f\\u043b\\u0430\\u0442\\u044b',
      '\\u041a\\u0443\\u0440\\u044c\\u0435\\u0440 / \\u042d\\u043a\\u0438\\u043f\\u0430\\u0436',
      '\\u041c\\u0430\\u0441\\u0442\\u0435\\u0440 \\u0446\\u0435\\u0445\\u0430',
      '\\u0414\\u0430\\u0442\\u0430 \\u0434\\u043e\\u0441\\u0442\\u0430\\u0432\\u043a\\u0438',
      '\\u041f\\u0440\\u0438\\u043c\\u0435\\u0447\\u0430\\u043d\\u0438\\u0435 \\u0434\\u0438\\u0441\\u043f\\u0435\\u0442\\u0447\\u0435\\u0440\\u0430'
    ];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#04222B');
    headerRange.setFontColor('#FFFFFF');
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
}`;

  try {
    await navigator.clipboard.writeText(code);
    showToast('📋 Код Apps Script скопирован в буфер обмена! Вставьте его в Google Apps Script.');
  } catch (e) {
    prompt('Скопируйте код скрипта вручную:', code);
  }
}

async function pullOrdersFromGoogleSheets() {
  const btn = document.getElementById('btn-pull-sheets');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin inline mr-1"></i> Загрузка...';
  }

  try {
    const res = await fetch('/api/integrations/google-sheets/pull', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      await loadInitialData();
      showToast(`✅ Заказы успешно синхронизированы из Google Таблицы! Активных: ${data.count}`);
    } else {
      showToast('Ошибка загрузки из таблицы: ' + (data.error || 'Проверьте таблицу'), 'error');
    }
  } catch (err) {
    showToast('Сетевая ошибка при загрузке: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="download-cloud" class="w-3.5 h-3.5 inline mr-1"></i> Загрузить заказы из Таблицы в CRM';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}

window.updateSheetsBadge = updateSheetsBadge;
window.saveGoogleSheetsSettings = saveGoogleSheetsSettings;
window.testGoogleSheetsSync = testGoogleSheetsSync;
window.syncAllOrdersToGoogleSheets = syncAllOrdersToGoogleSheets;
window.pullOrdersFromGoogleSheets = pullOrdersFromGoogleSheets;
window.copyGoogleAppsScriptCode = copyGoogleAppsScriptCode;

async function saveTelegramSettings() {
  const token = document.getElementById('tg-bot-token').value.trim();
  const chatId = document.getElementById('tg-chat-id').value.trim();

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tg_bot_token: token, tg_chat_id: chatId })
  });

  alert('✅ Настройки Telegram-бота успешно сохранены!');
}

async function testTelegramMessage() {
  const token = document.getElementById('tg-bot-token')?.value?.trim();
  const chatId = document.getElementById('tg-chat-id')?.value?.trim();

  if (token && chatId) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tg_bot_token: token, tg_chat_id: chatId })
    });
  }

  try {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('✅ Тестовое уведомление успешно отправлено в Telegram-чат экипажей!');
    } else {
      alert('Ошибка отправки в Telegram: ' + (data.error || 'Проверьте Bot Token и Chat ID'));
    }
  } catch (e) {
    alert('Ошибка сети при отправке в Telegram');
  }
}

async function refreshSmsBalance(showAlert = false) {
  const balanceEl = document.getElementById('sms-live-balance-text');
  if (balanceEl && !balanceEl.textContent.includes('сум')) {
    balanceEl.textContent = 'Проверка...';
  }

  try {
    const res = await fetch('/api/sms/balance');
    const data = await res.json();
    if (res.ok && data.success) {
      const uzs = (data.balance ?? data.balance_uzs ?? 0).toLocaleString();
      const count = data.smsCount ?? data.sms_count ?? 0;
      if (balanceEl) balanceEl.textContent = `${uzs} сум (~${count} SMS)`;
      if (showAlert) alert(`Баланс Eskiz.uz:\n• Доступно: ${uzs} сум\n• Примерно: ${count} SMS`);
    } else {
      if (balanceEl) balanceEl.textContent = data.message || 'Не подключен';
      if (showAlert) alert('Статус Eskiz.uz: ' + (data.message || data.error || 'Ошибка проверки баланса'));
    }
  } catch (err) {
    if (balanceEl) balanceEl.textContent = 'Ошибка связи';
    if (showAlert) alert('Ошибка соединения при проверке баланса SMS');
  }
}

async function autoLoginEskiz() {
  const email = document.getElementById('eskiz-email')?.value?.trim();
  const password = document.getElementById('eskiz-password')?.value?.trim();

  if (!email || !password) {
    if (typeof showToast === 'function') {
      showToast('Пожалуйста, введите Email и Пароль от кабинета Eskiz.uz!', 'warning');
    } else {
      alert('Пожалуйста, введите Email и Пароль от кабинета Eskiz.uz!');
    }
    return;
  }

  const btn = document.getElementById('btn-eskiz-autologin');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<span>⏳</span><span>Авторизация в Eskiz.uz...</span>';

  try {
    const res = await fetch('/api/sms/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.success && data.token) {
      const tokenInput = document.getElementById('eskiz-token');
      if (tokenInput) tokenInput.value = data.token;

      if (typeof showToast === 'function') {
        showToast('✅ Успешная авторизация в Eskiz.uz! Токен сохранен.', 'success');
      } else {
        alert('✅ Успешная авторизация в Eskiz.uz! Токен получен и сохранен.');
      }
      await loadIntegrationSettings();
      await refreshSmsBalance(false);
    } else {
      if (typeof showToast === 'function') {
        showToast('Ошибка входа в Eskiz: ' + (data.error || 'Неверный email или пароль'), 'error');
      } else {
        alert('Ошибка входа в Eskiz: ' + (data.error || 'Неверный email или пароль'));
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') {
      showToast('Сетевая ошибка при авторизации в Eskiz: ' + err.message, 'error');
    } else {
      alert('Сетевая ошибка при авторизации в Eskiz: ' + err.message);
    }
  } finally {
    if (btn) btn.innerHTML = oldText;
  }
}

async function saveSmsSettings() {
  const email = document.getElementById('eskiz-email')?.value?.trim() || '';
  const password = document.getElementById('eskiz-password')?.value?.trim() || '';
  let token = document.getElementById('eskiz-token')?.value?.trim() || '';
  const fromName = document.getElementById('eskiz-from')?.value?.trim() || '4546';

  // Smart Auto-Login: if user entered email & password, ensure token is fetched immediately!
  if (email && password && !token) {
    try {
      const authRes = await fetch('/api/sms/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const authData = await authRes.json();
      if (authRes.ok && authData.token) {
        token = authData.token;
        const tokenInput = document.getElementById('eskiz-token');
        if (tokenInput) tokenInput.value = token;
      }
    } catch (e) {
      console.warn('Auto auth during save:', e);
    }
  }

  const payload = { eskiz_email: email, eskiz_from: fromName };
  if (password) payload.eskiz_password = password;
  if (token) payload.eskiz_token = token;

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  // Save triggers
  const triggers = {
    created: Boolean(document.getElementById('sms-trigger-created')?.checked),
    measured: Boolean(document.getElementById('sms-trigger-measured')?.checked),
    ready: Boolean(document.getElementById('sms-trigger-ready')?.checked),
    delivered: Boolean(document.getElementById('sms-trigger-delivered')?.checked)
  };
  await fetch('/api/sms/triggers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(triggers)
  });

  if (typeof showToast === 'function') {
    showToast('✅ Настройки Eskiz SMS и триггеры успешно сохранены!', 'success');
  } else {
    alert('✅ Настройки Eskiz SMS и триггеры успешно сохранены!');
  }
  await loadIntegrationSettings();
  await refreshSmsBalance(false);
}

async function testCustomSmsMessage() {
  const phone = document.getElementById('sms-test-phone')?.value?.trim();
  const text = document.getElementById('sms-test-text')?.value?.trim();

  if (!phone || phone.length < 9) {
    alert('Введите корректный номер телефона получателя (+998XXXXXXXXX)!');
    return;
  }
  if (!text) {
    alert('Введите текст тестового SMS сообщения!');
    return;
  }

  const btn = document.getElementById('btn-send-test-sms');
  const oldText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="animate-pulse">⏳ Отправка SMS...</span>';
  }

  try {
    const res = await fetch('/api/sms/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: text })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✅ Тестовое SMS успешно отправлено на ${phone} через Eskiz.uz!\nСтатус: ${data.status || 'Отправлено'}`);
      refreshSmsBalance(false);
    } else if (data.simulated) {
      alert(`⚠️ SMS находится в режиме симуляции: ${data.reason || 'токен Eskiz.uz не настроен'}.\nДля реальной отправки введите Email и Пароль от Eskiz.uz выше и нажмите «Войти в Eskiz».`);
    } else {
      alert('Ошибка отправки SMS: ' + (data.error || data.reason || 'Проверьте настройки и баланс Eskiz.uz'));
    }
  } catch (e) {
    alert('Ошибка сети при отправке тестового SMS: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldText;
    }
  }
}

async function testSmsMessage() {
  const email = document.getElementById('eskiz-email')?.value?.trim();
  const token = document.getElementById('eskiz-token')?.value?.trim();
  const fromName = document.getElementById('eskiz-from')?.value?.trim();

  if (email || token || fromName) {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eskiz_email: email, ...(token ? { eskiz_token: token } : {}), eskiz_from: fromName })
    });
  }

  const phone = prompt('Введите номер телефона для отправки тестового SMS (+998XXXXXXXXX):', '+998901234567');
  if (!phone) return;

  try {
    const res = await fetch('/api/sms/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✅ Тестовое SMS успешно отправлено на ${phone} через Eskiz.uz!`);
      refreshSmsBalance(false);
    } else {
      alert(data.error || 'Ошибка отправки SMS. Проверьте Email и Token Eskiz.uz в настройках');
    }
  } catch (e) {
    alert('Ошибка при вызове SMS сервиса');
  }
}

// ================= VIEW 10: TRASH (DELETED ORDERS) =================

async function loadTrashOrders() {
  try {
    const res = await fetch('/api/orders?includeDeleted=true');
    const deletedOrders = await res.json();

    const tbody = document.getElementById('trash-table-body');
    const badge = document.getElementById('trash-count-badge');
    if (badge) badge.textContent = deletedOrders.length;

    if (deletedOrders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-charcoal-muted italic">Корзина пуста</td></tr>`;
      return;
    }

    tbody.innerHTML = deletedOrders.map(o => `
      <tr class="hover:bg-rose-50/60">
        <td class="py-3 px-4 font-mono font-bold text-rose-800">${o.id}</td>
        <td class="py-3 px-4">
          <div class="font-bold text-emerald-deep">${escapeHtml(o.client_name)}</div>
          <div class="text-[11px] text-charcoal-muted font-mono">${escapeHtml(o.client_phone)}</div>
        </td>
        <td class="py-3 px-4 font-mono font-bold text-emerald-deep">${(o.total_price || 0).toLocaleString()} сум</td>
        <td class="py-3 px-4 font-semibold text-rose-800">${escapeHtml(o.deleted_by || 'Пользователь')}</td>
        <td class="py-3 px-4 text-charcoal-muted italic">${escapeHtml(o.delete_reason || 'Без причины')}</td>
        <td class="py-3 px-4 text-charcoal-muted">${o.deleted_at ? formatDateSafe(o.deleted_at, true) : '—'}</td>
        <td class="py-3 px-4 text-right whitespace-nowrap">
          <button onclick="restoreOrderFromTrash('${o.id}')" class="py-1 px-2.5 bg-emerald-deep text-butter font-bold rounded-lg text-xs hover:bg-emerald-hover shadow mr-1">
            Восстановить
          </button>
          <button onclick="permanentlyDeleteOrder('${o.id}')" class="py-1 px-2.5 bg-rose-600 text-white font-bold rounded-lg text-xs hover:bg-rose-700 shadow">
            Удалить навсегда
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading trash:', e);
  }
}

async function restoreOrderFromTrash(orderId) {
  if (!confirm(`Восстановить заказ #${orderId} из корзины в работу?`)) return;

  // Оптимистично убираем строку из таблицы корзины
  const row = Array.from(document.querySelectorAll('#trash-table-body tr')).find(tr => tr.textContent.includes(orderId));
  if (row) row.remove();
  showToast(`♻️ Восстанавливаем заказ #${orderId}...`, 'info');

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/restore`, { method: 'POST' });
    if (res.ok) {
      showToast(`✅ Заказ #${orderId} успешно восстановлен в работу!`, 'success');
      await loadInitialData();
      loadTrashOrders();
    } else {
      showToast('❌ Ошибка при восстановлении заказа на сервере', 'error');
      loadTrashOrders();
    }
  } catch (e) {
    showToast('❌ Ошибка сети при восстановлении заказа', 'error');
    loadTrashOrders();
  }
}

async function permanentlyDeleteOrder(orderId) {
  if (!confirm(`Безвозвратно удалить заказ #${orderId}? Это действие нельзя отменить.`)) return;

  // Оптимистично убираем строку из таблицы корзины
  const row = Array.from(document.querySelectorAll('#trash-table-body tr')).find(tr => tr.textContent.includes(orderId));
  if (row) row.remove();
  showToast(`🗑️ Заказ #${orderId} окончательно удален`, 'info');

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/permanent`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error('Ошибка сервера');
    }
    updateTrashBadge();
  } catch (e) {
    showToast('❌ Ошибка окончательного удаления на сервере', 'error');
    loadTrashOrders();
  }
}

async function clearTrashAll() {
  if (!confirm('Вы действительно хотите полностью очистить корзину удаленных заказов? Все записи будут стерты навсегда!')) return;

  const tbody = document.getElementById('trash-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-charcoal-muted italic">Корзина пуста</td></tr>';
  const badge = document.getElementById('trash-count-badge');
  if (badge) badge.textContent = '0';
  showToast('🗑️ Корзина полностью очищена', 'info');

  try {
    await fetch('/api/orders/trash/clear', { method: 'POST' });
    updateTrashBadge();
  } catch (e) {
    showToast('❌ Ошибка очистки корзины на сервере', 'error');
    loadTrashOrders();
  }
}

async function updateTrashBadge() {
  try {
    const res = await fetch('/api/orders?includeDeleted=true');
    const deleted = await res.json();
    const badge = document.getElementById('trash-count-badge');
    if (badge) badge.textContent = deleted.length;
  } catch (e) {}
}

// ================= VIEW 11: STAFF & BACKUP =================

function renderStaff() {
  const container = document.getElementById('staff-members-list');
  if (!container) return;

  container.innerHTML = allStaff.map(s => {
    const roleColors = {
      admin: 'bg-emerald-100 text-emerald-800',
      dispatcher: 'bg-purple-100 text-purple-800',
      courier: 'bg-blue-100 text-blue-800',
      washer: 'bg-amber-100 text-amber-800'
    };

    return `
      <div class="bg-white p-4 rounded-xl border border-emerald-deep/15 shadow-sm flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-emerald-deep">${escapeHtml(s.name)}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${roleColors[s.role] || 'bg-gray-100'}">${s.role}</span>
          </div>
          <div class="text-[11px] text-charcoal-muted mt-0.5">
            Телефон: <span class="font-mono font-bold">${escapeHtml(s.phone || '—')}</span> • 
            Оклад: <span class="font-mono font-bold">${(s.base_salary || 0).toLocaleString()} сум</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-[10px] text-charcoal-muted">PIN-код:</div>
            <div class="font-mono font-bold text-emerald-deep text-sm tracking-widest">${s.pin ? escapeHtml(s.pin) : '••••'}</div>
          </div>
          <button onclick="deleteStaffMember('${s.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg" title="Удалить">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openNewStaffModal() {
  document.getElementById('modal-staff').classList.remove('hidden');
}

async function handleStaffSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('staff-modal-name').value.trim();
  const role = document.getElementById('staff-modal-role').value;
  const pin = document.getElementById('staff-modal-pin').value.trim();
  const phone = document.getElementById('staff-modal-phone').value.trim();
  const base_salary = document.getElementById('staff-modal-salary').value;

  if (!/^\d{4}$/.test(pin)) {
    alert('PIN-код сотрудника должен состоять ровно из 4 цифр!');
    return;
  }

  try {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, pin, phone, base_salary })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal('modal-staff');
      await loadInitialData();
      alert('Сотрудник успешно добавлен!');
    } else {
      alert(data.error || 'Ошибка добавления сотрудника');
    }
  } catch (err) {
    alert('Ошибка добавления сотрудника');
  }
}

async function deleteStaffMember(id) {
  const staffIndex = allStaff.findIndex(s => String(s.id) === String(id));
  const staffMember = staffIndex !== -1 ? allStaff[staffIndex] : null;
  const staffName = staffMember ? staffMember.name : 'Сотрудник';

  if (!confirm(`Удалить сотрудника «${staffName}» из системы?`)) return;

  // 1. Мгновенное удаление из памяти и интерфейса (0 мс задержки)
  if (staffIndex !== -1) {
    allStaff.splice(staffIndex, 1);
  }
  renderStaff();
  populateStaffSelects();
  showToast(`🗑️ Сотрудник «${staffName}» удален`, 'info');

  // 2. Фоновый запрос на сервер
  try {
    const res = await fetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error('Ошибка сервера');
    }
  } catch (err) {
    console.error('Error deleting staff member:', err);
    // Откат при сбое сети
    if (staffMember && staffIndex !== -1) {
      allStaff.splice(staffIndex, 0, staffMember);
      renderStaff();
      populateStaffSelects();
    }
    showToast(`❌ Не удалось удалить сотрудника на сервере. Запись восстановлена.`, 'error');
  }
}

function handleImportBackup(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      if (!confirm('Восстановить базу данных из этого файла? Существующие записи будут обновлены.')) return;

      const res = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json)
      });
      if (res.ok) {
        alert('✅ База данных успешно восстановлена из бэкапа!');
        window.location.reload();
      }
    } catch (err) {
      alert('Ошибка чтения файла бэкапа.');
    }
  };
  reader.readAsText(file);
}

// ================= ORDER MODAL & CREATION =================

function populateStaffSelects() {
  const courierSelect = document.getElementById('order-courier-name');
  if (courierSelect) {
    const couriers = allStaff.filter(s => s.role === 'courier');
    const admins = allStaff.filter(s => s.role === 'admin');
    let html = '<option value="">-- Не назначен (свободный заказ для всех экипажей) --</option>';
    if (couriers.length > 0) {
      html += couriers.map(s => `<option value="${escapeHtml(s.name)}">🚚 ${escapeHtml(s.name)}</option>`).join('');
    }
    if (admins.length > 0) {
      html += admins.map(s => `<option value="${escapeHtml(s.name)}">👑 ${escapeHtml(s.name)}</option>`).join('');
    }
    courierSelect.innerHTML = html;
  }

  const broadcastSelect = document.getElementById('disp-broadcast-target');
  if (broadcastSelect) {
    broadcastSelect.innerHTML = `
      <option value="all">📢 Всем экипажам и сотрудникам</option>
      ${allStaff.map(s => `<option value="${s.name}">${s.name} (${s.role})</option>`).join('')}
    `;
  }

  const advSelect = document.getElementById('adv-staff-select');
  if (advSelect) {
    advSelect.innerHTML = allStaff.map(s => `
      <option value="${s.id}">${s.name} (${s.role})</option>
    `).join('');
  }

  const shiftCourierSelect = document.getElementById('shift-courier-select');
  if (shiftCourierSelect) {
    const couriers = allStaff.filter(s => s.role === 'courier');
    let html = '';
    if (couriers.length > 0) {
      html += couriers.map(s => `<option value="${escapeHtml(s.name)}">🚚 ${escapeHtml(s.name)}</option>`).join('');
    } else {
      html += '<option value="Дамир">🚚 Дамир</option><option value="Бекзод">🚚 Бекзод</option>';
    }
    shiftCourierSelect.innerHTML = html;
  }
}

function openNewOrderModal() {
  currentEditingOrder = null;
  document.getElementById('modal-order-title').textContent = '📝 Новая заявка на забор ковров';
  document.getElementById('order-form-id').value = '';
  
  const customIdInput = document.getElementById('order-form-custom-id');
  if (customIdInput) customIdInput.value = '';
  const createdDateBox = document.getElementById('order-form-created-date-box');
  if (createdDateBox) createdDateBox.classList.add('hidden');

  document.getElementById('order-client-name').value = '';
  document.getElementById('order-client-phone').value = '+998 ';
  document.getElementById('order-client-address').value = '';
  document.getElementById('order-district').value = 'Сиёб';
  document.getElementById('order-landmark').value = '';
  document.getElementById('order-language').value = 'Русский';
  document.getElementById('order-timeslot').value = 'В любое время';
  document.getElementById('order-urgent-check').checked = false;
  document.getElementById('order-stage-select').value = 'pickup';
  document.getElementById('order-notes').value = '';

  const gpsInput = document.getElementById('order-form-gps-location');
  const gpsStatus = document.getElementById('order-form-gps-status');
  if (gpsInput) gpsInput.value = '';
  if (gpsStatus) gpsStatus.textContent = 'Не указана (будет определена курьером при заборе)';

  const courierSelect = document.getElementById('order-courier-name');
  if (courierSelect) {
    if (currentUser?.role === 'courier') {
      courierSelect.value = currentUser.name;
    } else {
      courierSelect.value = ''; // Свободный заказ: открыт для всех курьеров на смене!
    }
  }

  document.getElementById('btn-print-receipt').classList.add('hidden');
  document.getElementById('btn-qr-receipt').classList.add('hidden');
  document.getElementById('btn-delete-order').classList.add('hidden');
  const btnPhotos = document.getElementById('btn-order-photos');
  if (btnPhotos) btnPhotos.classList.add('hidden');

  // Show add item button and washer measurement notice
  const addBtn = document.getElementById('btn-add-order-item');
  if (addBtn) addBtn.classList.remove('hidden');
  const noticeEl = document.getElementById('order-form-measure-notice');
  if (noticeEl) noticeEl.classList.remove('hidden');

  const container = document.getElementById('order-form-items-container');
  container.innerHTML = '';
  addOrderFormItemRow();

  document.getElementById('modal-order').classList.remove('hidden');
}

function openEditOrderModal(orderId) {
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  currentEditingOrder = order;
  document.getElementById('modal-order-title').textContent = `Заказ #${order.id} (${order.client_name})`;
  document.getElementById('order-form-id').value = order.id;

  const customIdInput = document.getElementById('order-form-custom-id');
  if (customIdInput) customIdInput.value = order.id;
  const createdDateBox = document.getElementById('order-form-created-date-box');
  const createdDateEl = document.getElementById('order-form-created-date');
  if (createdDateBox && createdDateEl) {
    createdDateBox.classList.remove('hidden');
    createdDateEl.textContent = formatDateSafe(order.created_at || Date.now(), true);
  }

  document.getElementById('order-client-name').value = order.client_name;
  document.getElementById('order-client-phone').value = order.client_phone;
  document.getElementById('order-client-address').value = order.client_address;
  document.getElementById('order-district').value = order.district || 'Сиёб';
  document.getElementById('order-landmark').value = order.landmark || '';
  document.getElementById('order-language').value = order.language || 'Русский';
  document.getElementById('order-timeslot').value = order.time_slot || 'В любое время';
  document.getElementById('order-urgent-check').checked = Boolean(order.urgent);
  document.getElementById('order-stage-select').value = normalizeStage(order.stage);
  document.getElementById('order-courier-name').value = cleanCourierName(order.courier_name);
  document.getElementById('order-notes').value = order.notes || '';

  const editGpsInput = document.getElementById('order-form-gps-location');
  const editGpsStatus = document.getElementById('order-form-gps-status');
  if (editGpsInput) editGpsInput.value = order.gps_location || '';
  if (editGpsStatus) {
    editGpsStatus.textContent = order.gps_location 
      ? `✅ Координаты: ${order.gps_location}` 
      : 'Не указана (будет определена курьером при заборе)';
  }

  document.getElementById('btn-print-receipt').classList.remove('hidden');
  document.getElementById('btn-qr-receipt').classList.remove('hidden');
  document.getElementById('btn-delete-order').classList.remove('hidden');

  const orderPhotosCount = (order.photos && Array.isArray(order.photos)) ? order.photos.length : 0;
  const btnPhotos = document.getElementById('btn-order-photos');
  const countEl = document.getElementById('modal-order-photos-count');
  if (btnPhotos) {
    btnPhotos.classList.remove('hidden');
    if (countEl) countEl.textContent = orderPhotosCount;
  }

  const container = document.getElementById('order-form-items-container');
  container.innerHTML = '';
  const addBtn = document.getElementById('btn-add-order-item');
  const noticeEl = document.getElementById('order-form-measure-notice');

  let rawCarpets = [];
  if (order.carpets) {
    try {
      rawCarpets = typeof order.carpets === 'string' ? JSON.parse(order.carpets) : order.carpets;
    } catch (e) {
      rawCarpets = [];
    }
  }

  // Если заказ уже замерян в цеху (площадь > 0 или сумма > 0 или зафиксирован мастером цеха)
  const isOrderMeasured = (
    (Number(order.total_m2) > 0 || Number(order.total_price) > 0 || Boolean(order.washer_name)) &&
    Array.isArray(rawCarpets) &&
    rawCarpets.length > 0 &&
    rawCarpets.some(c => Number(c.length) > 0 || Number(c.width) > 0 || Number(c.total) > 0 || Number(c.area) > 0)
  );
  if (isOrderMeasured) {
    if (addBtn) addBtn.classList.add('hidden');
    if (noticeEl) noticeEl.classList.add('hidden');
    container.innerHTML = `
      <div class="bg-emerald-deep/5 border border-emerald-deep/20 rounded-2xl p-3.5 space-y-2.5">
        <div class="flex items-center justify-between text-xs font-bold text-emerald-deep border-b border-emerald-deep/15 pb-2">
          <span class="flex items-center gap-1.5">
            🔒 Замеры зафиксированы мастером цеха (${escapeHtml(order.washer_name || 'Мастер цеха')})
          </span>
          <span class="font-mono text-xs px-2 py-0.5 rounded-lg bg-emerald-deep text-butter">${order.total_m2} м² • ${(order.total_price || 0).toLocaleString()} сум</span>
        </div>
        <div class="space-y-1.5 text-xs">
          ${rawCarpets.map((c, i) => {
            const unitStr = String(c.unit || 'м²').toLowerCase();
            const isPiece = unitStr === 'шт' || unitStr === 'штук' || unitStr === 'dona';
            const isMeter = unitStr === 'метр' || unitStr === 'м' || unitStr === 'пог.м';
            let specStr = `${c.length}м × ${c.width}м (${c.area || 0} м²)`;
            if (isPiece) specStr = `${c.qty || 1} шт`;
            else if (isMeter) specStr = `${c.length} пог.м`;
            return `
            <div class="flex items-center justify-between bg-white p-2.5 rounded-xl border border-emerald-deep/10 text-xs shadow-xs">
              <div>
                <span class="font-bold text-emerald-deep">${escapeHtml(c.name || `Изделие #${i+1}`)}</span>
                ${c.defects ? `<span class="text-[10px] text-amber-700 italic ml-2">⚠️ ${escapeHtml(c.defects)}</span>` : ''}
              </div>
              <div class="font-mono text-emerald-900 font-semibold">
                ${specStr} — ${(c.total || 0).toLocaleString()} сум
              </div>
            </div>
          `;
          }).join('')}
        </div>
        <div class="pt-2 flex items-center justify-between gap-2">
          <button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5">
            <span>📐 Редактировать замеры изделий (длина × ширина, м²)</span>
          </button>
        </div>
      </div>
    `;
  } else {
    // Заказ еще не замерян в цеху
    if (addBtn) addBtn.classList.remove('hidden');
    if (noticeEl) noticeEl.classList.remove('hidden');
    const items = (Array.isArray(rawCarpets) && rawCarpets.length > 0)
      ? rawCarpets
      : [{ name: 'Gilam Standart', qty: 1 }];
    items.forEach(it => addOrderFormItemRow(it));
  }

  document.getElementById('modal-order').classList.remove('hidden');
}

function addOrderFormItemRow(preset = null) {
  const container = document.getElementById('order-form-items-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'order-item-row flex items-center gap-2 bg-white p-2.5 rounded-xl border border-emerald-deep/15 shadow-xs';

  const defaultSvc = allServices[0] || { name: 'Gilam Standart', unit: 'м²', price: 14000 };
  const currentName = preset ? (preset.name || preset.type) : defaultSvc.name;
  const currentQty = preset ? (preset.qty || preset.count || 1) : 1;

  div.innerHTML = `
    <div class="flex-1">
      <select class="item-name-input w-full p-1.5 text-xs rounded-lg border border-emerald-deep/20 bg-butter-surface font-semibold text-emerald-deep">
        ${allServices.map(s => `<option value="${s.name}" data-price="${s.price}" data-unit="${s.unit}" ${s.name === currentName ? 'selected' : ''}>${s.name}</option>`).join('')}
      </select>
    </div>
    <div class="w-28 flex items-center border border-emerald-deep/20 rounded-lg overflow-hidden bg-butter-surface">
      <span class="text-[10px] text-charcoal-muted px-1.5 font-bold">Кол-во:</span>
      <input type="number" min="1" max="99" value="${currentQty}" class="item-qty-input w-12 p-1 text-xs text-center font-bold text-emerald-deep border-0 bg-transparent focus:ring-0">
      <span class="text-[10px] text-charcoal-muted pr-1">шт</span>
    </div>
    <div class="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/80 whitespace-nowrap hidden sm:block">
      📐 Замер в цеху
    </div>
    <button type="button" onclick="this.closest('.order-item-row').remove()" class="text-rose-600 hover:text-rose-800 p-1 font-bold text-base leading-none" title="Удалить позицию">×</button>
  `;
  container.appendChild(div);
}

function handleItemServiceChange(select) {
  // Unit handled in workshop
}

async function handleOrderFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('order-form-id').value;
  const custom_id_input = document.getElementById('order-form-custom-id');
  const custom_id = custom_id_input ? custom_id_input.value.trim() : '';

  const client_name = document.getElementById('order-client-name').value.trim();
  const client_phone = document.getElementById('order-client-phone').value.trim();
  const client_address = document.getElementById('order-client-address').value.trim();
  const district = document.getElementById('order-district').value;
  const landmark = document.getElementById('order-landmark').value.trim();
  const language = document.getElementById('order-language').value;
  const time_slot = document.getElementById('order-timeslot').value;
  const urgent = document.getElementById('order-urgent-check').checked;
  const stage = normalizeStage(document.getElementById('order-stage-select').value);
  const courier_name = cleanCourierName(document.getElementById('order-courier-name').value);
  const notes = document.getElementById('order-notes').value.trim();

  // Extract items
  let carpets = [];
  let total_m2 = 0;
  let total_price = 0;

  const isOrderAlreadyMeasured = currentEditingOrder && (
    Number(currentEditingOrder.total_m2) > 0 ||
    Number(currentEditingOrder.total_price) > 0 ||
    Boolean(currentEditingOrder.washer_name)
  );

  if (isOrderAlreadyMeasured) {
    // Если заказ уже замерян мастером цеха — сохраняем замеры цеха неприкосновенными
    try {
      carpets = typeof currentEditingOrder.carpets === 'string'
        ? JSON.parse(currentEditingOrder.carpets)
        : (currentEditingOrder.carpets || []);
    } catch (e) {
      carpets = [];
    }
    total_m2 = Number(currentEditingOrder.total_m2) || 0;
    total_price = Number(currentEditingOrder.total_price) || 0;
  } else {
    // Новый заказ или еще не замеренный заказ: вносятся только тип изделия и количество
    const itemRows = document.querySelectorAll('#order-form-items-container .order-item-row');
    itemRows.forEach((row, idx) => {
      const sel = row.querySelector('.item-name-input');
      const opt = sel ? sel.options[sel.selectedIndex] : null;
      const name = sel ? sel.value : `Ковер #${idx + 1}`;
      const qtyInput = row.querySelector('.item-qty-input');
      const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      const price = opt ? parseFloat(opt.getAttribute('data-price')) || 14000 : 14000;
      const unit = opt ? opt.getAttribute('data-unit') || 'м²' : 'м²';

      for (let i = 0; i < qty; i++) {
        carpets.push({
          name: qty > 1 ? `${name} #${i + 1}` : name,
          unit,
          price,
          qty: 1,
          length: 0,
          width: 0,
          area: 0,
          total: 0
        });
      }
    });
    total_m2 = 0;
    total_price = 0;
  }

  const payload = {
    client_name,
    client_phone,
    client_address,
    district,
    landmark,
    language,
    time_slot,
    urgent,
    stage,
    courier_name,
    notes,
    carpets,
    total_m2,
    total_price,
    gps_location: document.getElementById('order-form-gps-location')?.value || (currentEditingOrder?.gps_location || ''),
    dispatcher_name: currentUser ? currentUser.name : 'Диспетчер'
  };

  if (!id && custom_id) {
    payload.custom_id = custom_id;
  } else if (id && custom_id && custom_id !== id) {
    payload.new_id = custom_id;
  }

  try {
    let res;
    if (id) {
      res = await fetch(`/api/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (res.ok) {
      closeModal('modal-order');
      await loadInitialData();
      renderOrdersTable();
      renderKanban();
      renderDashboard();
      renderDispatcherPortal();
      renderCourierPortal();
      renderWasherPortal();
      alert(id ? `Заказ успешно обновлен!` : '✅ Новый заказ успешно создан!');
    } else {
      const err = await res.json();
      alert(err.error || 'Ошибка сохранения заказа');
    }
  } catch (err) {
    alert('Ошибка соединения с сервером');
  }
}

function deleteCurrentOrder() {
  if (!currentEditingOrder) return;
  deleteOrderToTrash(currentEditingOrder.id);
  closeModal('modal-order');
}

async function deleteOrderToTrash(orderId) {
  const reason = prompt(`Укажите причину удаления заказа #${orderId} в корзину:`, 'Отказ клиента / Ошибка ввода');
  if (reason === null) return; // Пользователь нажал «Отмена»

  // 1. Ищем заказ для мгновенного удаления из памяти и возможного отката
  const deletedIndex = activeOrders.findIndex(o => String(o.id) === String(orderId));
  const deletedOrder = deletedIndex !== -1 ? activeOrders[deletedIndex] : null;

  // 2. МГНОВЕННОЕ УДАЛЕНИЕ ИЗ UI (0 мс задержки)
  if (deletedIndex !== -1) {
    activeOrders.splice(deletedIndex, 1);
  }

  // Сразу перерисовываем все связанные представления
  renderDashboard();
  renderOrdersTable();
  renderKanban();
  renderDispatcherPortal();
  renderCourierPortal();
  renderWasherPortal();
  showToast(`🗑️ Заказ #${orderId} перемещен в корзину`, 'info');

  // 3. Фоновый запрос на сервер
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deleted_by: (currentUser && currentUser.name) ? currentUser.name : 'Администратор',
        reason: reason || 'Удален пользователем'
      })
    });

    if (!res.ok) {
      throw new Error('Ошибка сервера');
    }

    updateTrashBadge();
  } catch (err) {
    console.error('Error deleting order:', err);
    // Откат при сбое сети
    if (deletedOrder && deletedIndex !== -1) {
      activeOrders.splice(deletedIndex, 0, deletedOrder);
      renderDashboard();
      renderOrdersTable();
      renderKanban();
      renderDispatcherPortal();
      renderCourierPortal();
      renderWasherPortal();
    }
    showToast(`❌ Не удалось удалить заказ #${orderId} на сервере. Заказ восстановлен.`, 'error');
  }
}

// ================= DISPATCHER PORTAL CONTROLLER =================

function renderDispatcherPortal() {
  const pillsContainer = document.getElementById('disp-status-pills');
  if (!pillsContainer) return;

  const total = activeOrders.length;
  const pickups = activeOrders.filter(o => isPickupStage(o.stage)).length;
  const inShop = activeOrders.filter(o => isShopStage(o.stage)).length;
  const ready = activeOrders.filter(o => isReadyOrDeliveryStage(o.stage)).length;
  const delivered = activeOrders.filter(o => isDeliveredStage(o.stage)).length;
  const urgent = activeOrders.filter(o => o.urgent).length;

  const pills = [
    { id: 'all', label: 'Все заказы', count: total },
    { id: 'pickup', label: '1. К забору', count: pickups },
    { id: 'in_shop', label: '2. В цеху', count: inShop },
    { id: 'ready', label: '3. Готов к доставке', count: ready },
    { id: 'delivered', label: '4. Доставлен', count: delivered },
    { id: 'urgent', label: '⚡ Срочные', count: urgent }
  ];

  pillsContainer.innerHTML = pills.map(p => {
    const isActive = activeDispatcherFilter === p.id;
    const activeCls = isActive ? 'bg-emerald-deep text-butter shadow' : 'bg-white text-emerald-deep border border-emerald-deep/20 hover:bg-butter-surface';
    return `
      <button type="button" onclick="setDispatcherFilter('${p.id}')" class="py-1.5 px-3 rounded-xl font-bold whitespace-nowrap transition flex items-center gap-1.5 ${activeCls}">
        <span>${p.label}</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-butter/30 text-butter' : 'bg-emerald-deep/10 text-emerald-deep'}">${p.count}</span>
      </button>
    `;
  }).join('');

  renderDispatcherPortalOrders();
}

function setDispatcherFilter(filterId) {
  activeDispatcherFilter = filterId;
  renderDispatcherPortal();
  renderMobileBottomNav('dispatcher');
}

async function quickAssignCourier(orderId, courierName) {
  try {
    const res = await fetch(`/api/orders/${orderId}/assign-courier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courier_name: courierName,
        actor_name: currentUser?.name || 'Диспетчер'
      })
    });
    if (res.ok) {
      const ord = activeOrders.find(o => String(o.id) === String(orderId));
      if (ord) ord.courier_name = cleanCourierName(courierName);
      renderDispatcherPortalOrders();
      renderOrdersTable();
      renderKanban();
    } else {
      alert('Ошибка назначения курьера');
    }
  } catch (e) {
    alert('Ошибка сети при назначении курьера');
  }
}

function renderDispatcherPortalOrders() {
  const container = document.getElementById('disp-orders-grid');
  if (!container) return;

  const searchInput = document.getElementById('disp-search-input');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const districtSel = document.getElementById('disp-district-filter');
  const district = districtSel ? districtSel.value : 'all';

  let filtered = activeOrders.filter(o => {
    if (query) {
      const matchId = String(o.id || '').toLowerCase().includes(query);
      const matchName = String(o.client_name || '').toLowerCase().includes(query);
      const matchPhone = String(o.client_phone || '').toLowerCase().includes(query);
      const matchAddress = String(o.client_address || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchPhone && !matchAddress) return false;
    }

    if (district !== 'all') {
      const ordDist = normalizeDistrict(o.district);
      const filtDist = normalizeDistrict(district);
      if (ordDist !== filtDist) return false;
    }

    if (activeDispatcherFilter === 'pickup') return isPickupStage(o.stage);
    if (activeDispatcherFilter === 'in_shop' || activeDispatcherFilter === 'in_wash') return isShopStage(o.stage);
    if (activeDispatcherFilter === 'ready' || activeDispatcherFilter === 'delivery') return isReadyOrDeliveryStage(o.stage);
    if (activeDispatcherFilter === 'delivered') return isDeliveredStage(o.stage);
    if (activeDispatcherFilter === 'urgent') return Boolean(o.urgent);

    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-charcoal-muted theme-card rounded-2xl border border-emerald-deep/15">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto text-charcoal-muted/40 mb-2"></i>
        <p class="font-bold text-sm">Заказов по заданным критериям не найдено</p>
        <p class="text-xs mt-1">Попробуйте изменить поисковый запрос или фильтр статуса</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(order => {
    const carpets = order.carpets ? (typeof order.carpets === 'string' ? JSON.parse(order.carpets) : order.carpets) : [];
    const carpetsCount = carpets.length > 0 ? carpets.length : 1;
    const paidBadge = order.paid
      ? '<span class="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold">● Оплачен</span>'
      : '<span class="text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full text-[10px] font-bold">○ Не оплачен</span>';

    const callsCount = getOrderCallCount(order.id, order.client_phone);
    const hasExactGps = Boolean(order.gps_location && order.gps_location.includes(','));
    const cleanedCourier = cleanCourierName(order.courier_name);

    return `
      <div class="theme-card border border-emerald-deep/20 rounded-2xl p-4 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-3">
        <div>
          <!-- Header: ID + Urgent + Stage -->
          <div class="flex items-center justify-between gap-2 border-b border-emerald-deep/10 pb-2">
            <div class="flex items-center gap-1.5">
              <span class="font-mono font-bold text-xs px-2.5 py-1 rounded-xl bg-emerald-deep text-butter shadow-xs">#${escapeHtml(order.id)}</span>
              ${order.urgent ? '<span class="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">⚡ Срочно (+20%)</span>' : ''}
            </div>
            <div>${getStageBadge(order.stage)}</div>
          </div>

          <!-- Client & Location -->
          <div class="pt-2 space-y-1.5">
            <div class="flex items-center justify-between">
              <h4 class="font-bold text-sm text-emerald-deep">${escapeHtml(order.client_name)}</h4>
              <span class="text-[10px] font-bold px-1.5 py-0.5 bg-butter text-emerald-deep rounded-md border border-emerald-deep/20">${escapeHtml(order.client_tier || 'Standard')}</span>
            </div>

            <!-- Client Phone with 1-Click Call & Call Counter -->
            <div class="flex items-center gap-2 flex-wrap">
              <button type="button" onclick="callClient('${order.id}', '${escapeHtml(order.client_phone)}', '${escapeHtml(order.client_name)}')" class="text-xs font-mono font-bold text-emerald-deep hover:underline flex items-center gap-1 bg-emerald-deep/5 hover:bg-emerald-deep/10 px-2 py-1 rounded-lg transition" title="Нажмите, чтобы позвонить с фиксацией в CRM">
                <i data-lucide="phone-call" class="w-3.5 h-3.5 text-emerald-deep"></i>
                <span>${escapeHtml(order.client_phone)}</span>
              </button>
              <button type="button" onclick="openCallHistoryModal('${order.id}', '${escapeHtml(order.client_phone)}', '${escapeHtml(order.client_name)}')" class="px-2 py-0.5 rounded-lg text-[10px] font-bold ${callsCount > 0 ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-gray-100 text-charcoal-muted'} hover:opacity-80 transition flex items-center gap-1" title="Журнал звонков клиенту">
                <i data-lucide="history" class="w-3 h-3"></i>
                <span>${callsCount > 0 ? `${callsCount} зв.` : '0 зв.'}</span>
              </button>
            </div>

            <!-- Client Address & GPS status -->
            <div class="flex items-center justify-between text-xs text-charcoal-muted gap-1 pt-0.5">
              <div class="flex items-start gap-1 overflow-hidden cursor-pointer hover:text-emerald-deep" onclick="openNavigationModal('${order.id}')" title="Построить маршрут">
                <i data-lucide="map-pin" class="w-3.5 h-3.5 text-emerald-deep shrink-0 mt-0.5"></i>
                <span class="truncate">${escapeHtml(order.client_address)} <b class="text-emerald-deep">(${escapeHtml(order.district || 'Самарканд')})</b></span>
              </div>
              <button type="button" onclick="openNavigationModal('${order.id}')" class="text-[10px] font-bold px-1.5 py-0.5 rounded-lg border shrink-0 ${hasExactGps ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'} hover:opacity-80 transition" title="Построить маршрут к клиенту">
                ${hasExactGps ? '🧭 Маршрут (GPS)' : '📍 Маршрут'}
              </button>
            </div>
            ${order.landmark ? `<div class="text-[11px] text-charcoal-muted/80 pl-4.5">Ориентир: ${escapeHtml(order.landmark)}</div>` : ''}
            <div class="text-[11px] text-charcoal-muted">🕒 Время: <span class="font-semibold text-emerald-deep">${escapeHtml(order.time_slot || 'В любое время')}</span></div>
          </div>

          <!-- Carpets, Amount & Paid + Quick Courier Assign Dropdown -->
          <div class="bg-emerald-deep/5 p-2.5 rounded-xl mt-2 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
            <div>
              <div class="font-bold text-emerald-deep">${carpetsCount} шт • ${(order.total_m2 || 0)} м²</div>
              <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                <span class="text-[11px] font-bold text-charcoal-muted">🚚 Экипаж:</span>
                <select onchange="quickAssignCourier('${order.id}', this.value)" class="text-[11px] font-bold py-1 px-2 rounded-lg border border-emerald-deep/20 bg-white text-emerald-deep focus:ring-1 focus:ring-emerald-deep max-w-[190px] truncate cursor-pointer shadow-2xs">
                  <option value="" ${!cleanedCourier ? 'selected' : ''}>-- Не назначен (свободный) --</option>
                  ${allStaff.filter(s => s.role === 'courier').map(s => {
                    const isSel = cleanedCourier.toLowerCase().includes(s.name.split(' ')[0].toLowerCase()) || s.name.toLowerCase().includes(cleanedCourier.toLowerCase());
                    return `<option value="${escapeHtml(s.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(s.name)}</option>`;
                  }).join('')}
                </select>
              </div>
            </div>
            <div class="text-left sm:text-right">
              <div class="font-mono font-bold text-sm text-emerald-deep">${(order.total_price || 0).toLocaleString()} сум</div>
              <div class="mt-0.5">${paidBadge}</div>
            </div>
          </div>

          <!-- Prominent Dispatcher Comment -->
          ${order.notes ? `
            <div class="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-950 p-2.5 rounded-xl space-y-1 shadow-xs">
              <div class="font-bold text-amber-900 flex items-center gap-1.5">
                <i data-lucide="message-square" class="w-3.5 h-3.5 text-amber-700 shrink-0"></i>
                <span>💬 Комментарий диспетчера (для курьера):</span>
              </div>
              <div class="pl-5 text-charcoal-deep font-semibold text-[11px] leading-relaxed whitespace-pre-wrap">${escapeHtml(order.notes)}</div>
            </div>
          ` : ''}
        </div>

        <!-- Actions Toolbar -->
        <div class="border-t border-emerald-deep/15 pt-2.5 flex items-center justify-between gap-1.5 flex-wrap">
          <div class="flex items-center gap-1.5 flex-wrap">
            <button type="button" onclick="openEditOrderModal('${order.id}')" class="py-1.5 px-2.5 bg-emerald-deep text-butter rounded-xl text-xs font-bold hover:bg-emerald-hover transition flex items-center gap-1 shadow-xs">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
              <span>Редактировать</span>
            </button>
            <button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="py-1.5 px-2 bg-sky-50 border border-sky-300 text-sky-900 hover:bg-sky-100 rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs" title="Внести точные замеры изделий (м²)">
              <span>📐 Замер</span>
            </button>
            ${isPickupStage(order.stage) ? `
              <button type="button" onclick="advanceOrderStage('${order.id}', 1)" class="py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs" title="Перевести на стирку в цех">
                <span>В цех →</span>
              </button>
            ` : ''}
            ${order.stage === 'ready' ? `
              <button type="button" onclick="advanceCourierDelivery('${order.id}')" class="py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-xs" title="Перевести на доставку">
                <span>В авто →</span>
              </button>
            ` : ''}
          </div>
          <div class="flex items-center gap-1">
            <button type="button" onclick="sendOrderToTelegram('${order.id}')" title="Отправить карточку заказа в Telegram экипажам" class="p-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold hover:bg-blue-100 transition">
              <i data-lucide="send" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" onclick="sendQuickSmsToOrder('${order.id}')" title="Отправить SMS клиенту" class="p-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold hover:bg-emerald-100 transition">
              <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" onclick="deleteOrderToTrash('${order.id}')" title="Удалить в корзину" class="p-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function openDispatcherBroadcastModal() {
  populateStaffSelects();
  const textEl = document.getElementById('disp-broadcast-text');
  if (textEl) textEl.value = '';
  const modal = document.getElementById('modal-dispatcher-broadcast');
  if (modal) modal.classList.remove('hidden');
}

async function handleDispatcherBroadcastSubmit(e) {
  e.preventDefault();
  const target = document.getElementById('disp-broadcast-target').value;
  const text = document.getElementById('disp-broadcast-text').value.trim();

  if (!text) {
    alert('Пожалуйста, введите текст сообщения.');
    return;
  }

  try {
    const res = await fetch('/api/telegram/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target,
        text,
        sender: currentUser ? currentUser.name : 'Диспетчер'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('📢 Сообщение успешно отправлено в общую Telegram-группу курьеров!');
      closeModal('modal-dispatcher-broadcast');
    } else {
      alert(data.error || 'Ошибка отправки в Telegram');
    }
  } catch (err) {
    alert('Ошибка соединения с сервером при отправке');
  }
}

async function sendOrderToTelegram(orderId) {
  try {
    const res = await fetch('/api/telegram/notify-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✈️ Заказ #${orderId} успешно отправлен в рабочий Telegram-чат экипажей!`);
    } else {
      alert(data.error || 'Ошибка отправки заказа в Telegram');
    }
  } catch (err) {
    alert('Ошибка отправки заказа в Telegram');
  }
}

async function sendQuickSmsToOrder(orderId) {
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  const defaultMsg = `Уважаемый(ая) ${order.client_name}! Ваш заказ #${order.id} на стирку ковров принят. BAROKOT CLEANING: +998 90 123-45-67`;
  const msg = prompt(`Отправка SMS клиенту (${order.client_phone}):`, defaultMsg);
  if (!msg) return;

  try {
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        phone: order.client_phone,
        message: msg
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`📱 SMS-оповещение успешно отправлено на номер ${order.client_phone}!`);
    } else if (data.simulated) {
      alert(`⚠️ SMS не отправлено клиенту: ${data.reason || 'Токен Eskiz.uz не настроен в Настройках CRM'}.\nЗапись сохранена в журнале истории заказа.`);
    } else {
      alert(data.error || data.reason || 'Ошибка отправки SMS. Проверьте баланс и настройки Eskiz.uz.');
    }
  } catch (err) {
    alert('Ошибка отправки SMS');
  }
}

// ================= COURIER PORTAL CONTROLLER =================

function setCourierScope(scope) {
  activeCourierScope = scope;
  renderCourierOrders();
}

function setCourierPortalSubTab(tab) {
  activeCourierPortalTab = tab;

  ['pickups', 'deliveries', 'done', 'map'].forEach(t => {
    const btn = document.getElementById(`btn-courier-tab-${t}`);
    if (btn) {
      if (t === tab) {
        btn.className = 'py-2.5 px-3.5 min-h-[44px] shrink-0 whitespace-nowrap rounded-xl bg-emerald-deep text-butter shadow-md flex items-center gap-2 text-xs font-bold transition active:scale-[0.98]';
      } else {
        btn.className = 'py-2.5 px-3.5 min-h-[44px] shrink-0 whitespace-nowrap rounded-xl bg-white text-emerald-deep border border-emerald-deep/20 shadow-xs flex items-center gap-2 text-xs font-bold transition hover:bg-butter-surface active:scale-[0.98]';
      }
    }
  });

  const filterBar = document.getElementById('courier-filter-bar');
  const cardsContainer = document.getElementById('courier-orders-container');
  const mapContainer = document.getElementById('courier-map-container');

  if (tab === 'map') {
    if (filterBar) filterBar.classList.add('hidden');
    if (cardsContainer) cardsContainer.classList.add('hidden');
    if (mapContainer) mapContainer.classList.remove('hidden');
    initCourierPortalMap();
  } else {
    if (filterBar) filterBar.classList.remove('hidden');
    if (cardsContainer) cardsContainer.classList.remove('hidden');
    if (mapContainer) mapContainer.classList.add('hidden');
    renderCourierPortalCards();
  }

  renderMobileBottomNav('courier');
  refreshAllIcons();
}

// Вспомогательная функция: принадлежит ли заказ текущему курьеру или доступен для взятия
function isOrderForCourier(order, user) {
  if (!user) return true;
  // Руководитель и диспетчер видят все заказы в терминале курьера
  if (user.role === 'admin' || user.role === 'dispatcher') return true;
  if (user.role !== 'courier') return true;

  // Если включен режим просмотра всех заказов
  if (courierScopeFilter === 'all') return true;

  const rawCourier = cleanCourierName(order.courier_name).toLowerCase();
  // Если у заказа курьер не назначен, пустой или свободен — открыт для любого активного курьера на смене
  if (!rawCourier) {
    return courierScopeFilter !== 'my_only';
  }

  // Если курьер назначен, проверяем совпадение с текущим пользователем
  const myName = String(user.name || '').trim().toLowerCase();
  if (rawCourier === myName) return true;

  // 1. Сравнение по номеру экипажа (например: "Экипаж 1" vs "Экипаж #1", "Курьер 1")
  const crewUser = myName.match(/(?:экипаж|курьер)\s*#?\s*(\d+)/i);
  const crewOrder = rawCourier.match(/(?:экипаж|курьер)\s*#?\s*(\d+)/i);
  if (crewUser && crewOrder) {
    return crewUser[1] === crewOrder[1];
  }

  // 2. Личные имена курьеров (исключая общие слова типа "экипаж", "курьер", "доставщик")
  const ignoredWords = new Set(['экипаж', 'курьер', 'доставщик', 'водитель', 'мастер']);
  const myParts = myName.split(/[\s(/)]+/).filter(p => p.length >= 3 && !ignoredWords.has(p));
  for (const part of myParts) {
    if (rawCourier.includes(part)) return true;
  }
  const orderParts = rawCourier.split(/[\s(/)]+/).filter(p => p.length >= 3 && !ignoredWords.has(p));
  for (const part of orderParts) {
    if (myName.includes(part)) return true;
  }

  // Если курьер ищет только свои
  return false;
}

let courierScopeFilter = 'available'; // 'available' (Мои + Свободные), 'my_only', 'all'
let activeCourierPickupSubTab = 'pending'; // 'pending' (Ожидают забора), 'in_car' (Забрано курьером в авто / цех)

function setCourierScopeFilter(scope) {
  courierScopeFilter = scope;
  ['available', 'my_only', 'all', 'my'].forEach(s => {
    const btn = document.getElementById(`btn-courier-scope-${s}`);
    if (btn) {
      if (s === scope || (s === 'my' && scope === 'available')) {
        btn.className = 'px-2.5 py-1.5 rounded-xl bg-emerald-deep text-butter shadow transition font-bold text-xs';
      } else {
        btn.className = 'px-2.5 py-1.5 rounded-xl text-emerald-deep hover:bg-black/5 transition font-bold text-xs';
      }
    }
  });
  renderCourierPortal();
}

function setCourierPickupSubTab(sub) {
  activeCourierPickupSubTab = sub;
  const btnPending = document.getElementById('btn-courier-sub-pending');
  const btnInCar = document.getElementById('btn-courier-sub-incar');
  if (btnPending && btnInCar) {
    if (sub === 'pending') {
      btnPending.className = 'px-3 py-1.5 rounded-xl bg-emerald-deep text-butter shadow font-bold text-xs flex items-center gap-1.5 transition';
      btnInCar.className = 'px-3 py-1.5 rounded-xl bg-white text-emerald-deep border border-emerald-deep/20 font-bold text-xs flex items-center gap-1.5 transition hover:bg-butter-surface';
    } else {
      btnPending.className = 'px-3 py-1.5 rounded-xl bg-white text-emerald-deep border border-emerald-deep/20 font-bold text-xs flex items-center gap-1.5 transition hover:bg-butter-surface';
      btnInCar.className = 'px-3 py-1.5 rounded-xl bg-emerald-deep text-butter shadow font-bold text-xs flex items-center gap-1.5 transition';
    }
  }
  renderCourierPortalCards();
}

// 1-клик принятие заявки курьером
async function assignOrderToMe(orderId) {
  const courierName = currentUser?.name || 'Курьер';
  try {
    const res = await fetch(`/api/orders/${orderId}/assign-courier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courier_name: courierName,
        actor_name: courierName
      })
    });
    if (res.ok) {
      const ord = activeOrders.find(o => String(o.id) === String(orderId));
      if (ord) ord.courier_name = courierName;
      renderCourierPortal();
      alert(`✅ Заявка #${orderId} успешно принята вами в работу!\nВы назначены на этот заказ. Направляйтесь по адресу клиента для забора ковров.`);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Ошибка принятия заявки');
    }
  } catch (e) {
    alert('Ошибка сети при принятии заявки');
  }
}

function renderCourierPortal() {
  const targetOrders = (courierScopeFilter === 'all')
    ? activeOrders
    : activeOrders.filter(o => isOrderForCourier(o, currentUser));

  const pendingPickups = targetOrders.filter(o => isPickupStage(o.stage));
  const inCarPickups = activeOrders.filter(o => isShopStage(o.stage) && isOrderForCourier(o, currentUser));
  const deliveries = targetOrders.filter(o => isReadyOrDeliveryStage(o.stage));
  const todayIso = toIsoDateSafe(new Date()) || new Date().toISOString().slice(0, 10);
  const done = targetOrders.filter(o => {
    if (!isDeliveredStage(o.stage)) return false;
    const orderDate = toIsoDateSafe(o.delivery_date || o.completed_date || o.created_at);
    return orderDate ? orderDate === todayIso : true;
  });

  const badgePickups = document.getElementById('badge-courier-pickups');
  const badgeDeliveries = document.getElementById('badge-courier-deliveries');
  const badgeDone = document.getElementById('badge-courier-done');
  const badgeSubPending = document.getElementById('badge-courier-sub-pending');
  const badgeSubInCar = document.getElementById('badge-courier-sub-incar');

  if (badgePickups) badgePickups.textContent = pendingPickups.length;
  if (badgeDeliveries) badgeDeliveries.textContent = deliveries.length;
  if (badgeDone) badgeDone.textContent = done.length;
  if (badgeSubPending) badgeSubPending.textContent = pendingPickups.length;
  if (badgeSubInCar) badgeSubInCar.textContent = inCarPickups.length;

  let pocketCash = 0;
  done.forEach(o => {
    if (o.payment_method === 'cash' || (!o.payment_method && o.paid)) {
      pocketCash += (o.paid_amount || o.total_price || 0);
    }
  });
  const cashEl = document.getElementById('courier-pocket-cash');
  if (cashEl) cashEl.textContent = `${pocketCash.toLocaleString()} сум`;

  setCourierPortalSubTab(activeCourierPortalTab);
}

function renderCourierPortalCards() {
  const container = document.getElementById('courier-orders-container');
  if (!container) return;

  const targetOrders = (courierScopeFilter === 'all')
    ? activeOrders
    : activeOrders.filter(o => isOrderForCourier(o, currentUser));

  let targetList = [];
  if (activeCourierPortalTab === 'pickups') {
    if (activeCourierPickupSubTab === 'in_car') {
      targetList = activeOrders.filter(o => isShopStage(o.stage) && isOrderForCourier(o, currentUser));
    } else {
      targetList = targetOrders.filter(o => isPickupStage(o.stage));
    }
  } else if (activeCourierPortalTab === 'deliveries') {
    targetList = targetOrders.filter(o => isReadyOrDeliveryStage(o.stage));
  } else if (activeCourierPortalTab === 'done') {
    const todayIso = toIsoDateSafe(new Date()) || new Date().toISOString().slice(0, 10);
    targetList = targetOrders.filter(o => {
      if (!isDeliveredStage(o.stage)) return false;
      const orderDate = toIsoDateSafe(o.delivery_date || o.completed_date || o.created_at);
      return orderDate ? orderDate === todayIso : true;
    });
  }

  const searchInput = document.getElementById('courier-search-input');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const districtSel = document.getElementById('courier-district-filter');
  const district = districtSel ? districtSel.value : 'all';
  const urgentOnly = document.getElementById('courier-urgent-only')?.checked;

  targetList = targetList.filter(o => {
    if (query) {
      const matchId = String(o.id || '').toLowerCase().includes(query);
      const matchName = String(o.client_name || '').toLowerCase().includes(query);
      const matchPhone = String(o.client_phone || '').toLowerCase().includes(query);
      const matchAddress = String(o.client_address || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchPhone && !matchAddress) return false;
    }
    if (district !== 'all') {
      const ordDist = normalizeDistrict(o.district);
      const filtDist = normalizeDistrict(district);
      if (ordDist !== filtDist) return false;
    }
    if (urgentOnly && !o.urgent) return false;
    return true;
  });

  // Управление отображением подвкладок забора (Ожидают забора / Забрано сегодня)
  const pickupSubTabsEl = document.getElementById('courier-pickup-subtabs');
  if (pickupSubTabsEl) {
    if (activeCourierPortalTab === 'pickups') pickupSubTabsEl.classList.remove('hidden');
    else pickupSubTabsEl.classList.add('hidden');
  }

  if (targetList.length === 0) {
    const emptyMsg = activeCourierPortalTab === 'pickups' && activeCourierPickupSubTab === 'in_car'
      ? 'Вы ещё не забирали ковры сегодня или все они уже замерены цехом'
      : 'Все задачи выполнены или ожидают распределения';
    container.innerHTML = `
      <div class="py-12 text-center text-charcoal-muted theme-card rounded-2xl border border-emerald-deep/15">
        ${getSvgIcon('check-circle-2', 'w-12 h-12 mx-auto text-emerald-deep/40 mb-2')}
        <p class="font-bold text-sm">В этой вкладке нет активных заказов</p>
        <p class="text-xs mt-1">${emptyMsg}</p>
      </div>
    `;
    refreshAllIcons();
    return;
  }

  container.innerHTML = targetList.map(order => {
    const carpets = order.carpets ? (typeof order.carpets === 'string' ? JSON.parse(order.carpets) : order.carpets) : [];
    const carpetsCount = carpets.length > 0 ? carpets.length : 1;
    const coordInfo = getOrderCoordinatesWithFallback(order);
    const hasExactGps = coordInfo.isExact;
    const displayGpsText = hasExactGps 
      ? (order.gps_location || coordInfo.coords.map(n => n.toFixed(6)).join(', '))
      : (coordInfo.coords.map(n => n.toFixed(5)).join(', '));
    const callsCount = getOrderCallCount(order.id, order.client_phone);
    const photosCount = (order.photos && Array.isArray(order.photos)) ? order.photos.length : 0;

    const cleanedCourier = cleanCourierName(order.courier_name);
    const isAssignedToMe = cleanedCourier && isOrderForCourier(order, currentUser);
    const isUnassigned = !cleanedCourier;

    let assignmentBadge = '';
    if (isUnassigned) {
      assignmentBadge = '<span class="bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full">⚡ Свободный заказ (любой экипаж)</span>';
    } else if (isAssignedToMe) {
      assignmentBadge = '<span class="bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full">👤 Назначен вам</span>';
    } else {
      assignmentBadge = `<span class="bg-gray-100 text-charcoal-muted border border-gray-300 text-[10px] font-bold px-2 py-0.5 rounded-full">🚚 ${escapeHtml(cleanedCourier)}</span>`;
    }

    let actionButtonHtml = '';
    if (activeCourierPortalTab === 'pickups') {
      if (activeCourierPickupSubTab === 'in_car') {
        actionButtonHtml = `
          <div class="w-full min-h-[46px] py-2.5 px-3 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs font-bold flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              ${getSvgIcon('package', 'w-4 h-4 text-amber-700')}
              <span>Забрано • Направлено в цех на стирку</span>
            </span>
            <span class="text-[10px] bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-mono">Ожидает замера</span>
          </div>
        `;
      } else if (isUnassigned) {
        actionButtonHtml = `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onclick="assignOrderToMe('${order.id}')" class="w-full min-h-[48px] py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition">
              ${getSvgIcon('check-circle', 'w-4 h-4 text-white')}
              <span>✋ Взять заявку в работу</span>
            </button>
            <button type="button" onclick="openPickupModal('${order.id}')" class="w-full min-h-[48px] py-3 bg-emerald-deep text-butter rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm hover:bg-emerald-hover active:scale-[0.99] transition">
              ${getSvgIcon('package-check', 'w-4 h-4 text-butter')}
              <span>📦 Сразу забрать в цех</span>
            </button>
          </div>
        `;
      } else {
        actionButtonHtml = `
          <div class="space-y-2">
            <div class="w-full py-1.5 px-3 bg-emerald-100/80 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                <span>Заявка у вас в работе</span>
              </span>
              <span class="text-[11px] text-emerald-800 font-semibold">Направляйтесь к клиенту</span>
            </div>
            <button type="button" onclick="openPickupModal('${order.id}')" class="w-full min-h-[48px] py-3 bg-emerald-deep text-butter rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md hover:bg-emerald-hover active:scale-[0.99] transition">
              ${getSvgIcon('package-check', 'w-5 h-5 text-butter')}
              <span>📦 Забрать ковры у клиента (В цех)</span>
            </button>
          </div>
        `;
      }
    } else if (activeCourierPortalTab === 'deliveries') {
      if (order.stage === 'ready') {
        actionButtonHtml = `
          <div class="space-y-2">
            <button type="button" onclick="advanceCourierDelivery('${order.id}')" class="w-full min-h-[48px] py-3 bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md transition">
              ${getSvgIcon('truck', 'w-5 h-5 text-white')}
              <span>🚚 Взять заказ на доставку (В авто)</span>
            </button>
            <button type="button" onclick="openCourierDeliveryModal('${order.id}')" class="w-full min-h-[44px] py-2.5 bg-emerald-deep/10 hover:bg-emerald-deep/20 text-emerald-deep rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
              ${getSvgIcon('dollar-sign', 'w-4 h-4 text-emerald-deep')}
              <span>Сразу вручить клиенту & Принять оплату</span>
            </button>
          </div>
        `;
      } else {
        actionButtonHtml = `
          <div class="space-y-2">
            <div class="w-full min-h-[40px] py-2 bg-blue-50 text-blue-800 border border-blue-200 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2">
              ${getSvgIcon('truck', 'w-4 h-4 text-blue-700 animate-pulse')}
              <span>Заказ в автомобиле (На доставке клиенту)</span>
            </div>
            <button type="button" onclick="openCourierDeliveryModal('${order.id}')" class="w-full min-h-[48px] py-3 bg-emerald-deep text-butter rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md hover:bg-emerald-hover active:scale-[0.99] transition">
              ${getSvgIcon('dollar-sign', 'w-5 h-5 text-butter')}
              <span>💵 Вручить клиенту & Принять оплату</span>
            </button>
          </div>
        `;
      }
    } else {
      actionButtonHtml = `
        <div class="w-full min-h-[44px] py-2.5 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2">
          ${getSvgIcon('check-circle-2', 'w-5 h-5 text-emerald-700')}
          <span>Выполнен • Оплачено ${(order.paid_amount || order.total_price || 0).toLocaleString()} сум</span>
        </div>
      `;
    }

    return `
      <div class="theme-card border border-emerald-deep/20 rounded-2xl p-4 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs px-2.5 py-1 rounded-xl bg-emerald-deep text-butter shadow-xs cursor-pointer" onclick="openNavigationModal('${order.id}')" title="Маршрут к заказу">#${escapeHtml(order.id)}</span>
            ${order.urgent ? '<span class="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">⚡ Срочно</span>' : ''}
          </div>
          <div>${getStageBadge(order.stage)}</div>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-base text-emerald-deep cursor-pointer hover:underline" onclick="openNavigationModal('${order.id}')" title="Построить маршрут к клиенту">${escapeHtml(order.client_name)}</h4>
            <span class="text-xs font-bold text-emerald-deep font-mono">${(order.total_price || 0).toLocaleString()} сум</span>
          </div>
          <div class="text-xs text-charcoal-muted flex items-start gap-1.5 cursor-pointer hover:text-emerald-deep transition" onclick="openNavigationModal('${order.id}')" title="Построить маршрут к клиенту">
            ${getSvgIcon('map-pin', 'w-4 h-4 text-emerald-deep shrink-0 mt-0.5')}
            <span>${escapeHtml(order.client_address)} <b class="text-emerald-deep">(${escapeHtml(order.district || 'Самарканд')})</b></span>
          </div>
          ${order.landmark ? `<div class="text-[11px] text-charcoal-muted pl-5 font-medium">Ориентир: ${escapeHtml(order.landmark)}</div>` : ''}
          <div class="text-[11px] text-charcoal-muted pl-5">🕒 Время визита: <b class="text-emerald-deep">${escapeHtml(order.time_slot || 'В любое время')}</b></div>
          <div class="pl-5 pt-0.5">${assignmentBadge}</div>
        </div>

        <!-- Carpets count & payment status -->
        <div class="bg-emerald-deep/5 p-2 rounded-xl text-xs flex items-center justify-between text-emerald-deep font-bold">
          <span>📦 Изделий: ${carpetsCount} шт (${(order.total_m2 || 0)} м²)</span>
          <span>${order.paid ? '● Оплачен' : '○ Расчет при сдаче'}</span>
        </div>

        <!-- Prominent Dispatcher Comment / Instructions for Courier -->
        ${order.notes ? `
          <div class="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl p-3 text-xs text-amber-950 font-medium space-y-1.5 shadow-xs">
            <div class="flex items-center gap-1.5 font-bold text-amber-900 text-xs">
              ${getSvgIcon('message-square', 'w-4 h-4 text-amber-700 shrink-0')}
              <span>💬 Комментарий диспетчера:</span>
            </div>
            <div class="pl-5 text-charcoal font-semibold text-xs leading-relaxed whitespace-pre-wrap">${escapeHtml(order.notes)}</div>
          </div>
        ` : ''}

        <!-- GPS Location Status Block -->
        <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl border ${hasExactGps ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'} text-xs">
          <div class="flex items-center gap-2 overflow-hidden flex-1 cursor-pointer" onclick="openNavigationModal('${order.id}')" title="Нажмите, чтобы открыть маршрут в Яндекс или Google Maps">
            ${getSvgIcon('map-pin', `w-4 h-4 ${hasExactGps ? 'text-emerald-700' : 'text-amber-700'} shrink-0`)}
            <div class="truncate font-bold text-xs">
              ${hasExactGps ? `🎯 GPS дома: ${displayGpsText}` : `📍 Район (${order.district || 'Самарканд'})`}
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="openNavigationModal('${order.id}')" class="min-h-[38px] px-2.5 py-1.5 rounded-xl font-bold text-xs bg-emerald-deep text-butter hover:bg-emerald-hover transition shadow-xs flex items-center gap-1" title="Открыть выбор навигатора">
              ${getSvgIcon('navigation', 'w-3.5 h-3.5 text-butter')}
              <span>Маршрут</span>
            </button>
            <button type="button" onclick="openLocationModal('${order.id}', false)" class="min-h-[38px] px-2.5 py-1.5 rounded-xl font-bold text-xs bg-white border border-emerald-deep/20 text-charcoal hover:bg-butter transition shadow-xs" title="Указать/изменить точку на карте">
              ${getSvgIcon('map', 'w-3.5 h-3.5 text-emerald-deep')}
            </button>
          </div>
        </div>

        <!-- Quick Action Buttons: Phone & Call History & Navigators (Ergonomic touch zones) -->
        <div class="space-y-2 pt-1">
          <!-- Row 1: Phone call + Call history counter + Telegram -->
          <div class="flex items-center gap-2">
            <button type="button" onclick="callClient('${order.id}', '${escapeHtml(order.client_phone)}', '${escapeHtml(order.client_name)}')" class="flex-1 min-h-[44px] py-2 px-3 bg-emerald-deep text-butter rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-emerald-hover active:scale-[0.98] transition shadow-sm">
              ${getSvgIcon('phone-call', 'w-4 h-4 text-butter shrink-0')}
              <span>Позвонить</span>
            </button>
            <button type="button" onclick="openCallHistoryModal('${order.id}', '${escapeHtml(order.client_phone)}', '${escapeHtml(order.client_name)}')" class="min-h-[44px] px-3 bg-emerald-deep/10 text-emerald-deep hover:bg-emerald-deep/20 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 shrink-0" title="История звонков (${callsCount} вызовов)">
              <span class="text-xs">📞</span>
              <span class="text-xs font-mono font-extrabold">${callsCount > 0 ? callsCount : '0'}</span>
            </button>
            <button type="button" onclick="sendOrderToTelegram('${order.id}')" class="min-h-[44px] px-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold hover:bg-blue-100 active:scale-[0.98] transition shadow-sm flex items-center justify-center gap-1 shrink-0" title="Отправить карточку в Telegram">
              ${getSvgIcon('send', 'w-4 h-4 text-blue-600 shrink-0')}
              <span class="text-[11px] hidden sm:inline">Telegram</span>
            </button>
          </div>
          <!-- Row 2: Navigators with equal width and generous touch targets -->
          <div class="grid grid-cols-2 gap-2">
            <button type="button" onclick="navigateToOrder('${order.id}', 'yandex')" class="min-h-[44px] py-2 px-2.5 bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-amber-600 active:scale-[0.98] transition shadow-sm truncate" title="Яндекс Навигатор">
              ${getSvgIcon('navigation', 'w-4 h-4 text-white shrink-0')}
              <span class="truncate">Яндекс Карты</span>
            </button>
            <button type="button" onclick="navigateToOrder('${order.id}', 'google')" class="min-h-[44px] py-2 px-2.5 bg-blue-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-blue-700 active:scale-[0.98] transition shadow-sm truncate" title="Google Maps">
              ${getSvgIcon('map', 'w-4 h-4 text-white shrink-0')}
              <span class="truncate">Google Maps</span>
            </button>
          </div>
          <!-- Row 3: Photo capture and defect inspection -->
          <button type="button" onclick="openOrderPhotosModal('${order.id}')" class="w-full min-h-[44px] py-2 px-3 bg-white border-2 border-emerald-deep/20 hover:border-emerald-deep text-emerald-deep rounded-xl text-xs font-bold flex items-center justify-between transition shadow-xs">
            <span class="flex items-center gap-1.5">
              <span>📸</span>
              <span>Фото ковра и дефектов:</span>
            </span>
            <span class="px-2.5 py-0.5 rounded-full ${photosCount > 0 ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-gray-100 text-charcoal-muted'} font-mono font-bold text-[10px]">
              ${photosCount > 0 ? `${photosCount} фото` : 'Добавить фото'}
            </span>
          </button>
        </div>

        <!-- Big Stage Completion Button (Min 48px height) -->
        <div class="pt-1">
          ${actionButtonHtml}
        </div>
      </div>
    `;
  }).join('');

  refreshAllIcons();
}

function initCourierPortalMap() {
  const mapDiv = document.getElementById('courier-portal-map');
  if (!mapDiv) return;

  if (!courierPortalMap) {
    if (typeof L === 'undefined') return;
    courierPortalMap = L.map('courier-portal-map').setView([39.6542, 66.9597], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(courierPortalMap);
  }

  courierMapMarkers.forEach(m => courierPortalMap.removeLayer(m));
  courierMapMarkers = [];

  const myOrders = activeOrders.filter(o => 
    isOrderForCourier(o, currentUser) &&
    ['pickup', 'ready', 'delivery'].includes(o.stage)
  );

  myOrders.forEach((order) => {
    const coordInfo = getOrderCoordinatesWithFallback(order);
    const lat = coordInfo.coords[0];
    const lng = coordInfo.coords[1];
    const isExactGps = coordInfo.isExact;

    const isPickup = order.stage === 'pickup';
    const markerColor = isPickup ? '#10606F' : '#1D8B94';

    const customIcon = L.divIcon({
      className: 'custom-courier-pin',
      html: `<div style="background-color: ${markerColor}; color: white; border: ${isExactGps ? '3px solid #98D8D0' : '2px solid white'}; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; box-shadow: ${isExactGps ? '0 0 10px rgba(29,139,148,0.8)' : '0 4px 6px rgba(0,0,0,0.3)'};">${isPickup ? '📦' : '🚚'}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(courierPortalMap);
    const yandexUrl = isExactGps 
      ? `https://yandex.com/maps/?rtext=~${lat},${lng}`
      : `https://yandex.com/maps/?rtext=~${encodeURIComponent(order.client_address + ', Самарканд')}`;
    const googleUrl = isExactGps
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.client_address + ', Самарканд')}`;

    marker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4; padding: 5px; min-width: 220px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:6px;">
          <b style="color: #04222B; font-size: 13px;">Заказ #${order.id}</b>
          <span style="font-size:10px; font-weight:bold; padding:2px 6px; border-radius:8px; background:${markerColor}; color:#fff;">${isPickup ? '📦 Забор' : '🚚 Доставка'}</span>
        </div>
        <b>${escapeHtml(order.client_name)}</b><br>
        <span style="color:#555;">${escapeHtml(order.client_address)} (${escapeHtml(order.district || 'Самарканд')})</span><br>
        
        ${order.notes ? `<div style="background:#FFFBEB; border:1px solid #FCD34D; color:#92400E; padding:4px; border-radius:6px; font-size:11px; margin:4px 0;">💬 <b>Диспетчер:</b> ${escapeHtml(order.notes)}</div>` : ''}

        <div style="margin:6px 0; font-size:11px;">
          ${isExactGps ? `<span style="color:#1D8B94; font-weight:bold;">🎯 Точные GPS-координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>` : '<span style="color:#b45309; font-weight:bold;">📍 Приблизительный район</span>'}
        </div>

        <div style="margin-top: 8px; display:flex; flex-direction:column; gap:4px;">
          <button type="button" onclick="callClient('${order.id}', '${escapeHtml(order.client_phone)}', '${escapeHtml(order.client_name)}')" style="background:#04222B; color:#98D8D0; border:none; padding:5px 8px; border-radius:6px; font-size:11px; font-weight:bold; cursor:pointer; text-align:center;">📞 Позвонить (${escapeHtml(order.client_phone)})</button>
          <div style="display:flex; gap:4px;">
            <button type="button" onclick="navigateToOrder('${order.id}', 'yandex')" style="flex:1; background:#d97706; color:#fff; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">🧭 Яндекс</button>
            <button type="button" onclick="navigateToOrder('${order.id}', 'google')" style="flex:1; background:#2563eb; color:#fff; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">🗺️ Google</button>
            <button type="button" onclick="openNavigationModal('${order.id}')" style="flex:1; background:#04222B; color:#98D8D0; padding:5px 6px; border-radius:6px; border:none; font-size:10px; font-weight:bold; cursor:pointer;">Подробнее</button>
          </div>
          <button type="button" onclick="openLocationModal('${order.id}', false)" style="background:#f3f4f6; color:#374151; border:1px solid #d1d5db; padding:3px 6px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer; margin-top:2px;">📍 ${isExactGps ? 'Изменить координаты' : '🎯 Зафиксировать точку GPS'}</button>
        </div>
      </div>
    `);

    courierMapMarkers.push(marker);
  });

  setTimeout(() => {
    if (courierPortalMap) courierPortalMap.invalidateSize();
  }, 200);
}

function toggleCourierLiveGps() {
  courierLiveGpsActive = !courierLiveGpsActive;
  const btn = document.getElementById('courier-gps-btn');
  const txt = document.getElementById('courier-gps-text');
  if (courierLiveGpsActive) {
    startCourierGpsTracking();
    if (btn) btn.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1';
    if (txt) txt.textContent = 'GPS: В сети';
  } else {
    if (gpsTrackingInterval) clearInterval(gpsTrackingInterval);
    if (btn) btn.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1';
    if (txt) txt.textContent = 'GPS: Пауза';
  }
}

async function advanceCourierPickup(orderId) {
  openPickupModal(orderId);
}

async function advanceCourierDelivery(orderId) {
  try {
    const courierName = currentUser?.name || 'Курьер';
    const res = await fetch(`/api/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        stage: 'ready', 
        actor_name: courierName,
        courier_name: courierName
      })
    });
    if (res.ok) {
      alert(`🚚 Заказ #${orderId} взят на доставку курьером ${courierName}! Загружен в авто (статус: 3. Готов к доставке).`);
      await loadInitialData();
    } else {
      alert('Ошибка перевода заказа на доставку');
    }
  } catch (e) {
    alert('Ошибка перевода заказа на доставку');
  }
}

function renderCourierOrders() {
  renderCourierPortal();
}

function openStreetOrderModal() {
  openNewOrderModal();
  document.getElementById('modal-order-title').textContent = '🚚 Уличный заказ (быстрый забор у подъезда)';
  document.getElementById('order-stage-select').value = 'pickup';
  const courierSelect = document.getElementById('order-courier-name');
  if (courierSelect && currentUser) {
    courierSelect.value = currentUser.name;
  }
}

function openCourierDeliveryModal(orderId) {
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById('delivery-order-id').textContent = '#' + order.id;
  document.getElementById('delivery-client-name').textContent = order.client_name;
  document.getElementById('delivery-total-amount').textContent = (order.total_price || 0).toLocaleString() + ' сум';
  document.getElementById('delivery-paid-input').value = order.total_price || 0;
  document.getElementById('modal-delivery-complete').setAttribute('data-order-id', order.id);
  document.getElementById('modal-delivery-complete').classList.remove('hidden');
  checkDeliveryUnderpaid();
}

function checkDeliveryUnderpaid() {
  const orderId = document.getElementById('modal-delivery-complete').getAttribute('data-order-id');
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  const total = order.total_price || 0;
  const paid = parseFloat(document.getElementById('delivery-paid-input').value) || 0;
  const underpaidBox = document.getElementById('delivery-underpaid-box');

  if (paid < total) {
    underpaidBox.classList.remove('hidden');
  } else {
    underpaidBox.classList.add('hidden');
  }
}

async function confirmDeliveryComplete() {
  const modal = document.getElementById('modal-delivery-complete');
  const orderId = modal.getAttribute('data-order-id');
  const paid = parseFloat(document.getElementById('delivery-paid-input').value) || 0;
  const method = document.getElementById('delivery-payment-method').value;
  const reason = document.getElementById('delivery-underpaid-reason').value;

  if (paid < 0) {
    alert('Сумма оплаты не может быть отрицательной!');
    return;
  }

  const submitBtn = modal.querySelector('button[onclick="confirmDeliveryComplete()"]') || modal.querySelector('button.btn-submit');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/orders/${orderId}/delivery-complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paid_amount: paid,
        payment_method: method,
        underpaid_reason: reason,
        courier_name: (currentUser && currentUser.name) ? currentUser.name : 'Курьер'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal('modal-delivery-complete');
      alert(`✅ Заказ #${orderId} успешно доставлен клиенту!`);
      await loadInitialData();
    } else {
      alert(data.error || 'Ошибка при завершении доставки.');
    }
  } catch (e) {
    alert('Ошибка при завершении доставки.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ================= WASHER SHOP ACTIONS & MEASUREMENT =================

function setWasherPortalSubTab(tab) {
  activeWasherPortalTab = tab;

  ['all', 'need_measure', 'cleaning', 'ready'].forEach(t => {
    const btn = document.getElementById(`btn-washer-tab-${t}`);
    if (btn) {
      if (t === tab) {
        btn.className = 'py-2.5 px-4 min-h-[44px] shrink-0 whitespace-nowrap rounded-xl bg-emerald-deep text-butter shadow flex items-center gap-1.5 transition active:scale-[0.98]';
      } else {
        btn.className = 'py-2.5 px-4 min-h-[44px] shrink-0 whitespace-nowrap rounded-xl bg-white dark:bg-[#052129] text-emerald-deep dark:text-butter border border-emerald-deep/20 dark:border-butter/20 shadow-sm flex items-center gap-1.5 transition hover:bg-butter-surface active:scale-[0.98]';
      }
    }
  });

  renderWasherPortalCards();
}

function renderWasherPortal() {
  const inShop = activeOrders.filter(o => isShopStage(o.stage));
  const needMeasure = activeOrders.filter(o => o.stage !== 'delivered' && o.stage !== 'cancelled' && (!o.total_m2 || o.total_m2 === 0));
  const cleaning = inShop.filter(o => (o.total_m2 || 0) > 0);
  const ready = activeOrders.filter(o => isReadyOrDeliveryStage(o.stage));
  const allInWorkshop = activeOrders.filter(o => isShopStage(o.stage) || o.stage === 'ready' || (!o.total_m2 && o.stage !== 'delivered' && o.stage !== 'cancelled'));

  const bAll = document.getElementById('badge-washer-all');
  const bMeasure = document.getElementById('badge-washer-need_measure');
  const bCleaning = document.getElementById('badge-washer-cleaning');
  const bReady = document.getElementById('badge-washer-ready');

  if (bAll) bAll.textContent = allInWorkshop.length;
  if (bMeasure) bMeasure.textContent = needMeasure.length;
  if (bCleaning) bCleaning.textContent = cleaning.length;
  if (bReady) bReady.textContent = ready.length;

  let totalCarpets = 0;
  let totalM2 = 0;
  allInWorkshop.forEach(o => {
    let carpets = [];
    if (Array.isArray(o.carpets)) carpets = o.carpets;
    else if (typeof o.carpets === 'string') {
      try { carpets = JSON.parse(o.carpets); } catch (e) { carpets = []; }
    }
    const count = carpets.reduce((sum, it) => sum + (parseInt(it.qty || it.count, 10) || 1), 0) || (carpets.length > 0 ? carpets.length : 1);
    totalCarpets += count;
    totalM2 += (o.total_m2 || 0);
  });

  const oCount = document.getElementById('washer-portal-orders-count');
  const cCount = document.getElementById('washer-portal-carpets-count');
  const mSum = document.getElementById('washer-portal-m2-sum');
  const nameEl = document.getElementById('washer-portal-name');

  if (oCount) oCount.textContent = `${allInWorkshop.length} заказов`;
  if (cCount) cCount.textContent = totalCarpets;
  if (mSum) mSum.textContent = totalM2.toFixed(1);
  if (nameEl && currentUser && currentUser.name) {
    const cleanName = currentUser.name.replace(/\s*\(.*?\)\s*/g, '').trim();
    nameEl.textContent = `${cleanName} (Мастер цеха)`;
  }

  setWasherPortalSubTab(activeWasherPortalTab);
}

function formatOrderDate(val) {
  if (!val) return 'Сегодня';
  if (typeof formatDateSafe === 'function') return formatDateSafe(val);
  try {
    const d = new Date(val);
    return isNaN(d) ? String(val) : d.toLocaleDateString('ru-RU');
  } catch (e) {
    return String(val);
  }
}

function renderWasherPortalCards() {
  const container = document.getElementById('washer-cards-container');
  if (!container) return;

  const inShop = activeOrders.filter(o => isShopStage(o.stage));
  const needMeasure = activeOrders.filter(o => o.stage !== 'delivered' && o.stage !== 'cancelled' && (!o.total_m2 || o.total_m2 === 0));
  const cleaning = inShop.filter(o => (o.total_m2 || 0) > 0);
  const ready = activeOrders.filter(o => isReadyOrDeliveryStage(o.stage));
  const allInWorkshop = activeOrders.filter(o => isShopStage(o.stage) || o.stage === 'ready' || (!o.total_m2 && o.stage !== 'delivered' && o.stage !== 'cancelled'));
  let targetList = [];

  if (activeWasherPortalTab === 'all') {
    targetList = allInWorkshop;
  } else if (activeWasherPortalTab === 'need_measure') {
    targetList = needMeasure;
  } else if (activeWasherPortalTab === 'cleaning') {
    targetList = cleaning;
  } else if (activeWasherPortalTab === 'ready') {
    targetList = ready;
  } else {
    targetList = allInWorkshop;
  }

  const searchInput = document.getElementById('washer-search-input');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  targetList = targetList.filter(o => {
    if (query) {
      const matchId = String(o.id || '').toLowerCase().includes(query);
      const matchName = String(o.client_name || '').toLowerCase().includes(query);
      const matchPhone = String(o.client_phone || '').toLowerCase().includes(query);
      const matchAddress = String(o.client_address || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchPhone && !matchAddress) return false;
    }
    return true;
  });

  if (targetList.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 px-4 text-center text-charcoal-muted theme-card rounded-2xl border border-emerald-deep/15">
        ${getSvgIcon('check-circle-2', 'w-12 h-12 mx-auto text-emerald-deep/40 mb-2')}
        <p class="font-bold text-sm text-emerald-deep dark:text-butter">В этой категории нет заказов</p>
        <p class="text-xs mt-1 text-charcoal-muted">Все изделия обработаны или еще не поступили в цех от курьеров</p>
      </div>
    `;
    refreshAllIcons();
    return;
  }

  try {
    container.innerHTML = targetList.map((order) => {
      let carpets = [];
      if (Array.isArray(order.carpets)) carpets = order.carpets;
      else if (typeof order.carpets === 'string') {
        try { carpets = JSON.parse(order.carpets); } catch (e) { carpets = []; }
      }
      const carpetsCount = carpets.reduce((sum, it) => sum + (parseInt(it.qty || it.count, 10) || 1), 0) || (carpets.length > 0 ? carpets.length : 1);
      const orderNeedsMeasure = !order.total_m2 || order.total_m2 === 0;
      const washerPhotosCount = (order.photos && Array.isArray(order.photos)) ? order.photos.length : 0;
      const cleanPhone = String(order.client_phone || '').replace(/[^\d+]/g, '');
      const isPaid = Boolean(order.paid || order.payment_status === 'paid');
      const isUrgent = Boolean(order.urgent || (order.notes && order.notes.toLowerCase().includes('срочн')));

      const mapAddress = encodeURIComponent(((order.district ? order.district + ', ' : '') + (order.client_address || '') + ' Самарканд').trim());
      const yandexMapUrl = order.gps_location 
        ? `https://yandex.ru/maps/?text=${encodeURIComponent(order.gps_location)}`
        : `https://yandex.ru/maps/?text=${mapAddress}`;

      const formattedDate = formatOrderDate(order.created_at || order.date);

    // Stage advance action button
    let stageActionBtn = '';
    if (isReadyOrDeliveryStage(order.stage)) {
      stageActionBtn = `
        <span class="w-full min-h-[42px] py-2 px-3 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800/60 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs">
          ${getSvgIcon('package-check', 'w-4 h-4 text-teal-600 dark:text-teal-400')}
          <span>✨ Готов к доставке (${escapeHtml(order.courier_name ? order.courier_name.split(' ')[0] : 'Курьер')})</span>
        </span>
      `;
    } else if (orderNeedsMeasure) {
      stageActionBtn = `
        <button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="w-full min-h-[42px] py-2 px-3 bg-gradient-to-r from-[#10606F] to-[#1D8B94] hover:from-[#1D8B94] hover:to-[#4FB8B4] active:scale-[0.98] text-white rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 shadow-md" title="Внести замеры ковров">
          ${getSvgIcon('ruler', 'w-4 h-4 text-white')}
          <span>📐 Внести замеры</span>
        </button>
      `;
    } else {
      stageActionBtn = `
        <button type="button" onclick="advanceWasherStage('${order.id}', 'ready')" class="w-full min-h-[42px] py-2 px-3 bg-gradient-to-r from-[#1D8B94] to-[#4FB8B4] text-[#04222B] rounded-xl text-xs font-black hover:opacity-95 active:scale-[0.98] transition flex items-center justify-center gap-1.5 shadow-md" title="Стирка и замеры завершены — передать курьеру на доставку">
          ${getSvgIcon('check-circle-2', 'w-4 h-4 text-butter')}
          <span>✅ Готов к доставке</span>
        </button>
      `;
    }

    return `
      <div class="theme-card border ${isUrgent ? 'border-rose-500 shadow-rose-500/10 ring-1 ring-rose-400' : 'border-emerald-deep/20'} rounded-2xl p-3.5 shadow-md hover:shadow-lg transition flex flex-col justify-between space-y-2.5 text-xs bg-white dark:bg-[#052129]">
        <div class="space-y-2">
          <!-- Row 1: Status badge left, Order ID right (Cosmo CRM matching) -->
          <div class="flex items-center justify-between gap-2 border-b border-emerald-deep/10 dark:border-white/10 pb-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              ${isUrgent ? '<span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 font-extrabold text-[10px] uppercase border border-rose-300 dark:border-rose-700">🔥 СРОЧНО</span>' : ''}
              <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${isShopStage(order.stage) ? 'bg-[#E2F4F0] text-[#0A3D4A] border border-[#98D8D0] dark:bg-[#0A3D4A] dark:text-[#98D8D0]' : 'bg-[#1D8B94]/15 text-[#1D8B94] border border-[#1D8B94]/40 dark:bg-[#1D8B94]/30 dark:text-[#4FB8B4]'}">
                ${isShopStage(order.stage) ? '🧼 В стирке' : '✨ Готов'}
              </span>
              ${orderNeedsMeasure 
                ? `<button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 text-[10px] font-extrabold px-2 py-0.5 rounded-md border border-rose-300 animate-pulse hover:bg-rose-200" title="Нажмите, чтобы внести замеры">📐 Без замеров</button>` 
                : `<button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px] font-extrabold px-2 py-0.5 rounded-md border border-emerald-300 hover:bg-emerald-200" title="Нажмите, чтобы изменить замеры">✓ Замерен</button>`}
            </div>
            <span class="font-mono font-black text-sm sm:text-base text-[#1D8B94] dark:text-[#98D8D0] shrink-0">№ ${escapeHtml(order.id)}</span>
          </div>

          <!-- Row 2: Courier & Date -->
          <div class="flex items-center gap-1.5 text-[11.5px] text-charcoal-muted dark:text-gray-400">
            ${getSvgIcon('truck', 'w-3.5 h-3.5 text-[#1D8B94] shrink-0')}
            <span class="font-bold text-emerald-deep dark:text-gray-200 truncate">${escapeHtml(order.courier_name || 'Курьер не назначен')}</span>
            <span class="text-charcoal-muted/60">•</span>
            <span class="shrink-0">${formattedDate}</span>
          </div>

          <!-- Row 3: Client Name -->
          <div class="flex items-center gap-1.5 text-sm font-black text-emerald-deep dark:text-butter truncate">
            ${getSvgIcon('user', 'w-4 h-4 text-emerald-600 dark:text-butter shrink-0')}
            <span class="truncate">${escapeHtml(order.client_name || 'Клиент')}</span>
          </div>

          <!-- Row 4: Phone & Map Pin -->
          <div class="flex items-center justify-between gap-2">
            <a href="tel:${cleanPhone}" class="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 min-w-0 truncate">
              ${getSvgIcon('phone', 'w-3.5 h-3.5 text-emerald-600 shrink-0')}
              <span class="truncate">${escapeHtml(order.client_phone || '—')}</span>
            </a>
            <a href="${yandexMapUrl}" target="_blank" rel="noreferrer" class="py-1 px-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-1 hover:bg-rose-100 transition shadow-2xs shrink-0" title="Открыть адрес на Яндекс.Картах">
              ${getSvgIcon('map-pin', 'w-3.5 h-3.5 text-rose-600 shrink-0')}
              <span>Карта</span>
            </a>
          </div>

          <!-- Row 5: Address -->
          <div class="flex items-start gap-1.5 text-xs text-charcoal-muted dark:text-gray-300">
            ${getSvgIcon('home', 'w-3.5 h-3.5 text-[#10606F] shrink-0 mt-0.5')}
            <span class="line-clamp-2">${escapeHtml(order.client_address || 'Адрес не указан')}${order.landmark ? ` (${escapeHtml(order.landmark)})` : ''}</span>
          </div>

          <!-- Row 6: Items & Area info (with prominent Quick + Добавить button) -->
          <div class="bg-emerald-deep/5 dark:bg-white/5 border border-emerald-deep/10 dark:border-white/10 rounded-xl p-2.5 space-y-1.5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <span class="text-charcoal-muted dark:text-gray-400 font-bold">🧺 Изделия: ${carpetsCount} шт</span>
                <button type="button" onclick="openMeasureModalForOrder('${order.id}', true)" class="text-[10px] text-[#04222B] dark:text-[#98D8D0] bg-[#E2F4F0] dark:bg-[#0A3D4A] hover:bg-[#C8E6E2] border border-[#98D8D0] dark:border-[#4FB8B4]/40 px-2 py-0.5 rounded-md font-extrabold inline-flex items-center gap-0.5 shadow-2xs transition active:scale-95" title="Быстро добавить новое изделие в заказ">
                  <span>➕ Добавить</span>
                </button>
              </div>
              <span class="font-mono font-black ${orderNeedsMeasure ? 'text-[#10606F] dark:text-[#98D8D0]' : 'text-[#1D8B94] dark:text-[#98D8D0]'}">
                ${orderNeedsMeasure ? '📏 Без замеров' : `✨ ${(order.total_m2 || 0)} м²`}
              </span>
            </div>

            <!-- Items breakdown -->
            <div class="space-y-1 max-h-24 overflow-y-auto custom-scrollbar pr-1">
              ${carpets.length > 0 ? carpets.map((c, i) => {
                if (!c || typeof c !== 'object') return '';
                const itemName = escapeHtml(c.name || `Ковер #${i+1}`);
                const unitStr = String(c.unit || 'м²').toLowerCase();
                const isPiece = unitStr === 'шт' || unitStr === 'штук' || unitStr === 'dona';
                const isMeter = unitStr === 'метр' || unitStr === 'м' || unitStr === 'пог.м';
                const hasDimensions = Number(c.length) > 0 && Number(c.width) > 0;

                let dimText = '';
                let areaText = '';

                if (isPiece) {
                  const qtyVal = c.qty || c.count || 1;
                  dimText = `${qtyVal} шт`;
                  const sumVal = Number(c.total) || (Number(c.price) ? Number(c.price) * qtyVal : 0);
                  areaText = sumVal > 0 ? `${sumVal.toLocaleString()} сум` : '—';
                } else if (isMeter) {
                  dimText = Number(c.length) > 0 ? `${c.length} пог.м` : '<span class="text-[#1D8B94] dark:text-[#98D8D0] font-semibold italic">требует замера</span>';
                  const sumVal = Number(c.total) || (Number(c.price) && Number(c.length) ? Math.round(Number(c.price) * Number(c.length)) : 0);
                  areaText = sumVal > 0 ? `${sumVal.toLocaleString()} сум` : '—';
                } else {
                  dimText = hasDimensions ? `${c.length}м × ${c.width}м` : '<span class="text-[#1D8B94] dark:text-[#98D8D0] font-semibold italic">требует замера</span>';
                  const areaVal = Number(c.area) || (hasDimensions ? +(c.length * c.width).toFixed(2) : 0);
                  areaText = areaVal > 0 ? `${areaVal} м²` : '—';
                }

                return `
                  <div class="flex items-center justify-between text-[11px] text-charcoal-muted dark:text-gray-400">
                    <span class="truncate mr-1">${itemName}: <b class="text-emerald-deep dark:text-gray-200">${dimText}</b></span>
                    <span class="font-mono font-bold shrink-0 text-emerald-deep dark:text-butter">${areaText}</span>
                  </div>
                `;
              }).filter(Boolean).join('') : '<div class="text-[11px] text-[#1D8B94] dark:text-[#98D8D0] font-semibold italic">Ковры (требуется замер мастера)</div>'}
            </div>
          </div>

          <!-- Row 7: Dispatcher / Comments -->
          <div class="flex items-center gap-1.5 text-[11.5px] text-charcoal-muted dark:text-gray-400 truncate">
            ${getSvgIcon('headphones', 'w-3.5 h-3.5 text-[#1D8B94] shrink-0')}
            <span class="truncate">${escapeHtml(order.dispatcher_name || 'Диспетчер')}</span>
            ${order.notes ? `<span class="text-amber-800 dark:text-amber-300 font-bold truncate">• 💬 ${escapeHtml(order.notes)}</span>` : ''}
          </div>

          <!-- Row 8: Price & Payment Status -->
          <div class="flex items-center justify-between bg-emerald-deep/5 dark:bg-white/5 px-2.5 py-1.5 rounded-xl text-xs border border-emerald-deep/10 dark:border-white/10">
            <span class="font-mono font-black text-sm ${orderNeedsMeasure ? 'text-[#10606F] dark:text-[#98D8D0]' : 'text-[#04222B] dark:text-[#98D8D0]'}">
              ${orderNeedsMeasure ? '📏 Ожидает замера' : `${(order.total_price || 0).toLocaleString()} сум`}
            </span>
            <span class="text-[11px] font-extrabold ${isPaid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
              ${isPaid ? '✅ Оплачено' : '🔴 Не оплачено'}
            </span>
          </div>
        </div>

        <!-- Row 9: 4 Ergonomic Action Buttons (Cosmo CRM layout) -->
        <div class="border-t border-emerald-deep/10 dark:border-white/10 pt-2.5 space-y-2">
          <div class="grid grid-cols-3 gap-1.5">
            <button type="button" onclick="openMeasureModalForOrder('${order.id}', true)" class="min-h-[40px] py-2 px-1.5 bg-[#E2F4F0] hover:bg-[#C8E6E2] dark:bg-[#0A3D4A] border border-[#98D8D0]/50 text-[#04222B] dark:text-[#E2F4F0] rounded-xl text-[11px] font-black active:scale-[0.98] transition flex items-center justify-center gap-1 shadow-2xs" title="Добавить новое изделие / ковер">
              ${getSvgIcon('plus-circle', 'w-3.5 h-3.5 text-[#1D8B94] dark:text-[#98D8D0]')}
              <span>+ Изделие</span>
            </button>
            <button type="button" onclick="openMeasureModalForOrder('${order.id}')" class="min-h-[40px] py-2 px-1.5 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 border border-sky-300 dark:border-sky-700 text-sky-900 dark:text-sky-200 rounded-xl text-[11px] font-black active:scale-[0.98] transition flex items-center justify-center gap-1 shadow-2xs" title="Замер каждого ковра">
              ${getSvgIcon('ruler', 'w-3.5 h-3.5 text-sky-600 dark:text-sky-400')}
              <span>📏 Замер</span>
            </button>
            <button type="button" onclick="openOrderPhotosModal('${order.id}')" class="min-h-[40px] py-2 px-1.5 bg-white dark:bg-[#052129] hover:bg-butter-surface border border-emerald-deep/20 text-emerald-deep dark:text-butter rounded-xl text-[11px] font-bold active:scale-[0.98] transition flex items-center justify-center gap-1 shadow-2xs" title="Фото ковров и дефектов">
              <span>📸</span>
              <span>Фото (${washerPhotosCount})</span>
            </button>
          </div>
          ${stageActionBtn}
        </div>
      </div>
    `;
    }).join('');
  } catch (err) {
    console.error('Error rendering washer portal cards:', err);
  }

  refreshAllIcons();
}

async function advanceWasherStage(orderId, newStage) {
  try {
    const res = await fetch(`/api/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage, actor_name: currentUser?.name || 'Мастер цеха' })
    });
    if (res.ok) {
      await loadInitialData();
    } else {
      alert('Ошибка перевода заказа на следующий этап');
    }
  } catch (e) {
    alert('Ошибка перевода заказа на следующий этап');
  }
}

function setWasherFilter(filter) {
  activeWasherFilter = filter;
  setWasherPortalSubTab(filter);
  renderMobileBottomNav('washer');
}

function renderWasherOrders() {
  renderWasherPortal();
}

async function openMeasureModalFromOrderForm() {
  let orderId = document.getElementById('order-form-id')?.value;
  if (!orderId) {
    const clientNameInput = document.getElementById('order-client-name');
    const clientPhoneInput = document.getElementById('order-client-phone');
    const clientName = clientNameInput ? clientNameInput.value.trim() : '';
    const clientPhone = clientPhoneInput ? clientPhoneInput.value.trim() : '';

    if (!clientName) {
      alert('Пожалуйста, укажите имя клиента в форме заказа, чтобы сохранить заявку и перейти к внесению замеров ковров.');
      if (clientNameInput) clientNameInput.focus();
      return;
    }

    const customIdInput = document.getElementById('order-form-custom-id');
    const customId = customIdInput ? customIdInput.value.trim() : '';

    const itemRows = document.querySelectorAll('#order-form-items-container .order-item-row');
    const formCarpets = [];
    itemRows.forEach((row, idx) => {
      const sel = row.querySelector('.item-name-input');
      const opt = sel ? sel.options[sel.selectedIndex] : null;
      const name = sel ? sel.value : `Ковер #${idx + 1}`;
      const qtyInput = row.querySelector('.item-qty-input');
      const qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;
      const price = opt ? parseFloat(opt.getAttribute('data-price')) || 14000 : 14000;
      const unit = opt ? opt.getAttribute('data-unit') || 'м²' : 'м²';

      for (let i = 0; i < qty; i++) {
        formCarpets.push({
          name: qty > 1 ? `${name} #${i + 1}` : name,
          unit,
          price,
          qty: 1,
          length: unit === 'м²' ? 3.0 : (unit === 'метр' ? 2.0 : 0),
          width: unit === 'м²' ? 2.0 : 0,
          area: 0,
          total: 0
        });
      }
    });

    if (formCarpets.length === 0) {
      formCarpets.push({ name: 'Gilam Standart #1', unit: 'м²', price: 14000, qty: 1, length: 3.0, width: 2.0, area: 0, total: 0 });
    }

    const payload = {
      client_name: clientName,
      client_phone: clientPhone || 'Не указан',
      client_address: document.getElementById('order-client-address')?.value.trim() || 'Самарканд',
      district: document.getElementById('order-district')?.value || 'Сиёб',
      landmark: document.getElementById('order-landmark')?.value.trim() || '',
      language: document.getElementById('order-language')?.value || 'Русский',
      time_slot: document.getElementById('order-timeslot')?.value || 'В любое время',
      urgent: document.getElementById('order-urgent-check')?.checked || false,
      stage: 'in_shop',
      courier_name: cleanCourierName(document.getElementById('order-courier-name')?.value || ''),
      notes: document.getElementById('order-notes')?.value.trim() || '',
      carpets: formCarpets,
      total_m2: 0,
      total_price: 0,
      dispatcher_name: currentUser ? currentUser.name : 'Диспетчер'
    };
    if (customId) payload.custom_id = customId;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const newId = data.orderId || data.id;
      if (res.ok && newId) {
        orderId = newId;
        document.getElementById('order-form-id').value = orderId;
        await loadInitialData();
      } else {
        alert(data.error || 'Ошибка при создании заказа для замеров.');
        return;
      }
    } catch (err) {
      alert('Ошибка соединения при сохранении заявки: ' + err.message);
      return;
    }
  }

  closeModal('modal-order');
  await openMeasureModalForOrder(orderId);
}

async function openMeasureModalForOrder(orderId, autoAddNew = false) {
  if (!orderId) {
    alert('Идентификатор заказа не указан.');
    return;
  }

  let order = (typeof activeOrders !== 'undefined' && Array.isArray(activeOrders))
    ? activeOrders.find(o => String(o.id) === String(orderId))
    : null;

  if (!order && typeof allOrders !== 'undefined' && Array.isArray(allOrders)) {
    order = allOrders.find(o => String(o.id) === String(orderId));
  }

  if (!order) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (res.ok) {
        order = await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch order for measure modal:', e);
    }
  }

  if (!order) {
    alert(`Заказ #${orderId} не найден в системе.`);
    return;
  }

  // Ensure modal-order is hidden so modals never clash
  const modalOrder = document.getElementById('modal-order');
  if (modalOrder && !modalOrder.classList.contains('hidden')) {
    modalOrder.classList.add('hidden');
  }

  const modalMeasure = document.getElementById('modal-measure');
  modalMeasure.setAttribute('data-order-id', order.id);
  modalMeasure.classList.remove('hidden');

  document.getElementById('measure-order-info').textContent = `Заказ #${order.id} (${order.client_name} • ${order.client_address || 'Самарканд'})`;

  const measurePhotosCount = (order.photos && Array.isArray(order.photos)) ? order.photos.length : 0;
  const measurePhotosBadge = document.getElementById('measure-modal-photos-count');
  if (measurePhotosBadge) measurePhotosBadge.textContent = `${measurePhotosCount}`;

  const container = document.getElementById('measure-items-list');
  container.innerHTML = '';

  let rawCarpets = [];
  if (order.carpets) {
    try {
      rawCarpets = typeof order.carpets === 'string' ? JSON.parse(order.carpets) : order.carpets;
    } catch (e) {
      rawCarpets = [];
    }
  }

  if (!Array.isArray(rawCarpets)) rawCarpets = [];

  // Разворачиваем позиции, если у позиции указано количество > 1 (например, из приёма курьера "Ковер - 3 шт")
  const expandedItems = [];
  rawCarpets.forEach((c) => {
    if (!c || typeof c !== 'object') return;
    const count = parseInt(c.qty || c.count, 10) || 1;
    const meta = resolveItemServiceMeta(c);
    const isCarpet = meta.unit === 'м²';
    const isMeter = meta.unit === 'метр' || meta.unit === 'м' || meta.unit === 'пог.м';
    const hasDimensions = Number(c.length) > 0 && Number(c.width) > 0;
    const baseName = c.name ? c.name.split(' (')[0].replace(/\s*#\d+$/, '') : (isCarpet ? 'Ковер' : (isMeter ? 'Курпача' : 'Изделие'));

    if (count > 1 && isCarpet && !hasDimensions) {
      for (let i = 0; i < count; i++) {
        expandedItems.push({
          ...c,
          name: `${baseName} #${i + 1}`,
          unit: 'м²',
          qty: 1,
          price: c.price || meta.price,
          width: c.width || 2.0,
          length: c.length || 3.0
        });
      }
    } else if (count > 1 && isMeter && !c.length) {
      for (let i = 0; i < count; i++) {
        expandedItems.push({
          ...c,
          name: `${baseName} #${i + 1}`,
          unit: 'метр',
          qty: 1,
          price: c.price || meta.price,
          length: 2.0
        });
      }
    } else {
      expandedItems.push({
        ...c,
        unit: c.unit || meta.unit,
        price: c.price || meta.price,
        qty: count
      });
    }
  });

  if (expandedItems.length === 0 && !autoAddNew) {
    const defaultSvc = (allServices && allServices[0]) || { name: 'Gilam Standart', unit: 'м²', price: 14000 };
    expandedItems.push({ name: `${defaultSvc.name} #1`, length: 3.0, width: 2.0, unit: defaultSvc.unit || 'м²', price: defaultSvc.price || 14000, qty: 1 });
  }

  expandedItems.forEach((c, idx) => {
    addMeasureRow(c, idx + 1, false);
  });

  if (autoAddNew) {
    addMeasureRow(null, expandedItems.length + 1, true);
  }

  const courierSelect = document.getElementById('measure-courier-select');
  if (courierSelect) {
    const courierList = (Array.isArray(allEmployees) ? allEmployees : []).filter(e => e.role === 'courier' && e.status !== 'inactive');
    let opts = '<option value="">(Любой свободный экипаж / курьер)</option>';
    courierList.forEach(e => {
      const isSel = cleanCourierName(e.name) === cleanCourierName(order.courier_name);
      opts += `<option value="${escapeHtml(e.name)}" ${isSel ? 'selected' : ''}>🚚 ${escapeHtml(e.name)}</option>`;
    });
    courierSelect.innerHTML = opts;
    if (order.courier_name) {
      courierSelect.value = order.courier_name;
    }
  }

  recalculateMeasureTotals();
  if (typeof refreshAllIcons === 'function') refreshAllIcons();
}

function renderMeasureRowHtml({ num, name, unit, price, len, wid, qty, defects }) {
  const isSqm = unit === 'м²' || unit === 'м2' || unit === 'm2' || unit === 'кв.м';
  const isMeter = unit === 'метр' || unit === 'м' || unit === 'пог.м';
  const isPiece = !isSqm && !isMeter;

  let typeIcon = '🧶';
  let badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  let badgeText = 'Ковер (м²)';

  if (isPiece) {
    typeIcon = '🛏️';
    badgeClass = 'bg-purple-100 text-purple-800 border border-purple-200';
    badgeText = `Штучный (${unit || 'шт'})`;
  } else if (isMeter) {
    typeIcon = '📏';
    badgeClass = 'bg-sky-100 text-sky-800 border border-sky-200';
    badgeText = 'Погон. метр';
  }

  const serviceOptions = allServices && allServices.length > 0
    ? allServices.map(s => {
        const isSel = (s.name.toLowerCase() === String(name || '').toLowerCase()) || 
                      (String(name || '').toLowerCase().startsWith(s.name.toLowerCase())) ||
                      (s.unit === unit && s.price === price);
        return `<option value="${escapeHtml(s.name)}" data-price="${s.price}" data-unit="${s.unit}" ${isSel ? 'selected' : ''}>${escapeHtml(s.name)} (${s.price.toLocaleString()} сум / ${s.unit})</option>`;
      }).join('')
    : `
      <option value="Gilam Standart" data-price="14000" data-unit="м²" ${isSqm && price === 14000 ? 'selected' : ''}>Gilam Standart (14 000 сум / м²)</option>
      <option value="Gilam Srochna" data-price="20000" data-unit="м²" ${isSqm && price === 20000 ? 'selected' : ''}>Gilam Srochna (20 000 сум / м²)</option>
      <option value="Gilam No standart" data-price="25000" data-unit="м²" ${isSqm && price === 25000 ? 'selected' : ''}>Шёлк / Ручной (25 000 сум / м²)</option>
      <option value="Kurpa (Одеяло стеганое)" data-price="70000" data-unit="шт" ${isPiece && price === 70000 ? 'selected' : ''}>Kurpa (Одеяло стеганое - 70 000 сум / шт)</option>
      <option value="Adyol (1-спальный плед)" data-price="50000" data-unit="шт" ${isPiece && price === 50000 ? 'selected' : ''}>Adyol (1-спальный плед - 50 000 сум / шт)</option>
      <option value="Adyol (2-спальный евро)" data-price="70000" data-unit="шт" ${isPiece && price === 70000 ? 'selected' : ''}>Adyol (2-спальный евро - 70 000 сум / шт)</option>
      <option value="Kurpacha" data-price="15000" data-unit="метр" ${isMeter ? 'selected' : ''}>Kurpacha (15 000 сум / метр)</option>
    `;

  let inputsHtml = '';
  if (isSqm) {
    const area = +((len || 0) * (wid || 0)).toFixed(2);
    const subtotal = Math.round(area * (price || 14000));
    inputsHtml = `
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs items-end">
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Длина (м)</label>
          <input type="text" inputmode="decimal" value="${len || 3.0}" class="measure-len w-full p-2 rounded-xl border border-emerald-deep/20 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9.,]/g, '').replace(',', '.'); recalculateMeasureTotals()">
        </div>
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Ширина (м)</label>
          <input type="text" inputmode="decimal" value="${wid || 2.0}" class="measure-wid w-full p-2 rounded-xl border border-emerald-deep/20 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9.,]/g, '').replace(',', '.'); recalculateMeasureTotals()">
        </div>
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Ставка (сум/м²)</label>
          <input type="text" inputmode="numeric" value="${price || 14000}" class="measure-tariff w-full p-2 rounded-xl border border-emerald-deep/20 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9]/g, ''); recalculateMeasureTotals()">
          <input type="hidden" class="measure-qty" value="1">
        </div>
        <div class="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl text-center">
          <div class="measure-row-calc-area text-[10px] text-emerald-700 font-bold">${area.toFixed(2)} м²</div>
          <div class="measure-row-calc-price text-xs font-black font-mono text-emerald-deep">${subtotal.toLocaleString('ru-RU')} сум</div>
        </div>
      </div>
    `;
  } else if (isMeter) {
    const subtotal = Math.round((len || 0) * (price || 15000));
    inputsHtml = `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs items-end">
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Длина (погон. м)</label>
          <input type="text" inputmode="decimal" value="${len || 2.0}" class="measure-len w-full p-2 rounded-xl border border-sky-400 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9.,]/g, '').replace(',', '.'); recalculateMeasureTotals()">
          <input type="hidden" class="measure-wid" value="0">
          <input type="hidden" class="measure-qty" value="1">
        </div>
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Ставка (сум/метр)</label>
          <input type="text" inputmode="numeric" value="${price || 15000}" class="measure-tariff w-full p-2 rounded-xl border border-emerald-deep/20 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9]/g, ''); recalculateMeasureTotals()">
        </div>
        <div class="bg-sky-500/10 border border-sky-500/20 p-2 rounded-xl text-center">
          <div class="measure-row-calc-area text-[10px] text-sky-700 font-bold">${len || 0} пог.м</div>
          <div class="measure-row-calc-price text-xs font-black font-mono text-emerald-deep">${subtotal.toLocaleString('ru-RU')} сум</div>
        </div>
      </div>
    `;
  } else {
    const subtotal = Math.round((qty || 1) * (price || 50000));
    inputsHtml = `
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs items-end">
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Количество (${unit || 'шт'})</label>
          <input type="number" step="1" min="1" max="99" value="${qty || 1}" class="measure-qty w-full p-2 rounded-xl border border-purple-400 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="recalculateMeasureTotals()">
          <input type="hidden" class="measure-len" value="0">
          <input type="hidden" class="measure-wid" value="0">
        </div>
        <div>
          <label class="text-[10px] text-charcoal-muted font-bold uppercase">Цена за 1 ${unit || 'шт'} (сум)</label>
          <input type="text" inputmode="numeric" value="${price || 50000}" class="measure-tariff w-full p-2 rounded-xl border border-emerald-deep/20 font-mono font-bold bg-white dark:bg-[#052129] text-emerald-deep" oninput="this.value = this.value.replace(/[^0-9]/g, ''); recalculateMeasureTotals()">
        </div>
        <div class="bg-purple-500/10 border border-purple-500/20 p-2 rounded-xl text-center">
          <div class="measure-row-calc-area text-[10px] text-purple-700 font-bold">${qty || 1} ${unit || 'шт'}</div>
          <div class="measure-row-calc-price text-xs font-black font-mono text-emerald-deep">${subtotal.toLocaleString('ru-RU')} сум</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="flex items-center justify-between gap-2 border-b border-emerald-deep/10 pb-2">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span class="text-base shrink-0">${typeIcon}</span>
        <span class="measure-pos-num font-mono font-bold text-xs text-amber-700 dark:text-amber-400 shrink-0">Позиция #${num}:</span>
        <input type="text" value="${escapeHtml(name)}" class="measure-name font-bold text-xs text-emerald-deep bg-white dark:bg-[#052129] border border-emerald-deep/20 rounded-lg px-2 py-1 flex-1 min-w-[120px]" placeholder="Название изделия" title="Нажмите для редактирования названия">
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass} shrink-0">${badgeText}</span>
      </div>
      <button type="button" onclick="removeMeasureRow(this)" class="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-100/50 rounded-lg transition shrink-0" title="Удалить позицию">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>

    <!-- Quick Service Switcher (Catalog Services) -->
    <div class="flex items-center gap-2 text-xs">
      <span class="text-[10px] text-charcoal-muted font-bold uppercase shrink-0">Услуга:</span>
      <select class="measure-service-quick-select flex-1 p-1.5 text-xs font-semibold rounded-xl border border-emerald-deep/20 bg-butter-surface dark:bg-[#052129] text-emerald-deep" onchange="onMeasureServiceChange(this)">
        <option value="">(Выбрать из каталога услуг)</option>
        ${serviceOptions}
      </select>
    </div>

    <!-- Inputs -->
    ${inputsHtml}

    <!-- Defect notes -->
    <div>
      <input type="text" placeholder="Дефекты изделия (пятна, запах, заломы, дыры, потёртости)..." value="${escapeHtml(defects)}" class="measure-defects w-full p-2 text-xs rounded-xl border border-emerald-deep/15 placeholder:text-charcoal-muted/60 bg-white dark:bg-[#052129]">
    </div>
  `;
}

function onMeasureServiceChange(select) {
  const row = select.closest('.measure-item-row');
  if (!row) return;

  const opt = select.options[select.selectedIndex];
  if (!opt || !select.value) return;

  const svcName = select.value;
  const svcPrice = parseFloat(opt.getAttribute('data-price')) || 14000;
  const svcUnit = opt.getAttribute('data-unit') || 'м²';

  const currentDefects = row.querySelector('.measure-defects')?.value || '';
  const currentLen = parseFloat(row.querySelector('.measure-len')?.value) || (svcUnit === 'м²' ? 3.0 : (svcUnit === 'метр' ? 2.0 : 0));
  const currentWid = parseFloat(row.querySelector('.measure-wid')?.value) || (svcUnit === 'м²' ? 2.0 : 0);
  const currentQty = parseInt(row.querySelector('.measure-qty')?.value, 10) || 1;

  const num = Array.from(row.parentNode.children).indexOf(row) + 1;
  const newName = `${svcName} #${num}`;

  row.setAttribute('data-unit', svcUnit);
  row.innerHTML = renderMeasureRowHtml({
    num,
    name: newName,
    unit: svcUnit,
    price: svcPrice,
    len: currentLen,
    wid: currentWid,
    qty: currentQty,
    defects: currentDefects
  });

  recalculateMeasureTotals();
  if (typeof refreshAllIcons === 'function') refreshAllIcons();
}

function removeMeasureRow(btn) {
  const row = btn.closest('.measure-item-row');
  if (!row) return;
  const container = document.getElementById('measure-items-list');
  if (container.querySelectorAll('.measure-item-row').length <= 1) {
    if (!confirm('В заказе должно быть минимум одно изделие. Удалить позицию?')) return;
  }
  row.remove();
  // Re-number remaining rows
  const remaining = container.querySelectorAll('.measure-item-row');
  remaining.forEach((r, idx) => {
    const numEl = r.querySelector('.measure-pos-num');
    if (numEl) numEl.textContent = `Позиция #${idx + 1}:`;
  });
  recalculateMeasureTotals();
  if (typeof refreshAllIcons === 'function') refreshAllIcons();
}

function addMeasureRow(preset = null, index = null, shouldScroll = true) {
  const container = document.getElementById('measure-items-list');
  const count = container.querySelectorAll('.measure-item-row').length + 1;
  const num = index || count;

  let defaultSvc = null;
  if (Array.isArray(allServices) && allServices.length > 0) {
    defaultSvc = allServices[0];
  } else {
    defaultSvc = { name: 'Gilam Standart', unit: 'м²', price: 14000 };
  }

  const meta = resolveItemServiceMeta(preset || defaultSvc);
  const unit = preset?.unit || meta.unit || defaultSvc.unit || 'м²';
  const price = Number(preset?.price) || meta.price || defaultSvc.price || 14000;
  
  let name = preset?.name;
  if (!name) {
    name = `${defaultSvc.name} #${num}`;
  } else if (!name.includes('#') && num > 1) {
    name = `${name} #${num}`;
  }

  const defects = preset?.defects || preset?.defect || preset?.note || '';
  const len = Number(preset?.length) > 0 ? preset.length : (unit === 'м²' ? 3.0 : (unit === 'метр' ? 2.0 : 0));
  const wid = Number(preset?.width) > 0 ? preset.width : (unit === 'м²' ? 2.0 : 0);
  const qty = Math.max(1, parseInt(preset?.qty || preset?.count, 10) || 1);

  const div = document.createElement('div');
  div.className = 'measure-item-row bg-white dark:bg-[#052129] p-3.5 rounded-2xl border border-emerald-deep/15 shadow-2xs space-y-2.5 transition';
  div.setAttribute('data-unit', unit);

  div.innerHTML = renderMeasureRowHtml({
    num,
    name,
    unit,
    price,
    len,
    wid,
    qty,
    defects
  });

  container.appendChild(div);
  recalculateMeasureTotals();
  if (typeof refreshAllIcons === 'function') refreshAllIcons();

  if (shouldScroll) {
    try {
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {}
  }
}

function recalculateMeasureTotals() {
  const rows = document.querySelectorAll('#measure-items-list .measure-item-row');
  let totalM2 = 0;
  let totalMeters = 0;
  let totalPieces = 0;
  let totalSum = 0;

  rows.forEach(r => {
    const unit = r.getAttribute('data-unit') || 'м²';
    const isSqm = unit === 'м²' || unit === 'м2' || unit === 'm2' || unit === 'кв.м';
    const isMeter = unit === 'метр' || unit === 'м' || unit === 'пог.м';
    const len = Math.max(0, parseFloat(String(r.querySelector('.measure-len')?.value || '').replace(',', '.')) || 0);
    const wid = Math.max(0, parseFloat(String(r.querySelector('.measure-wid')?.value || '').replace(',', '.')) || 0);
    const qty = Math.max(1, parseInt(String(r.querySelector('.measure-qty')?.value || '').replace(',', '.'), 10) || 1);
    const tariff = Math.max(0, parseFloat(String(r.querySelector('.measure-tariff')?.value || '').replace(/\s+/g, '').replace(',', '.')) || 0);

    const areaEl = r.querySelector('.measure-row-calc-area');
    const priceEl = r.querySelector('.measure-row-calc-price');
    const calcDisplay = r.querySelector('.measure-row-calc-preview');

    let rowCost = 0;

    if (isSqm) {
      const rowArea = +(len * wid).toFixed(2);
      rowCost = Math.round(rowArea * tariff);
      totalM2 += rowArea;
      if (areaEl) areaEl.textContent = `${rowArea.toFixed(2)} м²`;
      if (priceEl) priceEl.textContent = `${rowCost.toLocaleString('ru-RU')} сум`;
      if (calcDisplay) {
        calcDisplay.textContent = `${len}м × ${wid}м = ${rowArea} м² • ${rowCost.toLocaleString('ru-RU')} сум`;
      }
    } else if (isMeter) {
      totalMeters += len;
      rowCost = Math.round(len * tariff);
      if (areaEl) areaEl.textContent = `${len} пог.м`;
      if (priceEl) priceEl.textContent = `${rowCost.toLocaleString('ru-RU')} сум`;
      if (calcDisplay) {
        calcDisplay.textContent = `${len} пог.м • ${rowCost.toLocaleString('ru-RU')} сум`;
      }
    } else { // 'шт'
      totalPieces += qty;
      rowCost = Math.round(qty * tariff);
      if (areaEl) areaEl.textContent = `${qty} ${unit || 'шт'}`;
      if (priceEl) priceEl.textContent = `${rowCost.toLocaleString('ru-RU')} сум`;
      if (calcDisplay) {
        calcDisplay.textContent = `${qty} шт • ${rowCost.toLocaleString('ru-RU')} сум`;
      }
    }

    totalSum += rowCost;
  });

  const m2El = document.getElementById('measure-total-m2');
  const sumEl = document.getElementById('measure-total-sum');
  if (m2El) {
    const summaryParts = [];
    if (totalM2 > 0) summaryParts.push(`${totalM2.toFixed(2)} м²`);
    if (totalMeters > 0) summaryParts.push(`${totalMeters.toFixed(1)} пог.м`);
    if (totalPieces > 0 && totalM2 === 0 && totalMeters === 0) summaryParts.push(`${totalPieces} шт`);
    m2El.textContent = summaryParts.length > 0 ? summaryParts.join(' • ') : `${rows.length} поз.`;
  }
  if (sumEl) sumEl.textContent = totalSum.toLocaleString('ru-RU') + ' сум';
}

async function saveMeasurements(targetStage = 'ready') {
  const modal = document.getElementById('modal-measure');
  const orderId = modal ? modal.getAttribute('data-order-id') : null;
  if (!orderId) {
    alert('Ошибка: идентификатор заказа не найден.');
    return;
  }

  const rows = document.querySelectorAll('#measure-items-list .measure-item-row');
  if (rows.length === 0) {
    alert('Добавьте хотя бы одно изделие для сохранения!');
    return;
  }

  const readyBtn = document.getElementById('btn-save-measure-ready') || (modal ? modal.querySelector('button[onclick*="saveMeasurements(\'ready\')"]') : null);
  const draftBtn = document.getElementById('btn-save-measure-draft') || (modal ? modal.querySelector('button[onclick*="saveMeasurements(\'in_shop\')"]') : null);
  if (readyBtn) readyBtn.disabled = true;
  if (draftBtn) draftBtn.disabled = true;

  const carpets = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const nameInput = r.querySelector('.measure-name');
    const name = (nameInput ? nameInput.value.trim() : '') || `Изделие #${idx + 1}`;
    const unit = r.getAttribute('data-unit') || 'м²';
    const isSqm = unit === 'м²' || unit === 'м2' || unit === 'm2' || unit === 'кв.м';
    const isMeter = unit === 'метр' || unit === 'м' || unit === 'пог.м';
    const rawLen = r.querySelector('.measure-len')?.value ?? '0';
    const rawWid = r.querySelector('.measure-wid')?.value ?? '0';
    const rawQty = r.querySelector('.measure-qty')?.value ?? '1';
    const rawTariff = r.querySelector('.measure-tariff')?.value ?? '0';

    const len = parseFloat(String(rawLen).trim().replace(',', '.')) || 0;
    const wid = parseFloat(String(rawWid).trim().replace(',', '.')) || 0;
    const qty = Math.max(1, parseInt(String(rawQty).trim().replace(',', '.'), 10) || 1);
    const tariff = Math.max(0, parseFloat(String(rawTariff).trim().replace(/\s+/g, '').replace(',', '.')) || 0);
    const defects = r.querySelector('.measure-defects')?.value.trim() || '';

    if (isSqm) {
      if (len <= 0 || wid <= 0) {
        alert(`Длина и ширина для изделия "${name}" (Позиция #${idx + 1}) должны быть больше 0!`);
        if (readyBtn) readyBtn.disabled = false;
        if (draftBtn) draftBtn.disabled = false;
        return;
      }
      const area = +(len * wid).toFixed(2);
      carpets.push({
        name,
        unit: 'м²',
        length: len,
        width: wid,
        area,
        qty: 1,
        price: tariff,
        total: Math.round(area * tariff),
        defects
      });
    } else if (isMeter) {
      if (len <= 0) {
        alert(`Длина (погон. метры) для изделия "${name}" должна быть больше 0!`);
        if (readyBtn) readyBtn.disabled = false;
        if (draftBtn) draftBtn.disabled = false;
        return;
      }
      carpets.push({
        name,
        unit: 'метр',
        length: len,
        width: 0,
        area: len,
        qty: 1,
        price: tariff,
        total: Math.round(len * tariff),
        defects
      });
    } else { // 'шт'
      carpets.push({
        name,
        unit: 'шт',
        length: 0,
        width: 0,
        area: 1,
        qty,
        price: tariff,
        total: Math.round(qty * tariff),
        defects
      });
    }
  }

  const courierSelect = document.getElementById('measure-courier-select');
  const courierName = courierSelect ? courierSelect.value.trim() : '';

  try {
    const res = await fetch(`/api/orders/${orderId}/measurements`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carpets,
        stage: targetStage,
        courier_name: courierName || undefined,
        washer_name: (currentUser && currentUser.name) ? currentUser.name : 'Мастер цеха'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal('modal-measure');
      await loadInitialData();
      if (currentEditingOrder && String(currentEditingOrder.id) === String(orderId)) {
        openEditOrderModal(orderId);
      }
      const courierNote = data.courier_name ? ` (курьер: ${data.courier_name})` : '';
      const smsNote = data.sms_simulated
        ? '\n\n⚠️ Внимание: SMS клиенту не отправлено на телефон (Eskiz.uz токен не настроен в Настройках CRM).'
        : (data.sms_sent ? '\n\n📲 Клиенту успешно отправлено SMS-оповещение!' : '');
      if (targetStage === 'ready') {
        alert(`✅ Заказ #${orderId}: замеры сохранены (${carpets.length} изд.)!\n🚚 Заказ переведен в статус "3. Готов к доставке"${courierNote}.${smsNote}`);
      } else {
        alert(`💾 Заказ #${orderId}: замеры сохранены (${carpets.length} изд., ${data.total_m2 || 0} м², ${(data.total_price || 0).toLocaleString()} сум).\nСтатус: "2. В цеху"${smsNote}`);
      }
    } else {
      alert(data.error || 'Ошибка при сохранении изделий');
    }
  } catch (e) {
    alert('Ошибка при сохранении изделий: ' + e.message);
  } finally {
    if (readyBtn) readyBtn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
  }
}

// ================= THERMAL RECEIPT (80MM) & QR MODAL =================

function printReceiptForCurrentOrder() {
  if (currentEditingOrder) printOrderReceipt(currentEditingOrder.id);
}

function printOrderReceipt(orderId) {
  const order = activeOrders.find(o => o.id === orderId);
  if (!order) return;

  const totalSum = order.total_price || 0;
  const paidSum = order.paid ? totalSum : (order.paid_amount || 0);
  const remaining = Math.max(0, totalSum - paidSum);

  const items = order.carpets && order.carpets.length > 0 ? order.carpets : [{ name: 'Ковры', unit: 'м²', qty: 1, total: totalSum }];

  const html = `
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.35; color: #000; width: 76mm; margin: 0 auto;">
      <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px;">
        <div style="font-size: 18px; font-weight: 900; letter-spacing: 1px;">COSMO CRM</div>
        <div style="font-size: 10px; font-weight: 700;">ПРОФЕССИОНАЛЬНАЯ СТИРКА КОВРОВ</div>
        <div style="font-size: 9px; margin-top: 2px;">Тел: +998 90 123-45-67 • Самарканд</div>
      </div>

      <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 13px; margin-bottom: 4px;">
        <span>КВИТАНЦИЯ-НАКЛАДНАЯ</span>
        <span>#${order.id}</span>
      </div>
      <div style="font-size: 10px; margin-bottom: 6px;">Дата: ${order.pickup_date || order.created_at}</div>

      <div style="border-top: 1px dashed #000; padding-top: 4px; margin-bottom: 6px; font-size: 10px;">
        <div><b>Клиент:</b> ${escapeHtml(order.client_name)}</div>
        <div><b>Тел:</b> ${escapeHtml(order.client_phone)}</div>
        <div><b>Адрес:</b> ${escapeHtml(order.client_address)}</div>
        <div><b>Экипаж / Курьер:</b> ${escapeHtml(order.courier_name || 'Дамир')}</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 6px;">
        <thead>
          <tr style="border-bottom: 1px solid #000; font-weight: bold;">
            <th style="text-align: left; padding: 2px 0;">Наименование</th>
            <th style="text-align: center; padding: 2px 0;">Размер</th>
            <th style="text-align: right; padding: 2px 0;">Сумма</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => {
            const area = it.area || (it.length && it.width ? +(it.length * it.width).toFixed(1) : 0);
            const sizeDisplay = it.unit === 'м²' ? `${area}м²` : `${it.qty || 1}${it.unit || 'шт'}`;
            const sumDisplay = (it.total || (it.price * (area || 1)) || 0).toLocaleString();
            return `
            <tr>
              <td style="padding: 2px 0;">
                ${escapeHtml(it.name)}
                ${it.defects ? `<div style="font-size: 8px; color: #555; font-style: italic;">Дефекты: ${escapeHtml(it.defects)}</div>` : ''}
              </td>
              <td style="text-align: center; padding: 2px 0;">${sizeDisplay}</td>
              <td style="text-align: right; padding: 2px 0;">${sumDisplay}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>

      <div style="border-top: 1.5px solid #000; padding-top: 4px; font-size: 11px;">
        <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 13px;">
          <span>ИТОГО К ОПЛАТЕ:</span>
          <span>${totalSum.toLocaleString()} сум</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
          <span>Оплачено:</span>
          <span>${paidSum.toLocaleString()} сум</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-weight: bold; margin-top: 2px;">
          <span>Остаток долга:</span>
          <span>${remaining.toLocaleString()} сум</span>
        </div>
      </div>

      <div style="text-align: center; margin-top: 10px; padding-top: 6px; border-top: 1px dashed #000;">
        <div style="font-size: 9px; font-weight: bold;">ОНЛАЙН ТРЕКИНГ ЗАКАЗА:</div>
        <div id="receipt-qr-${order.id}" style="display: flex; justify-content: center; margin: 4px 0;"></div>
        <div style="font-size: 8px;">Наведите камеру смартфона для отслеживания</div>
      </div>

      <div style="font-size: 8px; text-align: center; margin-top: 8px; color: #444; border-top: 1px solid #000; padding-top: 4px;">
        Спасибо за доверие! Ковры проходят сушку в термокамере и антибактериальную обработку.
      </div>
    </div>
  `;

  const container = document.getElementById('printable-receipt');
  container.innerHTML = html;
  container.classList.remove('hidden');

  // Render QR inside receipt
  const qrContainer = document.getElementById(`receipt-qr-${order.id}`);
  if (qrContainer && typeof QRCode !== 'undefined') {
    const trackUrl = `${window.location.origin}/#track-${order.id}`;
    new QRCode(qrContainer, {
      text: trackUrl,
      width: 70,
      height: 70
    });
  }

  setTimeout(() => {
    window.print();
    container.classList.add('hidden');
  }, 250);
}

function showQrForCurrentOrder() {
  if (currentEditingOrder) showQrForOrderId(currentEditingOrder.id);
}

function showQrForOrderId(orderId) {
  const container = document.getElementById('qr-code-canvas-container');
  container.innerHTML = '';
  const trackUrl = `${window.location.origin}/#track-${orderId}`;

  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: trackUrl,
      width: 180,
      height: 180,
      colorDark: '#04222B',
      colorLight: '#ffffff'
    });
  }

  document.getElementById('qr-tracking-url-text').textContent = trackUrl;
  document.getElementById('modal-qr').classList.remove('hidden');
}

function copyQrTrackingUrl() {
  const text = document.getElementById('qr-tracking-url-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert('Ссылка скопирована в буфер обмена!');
  });
}

// ================= PUBLIC TRACKING VIEW FOR CLIENTS =================

async function showPublicTrackingScreen(orderId) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('public-tracking-screen').classList.remove('hidden');

  document.getElementById('track-order-id-badge').textContent = '#' + orderId;

  try {
    const res = await fetch(`/api/orders/${orderId}`);
    if (!res.ok) throw new Error('Заказ не найден');
    const order = await res.json();

    document.getElementById('track-client-name').textContent = order.client_name;
    document.getElementById('track-client-address').textContent = order.client_address + (order.landmark ? ` (${order.landmark})` : '');
    document.getElementById('track-courier-name').textContent = order.courier_name || 'Экипаж BAROKOT';
    document.getElementById('track-total-price').textContent = (order.total_price || 0).toLocaleString() + ' сум';

    const payBadge = document.getElementById('track-payment-badge');
    if (order.paid) {
      payBadge.textContent = 'Оплачено';
      payBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
    } else {
      payBadge.textContent = 'К оплате';
      payBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300';
    }

    // Carpets items
    const itemsList = document.getElementById('track-items-list');
    const carpets = order.carpets || [];
    itemsList.innerHTML = carpets.map((c, i) => {
      const area = c.area || (c.length && c.width ? +(c.length * c.width).toFixed(1) : null);
      const sizeStr = c.unit === 'м²' ? (area !== null ? `${area} м²` : '—') : `${c.qty || 1} ${c.unit || 'шт'}`;
      return `
        <div class="border-b border-emerald-deep/10 pb-1.5 mb-1.5 last:border-0 last:pb-0 last:mb-0">
          <div class="flex justify-between font-medium">
            <span>${i + 1}. ${escapeHtml(c.name || 'Ковер')} (${sizeStr})</span>
            <span class="font-mono font-bold">${(c.total || 0).toLocaleString()} сум</span>
          </div>
          ${c.defects ? `<div class="text-[11px] text-amber-700 italic mt-0.5">⚠️ Дефекты изделия: ${escapeHtml(c.defects)}</div>` : ''}
        </div>
      `;
    }).join('');

    // Only show review box if order was actually delivered
    const reviewBox = document.getElementById('track-review-box');
    if (reviewBox) {
      if (order.stage === 'delivered') {
        reviewBox.classList.remove('hidden');
      } else {
        reviewBox.classList.add('hidden');
      }
    }

    // Stepper logic
    updatePublicStepper(order.stage);
  } catch (e) {
    document.getElementById('track-status-description').textContent = '⚠️ Информация о заказе временно недоступна. Пожалуйста, позвоните оператору.';
  }
}

function updatePublicStepper(stage) {
  const progressBar = document.getElementById('track-progress-bar');
  const desc = document.getElementById('track-status-description');

  const dot1 = document.getElementById('step-dot-1');
  const dot2 = document.getElementById('step-dot-2');
  const dot3 = document.getElementById('step-dot-3');
  const dot4 = document.getElementById('step-dot-4');

  const resetDot = (dot, num) => {
    dot.className = 'w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-xs font-bold ring-4 ring-butter-surface shadow';
    dot.textContent = num;
  };
  const activeDot = (dot) => {
    dot.className = 'w-8 h-8 rounded-full bg-emerald-deep text-butter flex items-center justify-center text-xs font-bold ring-4 ring-butter-surface shadow';
    dot.textContent = '✓';
  };

  resetDot(dot2, '2');
  resetDot(dot3, '3');
  resetDot(dot4, '4');

  if (stage === 'cancelled') {
    progressBar.style.width = '0%';
    resetDot(dot1, '✕');
    resetDot(dot2, '✕');
    resetDot(dot3, '✕');
    resetDot(dot4, '✕');
    desc.innerHTML = '<span class="text-rose-700 font-bold">❌ Данный заказ был отменен. Пожалуйста, свяжитесь с оператором цеха.</span>';
  } else if (stage === 'pickup') {
    progressBar.style.width = '25%';
    activeDot(dot1);
    desc.textContent = 'Заявка принята! Курьер направляется к вам на забор ковров.';
  } else if (stage === 'in_shop' || stage === 'dusting' || stage === 'washing' || stage === 'drying') {
    progressBar.style.width = '50%';
    activeDot(dot1);
    activeDot(dot2);
    desc.textContent = 'Ковры находятся в цеху: профессиональная стирка, дезинфекция и точные замеры изделий мастером.';
  } else if (stage === 'ready' || stage === 'delivery') {
    progressBar.style.width = '75%';
    activeDot(dot1);
    activeDot(dot2);
    activeDot(dot3);
    desc.textContent = 'Ковры бережно постираны и готовы к доставке! Экипаж курьера доставляет заказ по вашему адресу.';
  } else if (stage === 'delivered') {
    progressBar.style.width = '100%';
    activeDot(dot1);
    activeDot(dot2);
    activeDot(dot3);
    activeDot(dot4);
    desc.textContent = 'Заказ успешно доставлен и вручен клиенту. Спасибо за доверие компании BAROKOT!';
  }
}

function setPublicRating(stars) {
  publicRatingValue = stars;
  const buttons = document.querySelectorAll('#star-rating-container button');
  buttons.forEach((btn, idx) => {
    btn.style.opacity = idx < stars ? '1' : '0.3';
  });
}

async function submitPublicReview() {
  const urlParams = new URLSearchParams(window.location.search);
  const trackId = urlParams.get('track') || (window.location.hash.startsWith('#track-') ? window.location.hash.replace('#track-', '') : 'BRK-1048');
  const reviewText = document.getElementById('public-review-text').value.trim();

  try {
    await fetch(`/api/orders/${trackId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: publicRatingValue, review_text: reviewText })
    });
    document.getElementById('review-sent-msg').classList.remove('hidden');
    document.getElementById('public-review-text').disabled = true;
  } catch (e) {
    alert('Ошибка отправки отзыва');
  }
}

// ================= HELPERS & MODAL UTILITIES =================

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
}

function openNewClientModal() {
  document.getElementById('modal-client').classList.remove('hidden');
}

async function handleClientSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('client-modal-name').value.trim();
  const phone = document.getElementById('client-modal-phone').value.trim();
  const address = document.getElementById('client-modal-address').value.trim();
  const district = document.getElementById('client-modal-district').value.trim();
  const tier = document.getElementById('client-modal-tier').value;
  const notes = document.getElementById('client-modal-notes').value.trim();

  try {
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, address, district, tier, notes })
    });
    if (res.ok) {
      closeModal('modal-client');
      await loadInitialData();
      alert('Клиент успешно зарегистрирован в базе!');
    }
  } catch (err) {
    alert('Ошибка сохранения клиента');
  }
}

function exportOrdersCSV() {
  if (activeOrders.length === 0) {
    alert('Список заказов пуст!');
    return;
  }
  let csv = '\uFEFFID;Клиент;Телефон;Адрес;Район;Этап;Площадь_м2;Сумма;Оплачено;Курьер\n';
  activeOrders.forEach(o => {
    csv += `${o.id};"${o.client_name}";${o.client_phone};"${o.client_address}";"${o.district}";${o.stage};${o.total_m2};${o.total_price};${o.paid ? 'Да' : 'Нет'};"${o.courier_name}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cosmo_orders_${Date.now()}.csv`;
  a.click();
}

function getStageBadge(stage) {
  const norm = normalizeStage(stage);
  const map = {
    pickup: '<span class="bg-[#E2F4F0] text-[#0A3D4A] border border-[#98D8D0] text-[10px] font-bold px-2 py-0.5 rounded-full">1. К забору</span>',
    in_shop: '<span class="bg-[#C8E6E2] text-[#04222B] border border-[#4FB8B4] text-[10px] font-bold px-2 py-0.5 rounded-full">2. В цеху</span>',
    ready: '<span class="bg-[#98D8D0]/40 text-[#04222B] border border-[#1D8B94] text-[10px] font-bold px-2 py-0.5 rounded-full">3. Готов к доставке</span>',
    delivered: '<span class="bg-[#1D8B94] text-white border border-[#10606F] text-[10px] font-bold px-2 py-0.5 rounded-full">4. Доставлен</span>',
    cancelled: '<span class="bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold px-2 py-0.5 rounded-full">Отменен</span>'
  };
  return map[norm] || map.pickup;
}

function getStageText(stage) {
  const norm = normalizeStage(stage);
  const map = {
    pickup: '1. К забору',
    in_shop: '2. В цеху',
    ready: '3. Готов к доставке',
    delivered: '4. Доставлен',
    cancelled: 'Отменен'
  };
  return map[norm] || stage;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================= GLOBAL MODAL ESCAPE & BACKDROP HANDLERS =================
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('[id^="modal-"]:not(.hidden)').forEach(modal => {
      modal.classList.add('hidden');
    });
    const drawer = document.getElementById('notification-drawer');
    if (drawer && !drawer.classList.contains('translate-x-full')) {
      toggleNotificationDrawer();
    }
  }
});

document.addEventListener('click', (e) => {
  if (e.target && typeof e.target.id === 'string' && e.target.id.startsWith('modal-') && !e.target.classList.contains('hidden')) {
    e.target.classList.add('hidden');
  }
});

// ================= VIEW 1.5: ANALYTICS & CHARTS MODULE =================

let currentAnalyticsPeriod = 'all';

function setAnalyticsPeriod(period) {
  currentAnalyticsPeriod = period;
  ['today', 'week', 'month', 'all'].forEach(p => {
    const btn = document.getElementById(`btn-analytics-${p}`);
    if (btn) {
      if (p === period) {
        btn.className = 'px-3 py-1.5 rounded-lg bg-emerald-deep text-butter shadow transition';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg text-emerald-deep hover:bg-black/5 transition';
      }
    }
  });
  renderAnalytics(period);
}

function renderAnalytics(period = currentAnalyticsPeriod) {
  const totalRevEl = document.getElementById('analytics-total-revenue');
  if (!totalRevEl) return;

  const now = new Date();
  const todayStr = toIsoDateSafe(now) || now.toISOString().split('T')[0];

  let filtered = activeOrders.filter(o => {
    if (period === 'today') {
      const orderDate = toIsoDateSafe(o.created_at);
      return orderDate === todayStr;
    } else if (period === 'week') {
      const d = parseDateSafe(o.created_at);
      const created = d ? d.getTime() : Date.now();
      return (Date.now() - created) <= 7 * 24 * 60 * 60 * 1000;
    } else if (period === 'month') {
      const d = parseDateSafe(o.created_at);
      const created = d ? d.getTime() : Date.now();
      return (Date.now() - created) <= 30 * 24 * 60 * 60 * 1000;
    }
    return true;
  });

  // Calculate totals
  let totalRevenue = 0;
  let paidRevenue = 0;
  let totalM2 = 0;
  let totalItems = 0;
  let completedOrders = 0;
  let inProgressOrders = 0;

  filtered.forEach(o => {
    const sum = Number(o.total_price) || 0;
    const paid = o.paid ? sum : (Number(o.paid_amount) || 0);
    const m2 = parseFloat(o.total_m2) || 0;

    totalRevenue += sum;
    paidRevenue += paid;
    totalM2 += m2;

    let itemsCount = 1;
    if (o.carpets) {
      try {
        const parsed = typeof o.carpets === 'string' ? JSON.parse(o.carpets) : o.carpets;
        if (Array.isArray(parsed)) itemsCount = parsed.length || 1;
      } catch (e) {}
    }
    totalItems += itemsCount;

    if (o.stage === 'delivered') {
      completedOrders++;
    } else if (o.stage !== 'cancelled') {
      inProgressOrders++;
    }
  });

  const totalOrders = filtered.length;
  const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  totalRevEl.textContent = `${totalRevenue.toLocaleString()} сум`;
  const paidEl = document.getElementById('analytics-paid-revenue');
  if (paidEl) paidEl.textContent = paidRevenue.toLocaleString();

  const avgEl = document.getElementById('analytics-avg-check');
  if (avgEl) avgEl.textContent = `${avgCheck.toLocaleString()} сум`;
  const countEl = document.getElementById('analytics-total-orders-count');
  if (countEl) countEl.textContent = totalOrders;

  const m2El = document.getElementById('analytics-total-m2');
  if (m2El) m2El.textContent = `${totalM2.toFixed(1)} м²`;
  const itemsEl = document.getElementById('analytics-total-items-count');
  if (itemsEl) itemsEl.textContent = totalItems;

  const compEl = document.getElementById('analytics-completed-orders');
  if (compEl) compEl.textContent = completedOrders;
  const inProgEl = document.getElementById('analytics-in-progress-orders');
  if (inProgEl) inProgEl.textContent = inProgressOrders;

  // Day of Week Bar Chart
  const daysMap = [
    { name: 'Пн', sum: 0, count: 0 },
    { name: 'Вт', sum: 0, count: 0 },
    { name: 'Ср', sum: 0, count: 0 },
    { name: 'Чт', sum: 0, count: 0 },
    { name: 'Пт', sum: 0, count: 0 },
    { name: 'Сб', sum: 0, count: 0 },
    { name: 'Вс', sum: 0, count: 0 }
  ];

  filtered.forEach(o => {
    const d = parseDateSafe(o.created_at) || new Date();
    let dayIdx = d.getDay() - 1;
    if (dayIdx === -1) dayIdx = 6;
    if (dayIdx >= 0 && dayIdx < 7) {
      daysMap[dayIdx].sum += (Number(o.total_price) || 0);
      daysMap[dayIdx].count += 1;
    }
  });

  const maxDaySum = Math.max(...daysMap.map(d => d.sum), 1);
  const maxLabel = document.getElementById('analytics-chart-max-label');
  if (maxLabel) maxLabel.textContent = `Макс: ${maxDaySum.toLocaleString()} сум`;

  const barsContainer = document.getElementById('analytics-days-bars');
  if (barsContainer) {
    barsContainer.innerHTML = daysMap.map(d => {
      const pct = Math.max(12, Math.round((d.sum / maxDaySum) * 100));
      return `
        <div class="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer" title="${d.name}: ${d.sum.toLocaleString()} сум (${d.count} зак.)">
          <div class="text-[10px] font-mono text-emerald-deep font-bold mb-1 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">${(d.sum / 1000).toFixed(0)}k</div>
          <div class="w-full bg-emerald-deep/15 group-hover:bg-emerald-deep rounded-t-xl transition-all duration-300 relative flex items-end justify-center" style="height: ${pct}%;">
            <div class="w-full bg-emerald-deep rounded-t-xl h-full shadow-inner opacity-90 group-hover:opacity-100"></div>
          </div>
          <div class="text-[11px] font-bold text-emerald-deep mt-2">${d.name}</div>
        </div>
      `;
    }).join('');
  }

  // Districts Breakdown
  const districtsMap = {};
  filtered.forEach(o => {
    const dist = o.district || 'Сиёб';
    if (!districtsMap[dist]) districtsMap[dist] = { count: 0, m2: 0, sum: 0 };
    districtsMap[dist].count += 1;
    districtsMap[dist].m2 += parseFloat(o.total_m2) || 0;
    districtsMap[dist].sum += (Number(o.total_price) || 0);
  });

  const districtsArr = Object.entries(districtsMap).map(([name, data]) => ({ name, ...data }));
  districtsArr.sort((a, b) => b.sum - a.sum);

  const districtsContainer = document.getElementById('analytics-districts-list');
  if (districtsContainer) {
    if (districtsArr.length === 0) {
      districtsContainer.innerHTML = '<div class="text-center py-6 text-charcoal-muted text-xs italic">Нет данных за выбранный период</div>';
    } else {
      districtsContainer.innerHTML = districtsArr.map(d => {
        const share = totalRevenue > 0 ? Math.round((d.sum / totalRevenue) * 100) : 0;
        return `
          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-emerald-deep flex items-center gap-1">
                <span>📍</span>
                <span>${escapeHtml(d.name)}</span>
              </span>
              <span class="font-mono text-charcoal font-semibold">${d.sum.toLocaleString()} сум <span class="text-charcoal-muted">(${share}%)</span></span>
            </div>
            <div class="w-full h-2 bg-emerald-deep/10 rounded-full overflow-hidden flex">
              <div class="bg-emerald-deep h-full rounded-full transition-all duration-500" style="width: ${Math.max(5, share)}%;"></div>
            </div>
            <div class="text-[10px] text-charcoal-muted flex justify-between">
              <span>${d.count} заказов</span>
              <span>${d.m2.toFixed(1)} м²</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Couriers Leaderboard
  const couriersMap = {};
  filtered.forEach(o => {
    const courier = o.courier_name || 'Не назначен';
    if (!couriersMap[courier]) couriersMap[courier] = { totalOrders: 0, deliveredOrders: 0, sum: 0 };
    couriersMap[courier].totalOrders += 1;
    if (o.stage === 'delivered') couriersMap[courier].deliveredOrders += 1;
    couriersMap[courier].sum += (Number(o.total_price) || 0);
  });

  const couriersArr = Object.entries(couriersMap).map(([name, data]) => ({ name, ...data }));
  couriersArr.sort((a, b) => b.sum - a.sum);

  const couriersContainer = document.getElementById('analytics-couriers-list');
  if (couriersContainer) {
    if (couriersArr.length === 0) {
      couriersContainer.innerHTML = '<div class="text-center py-6 text-charcoal-muted text-xs italic">Нет данных за выбранный период</div>';
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      couriersContainer.innerHTML = couriersArr.map((c, idx) => `
        <div class="bg-white p-2.5 rounded-xl border border-emerald-deep/15 flex items-center justify-between shadow-xs">
          <div class="flex items-center gap-2">
            <span class="text-base">${medals[idx] || (idx + 1 + '.')}</span>
            <div>
              <div class="font-bold text-xs text-emerald-deep">${escapeHtml(c.name)}</div>
              <div class="text-[10px] text-charcoal-muted">Выполнено: <b>${c.deliveredOrders}</b> из ${c.totalOrders} зак.</div>
            </div>
          </div>
          <div class="text-right">
            <div class="font-mono font-bold text-xs text-emerald-deep">${c.sum.toLocaleString()} сум</div>
            <div class="text-[10px] text-emerald-700 font-semibold">${c.totalOrders > 0 ? Math.round((c.deliveredOrders / c.totalOrders) * 100) : 0}% успех</div>
          </div>
        </div>
      `).join('');
    }
  }

  // Services Breakdown
  const servicesMap = {};
  filtered.forEach(o => {
    if (o.carpets) {
      let carpets = [];
      try {
        carpets = typeof o.carpets === 'string' ? JSON.parse(o.carpets) : o.carpets;
      } catch (e) {}
      if (Array.isArray(carpets)) {
        carpets.forEach(c => {
          const sName = c.name || 'Ковер (Стандарт)';
          if (!servicesMap[sName]) servicesMap[sName] = { count: 0, m2: 0, sum: 0 };
          const area = c.area || (c.length && c.width ? +(c.length * c.width).toFixed(2) : 1);
          const total = c.total || Math.round(area * (c.price || 14000));
          servicesMap[sName].count += (c.qty || c.count || 1);
          servicesMap[sName].m2 += (c.unit === 'м²' ? area : 0);
          servicesMap[sName].sum += total;
        });
      }
    }
  });

  const servicesArr = Object.entries(servicesMap).map(([name, data]) => ({ name, ...data }));
  servicesArr.sort((a, b) => b.sum - a.sum);

  const servicesContainer = document.getElementById('analytics-services-list');
  if (servicesContainer) {
    if (servicesArr.length === 0) {
      servicesContainer.innerHTML = '<div class="text-center py-6 text-charcoal-muted text-xs italic">Нет данных за выбранный период</div>';
    } else {
      servicesContainer.innerHTML = servicesArr.map(s => {
        const share = totalRevenue > 0 ? Math.round((s.sum / totalRevenue) * 100) : 0;
        return `
          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-emerald-deep">${escapeHtml(s.name)}</span>
              <span class="font-mono text-charcoal font-semibold">${s.sum.toLocaleString()} сум</span>
            </div>
            <div class="w-full h-1.5 bg-emerald-deep/10 rounded-full overflow-hidden flex">
              <div class="bg-gradient-to-r from-[#10606F] to-[#1D8B94] h-full rounded-full" style="width: ${Math.max(4, share)}%;"></div>
            </div>
            <div class="text-[10px] text-charcoal-muted flex justify-between">
              <span>${s.count} шт.</span>
              <span>${s.m2 > 0 ? s.m2.toFixed(1) + ' м²' : ''}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// ================= VIEW 2.5: ARCHIVE MODULE =================

function renderArchive() {
  const tbody = document.getElementById('archive-table-body');
  if (!tbody) return;

  const searchInput = document.getElementById('archive-search-input');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const dateFrom = document.getElementById('archive-date-from')?.value;
  const dateTo = document.getElementById('archive-date-to')?.value;

  // Filter for delivered (archived) orders
  let archiveOrders = activeOrders.filter(o => o.stage === 'delivered');

  if (query) {
    archiveOrders = archiveOrders.filter(o => {
      const matchId = String(o.id || '').toLowerCase().includes(query);
      const matchName = String(o.client_name || '').toLowerCase().includes(query);
      const matchPhone = String(o.client_phone || '').toLowerCase().includes(query);
      const matchAddr = String(o.client_address || '').toLowerCase().includes(query);
      const matchCourier = String(o.courier_name || '').toLowerCase().includes(query);
      return matchId || matchName || matchPhone || matchAddr || matchCourier;
    });
  }

  if (dateFrom) {
    archiveOrders = archiveOrders.filter(o => {
      const dateStr = toIsoDateSafe(o.delivery_date || o.created_at);
      return dateStr ? dateStr >= dateFrom : false;
    });
  }

  if (dateTo) {
    archiveOrders = archiveOrders.filter(o => {
      const dateStr = toIsoDateSafe(o.delivery_date || o.created_at);
      return dateStr ? dateStr <= dateTo : false;
    });
  }

  // Calculate statistics
  let totalRevenue = 0;
  let totalM2 = 0;
  archiveOrders.forEach(o => {
    totalRevenue += (Number(o.total_price) || 0);
    totalM2 += (parseFloat(o.total_m2) || 0);
  });

  const countEl = document.getElementById('archive-stat-count');
  const revEl = document.getElementById('archive-stat-revenue');
  const m2El = document.getElementById('archive-stat-m2');
  const avgEl = document.getElementById('archive-stat-avg');

  if (countEl) countEl.textContent = archiveOrders.length;
  if (revEl) revEl.textContent = `${totalRevenue.toLocaleString()} сум`;
  if (m2El) m2El.textContent = `${totalM2.toFixed(1)} м²`;
  if (avgEl) {
    const avg = archiveOrders.length > 0 ? Math.round(totalRevenue / archiveOrders.length) : 0;
    avgEl.textContent = `${avg.toLocaleString()} сум`;
  }

  if (archiveOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-charcoal-muted italic">
          <div class="text-2xl mb-1">📁</div>
          В архиве нет выполненных заказов по указанным критериям
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = archiveOrders.map(o => {
    const carpets = o.carpets ? (typeof o.carpets === 'string' ? JSON.parse(o.carpets) : o.carpets) : [];
    const carpetsCount = carpets.length > 0 ? carpets.length : 1;
    const paidBadge = o.paid
      ? '<span class="text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-bold">● Оплачен</span>'
      : '<span class="text-rose-800 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded-full text-[10px] font-bold">○ Долг</span>';

    const deliveryDisplay = o.delivery_date || (o.created_at ? formatDateSafe(o.created_at) : '—');

    return `
      <tr class="hover:bg-butter-surface/40 transition">
        <td class="py-3 px-4">
          <button type="button" onclick="openEditOrderModal('${o.id}')" class="font-mono font-bold text-emerald-deep hover:underline text-xs">
            #${escapeHtml(o.id)}
          </button>
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-emerald-deep">${escapeHtml(o.client_name)}</div>
          <div class="text-[11px] text-charcoal-muted font-mono">${escapeHtml(o.client_phone)}</div>
        </td>
        <td class="py-3 px-4">
          <div class="text-xs">${escapeHtml(o.client_address)}</div>
          <div class="text-[10px] font-bold text-emerald-deep">${escapeHtml(o.district || 'Самарканд')}</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-emerald-deep">${o.total_m2 ? o.total_m2 + ' м²' : '—'}</div>
          <div class="text-[10px] text-charcoal-muted">${carpetsCount} шт.</div>
        </td>
        <td class="py-3 px-4">
          <div class="font-mono font-bold text-emerald-deep">${(o.total_price || 0).toLocaleString()} сум</div>
          <div class="mt-0.5">${paidBadge}</div>
        </td>
        <td class="py-3 px-4 font-mono text-xs text-charcoal-muted">
          ${escapeHtml(deliveryDisplay)}
        </td>
        <td class="py-3 px-4 font-semibold text-xs text-emerald-deep">
          ${escapeHtml(o.courier_name || '—')}
        </td>
        <td class="py-3 px-4 text-right whitespace-nowrap">
          <div class="flex items-center justify-end gap-1">
            <button type="button" onclick="printOrderReceipt('${o.id}')" class="p-1.5 rounded-lg bg-emerald-deep/5 hover:bg-emerald-deep/15 text-emerald-deep transition" title="Печать квитанции 80мм">
              <i data-lucide="printer" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" onclick="showQrForOrderId('${o.id}')" class="p-1.5 rounded-lg bg-emerald-deep/5 hover:bg-emerald-deep/15 text-emerald-deep transition" title="QR код трекинга">
              <i data-lucide="qr-code" class="w-3.5 h-3.5"></i>
            </button>
            <button type="button" onclick="restoreArchivedOrder('${o.id}')" class="py-1 px-2.5 rounded-lg bg-white border border-emerald-deep/20 hover:bg-butter text-emerald-deep font-bold text-xs transition" title="Вернуть заказ в работу">
              Вернуть
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function resetArchiveDates() {
  const searchInput = document.getElementById('archive-search-input');
  const dateFrom = document.getElementById('archive-date-from');
  const dateTo = document.getElementById('archive-date-to');
  if (searchInput) searchInput.value = '';
  if (dateFrom) dateFrom.value = '';
  if (dateTo) dateTo.value = '';
  renderArchive();
}

function exportArchiveCSV() {
  const searchInput = document.getElementById('archive-search-input');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const dateFrom = document.getElementById('archive-date-from')?.value;
  const dateTo = document.getElementById('archive-date-to')?.value;

  let archiveOrders = activeOrders.filter(o => o.stage === 'delivered');

  if (query) {
    archiveOrders = archiveOrders.filter(o => {
      const matchId = String(o.id || '').toLowerCase().includes(query);
      const matchName = String(o.client_name || '').toLowerCase().includes(query);
      const matchPhone = String(o.client_phone || '').toLowerCase().includes(query);
      const matchAddr = String(o.client_address || '').toLowerCase().includes(query);
      const matchCourier = String(o.courier_name || '').toLowerCase().includes(query);
      return matchId || matchName || matchPhone || matchAddr || matchCourier;
    });
  }

  if (dateFrom) {
    archiveOrders = archiveOrders.filter(o => {
      const dateStr = toIsoDateSafe(o.delivery_date || o.created_at);
      return dateStr ? dateStr >= dateFrom : false;
    });
  }
  if (dateTo) {
    archiveOrders = archiveOrders.filter(o => {
      const dateStr = toIsoDateSafe(o.delivery_date || o.created_at);
      return dateStr ? dateStr <= dateTo : false;
    });
  }

  if (archiveOrders.length === 0) {
    alert('Нет заказов для экспорта!');
    return;
  }

  // Prepend UTF-8 BOM \uFEFF for seamless Russian Excel compatibility
  let csv = '\uFEFFID;Клиент;Телефон;Адрес;Район;Этап;Площадь_м2;Сумма_сум;Оплачено;Способ_оплаты;Курьер;Дата_выполнения\n';
  archiveOrders.forEach(o => {
    csv += `${o.id};"${o.client_name || ''}";${o.client_phone || ''};"${o.client_address || ''}";"${o.district || ''}";${o.stage};${o.total_m2 || 0};${o.total_price || 0};${o.paid ? 'Да' : 'Нет'};"${o.payment_method || 'Наличные'}";"${o.courier_name || ''}";"${o.delivery_date || o.created_at || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cosmo_archive_${Date.now()}.csv`;
  a.click();
}

async function restoreArchivedOrder(orderId) {
  if (!confirm(`Вернуть заказ #${orderId} из архива в работу (статус: «Готов к доставке»)?`)) return;

  try {
    const res = await fetch(`/api/orders/${orderId}/stage`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'ready', actor_name: currentUser?.name || 'Администратор' })
    });
    if (res.ok) {
      alert(`✅ Заказ #${orderId} возвращен в работу и готов к доставке!`);
      await loadInitialData();
      renderArchive();
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Ошибка при возврате заказа: ' + (err.error || 'Неизвестная ошибка'));
    }
  } catch (e) {
    alert('Ошибка соединения с сервером');
  }
}

// ================= SMART MULTI-STOP ROUTE OPTIMIZER (TSP) =================
// (WORKSHOP_COORDINATES and DISTRICT_CENTERS are declared at top of file)

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2);
}

function estimateDriveTimeMinutes(distanceKm, stopsCount) {
  // Average 25 km/h in Samarkand traffic + 7 minutes per customer stop
  const driveMinutes = (distanceKm / 25) * 60;
  const stopMinutes = stopsCount * 7;
  return Math.round(driveMinutes + stopMinutes);
}

function extractOrderCoordinates(order) {
  if (!order) return WORKSHOP_COORDINATES;
  const coordInfo = getOrderCoordinatesWithFallback(order);
  return coordInfo.coords || WORKSHOP_COORDINATES;
}

// TSP solver: Nearest Neighbor + 2-Opt local refinement
function optimizeMultiStopRoute(orders, startCoords, returnToWorkshop) {
  if (!orders || orders.length === 0) {
    return { stops: [], totalDistanceKm: 0, estimatedDurationMin: 0 };
  }

  // 1. Prepare points with coordinates
  const points = orders.map(o => ({
    order: o,
    coords: extractOrderCoordinates(o)
  }));

  // 2. Nearest Neighbor tour construction
  let currentCoords = startCoords;
  const unvisited = [...points];
  const tour = [];

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateDistanceKm(
        currentCoords[0], currentCoords[1],
        unvisited[i].coords[0], unvisited[i].coords[1]
      );
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    const nextPoint = unvisited.splice(nearestIdx, 1)[0];
    nextPoint.legDistance = minDistance;
    tour.push(nextPoint);
    currentCoords = nextPoint.coords;
  }

  // 3. 2-Opt refinement algorithm to remove crossing paths
  if (tour.length >= 4) {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 50) {
      improved = false;
      iterations++;
      for (let i = 0; i < tour.length - 1; i++) {
        for (let k = i + 1; k < tour.length; k++) {
          const prevCoords = (i === 0) ? startCoords : tour[i - 1].coords;
          const iCoords = tour[i].coords;
          const kCoords = tour[k].coords;
          const nextCoords = (k === tour.length - 1)
            ? (returnToWorkshop ? WORKSHOP_COORDINATES : null)
            : tour[k + 1].coords;

          const d1 = calculateDistanceKm(prevCoords[0], prevCoords[1], iCoords[0], iCoords[1]);
          const d2 = nextCoords ? calculateDistanceKm(kCoords[0], kCoords[1], nextCoords[0], nextCoords[1]) : 0;

          const d3 = calculateDistanceKm(prevCoords[0], prevCoords[1], kCoords[0], kCoords[1]);
          const d4 = nextCoords ? calculateDistanceKm(iCoords[0], iCoords[1], nextCoords[0], nextCoords[1]) : 0;

          if ((d3 + d4) < (d1 + d2) - 0.05) {
            const reversed = tour.slice(i, k + 1).reverse();
            tour.splice(i, k - i + 1, ...reversed);
            improved = true;
          }
        }
      }
    }
  }

  // Recalculate leg distances & total distance
  let totalDistance = 0;
  let prev = startCoords;
  tour.forEach(stop => {
    const leg = calculateDistanceKm(prev[0], prev[1], stop.coords[0], stop.coords[1]);
    stop.legDistance = leg;
    totalDistance += leg;
    prev = stop.coords;
  });

  if (returnToWorkshop && tour.length > 0) {
    const returnLeg = calculateDistanceKm(prev[0], prev[1], WORKSHOP_COORDINATES[0], WORKSHOP_COORDINATES[1]);
    totalDistance += returnLeg;
  }

  totalDistance = +totalDistance.toFixed(1);
  const estimatedMin = estimateDriveTimeMinutes(totalDistance, tour.length);

  return {
    stops: tour,
    totalDistanceKm: totalDistance,
    estimatedDurationMin: estimatedMin
  };
}

let routeOptimizerScope = 'all';
let routeOptimizerOrders = [];
let routeSelectedIds = new Set();
let routeCompletedStops = new Set();

function openRouteOptimizerModal(scope = 'all') {
  routeOptimizerScope = scope;

  // Eligible orders: pickup and ready/delivery
  let candidateOrders = activeOrders.filter(o =>
    ['pickup', 'ready', 'delivery'].includes(o.stage)
  );

  if (scope === 'courier' && currentUser?.role === 'courier') {
    candidateOrders = candidateOrders.filter(o => isOrderForCourier(o, currentUser));
  }

  routeOptimizerOrders = candidateOrders;
  routeSelectedIds = new Set(candidateOrders.map(o => String(o.id)));

  const modal = document.getElementById('modal-route-optimizer');
  if (modal) modal.classList.remove('hidden');

  recalculateRouteOptimization();
}

function recalculateRouteOptimization() {
  const startSelect = document.getElementById('route-start-point');
  const returnCheckbox = document.getElementById('route-return-workshop');
  const returnToWorkshop = returnCheckbox ? returnCheckbox.checked : true;

  let startCoords = WORKSHOP_COORDINATES;
  if (startSelect && startSelect.value === 'courier') {
    if (courierLastCoords && Array.isArray(courierLastCoords)) {
      startCoords = courierLastCoords;
    }
  }

  const selectedOrders = routeOptimizerOrders.filter(o => routeSelectedIds.has(String(o.id)));
  const result = optimizeMultiStopRoute(selectedOrders, startCoords, returnToWorkshop);

  // Update statistics
  const countEl = document.getElementById('route-stops-count');
  const distEl = document.getElementById('route-total-distance');
  const timeEl = document.getElementById('route-total-time');

  if (countEl) countEl.textContent = result.stops.length;
  if (distEl) distEl.textContent = `${result.totalDistanceKm} км`;
  if (timeEl) timeEl.textContent = `~${result.estimatedDurationMin} мин`;

  // Update Navigation URLs
  const btnYandex = document.getElementById('btn-open-yandex-route');
  const btnGoogle = document.getElementById('btn-open-google-route');

  if (result.stops.length > 0) {
    const yandexPoints = [startCoords, ...result.stops.map(s => s.coords)];
    if (returnToWorkshop) yandexPoints.push(WORKSHOP_COORDINATES);
    const yandexRtext = yandexPoints.map(p => `${p[0]},${p[1]}`).join('~');
    if (btnYandex) {
      btnYandex.href = `https://yandex.ru/maps/?rtext=${yandexRtext}&rtt=auto`;
      btnYandex.classList.remove('opacity-50', 'pointer-events-none');
    }

    const origin = `${startCoords[0]},${startCoords[1]}`;
    const destination = returnToWorkshop
      ? `${WORKSHOP_COORDINATES[0]},${WORKSHOP_COORDINATES[1]}`
      : `${result.stops[result.stops.length - 1].coords[0]},${result.stops[result.stops.length - 1].coords[1]}`;
    const waypointsArr = returnToWorkshop
      ? result.stops.map(s => `${s.coords[0]},${s.coords[1]}`)
      : result.stops.slice(0, -1).map(s => `${s.coords[0]},${s.coords[1]}`);
    const waypointsParam = waypointsArr.length > 0 ? `&waypoints=${waypointsArr.join('|')}` : '';

    if (btnGoogle) {
      btnGoogle.href = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
      btnGoogle.classList.remove('opacity-50', 'pointer-events-none');
    }
  } else {
    if (btnYandex) {
      btnYandex.href = '#';
      btnYandex.classList.add('opacity-50', 'pointer-events-none');
    }
    if (btnGoogle) {
      btnGoogle.href = '#';
      btnGoogle.classList.add('opacity-50', 'pointer-events-none');
    }
  }

  // Render stops list
  const container = document.getElementById('route-stops-container');
  if (!container) return;

  if (routeOptimizerOrders.length === 0) {
    container.innerHTML = `
      <div class="py-12 text-center text-charcoal-muted">
        <p class="font-bold text-sm">Нет доступных заказов для построения маршрута</p>
        <p class="text-xs mt-1">Все заказы уже доставлены или находятся на этапе стирки в цеху</p>
      </div>
    `;
    return;
  }

  const stopsHtml = result.stops.map((stop, idx) => {
    const o = stop.order;
    const isCompleted = routeCompletedStops.has(String(o.id));
    const isPickup = o.stage === 'pickup';
    const stageBadge = isPickup
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">📦 Забор</span>'
      : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-900 border border-teal-300">✨ Доставка</span>';

    return `
      <div class="theme-card bg-white border border-emerald-deep/15 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-xs hover:shadow-md transition ${isCompleted ? 'opacity-60 bg-gray-50' : ''}">
        <div class="flex items-center gap-3">
          <button type="button" onclick="toggleRouteStopCompleted('${o.id}')" class="w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${isCompleted ? 'bg-emerald-deep text-butter' : 'bg-emerald-deep/10 text-emerald-deep hover:bg-emerald-deep/20'} transition" title="Отметить как выполненный">
            ${isCompleted ? '✓' : (idx + 1)}
          </button>
          <div class="space-y-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-bold text-xs text-emerald-deep">#${escapeHtml(o.id)}</span>
              ${stageBadge}
              ${o.urgent ? '<span class="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200 animate-pulse">⚡ Срочно</span>' : ''}
              <span class="font-bold text-xs text-charcoal-deep">${escapeHtml(o.client_name)}</span>
            </div>
            <div class="text-[11px] text-charcoal-muted flex items-center gap-1.5">
              <span>📍 ${escapeHtml(o.client_address)} (${escapeHtml(o.district || 'Самарканд')})</span>
              <span class="font-mono text-emerald-800 font-bold">• +${stop.legDistance} км</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onclick="openNavigationModal('${o.id}')" class="p-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 transition" title="Навигация к этой точке (Яндекс / Google)">
            <i data-lucide="navigation" class="w-4 h-4"></i>
          </button>
          <button type="button" onclick="callClient('${o.id}', '${escapeHtml(o.client_phone)}', '${escapeHtml(o.client_name)}')" class="p-1.5 rounded-xl bg-emerald-deep/5 hover:bg-emerald-deep/10 text-emerald-deep" title="Позвонить">
            <i data-lucide="phone" class="w-4 h-4"></i>
          </button>
          <label class="flex items-center gap-1 text-xs cursor-pointer p-1">
            <input type="checkbox" onchange="toggleRouteOrderSelection('${o.id}')" checked class="accent-emerald-deep rounded w-4 h-4">
          </label>
        </div>
      </div>
    `;
  }).join('');

  const unselectedOrders = routeOptimizerOrders.filter(o => !routeSelectedIds.has(String(o.id)));
  const unselectedHtml = unselectedOrders.map(o => `
    <div class="theme-card bg-white/60 border border-dashed border-charcoal-muted/30 rounded-2xl p-3 flex items-center justify-between gap-3 opacity-60">
      <div class="flex items-center gap-3">
        <span class="w-7 h-7 rounded-xl bg-gray-200 text-charcoal-muted flex items-center justify-center font-bold text-xs shrink-0">—</span>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs text-charcoal-muted">#${escapeHtml(o.id)}</span>
            <span class="text-xs font-semibold text-charcoal-muted">${escapeHtml(o.client_name)}</span>
          </div>
          <div class="text-[11px] text-charcoal-muted">${escapeHtml(o.client_address)} (${escapeHtml(o.district || 'Самарканд')})</div>
        </div>
      </div>
      <label class="flex items-center gap-1 text-xs cursor-pointer p-1">
        <input type="checkbox" onchange="toggleRouteOrderSelection('${o.id}')" class="accent-emerald-deep rounded w-4 h-4">
      </label>
    </div>
  `).join('');

  container.innerHTML = stopsHtml + unselectedHtml;
  if (window.lucide) lucide.createIcons();
}

function selectAllRouteOrders(flag) {
  if (flag) {
    routeSelectedIds = new Set(routeOptimizerOrders.map(o => String(o.id)));
  } else {
    routeSelectedIds.clear();
  }
  recalculateRouteOptimization();
}

function toggleRouteOrderSelection(id) {
  const strId = String(id);
  if (routeSelectedIds.has(strId)) {
    routeSelectedIds.delete(strId);
  } else {
    routeSelectedIds.add(strId);
  }
  recalculateRouteOptimization();
}

function toggleRouteStopCompleted(id) {
  const strId = String(id);
  if (routeCompletedStops.has(strId)) {
    routeCompletedStops.delete(strId);
  } else {
    routeCompletedStops.add(strId);
  }
  recalculateRouteOptimization();
}

// ================= NOTIFICATION DRAWER MODULE =================

function toggleNotificationDrawer() {
  const drawer = document.getElementById('notification-drawer');
  const backdrop = document.getElementById('notification-drawer-backdrop');
  if (!drawer) return;

  const isClosed = drawer.classList.contains('translate-x-full');
  if (isClosed) {
    drawer.classList.remove('translate-x-full');
    if (backdrop) backdrop.classList.remove('hidden');
    renderNotificationDrawer();
  } else {
    drawer.classList.add('translate-x-full');
    if (backdrop) backdrop.classList.add('hidden');
  }
}

function renderNotificationDrawer() {
  const listEl = document.getElementById('notification-drawer-list');
  const badgeEl = document.getElementById('notif-badge');
  if (!listEl) return;

  const notifications = [];

  activeOrders.forEach(o => {
    if (o.urgent && o.stage !== 'delivered') {
      notifications.push({
        id: o.id,
        icon: '⚡',
        badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
        badgeText: 'Срочный заказ',
        title: `Заказ #${o.id} требует внимания!`,
        desc: `${o.client_name} (${o.district || 'Самарканд'}) • ${o.total_price ? o.total_price.toLocaleString() + ' сум' : 'Забор'}`,
        time: o.created_at || 'Сегодня',
        orderId: o.id
      });
    }

    if (o.stage === 'ready') {
      notifications.push({
        id: o.id,
        icon: '✨',
        badgeColor: 'bg-teal-100 text-teal-900 border-teal-300',
        badgeText: 'Готов к доставке',
        title: `Заказ #${o.id} постиран и измерен`,
        desc: `${o.client_name} • ${o.total_m2 ? o.total_m2 + ' м²' : ''} • Экипаж: ${o.courier_name || 'Не назначен'}`,
        time: o.created_at || 'Сегодня',
        orderId: o.id
      });
    } else if (o.stage === 'pickup') {
      notifications.push({
        id: o.id,
        icon: '📦',
        badgeColor: 'bg-amber-100 text-amber-900 border-amber-300',
        badgeText: 'Ожидает забора',
        title: `Заявка #${o.id} (${o.client_name})`,
        desc: `${o.client_address} • ${o.time_slot || 'В любое время'}`,
        time: o.created_at || 'Сегодня',
        orderId: o.id
      });
    }
  });

  if (badgeEl) {
    if (notifications.length > 0) {
      badgeEl.textContent = notifications.length > 99 ? '99+' : notifications.length;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  if (notifications.length === 0) {
    listEl.innerHTML = `
      <div class="py-12 text-center text-charcoal-muted">
        <span class="text-3xl block mb-2">🎉</span>
        <p class="font-bold text-sm">Все уведомления прочитаны</p>
        <p class="text-xs text-charcoal-muted/70 mt-1">Новые события по заказам появятся здесь</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = notifications.map(n => `
    <div onclick="openEditOrderModal('${n.orderId}'); toggleNotificationDrawer();" class="theme-card bg-white p-3 rounded-2xl border border-emerald-deep/15 hover:border-emerald-deep/40 shadow-xs hover:shadow-md cursor-pointer transition space-y-1.5 group">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span class="text-sm">${n.icon}</span>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${n.badgeColor}">${n.badgeText}</span>
        </div>
        <span class="text-[10px] text-charcoal-muted font-mono font-medium">${escapeHtml(n.time)}</span>
      </div>
      <div class="font-bold text-xs text-emerald-deep group-hover:text-emerald-hover transition">${escapeHtml(n.title)}</div>
      <div class="text-[11px] text-charcoal-muted line-clamp-2">${escapeHtml(n.desc)}</div>
    </div>
  `).join('');
}

// ================= ФОТОФИКСАЦИЯ И ДЕФЕКТЫ ИЗДЕЛИЙ (ДО СТИРКИ) =================

let activePhotoModalOrderId = null;
let stagedPhotoDataUrl = null;

// Сжатие фото на стороне клиента через Canvas перед отправкой (макс 1600px, Web quality 0.80)
function compressImageFile(file, maxWidth = 1600, maxHeight = 1600, quality = 0.80) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      return reject(new Error('Выбранный файл не является изображением'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось декодировать изображение'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function triggerPhotoCamera() {
  const input = document.getElementById('order-photo-camera-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

function triggerPhotoGallery() {
  const input = document.getElementById('order-photo-gallery-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handlePhotoFileInputChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    showToast('Обработка и сжатие фотографии...', 'info');
    const compressedDataUrl = await compressImageFile(file, 1600, 1600, 0.80);
    stagedPhotoDataUrl = compressedDataUrl;

    const previewEl = document.getElementById('photo-staging-preview');
    const sizeEl = document.getElementById('photo-staging-size');
    const stagingCard = document.getElementById('photo-staging-card');

    if (previewEl) previewEl.src = compressedDataUrl;
    if (sizeEl) {
      const approxKb = Math.round((compressedDataUrl.length * 3) / 4 / 1024);
      sizeEl.textContent = `~${approxKb} KB (оптимизировано)`;
    }
    if (stagingCard) stagingCard.classList.remove('hidden');

    const captionInput = document.getElementById('photo-staging-caption');
    if (captionInput && !captionInput.value) {
      captionInput.focus();
    }
  } catch (err) {
    console.error('Photo compression error:', err);
    alert('Не удалось обработать фотографию: ' + err.message);
  }
}

function setPhotoCaptionChip(chipText) {
  const input = document.getElementById('photo-staging-caption');
  if (!input) return;
  if (!input.value.trim()) {
    input.value = chipText;
  } else if (!input.value.includes(chipText)) {
    input.value = `${input.value.trim()}, ${chipText}`;
  }
}

function cancelStagedPhoto() {
  stagedPhotoDataUrl = null;
  const stagingCard = document.getElementById('photo-staging-card');
  if (stagingCard) stagingCard.classList.add('hidden');
  const captionInput = document.getElementById('photo-staging-caption');
  if (captionInput) captionInput.value = '';
  const camInput = document.getElementById('order-photo-camera-input');
  if (camInput) camInput.value = '';
  const galInput = document.getElementById('order-photo-gallery-input');
  if (galInput) galInput.value = '';
}

async function uploadStagedPhoto() {
  if (!stagedPhotoDataUrl) {
    alert('Пожалуйста, сначала сфотографируйте или выберите изображение!');
    return;
  }
  if (!activePhotoModalOrderId) {
    alert('Не выбран заказ для прикрепления фото!');
    return;
  }

  const captionInput = document.getElementById('photo-staging-caption');
  const caption = captionInput ? captionInput.value.trim() : '';
  const confirmBtn = document.getElementById('btn-confirm-upload-photo');

  const order = activeOrders.find(o => String(o.id) === String(activePhotoModalOrderId));
  const currentStage = order ? order.stage : 'pickup';
  const authorName = currentUser?.name || 'Сотрудник';

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <span class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
      <span>Загрузка...</span>
    `;
  }

  try {
    const res = await fetch(`/api/orders/${activePhotoModalOrderId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo: stagedPhotoDataUrl,
        caption,
        stage: currentStage,
        taken_by: authorName
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Ошибка сервера при сохранении фото');
    }

    const data = await res.json();
    const updatedPhotos = data.photos || [];

    // Обновляем локальный массив активных заказов
    if (order) {
      order.photos = updatedPhotos;
    }

    cancelStagedPhoto();
    renderOrderPhotosGallery(updatedPhotos);
    updateGlobalPhotoBadges(activePhotoModalOrderId, updatedPhotos.length);
    showToast('📸 Фото ковра успешно сохранено!', 'success');
  } catch (err) {
    console.error('Upload photo error:', err);
    alert('Ошибка загрузки фото: ' + err.message);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `
        <i data-lucide="upload" class="w-4 h-4 text-butter"></i>
        <span>Сохранить в заказ</span>
      `;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function openOrderPhotosModal(orderId) {
  if (!orderId) return;

  activePhotoModalOrderId = String(orderId);
  cancelStagedPhoto();

  let order = activeOrders.find(o => String(o.id) === String(orderId));
  if (!order) {
    try {
      const res = await fetch(`/api/orders/${orderId}`);
      if (res.ok) order = await res.json();
    } catch (e) {}
  }

  const orderBadge = document.getElementById('photo-modal-order-badge');
  if (orderBadge) orderBadge.textContent = `#${orderId}`;

  const clientTitle = document.getElementById('photo-modal-client-title');
  if (clientTitle) {
    clientTitle.textContent = order ? `${order.client_name} • Фотофиксация` : `Заказ #${orderId}`;
  }

  const clientSub = document.getElementById('photo-modal-client-subtitle');
  if (clientSub && order) {
    clientSub.textContent = `${order.client_address || ''} (${order.district || 'Самарканд'})`;
  }

  const photos = (order && Array.isArray(order.photos)) ? order.photos : [];
  renderOrderPhotosGallery(photos);

  const modal = document.getElementById('modal-order-photos');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function renderOrderPhotosGallery(photos = []) {
  const countBadge = document.getElementById('photo-modal-count-badge');
  if (countBadge) countBadge.textContent = `${photos.length} фото`;

  const galCount = document.getElementById('photo-gallery-count');
  if (galCount) galCount.textContent = photos.length;

  const container = document.getElementById('order-photos-gallery-container');
  if (!container) return;

  if (photos.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-charcoal-muted theme-card rounded-2xl border border-dashed border-emerald-deep/20 bg-emerald-deep/5 space-y-2">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-deep/10 text-emerald-deep flex items-center justify-center font-bold text-xl">
          📸
        </div>
        <div class="font-bold text-xs text-emerald-deep">Фотографий ещё нет</div>
        <p class="text-[11px] text-charcoal-muted max-w-sm mx-auto px-3">
          Сфотографируйте изделие прямо сейчас или выберите из галереи, чтобы зафиксировать состояние ковра, пятна и дефекты до стирки.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = photos.map(photo => {
    const stageBadgeClass = (photo.stage === 'washer' || photo.stage === 'in_shop' || photo.stage === 'washing')
      ? 'bg-blue-100 text-blue-900 border-blue-200'
      : (photo.stage === 'ready' || photo.stage === 'delivery' || photo.stage === 'delivered' ? 'bg-teal-100 text-teal-900 border-teal-200' : 'bg-amber-100 text-amber-900 border-amber-200');

    const formattedDate = formatDateSafe(photo.created_at, true);
    const safeCaption = escapeHtml(photo.caption || 'Без описания');
    const safeAuthor = escapeHtml(photo.taken_by || 'Сотрудник');
    const safeStage = escapeHtml(photo.stage_label || 'Фото изделия');

    return `
      <div class="bg-white rounded-2xl border border-emerald-deep/20 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col group">
        <!-- Photo Thumbnail with Zoom Click -->
        <div class="relative aspect-4/3 bg-black/5 overflow-hidden cursor-pointer" onclick="openPhotoLightbox('${photo.url}', '${safeCaption.replace(/'/g, "\\'")}', '${safeStage.replace(/'/g, "\\'")}', '${safeAuthor.replace(/'/g, "\\'")}', '${photo.created_at}')">
          <img src="${photo.url}" alt="${safeCaption}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <span class="px-3 py-1.5 bg-black/60 backdrop-blur-xs text-white text-xs font-bold rounded-xl flex items-center gap-1.5">
              🔍 Увеличить
            </span>
          </div>
          <!-- Stage badge overlay -->
          <div class="absolute top-2 left-2">
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border shadow-xs ${stageBadgeClass}">
              ${safeStage}
            </span>
          </div>
          <!-- Delete button overlay -->
          <button type="button" onclick="event.stopPropagation(); deleteOrderPhoto('${activePhotoModalOrderId}', '${photo.id}')" class="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-rose-600 text-white text-xs transition shadow-xs" title="Удалить фото">
            🗑️
          </button>
        </div>

        <!-- Meta and Caption info -->
        <div class="p-2.5 flex-1 flex flex-col justify-between space-y-1 text-xs">
          <div class="font-bold text-emerald-deep leading-snug break-words">
            ${photo.caption ? `⚠️ ${safeCaption}` : '<span class="text-charcoal-muted italic font-normal">Без описания</span>'}
          </div>
          <div class="text-[10px] text-charcoal-muted pt-1 border-t border-emerald-deep/10 flex items-center justify-between">
            <span class="truncate">👤 ${safeAuthor}</span>
            <span class="font-mono text-[9px] shrink-0">${formattedDate}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteOrderPhoto(orderId, photoId) {
  if (!confirm('Вы уверены, что хотите удалить эту фотографию?')) return;

  try {
    const res = await fetch(`/api/orders/${orderId}/photos/${photoId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted_by: currentUser?.name || 'Сотрудник' })
    });

    if (!res.ok) {
      throw new Error('Ошибка при удалении фото');
    }

    const data = await res.json();
    const updatedPhotos = data.photos || [];

    const order = activeOrders.find(o => String(o.id) === String(orderId));
    if (order) {
      order.photos = updatedPhotos;
    }

    renderOrderPhotosGallery(updatedPhotos);
    updateGlobalPhotoBadges(orderId, updatedPhotos.length);
    showToast('Фотография удалена', 'info');
  } catch (err) {
    alert('Не удалось удалить фото: ' + err.message);
  }
}

function updateGlobalPhotoBadges(orderId, count) {
  // 1. Pickup modal
  const pickupBadge = document.getElementById('pickup-modal-photos-count');
  if (pickupBadge) pickupBadge.textContent = `${count} фото`;

  // 2. Measure modal
  const measureBadge = document.getElementById('measure-modal-photos-count');
  if (measureBadge) measureBadge.textContent = `${count}`;

  // 3. Edit Order modal
  const editBadge = document.getElementById('modal-order-photos-count');
  if (editBadge) editBadge.textContent = `${count}`;

  // 4. Re-render portals if visible
  if (typeof renderCourierPortalCards === 'function') renderCourierPortalCards();
  if (typeof renderWasherPortalCards === 'function') renderWasherPortalCards();
  if (typeof renderOrdersTable === 'function') renderOrdersTable();
  if (typeof renderKanban === 'function') renderKanban();
}

function openPhotoLightbox(photoUrl, caption, stageLabel, takenBy, createdAt) {
  const fullImg = document.getElementById('lightbox-full-img');
  const captionEl = document.getElementById('lightbox-caption-text');
  const stageEl = document.getElementById('lightbox-stage-badge');
  const metaEl = document.getElementById('lightbox-author-meta');
  const downloadLink = document.getElementById('lightbox-download-link');

  if (fullImg) fullImg.src = photoUrl;
  if (captionEl) captionEl.textContent = caption || 'Без описания дефекта';
  if (stageEl) stageEl.textContent = stageLabel || 'Фото изделия';
  if (metaEl) metaEl.textContent = `${takenBy || 'Сотрудник'} • ${formatDateSafe(createdAt, true)}`;
  if (downloadLink) downloadLink.href = photoUrl;

  const modal = document.getElementById('modal-photo-lightbox');
  if (modal) modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closePhotoLightbox() {
  const modal = document.getElementById('modal-photo-lightbox');
  if (modal) modal.classList.add('hidden');
  const fullImg = document.getElementById('lightbox-full-img');
  if (fullImg) fullImg.src = '';
}

// ================= GLOBAL WINDOW BINDINGS =================

window.openOrderPhotosModal = openOrderPhotosModal;
window.triggerPhotoCamera = triggerPhotoCamera;
window.triggerPhotoGallery = triggerPhotoGallery;
window.handlePhotoFileInputChange = handlePhotoFileInputChange;
window.setPhotoCaptionChip = setPhotoCaptionChip;
window.cancelStagedPhoto = cancelStagedPhoto;
window.uploadStagedPhoto = uploadStagedPhoto;
window.deleteOrderPhoto = deleteOrderPhoto;
window.openPhotoLightbox = openPhotoLightbox;
window.closePhotoLightbox = closePhotoLightbox;

window.setAnalyticsPeriod = setAnalyticsPeriod;
window.renderAnalytics = renderAnalytics;
window.renderArchive = renderArchive;
window.resetArchiveDates = resetArchiveDates;
window.exportArchiveCSV = exportArchiveCSV;
window.restoreArchivedOrder = restoreArchivedOrder;
window.openRouteOptimizerModal = openRouteOptimizerModal;
window.recalculateRouteOptimization = recalculateRouteOptimization;
window.selectAllRouteOrders = selectAllRouteOrders;
window.toggleRouteOrderSelection = toggleRouteOrderSelection;
window.toggleRouteStopCompleted = toggleRouteStopCompleted;
window.refreshSmsBalance = refreshSmsBalance;
window.autoLoginEskiz = autoLoginEskiz;
window.testCustomSmsMessage = testCustomSmsMessage;
window.saveSmsSettings = saveSmsSettings;
window.loadSmsAuditLogs = loadSmsAuditLogs;
window.loadIntegrationSettings = loadIntegrationSettings;
window.toggleNotificationDrawer = toggleNotificationDrawer;
window.renderNotificationDrawer = renderNotificationDrawer;
window.setCourierScopeFilter = setCourierScopeFilter;
window.setCourierPickupSubTab = setCourierPickupSubTab;
window.assignOrderToMe = assignOrderToMe;
window.quickAssignCourier = quickAssignCourier;
window.startLiveOrderSync = startLiveOrderSync;
window.manualRefreshData = manualRefreshData;
window.openDispatcherBroadcastModal = openDispatcherBroadcastModal;
window.handleDispatcherBroadcastSubmit = handleDispatcherBroadcastSubmit;
window.exportOrdersCSV = exportOrdersCSV;
window.triggerLiquidRipple = triggerLiquidRipple;
window.updateLiquidNavIndicator = updateLiquidNavIndicator;
window.renderMobileBottomNav = renderMobileBottomNav;


