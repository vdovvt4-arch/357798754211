'use strict';
// =========================================================
// Power Gym - تطبيق سطح المكتب (Electron main process)
// كل البيانات تنحفظ على حاسبة الكابتن في مجلد: Documents/Power Gym
// =========================================================
const { app, BrowserWindow, protocol, net, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const APP_ROOT = __dirname;
const DATA_DIR = path.join(app.getPath('documents'), 'Power Gym');
const DATA_FILE = path.join(DATA_DIR, 'power-gym-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'النسخ الاحتياطية');
const REPORTS_DIR = path.join(DATA_DIR, 'التقارير');
const MAX_AUTO_BACKUPS = 60;

let store = {};
let saveTimer = null;
let mainWindow = null;

// ---------- تخزين الملفات ----------
function ensureDirs() {
  for (const dir of [DATA_DIR, BACKUP_DIR, REPORTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadStoreFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') store = parsed;
    }
  } catch (err) {
    console.error('تعذر قراءة ملف البيانات:', err);
    // نحتفظ بنسخة من الملف التالف حتى لا نخسر البيانات
    try {
      const broken = path.join(BACKUP_DIR, `damaged-${Date.now()}.json`);
      if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, broken);
    } catch { /* تجاهل */ }
    store = {};
  }
}

function writeStoreNow() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE); // كتابة ذرية: لا يتلف الملف إذا انقطعت الكهرباء
  } catch (err) {
    console.error('تعذر حفظ البيانات:', err);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeStoreNow, 250);
}

function makeAutoBackup() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const target = path.join(BACKUP_DIR, `auto-${stamp}.json`);
    fs.copyFileSync(DATA_FILE, target);
    // نحذف الأقدم ونبقي آخر عدد محدد
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('auto-') && f.endsWith('.json'))
      .sort();
    while (files.length > MAX_AUTO_BACKUPS) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (err) {
    console.error('تعذر إنشاء النسخة الاحتياطية التلقائية:', err);
  }
}

function sanitizeFileName(name) {
  return String(name || 'report.csv').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

// ---------- IPC: جسر التخزين مع الواجهة ----------
function registerIpc() {
  ipcMain.on('storage:load', event => {
    event.returnValue = store;
  });
  ipcMain.on('storage:set', (_e, key, value) => {
    store[String(key)] = String(value);
    scheduleSave();
  });
  ipcMain.on('storage:remove', (_e, key) => {
    delete store[String(key)];
    scheduleSave();
  });
  ipcMain.on('storage:clear', () => {
    store = {};
    scheduleSave();
  });

  ipcMain.handle('file:save', async (_e, defaultName, content) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ التقرير',
      defaultPath: path.join(REPORTS_DIR, sanitizeFileName(defaultName)),
      filters: [{ name: 'CSV', extensions: ['csv'] }, { name: 'الكل', extensions: ['*'] }]
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  });

  ipcMain.handle('backup:now', async () => {
    writeStoreNow();
    makeAutoBackup();
    return BACKUP_DIR;
  });

  ipcMain.handle('data:folder', async () => {
    await shell.openPath(DATA_DIR);
    return DATA_DIR;
  });
}

// ---------- نافذة التطبيق ----------
// نسجل مخطط مخصص (pgapp://) حتى تشتغل سياسة CSP الموجودة في index.html بشكل صحيح
protocol.registerSchemesAsPrivileged([
  { scheme: 'pgapp', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function registerAppProtocol() {
  protocol.handle('pgapp', request => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.normalize(path.join(APP_ROOT, rel));
    if (!filePath.startsWith(APP_ROOT)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function buildMenu() {
  const template = [
    {
      label: 'ملف',
      submenu: [
        { label: 'فتح مجلد البيانات', click: () => shell.openPath(DATA_DIR) },
        { label: 'نسخة احتياطية الآن', click: () => { writeStoreNow(); makeAutoBackup(); } },
        { type: 'separator' },
        { role: 'quit', label: 'خروج' }
      ]
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'reload', label: 'إعادة تحميل' },
        { role: 'toggleDevTools', label: 'أدوات المطور' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'الحجم الطبيعي' },
        { role: 'zoomIn', label: 'تكبير' },
        { role: 'zoomOut', label: 'تصغير' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'Power Gym - بور جم',
    backgroundColor: '#07111f',
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL('pgapp://local/index.html');

  // الروابط الخارجية (مثل تليكرام) تفتح بالمتصفح الافتراضي
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// نسخة واحدة فقط من التطبيق تشتغل بنفس الوقت
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ensureDirs();
    loadStoreFromDisk();
    makeAutoBackup();
    registerIpc();
    registerAppProtocol();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // نحفظ قبل الإغلاق بشكل مؤكد
  app.on('before-quit', () => {
    clearTimeout(saveTimer);
    writeStoreNow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
