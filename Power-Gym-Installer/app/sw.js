// Service Worker - Power Gym (نسخة الويب/الهاتف PWA)
// - ملفات التطبيق: الشبكة أولاً ثم النسخة المخزنة (لتصل التحديثات ويعمل بدون إنترنت)
// - ملفات الـ CDN (Tailwind / الخطوط / الأيقونات): من الذاكرة أولاً مع تحديث بالخلفية
const CACHE_NAME = 'power-gym-web-v3';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './theme.css',
  './mobile.css',
  './storage-shim.js',
  './app.js',
  './reports.js',
  './receipts.js',
  './extras.js',
  './manifest.json',
  './logo.svg',
  './build/icon.png'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(LOCAL_ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.telegram.org' || url.hostname === 'api.qrserver.com') return;

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => {
        const network = fetch(req)
          .then(res => {
            if (res && (res.ok || res.type === 'opaque')) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then(c => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});
