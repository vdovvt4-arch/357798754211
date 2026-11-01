/* =========================================================
   storage-shim.js
   داخل تطبيق سطح المكتب: localStorage يصير مربوط بملف على الحاسبة
   داخل المتصفح (النسخة الويب): ما يتغير شي ويشتغل localStorage العادي
   ========================================================= */
(function () {
  'use strict';
  var bridge = window.powerGymDesktop;
  if (!bridge || !bridge.isDesktop) return;

  var data = Object.assign({}, bridge.initialStorage || {});

  var shim = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, value) {
      data[key] = String(value);
      bridge.setItem(key, String(value));
    },
    removeItem: function (key) {
      delete data[key];
      bridge.removeItem(key);
    },
    clear: function () {
      Object.keys(data).forEach(function (k) { delete data[k]; });
      bridge.clear();
    },
    key: function (index) {
      var keys = Object.keys(data);
      return index < keys.length ? keys[index] : null;
    },
    get length() {
      return Object.keys(data).length;
    }
  };

  try {
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  } catch (err) {
    console.warn('تعذر ربط التخزين بملف الحاسبة:', err);
  }
})();
