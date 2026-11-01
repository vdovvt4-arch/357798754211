    'use strict';

    // =========================================================
    // 1. الهيكلة القوية لبيانات التطبيق (PowerGym Data Architecture v2.0)
    // =========================================================
    const SCHEMA_VERSION = '2.0.0';
    const BOT_USERNAME = 'Powargym_bot';

    const STORAGE_KEYS = Object.freeze({
      PLAYERS: 'power_gym_players_v1',
      SETTINGS: 'power_gym_settings_v1',
      PIN_HASH: 'power_gym_pin_sha256_v1',
      AUDIT_LOG: 'power_gym_audit_v1',
      TELEGRAM_TOKEN_ROTATION: 'power_gym_telegram_token_rotation_v1',
      FINANCE_LEDGER: 'power_gym_finance_ledger_v2',
      GYM_PROFILE: 'power_gym_profile_v2',
      TELEGRAM_DIRECTORY: 'power_gym_tg_directory_v2'
    });

    const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

    // الحالة المهيكلة للنظام (Centralized Application State)
    let players = [];
    let auditLogs = [];
    let financeLedger = {
      manualProfitAdjustment: 0,
      manualDebtAdjustment: 0,
      transactions: [],
      debtEntries: [],
      debtPayments: [],
      renewals: [],
      receipts: [],
      receiptCounter: 0,
      receiptSettings: {}
    };
    let gymProfile = {
      gymName: 'Power Gym | بور جم',
      gymBranch: 'كربلاء - الحر - قرب فلكة الثورة',
      supervisorName: '',
      receiptStamp: '',
      defaultPrices: {
        '1': 25000,
        '2': 45000,
        '3': 65000,
        '6': 120000,
        '12': 220000
      }
    };
    let telegramDirectory = {
      phoneToChatId: {},
      lastUpdateOffset: 0
    };

    let currentFilter = 'all';
    let currentViewMode = 'cards';
    let compressedPhotoDataUrl = '';
    let courseImagesDraft = [];
    let calendarViewYear = new Date().getFullYear();
    let calendarViewMonth = new Date().getMonth();
    let selectedCalendarDateStr = '';

    // =========================================================
    // 2. دوال الحماية والتعقيم ضد الثغرات (Security & Sanitization)
    // =========================================================
    function escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeTelegramHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function sanitizeId(id) {
      return String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    }

    function sanitizePhotoSource(photo) {
      if (!photo || typeof photo !== 'string') return DEFAULT_AVATAR;
      if (photo.startsWith('data:image/jpeg;base64,') ||
          photo.startsWith('data:image/png;base64,') ||
          photo.startsWith('data:image/webp;base64,')) {
        return photo;
      }
      return DEFAULT_AVATAR;
    }

    function sanitizeCourseImage(image) {
      return typeof image === 'string' &&
        /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
        ? image
        : '';
    }

    function isValidDateString(dateStr) {
      if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const d = new Date(dateStr);
      return !isNaN(d.getTime());
    }

    // هيكلة وتعقيم سجل اللاعب (Player Schema v2.0)
    function sanitizePlayerRecord(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const today = getTodayDateString();
      const startDate = isValidDateString(raw.startDate) ? raw.startDate : today;
      const durationMonths = [1, 2, 3, 6, 12].includes(Number(raw.durationMonths)) ? Number(raw.durationMonths) : 1;
      const endDate = isValidDateString(raw.endDate) ? raw.endDate : addMonthsToDate(startDate, durationMonths);
      const rawPhone = String(raw.phone || '').replace(/[^\d+]/g, '').slice(0, 15);
      const intlPhone = formatIraqiPhone(rawPhone);

      const matchedTgId =
        String(raw.playerChatId || raw.telegram?.playerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '')
          .replace(/[^0-9-]/g, '');

      const remindersArr = Array.isArray(raw.threeDayRemindersSent)
        ? raw.threeDayRemindersSent.map(x => String(x))
        : Array.isArray(raw.telegram?.threeDayRemindersSent)
          ? raw.telegram.threeDayRemindersSent.map(x => String(x))
          : [];

      return {
        schemaVersion: SCHEMA_VERSION,
        id: sanitizeId(raw.id) || ('plr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)),
        code: String(raw.code || '').trim().slice(0, 15),
        name: String(raw.name || 'لاعب بدون اسم').trim().slice(0, 80),
        age: Math.min(80, Math.max(10, parseInt(raw.age, 10) || 20)),
        phone: rawPhone,
        intlPhone,
        planType: String(raw.planType || 'حديد عام (كمال أجسام)').slice(0, 50),
        startDate,
        durationMonths,
        endDate,
        paidAmount: Math.max(0, Number(raw.paidAmount) || 0),
        debtAmount: Math.max(0, Number(raw.debtAmount) || 0),
        notes: String(raw.notes || '').trim().slice(0, 160),
        courseNotes: String(raw.courseNotes || '').trim().slice(0, 2000),
        courseImages: Array.isArray(raw.courseImages)
          ? raw.courseImages.map(sanitizeCourseImage).filter(Boolean).slice(0, 5)
          : [],
        attendanceCount: Math.max(0, parseInt(raw.attendanceCount, 10) || 0),
        lastCheckIn: isValidDateString(raw.lastCheckIn) ? raw.lastCheckIn : '',
        photo: sanitizePhotoSource(raw.photo) === DEFAULT_AVATAR ? '' : raw.photo,
        telegramFileId: String(raw.telegramFileId || '').replace(/[^a-zA-Z0-9_-]/g, ''),
        playerChatId: matchedTgId,
        activationSent: Boolean(raw.activationSent || raw.telegram?.activationSent),
        threeDayRemindersSent: remindersArr,
        lastReminderDate: isValidDateString(raw.lastReminderDate) ? raw.lastReminderDate : '',
        createdAt: String(raw.createdAt || new Date().toISOString()),
        updatedAt: String(raw.updatedAt || new Date().toISOString())
      };
    }

    function generateNextPlayerCode(existingCodes = players.map(player => player.code)) {
      const usedCodes = new Set(existingCodes.map(code => String(code || '').toUpperCase()));
      let highestSerial = 0;
      usedCodes.forEach(code => {
        const match = code.match(/^PG-(\d+)$/);
        if (match) highestSerial = Math.max(highestSerial, Number(match[1]));
      });
      let nextSerial = highestSerial + 1;
      let nextCode = `PG-${String(nextSerial).padStart(4, '0')}`;
      while (usedCodes.has(nextCode)) {
        nextSerial++;
        nextCode = `PG-${String(nextSerial).padStart(4, '0')}`;
      }
      return nextCode;
    }

    function ensureUniquePlayerCodes(playerList) {
      let changed = false;
      const usedCodes = new Set();
      playerList.forEach(player => {
        const normalizedCode = String(player.code || '').trim().toUpperCase();
        if (!normalizedCode || usedCodes.has(normalizedCode)) {
          player.code = generateNextPlayerCode([...usedCodes]);
          changed = true;
        }
        usedCodes.add(player.code.toUpperCase());
      });
      return changed;
    }

    async function sha256Hash(text) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text + '_power_gym_salt_karbala');
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function logActivity(actionText) {
      const entry = {
        time: new Date().toLocaleString('ar-IQ'),
        action: String(actionText).slice(0, 180)
      };
      auditLogs.unshift(entry);
      if (auditLogs.length > 150) auditLogs = auditLogs.slice(0, 150);
      try {
        localStorage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(auditLogs));
      } catch (e) {
        console.warn('Could not save audit log:', e);
      }
    }

    // =========================================================
    // 3. شاشة التحميل الذكية وتهيئة التطبيق (Smart Splash & Init)
    // =========================================================
    let splashFinished = false;
    function dismissSplashScreenNow() {
      if (splashFinished) return;
      splashFinished = true;
      const splash = document.getElementById('smartSplashScreen');
      if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => splash.classList.add('hidden'), 450);
      }
    }

    function runSmartSplashAnimation() {
      const bar = document.getElementById('splashProgressBar');
      const status = document.getElementById('splashStatusText');
      const pct = document.getElementById('splashPercentText');

      const steps = [
        { p: 38, t: 'جاري تحميل هيكلة البيانات وحسابات التقويم الذكي...', d: 280 },
        { p: 72, t: 'جاري الاتصال ببوت التليكرام (@Powargym_bot)...', d: 600 },
        { p: 100, t: gymProfile.supervisorName
            ? `مرحباً بك كابتن ${escapeHtml(gymProfile.supervisorName)} في منظومة Power Gym الذكية! 💪🔥`
            : 'مرحباً بك في منظومة Power Gym الذكية! 💪🔥', d: 950 }
      ];

      steps.forEach(s => {
        setTimeout(() => {
          if (bar) bar.style.width = s.p + '%';
          if (pct) pct.textContent = s.p + '%';
          if (status) status.innerHTML = `<i class="fa-solid fa-circle-check text-amber-400"></i> <span>${s.t}</span>`;
        }, s.d);
      });

      setTimeout(() => {
        dismissSplashScreenNow();
      }, 1350);
    }

    function toggleMobileMenu() {
      const sidebar = document.getElementById('desktopSidebar');
      const backdrop = document.getElementById('mobileMenuBackdrop');
      const toggle = document.getElementById('mobileMenuToggle');
      const isOpen = !backdrop.classList.contains('hidden');
      if (isOpen) {
        closeMobileMenu();
        return;
      }
      sidebar.classList.remove('hidden');
      backdrop.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'إغلاق القائمة الرئيسية');
      toggle.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    }

    function closeMobileMenu() {
      const sidebar = document.getElementById('desktopSidebar');
      const backdrop = document.getElementById('mobileMenuBackdrop');
      const toggle = document.getElementById('mobileMenuToggle');
      if (sidebar) sidebar.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'فتح القائمة الرئيسية');
        toggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
      }
    }

    function scrollToPlayersDirectory() {
      const directory = document.getElementById('playersDirectory');
      if (directory) directory.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMobileMenu();
    });

    document.addEventListener('DOMContentLoaded', () => {
      loadDataFromStorage();
      applyGymBrandingToUI();
      runSmartSplashAnimation();
      checkSecurityLockOnStartup();
      updateBotIndicator();
      renderPlayers();

      const { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        autoDetectChatId(true);
      }

      // تشغيل المستمع التلقائي لرسائل اللاعبين في البوت + فحص إشعارات الـ 3 أيام تلقائياً
      setTimeout(() => {
        pollBotUpdatesForPlayers(true);
        runThreeDayCountdownReminders(true);
      }, 2200);

      // فحص دوري كل 8 ثوانٍ لربط اللاعبين الجدد وإرسال التذكيرات اليومية
      setInterval(() => {
        pollBotUpdatesForPlayers(true);
      }, 8000);

      setInterval(() => {
        runThreeDayCountdownReminders(true);
      }, 60000);
    });

    function loadDataFromStorage() {
      // 1. تحميل دليل ربط التليكرام
      try {
        const storedDir = localStorage.getItem(STORAGE_KEYS.TELEGRAM_DIRECTORY);
        if (storedDir) {
          const parsedDir = JSON.parse(storedDir);
          telegramDirectory = {
            phoneToChatId: parsedDir.phoneToChatId && typeof parsedDir.phoneToChatId === 'object' ? parsedDir.phoneToChatId : {},
            lastUpdateOffset: Number(parsedDir.lastUpdateOffset) || 0
          };
        }
      } catch {
        telegramDirectory = { phoneToChatId: {}, lastUpdateOffset: 0 };
      }

      // 2. تحميل تخصيص الجيم والأسعار
      try {
        const storedProfile = localStorage.getItem(STORAGE_KEYS.GYM_PROFILE);
        if (storedProfile) {
          const parsedProf = JSON.parse(storedProfile);
          gymProfile = {
            gymName: String(parsedProf.gymName || 'Power Gym | بور جم').slice(0, 60),
            gymBranch: String(parsedProf.gymBranch || 'كربلاء - الحر - قرب فلكة الثورة').slice(0, 80),
            supervisorName: String(parsedProf.supervisorName || '').trim().slice(0, 60),
            receiptStamp: String(parsedProf.receiptStamp || '').trim().slice(0, 100),
            defaultPrices: {
              '1': Number(parsedProf.defaultPrices?.['1']) || 25000,
              '2': Number(parsedProf.defaultPrices?.['2']) || 45000,
              '3': Number(parsedProf.defaultPrices?.['3']) || 65000,
              '6': Number(parsedProf.defaultPrices?.['6']) || 120000,
              '12': Number(parsedProf.defaultPrices?.['12']) || 220000
            }
          };
        }
      } catch (e) {
        console.warn('Profile load error:', e);
      }

      // 3. تحميل السجل المالي للأرباح والديون
      try {
        const storedFin = localStorage.getItem(STORAGE_KEYS.FINANCE_LEDGER);
        if (storedFin) {
          const parsedFin = JSON.parse(storedFin);
          financeLedger = {
            manualProfitAdjustment: Number(parsedFin.manualProfitAdjustment) || 0,
            manualDebtAdjustment: Number(parsedFin.manualDebtAdjustment) || 0,
            transactions: Array.isArray(parsedFin.transactions) ? parsedFin.transactions : [],
            debtEntries: Array.isArray(parsedFin.debtEntries) ? parsedFin.debtEntries : [],
            debtPayments: Array.isArray(parsedFin.debtPayments) ? parsedFin.debtPayments : [],
            renewals: Array.isArray(parsedFin.renewals) ? parsedFin.renewals : [],
            receipts: Array.isArray(parsedFin.receipts) ? parsedFin.receipts : [],
            receiptCounter: Math.max(0, parseInt(parsedFin.receiptCounter, 10) || 0),
            receiptSettings: parsedFin.receiptSettings && typeof parsedFin.receiptSettings === 'object' ? parsedFin.receiptSettings : {}
          };
        }
      } catch (e) {
        financeLedger = { manualProfitAdjustment: 0, manualDebtAdjustment: 0, transactions: [], debtEntries: [], debtPayments: [], renewals: [], receipts: [], receiptCounter: 0, receiptSettings: {} };
      }

      // 4. تحميل جدول اللاعبين
      try {
        const storedPlayers = localStorage.getItem(STORAGE_KEYS.PLAYERS);
        if (storedPlayers) {
          const parsed = JSON.parse(storedPlayers);
          players = Array.isArray(parsed) ? parsed.map(sanitizePlayerRecord).filter(Boolean) : [];
          if (ensureUniquePlayerCodes(players)) {
            try {
              localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
            } catch (saveError) {
              console.error('Could not save player serial codes:', saveError);
              showToast('تعذر حفظ أكواد العضوية التسلسلية؛ تحقق من مساحة التخزين.', 'error');
            }
          }
        } else {
          players = [];
        }
      } catch (err) {
        console.error('Error reading players from localStorage:', err);
        players = [];
      }

      // 5. تحميل سجل الحركات
      try {
        const storedLogs = localStorage.getItem(STORAGE_KEYS.AUDIT_LOG);
        auditLogs = storedLogs ? JSON.parse(storedLogs) : [];
      } catch {
        auditLogs = [];
      }

      // 6. تحميل إعدادات البوت
      try {
        const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        const settings = storedSettings ? JSON.parse(storedSettings) : {};
        if (localStorage.getItem(STORAGE_KEYS.TELEGRAM_TOKEN_ROTATION) !== '1') {
          settings.botToken = '';
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({
            botToken: '',
            chatId: String(settings.chatId || '').trim()
          }));
          localStorage.setItem(STORAGE_KEYS.TELEGRAM_TOKEN_ROTATION, '1');
        }
        document.getElementById('botTokenInput').value = String(settings.botToken || '').trim();
        document.getElementById('chatIdInput').value = String(settings.chatId || '').trim();
        if (!storedSettings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken: '', chatId: '' }));
      } catch (err) {
        console.error('Error reading settings from localStorage:', err);
      }
    }

    function savePlayersToStorage() {
      try {
        localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
        renderPlayers();
        return true;
      } catch (err) {
        showToast('تنبيه: الذاكرة المحلية ممتلئة! يرجى تحميل نسخة احتياطية.', 'error');
        return false;
      }
    }

    function saveFinanceLedgerToStorage() {
      try {
        localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, JSON.stringify(financeLedger));
        updateDashboardStats();
      } catch (e) {
        console.error('Error saving finance ledger:', e);
      }
    }

    function saveTelegramDirectoryToStorage() {
      try {
        localStorage.setItem(STORAGE_KEYS.TELEGRAM_DIRECTORY, JSON.stringify(telegramDirectory));
      } catch (e) {
        console.error('Error saving telegram directory:', e);
      }
    }

    function applyGymBrandingToUI() {
      const nameParts = gymProfile.gymName.split('|');
      const mainTitle = escapeHtml(nameParts[0] || 'Power Gym');
      const subTitle = nameParts[1] ? `<span class="text-amber-500">| ${escapeHtml(nameParts[1].trim())}</span>` : '';

      const headerTitleEl = document.getElementById('headerGymTitle');
      if (headerTitleEl) headerTitleEl.innerHTML = `${mainTitle} ${subTitle}`;
      const cardGymNameEl = document.getElementById('cardGymName');
      const cardGymBranchEl = document.getElementById('cardGymBranch');
      if (cardGymNameEl) cardGymNameEl.textContent = gymProfile.gymName;
      if (cardGymBranchEl) cardGymBranchEl.textContent = gymProfile.gymBranch;

      const splashTitleEl = document.getElementById('splashGymTitle');
      if (splashTitleEl) splashTitleEl.innerHTML = `${mainTitle} ${subTitle}`;

      const headerSubEl = document.getElementById('headerGymSubtitle');
      if (headerSubEl) {
        headerSubEl.innerHTML = `<i class="fa-solid fa-location-dot text-amber-500"></i><span>${escapeHtml(gymProfile.gymBranch)}</span>`;
      }

      const splashSubEl = document.getElementById('splashGymSubtitle');
      if (splashSubEl) {
        splashSubEl.innerHTML = `<i class="fa-solid fa-location-dot text-amber-500"></i><span>${escapeHtml(gymProfile.gymBranch)}</span>`;
      }
    }

    // =========================================================
    // 4. إدارة قفل الشاشة برمز PIN
    // =========================================================
    function checkSecurityLockOnStartup() {
      const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
      if (savedHash) {
        document.getElementById('lockScreenModal').classList.remove('hidden');
      }
    }

    function lockSystemNow() {
      const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
      if (!savedHash) {
        showToast('قم بتعيين رمز حماية (PIN) من الإعدادات أولاً لتفعيل قفل الشاشة 🔒', 'info');
        openSettingsModal();
        return;
      }
      document.getElementById('unlockPinInput').value = '';
      document.getElementById('lockErrorMsg').classList.add('hidden');
      document.getElementById('lockScreenModal').classList.remove('hidden');
      logActivity('تم قفل شاشة النظام يدوياً');
    }

    async function unlockSystem(event) {
      event.preventDefault();
      const pin = document.getElementById('unlockPinInput').value;
      const savedHash = localStorage.getItem(STORAGE_KEYS.PIN_HASH);
      const inputHash = await sha256Hash(pin);

      if (inputHash === savedHash) {
        document.getElementById('lockScreenModal').classList.add('hidden');
        document.getElementById('unlockPinInput').value = '';
        showToast('مرحباً بك كابتن! تم فتح القفل بنجاح 🔓', 'success');
        logActivity('تسجيل دخول ناجح وفتح قفل النظام');
      } else {
        const errEl = document.getElementById('lockErrorMsg');
        errEl.textContent = 'رمز الحماية غير صحيح! حاول مرة أخرى.';
        errEl.classList.remove('hidden');
        logActivity('محاولة فاشلة لفتح قفل النظام برمز خاطئ');
      }
    }

    async function updateSecurityPin() {
      const newPin = document.getElementById('newPinInput').value.trim();
      if (!newPin) {
        localStorage.removeItem(STORAGE_KEYS.PIN_HASH);
        showToast('تم إلغاء قفل الشاشة برمز PIN', 'info');
        logActivity('تم إيقاف رمز الحماية PIN');
        return;
      }
      if (newPin.length < 4) {
        showToast('يجب أن يتكون رمز PIN من 4 أرقام أو أحرف على الأقل', 'warning');
        return;
      }
      const hash = await sha256Hash(newPin);
      localStorage.setItem(STORAGE_KEYS.PIN_HASH, hash);
      document.getElementById('newPinInput').value = '';
      showToast('تم تشفير وحفظ رمز الحماية (PIN) بنجاح 🛡️', 'success');
      logActivity('تم تفعيل/تحديث رمز الحماية PIN');
    }

    function toggleTokenVisibility() {
      const input = document.getElementById('botTokenInput');
      const icon = document.getElementById('tokenEyeIcon');
      if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
      } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
      }
    }

    function getTelegramSettings() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (!raw) return { botToken: '', chatId: '' };
        const parsed = JSON.parse(raw);
        return {
          botToken: String(parsed.botToken || '').trim(),
          chatId: String(parsed.chatId || '').trim()
        };
      } catch {
        return { botToken: '', chatId: '' };
      }
    }

    async function autoDetectChatId(silent = false) {
      const tokenInput = document.getElementById('botTokenInput')?.value.trim();
      const botToken = tokenInput || getTelegramSettings().botToken;
      if (!botToken) {
        if (!silent) showToast('أدخل توكن البوت الجديد من الإعدادات أولاً.', 'warning');
        return '';
      }

      try {
        let res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
        let data = await res.json();

        if (!data.ok && data.error_code === 409) {
          await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
          res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
          data = await res.json();
        }

        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          for (let i = data.result.length - 1; i >= 0; i--) {
            const upd = data.result[i];
            const chat =
              upd.message?.chat ||
              upd.channel_post?.chat ||
              upd.my_chat_member?.chat ||
              upd.callback_query?.message?.chat;

            if (chat && chat.id) {
              const detectedId = String(chat.id);
              document.getElementById('botTokenInput').value = botToken;
              document.getElementById('chatIdInput').value = detectedId;
              localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken, chatId: detectedId }));
              updateBotIndicator();
              logActivity(`تم الربط التلقائي مع حساب التليكرام (ID: ${detectedId})`);
              if (!silent) {
                showToast(`تم سحب معرف التليكرام تلقائياً (${detectedId}) وربط البوت بنجاح! 🎉`, 'success');
              }
              return detectedId;
            }
          }
        }

        if (!silent) {
          showToast('اضغط Start داخل بوت التليكرام (@Powargym_bot) أولاً ثم اضغط فحص الاتصال!', 'warning');
        }
      } catch (err) {
        console.error('Auto detect chat ID error:', err);
        if (!silent) {
          showToast('تعذر الاتصال بسيرفر التليكرام، تأكد من اتصال الإنترنت.', 'error');
        }
      }
      return '';
    }

    function updateBotIndicator() {
      const { botToken, chatId } = getTelegramSettings();
      const dot = document.getElementById('botStatusDot');
      const badgeMobile = document.getElementById('botStatusBadgeMobile');

      if (botToken && chatId) {
        dot.classList.remove('bg-red-500');
        dot.classList.add('bg-emerald-500');
        badgeMobile.textContent = 'البوت جاهز 🟢';
        badgeMobile.className = 'mt-1 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400';
      } else {
        dot.classList.remove('bg-emerald-500');
        dot.classList.add('bg-red-500');
        badgeMobile.textContent = 'البوت غير مضبوط 🔴';
        badgeMobile.className = 'mt-1 inline-flex rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-400';
      }
    }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');

      const colors = {
        success: 'bg-emerald-950/95 border-emerald-500 text-emerald-200',
        error: 'bg-red-950/95 border-red-500 text-red-200',
        warning: 'bg-amber-950/95 border-amber-500 text-amber-200',
        info: 'bg-slate-900/95 border-blue-500 text-blue-200'
      };

      const icons = {
        success: 'fa-circle-check text-emerald-400',
        error: 'fa-circle-exclamation text-red-400',
        warning: 'fa-triangle-exclamation text-amber-400',
        info: 'fa-circle-info text-blue-400'
      };

      toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border-r-4 shadow-2xl backdrop-blur-md text-xs md:text-sm font-bold transition-all duration-300 ${colors[type] || colors.info}`;
      
      const iconEl = document.createElement('i');
      iconEl.className = `fa-solid ${icons[type] || icons.info} text-lg`;
      
      const textEl = document.createElement('span');
      textEl.className = 'flex-1';
      textEl.textContent = message;

      toast.appendChild(iconEl);
      toast.appendChild(textEl);

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
      }, 3800);
    }

    // =========================================================
    // 5. المحرك الأساسي لحساب التواريخ والتقويم الذكي (Date & Smart Calendar Engine)
    // =========================================================
    const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const ARABIC_MONTHS = [
      'كانون الثاني (يناير)', 'شباط (فبراير)', 'آذار (مارس)', 'نيسان (أبريل)',
      'أيار (مايو)', 'حزيران (يونيو)', 'تموز (يوليو)', 'آب (أغسطس)',
      'أيلول (سبتمبر)', 'تشرين الأول (أكتوبر)', 'تشرين الثاني (نوفمبر)', 'كانون الأول (ديسمبر)'
    ];

    function getTodayDateString() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function addMonthsToDate(dateStr, monthsToAdd) {
      const parts = dateStr.split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      date.setMonth(date.getMonth() + Number(monthsToAdd));
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function addDaysToDate(dateStr, daysToAdd) {
      const parts = dateStr.split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      date.setDate(date.getDate() + Number(daysToAdd));
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function getArabicDayName(dateStr) {
      if (!isValidDateString(dateStr)) return '';
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return ARABIC_DAYS[dt.getDay()] || '';
    }

    function getThreeReminderDates(endDateStr) {
      if (!isValidDateString(endDateStr)) return { day3: '', day2: '', day1: '' };
      return {
        day3: addDaysToDate(endDateStr, -3),
        day2: addDaysToDate(endDateStr, -2),
        day1: addDaysToDate(endDateStr, -1)
      };
    }

    function calculateEndDate() {
      const startInput = document.getElementById('startDate').value;
      const duration = parseInt(document.getElementById('durationMonths').value, 10) || 1;
      if (!startInput) return;
      document.getElementById('endDate').value = addMonthsToDate(startInput, duration);
    }

    function applyDefaultPriceForDuration() {
      const editingId = document.getElementById('editingPlayerId').value;
      if (editingId) return; // لا نغير السعر تلقائياً إذا كان الكابتن يعدل لاعباً قديماً
      const duration = String(document.getElementById('durationMonths').value || '1');
      const defaultPrice = gymProfile.defaultPrices?.[duration] || (Number(duration) * 25000);
      document.getElementById('paidAmount').value = defaultPrice;
    }

    function getSubscriptionStatus(endDateStr) {
      const todayStr = getTodayDateString();
      const [ty, tm, td] = todayStr.split('-').map(Number);
      const [ey, em, ed] = (endDateStr || todayStr).split('-').map(Number);

      const todayDate = new Date(ty, tm - 1, td);
      const endDate = new Date(ey, em - 1, ed);

      const diffTime = endDate.getTime() - todayDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      // من تبقّى على اشتراكه يوم واحد أو أقل يُصنَّف "منتهي"
      if (diffDays <= 1) {
        return {
          status: 'expired',
          diffDays,
          label: diffDays < 0 ? `منتهي منذ ${Math.abs(diffDays)} يوم` : (diffDays === 0 ? 'منتهي (آخر يوم اليوم)' : 'منتهي (باقي يوم واحد)'),
          badgeClass: 'bg-red-500/15 text-red-400 border border-red-500/30',
          borderClass: 'border-red-500/50'
        };
      } else if (diffDays <= 3) {
        return {
          status: 'soon',
          diffDays,
          label: diffDays === 0 ? 'ينتهي اليوم!' : `ينتهي خلال ${diffDays} أيام`,
          badgeClass: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
          borderClass: 'border-amber-500/50'
        };
      } else {
        return {
          status: 'active',
          diffDays,
          label: `فعال (${diffDays} يوم متبقي)`,
          badgeClass: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
          borderClass: 'border-slate-700/70'
        };
      }
    }

    // نافذة التقويم الذكي وحاسبة التواريخ
    function openSmartCalendarModal() {
      const now = new Date();
      calendarViewYear = now.getFullYear();
      calendarViewMonth = now.getMonth();
      selectedCalendarDateStr = getTodayDateString();

      document.getElementById('calcStartDate').value = getTodayDateString();
      document.getElementById('calcDurationMonths').value = '1';
      document.getElementById('calcExtraDays').value = '0';

      renderSmartCalendar();
      runSmartDateCalculator();
      document.getElementById('smartCalendarModal').classList.remove('hidden');
    }

    function closeSmartCalendarModal() {
      document.getElementById('smartCalendarModal').classList.add('hidden');
    }

    function changeCalendarMonth(delta) {
      calendarViewMonth += delta;
      if (calendarViewMonth > 11) {
        calendarViewMonth = 0;
        calendarViewYear++;
      } else if (calendarViewMonth < 0) {
        calendarViewMonth = 11;
        calendarViewYear--;
      }
      renderSmartCalendar();
    }

    function resetCalendarToToday() {
      const now = new Date();
      calendarViewYear = now.getFullYear();
      calendarViewMonth = now.getMonth();
      selectedCalendarDateStr = getTodayDateString();
      renderSmartCalendar();
    }

    function renderSmartCalendar() {
      const titleEl = document.getElementById('calendarMonthTitle');
      if (titleEl) {
        titleEl.textContent = `${ARABIC_MONTHS[calendarViewMonth]} ${calendarViewYear}`;
      }

      const firstDayOfMonth = new Date(calendarViewYear, calendarViewMonth, 1).getDay();
      const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
      const todayStr = getTodayDateString();
      const grid = document.getElementById('smartCalendarGrid');
      if (!grid) return;

      let html = '';
      for (let i = 0; i < firstDayOfMonth; i++) {
        html += `<div class="p-2 rounded-xl bg-slate-950/30 border border-slate-900/40 min-h-[64px]"></div>`;
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const mStr = String(calendarViewMonth + 1).padStart(2, '0');
        const dStr = String(day).padStart(2, '0');
        const dateStr = `${calendarViewYear}-${mStr}-${dStr}`;

        const startedCount = players.filter(p => p.startDate === dateStr).length;
        const endedCount = players.filter(p => p.endDate === dateStr).length;
        const reminderCount = players.filter(p => {
          const r = getThreeReminderDates(p.endDate);
          return r.day3 === dateStr || r.day2 === dateStr || r.day1 === dateStr;
        }).length;

        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedCalendarDateStr;

        html += `
          <div onclick="selectCalendarDate('${dateStr}')" class="p-2 rounded-xl cursor-pointer transition min-h-[68px] flex flex-col justify-between border ${
            isSelected
              ? 'bg-amber-500/20 border-amber-400 shadow-lg'
              : isToday
                ? 'bg-slate-900 border-amber-500/60'
                : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-600'
          }">
            <div class="flex items-center justify-between">
              <span class="text-xs font-black ${isToday ? 'text-amber-400' : 'text-slate-200'}">${day}</span>
              ${isToday ? `<span class="text-[9px] bg-amber-500 text-black font-black px-1 rounded">اليوم</span>` : ''}
            </div>
            <div class="flex flex-wrap gap-1 mt-1">
              ${startedCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold" title="بدء اشتراك">${startedCount} بدء</span>` : ''}
              ${reminderCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold" title="إشعار تذكير الـ 3 أيام">${reminderCount} تذكير</span>` : ''}
              ${endedCount > 0 ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-red-500/20 text-red-300 font-bold" title="انتهاء اشتراك">${endedCount} ينتهي</span>` : ''}
            </div>
          </div>
        `;
      }

      grid.innerHTML = html;
      selectCalendarDate(selectedCalendarDateStr || todayStr);
    }

    function selectCalendarDate(dateStr) {
      selectedCalendarDateStr = dateStr;
      const box = document.getElementById('selectedCalendarDateDetails');
      if (!box) return;

      const dayName = getArabicDayName(dateStr);
      const started = players.filter(p => p.startDate === dateStr);
      const ending = players.filter(p => p.endDate === dateStr);
      const reminders = players.filter(p => {
        const r = getThreeReminderDates(p.endDate);
        return r.day3 === dateStr || r.day2 === dateStr || r.day1 === dateStr;
      });

      const itemsHtml = [];
      ending.forEach(p => {
        itemsHtml.push(`<div class="flex items-center justify-between bg-red-950/30 border border-red-500/30 px-3 py-1.5 rounded-xl">
          <span>🔴 <b>ينتهي اشتراك (شوكت يخلص):</b> ${escapeHtml(p.name)} (${escapeHtml(p.phone)})</span>
          <button onclick="sendSinglePlayerAlertToTelegram('${sanitizeId(p.id)}')" class="bg-red-500/20 hover:bg-red-500/40 text-red-300 px-2 py-0.5 rounded-lg text-[11px] font-bold">إبلاغ بالتلي ✈️</button>
        </div>`);
      });

      reminders.forEach(p => {
        const r = getThreeReminderDates(p.endDate);
        const whichNum = r.day3 === dateStr ? '1/3 (قبل 3 أيام)' : r.day2 === dateStr ? '2/3 (قبل يومين)' : '3/3 (قبل يوم واحد)';
        itemsHtml.push(`<div class="flex items-center justify-between bg-amber-950/30 border border-amber-500/30 px-3 py-1.5 rounded-xl">
          <span>🔔 <b>موعد إشعار التذكير (${whichNum}):</b> ${escapeHtml(p.name)} — ينتهي ${escapeHtml(p.endDate)}</span>
          <button onclick="sendThreeDayReminderToPlayerById('${sanitizeId(p.id)}')" class="bg-amber-500/20 hover:bg-amber-500/40 text-amber-300 px-2 py-0.5 rounded-lg text-[11px] font-bold">إرسال تذكير 🔔</button>
        </div>`);
      });

      started.forEach(p => {
        itemsHtml.push(`<div class="flex items-center justify-between bg-emerald-950/30 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
          <span>🟢 <b>بدأ اشتراك:</b> ${escapeHtml(p.name)} (${Number(p.durationMonths)} شهر — ينتهي ${escapeHtml(p.endDate)})</span>
          <span class="text-emerald-400 font-bold">${Number(p.paidAmount).toLocaleString('en-US')} د.ع</span>
        </div>`);
      });

      box.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800">
          <span class="font-black text-amber-400">📅 أحداث يوم ${escapeHtml(dayName)} (${escapeHtml(dateStr)})</span>
          <button onclick="openAddModalWithDate('${escapeHtml(dateStr)}')" class="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg text-[11px] font-bold">
            + تسجيل لاعب بتاريخ ${escapeHtml(dateStr)}
          </button>
        </div>
        ${itemsHtml.length > 0 ? `<div class="space-y-1.5 max-h-36 overflow-y-auto">${itemsHtml.join('')}</div>` : `<p class="text-slate-400 text-center py-2">لا توجد مواعيد انتهاء أو بداية مسجلة في هذا اليوم.</p>`}
      `;
    }

    function openAddModalWithDate(dateStr) {
      closeSmartCalendarModal();
      openAddModal();
      if (isValidDateString(dateStr)) {
        document.getElementById('startDate').value = dateStr;
        calculateEndDate();
      }
    }

    function runSmartDateCalculator() {
      const startStr = document.getElementById('calcStartDate')?.value || getTodayDateString();
      const months = parseInt(document.getElementById('calcDurationMonths')?.value, 10) || 1;
      const extraDays = parseInt(document.getElementById('calcExtraDays')?.value, 10) || 0;

      const baseEnd = addMonthsToDate(startStr, months);
      const finalEnd = extraDays > 0 ? addDaysToDate(baseEnd, extraDays) : baseEnd;
      const sub = getSubscriptionStatus(finalEnd);
      const reminders = getThreeReminderDates(finalEnd);
      const defaultPrice = gymProfile.defaultPrices?.[String(months)] || (months * 25000);

      const box = document.getElementById('smartCalcResultsBox');
      if (!box) return;

      box.innerHTML = `
        <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
          <span class="text-slate-400">تاريخ البدء:</span>
          <span class="font-bold text-white">${escapeHtml( getArabicDayName(startStr) )} ${escapeHtml(startStr)}</span>
        </div>
        <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
          <span class="text-slate-400">شوكت يخلص (الانتهاء):</span>
          <span class="font-black text-emerald-400">${escapeHtml( getArabicDayName(finalEnd) )} ${escapeHtml(finalEnd)}</span>
        </div>
        <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
          <span class="text-slate-400">المدة الصافية:</span>
          <span class="font-bold text-amber-400">${months} شهر ${extraDays > 0 ? `+ ${extraDays} يوم` : ''} (${escapeHtml(sub.label)})</span>
        </div>
        <div class="flex justify-between items-center border-b border-slate-800 pb-1.5">
          <span class="text-slate-400">السعر المخصص:</span>
          <span class="font-black text-purple-400">${Number(defaultPrice).toLocaleString('en-US')} د.ع</span>
        </div>
        <div class="pt-1 space-y-1">
          <span class="block text-[11px] font-black text-amber-400">🔔 مواعيد إشعارات التليكرام الـ 3 قبل الانتهاء:</span>
          <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
            <span>1️⃣ الإشعار الأول (قبل 3 أيام):</span>
            <b class="text-amber-300" dir="ltr">${escapeHtml(reminders.day3)}</b>
          </div>
          <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
            <span>2️⃣ الإشعار الثاني (قبل يومين):</span>
            <b class="text-amber-300" dir="ltr">${escapeHtml(reminders.day2)}</b>
          </div>
          <div class="text-[11px] text-slate-300 bg-slate-900 px-2.5 py-1 rounded-lg flex justify-between">
            <span>3️⃣ الإشعار الثالث (قبل يوم):</span>
            <b class="text-amber-300" dir="ltr">${escapeHtml(reminders.day1)}</b>
          </div>
        </div>
      `;
    }

    function applyCalculatedDatesToNewPlayer() {
      const startStr = document.getElementById('calcStartDate')?.value || getTodayDateString();
      const months = parseInt(document.getElementById('calcDurationMonths')?.value, 10) || 1;
      const extraDays = parseInt(document.getElementById('calcExtraDays')?.value, 10) || 0;
      const baseEnd = addMonthsToDate(startStr, months);
      const finalEnd = extraDays > 0 ? addDaysToDate(baseEnd, extraDays) : baseEnd;

      closeSmartCalendarModal();
      openAddModal();
      document.getElementById('startDate').value = startStr;
      document.getElementById('durationMonths').value = String(months);
      document.getElementById('endDate').value = finalEnd;
      applyDefaultPriceForDuration();
    }

    // =========================================================
    // 6. مركز الأرباح والديون والتخصيص الذكي (Financial & Customization Hub)
    // =========================================================
    function calculateFinancialMetrics() {
      let playersPaidTotal = 0;
      let playersDebtTotal = 0;

      players.forEach(p => {
        playersPaidTotal += Number(p.paidAmount) || 0;
        playersDebtTotal += Number(p.debtAmount) || 0;
      });

      let txIncome = 0;
      let txExpense = 0;
      (financeLedger.transactions || []).forEach(tx => {
        if (tx.type === 'expense') {
          txExpense += Number(tx.amount) || 0;
        } else if (tx.type === 'income' || !tx.type) {
          txIncome += Number(tx.amount) || 0;
        }
      });

      const manualProfit = Number(financeLedger.manualProfitAdjustment) || 0;
      const manualDebt = Number(financeLedger.manualDebtAdjustment) || 0;

      const netProfit = playersPaidTotal + txIncome + manualProfit - txExpense;
      const totalDebt = Math.max(0, playersDebtTotal + manualDebt);

      return {
        playersPaidTotal,
        playersDebtTotal,
        txIncome,
        txExpense,
        manualProfit,
        manualDebt,
        netProfit,
        totalDebt
      };
    }

    function openFinanceModal(defaultTab = 'profits') {
      document.getElementById('finManualProfitInput').value = financeLedger.manualProfitAdjustment || 0;
      document.getElementById('finManualDebtInput').value = financeLedger.manualDebtAdjustment || 0;
      document.getElementById('finDebtDate').value = getTodayDateString();

      document.getElementById('customGymNameInput').value = gymProfile.gymName;
      document.getElementById('customGymBranchInput').value = gymProfile.gymBranch;
      document.getElementById('customSupervisorNameInput').value = gymProfile.supervisorName || '';
      document.getElementById('customReceiptStampInput').value = gymProfile.receiptStamp || '';
      document.getElementById('priceMonth1').value = gymProfile.defaultPrices['1'] || 25000;
      document.getElementById('priceMonth2').value = gymProfile.defaultPrices['2'] || 45000;
      document.getElementById('priceMonth3').value = gymProfile.defaultPrices['3'] || 65000;
      document.getElementById('priceMonth6').value = gymProfile.defaultPrices['6'] || 120000;
      document.getElementById('priceMonth12').value = gymProfile.defaultPrices['12'] || 220000;

      renderFinanceSummary();
      renderFinancePlayersList();
      switchFinanceTab(defaultTab);
      document.getElementById('financeModal').classList.remove('hidden');
    }

    function closeFinanceModal() {
      document.getElementById('financeModal').classList.add('hidden');
    }

    function switchFinanceTab(tabName) {
      ['profits', 'debts', 'customize'].forEach(t => {
        const btn = document.getElementById(`finTabBtn-${t}`);
        const content = document.getElementById(`finTabContent-${t}`);
        if (!btn || !content) return;
        if (t === tabName) {
          btn.className = 'px-4 py-2 rounded-xl text-xs font-black bg-amber-500 text-black transition whitespace-nowrap';
          content.classList.remove('hidden');
        } else {
          btn.className = 'px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition whitespace-nowrap';
          content.classList.add('hidden');
        }
      });
    }

    function renderFinanceSummary() {
      const m = calculateFinancialMetrics();
      const paidEl = document.getElementById('finPlayersPaidTotal');
      const extraEl = document.getElementById('finExtraIncomeTotal');
      const expEl = document.getElementById('finExpensesTotal');
      const netEl = document.getElementById('finNetProfitDisplay');
      const debtBannerEl = document.getElementById('finTotalDebtBanner');

      if (paidEl) paidEl.textContent = `${m.playersPaidTotal.toLocaleString('en-US')} د.ع`;
      if (extraEl) extraEl.textContent = `${(m.txIncome + m.manualProfit).toLocaleString('en-US')} د.ع`;
      if (expEl) expEl.textContent = `${m.txExpense.toLocaleString('en-US')} د.ع`;
      if (netEl) netEl.textContent = `${m.netProfit.toLocaleString('en-US')} د.ع`;
      if (debtBannerEl) debtBannerEl.textContent = `${m.totalDebt.toLocaleString('en-US')} د.ع`;

      const txListEl = document.getElementById('finTransactionsList');
      if (!txListEl) return;

      if (!financeLedger.transactions || financeLedger.transactions.length === 0) {
        txListEl.innerHTML = `<p class="text-[11px] text-slate-500 text-center py-2">لا توجد حركات مالية إضافية مسجلة.</p>`;
      } else {
        txListEl.innerHTML = financeLedger.transactions.map(tx => `
          <div class="flex items-center justify-between bg-slate-950/90 border border-slate-800 px-3 py-2 rounded-xl text-xs">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-black ${tx.type === 'expense' ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}">
                ${tx.type === 'expense' ? 'مصروف ➖' : 'إيراد ➕'}
              </span>
              <span class="font-bold text-white">${escapeHtml(tx.title)}</span>
              <span class="text-[10px] text-slate-500" dir="ltr">${escapeHtml(tx.date)}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-black ${tx.type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}">${Number(tx.amount).toLocaleString('en-US')} د.ع</span>
              <button onclick="deleteFinanceTransaction('${sanitizeId(tx.id)}')" class="text-red-400 hover:text-red-300 p-1">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        `).join('');
      }
    }

    function saveManualFinanceAdjustments() {
      const manualProfit = Number(document.getElementById('finManualProfitInput').value) || 0;
      const manualDebt = Number(document.getElementById('finManualDebtInput').value) || 0;

      financeLedger.manualProfitAdjustment = manualProfit;
      financeLedger.manualDebtAdjustment = manualDebt;
      saveFinanceLedgerToStorage();
      renderFinanceSummary();
      logActivity(`تعديل يدوي للأرباح (${manualProfit} د.ع) والديون (${manualDebt} د.ع)`);
      showToast('تم حفظ تعديلات الأرباح والديون بنجاح 💰✅', 'success');
    }

    function addFinanceTransaction() {
      const title = document.getElementById('finTxTitle').value.trim();
      const type = document.getElementById('finTxType').value === 'expense' ? 'expense' : 'income';
      const amount = Math.max(0, Number(document.getElementById('finTxAmount').value) || 0);

      if (!title || amount <= 0) {
        showToast('يرجى إدخال وصف الحركة والمبلغ بشكل صحيح!', 'warning');
        return;
      }

      const tx = {
        id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: title.slice(0, 100),
        type,
        amount,
        date: getTodayDateString()
      };

      financeLedger.transactions.unshift(tx);
      document.getElementById('finTxTitle').value = '';
      document.getElementById('finTxAmount').value = '';

      saveFinanceLedgerToStorage();
      renderFinanceSummary();
      logActivity(`إضافة حركة مالية (${type === 'expense' ? 'مصروف' : 'إيراد'}): ${tx.title} (${amount} د.ع)`);
      showToast('تمت إضافة الحركة المالية وتحديث صافي الأرباح بنجاح ✅', 'success');
    }

    function deleteFinanceTransaction(txId) {
      financeLedger.transactions = (financeLedger.transactions || []).filter(t => t.id !== txId);
      saveFinanceLedgerToStorage();
      renderFinanceSummary();
      showToast('تم حذف الحركة المالية وتحديث الأرباح', 'info');
    }

    function renderFinancePlayersList() {
      const listEl = document.getElementById('financePlayersDebtList');
      if (!listEl) return;

      const debtPlayerSelect = document.getElementById('finDebtPlayerId');
      if (debtPlayerSelect) {
        const selectedPlayerId = debtPlayerSelect.value;
        debtPlayerSelect.innerHTML = players.length
          ? players.map(p => `<option value="${escapeHtml(sanitizeId(p.id))}">${escapeHtml(p.name)} (${escapeHtml(p.code)})</option>`).join('')
          : '<option value="">لا يوجد لاعبون مسجلون</option>';
        if (players.some(p => p.id === selectedPlayerId)) debtPlayerSelect.value = selectedPlayerId;
      }

      const q = (document.getElementById('finDebtSearchInput')?.value || '').trim().toLowerCase();
      const onlyDebtors = document.getElementById('finOnlyDebtorsCheckbox')?.checked;

      const filtered = players.filter(p => {
        if (onlyDebtors && (Number(p.debtAmount) || 0) <= 0) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || p.phone.includes(q) || (p.code && p.code.toLowerCase().includes(q));
      });

      if (filtered.length === 0) {
        listEl.innerHTML = `<p class="text-center text-slate-400 py-6 text-xs">لا يوجد لاعبون مطابقون للبحث.</p>`;
        return;
      }

      listEl.innerHTML = filtered.map(p => {
        const safeId = sanitizeId(p.id);
        const hasDebt = (Number(p.debtAmount) || 0) > 0;
        const playerEntries = (financeLedger.debtEntries || [])
          .filter(entry => entry.playerId === p.id)
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const playerPayments = (financeLedger.debtPayments || [])
          .filter(payment => payment.playerId === p.id)
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const trackedDebt = playerEntries.reduce((total, entry) =>
          total + Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0)), 0);
        const untrackedDebt = Math.max(0, (Number(p.debtAmount) || 0) - trackedDebt);
        return `
          <div class="bg-slate-950/85 border ${hasDebt ? 'border-rose-500/40' : 'border-slate-800'} rounded-2xl p-3 flex flex-col items-stretch gap-3 text-xs">
            <div class="flex items-center gap-2.5 w-full md:w-auto">
              <span class="px-2 py-0.5 rounded bg-slate-800 text-amber-400 font-black" dir="ltr">${escapeHtml(p.code)}</span>
              <div>
                <div class="font-black text-white text-sm">${escapeHtml(p.name)}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(p.phone)} | ينتهي: ${escapeHtml(p.endDate)}</div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
              <div>
                <label class="block text-[10px] text-emerald-400 font-bold">المدفوع (د.ع)</label>
                <input type="number" id="quickPaid_${safeId}" value="${Number(p.paidAmount) || 0}" step="500" min="0" class="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
              </div>
              <div>
                <label class="block text-[10px] text-rose-400 font-bold">الدين المتبقي (د.ع)</label>
                <input type="number" id="quickDebt_${safeId}" value="${Number(p.debtAmount) || 0}" step="500" min="0" class="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
              </div>
              <button onclick="updatePlayerFinanceQuick('${safeId}')" class="bg-amber-500 hover:bg-amber-400 text-black font-black px-3 py-2 rounded-xl mt-3.5 transition">
                حفظ 💾
              </button>
              ${hasDebt ? `
                <button onclick="settlePlayerDebtFull('${safeId}')" class="bg-emerald-500 hover:bg-emerald-400 text-black font-black px-3 py-2 rounded-xl mt-3.5 transition" title="تحويل كامل الدين إلى المبلغ المدفوع وتصفير الدين">
                  تسديد كامل ✅
                </button>
              ` : ''}
              ${hasDebt ? `
                <div class="flex items-end gap-1.5">
                  <div>
                    <label class="block text-[10px] text-blue-300 font-bold">تحصيل جزئي (د.ع)</label>
                    <input type="number" id="debtPayment_${safeId}" min="1" max="${Number(p.debtAmount) || 0}" step="500" placeholder="المبلغ" class="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-bold">
                  </div>
                  <button onclick="recordPlayerDebtPayment('${safeId}')" class="bg-blue-600 hover:bg-blue-500 text-white font-black px-3 py-2 rounded-xl transition">
                    تحصيل
                  </button>
                </div>
              ` : ''}
            </div>
            <details class="w-full border-t border-slate-800 pt-2">
              <summary class="cursor-pointer text-rose-300 font-bold">
                سجل المشتريات والديون (${playerEntries.length}) — ${trackedDebt.toLocaleString('en-US')} د.ع مسجل
              </summary>
              <div class="space-y-2 mt-2">
                ${untrackedDebt > 0 ? `<div class="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2 text-[11px] text-amber-200">رصيد سابق غير مفصل: ${untrackedDebt.toLocaleString('en-US')} د.ع — لا تتوفر له تفاصيل مشتريات محفوظة.</div>` : ''}
                ${playerEntries.length ? playerEntries.map(entry => {
                  const remaining = Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0));
                  return `<div class="bg-slate-900 border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-[180px]">
                      <div class="font-black text-white">${escapeHtml(entry.description)}</div>
                      <div class="text-[10px] text-slate-400">${escapeHtml(entry.date)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</div>
                    </div>
                    <div class="text-[10px] text-slate-300">الأصل: ${Number(entry.amount).toLocaleString('en-US')} · المسدد: ${Number(entry.paidAmount || 0).toLocaleString('en-US')} · <b class="text-rose-300">المتبقي: ${remaining.toLocaleString('en-US')} د.ع</b></div>
                  </div>`;
                }).join('') : '<p class="text-[11px] text-slate-500">لا توجد تفاصيل مشتريات مسجلة لهذا اللاعب بعد.</p>'}
                ${playerPayments.length ? `<div class="border-t border-slate-800 pt-2 mt-2">
                  <p class="text-[10px] font-black text-emerald-300 mb-1">سجل التحصيلات</p>
                  ${playerPayments.map(payment => `<p class="text-[10px] text-slate-300">${escapeHtml(payment.date)} · تحصيل ${Number(payment.amount).toLocaleString('en-US')} د.ع</p>`).join('')}
                </div>` : ''}
              </div>
            </details>
          </div>
        `;
      }).join('');
    }

    function persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger) {
      const previousPlayersStorage = localStorage.getItem(STORAGE_KEYS.PLAYERS);
      const previousLedgerStorage = localStorage.getItem(STORAGE_KEYS.FINANCE_LEDGER);
      try {
        localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, JSON.stringify(financeLedger));
        localStorage.setItem(STORAGE_KEYS.PLAYERS, JSON.stringify(players));
      } catch (error) {
        const player = players.find(p => p.id === playerId);
        if (player) Object.assign(player, previousPlayer);
        financeLedger = previousLedger;
        try {
          if (previousLedgerStorage === null) localStorage.removeItem(STORAGE_KEYS.FINANCE_LEDGER);
          else localStorage.setItem(STORAGE_KEYS.FINANCE_LEDGER, previousLedgerStorage);
          if (previousPlayersStorage === null) localStorage.removeItem(STORAGE_KEYS.PLAYERS);
          else localStorage.setItem(STORAGE_KEYS.PLAYERS, previousPlayersStorage);
        } catch (restoreError) {
          console.error('Could not restore player debt data after a failed save:', restoreError);
        }
        console.error('Could not save player debt data:', error);
        showToast('تعذر حفظ الدين أو التحصيل. لم يتم اعتماد التغيير؛ تحقق من مساحة التخزين.', 'error');
        return false;
      }
      renderPlayers();
      renderFinanceSummary();
      renderFinancePlayersList();
      return true;
    }

    function addPlayerDebtEntry() {
      const playerId = sanitizeId(document.getElementById('finDebtPlayerId').value);
      const player = players.find(p => p.id === playerId);
      const description = document.getElementById('finDebtDescription').value.trim().slice(0, 100);
      const amount = Number(document.getElementById('finDebtAmount').value);
      const date = document.getElementById('finDebtDate').value;
      const notes = document.getElementById('finDebtNotes').value.trim().slice(0, 160);
      if (!player || !description || !Number.isSafeInteger(amount) || amount <= 0 || !isValidDateString(date)) {
        showToast('اختر لاعباً وأدخل وصفاً ومبلغاً صحيحاً وتاريخاً صالحاً.', 'warning');
        return;
      }

      const previousPlayer = JSON.parse(JSON.stringify(player));
      const previousLedger = JSON.parse(JSON.stringify(financeLedger));
      const entry = {
        id: `debt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        playerId,
        description,
        amount,
        paidAmount: 0,
        date,
        notes,
        createdAt: new Date().toISOString()
      };
      financeLedger.debtEntries = Array.isArray(financeLedger.debtEntries) ? financeLedger.debtEntries : [];
      financeLedger.debtEntries.unshift(entry);
      player.debtAmount = (Number(player.debtAmount) || 0) + amount;
      player.updatedAt = new Date().toISOString();
      if (!persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger)) return;

      document.getElementById('finDebtDescription').value = '';
      document.getElementById('finDebtAmount').value = '';
      document.getElementById('finDebtNotes').value = '';
      logActivity(`تسجيل دين للاعب ${player.name}: ${description} (${amount} د.ع)`);
      showToast(`تم تسجيل "${description}" وإضافته إلى دين ${player.name}.`, 'success');
      notifyPlayerAboutDebt(player, 'debt', description, amount);
    }

    function recordPlayerDebtPayment(playerId, requestedAmount = null) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      const input = requestedAmount === null ? document.getElementById(`debtPayment_${sanitizeId(playerId)}`) : null;
      const amount = requestedAmount === null ? Number(input?.value) : Number(requestedAmount);
      const currentDebt = Number(player.debtAmount) || 0;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > currentDebt) {
        showToast(`أدخل مبلغاً صحيحاً لا يتجاوز الدين الحالي (${currentDebt.toLocaleString('en-US')} د.ع).`, 'warning');
        return;
      }

      const previousPlayer = JSON.parse(JSON.stringify(player));
      const previousLedger = JSON.parse(JSON.stringify(financeLedger));
      let remainingPayment = amount;
      const entries = (financeLedger.debtEntries || [])
        .filter(entry => entry.playerId === playerId)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      entries.forEach(entry => {
        const outstanding = Math.max(0, Number(entry.amount) - Number(entry.paidAmount || 0));
        const applied = Math.min(outstanding, remainingPayment);
        entry.paidAmount = (Number(entry.paidAmount) || 0) + applied;
        remainingPayment -= applied;
      });

      player.debtAmount = currentDebt - amount;
      player.paidAmount = (Number(player.paidAmount) || 0) + amount;
      player.updatedAt = new Date().toISOString();
      financeLedger.debtPayments = Array.isArray(financeLedger.debtPayments) ? financeLedger.debtPayments : [];
      financeLedger.debtPayments.unshift({
        id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        playerId,
        title: `تحصيل دين: ${player.name}`,
        amount,
        date: getTodayDateString()
      });
      if (!persistPlayerDebtUpdate(playerId, previousPlayer, previousLedger)) return;

      logActivity(`تحصيل ${amount} د.ع من دين اللاعب ${player.name}`);
      showToast(`تم تسجيل تحصيل ${amount.toLocaleString('en-US')} د.ع من ${player.name}.`, 'success');
      notifyPlayerAboutDebt(player, 'payment', 'تسديد من رصيد الدين', amount);
    }

    function updatePlayerFinanceQuick(playerId) {
      const idx = players.findIndex(p => p.id === playerId);
      if (idx === -1) return;

      const paidInput = document.getElementById(`quickPaid_${playerId}`);
      const debtInput = document.getElementById(`quickDebt_${playerId}`);
      if (!paidInput || !debtInput) return;

      players[idx].paidAmount = Math.max(0, Number(paidInput.value) || 0);
      players[idx].debtAmount = Math.max(0, Number(debtInput.value) || 0);
      players[idx].updatedAt = new Date().toISOString();

      savePlayersToStorage();
      renderFinanceSummary();
      renderFinancePlayersList();
      logActivity(`تعديل مالي للاعب ${players[idx].name}: مدفوع=${players[idx].paidAmount}، دين=${players[idx].debtAmount}`);
      showToast(`تم تحديث الحساب المالي للبطل "${players[idx].name}" بنجاح ✅`, 'success');
    }

    function settlePlayerDebtFull(playerId) {
      const idx = players.findIndex(p => p.id === playerId);
      if (idx === -1) return;

      const debt = Number(players[idx].debtAmount) || 0;
      if (debt <= 0) return;
      recordPlayerDebtPayment(playerId, debt);
    }

    function saveGymCustomization() {
      gymProfile.gymName = document.getElementById('customGymNameInput').value.trim() || 'Power Gym | بور جم';
      gymProfile.gymBranch = document.getElementById('customGymBranchInput').value.trim() || 'كربلاء - الحر - قرب فلكة الثورة';
      gymProfile.supervisorName = document.getElementById('customSupervisorNameInput').value.trim().slice(0, 60);
      gymProfile.receiptStamp = document.getElementById('customReceiptStampInput').value.trim().slice(0, 100);
      gymProfile.defaultPrices = {
        '1': Math.max(0, Number(document.getElementById('priceMonth1').value) || 25000),
        '2': Math.max(0, Number(document.getElementById('priceMonth2').value) || 45000),
        '3': Math.max(0, Number(document.getElementById('priceMonth3').value) || 65000),
        '6': Math.max(0, Number(document.getElementById('priceMonth6').value) || 120000),
        '12': Math.max(0, Number(document.getElementById('priceMonth12').value) || 220000)
      };

      localStorage.setItem(STORAGE_KEYS.GYM_PROFILE, JSON.stringify(gymProfile));
      applyGymBrandingToUI();
      logActivity('تم تحديث تخصيص اسم الجيم وأسعار الاشتراكات الافتراضية');
      showToast('تم حفظ تخصيص القاعة وأسعار الاشتراكات بنجاح ⚙️✅', 'success');
    }

    // =========================================================
    // 7. نظام الواتساب وتنسيق الرقم العراقي وربط تليكرام اللاعب
    // =========================================================
    function formatIraqiPhone(phone) {
      let digits = String(phone || '').replace(/\D/g, '');
      if (digits.startsWith('00964')) {
        digits = '964' + digits.slice(5);
      } else if (digits.startsWith('07')) {
        digits = '964' + digits.slice(1);
      } else if (digits.startsWith('7') && digits.length === 10) {
        digits = '964' + digits;
      }
      return digits;
    }

    function generateWhatsAppLink(player) {
      const intlPhone = formatIraqiPhone(player.phone);
      const botDeepLink = `https://t.me/${BOT_USERNAME}?start=ACT_${intlPhone}`;
      const message = `السلام عليكم كابتن ${player.name} الحبيب 💪🔥،\nتم تفعيل/تحديث بيانات اشتراكك في *${gymProfile.gymName}* (${gymProfile.gymBranch}).\n📅 تاريخ البدء: ${player.startDate}\n⏳ المدة: ${player.durationMonths} شهر\n🏁 تاريخ الانتهاء (شوكت يخلص): ${player.endDate}\n\n📲 اضغط على الرابط التالي لتفعيل إشعارات اشتراكك على بوت التليكرام:\n${botDeepLink}`;
      return `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
    }

    // البحث الفوري عن معرف تليكرام اللاعب عند إدخال الكابتن لرقم الموبايل
    function handlePhoneInputLookup(phoneVal) {
      const intl = formatIraqiPhone(phoneVal);
      const badge = document.getElementById('playerTelegramLinkBadge');
      const chatInput = document.getElementById('playerChatIdInput');
      if (!badge || !chatInput) return;

      const matched = telegramDirectory?.phoneToChatId?.[intl];
      if (matched && matched.chatId) {
        chatInput.value = matched.chatId;
        badge.textContent = `🟢 رقم اللاعب مربوط بالبوت تلقائياً (ID: ${matched.chatId})`;
        badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black';
      } else {
        badge.textContent = '📲 سيُرسل التفعيل فور الحفظ أو عند ضغط اللاعب Start بالبوت';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold';
      }
    }

    // =========================================================
    // 8. ضغط وفحص صورة اللاعب عبر Canvas
    // =========================================================
    function handleImageUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        showToast('يرجى اختيار صورة بصيغة JPG أو PNG أو WebP فقط!', 'error');
        event.target.value = '';
        return;
      }

      if (file.size > 15 * 1024 * 1024) {
        showToast('حجم الصورة كبير جداً (الأقصى 15MB)!', 'error');
        event.target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 450;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          compressedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.72);
          document.getElementById('photoPreview').src = compressedPhotoDataUrl;
          showToast('تم فحص وضغط صورة اللاعب بنجاح 📸', 'info');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    function compressCourseImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذرت قراءة الصورة.'));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error('ملف الصورة غير صالح.'));
          image.onload = () => {
            const compress = (maxSize, quality) => {
              const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(image.width * scale));
              canvas.height = Math.max(1, Math.round(image.height * scale));
              const context = canvas.getContext('2d');
              if (!context) throw new Error('تعذر تجهيز الصورة للضغط.');
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              return canvas.toDataURL('image/jpeg', quality);
            };

            try {
              let dataUrl = compress(850, 0.62);
              if (Math.ceil(dataUrl.length * 0.75) > 220 * 1024) dataUrl = compress(560, 0.5);
              if (Math.ceil(dataUrl.length * 0.75) > 220 * 1024) {
                reject(new Error('حجم الصورة بعد الضغط ما زال كبيراً؛ اختر صورة أصغر.'));
                return;
              }
              resolve(dataUrl);
            } catch (error) {
              reject(error);
            }
          };
          image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
    }

    function renderCourseImagesPreview() {
      const preview = document.getElementById('courseImagesPreview');
      if (!preview) return;
      preview.innerHTML = courseImagesDraft.map((image, index) => `
        <div class="relative rounded-xl overflow-hidden border border-blue-500/30 bg-slate-950">
          <img src="${image}" alt="صورة كورس ${index + 1}" class="w-full h-28 object-cover">
          <button type="button" onclick="removeCourseImage(${index})" class="absolute top-1 left-1 w-7 h-7 rounded-lg bg-slate-950/90 text-rose-300 hover:bg-rose-600 hover:text-white" aria-label="حذف الصورة ${index + 1}">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
        </div>
      `).join('');
    }

    async function handleCourseImagesUpload(event) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;
      if (courseImagesDraft.length + files.length > 5) {
        showToast(`يمكن حفظ 5 صور كحد أقصى؛ المتبقي ${5 - courseImagesDraft.length}.`, 'warning');
        return;
      }

      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          showToast(`تم تجاهل "${file.name}": اختر JPG أو PNG أو WebP فقط.`, 'error');
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast(`تم تجاهل "${file.name}": الحد الأقصى لحجم الصورة 10MB.`, 'error');
          continue;
        }
        try {
          courseImagesDraft.push(await compressCourseImage(file));
          renderCourseImagesPreview();
        } catch (error) {
          console.error('Could not process course image:', error);
          showToast(error.message || 'تعذرت معالجة صورة الكورس.', 'error');
        }
      }
    }

    function removeCourseImage(index) {
      if (!Number.isInteger(index) || index < 0 || index >= courseImagesDraft.length) return;
      courseImagesDraft.splice(index, 1);
      renderCourseImagesPreview();
    }

    function dataURLtoBlob(dataurl) {
      const arr = dataurl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    }

    // =========================================================
    // 9. إدارة إضافة / تعديل / تجديد اللاعبين
    // =========================================================
    function openAddModal() {
      document.getElementById('editingPlayerId').value = '';
      document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-user-plus text-amber-500"></i><span>إضافة لاعب جديد</span>`;
      document.getElementById('saveBtn').textContent = 'حفظ وإرسال رسالة التفعيل للتليكرام';
      document.getElementById('playerForm').reset();

      compressedPhotoDataUrl = '';
      courseImagesDraft = [];
      document.getElementById('courseNotes').value = '';
      renderCourseImagesPreview();
      document.getElementById('photoPreview').src = DEFAULT_AVATAR;

      const today = getTodayDateString();
      document.getElementById('startDate').value = today;
      document.getElementById('durationMonths').value = '1';
      document.getElementById('paidAmount').value = gymProfile.defaultPrices?.['1'] || 25000;
      document.getElementById('debtAmount').value = '0';
      document.getElementById('playerChatIdInput').value = '';
      document.getElementById('sendActivationOnSave').checked = true;
      handlePhoneInputLookup('');
      calculateEndDate();

      document.getElementById('playerModal').classList.remove('hidden');
    }

    function openEditModal(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;

      document.getElementById('editingPlayerId').value = player.id;
      document.getElementById('modalTitle').innerHTML = `<i class="fa-solid fa-user-pen text-amber-500"></i><span>تعديل بيانات اللاعب</span>`;
      document.getElementById('saveBtn').textContent = 'حفظ التعديلات وإرسال التفعيل';

      document.getElementById('playerName').value = player.name;
      document.getElementById('playerAge').value = player.age;
      document.getElementById('playerPhone').value = player.phone;
      document.getElementById('planType').value = player.planType || 'حديد عام (كمال أجسام)';
      document.getElementById('startDate').value = player.startDate;
      document.getElementById('durationMonths').value = String(player.durationMonths || 1);
      document.getElementById('endDate').value = player.endDate;
      document.getElementById('paidAmount').value = player.paidAmount ?? 25000;
      document.getElementById('debtAmount').value = player.debtAmount ?? 0;
      document.getElementById('playerNotes').value = player.notes || '';
      document.getElementById('courseNotes').value = player.courseNotes || '';
      courseImagesDraft = Array.isArray(player.courseImages) ? player.courseImages.slice(0, 5) : [];
      renderCourseImagesPreview();
      document.getElementById('playerChatIdInput').value = player.playerChatId || '';

      handlePhoneInputLookup(player.phone);
      compressedPhotoDataUrl = player.photo || '';
      document.getElementById('photoPreview').src = sanitizePhotoSource(player.photo);

      document.getElementById('playerModal').classList.remove('hidden');
    }

    function closePlayerModal() {
      document.getElementById('playerModal').classList.add('hidden');
    }

    async function savePlayer(event) {
      event.preventDefault();

      const saveBtn = document.getElementById('saveBtn');
      const editingId = document.getElementById('editingPlayerId').value;
      const name = document.getElementById('playerName').value.trim();
      const age = parseInt(document.getElementById('playerAge').value, 10);
      const phone = document.getElementById('playerPhone').value.trim();
      const planType = document.getElementById('planType').value;
      const startDate = document.getElementById('startDate').value;
      const durationMonths = parseInt(document.getElementById('durationMonths').value, 10);
      const endDate = document.getElementById('endDate').value;
      const paidAmount = Math.max(0, Number(document.getElementById('paidAmount').value) || 0);
      const debtAmount = Math.max(0, Number(document.getElementById('debtAmount').value) || 0);
      const notes = document.getElementById('playerNotes').value.trim();
      const courseNotes = document.getElementById('courseNotes').value.trim();
      const courseImages = courseImagesDraft.slice(0, 5);
      const customPlayerChatId = document.getElementById('playerChatIdInput').value.trim();
      const shouldSendActivation = document.getElementById('sendActivationOnSave').checked;

      if (!name || !phone || !startDate || !endDate) {
        showToast('يرجى ملء جميع الحقول المطلوبة!', 'warning');
        return;
      }

      saveBtn.disabled = true;
      const originalBtnText = saveBtn.textContent;
      saveBtn.innerHTML = shouldSendActivation
        ? `<i class="fa-solid fa-spinner fa-spin ml-2"></i> جاري الحفظ وإرسال التفعيل...`
        : `<i class="fa-solid fa-spinner fa-spin ml-2"></i> جاري الحفظ...`;

      try {
        // فحص سريع لآخر رسائل البوت لربط رقم اللاعب إن كان قد ضغط Start للتو
        await pollBotUpdatesForPlayers(true);

        const intlPhone = formatIraqiPhone(phone);
        const linkedChatId = customPlayerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '';
        const previousPlayers = players.slice();

        if (editingId) {
          const index = players.findIndex(p => p.id === editingId);
          if (index !== -1) {
            const existing = players[index];
            const endDateChanged = existing.endDate !== endDate;

            const updatedPlayer = sanitizePlayerRecord({
              ...existing,
              name,
              age,
              phone,
              planType,
              startDate,
              durationMonths,
              endDate,
              paidAmount,
              debtAmount,
              notes,
              courseNotes,
              courseImages,
              playerChatId: linkedChatId || existing.playerChatId || '',
              threeDayRemindersSent: endDateChanged ? [] : existing.threeDayRemindersSent,
              lastReminderDate: endDateChanged ? '' : existing.lastReminderDate,
              photo: compressedPhotoDataUrl || existing.photo || '',
              updatedAt: new Date().toISOString()
            });

            players[index] = updatedPlayer;
            if (!savePlayersToStorage()) {
              players = previousPlayers;
              renderPlayers();
              return;
            }
            if (shouldSendActivation) {
              const fileId = await sendPlayerActivationMessage(updatedPlayer, true);
              if (fileId) updatedPlayer.telegramFileId = fileId;
              updatedPlayer.activationSent = true;
              savePlayersToStorage();
            }
            logActivity(`تعديل بيانات اللاعب: ${updatedPlayer.name} (${updatedPlayer.code})`);
            showToast(shouldSendActivation ? `تم تحديث بيانات البطل "${updatedPlayer.name}" وإرسال إشعار التفعيل ✅` : `تم حفظ تعديلات البطل "${updatedPlayer.name}" بنجاح ✅`, 'success');
          }
        } else {
          const newPlayer = sanitizePlayerRecord({
            id: 'plr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            code: generateNextPlayerCode(),
            name,
            age,
            phone,
            planType,
            startDate,
            durationMonths,
            endDate,
            paidAmount,
            debtAmount,
            notes,
            courseNotes,
            courseImages,
            attendanceCount: 1,
            lastCheckIn: getTodayDateString(),
            photo: compressedPhotoDataUrl || '',
            telegramFileId: '',
            playerChatId: linkedChatId,
            activationSent: false,
            threeDayRemindersSent: [],
            lastReminderDate: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          players.unshift(newPlayer);
          if (!savePlayersToStorage()) {
            players = previousPlayers;
            renderPlayers();
            return;
          }
          if (shouldSendActivation) {
            const fileId = await sendPlayerActivationMessage(newPlayer, false);
            if (fileId) newPlayer.telegramFileId = fileId;
            newPlayer.activationSent = true;
            savePlayersToStorage();
          }
          logActivity(`إضافة لاعب جديد: ${newPlayer.name} (${newPlayer.code})`);
          showToast(shouldSendActivation ? `تم تسجيل البطل "${newPlayer.name}" وإرسال رسالة التفعيل للتليكرام 💪🔥` : `تم تسجيل وحفظ البطل "${newPlayer.name}" بنجاح 💪`, 'success');
        }

        closePlayerModal();
      } catch (err) {
        console.error(err);
        showToast('حدث خطأ غير متوقع أثناء الحفظ', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalBtnText;
      }
    }

    function deletePlayer(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;

      if (confirm(`هل أنت متأكد من حذف اشتراك اللاعب "${player.name}" نهائياً؟`)) {
        players = players.filter(p => p.id !== playerId);
        savePlayersToStorage();
        logActivity(`حذف اللاعب: ${player.name} (${player.code})`);
        showToast(`تم حذف اللاعب "${player.name}"`, 'info');
      }
    }

    function checkInPlayerToday(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;

      const today = getTodayDateString();
      if (player.lastCheckIn === today) {
        showToast(`تم تسجيل حضور الكابتن "${player.name}" اليوم مسبقاً ✅`, 'info');
        return;
      }

      player.lastCheckIn = today;
      player.attendanceCount = (player.attendanceCount || 0) + 1;
      savePlayersToStorage();
      logActivity(`تسجيل حضور يومي للاعب: ${player.name}`);
      showToast(`عاشت ايدك! تم تسجيل حضور البطل "${player.name}" (${player.attendanceCount} تمرين) 💪`, 'success');
    }

    function openRenewModal(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;

      document.getElementById('renewPlayerId').value = player.id;
      document.getElementById('renewPlayerName').textContent = `اللاعب: ${player.name} (${player.phone})`;
      document.getElementById('renewStartDate').value = getTodayDateString();
      const dur = String(player.durationMonths || 1);
      document.getElementById('renewDurationMonths').value = dur;
      document.getElementById('renewPaidAmount').value = gymProfile.defaultPrices?.[dur] || player.paidAmount || 25000;
      document.getElementById('renewDebtAmount').value = 0;
      calculateRenewEndDate();

      document.getElementById('renewModal').classList.remove('hidden');
    }

    function closeRenewModal() {
      document.getElementById('renewModal').classList.add('hidden');
    }

    function calculateRenewEndDate() {
      const start = document.getElementById('renewStartDate').value;
      const months = parseInt(document.getElementById('renewDurationMonths').value, 10) || 1;
      if (!start) return;
      document.getElementById('renewEndDate').value = addMonthsToDate(start, months);
      const defaultPrice = gymProfile.defaultPrices?.[String(months)];
      if (defaultPrice) {
        document.getElementById('renewPaidAmount').value = defaultPrice;
      }
    }

    async function confirmRenewSubscription() {
      const playerId = document.getElementById('renewPlayerId').value;
      const startDate = document.getElementById('renewStartDate').value;
      const durationMonths = parseInt(document.getElementById('renewDurationMonths').value, 10) || 1;
      const endDate = document.getElementById('renewEndDate').value;
      const paidAmount = Math.max(0, Number(document.getElementById('renewPaidAmount').value) || 0);
      const debtAmount = Math.max(0, Number(document.getElementById('renewDebtAmount').value) || 0);

      const idx = players.findIndex(p => p.id === playerId);
      if (idx === -1) return;

      players[idx].startDate = startDate;
      players[idx].durationMonths = durationMonths;
      players[idx].endDate = endDate;
      players[idx].paidAmount = paidAmount;
      // الدين السابق لا يُمسح عند التجديد؛ يُضاف الدين الجديد فوقه
      players[idx].debtAmount = (Number(players[idx].debtAmount) || 0) + debtAmount;
      // تصفير عداد إشعارات الـ 3 أيام للدورة الجديدة
      players[idx].threeDayRemindersSent = [];
      players[idx].lastReminderDate = '';
      players[idx].updatedAt = new Date().toISOString();

      // سجل التجديدات: يحفظ كل تجديد بتاريخه حتى يطلع بالتقرير الشهري
      financeLedger.renewals = Array.isArray(financeLedger.renewals) ? financeLedger.renewals : [];
      financeLedger.renewals.unshift({
        id: `ren_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        playerId,
        playerName: players[idx].name,
        startDate,
        endDate,
        durationMonths,
        paidAmount,
        date: getTodayDateString()
      });
      saveFinanceLedgerToStorage();

      savePlayersToStorage();
      closeRenewModal();
      logActivity(`تجديد اشتراك اللاعب: ${players[idx].name} لغاية ${endDate}`);
      if (window.__skipRenewTelegramOnce) {
        showToast(`تم تجديد وحفظ اشتراك البطل "${players[idx].name}" لغاية ${endDate} ✅`, 'success');
      } else {
        showToast(`تم تجديد اشتراك البطل "${players[idx].name}" لغاية ${endDate} وإرسال التفعيل 🎉`, 'success');
        const fileId = await sendPlayerActivationMessage(players[idx], true);
        if (fileId) players[idx].telegramFileId = fileId;
        players[idx].activationSent = true;
        savePlayersToStorage();
      }
    }

    function openIdCardModal(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;

      document.getElementById('cardAvatar').src = sanitizePhotoSource(player.photo);
      document.getElementById('cardName').textContent = player.name;
      document.getElementById('cardPlan').textContent = player.planType || 'حديد عام (كمال أجسام)';
      document.getElementById('cardSupervisorName').textContent = gymProfile.supervisorName || 'إدارة القاعة';
      document.getElementById('cardReceiptStamp').textContent = gymProfile.receiptStamp || '';
      document.getElementById('cardStart').textContent = player.startDate;
      document.getElementById('cardEnd').textContent = player.endDate;
      document.getElementById('cardCode').textContent = player.code || 'PG-1000';
      document.getElementById('cardPhone').textContent = player.phone;

      const qrData = encodeURIComponent(`PowerGym|${player.code}|${player.name}|${player.endDate}`);
      document.getElementById('cardQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${qrData}`;

      document.getElementById('idCardModal').classList.remove('hidden');
    }

    function closeIdCardModal() {
      document.getElementById('idCardModal').classList.add('hidden');
    }

    function openPlayerCourseModal(playerId) {
      const player = players.find(item => item.id === playerId);
      if (!player) return;
      const images = Array.isArray(player.courseImages)
        ? player.courseImages.map(sanitizeCourseImage).filter(Boolean).slice(0, 5)
        : [];
      document.getElementById('courseRecordTitle').textContent = `ملف كورس اللاعب: ${player.name}`;
      document.getElementById('courseRecordPlayerName').textContent = `${player.name} | ${player.code || ''}`;
      document.getElementById('courseRecordNotes').textContent = player.courseNotes || 'لا توجد ملاحظات محفوظة لهذا الكورس.';
      document.getElementById('courseRecordImages').innerHTML = images.length
        ? images.map((image, index) => `<img src="${image}" alt="صورة كورس ${index + 1} للاعب ${escapeHtml(player.name)}" class="w-full max-h-96 object-contain rounded-xl border border-slate-700 bg-white p-1">`).join('')
        : '<p class="text-xs text-slate-400 sm:col-span-2">لا توجد صور مضافة لهذا الكورس.</p>';
      document.getElementById('courseRecordModal').classList.remove('hidden');
    }

    function closePlayerCourseModal() {
      document.getElementById('courseRecordModal').classList.add('hidden');
    }

    function printMembershipCard() {
      document.body.dataset.printMode = 'card';
      window.print();
    }

    function printPlayerCourse() {
      document.body.dataset.printMode = 'course';
      window.print();
    }

    window.addEventListener('afterprint', () => {
      delete document.body.dataset.printMode;
    });

    function openAuditLogModal() {
      const list = document.getElementById('auditLogList');
      if (auditLogs.length === 0) {
        list.innerHTML = `<p class="text-center text-slate-400 py-8">لا توجد حركات مسجلة بعد.</p>`;
      } else {
        list.innerHTML = auditLogs.map(item => `
          <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex justify-between items-center gap-3">
            <span class="text-slate-200 font-semibold">${escapeHtml(item.action)}</span>
            <span class="text-[10px] text-amber-400 whitespace-nowrap" dir="ltr">${escapeHtml(item.time)}</span>
          </div>
        `).join('');
      }
      document.getElementById('auditLogModal').classList.remove('hidden');
    }

    function closeAuditLogModal() {
      document.getElementById('auditLogModal').classList.add('hidden');
    }

    // =========================================================
    // 10. عرض البطاقات والجدول والفلترة والإحصائيات المهيكلة
    // =========================================================
    function setFilter(filterType) {
      currentFilter = filterType;
      const filters = ['all', 'active', 'soon', 'expired', 'debt'];
      filters.forEach(flt => {
        const btn = document.getElementById(`flt-${flt}`);
        if (!btn) return;
        if (flt === filterType) {
          btn.className = 'filter-btn bg-amber-500 text-black px-3.5 py-2 rounded-xl text-xs font-black whitespace-nowrap transition';
        } else {
          btn.className = 'filter-btn bg-slate-800 text-slate-300 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition hover:bg-slate-700';
        }
      });
      renderPlayers();
    }

    function setViewMode(mode) {
      currentViewMode = mode;
      const cardsBtn = document.getElementById('viewCardsBtn');
      const tableBtn = document.getElementById('viewTableBtn');
      const grid = document.getElementById('playersGrid');
      const tableContainer = document.getElementById('playersTableContainer');

      if (mode === 'table') {
        tableBtn.className = 'px-2.5 py-1 rounded-md bg-amber-500 text-black font-bold transition';
        cardsBtn.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-bold transition';
        grid.classList.add('hidden');
        tableContainer.classList.remove('hidden');
      } else {
        cardsBtn.className = 'px-2.5 py-1 rounded-md bg-amber-500 text-black font-bold transition';
        tableBtn.className = 'px-2.5 py-1 rounded-md text-slate-400 hover:text-white font-bold transition';
        tableContainer.classList.add('hidden');
        grid.classList.remove('hidden');
      }
      renderPlayers();
    }

    function updateDashboardStats() {
      let total = players.length;
      let active = 0;
      let soon = 0;
      let expired = 0;

      players.forEach(p => {
        const { status } = getSubscriptionStatus(p.endDate);
        if (status === 'active') active++;
        else if (status === 'soon') soon++;
        else if (status === 'expired') expired++;
      });

      const fin = calculateFinancialMetrics();

      document.getElementById('statTotal').textContent = total;
      document.getElementById('statActive').textContent = active;
      document.getElementById('statSoon').textContent = soon;
      document.getElementById('statExpired').textContent = expired;
      document.getElementById('sidebarPlayerCount').textContent = total;
      document.getElementById('statRevenue').innerHTML = `${fin.netProfit.toLocaleString('en-US')} <span class="text-[10px]">د.ع</span>`;
      document.getElementById('statDebt').innerHTML = `${fin.totalDebt.toLocaleString('en-US')} <span class="text-[10px]">د.ع</span>`;
    }

    // ---------- عناصر جمالية للبطاقات ----------
    function initialsAvatarHtml(name, sizeClass) {
      const words = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      const initials = escapeHtml(words.map(w => w.charAt(0)).join('') || '؟');
      const hue = [...String(name || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
      return `<div class="pg-avatar ${sizeClass}" style="--hue:${hue}" aria-hidden="true">${initials}</div>`;
    }

    function planIconClass(planType) {
      const t = String(planType || '');
      if (t.includes('VIP')) return 'fa-crown';
      if (t.includes('كارديو') || t.includes('لياقة')) return 'fa-heart-pulse';
      if (t.includes('تدريب')) return 'fa-star';
      return 'fa-dumbbell';
    }

    // نسبة الوقت المنقضي من الاشتراك (للشريط البصري)
    function subscriptionProgressPct(player) {
      if (!isValidDateString(player.startDate) || !isValidDateString(player.endDate)) return 0;
      const toTime = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
      const total = toTime(player.endDate) - toTime(player.startDate);
      if (total <= 0) return 100;
      const used = toTime(getTodayDateString()) - toTime(player.startDate);
      return Math.round(Math.min(100, Math.max(0, (used / total) * 100)));
    }

    function renderPlayers() {
      updateDashboardStats();

      const searchQuery = (document.getElementById('searchInput').value || '').trim().toLowerCase();
      const sortMode = (document.getElementById('sortSelect')?.value) || 'newest';
      const grid = document.getElementById('playersGrid');
      const tableBody = document.getElementById('playersTableBody');

      let filtered = players.filter(player => {
        const { status } = getSubscriptionStatus(player.endDate);
        const matchesFilter =
          currentFilter === 'all' ? true :
          currentFilter === 'debt' ? (Number(player.debtAmount) > 0) :
          status === currentFilter;

        const matchesSearch =
          player.name.toLowerCase().includes(searchQuery) ||
          player.phone.includes(searchQuery) ||
          (player.code && player.code.toLowerCase().includes(searchQuery));

        return matchesFilter && matchesSearch;
      });

      filtered.sort((a, b) => {
        if (sortMode === 'expiry_asc') {
          return a.endDate.localeCompare(b.endDate);
        } else if (sortMode === 'name_asc') {
          return a.name.localeCompare(b.name, 'ar');
        } else if (sortMode === 'debt_desc') {
          return (Number(b.debtAmount) || 0) - (Number(a.debtAmount) || 0);
        }
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

      if (filtered.length === 0) {
        const emptyHtml = `
          <div class="col-span-full card-bg rounded-3xl p-12 text-center border border-dashed border-slate-700">
            <div class="w-16 h-16 rounded-2xl bg-slate-800/80 text-amber-500 flex items-center justify-center text-3xl mx-auto mb-4">
              <i class="fa-solid fa-dumbbell"></i>
            </div>
            <h3 class="text-lg font-black text-white mb-1">لا توجد نتائج مطابقة</h3>
            <p class="text-xs text-slate-400">يمكنك إضافة لاعبين جدد أو تغيير خيارات البحث والفلترة.</p>
          </div>
        `;
        grid.innerHTML = emptyHtml;
        tableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">لا توجد بيانات مطابقة للبحث</td></tr>`;
        return;
      }

      // 1. بناء البطاقات
      grid.innerHTML = filtered.map(player => {
        const safeId = sanitizeId(player.id);
        const sub = getSubscriptionStatus(player.endDate);
        const waLink = player.activationSent ? generateWhatsAppAlertLink(player) : generateWhatsAppLink(player);
        const avatarSrc = sanitizePhotoSource(player.photo);
        const hasTelegramLinked = Boolean(player.playerChatId);
        const hasDebt = Number(player.debtAmount) > 0;
        const checkedInToday = player.lastCheckIn === getTodayDateString();
        const sentRemindersCount = Array.isArray(player.threeDayRemindersSent) ? Math.min(3, player.threeDayRemindersSent.length) : 0;
        const endDayName = getArabicDayName(player.endDate);

        return `
          <div class="card-bg rounded-2xl p-5 border ${sub.borderClass} flex flex-col justify-between transition hover:-translate-y-0.5 hover:shadow-xl">
            <div>
              <!-- رأس البطاقة -->
              <div class="flex items-start justify-between gap-2 mb-3">
                <div class="flex items-center gap-3">
                  <div class="relative">
                    ${avatarSrc === DEFAULT_AVATAR
                      ? initialsAvatarHtml(player.name, 'pg-avatar--card')
                      : `<img src="${avatarSrc}" alt="${escapeHtml(player.name)}" class="w-16 h-16 rounded-full object-cover border-2 border-amber-500 bg-slate-800">`}
                    <span title="${hasTelegramLinked ? 'مربوط بتليكرام اللاعب مباشرة' : 'تم الإرسال لسحابة التليكرام'}" class="w-5 h-5 rounded-full ${hasTelegramLinked ? 'bg-emerald-500' : 'bg-blue-500'} text-white text-[10px] flex items-center justify-center absolute -bottom-0.5 -right-0.5 border border-slate-950">
                      <i class="fa-brands fa-telegram"></i>
                    </span>
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700" dir="ltr">${escapeHtml(player.code || 'PG')}</span>
                      <h3 class="font-black text-base text-white leading-snug">${escapeHtml(player.name)}</h3>
                    </div>
                    <p class="text-[11px] text-amber-400/90 font-bold mt-0.5"><i class="fa-solid ${planIconClass(player.planType)} ml-1"></i>${escapeHtml(player.planType || 'حديد عام')}</p>
                    <div class="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <span><i class="fa-solid fa-cake-candles text-amber-500 ml-1"></i>${Number(player.age)} سنة</span>
                      <span>•</span>
                      <span dir="ltr"><i class="fa-solid fa-phone text-amber-500 mr-1"></i>${escapeHtml(player.phone)}</span>
                    </div>
                  </div>
                </div>

                <span class="px-2.5 py-1 rounded-xl text-[11px] font-black whitespace-nowrap ${sub.badgeClass}">
                  ${escapeHtml(sub.label)}
                </span>
              </div>

              <!-- شريط تقدّم الاشتراك -->
              <div class="pg-progress pg-progress--${sub.status} mb-2.5" title="نسبة الوقت المنقضي من الاشتراك">
                <span style="--p:${subscriptionProgressPct(player)}%"></span>
              </div>

              <!-- تفاصيل التواريخ والـ 3 أيام -->
              <div class="grid grid-cols-3 gap-2 bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 mb-2.5 text-center">
                <div>
                  <span class="block text-[10px] text-slate-400">تاريخ الاشتراك</span>
                  <span class="text-xs font-bold text-slate-200">${escapeHtml(player.startDate)}</span>
                </div>
                <div class="border-x border-slate-800">
                  <span class="block text-[10px] text-slate-400">المدة</span>
                  <span class="text-xs font-bold text-amber-400">${Number(player.durationMonths)} شهر</span>
                </div>
                <div>
                  <span class="block text-[10px] text-slate-400">شوكت يخلص (${escapeHtml(endDayName)})</span>
                  <span class="text-xs font-black ${sub.status === 'expired' ? 'text-red-400' : 'text-emerald-400'}">${escapeHtml(player.endDate)}</span>
                </div>
              </div>

              <!-- شريط حالة التفعيل وإشعارات الـ 3 أيام -->
              <div class="flex items-center justify-between text-[10px] bg-blue-950/25 border border-blue-500/20 px-2.5 py-1.5 rounded-xl mb-2.5">
                <span class="font-bold ${hasTelegramLinked ? 'text-emerald-400' : 'text-blue-300'}">
                  <i class="fa-brands fa-telegram ml-1"></i>${hasTelegramLinked ? 'تليكرام اللاعب مفعّل 🟢' : 'التفعيل جاهز عبر البوت 📲'}
                </span>
                <span class="font-black text-amber-400" title="عدد الإشعارات المرسلة للاعب في الـ 3 أيام قبل انتهاء الاشتراك">
                  🔔 إشعارات الـ 3 أيام: (${sentRemindersCount}/3)
                </span>
              </div>

              <!-- شريط المالية القابل للتعديل السريع والحضور -->
              <div onclick="openFinanceModal('debts')" class="cursor-pointer hover:border-amber-500/50 transition flex items-center justify-between text-[11px] bg-slate-950/60 px-3 py-2 rounded-xl border border-slate-800/80 mb-3" title="اضغط لتعديل المبلغ المدفوع أو الدين">
                <div>
                  <span class="text-slate-400">المدفوع:</span>
                  <span class="font-bold text-emerald-400">${Number(player.paidAmount || 0).toLocaleString('en-US')} د.ع ✏️</span>
                </div>
                ${hasDebt ? `
                  <div class="bg-rose-500/15 text-rose-400 px-2 py-0.5 rounded-lg font-black border border-rose-500/30">
                    متبقي: ${Number(player.debtAmount).toLocaleString('en-US')} د.ع ✏️
                  </div>
                ` : `
                  <div class="text-slate-400">
                    <i class="fa-solid fa-fire text-amber-500 ml-1"></i>حضور: <b class="text-white">${Number(player.attendanceCount || 0)}</b>
                  </div>
                `}
              </div>

              ${player.notes ? `
                <p class="text-[11px] text-slate-300 bg-slate-900/60 border-r-2 border-amber-500 pr-2 py-1 rounded mb-3">
                  <i class="fa-solid fa-note-sticky text-amber-400 ml-1"></i>${escapeHtml(player.notes)}
                </p>
              ` : ''}
            </div>

            <!-- أزرار التحكم بالبطاقة -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center gap-1.5 flex-wrap">
              <button onclick="${player.activationSent ? 'sendSubscriptionAlertById' : 'sendPlayerActivationMessageById'}('${safeId}')" class="flex-1 ${player.activationSent ? 'bg-sky-600 hover:bg-sky-500' : 'bg-blue-600 hover:bg-blue-500'} text-white py-2 px-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition shadow" title="${player.activationSent ? 'إرسال تنبيه حالة الاشتراك للاعب على التليكرام' : 'إرسال رسالة تفعيل الاشتراك للاعب على التليكرام'}">
                <i class="fa-brands fa-telegram text-sm"></i>
                <span>${player.activationSent ? 'إرسال تنبيه اشتراك' : 'رسالة تفعيل'}</span>
              </button>

              <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition shadow" title="إرسال التفعيل عبر واتساب">
                <i class="fa-brands fa-whatsapp text-sm"></i>
                <span>واتساب</span>
              </a>

              <button onclick="openRenewModal('${safeId}')" class="bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition" title="تجديد الاشتراك">
                <i class="fa-solid fa-arrows-rotate"></i>
                <span>تجديد</span>
              </button>

              <button onclick="checkInPlayerToday('${safeId}')" class="${checkedInToday ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-slate-800 text-slate-300 border-slate-700'} hover:bg-emerald-500/30 border p-2 rounded-xl text-xs transition" title="تسجيل حضور اليوم">
                <i class="fa-solid fa-calendar-check"></i>
              </button>

              <button onclick="openIdCardModal('${safeId}')" class="bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border border-purple-500/30 p-2 rounded-xl text-xs transition" title="بطاقة العضوية والطباعة">
                <i class="fa-solid fa-id-card"></i>
              </button>

              <button onclick="openPlayerCourseModal('${safeId}')" class="bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 p-2 rounded-xl text-xs transition" title="ملف الكورس والصور">
                <i class="fa-solid fa-notes-medical"></i>
              </button>

              <button onclick="sendThreeDayReminderToPlayerById('${safeId}')" class="bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 p-2 rounded-xl text-xs transition" title="إرسال إشعار التذكير بالانتهاء للاعب على التليكرام">
                <i class="fa-solid fa-bell"></i>
              </button>

              <button onclick="openEditModal('${safeId}')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 p-2 rounded-xl text-xs transition" title="تعديل">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>

              <button onclick="deletePlayer('${safeId}')" class="bg-red-500/10 hover:bg-red-500/25 text-red-400 p-2 rounded-xl text-xs transition" title="حذف">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      // 2. بناء الجدول التفصيلي
      tableBody.innerHTML = filtered.map(player => {
        const safeId = sanitizeId(player.id);
        const sub = getSubscriptionStatus(player.endDate);
        const waLink = player.activationSent ? generateWhatsAppAlertLink(player) : generateWhatsAppLink(player);
        const avatarSrc = sanitizePhotoSource(player.photo);

        return `
          <tr class="hover:bg-slate-900/60 transition">
            <td class="p-3">
              <div class="flex items-center gap-2.5">
                <img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover border border-amber-500">
                <div>
                  <div class="font-black text-white">${escapeHtml(player.name)}</div>
                  <div class="text-[11px] text-slate-400">${Number(player.age)} سنة</div>
                </div>
              </div>
            </td>
            <td class="p-3">
              <span class="text-[11px] font-bold text-amber-400 block" dir="ltr">${escapeHtml(player.code || 'PG')}</span>
              <span class="text-[11px] text-slate-400">${escapeHtml(player.planType || 'حديد عام')}</span>
            </td>
            <td class="p-3 font-bold text-slate-200" dir="ltr">${escapeHtml(player.phone)}</td>
            <td class="p-3">
              <div class="text-slate-300">من: ${escapeHtml(player.startDate)} (${Number(player.durationMonths)} شهر)</div>
              <div class="font-bold text-amber-400">شوكت يخلص: ${escapeHtml(player.endDate)}</div>
            </td>
            <td class="p-3">
              <div class="text-emerald-400 font-bold">${Number(player.paidAmount || 0).toLocaleString('en-US')} د.ع</div>
              ${Number(player.debtAmount) > 0 ? `<div class="text-rose-400 text-[11px] font-black">دين: ${Number(player.debtAmount).toLocaleString('en-US')}</div>` : ''}
            </td>
            <td class="p-3">
              <span class="px-2.5 py-1 rounded-lg text-[11px] font-black ${sub.badgeClass}">${escapeHtml(sub.label)}</span>
            </td>
            <td class="p-3">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="${player.activationSent ? 'sendSubscriptionAlertById' : 'sendPlayerActivationMessageById'}('${safeId}')" class="${player.activationSent ? 'bg-sky-600' : 'bg-blue-600'} text-white p-2 rounded-lg" title="${player.activationSent ? 'إرسال تنبيه اشتراك' : 'إرسال رسالة تفعيل للتلي'}"><i class="fa-brands fa-telegram"></i></button>
                <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="bg-emerald-600 text-white p-2 rounded-lg"><i class="fa-brands fa-whatsapp"></i></a>
                <button onclick="openRenewModal('${safeId}')" class="bg-amber-500/20 text-amber-400 p-2 rounded-lg"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button onclick="openIdCardModal('${safeId}')" class="bg-purple-500/20 text-purple-400 p-2 rounded-lg"><i class="fa-solid fa-id-card"></i></button>
                <button onclick="openPlayerCourseModal('${safeId}')" class="bg-blue-500/20 text-blue-300 p-2 rounded-lg" title="ملف الكورس"><i class="fa-solid fa-notes-medical"></i></button>
                <button onclick="openEditModal('${safeId}')" class="bg-slate-800 text-slate-300 p-2 rounded-lg"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deletePlayer('${safeId}')" class="bg-red-500/20 text-red-400 p-2 rounded-lg"><i class="fa-solid fa-trash-can"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // =========================================================
    // 11. محرك التليكرام الذكي ثنائي الاتجاه:
    //     - ربط رقم اللاعب تلقائياً عند مراسلته للبوت
    //     - إرسال رسالة التفعيل للاعب فور إدخال رقمه
    //     - إرسال 3 إشعارات يومية قبل 3 أيام من انتهاء الاشتراك (كل يوم إشعار)
    // =========================================================
    let isPollingBotUpdates = false;
    async function pollBotUpdatesForPlayers(silent = true) {
      if (isPollingBotUpdates) return;
      const { botToken } = getTelegramSettings();
      if (!botToken) return;

      isPollingBotUpdates = true;
      try {
        const offsetParam = telegramDirectory.lastUpdateOffset ? `?offset=${telegramDirectory.lastUpdateOffset}` : '';
        let res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates${offsetParam}`);
        let data = await res.json();

        if (!data.ok && data.error_code === 409) {
          await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
          res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates${offsetParam}`);
          data = await res.json();
        }

        if (data.ok && Array.isArray(data.result) && data.result.length > 0) {
          let newlyLinkedCount = 0;

          for (const upd of data.result) {
            telegramDirectory.lastUpdateOffset = Math.max(telegramDirectory.lastUpdateOffset || 0, upd.update_id + 1);
            const msg = upd.message;
            if (!msg || !msg.chat || !msg.chat.id) continue;

            const senderChatId = String(msg.chat.id);
            const text = String(msg.text || '').trim();
            const contactPhone = msg.contact?.phone_number || '';

            let detectedPhone = '';
            if (contactPhone) {
              detectedPhone = formatIraqiPhone(contactPhone);
            } else if (text.startsWith('/start')) {
              const payload = text.replace('/start', '').trim();
              if (payload.startsWith('ACT_')) {
                detectedPhone = formatIraqiPhone(payload.replace('ACT_', ''));
              } else if (/07\d{9}|9647\d{9}/.test(payload)) {
                detectedPhone = formatIraqiPhone(payload);
              } else {
                // إرسال زر مشاركة رقم الهاتف للاعب بضغطة واحدة لتفعيل اشتراكه تلقائياً
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: senderChatId,
                    text: `🏋️‍♂️ <b>أهلاً بك يا بطل في بوت ${escapeTelegramHtml(gymProfile.gymName)}!</b>\n📍 ${escapeTelegramHtml(gymProfile.gymBranch)}\n\n📲 اضغط على الزر بالأسفل <b>(مشاركة رقم هاتفي لتفعيل الاشتراك)</b> أو أرسل رقم موبايلك برسالة لتفعيل اشتراكك واستلام إشعارات التذكير قبل انتهاء الاشتراك بـ 3 أيام:`,
                    parse_mode: 'HTML',
                    reply_markup: {
                      keyboard: [
                        [{ text: '📱 مشاركة رقم هاتفي لتفعيل الاشتراك', request_contact: true }]
                      ],
                      resize_keyboard: true,
                      one_time_keyboard: true
                    }
                  })
                });
              }
            } else if (/07\d{8,9}|9647\d{8,9}/.test(text.replace(/\s+/g, ''))) {
              detectedPhone = formatIraqiPhone(text);
            }

            if (detectedPhone && detectedPhone.length >= 10) {
              telegramDirectory.phoneToChatId[detectedPhone] = {
                chatId: senderChatId,
                firstName: msg.from?.first_name || '',
                username: msg.from?.username || '',
                linkedAt: new Date().toISOString()
              };

              // مطابقة الرقم مع قائمة اللاعبين المسجلين وإرسال رسالة التفعيل فوراً
              const matchedPlayer = players.find(p => formatIraqiPhone(p.phone) === detectedPhone);
              if (matchedPlayer) {
                matchedPlayer.playerChatId = senderChatId;
                matchedPlayer.activationSent = true;
                newlyLinkedCount++;
                await sendDirectTelegramMessageToPlayer(matchedPlayer, buildPlayerActivationText(matchedPlayer));
                showToast(`تم ربط تليكرام البطل "${matchedPlayer.name}" وإرسال رسالة التفعيل له تلقائياً! 🎉`, 'success');
              } else {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: senderChatId,
                    text: `✅ <b>تم ربط رقم هاتفك (${escapeTelegramHtml(detectedPhone)}) بنجاح في منظومة ${escapeTelegramHtml(gymProfile.gymName)}!</b>\nستصلك رسالة تفعيل الاشتراك وتفاصيل موعد الانتهاء فوراً عند حفظ الكابتن لبياناتك 💪🔥`,
                    parse_mode: 'HTML',
                    reply_markup: { remove_keyboard: true }
                  })
                });
              }

              // تحديث الحقل إذا كانت نافذة إضافة اللاعب مفتوحة حالياً بنفس الرقم
              const currentInputPhone = document.getElementById('playerPhone')?.value;
              if (currentInputPhone && formatIraqiPhone(currentInputPhone) === detectedPhone) {
                handlePhoneInputLookup(currentInputPhone);
              }
            }
          }

          saveTelegramDirectoryToStorage();
          if (newlyLinkedCount > 0) {
            savePlayersToStorage();
          }
        }

        if (!silent) {
          const currentInputPhone = document.getElementById('playerPhone')?.value || '';
          handlePhoneInputLookup(currentInputPhone);
          showToast('تم فحص وتحديث ربط أرقام اللاعبين مع بوت التليكرام ✅', 'info');
        }
      } catch (e) {
        console.warn('Bot poll error:', e);
      } finally {
        isPollingBotUpdates = false;
      }
    }

    function buildPlayerActivationText(player) {
      const reminders = getThreeReminderDates(player.endDate);
      const endDayName = getArabicDayName(player.endDate);
      return [
        `✅ <b>تم تفعيل اشتراكك بنجاح في ${escapeTelegramHtml(gymProfile.gymName)}! 🏋️‍♂️🔥</b>`,
        `📍 <b>العنوان:</b> ${escapeTelegramHtml(gymProfile.gymBranch)}`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `أهلاً بك يا بطل في قاعتك! تفاصيل اشتراكك المفعّل:`,
        `👤 <b>اسم البطل:</b> ${escapeTelegramHtml(player.name)}`,
        `🆔 <b>كود العضوية:</b> <code>${escapeTelegramHtml(player.code)}</code>`,
        `📱 <b>رقم الموبايل:</b> <code>${escapeTelegramHtml(player.phone)}</code>`,
        `🏆 <b>القسم / الاشتراك:</b> ${escapeTelegramHtml(player.planType)}`,
        `📅 <b>تاريخ بدء الاشتراك:</b> ${escapeTelegramHtml(player.startDate)}`,
        `⏳ <b>مدة الاشتراك:</b> ${Number(player.durationMonths)} شهر`,
        `🏁 <b>شوكت يخلص (تاريخ الانتهاء):</b> <b>${escapeTelegramHtml(endDayName)} ${escapeTelegramHtml(player.endDate)}</b>`,
        `💵 <b>المبلغ المدفوع:</b> ${Number(player.paidAmount || 0).toLocaleString('en-US')} د.ع`,
        Number(player.debtAmount) > 0
          ? `⚠️ <b>المبلغ المتبقي:</b> ${Number(player.debtAmount).toLocaleString('en-US')} د.ع`
          : `✅ <b>الحساب المالي:</b> مدفوع بالكامل`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🔔 <b>نظام التذكير الذكي (3 مرات قبل 3 أيام من الانتهاء):</b>`,
        `سيقوم البوت بإرسال 3 إشعارات تذكيرية يومية لك قبل انتهاء اشتراكك:`,
        `• الإشعار 1/3 (قبل 3 أيام): <code>${escapeTelegramHtml(reminders.day3)}</code>`,
        `• الإشعار 2/3 (قبل يومين): <code>${escapeTelegramHtml(reminders.day2)}</code>`,
        `• الإشعار 3/3 (قبل يوم واحد): <code>${escapeTelegramHtml(reminders.day1)}</code>`,
        `نتمنى لك تمريناً قوياً وأوقاتاً ممتعة يا بطل! 💪⚡`
      ].join('\n');
    }

    async function sendDirectTelegramMessageToPlayer(player, htmlText) {
      const { botToken } = getTelegramSettings();
      const targetChatId = player.playerChatId || telegramDirectory?.phoneToChatId?.[formatIraqiPhone(player.phone)]?.chatId || '';
      if (!botToken || !targetChatId) return false;

      try {
        if (player.photo && player.photo.startsWith('data:image')) {
          const fd = new FormData();
          fd.append('chat_id', targetChatId);
          fd.append('photo', dataURLtoBlob(player.photo), 'activation.jpg');
          fd.append('caption', htmlText);
          fd.append('parse_mode', 'HTML');
          const r = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: fd });
          const d = await r.json();
          if (d.ok) return true;
        }

        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: htmlText,
            parse_mode: 'HTML',
            reply_markup: { remove_keyboard: true }
          })
        });
        const d = await r.json();
        return Boolean(d.ok);
      } catch (e) {
        console.warn('Direct player message error:', e);
        return false;
      }
    }

    function notifyPlayerAboutDebt(player, action, description, amount) {
      const intlPhone = formatIraqiPhone(player.phone);
      const linkedChatId = player.playerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '';
      const { botToken } = getTelegramSettings();
      const message = [
        `مرحباً كابتن <b>${escapeTelegramHtml(player.name)}</b>،`,
        `تم ${action === 'payment' ? 'استلام دفعة من الدين' : 'إضافة مشتريات على الحساب'} في <b>${escapeTelegramHtml(gymProfile.gymName)}</b>.`,
        `📦 التفاصيل: ${escapeTelegramHtml(description)}`,
        `💵 المبلغ: ${Number(amount).toLocaleString('en-US')} د.ع`,
        `⚠️ الرصيد المتبقي: ${Number(player.debtAmount || 0).toLocaleString('en-US')} د.ع`,
        `🆔 رقم العضوية: <code>${escapeTelegramHtml(player.code)}</code>`
      ].join('\n');

      if (linkedChatId && botToken) {
        player.playerChatId = String(linkedChatId);
        sendDirectTelegramMessageToPlayer(player, message).then(sent => {
          if (sent) {
            showToast(`تم إرسال إشعار الحساب إلى Telegram للاعب ${player.name}.`, 'success');
          } else {
            showToast(`تعذر إرسال Telegram إلى ${player.name}. لم يتم تأكيد الإرسال؛ استخدم WhatsApp يدوياً.`, 'warning');
          }
        });
        return;
      }

      if (/^9647\d{9}$/.test(intlPhone)) {
        const whatsappText = `السلام عليكم ${player.name}، تم ${action === 'payment' ? 'تسجيل تسديد' : 'تسجيل دين'} في ${gymProfile.gymName}.\nالتفاصيل: ${description}\nالمبلغ: ${Number(amount).toLocaleString('en-US')} د.ع\nالرصيد المتبقي: ${Number(player.debtAmount || 0).toLocaleString('en-US')} د.ع\nرقم العضوية: ${player.code}`;
        const whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(whatsappText)}`;
        const whatsappWindow = window.open(whatsappUrl, '_blank');
        if (whatsappWindow) whatsappWindow.opener = null;
        showToast(whatsappWindow
          ? `لا يوجد Telegram مربوط للاعب ${player.name}؛ فُتح WhatsApp برسالة جاهزة. تحقق من إمكانية التواصل عبر الرقم.`
          : `لا يوجد Telegram مربوط للاعب ${player.name}؛ تعذر فتح WhatsApp تلقائياً، ورقم الهاتف متوفر للإرسال اليدوي.`, 'warning');
        return;
      }

      showToast(`لم يصل إشعار إلى ${player.name}: لا يوجد Telegram مربوط ولا رقم صالح لـ WhatsApp.`, 'warning');
    }

    // إرسال رسالة تفعيل الاشتراك للاعب + نسخة للكابتن عند إدخال الرقم وحفظ اللاعب
    async function sendPlayerActivationMessage(player, isUpdate = false) {
      let { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        chatId = await autoDetectChatId(true);
      }
      if (!botToken || !chatId) return '';

      const intlPhone = formatIraqiPhone(player.phone);
      const matchedChatId = player.playerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '';
      if (matchedChatId) {
        player.playerChatId = matchedChatId;
      }

      const activationText = buildPlayerActivationText(player);
      let sentDirectlyToPlayer = false;

      // 1. إذا كان اللاعب مربوطاً بالبوت، يرسل البوت رسالة التفعيل لحساب اللاعب مباشرة
      if (player.playerChatId && String(player.playerChatId) !== String(chatId)) {
        sentDirectlyToPlayer = await sendDirectTelegramMessageToPlayer(player, activationText);
      }

      // 2. إرسال بطاقة التفعيل والتوثيق إلى تليكرام الكابتن مع أزرار التفعيل السريع للاعب
      const botDeepLink = `https://t.me/${BOT_USERNAME}?start=ACT_${intlPhone}`;
      const waActivationLink = generateWhatsAppLink(player);

      const captainCaption = [
        isUpdate ? `🔄 <b>رسالة تفعيل وتحديث اشتراك لاعب - ${escapeTelegramHtml(gymProfile.gymName)}</b>` : `🎉 <b>رسالة تفعيل اشتراك لاعب جديد - ${escapeTelegramHtml(gymProfile.gymName)}</b>`,
        sentDirectlyToPlayer
          ? `🟢 <b>تم إرسال رسالة التفعيل مباشرة إلى تليكرام اللاعب (${escapeTelegramHtml(player.playerChatId)}) ✅</b>`
          : `📲 <b>حالة تليكرام اللاعب:</b> بانتظار ضغط اللاعب على رابط التفعيل بالأسفل لربط رقمه تلقائياً`,
        `━━━━━━━━━━━━━━━━━━━━`,
        activationText
      ].join('\n');

      const replyMarkup = JSON.stringify({
        inline_keyboard: [
          [{ text: `📲 إرسال رسالة التفعيل ورابط البوت لـ ${player.name} (واتساب)`, url: waActivationLink }],
          [{ text: `🔗 رابط التفعيل المباشر للاعب (@${BOT_USERNAME})`, url: botDeepLink }]
        ]
      });

      try {
        if (player.photo && player.photo.startsWith('data:image')) {
          const formData = new FormData();
          formData.append('chat_id', chatId);
          formData.append('photo', dataURLtoBlob(player.photo), 'player.jpg');
          formData.append('caption', captainCaption);
          formData.append('parse_mode', 'HTML');
          formData.append('reply_markup', replyMarkup);

          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          const data = await response.json();

          if (data.ok && data.result && data.result.photo) {
            const photos = data.result.photo;
            return photos[photos.length - 1].file_id;
          }
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: captainCaption,
              parse_mode: 'HTML',
              reply_markup: JSON.parse(replyMarkup)
            })
          });
        }
      } catch (err) {
        console.error('Telegram activation error:', err);
      }
      return '';
    }

    async function sendPlayerActivationMessageById(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      showToast(`جاري إرسال رسالة تفعيل الاشتراك للبطل "${player.name}" على التليكرام... 📲`, 'info');
      await pollBotUpdatesForPlayers(true);
      await sendPlayerActivationMessage(player, false);
      player.activationSent = true;
      savePlayersToStorage();
      logActivity(`إرسال رسالة تفعيل التليكرام للاعب: ${player.name}`);
      showToast(`تم إرسال رسالة التفعيل للبطل "${player.name}" عبر بوت التليكرام بنجاح! ✅`, 'success');
    }

    // نص تنبيه حالة الاشتراك (يُرسل للاعب المفعَّل مسبقاً) - تليكرام HTML
    function buildSubscriptionAlertText(player) {
      const sub = getSubscriptionStatus(player.endDate);
      const debt = Number(player.debtAmount) || 0;
      const endLabel = `${getArabicDayName(player.endDate)} ${player.endDate}`;
      const statusLine =
        sub.diffDays === 0 ? `⚠️ <b>اشتراكك ينتهي اليوم!</b>` :
        sub.diffDays === 1 ? `⚠️ <b>باقي يوم واحد</b> على انتهاء اشتراكك (يُعدّ منتهياً)` :
        sub.status === 'expired' ? `⛔ <b>انتهى اشتراكك</b> منذ ${Math.abs(sub.diffDays)} يوم` :
        sub.status === 'soon' ? `⏳ <b>باقي ${sub.diffDays} يوم</b> على انتهاء اشتراكك` :
        `✅ <b>اشتراكك فعّال</b> (باقي ${sub.diffDays} يوم)`;
      return [
        `🔔 <b>تنبيه اشتراك - ${escapeTelegramHtml(gymProfile.gymName)}</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `مرحباً كابتن <b>${escapeTelegramHtml(player.name)}</b> 💪`,
        statusLine,
        `📅 تاريخ البدء: ${escapeTelegramHtml(player.startDate)}`,
        `🏁 تاريخ الانتهاء: <b>${escapeTelegramHtml(endLabel)}</b>`,
        debt > 0 ? `💰 المتبقي عليك: <b>${debt.toLocaleString('en-US')}</b> د.ع` : '',
        `━━━━━━━━━━━━━━━━━━━━`,
        sub.status === 'active' ? `نتمنى لك تمريناً موفقاً يا بطل! 🏋️‍♂️` : `ننتظرك في القاعة لتجديد الاشتراك والاستمرار بدون انقطاع! 🔥`
      ].filter(Boolean).join('\n');
    }

    // رابط واتساب بنص تنبيه الاشتراك (بدون رابط التفعيل)
    function generateWhatsAppAlertLink(player) {
      const intlPhone = formatIraqiPhone(player.phone);
      const sub = getSubscriptionStatus(player.endDate);
      const debt = Number(player.debtAmount) || 0;
      const statusLine =
        sub.diffDays === 0 ? `⚠️ اشتراكك ينتهي اليوم!` :
        sub.diffDays === 1 ? `⚠️ باقي يوم واحد على انتهاء اشتراكك (يُعدّ منتهياً)` :
        sub.status === 'expired' ? `⛔ انتهى اشتراكك منذ ${Math.abs(sub.diffDays)} يوم` :
        sub.status === 'soon' ? `⏳ باقي ${sub.diffDays} يوم على انتهاء اشتراكك` :
        `✅ اشتراكك فعّال (باقي ${sub.diffDays} يوم)`;
      const message = [
        `السلام عليكم كابتن ${player.name} الحبيب 💪`,
        `🔔 تنبيه اشتراك من *${gymProfile.gymName}*`,
        statusLine,
        `🏁 تاريخ الانتهاء: ${player.endDate}`,
        debt > 0 ? `💰 المتبقي عليك: ${debt.toLocaleString('en-US')} د.ع` : '',
        sub.status === 'active' ? 'نتمنى لك تمريناً موفقاً 🏋️‍♂️' : 'ننتظرك لتجديد الاشتراك يا بطل 🔥'
      ].filter(Boolean).join('\n');
      return `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
    }

    async function sendSubscriptionAlertById(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      showToast(`جاري إرسال تنبيه الاشتراك إلى "${player.name}"... 🔔`, 'info');
      await pollBotUpdatesForPlayers(true);
      const sent = await sendDirectTelegramMessageToPlayer(player, buildSubscriptionAlertText(player));
      if (sent) {
        logActivity(`إرسال تنبيه اشتراك عبر التليكرام للاعب: ${player.name}`);
        showToast(`تم إرسال تنبيه الاشتراك للبطل "${player.name}" عبر بوت التليكرام ✅`, 'success');
        return;
      }
      if (confirm(`تعذر الإرسال عبر التليكرام (اللاعب غير مربوط بالبوت أو لا يوجد اتصال).\nهل تريد إرسال التنبيه لـ "${player.name}" عبر واتساب؟`)) {
        logActivity(`إرسال تنبيه اشتراك عبر واتساب للاعب: ${player.name}`);
        window.open(generateWhatsAppAlertLink(player), '_blank', 'noopener');
      }
    }

    // =========================================================
    // 12. نظام الإشعارات اليومية الـ 3 قبل 3 أيام من انتهاء الاشتراك
    //     (يدز الرسالة 3 مرات قبل 3 أيام من انتهاء الاشتراك - كل يوم إشعار)
    // =========================================================
    function buildThreeDayReminderText(player, diffDays, reminderOrderNum) {
      const endDayName = getArabicDayName(player.endDate);
      const dayLabel =
        diffDays === 3 ? 'باقي 3 أيام على انتهاء اشتراكك' :
        diffDays === 2 ? 'باقي يومان (2 يوم) على انتهاء اشتراكك' :
        diffDays === 1 ? 'غداً ينتهي اشتراكك (باقي يوم واحد فقط!)' :
        diffDays === 0 ? 'اليوم ينتهي اشتراكك في القاعة!' :
        `انتهى اشتراكك منذ ${Math.abs(diffDays)} يوم`;

      return [
        `🔔 <b>إشعار تذكير يومي (${reminderOrderNum} من 3) — قرب انتهاء الاشتراك ⏳</b>`,
        `🏋️‍♂️ <b>${escapeTelegramHtml(gymProfile.gymName)}</b> (${escapeTelegramHtml(gymProfile.gymBranch)})`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `مرحباً كابتن <b>${escapeTelegramHtml(player.name)}</b> الحبيب 💪🔥`,
        `نود تذكيرك بأن اشتراكك في القاعة قارب على الانتهاء:`,
        `📢 <b>التنبيه:</b> <b>${escapeTelegramHtml(dayLabel)}</b>`,
        `📅 <b>تاريخ بدء الاشتراك:</b> ${escapeTelegramHtml(player.startDate)}`,
        `⏳ <b>مدة الاشتراك:</b> ${Number(player.durationMonths)} شهر`,
        `🏁 <b>شوكت يخلص (تاريخ الانتهاء):</b> <b>${escapeTelegramHtml(endDayName)} ${escapeTelegramHtml(player.endDate)}</b>`,
        `📌 <b>رقم الإشعار اليومي:</b> الإشعار <b>(${reminderOrderNum} من 3)</b> قبل انتهاء الاشتراك`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `ننتظرك في الجيم لتجديد الاشتراك والاستمرار بالتمرين بدون انقطاع يا بطل! 🏋️‍♂️⚡`
      ].join('\n');
    }

    async function sendThreeDayReminderToPlayer(player, diffDays, silent = false) {
      let { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        chatId = await autoDetectChatId(true);
      }
      if (!botToken || !chatId) return false;

      const reminderOrderNum =
        diffDays >= 3 ? 1 :
        diffDays === 2 ? 2 :
        3;

      const reminderHtml = buildThreeDayReminderText(player, diffDays, reminderOrderNum);
      const intlPhone = formatIraqiPhone(player.phone);
      const matchedChatId = player.playerChatId || telegramDirectory?.phoneToChatId?.[intlPhone]?.chatId || '';
      if (matchedChatId) player.playerChatId = matchedChatId;

      let sentToPlayerDirect = false;
      if (player.playerChatId && String(player.playerChatId) !== String(chatId)) {
        sentToPlayerDirect = await sendDirectTelegramMessageToPlayer(player, reminderHtml);
      }

      const waReminderText = `السلام عليكم كابتن ${player.name} الحبيب 💪🔥،\nإشعار تذكير (${reminderOrderNum} من 3) من *${gymProfile.gymName}*: تبقى (${diffDays} يوم) على انتهاء اشتراكك الذي يخلص بتاريخ ${player.endDate}. ننتظرك بالجم لتجديد الاشتراك يا بطل! 🏋️‍♂️`;
      const waLink = `https://wa.me/${intlPhone}?text=${encodeURIComponent(waReminderText)}`;

      const captainReportHtml = [
        sentToPlayerDirect
          ? `✅ <b>تم إرسال إشعار الـ 3 أيام (${reminderOrderNum}/3) مباشرة لتليكرام اللاعب</b>`
          : `🔔 <b>إشعار تذكير الـ 3 أيام (${reminderOrderNum}/3) للاعب: ${escapeTelegramHtml(player.name)}</b>`,
        `━━━━━━━━━━━━━━━━━━━━`,
        reminderHtml
      ].join('\n');

      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: captainReportHtml,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💬 إرسال تذكير (${reminderOrderNum}/3) واتساب لـ ${player.name}`, url: waLink }]
              ]
            }
          })
        });
        const data = await res.json();
        if (data.ok) {
          if (!silent) {
            showToast(`تم إرسال إشعار التذكير (${reminderOrderNum}/3) للبطل "${player.name}" على التليكرام 🔔`, 'success');
          }
          return true;
        }
      } catch (e) {
        console.error('3-day reminder error:', e);
      }
      return false;
    }

    async function sendThreeDayReminderToPlayerById(playerId) {
      const player = players.find(p => p.id === playerId);
      if (!player) return;
      const sub = getSubscriptionStatus(player.endDate);
      const ok = await sendThreeDayReminderToPlayer(player, sub.diffDays, false);
      if (ok) {
        const dayKey = `manual_${getTodayDateString()}`;
        if (!Array.isArray(player.threeDayRemindersSent)) player.threeDayRemindersSent = [];
        if (player.threeDayRemindersSent.length < 3 && !player.threeDayRemindersSent.includes(dayKey)) {
          player.threeDayRemindersSent.push(dayKey);
        }
        player.lastReminderDate = getTodayDateString();
        savePlayersToStorage();
      }
    }

    // الفحص التلقائي واليدوي لإرسال 3 إشعارات في الـ 3 أيام التي تسبق انتهاء الاشتراك (كل يوم إشعار)
    async function runThreeDayCountdownReminders(silent = true) {
      const { botToken, chatId } = getTelegramSettings();
      if (!botToken || !chatId) {
        if (!silent) {
          showToast('يرجى التأكد من إعدادات بوت التليكرام أولاً ⚙️', 'warning');
          openSettingsModal();
        }
        return;
      }

      const today = getTodayDateString();
      // اللاعبون الذين يتبقى على انتهاء اشتراكهم 3 أيام أو يومان (من يتبقى له يوم واحد أو أقل يصنف منتهي ويصله إشعار الانتهاء)
      const candidates = players.filter(p => {
        const { diffDays } = getSubscriptionStatus(p.endDate);
        return diffDays === 2 || diffDays === 3;
      });

      if (candidates.length === 0) {
        if (!silent) {
          showToast('لا يوجد لاعبون ينتهي اشتراكهم خلال الـ 3 أيام القادمة حالياً 🔔', 'info');
        }
        return;
      }

      const btn = document.getElementById('btnThreeDayAlerts');
      const origHtml = btn ? btn.innerHTML : '';
      if (!silent && btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري إرسال إشعارات الـ 3 أيام...</span>`;
      }

      let sentCount = 0;
      for (const player of candidates) {
        const { diffDays } = getSubscriptionStatus(player.endDate);
        const daySlotKey = `${player.endDate}_day_${diffDays}`;
        if (!Array.isArray(player.threeDayRemindersSent)) {
          player.threeDayRemindersSent = [];
        }

        const alreadySentToday = player.lastReminderDate === today || player.threeDayRemindersSent.includes(daySlotKey);

        // في الوضع التلقائي نرسل مرة واحدة فقط كل يوم من الأيام الـ 3؛ وفي الوضع اليدوي نرسل للجميع إذا رغب الكابتن
        if (silent && alreadySentToday) continue;

        const ok = await sendThreeDayReminderToPlayer(player, diffDays, true);
        if (ok) {
          sentCount++;
          if (!player.threeDayRemindersSent.includes(daySlotKey)) {
            player.threeDayRemindersSent.push(daySlotKey);
          }
          player.lastReminderDate = today;
          await new Promise(r => setTimeout(r, 350));
        }
      }

      if (!silent && btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      if (sentCount > 0) {
        savePlayersToStorage();
        logActivity(`إرسال إشعارات التذكير اليومية (الـ 3 أيام قبل الانتهاء) لـ ${sentCount} لاعب`);
        showToast(`تم إرسال إشعارات التذكير اليومية (الـ 3 أيام) لـ ${sentCount} لاعب على التليكرام بنجاح 🔔✅`, 'success');
      } else if (!silent) {
        showToast('تم إرسال إشعار اليوم لجميع اللاعبين المستحقين مسبقاً ✅', 'info');
      }
    }

    async function sendSinglePlayerAlertToTelegram(playerId, silent = false) {
      const player = players.find(p => p.id === playerId);
      if (!player) return false;

      let { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        chatId = await autoDetectChatId(true);
      }
      if (!botToken || !chatId) {
        if (!silent) {
          showToast('أرسل /start لبوت التليكرام أولاً أو أدخل الـ Chat ID في الإعدادات ⚙️', 'warning');
          openSettingsModal();
        }
        return false;
      }

      const sub = getSubscriptionStatus(player.endDate);
      const waLink = player.activationSent ? generateWhatsAppAlertLink(player) : generateWhatsAppLink(player);

      // إذا كان اللاعب مربوطاً نرسل له أيضاً تنبيهاً مباشراً
      if (player.playerChatId && String(player.playerChatId) !== String(chatId)) {
        await sendDirectTelegramMessageToPlayer(player, buildThreeDayReminderText(player, sub.diffDays, 3));
      }

      const caption = [
        `🚨 <b>تنبيه اشتراك لاعب - ${escapeTelegramHtml(gymProfile.gymName)}</b>`,
        `📍 <b>${escapeTelegramHtml(gymProfile.gymBranch)}</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🆔 <b>الكود:</b> <code>${escapeTelegramHtml(player.code)}</code>`,
        `👤 <b>اللاعب:</b> ${escapeTelegramHtml(player.name)}`,
        `🎂 <b>العمر:</b> ${Number(player.age)} سنة`,
        `📱 <b>الموبايل:</b> <code>${escapeTelegramHtml(player.phone)}</code>`,
        `📅 <b>تاريخ البدء:</b> ${escapeTelegramHtml(player.startDate)}`,
        `⏳ <b>المدة:</b> ${Number(player.durationMonths)} شهر`,
        `🛑 <b>شوكت يخلص (الانتهاء):</b> ${escapeTelegramHtml(player.endDate)}`,
        `📌 <b>الحالة:</b> ${escapeTelegramHtml(sub.label)}`,
        `━━━━━━━━━━━━━━━━━━`,
        `👇 اضغط الزر أدناه لمراسلة اللاعب مباشرة عبر واتساب:`
      ].join('\n');

      const replyMarkup = {
        inline_keyboard: [
          [{ text: `💬 إرسال تذكير واتساب لـ ${player.name}`, url: waLink }]
        ]
      };

      try {
        if (player.telegramFileId) {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              photo: player.telegramFileId,
              caption,
              parse_mode: 'HTML',
              reply_markup: replyMarkup
            })
          });
          const data = await res.json();
          if (data.ok) {
            if (!silent) showToast(`تم إرسال إشعار "${player.name}" للتليكرام ✈️`, 'success');
            return true;
          }
        }

        if (player.photo && player.photo.startsWith('data:image')) {
          const formData = new FormData();
          formData.append('chat_id', chatId);
          formData.append('photo', dataURLtoBlob(player.photo), 'player.jpg');
          formData.append('caption', caption);
          formData.append('parse_mode', 'HTML');
          formData.append('reply_markup', JSON.stringify(replyMarkup));

          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          const data = await res.json();
          if (data.ok) {
            if (data.result && data.result.photo) {
              const photos = data.result.photo;
              player.telegramFileId = photos[photos.length - 1].file_id;
              savePlayersToStorage();
            }
            if (!silent) showToast(`تم إرسال إشعار "${player.name}" للتليكرام ✈️`, 'success');
            return true;
          }
        }

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          })
        });
        const data = await res.json();
        if (data.ok) {
          if (!silent) showToast(`تم إرسال إشعار "${player.name}" للتليكرام ✈️`, 'success');
          return true;
        }
      } catch (err) {
        console.error('Telegram alert error:', err);
      }

      if (!silent) showToast(`فشل إرسال إشعار "${player.name}" للتليكرام`, 'error');
      return false;
    }

    async function runTelegramCheckForAllExpired() {
      let { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        chatId = await autoDetectChatId(true);
      }
      if (!botToken || !chatId) {
        showToast('أرسل /start لبوت التليكرام أولاً أو اضبط الـ Chat ID في الإعدادات ⚙️', 'warning');
        openSettingsModal();
        return;
      }

      const expiredPlayers = players.filter(p => getSubscriptionStatus(p.endDate).status === 'expired');

      if (expiredPlayers.length === 0) {
        showToast('لا توجد أي اشتراكات منتهية حالياً! جميع الأبطال فعالين 💪', 'info');
        return;
      }

      const btn = document.getElementById('btnAlertAll');
      btn.disabled = true;
      const originalHtml = btn.innerHTML;

      let successCount = 0;
      for (let i = 0; i < expiredPlayers.length; i++) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري الإرسال (${i + 1}/${expiredPlayers.length})...</span>`;
        const ok = await sendSinglePlayerAlertToTelegram(expiredPlayers[i].id, true);
        if (ok) successCount++;
        await new Promise(r => setTimeout(r, 350));
      }

      btn.disabled = false;
      btn.innerHTML = originalHtml;

      if (successCount > 0) {
        logActivity(`إرسال تنبيهات الاشتراكات المنتهية للتليكرام (${successCount} لاعب)`);
        showToast(`تم إرسال ${successCount} من أصل ${expiredPlayers.length} إشعار اشتراك منتهي للتليكرام بنجاح ✅`, 'success');
      } else {
        showToast('تعذر إرسال الإشعارات، تأكد من صحة التوكن والـ Chat ID والإنترنت.', 'error');
      }
    }

    // =========================================================
    // 13. النسخ السحابي المرتب (قائمة مرتبة بأسماء اللاعبين وتواريخ الاشتراك والمدة وشوكت يخلص)
    // =========================================================
    function buildNeatFormattedTextReport() {
      const today = getTodayDateString();
      const fin = calculateFinancialMetrics();
      const lines = [
        `================================================================`,
        `🏋️‍♂️ ${gymProfile.gymName} — (${gymProfile.gymBranch})`,
        `📅 تاريخ التقرير والنسخة السحابية: ${today} (${getArabicDayName(today)})`,
        `================================================================`,
        `📊 ملخص القاعة والأرباح والديون:`,
        `• إجمالي عدد اللاعبين المسجلين : ${players.length} لاعب`,
        `• صافي الأرباح الكلي           : ${fin.netProfit.toLocaleString('en-US')} د.ع`,
        `• إجمالي الديون المتبقية       : ${fin.totalDebt.toLocaleString('en-US')} د.ع`,
        `================================================================`,
        `📋 قائمة أسماء اللاعبين وتواريخ الاشتراك والمدة وشوكت يخلص:`,
        `================================================================`,
        ``
      ];

      if (players.length === 0) {
        lines.push(`لا يوجد لاعبون مسجلون حالياً.`);
      } else {
        players.forEach((p, idx) => {
          const sub = getSubscriptionStatus(p.endDate);
          const endDay = getArabicDayName(p.endDate);
          lines.push(`[${idx + 1}] 👤 اسم اللاعب : ${p.name}  (الكود: ${p.code || 'PG'})`);
          lines.push(`    📱 رقم الموبايل     : ${p.phone}`);
          lines.push(`    🏆 القسم / الاشتراك  : ${p.planType}`);
          lines.push(`    📅 تاريخ الاشتراك    : ${p.startDate} (${getArabicDayName(p.startDate)})`);
          lines.push(`    ⏳ مدة الاشتراك      : ${p.durationMonths} شهر`);
          lines.push(`    🏁 شوكت يخلص (ينتهي) : ${p.endDate} (${endDay}) — [${sub.label}]`);
          lines.push(`    💵 المبلغ المدفوع    : ${Number(p.paidAmount || 0).toLocaleString('en-US')} د.ع | المتبقي (دين): ${Number(p.debtAmount || 0).toLocaleString('en-US')} د.ع`);
          lines.push(`----------------------------------------------------------------`);
        });
      }

      return lines.join('\r\n');
    }

    function buildNeatPrintableHtmlReport() {
      const today = getTodayDateString();
      const fin = calculateFinancialMetrics();
      const fullBackupPayload = {
        schemaVersion: SCHEMA_VERSION,
        gymProfile,
        financeLedger,
        exportedAt: new Date().toISOString(),
        totalPlayers: players.length,
        players
      };

      const rowsHtml = players.map((p, idx) => {
        const sub = getSubscriptionStatus(p.endDate);
        const statusColor = sub.status === 'expired' ? '#ef4444' : sub.status === 'soon' ? '#f59e0b' : '#10b981';
        return `
          <tr>
            <td>${idx + 1}</td>
            <td style="font-weight:900;color:#fff;">${escapeHtml(p.name)}<br><small style="color:#94a3b8;">${escapeHtml(p.code)}</small></td>
            <td dir="ltr">${escapeHtml(p.phone)}</td>
            <td>${escapeHtml(p.planType)}</td>
            <td>${escapeHtml(p.startDate)}</td>
            <td style="color:#f59e0b;font-weight:800;">${Number(p.durationMonths)} شهر</td>
            <td style="color:${statusColor};font-weight:900;">${escapeHtml(p.endDate)} (${escapeHtml(getArabicDayName(p.endDate))})</td>
            <td><span style="padding:3px 8px;border-radius:8px;background:rgba(255,255,255,0.06);color:${statusColor};font-weight:800;">${escapeHtml(sub.label)}</span></td>
            <td style="color:#10b981;font-weight:800;">${Number(p.paidAmount || 0).toLocaleString('en-US')} د.ع</td>
            <td style="color:#f43f5e;font-weight:800;">${Number(p.debtAmount || 0).toLocaleString('en-US')} د.ع</td>
          </tr>
        `;
      }).join('');

      return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>قائمة مشتركي ${escapeHtml(gymProfile.gymName)} - ${today}</title>
<style>
  body { font-family: 'Tahoma', 'Cairo', sans-serif; background: #07111f; color: #f8fafc; padding: 24px; }
  .header { background: #0f172a; border: 2px solid #2563eb; border-radius: 18px; padding: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat-card { background: #0f172a; border: 1px solid #334155; padding: 14px; border-radius: 14px; text-align: center; }
  table { width: 100%; border-collapse: collapse; background: #0f172a; border-radius: 14px; overflow: hidden; font-size: 13px; }
  th { background: #1e293b; color: #38bdf8; padding: 12px 10px; text-align: right; border-bottom: 2px solid #334155; }
  td { padding: 10px; border-bottom: 1px solid #1e293b; }
  tr:hover { background: rgba(37, 99, 235, 0.08); }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin:0;color:#38bdf8;">🏋️‍♂️ ${escapeHtml(gymProfile.gymName)}</h1>
      <p style="margin:5px 0 0;color:#cbd5e1;">📍 ${escapeHtml(gymProfile.gymBranch)}</p>
    </div>
    <div style="text-align:left;">
      <div style="color:#38bdf8;font-weight:bold;">تقرير النسخ السحابي المرتب</div>
      <div style="color:#94a3b8;font-size:12px;">التاريخ: ${today}</div>
    </div>
  </div>
  <div class="stats">
    <div class="stat-card"><div style="color:#94a3b8;font-size:12px;">إجمالي اللاعبين</div><div style="font-size:22px;font-weight:900;color:#fff;">${players.length}</div></div>
    <div class="stat-card"><div style="color:#94a3b8;font-size:12px;">صافي الأرباح</div><div style="font-size:22px;font-weight:900;color:#a855f7;">${fin.netProfit.toLocaleString('en-US')} د.ع</div></div>
    <div class="stat-card"><div style="color:#94a3b8;font-size:12px;">الديون المتبقية</div><div style="font-size:22px;font-weight:900;color:#f43f5e;">${fin.totalDebt.toLocaleString('en-US')} د.ع</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>اسم اللاعب</th>
        <th>الموبايل</th>
        <th>القسم</th>
        <th>تاريخ الاشتراك</th>
        <th>المدة</th>
        <th>شوكت يخلص (الانتهاء)</th>
        <th>الحالة</th>
        <th>المدفوع</th>
        <th>الدين</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="10" style="text-align:center;padding:24px;">لا يوجد لاعبون مسجلون</td></tr>'}
    </tbody>
  </table>
  <script id="power_gym_backup_json" type="application/json">${JSON.stringify(fullBackupPayload).replace(/<\/script>/gi, '<\\/script>')}<\/script>
</body>
</html>`;
    }

    async function sendBackupToTelegram() {
      let { botToken, chatId } = getTelegramSettings();
      if (botToken && !chatId) {
        chatId = await autoDetectChatId(true);
      }
      if (!botToken || !chatId) {
        showToast('أرسل /start لبوت التليكرام أولاً لإرسال النسخة السحابية ⚙️', 'warning');
        openSettingsModal();
        return;
      }

      const btn = document.getElementById('btnCloudBackup');
      btn.disabled = true;
      const origHtml = btn.innerHTML;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري الرفع...</span>`;

      try {
        const today = getTodayDateString();
        const fin = calculateFinancialMetrics();

        // بناء ملخص نصي مرتب للرسالة المرافقة للملف
        const previewLines = players.slice(0, 15).map((p, i) =>
          `${i + 1}. <b>${escapeTelegramHtml(p.name)}</b> | البدء: <code>${escapeTelegramHtml(p.startDate)}</code> | المدة: <b>${p.durationMonths} شهر</b> | شوكت يخلص: <b>${escapeTelegramHtml(p.endDate)}</b>`
        );
        if (players.length > 15) {
          previewLines.push(`... والمزيد (${players.length} لاعب بالكامل داخل الملف المرفق 👇)`);
        }

        const captionText = [
          `☁️ <b>نسخة سحابية مرتبة لقائمة لاعبي ${escapeTelegramHtml(gymProfile.gymName)}</b>`,
          `📍 ${escapeTelegramHtml(gymProfile.gymBranch)}`,
          `📅 <b>تاريخ النسخة:</b> ${today}`,
          `👥 <b>إجمالي اللاعبين:</b> ${players.length} | 💰 <b>الأرباح:</b> ${fin.netProfit.toLocaleString('en-US')} د.ع | ⚠️ <b>الديون:</b> ${fin.totalDebt.toLocaleString('en-US')} د.ع`,
          `━━━━━━━━━━━━━━━━━━━━`,
          ...(previewLines.length > 0 ? previewLines : ['لا يوجد لاعبون مسجلون حالياً.'])
        ].join('\n').slice(0, 1020);

        // 1. إرسال الملف النصي المرتب المقروء فوراً (قائمة_مشتركي_بور_جم.txt)
        const txtReport = buildNeatFormattedTextReport();
        const txtBlob = new Blob(['\uFEFF' + txtReport], { type: 'text/plain;charset=utf-8' });
        const formDataTxt = new FormData();
        formDataTxt.append('chat_id', chatId);
        formDataTxt.append('document', txtBlob, `قائمة_لاعبي_بور_جم_${today}.txt`);
        formDataTxt.append('caption', captionText);
        formDataTxt.append('parse_mode', 'HTML');

        const resTxt = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: 'POST',
          body: formDataTxt
        });
        const dataTxt = await resTxt.json();

        // 2. إرسال ملف الجدول الاحترافي القابل للفتح والاسترجاع (جدول_مشتركي_بور_جم.html)
        const htmlReport = buildNeatPrintableHtmlReport();
        const htmlBlob = new Blob([htmlReport], { type: 'text/html;charset=utf-8' });
        const formDataHtml = new FormData();
        formDataHtml.append('chat_id', chatId);
        formDataHtml.append('document', htmlBlob, `جدول_مشتركي_بور_جم_${today}.html`);
        formDataHtml.append('caption', `📊 <b>جدول المشتركين المرتب (يفتح كجدول واضح ويصلح لاسترجاع النسخة الاحتياطية أيضاً)</b>`);
        formDataHtml.append('parse_mode', 'HTML');

        await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: 'POST',
          body: formDataHtml
        });

        if (dataTxt.ok) {
          logActivity('تم رفع نسخة سحابية مرتبة (قائمة أسماء اللاعبين وتواريخ الاشتراك والانتهاء) إلى التليكرام');
          showToast('تم إرسال ملف قائمة اللاعبين المرتب (الأسماء + التواريخ + المدة + شوكت يخلص) للتليكرام بنجاح ☁️✅', 'success');
        } else {
          showToast('فشل رفع النسخة السحابية للتليكرام!', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('خطأ في الاتصال بسيرفر التليكرام', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }

    // =========================================================
    // 14. إعدادات التليكرام والنسخ الاحتياطي المحلي (JSON / HTML / CSV)
    // =========================================================
    function openSettingsModal() {
      const { botToken, chatId } = getTelegramSettings();
      document.getElementById('botTokenInput').value = botToken;
      document.getElementById('chatIdInput').value = chatId;
      document.getElementById('settingsModal').classList.remove('hidden');
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').classList.add('hidden');
    }

    function saveSettings() {
      const botToken = document.getElementById('botTokenInput').value.trim();
      const chatId = document.getElementById('chatIdInput').value.trim();

      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken, chatId }));
      updateBotIndicator();
      logActivity('تم تحديث إعدادات بوت التليكرام');
      showToast('تم حفظ إعدادات التليكرام بنجاح ✅', 'success');
      closeSettingsModal();
    }

    async function testTelegramConnection() {
      const botToken = document.getElementById('botTokenInput').value.trim();
      let chatId = document.getElementById('chatIdInput').value.trim();

      const btn = document.getElementById('btnTestConn');
      btn.disabled = true;
      btn.textContent = 'جاري الفحص...';

      if (!botToken) {
        showToast('أدخل توكن البوت الجديد من الإعدادات أولاً.', 'warning');
        btn.disabled = false;
        btn.textContent = 'فحص الاتصال';
        return;
      }

      if (!chatId) {
        chatId = await autoDetectChatId(false);
        if (!chatId) {
          btn.disabled = false;
          btn.textContent = 'فحص الاتصال';
          return;
        }
      }

      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ <b>تم الاتصال بنجاح!</b>\nمنظومة <b>${escapeTelegramHtml(gymProfile.gymName)} (${escapeTelegramHtml(gymProfile.gymBranch)})</b> جاهزة لإرسال رسائل تفعيل اللاعبين، إشعارات الـ 3 أيام، والنسخ السحابي المرتب. 💪🔥`,
            parse_mode: 'HTML'
          })
        });
        const data = await res.json();
        if (data.ok) {
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ botToken, chatId }));
          updateBotIndicator();
          showToast('الاتصال ببوت التليكرام ناجح! تحقق من رسائل التليكرام 🎉', 'success');
        } else {
          showToast(`فشل الاتصال: ${data.description || 'تأكد من التوكن والـ Chat ID'}`, 'error');
        }
      } catch (err) {
        showToast('تعذر الاتصال بسيرفر التليكرام، تحقق من اتصال الإنترنت.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'فحص الاتصال';
      }
    }

    function exportDatabase() {
      const backupData = {
        schemaVersion: SCHEMA_VERSION,
        gymProfile,
        financeLedger,
        exportedAt: new Date().toISOString(),
        players
      };

      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `power_gym_backup_${getTodayDateString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logActivity('تحميل نسخة احتياطية محلية JSON');
      showToast('تم تحميل النسخة الاحتياطية لقاعدة البيانات بنجاح 💾', 'success');
    }

    function importDatabase(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          let rawText = String(e.target.result || '');
          // دعم الاسترجاع من ملف الجدول السحابي HTML أو ملف JSON
          const embeddedMatch = rawText.match(/<script id="power_gym_backup_json" type="application\/json">([\s\S]*?)<\/script>/i);
          if (embeddedMatch && embeddedMatch[1]) {
            rawText = embeddedMatch[1];
          }

          const imported = JSON.parse(rawText);
          const rawPlayers = Array.isArray(imported) ? imported : imported.players;

          if (!Array.isArray(rawPlayers)) {
            showToast('ملف النسخة الاحتياطية غير صالح!', 'error');
            return;
          }

          if (imported.gymProfile && typeof imported.gymProfile === 'object') {
            gymProfile = { ...gymProfile, ...imported.gymProfile };
            localStorage.setItem(STORAGE_KEYS.GYM_PROFILE, JSON.stringify(gymProfile));
            applyGymBrandingToUI();
          }

          if (imported.financeLedger && typeof imported.financeLedger === 'object') {
            financeLedger = { ...financeLedger, ...imported.financeLedger };
            saveFinanceLedgerToStorage();
          }

          players = rawPlayers.map(sanitizePlayerRecord).filter(Boolean);
          ensureUniquePlayerCodes(players);
          savePlayersToStorage();

          logActivity(`استرجاع نسخة احتياطية (${players.length} لاعب)`);
          showToast(`تم فحص واسترجاع بيانات ${players.length} لاعب بأمان تام ✅`, 'success');
          closeSettingsModal();
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية!', 'error');
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file);
    }

    function exportToExcelCSV() {
      if (players.length === 0) {
        showToast('لا توجد بيانات لتصديرها حالياً!', 'warning');
        return;
      }

      const headers = ['الكود', 'اسم اللاعب', 'العمر', 'الموبايل', 'القسم', 'تاريخ الاشتراك', 'المدة (أشهر)', 'شوكت يخلص (الانتهاء)', 'المبلغ المدفوع', 'الدين المتبقي', 'عدد الحضور', 'ملاحظات', 'ملاحظات الكورس', 'عدد صور الكورس'];
      const rows = players.map(p => [
        p.code || '',
        `"${String(p.name || '').replace(/"/g, '""')}"`,
        p.age || '',
        `"${p.phone || ''}"`,
        `"${p.planType || ''}"`,
        p.startDate || '',
        p.durationMonths || '',
        p.endDate || '',
        p.paidAmount || 0,
        p.debtAmount || 0,
        p.attendanceCount || 0,
        `"${String(p.notes || '').replace(/"/g, '""')}"`,
        `"${String(p.courseNotes || '').replace(/"/g, '""')}"`,
        Array.isArray(p.courseImages) ? p.courseImages.length : 0
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `قائمة_مشتركي_بور_جم_${getTodayDateString()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logActivity('تصدير سجل اللاعبين بصيغة Excel CSV');
      showToast('تم تصدير جدول اللاعبين بصيغة Excel بنجاح 📊', 'success');
    }
