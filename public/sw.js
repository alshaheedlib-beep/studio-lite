/* يحفظ واجهة البرنامج على الجهاز لتفتح بسرعة. طلبات /api لا تُخزَّن أبداً. */
const CACHE = 'studio-lite-v2';
const SHELL = ['/', '/style.css', '/app.js', '/icon.svg', '/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // الشبكة أولاً (لتصل التحديثات فوراً)، ثم النسخة المحفوظة عند الانقطاع
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && url.origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
