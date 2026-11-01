'use strict';
// =========================================================
// جسر آمن بين الواجهة (index.html / app.js) والنظام
// يعرض فقط الدوال المسموحة عبر window.powerGymDesktop
// =========================================================
const { contextBridge, ipcRenderer } = require('electron');

// نحمّل كل البيانات المحفوظة مرة واحدة عند البداية (تزامني حتى تكون جاهزة قبل app.js)
const initialStorage = ipcRenderer.sendSync('storage:load') || {};

contextBridge.exposeInMainWorld('powerGymDesktop', {
  isDesktop: true,
  initialStorage,
  setItem: (key, value) => ipcRenderer.send('storage:set', key, value),
  removeItem: key => ipcRenderer.send('storage:remove', key),
  clear: () => ipcRenderer.send('storage:clear'),
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  openDataFolder: () => ipcRenderer.invoke('data:folder')
});
