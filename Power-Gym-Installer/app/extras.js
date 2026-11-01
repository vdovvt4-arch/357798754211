'use strict';
// =========================================================
// ميزات إضافية - Power Gym
// 1) القفل التلقائي عند الخمول (يعمل فقط إذا كان رمز PIN مفعلاً)
// 2) إرسال كورس اللاعب (من ملاحظات الكورس) إلى التليكرام الخاص به
// يعتمد على دوال app.js: players, gymProfile, telegramDirectory, getTelegramSettings,
// formatIraqiPhone, dataURLtoBlob, escapeTelegramHtml, sanitizeCourseImage, showToast, logActivity
// =========================================================
(function () {
  const $ = id => document.getElementById(id);

  // ---------- 1) القفل التلقائي ----------
  const AUTOLOCK_KEY = 'power_gym_autolock_minutes_v1';
  const AUTOLOCK_OPTIONS = [0, 1, 2, 5, 10, 15, 30];
  let lastActivity = Date.now();

  function getAutoLockMinutes() {
    const raw = localStorage.getItem(AUTOLOCK_KEY);
    const n = raw === null ? 5 : Number(raw);
    return AUTOLOCK_OPTIONS.includes(n) ? n : 5;
  }

  function touch() { lastActivity = Date.now(); }

  function lockIfIdle() {
    const minutes = getAutoLockMinutes();
    if (!minutes) return;
    if (!localStorage.getItem(STORAGE_KEYS.PIN_HASH)) return; // لا قفل بدون PIN
    const lock = $('lockScreenModal');
    if (!lock || !lock.classList.contains('hidden')) return;
    if (Date.now() - lastActivity < minutes * 60 * 1000) return;
    $('unlockPinInput').value = '';
    $('lockErrorMsg').classList.add('hidden');
    lock.classList.remove('hidden');
    logActivity(`قفل تلقائي بعد ${minutes} دقيقة خمول`);
  }

  function initAutoLock() {
    // شاشة القفل يجب أن تعلو كل النوافذ الأخرى
    const lock = $('lockScreenModal');
    if (lock) lock.style.zIndex = '9999';
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach(ev =>
      window.addEventListener(ev, touch, { passive: true, capture: true }));
    setInterval(lockIfIdle, 10000);

    const row = $('newPinInput') && $('newPinInput').closest('.flex');
    if (!row) return;
    const box = document.createElement('div');
    box.className = 'mt-3';
    box.innerHTML = `
      <label class="block text-xs font-bold text-slate-300 mb-1">القفل التلقائي عند عدم استخدام النظام</label>
      <select id="autoLockSelect" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white">
        ${AUTOLOCK_OPTIONS.map(m => `<option value="${m}">${m === 0 ? 'معطّل' : `بعد ${m} دقيقة`}</option>`).join('')}
      </select>
      <p class="text-[11px] text-slate-400 mt-1">يعمل فقط بعد تعيين رمز PIN. الافتراضي 5 دقائق.</p>`;
    row.insertAdjacentElement('afterend', box);
    const select = $('autoLockSelect');
    select.value = String(getAutoLockMinutes());
    select.addEventListener('change', () => {
      localStorage.setItem(AUTOLOCK_KEY, select.value);
      touch();
      showToast(Number(select.value) ? `تم ضبط القفل التلقائي بعد ${select.value} دقيقة 🔒` : 'تم تعطيل القفل التلقائي', 'info');
      if (Number(select.value) && !localStorage.getItem(STORAGE_KEYS.PIN_HASH)) {
        showToast('لن يعمل القفل قبل تعيين رمز PIN.', 'warning');
      }
    });
  }

  // ---------- 2) إرسال الكورس للاعب عبر التليكرام ----------
  let courseViewPlayerId = '';
  let sending = false;

  function resolveChatId(player) {
    return player.playerChatId ||
      telegramDirectory?.phoneToChatId?.[formatIraqiPhone(player.phone)]?.chatId || '';
  }

  function chunkText(text, size) {
    const out = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  // يرجع { ok, reason }
  async function sendCourseToPlayer(player, silent) {
    const notes = String(player.courseNotes || '').trim();
    const images = (Array.isArray(player.courseImages) ? player.courseImages : []).map(sanitizeCourseImage).filter(Boolean);
    const warn = msg => { if (!silent) showToast(msg, 'warning'); return { ok: false, reason: msg }; };
    if (!notes && images.length === 0) return warn('لا يوجد كورس مكتوب لهذا اللاعب. اكتب تفاصيل الكورس أولاً.');
    const { botToken } = getTelegramSettings();
    if (!botToken) return warn('أدخل توكن بوت التليكرام من الإعدادات أولاً.');
    const chatId = resolveChatId(player);
    if (!chatId) return warn('اللاعب غير مربوط بالتليكرام: يجب أن يضغط Start على البوت أو أدخل Chat ID له.');

    const header = `<b>📋 كورسك التدريبي - ${escapeTelegramHtml(gymProfile.gymName)}</b>\n👤 ${escapeTelegramHtml(player.name)}`;
    const footer = gymProfile.supervisorName ? `\n\n— الكابتن: ${escapeTelegramHtml(gymProfile.supervisorName)}` : '';
    const body = notes ? `\n\n${escapeTelegramHtml(notes)}` : '';
    const parts = chunkText(header + body + footer, 3900);
    const api = `https://api.telegram.org/bot${botToken}`;

    try {
      for (const part of parts) {
        const r = await fetch(`${api}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'HTML' })
        });
        const d = await r.json();
        if (!d.ok) return warn(`تيليكرام رفض الإرسال: ${d.description || 'خطأ غير معروف'}`);
      }
      let failedImages = 0;
      for (let i = 0; i < images.length; i++) {
        const fd = new FormData();
        fd.append('chat_id', chatId);
        fd.append('photo', dataURLtoBlob(images[i]), `course-${i + 1}.jpg`);
        fd.append('caption', `صفحة ${i + 1} من ${images.length} - كورس ${player.name}`);
        const r = await fetch(`${api}/sendPhoto`, { method: 'POST', body: fd });
        const d = await r.json();
        if (!d.ok) failedImages++;
      }
      logActivity(`إرسال كورس اللاعب ${player.name} إلى التليكرام`);
      if (!silent) {
        showToast(failedImages
          ? `أُرسل النص لكن فشل إرسال ${failedImages} صورة.`
          : `تم إرسال الكورس إلى ${player.name} على التليكرام ✅`, failedImages ? 'warning' : 'success');
      }
      return { ok: failedImages === 0 };
    } catch (e) {
      console.warn('Course send error:', e);
      return warn('تعذر الاتصال بتليكرام. تحقق من الإنترنت.');
    }
  }

  window.sendCurrentCourseToPlayer = async function () {
    if (sending) return;
    const player = players.find(p => p.id === courseViewPlayerId);
    if (!player) return;
    const btn = $('btnSendCourseTg');
    sending = true;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    try {
      await sendCourseToPlayer(player, false);
    } finally {
      sending = false;
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  };

  function injectCourseUi() {
    // زر الإرسال في نافذة ملف الكورس
    const printBtn = document.querySelector('#courseRecordModal button[onclick="printPlayerCourse()"]');
    if (printBtn) {
      const btn = document.createElement('button');
      btn.id = 'btnSendCourseTg';
      btn.setAttribute('onclick', 'sendCurrentCourseToPlayer()');
      btn.className = 'flex-1 bg-sky-500 hover:bg-sky-400 text-black font-black py-2.5 rounded-xl text-sm';
      btn.innerHTML = '<i class="fa-brands fa-telegram ml-1"></i> إرسال الكورس للاعب على التليكرام';
      printBtn.insertAdjacentElement('afterend', btn);
    }
    // خيار الإرسال عند الحفظ
    const notes = $('courseNotes');
    if (notes) {
      const holder = notes.parentElement;
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 text-xs text-sky-300 font-bold mt-2';
      label.innerHTML = '<input type="checkbox" id="sendCourseOnSave"> إرسال الكورس للاعب على التليكرام عند الحفظ';
      holder.appendChild(label);
    }
  }

  function wrapHooks() {
    const origOpen = window.openPlayerCourseModal;
    window.openPlayerCourseModal = function (playerId) {
      courseViewPlayerId = playerId;
      return origOpen.apply(this, arguments);
    };

    const origSave = window.savePlayer;
    window.savePlayer = async function () {
      const editingId = $('editingPlayerId').value;
      const wantSend = Boolean($('sendCourseOnSave') && $('sendCourseOnSave').checked);
      const knownIds = new Set(players.map(p => p.id));
      try {
        await origSave.apply(this, arguments);
      } finally {
        if (wantSend) {
          const saved = editingId
            ? players.find(p => p.id === editingId)
            : players.find(p => !knownIds.has(p.id));
          if (saved) await sendCourseToPlayer(saved, false);
        }
      }
    };
  }

  // ---------- 3) تصوير الكورس بالكاميرا ----------
  let camStream = null;

  function stopCamera() {
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    camStream = null;
    const v = $('camVideo');
    if (v) v.srcObject = null;
  }

  async function startCamera(deviceId) {
    stopCamera();
    const status = $('camStatus');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      status.textContent = 'الكاميرا غير مدعومة في هذا الجهاز.';
      return;
    }
    try {
      status.textContent = 'جاري تشغيل الكاميرا...';
      camStream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      $('camVideo').srcObject = camStream;
      await $('camVideo').play().catch(() => {});
      status.textContent = '';
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const sel = $('camSelect');
      const current = camStream.getVideoTracks()[0].getSettings().deviceId;
      sel.innerHTML = devices.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `كاميرا ${i + 1}`)}</option>`).join('');
      if (current) sel.value = current;
      sel.style.display = devices.length > 1 ? '' : 'none';
    } catch (e) {
      console.warn('Camera error:', e);
      status.textContent = e && e.name === 'NotAllowedError'
        ? 'تم رفض إذن الكاميرا. اسمح للتطبيق باستخدام الكاميرا من إعدادات ويندوز (الخصوصية > الكاميرا).'
        : 'لا توجد كاميرا متاحة أو أنها مستخدمة من برنامج آخر.';
    }
  }

  function updateCamCounter() {
    const el = $('camCounter');
    if (el) el.textContent = `الصور المحفوظة: ${courseImagesDraft.length} / 5`;
  }

  window.openCourseCamera = function () {
    if (courseImagesDraft.length >= 5) { showToast('وصلت للحد الأقصى: 5 صور.', 'warning'); return; }
    $('camModal').classList.remove('hidden');
    updateCamCounter();
    startCamera();
  };

  window.closeCourseCamera = function () {
    stopCamera();
    $('camModal').classList.add('hidden');
  };

  window.switchCourseCamera = function (id) { startCamera(id); };

  window.captureCoursePhoto = async function () {
    const video = $('camVideo');
    if (!camStream || !video.videoWidth) { showToast('الكاميرا غير جاهزة بعد.', 'warning'); return; }
    if (courseImagesDraft.length >= 5) { showToast('وصلت للحد الأقصى: 5 صور.', 'warning'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) { showToast('تعذر التقاط الصورة.', 'error'); return; }
    try {
      const file = new File([blob], 'course-photo.jpg', { type: 'image/jpeg' });
      courseImagesDraft.push(await compressCourseImage(file));
      renderCourseImagesPreview();
      updateCamCounter();
      showToast('تم التقاط صفحة الكورس 📸', 'success');
      if (courseImagesDraft.length >= 5) window.closeCourseCamera();
    } catch (e) {
      showToast(e.message || 'تعذرت معالجة الصورة.', 'error');
    }
  };

  function injectCameraUi() {
    const fileInput = $('courseImagesInput');
    if (fileInput) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('onclick', 'openCourseCamera()');
      btn.className = 'mb-2 w-full bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 rounded-xl py-2 text-xs font-black';
      btn.innerHTML = '<i class="fa-solid fa-camera ml-1"></i> تصوير الكورس بالكاميرا';
      fileInput.insertAdjacentElement('beforebegin', btn);
    }
    const modal = document.createElement('div');
    modal.id = 'camModal';
    modal.className = 'fixed inset-0 modal-backdrop hidden flex items-center justify-center p-4';
    modal.style.zIndex = '60';
    modal.innerHTML = `
      <div class="card-bg w-full max-w-2xl rounded-3xl p-5 border border-slate-700 shadow-2xl">
        <div class="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
          <h3 class="text-lg font-black text-white"><i class="fa-solid fa-camera text-sky-400 ml-2"></i>تصوير الكورس</h3>
          <button type="button" onclick="closeCourseCamera()" class="text-slate-400 hover:text-white w-8 h-8 rounded-lg bg-slate-800"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <video id="camVideo" autoplay playsinline muted class="w-full max-h-[55vh] bg-black rounded-2xl object-contain"></video>
        <p id="camStatus" class="text-xs text-amber-300 mt-2"></p>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <select id="camSelect" onchange="switchCourseCamera(this.value)" style="display:none" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"></select>
          <button type="button" onclick="captureCoursePhoto()" class="flex-1 bg-sky-500 hover:bg-sky-400 text-black font-black py-2.5 rounded-xl"><i class="fa-solid fa-camera ml-1"></i> التقاط</button>
          <button type="button" onclick="closeCourseCamera()" class="px-5 bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl">تم</button>
        </div>
        <p id="camCounter" class="text-[11px] text-slate-400 mt-2"></p>
        <p class="text-[11px] text-slate-400">الصور تُحفظ ضمن ملف الكورس، ويمكنك إرسالها للاعب على التليكرام بعد الحفظ.</p>
      </div>`;
    document.body.appendChild(modal);
  }

  // ---------- 4) نسخة الويب / الهاتف (PWA) ----------
  function initPwa() {
    const isDesktopApp = Boolean(window.powerGymDesktop && window.powerGymDesktop.isDesktop);
    if (isDesktopApp || !/^https?:$/.test(location.protocol)) return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW register failed:', e));
    }
    // طلب تخزين دائم حتى لا يمسح المتصفح بيانات القاعة عند امتلاء المساحة
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;

    let deferredPrompt = null;
    const makeBtn = onClick => {
      if ($('pwaInstallBtn')) return;
      const btn = document.createElement('button');
      btn.id = 'pwaInstallBtn';
      btn.innerHTML = '<i class="fa-solid fa-download ml-1"></i> تثبيت التطبيق';
      btn.addEventListener('click', onClick);
      document.body.appendChild(btn);
    };
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      makeBtn(async () => {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null;
        const b = $('pwaInstallBtn');
        if (b) b.remove();
      });
    });
    window.addEventListener('appinstalled', () => {
      const b = $('pwaInstallBtn');
      if (b) b.remove();
      showToast('تم تثبيت التطبيق على جهازك ✅', 'success');
    });

    // آيفون لا يدعم زر التثبيت: نعرض إرشاداً
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      makeBtn(() => showToast('في سفاري: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».', 'info'));
    }
  }

  // ---------- 5) إشعار انتهاء الاشتراك للاعب ----------
  // يُرسل مرة واحدة لكل تاريخ انتهاء، ويُسجَّل داخل threeDayRemindersSent بمفتاح `${endDate}_expired`
  // (يُصفَّر تلقائياً عند التجديد). نغطي آخر 3 أيام فقط لتفادي إرسال رسائل للمنتهين منذ زمن بعيد.
  let expiryRunning = false;

  function buildExpiredText(player) {
    const sub = getSubscriptionStatus(player.endDate);
    const debt = Number(player.debtAmount) || 0;
    const phone = (financeLedger.receiptSettings && financeLedger.receiptSettings.phone) || '';
    const endLine =
      sub.diffDays === 1 ? `نُعلمك بأن اشتراكك يُصنَّف الآن <b>منتهياً</b> (يتبقى يوم واحد وينتهي بتاريخ <b>${escapeTelegramHtml(getArabicDayName(player.endDate))} ${escapeTelegramHtml(player.endDate)}</b>).` :
      sub.diffDays === 0 ? `نُعلمك بأن اشتراكك <b>ينتهي اليوم</b> بتاريخ <b>${escapeTelegramHtml(getArabicDayName(player.endDate))} ${escapeTelegramHtml(player.endDate)}</b>.` :
      `نُعلمك بأن اشتراكك <b>انتهى</b> بتاريخ <b>${escapeTelegramHtml(getArabicDayName(player.endDate))} ${escapeTelegramHtml(player.endDate)}</b>.`;
    return [
      `⛔ <b>إشعار انتهاء الاشتراك في القاعة</b>`,
      `🏋️‍♂️ <b>${escapeTelegramHtml(gymProfile.gymName)}</b> (${escapeTelegramHtml(gymProfile.gymBranch)})`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `مرحباً كابتن <b>${escapeTelegramHtml(player.name)}</b> 💪`,
      endLine,
      debt > 0 ? `💰 المتبقي عليك: <b>${debt.toLocaleString('en-US')}</b> د.ع` : '',
      `━━━━━━━━━━━━━━━━━━━━`,
      `تعال للقاعة لتجديد الاشتراك وكمّل رحلتك بدون انقطاع يا بطل! 🔥`,
      phone ? `📞 ${escapeTelegramHtml(phone)}` : ''
    ].filter(Boolean).join('\n');
  }

  async function runExpiryNotices() {
    if (expiryRunning) return;
    const { botToken } = getTelegramSettings();
    if (!botToken) return;
    expiryRunning = true;
    let sent = 0;
    try {
      for (const player of players.slice()) {
        const { status, diffDays } = getSubscriptionStatus(player.endDate);
        if (status !== 'expired' || diffDays > 1 || diffDays < -3) continue; // يشمل من تبقى له يوم أو أقل كما يصنف منتهي
        const key = `${player.endDate}_expired`;
        if (!Array.isArray(player.threeDayRemindersSent)) player.threeDayRemindersSent = [];
        if (player.threeDayRemindersSent.includes(key)) continue;
        if (!resolveChatId(player)) continue; // لم يربط اللاعب التليكرام بعد: نعيد المحاولة لاحقاً ضمن المدة
        player.playerChatId = player.playerChatId || resolveChatId(player);
        const ok = await sendDirectTelegramMessageToPlayer(player, buildExpiredText(player));
        if (ok) {
          player.threeDayRemindersSent.push(key);
          sent++;
          await new Promise(r => setTimeout(r, 350));
        }
      }
    } catch (e) {
      console.warn('Expiry notice error:', e);
    } finally {
      expiryRunning = false;
    }
    if (sent > 0) {
      savePlayersToStorage();
      logActivity(`إرسال إشعار انتهاء الاشتراك لـ ${sent} لاعب`);
      showToast(`تم إرسال إشعار انتهاء الاشتراك لـ ${sent} لاعب على التليكرام ⛔`, 'info');
    }
  }

  function initExpiryNotices() {
    setTimeout(runExpiryNotices, 6000);
    setInterval(runExpiryNotices, 5 * 60 * 1000);
  }

  // ---------- 6) زر "حفظ فقط" بدون إرسال أي رسائل ----------
  function updateSaveBtnLabel() {
    const btn = $('saveBtn');
    const chk = $('sendActivationOnSave');
    if (!btn || !chk || btn.disabled) return;
    const editing = Boolean($('editingPlayerId').value);
    btn.textContent = chk.checked
      ? (editing ? 'حفظ التعديلات وإرسال التفعيل' : 'حفظ وإرسال رسالة التفعيل للتليكرام')
      : (editing ? 'حفظ التعديلات' : 'حفظ اللاعب');
  }

  function initSaveOnly() {
    const saveBtn = $('saveBtn');
    const form = $('playerForm');
    if (!saveBtn || !form) return;

    const only = document.createElement('button');
    only.type = 'button';
    only.id = 'saveOnlyBtn';
    only.className = 'px-4 bg-slate-700 hover:bg-slate-600 text-white font-black py-3 rounded-xl text-sm whitespace-nowrap';
    only.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1"></i> حفظ فقط';
    only.title = 'حفظ البيانات بدون إرسال أي رسالة للاعب (تفعيل أو كورس)';
    saveBtn.insertAdjacentElement('afterend', only);

    only.addEventListener('click', () => {
      if (!form.reportValidity()) return;
      const act = $('sendActivationOnSave');
      const course = $('sendCourseOnSave');
      const prevAct = act ? act.checked : false;
      const prevCourse = course ? course.checked : false;
      if (act) act.checked = false;
      if (course) course.checked = false;
      // savePlayer يقرأ الخيارات بشكل متزامن عند بدء الحفظ، ثم نعيدها كما كانت
      form.requestSubmit();
      if (act) act.checked = prevAct;
      if (course) course.checked = prevCourse;
    });

    const act = $('sendActivationOnSave');
    if (act) act.addEventListener('change', updateSaveBtnLabel);

    // عند تعديل لاعب موجود: لا يُرسل شيء افتراضياً (الإرسال اختياري)
    const origEdit = window.openEditModal;
    window.openEditModal = function () {
      origEdit.apply(this, arguments);
      if ($('sendActivationOnSave')) $('sendActivationOnSave').checked = false;
      updateSaveBtnLabel();
    };
    const origAdd = window.openAddModal;
    window.openAddModal = function () {
      origAdd.apply(this, arguments);
      updateSaveBtnLabel();
    };

    // زر تجديد فقط في نافذة التجديد السريع (بدون إرسال رسالة تليكرام)
    const renewConfirmBtn = document.querySelector('#renewModal button[onclick="confirmRenewSubscription()"]');
    if (renewConfirmBtn && !$('renewOnlyBtn')) {
      const renewOnly = document.createElement('button');
      renewOnly.type = 'button';
      renewOnly.id = 'renewOnlyBtn';
      renewOnly.className = 'px-4 bg-slate-700 hover:bg-slate-600 text-white font-black py-2.5 rounded-xl text-sm whitespace-nowrap transition';
      renewOnly.innerHTML = '<i class="fa-solid fa-floppy-disk ml-1"></i> تجديد وحفظ فقط';
      renewOnly.title = 'تجديد الاشتراك وحفظه بدون إرسال رسالة تليكرام';
      renewConfirmBtn.insertAdjacentElement('afterend', renewOnly);
      renewOnly.addEventListener('click', async () => {
        window.__skipRenewTelegramOnce = true;
        try {
          await window.confirmRenewSubscription();
        } finally {
          window.__skipRenewTelegramOnce = false;
        }
      });
    }
  }

  function init() {
    initAutoLock();
    injectCourseUi();
    injectCameraUi();
    wrapHooks();
    initSaveOnly();
    initPwa();
    initExpiryNotices();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
