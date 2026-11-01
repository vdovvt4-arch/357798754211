'use strict';
// =========================================================
// التقارير الشهرية - Power Gym
// يعتمد على المتغيرات العامة في app.js: players, financeLedger, gymProfile
// وعلى الدوال: escapeHtml, getTodayDateString, getSubscriptionStatus,
// calculateFinancialMetrics, showToast, logActivity, ARABIC_MONTHS
// =========================================================
(function () {

  // ---------- أدوات مساعدة ----------
  function currentMonth() {
    return getTodayDateString().slice(0, 7); // YYYY-MM
  }

  function inMonth(dateStr, ym) {
    return typeof dateStr === 'string' && dateStr.slice(0, 7) === ym;
  }

  function lastDayOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m, 0).getDate();
    return `${ym}-${String(d).padStart(2, '0')}`;
  }

  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${ARABIC_MONTHS[m - 1]} ${y}`;
  }

  function money(n) {
    return `${Number(n || 0).toLocaleString('en-US')} د.ع`;
  }

  function sumBy(list, fn) {
    return list.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
  }

  function groupBy(list, keyFn) {
    const out = {};
    list.forEach(item => {
      const key = keyFn(item);
      if (!out[key]) out[key] = { count: 0, revenue: 0 };
      out[key].count += 1;
      out[key].revenue += Number(item.paidAmount) || 0;
    });
    return out;
  }

  // ---------- حساب التقرير ----------
  function buildMonthlyReport(ym) {
    const end = lastDayOf(ym);
    const today = getTodayDateString();
    const ledger = financeLedger || {};

    const txs = (ledger.transactions || []).filter(t => inMonth(t.date, ym));
    const debtEntries = (ledger.debtEntries || []).filter(d => inMonth(d.date, ym));
    const debtPayments = (ledger.debtPayments || []).filter(d => inMonth(d.date, ym));

    // التجديدات المسجلة بتاريخ هذا الشهر
    const renewals = (ledger.renewals || []).filter(r => inMonth(r.date, ym));
    const renewedIds = new Set(renewals.map(r => r.playerId));
    // اشتراكات جديدة: بدأت هذا الشهر ولا لها تجديد مسجل بنفس الشهر
    const newPlayers = players.filter(p => inMonth(p.startDate, ym) && !renewedIds.has(p.id));
    // اشتراكات تنتهي هذا الشهر
    const expiring = players.filter(p => inMonth(p.endDate, ym));
    // الفعالين بآخر يوم من الشهر
    const activeAtEnd = players.filter(p => p.startDate <= end && p.endDate >= end);
    // لاعبين سجلوا حضور هذا الشهر (آخر حضور فقط)
    const checkedIn = players.filter(p => inMonth(p.lastCheckIn, ym));

    // paidAmount تتراكم مع تسديد الديون، فنطرح التسديدات الخاصة بنفس اللاعب خلال الشهر حتى لا تنحسب مرتين
    const debtPaidByPlayer = {};
    debtPayments.forEach(d => {
      debtPaidByPlayer[d.playerId] = (debtPaidByPlayer[d.playerId] || 0) + (Number(d.amount) || 0);
    });
    const subsRevenue = newPlayers.reduce((total, p) => {
      const net = (Number(p.paidAmount) || 0) - (debtPaidByPlayer[p.id] || 0);
      return total + Math.max(0, net);
    }, 0);

    const renewalsRevenue = renewals.reduce((total, r) => {
      return total + Math.max(0, Number(r.paidAmount) || 0);
    }, 0);

    const debtCollected = sumBy(debtPayments, d => d.amount);
    const otherIncome = sumBy(txs.filter(t => t.type !== 'expense'), t => t.amount);
    const expenses = sumBy(txs.filter(t => t.type === 'expense'), t => t.amount);
    const totalIncome = subsRevenue + renewalsRevenue + debtCollected + otherIncome;
    const net = totalIncome - expenses;
    const newDebts = sumBy(debtEntries, d => d.amount);
    const currentDebt = calculateFinancialMetrics().totalDebt;

    return {
      ym,
      end,
      generatedAt: new Date().toLocaleString('ar-IQ'),
      newPlayers,
      expiring,
      activeAtEnd,
      checkedIn,
      subsRevenue,
      renewals,
      renewalsRevenue,
      debtCollected,
      otherIncome,
      totalIncome,
      expenses,
      net,
      newDebts,
      currentDebt,
      byPlan: groupBy(newPlayers, p => p.planType || 'غير محدد'),
      byDuration: groupBy(newPlayers, p => `${Number(p.durationMonths) || 1} شهر`),
      txs,
      today
    };
  }

  // ---------- عرض التقرير (HTML) ----------
  function kpi(label, value, tone) {
    return `<div class="rpt-kpi ${tone || ''}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
  }

  function groupTable(title, groups) {
    const keys = Object.keys(groups).sort((a, b) => groups[b].count - groups[a].count);
    if (keys.length === 0) return `<div class="rpt-box"><h4>${escapeHtml(title)}</h4><p class="rpt-empty">لا توجد بيانات.</p></div>`;
    const rows = keys.map(k => `
      <tr><td>${escapeHtml(k)}</td><td class="num">${groups[k].count}</td><td class="num">${escapeHtml(money(groups[k].revenue))}</td></tr>`).join('');
    return `
      <div class="rpt-box">
        <h4>${escapeHtml(title)}</h4>
        <table class="rpt-table">
          <thead><tr><th>البند</th><th class="num">العدد</th><th class="num">المدفوع</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function playersTable(list, columns) {
    if (list.length === 0) return `<p class="rpt-empty">لا يوجد.</p>`;
    const head = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
    const body = list.map(p => `<tr>${columns.map(c => `<td>${escapeHtml(c.get(p))}</td>`).join('')}</tr>`).join('');
    return `<table class="rpt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderReportHtml(r) {
    const gymName = gymProfile.gymName || 'Power Gym';
    const branch = gymProfile.gymBranch || '';
    const expiringNow = r.expiring.filter(p => p.endDate >= r.today).length;
    const expiredAlready = r.expiring.length - expiringNow;

    const finRows = [
      ['إيرادات الاشتراكات الجديدة', money(r.subsRevenue)],
      ['إيرادات التجديدات', money(r.renewalsRevenue)],
      ['تحصيل ديون اللاعبين', money(r.debtCollected)],
      ['إيرادات أخرى (حركات يدوية)', money(r.otherIncome)],
      ['إجمالي الإيرادات', money(r.totalIncome)],
      ['المصاريف', money(r.expenses)],
      ['صافي الشهر', money(r.net)],
      ['ديون جديدة سُجلت خلال الشهر', money(r.newDebts)],
      ['إجمالي الديون الحالية (كل اللاعبين)', money(r.currentDebt)]
    ];
    const finTable = `
      <table class="rpt-table">
        <tbody>${finRows.map(([k, v], i) =>
          `<tr class="${i === 4 || i === 6 ? 'rpt-strong' : ''}"><td>${escapeHtml(k)}</td><td class="num">${escapeHtml(v)}</td></tr>`
        ).join('')}</tbody>
      </table>`;

    const newList = playersTable(r.newPlayers, [
      { label: 'الكود', get: p => p.code },
      { label: 'الاسم', get: p => p.name },
      { label: 'الموبايل', get: p => p.phone },
      { label: 'القسم', get: p => p.planType },
      { label: 'البدء', get: p => p.startDate },
      { label: 'الانتهاء', get: p => p.endDate },
      { label: 'المدفوع', get: p => money(p.paidAmount) }
    ]);

    const expList = playersTable(r.expiring, [
      { label: 'الكود', get: p => p.code },
      { label: 'الاسم', get: p => p.name },
      { label: 'الموبايل', get: p => p.phone },
      { label: 'الانتهاء', get: p => p.endDate },
      { label: 'الحالة', get: p => getSubscriptionStatus(p.endDate).label },
      { label: 'الدين', get: p => money(p.debtAmount) }
    ]);

    return `
      <div class="rpt-head">
        <div>
          <h2>التقرير الشهري</h2>
          <p class="rpt-sub">${escapeHtml(gymName)} ${branch ? '— ' + escapeHtml(branch) : ''}</p>
        </div>
        <div class="rpt-month">
          <b>${escapeHtml(monthLabel(r.ym))}</b>
          <span>من ${escapeHtml(r.ym)}-01 إلى ${escapeHtml(r.end)}</span>
        </div>
      </div>

      <div class="rpt-kpis">
        ${kpi('اشتراكات جديدة', r.newPlayers.length)}
        ${kpi('تجديدات', r.renewals.length)}
        ${kpi('فعالين بآخر الشهر', r.activeAtEnd.length, 'ok')}
        ${kpi('تنتهي هذا الشهر', r.expiring.length, 'warn')}
        ${kpi('صافي الشهر', money(r.net), r.net >= 0 ? 'ok' : 'bad')}
        ${kpi('الديون الحالية', money(r.currentDebt), r.currentDebt > 0 ? 'bad' : '')}
        ${kpi('سجلوا حضور', r.checkedIn.length)}
      </div>

      <div class="rpt-section">
        <h3>الملخص المالي</h3>
        ${finTable}
      </div>

      <div class="rpt-section rpt-two">
        ${groupTable('الاشتراكات حسب القسم', r.byPlan)}
        ${groupTable('الاشتراكات حسب المدة', r.byDuration)}
      </div>

      <div class="rpt-section">
        <h3>الاشتراكات الجديدة (${r.newPlayers.length})</h3>
        ${newList}
      </div>

      <div class="rpt-section">
        <h3>التجديدات (${r.renewals.length})</h3>
        ${r.renewals.length === 0 ? '<p class="rpt-empty">لا توجد تجديدات هذا الشهر.</p>' : playersTable(r.renewals, [
          { label: 'التاريخ', get: x => x.date },
          { label: 'الاسم', get: x => x.playerName },
          { label: 'المدة', get: x => `${x.durationMonths} شهر` },
          { label: 'البدء', get: x => x.startDate },
          { label: 'الانتهاء', get: x => x.endDate },
          { label: 'المدفوع', get: x => money(x.paidAmount) }
        ])}
      </div>

      <div class="rpt-section">
        <h3>الاشتراكات التي تنتهي هذا الشهر (${r.expiring.length})</h3>
        <p class="rpt-note">منها منتهية حالياً: ${expiredAlready} — تنتهي لاحقاً: ${expiringNow}</p>
        ${expList}
      </div>

      <div class="rpt-section">
        <h3>حركات مالية الشهر (${r.txs.length})</h3>
        ${r.txs.length === 0 ? '<p class="rpt-empty">لا توجد حركات يدوية.</p>' : playersTable(r.txs, [
          { label: 'التاريخ', get: t => t.date },
          { label: 'النوع', get: t => t.type === 'expense' ? 'مصروف' : 'إيراد' },
          { label: 'البيان', get: t => t.title },
          { label: 'المبلغ', get: t => money(t.amount) }
        ])}
      </div>

      <p class="rpt-foot">
        ملاحظات: التجديدات تُحسب بتاريخ التجديد نفسه، والاشتراكات الجديدة بتاريخ بدء الاشتراك. التجديدات السابقة لهذا الإصدار ما كانت مسجلة فلا تظهر.
        حضور الشهر يعتمد على آخر تسجيل حضور لكل لاعب.
        تاريخ إنشاء التقرير: ${escapeHtml(r.generatedAt)}
      </p>`;
  }

  // ---------- تصدير CSV ----------
  function reportToCsv(r) {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [];
    rows.push(['تقرير شهري', monthLabel(r.ym)]);
    rows.push(['المركز', gymProfile.gymName || 'Power Gym']);
    rows.push([]);
    rows.push(['الملخص المالي', 'القيمة']);
    rows.push(['إيرادات الاشتراكات الجديدة', r.subsRevenue]);
    rows.push(['إيرادات التجديدات', r.renewalsRevenue]);
    rows.push(['تحصيل ديون', r.debtCollected]);
    rows.push(['إيرادات أخرى', r.otherIncome]);
    rows.push(['إجمالي الإيرادات', r.totalIncome]);
    rows.push(['المصاريف', r.expenses]);
    rows.push(['صافي الشهر', r.net]);
    rows.push(['ديون جديدة', r.newDebts]);
    rows.push(['إجمالي الديون الحالية', r.currentDebt]);
    rows.push([]);
    rows.push(['الاشتراكات الجديدة']);
    rows.push(['الكود', 'الاسم', 'الموبايل', 'القسم', 'المدة (شهر)', 'البدء', 'الانتهاء', 'المدفوع', 'الدين']);
    r.newPlayers.forEach(p => rows.push([p.code, p.name, p.phone, p.planType, p.durationMonths, p.startDate, p.endDate, p.paidAmount, p.debtAmount]));
    rows.push([]);
    rows.push(['التجديدات']);
    rows.push(['التاريخ', 'الاسم', 'المدة (شهر)', 'البدء', 'الانتهاء', 'المدفوع']);
    r.renewals.forEach(x => rows.push([x.date, x.playerName, x.durationMonths, x.startDate, x.endDate, x.paidAmount]));
    rows.push([]);
    rows.push(['الاشتراكات التي تنتهي هذا الشهر']);
    rows.push(['الكود', 'الاسم', 'الموبايل', 'الانتهاء', 'الدين']);
    r.expiring.forEach(p => rows.push([p.code, p.name, p.phone, p.endDate, p.debtAmount]));
    rows.push([]);
    rows.push(['حركات مالية']);
    rows.push(['التاريخ', 'النوع', 'البيان', 'المبلغ']);
    r.txs.forEach(t => rows.push([t.date, t.type === 'expense' ? 'مصروف' : 'إيراد', t.title, t.amount]));
    // BOM حتى يفتح Excel النص العربي صح
    return '﻿' + rows.map(row => row.map(q).join(',')).join('\r\n');
  }

  async function saveTextFile(defaultName, text) {
    if (window.powerGymDesktop && window.powerGymDesktop.saveFile) {
      const savedPath = await window.powerGymDesktop.saveFile(defaultName, text);
      if (savedPath) showToast(`تم حفظ التقرير في: ${savedPath}`, 'success');
      return;
    }
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('تم تنزيل التقرير ✅', 'success');
  }

  // ---------- واجهة النافذة ----------
  function currentReportMonth() {
    const input = document.getElementById('mrMonthInput');
    return (input && input.value) || currentMonth();
  }

  window.openMonthlyReportModal = function () {
    const input = document.getElementById('mrMonthInput');
    if (input && !input.value) input.value = currentMonth();
    document.getElementById('monthlyReportModal').style.display = 'flex';
    window.renderMonthlyReport();
  };

  window.closeMonthlyReportModal = function () {
    document.getElementById('monthlyReportModal').style.display = 'none';
  };

  window.renderMonthlyReport = function () {
    const ym = currentReportMonth();
    const r = buildMonthlyReport(ym);
    document.getElementById('mrContent').innerHTML = renderReportHtml(r);
  };

  window.exportMonthlyReportCSV = function () {
    const ym = currentReportMonth();
    const r = buildMonthlyReport(ym);
    logActivity(`تصدير تقرير شهري CSV لشهر ${ym}`);
    saveTextFile(`تقرير-${ym}.csv`, reportToCsv(r));
  };

  window.printMonthlyReport = function () {
    const ym = currentReportMonth();
    const r = buildMonthlyReport(ym);
    document.getElementById('monthlyReportPrint').innerHTML = renderReportHtml(r);
    document.body.dataset.printMode = 'report';
    const cleanup = () => {
      delete document.body.dataset.printMode;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    logActivity(`طباعة تقرير شهري لشهر ${ym}`);
    window.print();
  };

  // ---------- إنشاء العناصر (الزر والنافذة والستايل) ----------
  function injectStyles() {
    const css = `
      .rpt { font-family: 'Cairo', sans-serif; color: #e2e8f0; }
      .rpt-head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; border-bottom:1px solid #1e3a5f; padding-bottom:12px; margin-bottom:16px; }
      .rpt-head h2 { font-size:20px; font-weight:900; color:#fff; }
      .rpt-sub { font-size:12px; color:#94a3b8; margin-top:4px; }
      .rpt-month { text-align:left; } .rpt-month b { display:block; font-size:16px; color:#38bdf8; } .rpt-month span { font-size:11px; color:#94a3b8; }
      .rpt-kpis { display:grid; grid-template-columns: repeat(2, 1fr); gap:10px; margin-bottom:16px; }
      @media (min-width: 768px) { .rpt-kpis { grid-template-columns: repeat(3, 1fr); } }
      .rpt-kpi { background:#0b1a2e; border:1px solid #1e3a5f; border-radius:14px; padding:10px 12px; }
      .rpt-kpi span { display:block; font-size:11px; color:#94a3b8; font-weight:700; }
      .rpt-kpi b { display:block; font-size:16px; color:#fff; margin-top:4px; }
      .rpt-kpi.ok b { color:#34d399; } .rpt-kpi.warn b { color:#fbbf24; } .rpt-kpi.bad b { color:#f87171; }
      .rpt-section { margin-bottom:16px; } .rpt-section h3 { font-size:14px; font-weight:900; color:#38bdf8; margin-bottom:8px; }
      .rpt-two { display:grid; grid-template-columns:1fr; gap:12px; } @media (min-width:768px){ .rpt-two { grid-template-columns:1fr 1fr; } }
      .rpt-box { background:#0b1a2e; border:1px solid #1e3a5f; border-radius:14px; padding:12px; }
      .rpt-box h4 { font-size:13px; font-weight:800; color:#e2e8f0; margin-bottom:8px; }
      .rpt-table { width:100%; border-collapse:collapse; font-size:12px; }
      .rpt-table th { text-align:right; color:#94a3b8; font-weight:800; padding:6px; border-bottom:1px solid #1e3a5f; }
      .rpt-table td { padding:6px; border-bottom:1px solid #112240; color:#e2e8f0; vertical-align:top; }
      .rpt-table .num, th.num { text-align:left; }
      .rpt-strong td { font-weight:900; color:#fff; }
      .rpt-empty { font-size:12px; color:#64748b; padding:6px 0; }
      .rpt-note { font-size:12px; color:#fbbf24; margin-bottom:6px; }
      .rpt-foot { font-size:11px; color:#64748b; border-top:1px solid #1e3a5f; padding-top:10px; line-height:1.8; }
      #monthlyReportPrint { display:none; }
      @media print {
        body[data-print-mode="report"] #monthlyReportPrint { display:block !important; position:absolute; left:0; top:0; width:100%; background:#fff !important; padding:12px; }
        body[data-print-mode="report"] #monthlyReportPrint, body[data-print-mode="report"] #monthlyReportPrint * { visibility:visible !important; color:#111827 !important; border-color:#cbd5e1 !important; }
        body[data-print-mode="report"] #monthlyReportPrint .rpt-kpi { background:#f1f5f9 !important; }
        body[data-print-mode="report"] #monthlyReportPrint .rpt-kpi span, body[data-print-mode="report"] #monthlyReportPrint .rpt-sub { color:#475569 !important; }
        body[data-print-mode="report"] #monthlyReportPrint .rpt-month b { color:#1d4ed8 !important; }
        body[data-print-mode="report"] #monthlyReportPrint .rpt-section { break-inside:avoid; }
      }`;
    const style = document.createElement('style');
    style.id = 'monthlyReportStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectModal() {
    const wrap = document.createElement('div');
    wrap.id = 'monthlyReportModal';
    wrap.className = 'fixed inset-0 modal-backdrop z-40 p-4 overflow-y-auto';
    wrap.style.display = 'none';
    wrap.style.alignItems = 'center';
    wrap.style.justifyContent = 'center';
    wrap.innerHTML = `
      <div class="card-bg w-full max-w-4xl rounded-3xl p-6 border border-slate-700 shadow-2xl my-auto max-h-[92vh] overflow-y-auto rpt">
        <div class="flex flex-wrap justify-between items-center gap-3 pb-4 border-b border-slate-800 mb-5">
          <h3 class="text-lg font-black text-white flex items-center gap-2">
            <i class="fa-solid fa-file-lines text-sky-400"></i><span>التقارير الشهرية</span>
          </h3>
          <button onclick="closeMonthlyReportModal()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center" aria-label="إغلاق">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-5">
          <label for="mrMonthInput" class="text-xs font-bold text-slate-300">اختر الشهر:</label>
          <input type="month" id="mrMonthInput" onchange="renderMonthlyReport()" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500" dir="ltr">
          <div class="flex-1"></div>
          <button onclick="printMonthlyReport()" class="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 px-3 py-2 rounded-xl text-xs font-bold">
            <i class="fa-solid fa-print ml-1"></i>طباعة / حفظ PDF
          </button>
          <button onclick="exportMonthlyReportCSV()" class="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-3 py-2 rounded-xl text-xs font-bold">
            <i class="fa-solid fa-file-csv ml-1"></i>تصدير Excel
          </button>
        </div>
        <div id="mrContent"></div>
      </div>`;
    document.body.appendChild(wrap);

    const printArea = document.createElement('div');
    printArea.id = 'monthlyReportPrint';
    printArea.className = 'rpt';
    document.body.appendChild(printArea);
  }

  function injectSidebarButton() {
    const anchor = document.querySelector('#desktopSidebar button[onclick*="openFinanceModal(\'customize\')"]');
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.className = 'sidebar-link';
    btn.setAttribute('onclick', 'openMonthlyReportModal(); closeMobileMenu();');
    btn.innerHTML = '<i class="fa-solid fa-file-lines"></i><span>التقارير الشهرية</span>';
    anchor.insertAdjacentElement('afterend', btn);
  }

  function init() {
    injectStyles();
    injectModal();
    injectSidebarButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
