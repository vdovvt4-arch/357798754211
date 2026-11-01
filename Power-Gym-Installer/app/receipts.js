'use strict';
// =========================================================
// نظام الوصولات - Power Gym
// يعتمد على متغيرات app.js: players, financeLedger, gymProfile, STORAGE_KEYS
// ودوال: escapeHtml, getTodayDateString, isValidDateString, showToast, logActivity,
// updateDashboardStats
// الوصولات تُحفظ داخل financeLedger.receipts لذلك تدخل ضمن النسخ الاحتياطي تلقائياً.
// =========================================================
(function () {

  const METHODS = { cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل', zaincash: 'زين كاش', other: 'أخرى' };
  const TYPES = {
    subscription: 'اشتراك جديد',
    renewal: 'تجديد اشتراك',
    debt_payment: 'تسديد دين',
    misc: 'إيراد متفرق'
  };
  const PAPERS = { '80mm': 'حراري 80mm', 'A5': 'A5', 'A4': 'A4' };
  const DEFAULTS = {
    currencyLabel: 'د.ع',
    currencyName: 'دينار عراقي',
    taxPercent: 0,
    paper: '80mm',
    footer: 'شكراً لثقتكم بنا - نتمنى لكم تمريناً موفقاً',
    phone: '',
    defaultMethod: 'cash',
    prefix: 'PG-R',
    issueMode: 'auto',
    logo: '',
    autoOpen: true,
    showAmountWords: true,
    showDebtBalance: true
  };

  // ---------- أدوات مساعدة ----------
  const esc = v => escapeHtml(v);
  const toInt = v => Math.max(0, Math.round(Number(v) || 0));

  function ensureStore() {
    if (!Array.isArray(financeLedger.receipts)) financeLedger.receipts = [];
    if (!financeLedger.receiptSettings || typeof financeLedger.receiptSettings !== 'object') financeLedger.receiptSettings = {};
    financeLedger.receiptCounter = Math.max(0, parseInt(financeLedger.receiptCounter, 10) || 0);
  }

  function getSettings() {
    ensureStore();
    const s = { ...DEFAULTS, ...financeLedger.receiptSettings };
    if (!PAPERS[s.paper]) s.paper = DEFAULTS.paper;
    if (!METHODS[s.defaultMethod]) s.defaultMethod = DEFAULTS.defaultMethod;
    s.taxPercent = Math.min(100, Math.max(0, Number(s.taxPercent) || 0));
    return s;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, JSON.stringify(financeLedger));
      if (typeof updateDashboardStats === 'function') updateDashboardStats();
      return true;
    } catch (e) {
      console.error('Receipt save error:', e);
      showToast('تعذر حفظ الوصل؛ تحقق من مساحة التخزين وخذ نسخة احتياطية.', 'error');
      return false;
    }
  }

  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function money(n, s) { return `${fmt(n)} ${s.currencyLabel}`; }

  // تحويل الرقم إلى كلمات عربية (أعداد صحيحة حتى المليارات)
  const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  function below1000(n) {
    const parts = [];
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) parts.push(HUNDREDS[h]);
    if (r) {
      if (r < 20) parts.push(ONES[r]);
      else {
        const u = r % 10;
        const t = Math.floor(r / 10);
        parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
      }
    }
    return parts.join(' و');
  }

  function scaleWords(count, single, dual, plural) {
    if (count === 1) return single;
    if (count === 2) return dual;
    if (count <= 10) return `${below1000(count)} ${plural}`;
    return `${below1000(count)} ${single}`;
  }

  function numberToArabicWords(num) {
    let n = toInt(num);
    if (n === 0) return 'صفر';
    if (n > 999999999999) return fmt(n);
    const billions = Math.floor(n / 1e9); n %= 1e9;
    const millions = Math.floor(n / 1e6); n %= 1e6;
    const thousands = Math.floor(n / 1e3); n %= 1e3;
    const parts = [];
    if (billions) parts.push(scaleWords(billions, 'مليار', 'ملياران', 'مليارات'));
    if (millions) parts.push(scaleWords(millions, 'مليون', 'مليونان', 'ملايين'));
    if (thousands) parts.push(scaleWords(thousands, 'ألف', 'ألفان', 'آلاف'));
    if (n) parts.push(below1000(n));
    return parts.join(' و');
  }

  function amountInWords(amount, s) {
    return `${numberToArabicWords(amount)} ${s.currencyName} فقط لا غير`;
  }

  // رمز تحقق قصير (FNV-1a) مبني على رقم الوصل والمبلغ والتاريخ لكشف التلاعب البسيط
  function verifyCode(rec) {
    const str = `${rec.no}|${rec.date}|${rec.total}|${rec.paid}|${rec.playerId || rec.payerName || ''}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
  }

  // ---------- الحسابات ----------
  // السعر الأصلي = الإجمالي بعد الخصم + الخصم. الضريبة (إن وجدت) محسوبة ضمن الإجمالي.
  function computeAmounts({ paid, debt, discount, taxable }, s) {
    const p = toInt(paid);
    const d = toInt(debt);
    const total = p + d;
    const disc = toInt(discount);
    const listPrice = total + disc;
    const tax = taxable && s.taxPercent > 0 ? Math.round(total * s.taxPercent / (100 + s.taxPercent)) : 0;
    return { paid: p, remaining: d, total, discount: disc, listPrice, tax, subtotal: total - tax };
  }

  function nextSerial() {
    ensureStore();
    let maxExisting = 0;
    financeLedger.receipts.forEach(r => { maxExisting = Math.max(maxExisting, parseInt(r.serial, 10) || 0); });
    return Math.max(financeLedger.receiptCounter, maxExisting) + 1;
  }

  function formatNo(prefix, serial) {
    return `${prefix}-${String(serial).padStart(6, '0')}`;
  }

  function nowTime() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function issueReceipt(d) {
    const s = getSettings();
    ensureStore();
    const amounts = computeAmounts(d, s);
    if (amounts.total <= 0 && d.type !== 'subscription' && d.type !== 'renewal') return null;
    const serial = nextSerial();
    const player = d.playerId ? players.find(p => p.id === d.playerId) : null;
    const rec = {
      id: `rcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      serial,
      no: formatNo(s.prefix, serial),
      type: TYPES[d.type] ? d.type : 'misc',
      date: getTodayDateString(),
      time: nowTime(),
      createdAt: new Date().toISOString(),
      playerId: player ? player.id : '',
      playerName: String(player ? player.name : (d.payerName || 'زبون')).slice(0, 80),
      playerCode: player ? player.code : '',
      playerPhone: player ? player.phone : '',
      description: String(d.description || TYPES[d.type] || '').slice(0, 120),
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      durationMonths: toInt(d.durationMonths),
      ...amounts,
      taxPercent: amounts.tax > 0 ? s.taxPercent : 0,
      method: METHODS[d.method] ? d.method : s.defaultMethod,
      playerDebtAfter: player ? toInt(player.debtAmount) : 0,
      cashier: String(gymProfile.supervisorName || '').slice(0, 60),
      txId: d.txId || '',
      voided: false
    };
    financeLedger.receiptCounter = serial;
    financeLedger.receipts.unshift(rec);
    if (!persist()) {
      financeLedger.receipts.shift();
      financeLedger.receiptCounter = serial - 1;
      return null;
    }
    logActivity(`إصدار وصل رقم ${rec.no} للعميل ${rec.playerName} بمبلغ ${fmt(rec.paid)} ${s.currencyLabel}`);
    if (s.autoOpen) openReceiptView(rec.id);
    return rec;
  }

  // ---------- عرض الوصل (HTML قابل للطباعة) ----------
  function renderReceiptHtml(rec, paper) {
    const s = getSettings();
    const p = PAPERS[paper] ? paper : s.paper;
    const cls = p === '80mm' ? 'p80' : (p === 'A5' ? 'pA5' : 'pA4');
    const isDebt = rec.type === 'debt_payment';
    const rows = [];
    if (isDebt) {
      rows.push(`<tr><td>${esc(rec.description)}</td><td class="n">${money(rec.total, s)}</td></tr>`);
    } else {
      rows.push(`<tr><td>${esc(rec.description)}${rec.durationMonths ? ` (${rec.durationMonths} شهر)` : ''}</td><td class="n">${money(rec.listPrice, s)}</td></tr>`);
      if (rec.discount > 0) rows.push(`<tr><td>خصم</td><td class="n">- ${money(rec.discount, s)}</td></tr>`);
    }
    const totals = [];
    if (rec.tax > 0) {
      totals.push(`<tr><td>المبلغ قبل الضريبة</td><td class="n">${money(rec.subtotal, s)}</td></tr>`);
      totals.push(`<tr><td>ضريبة (${rec.taxPercent}%)</td><td class="n">${money(rec.tax, s)}</td></tr>`);
    }
    totals.push(`<tr class="big"><td>الإجمالي</td><td class="n">${money(rec.total, s)}</td></tr>`);
    totals.push(`<tr><td>${isDebt ? 'المبلغ المسدد' : 'المبلغ المدفوع'}</td><td class="n">${money(rec.paid, s)}</td></tr>`);
    if (!isDebt && rec.remaining > 0) totals.push(`<tr class="warn"><td>المتبقي على هذا الوصل</td><td class="n">${money(rec.remaining, s)}</td></tr>`);
    if (s.showDebtBalance && rec.playerId) totals.push(`<tr><td>إجمالي الدين على العضو بعد الوصل</td><td class="n">${money(rec.playerDebtAfter, s)}</td></tr>`);

    const period = rec.startDate && rec.endDate
      ? `<div class="line"><span>فترة الاشتراك</span><b dir="ltr">${esc(rec.startDate)} → ${esc(rec.endDate)}</b></div>` : '';

    return `
    <div class="rcpt ${cls}" dir="rtl">
      ${rec.voided ? '<div class="void">ملغي</div>' : ''}
      <div class="hd">
        ${/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s.logo || '') ? `<img class="lg" src="${s.logo}" alt="">` : ''}
        <div class="gn">${esc(gymProfile.gymName)}</div>
        <div class="gb">${esc(gymProfile.gymBranch)}</div>
        ${s.phone ? `<div class="gb" dir="ltr">${esc(s.phone)}</div>` : ''}
      </div>
      <div class="ttl">وصل ${esc(TYPES[rec.type] || 'استلام')}${rec.printCount > 0 ? ' - نسخة' : ''}</div>
      <div class="line"><span>رقم الوصل</span><b dir="ltr">${esc(rec.no)}</b></div>
      <div class="line"><span>التاريخ</span><b dir="ltr">${esc(rec.date)} ${esc(rec.time)}</b></div>
      <div class="line"><span>الاسم</span><b>${esc(rec.playerName)}</b></div>
      ${rec.playerCode ? `<div class="line"><span>رقم العضوية</span><b dir="ltr">${esc(rec.playerCode)}</b></div>` : ''}
      ${rec.playerPhone ? `<div class="line"><span>الهاتف</span><b dir="ltr">${esc(rec.playerPhone)}</b></div>` : ''}
      ${period}
      <table class="it"><thead><tr><th>البيان</th><th class="n">المبلغ</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <table class="tt"><tbody>${totals.join('')}</tbody></table>
      <div class="line"><span>طريقة الدفع</span><b>${esc(METHODS[rec.method] || rec.method)}</b></div>
      ${s.showAmountWords ? `<div class="wd">المبلغ كتابةً: ${esc(amountInWords(rec.paid, s))}</div>` : ''}
      ${rec.voided ? `<div class="wd">وصل ملغي${rec.voidReason ? ' - السبب: ' + esc(rec.voidReason) : ''}</div>` : ''}
      <div class="sg">
        <div>المستلم: <b>${esc(rec.cashier || 'إدارة القاعة')}</b></div>
        ${gymProfile.receiptStamp ? `<div class="st">${esc(gymProfile.receiptStamp)}</div>` : ''}
      </div>
      <div class="ft">${esc(s.footer)}</div>
      <div class="vc" dir="ltr">Verify: ${esc(verifyCode(rec))}</div>
    </div>`;
  }

  // ---------- الواجهة ----------
  let viewingId = '';
  let viewingPaper = '';

  function $(id) { return document.getElementById(id); }

  function injectStyles() {
    const css = `
      .rcpt { background:#fff; color:#111; font-family:'Cairo',sans-serif; margin:0 auto; padding:10px; position:relative; line-height:1.55; box-sizing:border-box; }
      .rcpt.p80 { width:72mm; font-size:11.5px; }
      .rcpt.pA5 { width:130mm; font-size:13px; padding:14px; }
      .rcpt.pA4 { width:185mm; font-size:14px; padding:18px; }
      .rcpt .hd { text-align:center; border-bottom:2px dashed #333; padding-bottom:6px; margin-bottom:6px; }
      .rcpt .lg { max-height:52px; max-width:60%; display:block; margin:0 auto 4px; }
      .rcpt .gn { font-size:1.35em; font-weight:900; }
      .rcpt .gb { font-size:.9em; color:#333; }
      .rcpt .ttl { text-align:center; font-weight:900; font-size:1.15em; margin:4px 0 6px; border:1px solid #111; padding:2px 0; }
      .rcpt .line { display:flex; justify-content:space-between; gap:8px; padding:1px 0; border-bottom:1px dotted #bbb; }
      .rcpt table { width:100%; border-collapse:collapse; margin-top:6px; }
      .rcpt th, .rcpt td { padding:3px 2px; text-align:right; border-bottom:1px solid #ddd; }
      .rcpt .n { text-align:left; white-space:nowrap; }
      .rcpt .tt .big td { font-weight:900; font-size:1.1em; border-top:2px solid #111; }
      .rcpt .tt .warn td { font-weight:800; }
      .rcpt .wd { margin-top:6px; font-size:.92em; border:1px dashed #555; padding:3px 5px; }
      .rcpt .sg { margin-top:10px; display:flex; justify-content:space-between; align-items:flex-end; gap:8px; }
      .rcpt .st { border:2px solid #111; padding:2px 8px; border-radius:6px; font-weight:800; transform:rotate(-4deg); }
      .rcpt .ft { text-align:center; margin-top:8px; border-top:2px dashed #333; padding-top:5px; font-size:.9em; }
      .rcpt .vc { text-align:center; font-size:.75em; color:#555; margin-top:3px; }
      .rcpt .void { position:absolute; top:40%; left:50%; transform:translate(-50%,-50%) rotate(-25deg); font-size:3.2em; font-weight:900; color:rgba(220,38,38,.35); border:6px solid rgba(220,38,38,.35); padding:0 14px; pointer-events:none; }
      #receiptPrint { display:none; }
      @media print {
        body[data-print-mode="receipt"] #receiptPrint { display:block !important; position:absolute; left:0; top:0; width:100%; background:#fff !important; }
        body[data-print-mode="receipt"] #receiptPrint, body[data-print-mode="receipt"] #receiptPrint * { visibility:visible !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        body[data-print-mode="receipt"] #receiptPrint .rcpt { margin:0 auto; }
      }`;
    const style = document.createElement('style');
    style.id = 'receiptStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500';
  const lblCls = 'block text-xs font-bold text-slate-300 mb-1';

  function methodOptions(sel) {
    return Object.entries(METHODS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');
  }

  function injectModals() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div id="rcListModal" class="fixed inset-0 modal-backdrop z-40 hidden flex items-center justify-center p-4">
      <div class="card-bg w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white flex items-center gap-2"><i class="fa-solid fa-receipt text-emerald-400"></i><span>سجل الوصولات</span></h3>
          <button onclick="closeReceiptsModal()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="flex flex-wrap gap-2 mb-3">
          <input id="rcSearch" oninput="renderReceiptsList()" placeholder="بحث: رقم الوصل / الاسم / رقم العضوية" class="${inputCls} flex-1 min-w-[180px]">
          <input id="rcMonth" type="month" onchange="renderReceiptsList()" class="${inputCls} w-40" dir="ltr">
          <button onclick="openMiscReceiptModal()" class="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-bold"><i class="fa-solid fa-plus ml-1"></i>وصل إيراد متفرق</button>
          <button onclick="openDailyCloseModal()" class="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-xl text-xs font-bold"><i class="fa-solid fa-cash-register ml-1"></i>إغلاق الصندوق اليومي</button>
          <button onclick="openReceiptSettingsModal()" class="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 px-3 py-2 rounded-xl text-xs font-bold"><i class="fa-solid fa-sliders ml-1"></i>إعدادات الوصل</button>
        </div>
        <div id="rcSummary" class="text-xs text-slate-300 mb-2"></div>
        <div class="overflow-x-auto"><table class="w-full text-xs text-white"><thead><tr class="text-slate-400 text-right">
          <th class="p-2">الرقم</th><th class="p-2">التاريخ</th><th class="p-2">الاسم</th><th class="p-2">النوع</th><th class="p-2">الإجمالي</th><th class="p-2">المدفوع</th><th class="p-2">الحالة</th><th class="p-2"></th>
        </tr></thead><tbody id="rcRows"></tbody></table></div>
      </div>
    </div>

    <div id="rcViewModal" class="fixed inset-0 modal-backdrop z-50 hidden flex items-center justify-center p-4">
      <div class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white"><i class="fa-solid fa-receipt text-emerald-400 ml-2"></i>معاينة الوصل</h3>
          <button onclick="closeReceiptView()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <label class="text-xs text-slate-300">حجم الورق</label>
          <select id="rcPaper" onchange="changeReceiptPaper(this.value)" class="${inputCls} w-40">
            ${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
          <button onclick="printCurrentReceipt()" class="bg-emerald-500 hover:bg-emerald-400 text-black font-black px-4 py-2 rounded-xl text-sm"><i class="fa-solid fa-print ml-1"></i>طباعة</button>
        </div>
        <div class="overflow-x-auto bg-slate-200 rounded-2xl p-3"><div id="rcPreview"></div></div>
        <div id="rcVoidBox" class="mt-3 flex flex-wrap gap-2 items-center">
          <input id="rcVoidReason" maxlength="80" placeholder="سبب الإلغاء" class="${inputCls} flex-1 min-w-[160px]">
          <button onclick="voidCurrentReceipt()" class="bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 px-3 py-2 rounded-xl text-xs font-bold">إلغاء الوصل</button>
        </div>
        <p id="rcVoidNote" class="text-[11px] text-slate-400 mt-2">ملاحظة: إلغاء وصل اشتراك/تجديد/تسديد لا يعدّل أرصدة اللاعب تلقائياً؛ عدّلها يدوياً من الحسابات إن لزم. وصل الإيراد المتفرق يُحذف إيراده تلقائياً عند الإلغاء.</p>
      </div>
    </div>

    <div id="rcCloseModal" class="fixed inset-0 modal-backdrop z-50 hidden flex items-center justify-center p-4">
      <div class="card-bg w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white"><i class="fa-solid fa-cash-register text-amber-400 ml-2"></i>إغلاق الصندوق اليومي</h3>
          <button onclick="closeDailyCloseModal()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <input id="rcCloseDate" type="date" onchange="refreshDailyClose()" class="${inputCls} w-44" dir="ltr">
          <select id="rcClosePaper" onchange="refreshDailyClose()" class="${inputCls} w-40">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <button onclick="printDailyClose()" class="bg-emerald-500 hover:bg-emerald-400 text-black font-black px-4 py-2 rounded-xl text-sm"><i class="fa-solid fa-print ml-1"></i>طباعة</button>
        </div>
        <div class="overflow-x-auto bg-slate-200 rounded-2xl p-3"><div id="rcClosePreview"></div></div>
      </div>
    </div>

    <div id="rcSettingsModal" class="fixed inset-0 modal-backdrop z-50 hidden flex items-center justify-center p-4">
      <div class="card-bg w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white"><i class="fa-solid fa-sliders text-sky-400 ml-2"></i>إعدادات الوصولات</h3>
          <button onclick="closeReceiptSettingsModal()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="${lblCls}">رمز العملة</label><input id="rsCurrencyLabel" maxlength="10" class="${inputCls}"></div>
          <div><label class="${lblCls}">اسم العملة (للكتابة بالحروف)</label><input id="rsCurrencyName" maxlength="20" class="${inputCls}"></div>
          <div><label class="${lblCls}">نسبة الضريبة % (0 = بدون)</label><input id="rsTax" type="number" min="0" max="100" step="0.5" class="${inputCls}"></div>
          <div><label class="${lblCls}">بادئة رقم الوصل</label><input id="rsPrefix" maxlength="8" class="${inputCls}" dir="ltr"></div>
          <div><label class="${lblCls}">حجم الورق الافتراضي</label><select id="rsPaper" class="${inputCls}">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div><label class="${lblCls}">طريقة الدفع الافتراضية</label><select id="rsMethod" class="${inputCls}">${methodOptions('cash')}</select></div>
        </div>
        <div class="mt-3"><label class="${lblCls}">إصدار الوصل</label>
          <select id="rsIssueMode" class="${inputCls}">
            <option value="auto">تلقائي (مع إمكانية التخطي في كل عملية)</option>
            <option value="ask">اسألني عند تسديد الديون</option>
            <option value="off">متوقف افتراضياً (يمكن تفعيله في كل عملية على حدة)</option>
          </select></div>
        <div class="mt-3"><label class="${lblCls}">هاتف القاعة على الوصل</label><input id="rsPhone" maxlength="30" class="${inputCls}" dir="ltr"></div>
        <div class="mt-3"><label class="${lblCls}">نص أسفل الوصل</label><input id="rsFooter" maxlength="120" class="${inputCls}"></div>
        <div class="mt-3"><label class="${lblCls}">شعار القاعة على الوصل (اختياري)</label>
          <div class="flex items-center gap-2"><input id="rsLogoFile" type="file" accept="image/png,image/jpeg,image/webp" onchange="handleReceiptLogo(event)" class="text-xs text-slate-300 flex-1">
          <button type="button" onclick="clearReceiptLogo()" class="text-rose-300 text-xs font-bold">حذف</button></div>
          <img id="rsLogoPreview" alt="" style="display:none;max-height:56px;background:#fff;border-radius:8px;padding:4px;margin-top:6px"></div>
        <div class="mt-3 space-y-2 text-xs text-slate-200">
          <label class="flex items-center gap-2"><input type="checkbox" id="rsAutoOpen"> فتح الوصل تلقائياً بعد كل عملية دفع</label>
          <label class="flex items-center gap-2"><input type="checkbox" id="rsWords"> إظهار المبلغ كتابةً</label>
          <label class="flex items-center gap-2"><input type="checkbox" id="rsDebt"> إظهار رصيد دين العضو على الوصل</label>
        </div>
        <p class="text-[11px] text-slate-400 mt-3">اسم القاعة والفرع والمشرف والختم تؤخذ من «تخصيص القاعة». الضريبة تُحتسب ضمن الإجمالي (شاملة) ولا تغيّر المبالغ المدفوعة.</p>
        <div class="pt-3 flex gap-3">
          <button onclick="saveReceiptSettings()" class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-black py-2.5 rounded-xl">حفظ</button>
          <button onclick="closeReceiptSettingsModal()" class="px-5 bg-slate-800 text-slate-300 font-bold rounded-xl">إلغاء</button>
        </div>
      </div>
    </div>

    <div id="rcMiscModal" class="fixed inset-0 modal-backdrop z-50 hidden flex items-center justify-center p-4">
      <div class="card-bg w-full max-w-md rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white">وصل إيراد متفرق</h3>
          <button onclick="closeMiscReceiptModal()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="space-y-3">
          <div><label class="${lblCls}">اسم الزبون</label><input id="rmName" maxlength="80" class="${inputCls}"></div>
          <div><label class="${lblCls}">البيان (مكملات، مشروبات، دخول يومي...)</label><input id="rmDesc" maxlength="100" class="${inputCls}"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="${lblCls}">المبلغ</label><input id="rmAmount" type="number" min="1" step="250" class="${inputCls}"></div>
            <div><label class="${lblCls}">طريقة الدفع</label><select id="rmMethod" class="${inputCls}">${methodOptions('cash')}</select></div>
          </div>
          <p class="text-[11px] text-slate-400">يُسجَّل المبلغ تلقائياً كإيراد في الحسابات.</p>
          <button onclick="createMiscReceipt()" class="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black py-2.5 rounded-xl">إصدار الوصل</button>
        </div>
      </div>
    </div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    const printArea = document.createElement('div');
    printArea.id = 'receiptPrint';
    document.body.appendChild(printArea);
  }

  function injectSidebarButton() {
    const anchor = document.querySelector('#desktopSidebar button[onclick*="openFinanceModal(\'customize\')"]');
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.className = 'sidebar-link';
    btn.setAttribute('onclick', 'openReceiptsModal(); closeMobileMenu();');
    btn.innerHTML = '<i class="fa-solid fa-receipt"></i><span>الوصولات</span>';
    anchor.insertAdjacentElement('afterend', btn);
  }

  // ---------- سجل الوصولات ----------
  window.openReceiptsModal = function () {
    ensureStore();
    $('rcListModal').classList.remove('hidden');
    renderReceiptsList();
  };
  window.closeReceiptsModal = function () { $('rcListModal').classList.add('hidden'); };

  window.renderReceiptsList = function () {
    ensureStore();
    const s = getSettings();
    const q = ($('rcSearch').value || '').trim().toLowerCase();
    const month = $('rcMonth').value;
    const list = financeLedger.receipts.filter(r => {
      if (month && !String(r.date).startsWith(month)) return false;
      if (!q) return true;
      return [r.no, r.playerName, r.playerCode, r.description].some(v => String(v || '').toLowerCase().includes(q));
    });
    const valid = list.filter(r => !r.voided);
    const totalPaid = valid.reduce((a, r) => a + (Number(r.paid) || 0), 0);
    const totalTax = valid.reduce((a, r) => a + (Number(r.tax) || 0), 0);
    const totalDiscount = valid.reduce((a, r) => a + (Number(r.discount) || 0), 0);
    $('rcSummary').innerHTML = `عدد الوصولات: <b>${list.length}</b> (الملغاة ${list.length - valid.length}) · المقبوض: <b class="text-emerald-400">${money(totalPaid, s)}</b> · الخصومات: <b class="text-amber-400">${money(totalDiscount, s)}</b> · الضريبة: <b>${money(totalTax, s)}</b>`;
    $('rcRows').innerHTML = list.length === 0
      ? '<tr><td colspan="8" class="p-4 text-center text-slate-500">لا توجد وصولات.</td></tr>'
      : list.slice(0, 300).map(r => `<tr class="border-t border-slate-800 ${r.voided ? 'opacity-50 line-through' : ''}">
          <td class="p-2" dir="ltr">${esc(r.no)}</td><td class="p-2" dir="ltr">${esc(r.date)}</td>
          <td class="p-2">${esc(r.playerName)}</td><td class="p-2">${esc(TYPES[r.type] || '')}</td>
          <td class="p-2">${fmt(r.total)}</td><td class="p-2">${fmt(r.paid)}</td>
          <td class="p-2">${r.voided ? 'ملغي' : (r.remaining > 0 ? 'متبقي ' + fmt(r.remaining) : 'مسدد')}</td>
          <td class="p-2"><button onclick="openReceiptView('${esc(r.id)}')" class="text-sky-300 font-bold">عرض / طباعة</button></td></tr>`).join('');
  };

  // ---------- معاينة / طباعة ----------
  function findReceipt(id) { return (financeLedger.receipts || []).find(r => r.id === id); }

  window.openReceiptView = function (id) {
    const rec = findReceipt(id);
    if (!rec) return;
    viewingId = id;
    viewingPaper = getSettings().paper;
    $('rcPaper').value = viewingPaper;
    $('rcVoidReason').value = '';
    refreshView();
    $('rcViewModal').classList.remove('hidden');
  };

  function refreshView() {
    const rec = findReceipt(viewingId);
    if (!rec) return;
    $('rcPreview').innerHTML = renderReceiptHtml(rec, viewingPaper);
    $('rcVoidBox').style.display = rec.voided ? 'none' : 'flex';
    $('rcVoidNote').style.display = rec.voided ? 'none' : 'block';
  }

  window.closeReceiptView = function () { $('rcViewModal').classList.add('hidden'); };
  window.changeReceiptPaper = function (paper) { viewingPaper = PAPERS[paper] ? paper : '80mm'; refreshView(); };

  function setPageStyle(paper) {
    let el = $('receiptPageStyle');
    if (!el) { el = document.createElement('style'); el.id = 'receiptPageStyle'; document.head.appendChild(el); }
    const size = paper === '80mm' ? '80mm auto' : paper;
    const margin = paper === '80mm' ? '2mm' : '10mm';
    el.textContent = `@page { size: ${size}; margin: ${margin}; }`;
  }

  window.printCurrentReceipt = function () {
    const rec = findReceipt(viewingId);
    if (!rec) return;
    logActivity(`طباعة الوصل ${rec.no}`);
    printHtml(renderReceiptHtml(rec, viewingPaper), viewingPaper);
    rec.printCount = (rec.printCount || 0) + 1; // الطبعات اللاحقة تظهر كـ "نسخة"
    persist();
    refreshView();
  };

  function printHtml(html, paper) {
    $('receiptPrint').innerHTML = html;
    setPageStyle(paper);
    document.body.dataset.printMode = 'receipt';
    const cleanup = () => {
      delete document.body.dataset.printMode;
      const pageStyle = $('receiptPageStyle');
      if (pageStyle) pageStyle.textContent = '';
      $('receiptPrint').innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  // ---------- إغلاق الصندوق اليومي ----------
  function buildDailyClose(date) {
    const s = getSettings();
    const recs = (financeLedger.receipts || []).filter(r => r.date === date && !r.voided);
    const voided = (financeLedger.receipts || []).filter(r => r.date === date && r.voided).length;
    const byMethod = {};
    recs.forEach(r => { byMethod[r.method] = (byMethod[r.method] || 0) + (Number(r.paid) || 0); });
    const collected = recs.reduce((a, r) => a + (Number(r.paid) || 0), 0);
    const discounts = recs.reduce((a, r) => a + (Number(r.discount) || 0), 0);
    const tax = recs.reduce((a, r) => a + (Number(r.tax) || 0), 0);
    const byType = {};
    recs.forEach(r => { byType[r.type] = (byType[r.type] || 0) + (Number(r.paid) || 0); });
    const expenses = (financeLedger.transactions || [])
      .filter(t => t.type === 'expense' && t.date === date)
      .reduce((a, t) => a + (Number(t.amount) || 0), 0);
    const cash = byMethod.cash || 0;
    return { s, date, count: recs.length, voided, byMethod, byType, collected, discounts, tax, expenses, cash, expectedCash: cash - expenses };
  }

  function renderDailyCloseHtml(c, paper) {
    const s = c.s;
    const cls = paper === '80mm' ? 'p80' : (paper === 'A5' ? 'pA5' : 'pA4');
    const rowsM = Object.entries(c.byMethod).map(([k, v]) => `<tr><td>${esc(METHODS[k] || k)}</td><td class="n">${money(v, s)}</td></tr>`).join('');
    const rowsT = Object.entries(c.byType).map(([k, v]) => `<tr><td>${esc(TYPES[k] || k)}</td><td class="n">${money(v, s)}</td></tr>`).join('');
    return `<div class="rcpt ${cls}" dir="rtl">
      <div class="hd"><div class="gn">${esc(gymProfile.gymName)}</div><div class="gb">${esc(gymProfile.gymBranch)}</div></div>
      <div class="ttl">إغلاق الصندوق اليومي</div>
      <div class="line"><span>التاريخ</span><b dir="ltr">${esc(c.date)}</b></div>
      <div class="line"><span>عدد الوصولات</span><b>${c.count}${c.voided ? ` (ملغاة: ${c.voided})` : ''}</b></div>
      <table class="it"><thead><tr><th>حسب طريقة الدفع</th><th class="n">المبلغ</th></tr></thead><tbody>${rowsM || '<tr><td colspan="2">لا توجد حركات</td></tr>'}</tbody></table>
      <table class="it"><thead><tr><th>حسب النوع</th><th class="n">المبلغ</th></tr></thead><tbody>${rowsT || '<tr><td colspan="2">-</td></tr>'}</tbody></table>
      <table class="tt"><tbody>
        <tr class="big"><td>إجمالي المقبوض</td><td class="n">${money(c.collected, s)}</td></tr>
        <tr><td>الخصومات الممنوحة</td><td class="n">${money(c.discounts, s)}</td></tr>
        <tr><td>الضريبة المشمولة</td><td class="n">${money(c.tax, s)}</td></tr>
        <tr><td>مصروفات اليوم</td><td class="n">${money(c.expenses, s)}</td></tr>
        <tr class="big"><td>المتوقع في الصندوق (نقداً − مصروفات)</td><td class="n">${money(c.expectedCash, s)}</td></tr>
      </tbody></table>
      <div class="sg"><div>المسؤول: <b>${esc(gymProfile.supervisorName || 'إدارة القاعة')}</b></div><div>التوقيع: ..........</div></div>
      <div class="ft">${esc(s.footer)}</div></div>`;
  }

  window.openDailyCloseModal = function () {
    $('rcCloseDate').value = getTodayDateString();
    $('rcCloseModal').classList.remove('hidden');
    refreshDailyClose();
  };
  window.closeDailyCloseModal = function () { $('rcCloseModal').classList.add('hidden'); };
  window.refreshDailyClose = function () {
    const date = $('rcCloseDate').value;
    if (!isValidDateString(date)) return;
    $('rcClosePreview').innerHTML = renderDailyCloseHtml(buildDailyClose(date), $('rcClosePaper').value);
  };
  window.printDailyClose = function () {
    const date = $('rcCloseDate').value;
    if (!isValidDateString(date)) { showToast('اختر تاريخاً صحيحاً.', 'warning'); return; }
    const paper = $('rcClosePaper').value;
    logActivity(`طباعة إغلاق الصندوق ليوم ${date}`);
    printHtml(renderDailyCloseHtml(buildDailyClose(date), paper), paper);
  };

  // ---------- شعار الوصل ----------
  let pendingLogo = null; // null = بدون تغيير
  window.handleReceiptLogo = function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { showToast('اختر صورة PNG أو JPG.', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 240 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        pendingLogo = canvas.toDataURL('image/png');
        $('rsLogoPreview').src = pendingLogo;
        $('rsLogoPreview').style.display = 'block';
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  window.clearReceiptLogo = function () {
    pendingLogo = '';
    $('rsLogoPreview').style.display = 'none';
    $('rsLogoFile').value = '';
  };

  window.voidCurrentReceipt = function () {
    const rec = findReceipt(viewingId);
    if (!rec || rec.voided) return;
    const reason = $('rcVoidReason').value.trim().slice(0, 80);
    if (!reason) { showToast('اكتب سبب الإلغاء أولاً.', 'warning'); return; }
    if (!confirm(`إلغاء الوصل ${rec.no} نهائياً؟`)) return;
    const prevTx = financeLedger.transactions;
    rec.voided = true;
    rec.voidReason = reason;
    rec.voidedAt = new Date().toISOString();
    if (rec.type === 'misc' && rec.txId) {
      financeLedger.transactions = (financeLedger.transactions || []).filter(t => t.id !== rec.txId);
    }
    if (!persist()) {
      rec.voided = false; delete rec.voidReason; delete rec.voidedAt;
      financeLedger.transactions = prevTx;
      return;
    }
    logActivity(`إلغاء الوصل ${rec.no}: ${reason}`);
    showToast('تم إلغاء الوصل.', 'info');
    refreshView();
    if (!$('rcListModal').classList.contains('hidden')) renderReceiptsList();
  };

  // ---------- الإعدادات ----------
  window.openReceiptSettingsModal = function () {
    const s = getSettings();
    $('rsCurrencyLabel').value = s.currencyLabel;
    $('rsCurrencyName').value = s.currencyName;
    $('rsTax').value = s.taxPercent;
    $('rsPrefix').value = s.prefix;
    $('rsPaper').value = s.paper;
    $('rsMethod').value = s.defaultMethod;
    $('rsPhone').value = s.phone;
    $('rsFooter').value = s.footer;
    $('rsAutoOpen').checked = !!s.autoOpen;
    $('rsWords').checked = !!s.showAmountWords;
    $('rsDebt').checked = !!s.showDebtBalance;
    $('rsIssueMode').value = s.issueMode;
    pendingLogo = null;
    $('rsLogoFile').value = '';
    $('rsLogoPreview').src = s.logo || '';
    $('rsLogoPreview').style.display = s.logo ? 'block' : 'none';
    $('rcSettingsModal').classList.remove('hidden');
  };
  window.closeReceiptSettingsModal = function () { $('rcSettingsModal').classList.add('hidden'); };
  window.saveReceiptSettings = function () {
    ensureStore();
    const prev = financeLedger.receiptSettings;
    financeLedger.receiptSettings = {
      currencyLabel: $('rsCurrencyLabel').value.trim().slice(0, 10) || DEFAULTS.currencyLabel,
      currencyName: $('rsCurrencyName').value.trim().slice(0, 20) || DEFAULTS.currencyName,
      taxPercent: Math.min(100, Math.max(0, Number($('rsTax').value) || 0)),
      prefix: ($('rsPrefix').value.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 8)) || DEFAULTS.prefix,
      paper: $('rsPaper').value,
      defaultMethod: $('rsMethod').value,
      phone: $('rsPhone').value.trim().slice(0, 30),
      footer: $('rsFooter').value.trim().slice(0, 120),
      autoOpen: $('rsAutoOpen').checked,
      showAmountWords: $('rsWords').checked,
      showDebtBalance: $('rsDebt').checked,
      issueMode: ['auto', 'ask', 'off'].includes($('rsIssueMode').value) ? $('rsIssueMode').value : 'auto',
      logo: pendingLogo === null ? (prev.logo || '') : pendingLogo
    };
    if (!persist()) { financeLedger.receiptSettings = prev; return; }
    logActivity('تحديث إعدادات الوصولات');
    showToast('تم حفظ إعدادات الوصولات ✅', 'success');
    closeReceiptSettingsModal();
    updateNextReceiptHints();
  };

  // ---------- وصل إيراد متفرق ----------
  window.openMiscReceiptModal = function () {
    $('rmName').value = ''; $('rmDesc').value = ''; $('rmAmount').value = '';
    $('rmMethod').value = getSettings().defaultMethod;
    $('rcMiscModal').classList.remove('hidden');
  };
  window.closeMiscReceiptModal = function () { $('rcMiscModal').classList.add('hidden'); };
  window.createMiscReceipt = function () {
    const desc = $('rmDesc').value.trim();
    const amount = toInt($('rmAmount').value);
    if (!desc || amount <= 0) { showToast('أدخل البيان ومبلغاً صحيحاً.', 'warning'); return; }
    ensureStore();
    const tx = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: desc.slice(0, 100), type: 'income', amount, date: getTodayDateString()
    };
    financeLedger.transactions.unshift(tx);
    const rec = issueReceipt({
      type: 'misc', paid: amount, debt: 0, discount: 0, taxable: true,
      payerName: $('rmName').value.trim() || 'زبون', description: desc,
      method: $('rmMethod').value, txId: tx.id
    });
    if (!rec) {
      financeLedger.transactions = financeLedger.transactions.filter(t => t.id !== tx.id);
      return;
    }
    closeMiscReceiptModal();
    if (typeof renderFinanceSummary === 'function') renderFinanceSummary();
    renderReceiptsList();
  };

  // ---------- دمج الخصم وطريقة الدفع في نوافذ الاشتراك والتجديد ----------
  function extraFieldsHtml(prefix) {
    return `
      <div class="grid grid-cols-2 gap-3" id="${prefix}Extra">
        <div>
          <label class="block text-xs font-bold text-amber-400 mb-1">الخصم (يُخصم من سعر الباقة)</label>
          <input type="number" id="${prefix}Discount" min="0" step="500" value="0" class="${inputCls}">
        </div>
        <div>
          <label class="block text-xs font-bold text-sky-400 mb-1">طريقة الدفع</label>
          <select id="${prefix}Method" class="${inputCls}">${methodOptions(getSettings().defaultMethod)}</select>
        </div>
        <div class="col-span-2">
          <label class="flex items-center gap-2 text-xs font-bold text-emerald-300"><input type="checkbox" id="${prefix}Issue" ${getSettings().issueMode === 'off' ? '' : 'checked'}> إصدار وصل لهذه العملية (ألغِ التحديد لتخطي الوصل)</label>
        </div>
        <div class="col-span-2 text-[11px] text-slate-400" id="${prefix}Hint"></div>
      </div>`;
  }

  // الحساب: المدفوع = سعر الباقة - الخصم - المتبقي
  function autoAdjustPaid(cfg) {
    const months = String(cfg.months());
    const list = Number(gymProfile.defaultPrices?.[months]) || 0;
    if (!list) return;
    const disc = toInt($(cfg.disc).value);
    const debt = toInt($(cfg.debt).value);
    $(cfg.paid).value = Math.max(0, list - disc - debt);
    updateHints();
  }

  function updateHint(cfg) {
    const el = $(cfg.hint);
    if (!el) return;
    const s = getSettings();
    const paid = toInt($(cfg.paid).value);
    const debt = toInt($(cfg.debt).value);
    const a = computeAmounts({ paid, debt, discount: $(cfg.disc).value, taxable: true }, s);
    const oldDebt = cfg.oldDebt ? cfg.oldDebt() : 0;
    el.innerHTML = `الوصل القادم: <b dir="ltr">${esc(formatNo(s.prefix, nextSerial()))}</b> · الإجمالي: <b>${money(a.total, s)}</b>` +
      (a.discount ? ` · الخصم: <b>${money(a.discount, s)}</b>` : '') +
      (a.tax ? ` · الضريبة (${s.taxPercent}%): <b>${money(a.tax, s)}</b>` : '') +
      (oldDebt ? ` · <span class="text-rose-300">دين سابق على العضو: ${money(oldDebt, s)} (يبقى ويضاف إليه المتبقي)</span>` : '');
  }

  const renewCfg = {
    paid: 'renewPaidAmount', debt: 'renewDebtAmount', disc: 'rcRenewDiscount', method: 'rcRenewMethod', hint: 'rcRenewHint',
    months: () => parseInt($('renewDurationMonths').value, 10) || 1,
    oldDebt: () => {
      const p = players.find(x => x.id === $('renewPlayerId').value);
      return p ? toInt(p.debtAmount) : 0;
    }
  };
  const newCfg = {
    paid: 'paidAmount', debt: 'debtAmount', disc: 'rcNewDiscount', method: 'rcNewMethod', hint: 'rcNewHint',
    months: () => parseInt($('durationMonths').value, 10) || 1
  };

  function updateHints() {
    if ($('rcRenewHint')) updateHint(renewCfg);
    if ($('rcNewHint')) updateHint(newCfg);
  }
  function updateNextReceiptHints() { updateHints(); }

  function injectFormFields() {
    // نافذة التجديد
    const renewDebt = $('renewDebtAmount');
    if (renewDebt) {
      const grid = renewDebt.closest('.grid');
      if (grid) grid.insertAdjacentHTML('afterend', extraFieldsHtml('rcRenew').replace('id="rcRenewExtra"', 'id="rcRenewExtra"'));
      $('rcRenewDiscount').addEventListener('input', () => autoAdjustPaid(renewCfg));
      renewDebt.addEventListener('input', () => autoAdjustPaid(renewCfg));
      $('renewPaidAmount').addEventListener('input', updateHints);
    }
    // نافذة لاعب جديد
    const debt = $('debtAmount');
    if (debt) {
      const grid = debt.closest('.grid');
      if (grid) grid.insertAdjacentHTML('afterend', extraFieldsHtml('rcNew'));
      $('rcNewDiscount').addEventListener('input', () => { if (!$('editingPlayerId').value) autoAdjustPaid(newCfg); });
      debt.addEventListener('input', () => { if (!$('editingPlayerId').value && toInt($('rcNewDiscount').value) > 0) autoAdjustPaid(newCfg); else updateHints(); });
      $('paidAmount').addEventListener('input', updateHints);
    }
  }

  // ---------- ربط العمليات الحالية بإصدار الوصولات ----------
  function wrapHooks() {
    const origRenew = window.confirmRenewSubscription;
    window.confirmRenewSubscription = async function () {
      const playerId = $('renewPlayerId').value;
      const startDate = $('renewStartDate').value;
      const endDate = $('renewEndDate').value;
      const months = parseInt($('renewDurationMonths').value, 10) || 1;
      const paid = toInt($('renewPaidAmount').value);
      const debt = toInt($('renewDebtAmount').value);
      const discount = toInt($('rcRenewDiscount')?.value);
      const method = $('rcRenewMethod')?.value;
      const wantReceipt = $('rcRenewIssue') ? $('rcRenewIssue').checked : true;
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      if (!isValidDateString(startDate) || !isValidDateString(endDate) || endDate <= startDate) {
        showToast('تواريخ التجديد غير صحيحة: يجب أن يكون الانتهاء بعد البداية.', 'warning');
        return;
      }
      if (paid + debt <= 0 && !confirm('مبلغ التجديد صفر. هل تريد المتابعة بدون مبلغ؟')) return;
      const before = player.updatedAt;
      const planType = player.planType;
      try {
        await origRenew.apply(this, arguments);
      } finally {
        const after = players.find(p => p.id === playerId);
        if (wantReceipt && after && after.updatedAt !== before && after.endDate === endDate) {
          issueReceipt({
            type: 'renewal', playerId, paid, debt, discount, taxable: true, method,
            description: `تجديد اشتراك - ${planType}`, startDate, endDate, durationMonths: months
          });
        }
      }
    };

    const origSave = window.savePlayer;
    window.savePlayer = async function (event) {
      const editing = $('editingPlayerId').value;
      const knownIds = new Set(players.map(p => p.id));
      const discount = toInt($('rcNewDiscount')?.value);
      const method = $('rcNewMethod')?.value;
      const wantReceipt = $('rcNewIssue') ? $('rcNewIssue').checked : true;
      try {
        await origSave.apply(this, arguments);
      } finally {
        if (!editing && wantReceipt) {
          const created = players.find(p => !knownIds.has(p.id));
          if (created && (created.paidAmount > 0 || created.debtAmount > 0)) {
            issueReceipt({
              type: 'subscription', playerId: created.id, paid: created.paidAmount, debt: created.debtAmount,
              discount, taxable: true, method, description: `اشتراك جديد - ${created.planType}`,
              startDate: created.startDate, endDate: created.endDate, durationMonths: created.durationMonths
            });
          }
        }
      }
    };

    const origDebtPay = window.recordPlayerDebtPayment;
    window.recordPlayerDebtPayment = function (playerId) {
      const player = players.find(p => p.id === playerId);
      const debtBefore = player ? toInt(player.debtAmount) : 0;
      const result = origDebtPay.apply(this, arguments);
      const after = players.find(p => p.id === playerId);
      if (after) {
        const paid = debtBefore - toInt(after.debtAmount);
        if (paid > 0) {
          const mode = getSettings().issueMode;
          const issue = mode === 'off' ? false : (mode === 'ask' ? confirm('تم تسجيل التسديد. هل تريد إصدار وصل؟') : true);
          if (issue) issueReceipt({
            type: 'debt_payment', playerId, paid, debt: 0, discount: 0, taxable: false,
            description: 'تسديد دفعة من الدين'
          });
        }
      }
      return result;
    };

    const origOpenRenew = window.openRenewModal;
    window.openRenewModal = function () {
      origOpenRenew.apply(this, arguments);
      if ($('rcRenewDiscount')) $('rcRenewDiscount').value = '0';
      if ($('rcRenewMethod')) $('rcRenewMethod').value = getSettings().defaultMethod;
      if ($('rcRenewIssue')) $('rcRenewIssue').checked = getSettings().issueMode !== 'off';
      updateHints();
    };
    const origCalcRenew = window.calculateRenewEndDate;
    window.calculateRenewEndDate = function () {
      origCalcRenew.apply(this, arguments);
      if ($('rcRenewDiscount') && toInt($('rcRenewDiscount').value) > 0) autoAdjustPaid(renewCfg);
      else updateHints();
    };
    const origOpenAdd = window.openAddModal;
    window.openAddModal = function () {
      origOpenAdd.apply(this, arguments);
      if ($('rcNewDiscount')) $('rcNewDiscount').value = '0';
      if ($('rcNewMethod')) $('rcNewMethod').value = getSettings().defaultMethod;
      if ($('rcNewIssue')) $('rcNewIssue').checked = getSettings().issueMode !== 'off';
      if ($('rcNewExtra')) $('rcNewExtra').style.display = '';
      updateHints();
    };
    const origOpenEdit = window.openEditModal;
    window.openEditModal = function () {
      origOpenEdit.apply(this, arguments);
      if ($('rcNewExtra')) $('rcNewExtra').style.display = 'none';
    };
    const origApplyDefault = window.applyDefaultPriceForDuration;
    window.applyDefaultPriceForDuration = function () {
      origApplyDefault.apply(this, arguments);
      if (!$('editingPlayerId').value && toInt($('rcNewDiscount')?.value) > 0) autoAdjustPaid(newCfg);
      else updateHints();
    };
  }

  // اختبارات ذاتية للحسابات (تظهر في الكونسول فقط عند الفشل)
  function selfTest() {
    const s = { ...DEFAULTS, taxPercent: 10 };
    const a = computeAmounts({ paid: 90000, debt: 10000, discount: 5000, taxable: true }, s);
    const ok = a.total === 100000 && a.listPrice === 105000 && a.tax === 9091 && a.subtotal + a.tax === a.total &&
      numberToArabicWords(25000) === 'خمسة وعشرون ألف' && numberToArabicWords(1250000) === 'مليون ومئتان وخمسون ألف';
    if (!ok) console.warn('Receipt self-test failed', a, numberToArabicWords(25000), numberToArabicWords(1250000));
  }

  function init() {
    ensureStore();
    injectStyles();
    injectModals();
    injectSidebarButton();
    injectFormFields();
    wrapHooks();
    selfTest();
  }

  window.PowerGymReceipts = { numberToArabicWords, computeAmounts, issueReceipt };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
