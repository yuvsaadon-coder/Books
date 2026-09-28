// Service worker: מאפשר התקנה על מסך הבית ופתיחה גם בלי אינטרנט.
// דף האפליקציה: קודם מהרשת (כדי לקבל עדכונים), ואם אין רשת – מהמטמון.
// ספריות מ-CDN, אייקונים ו-manifest: מהמטמון, עם רענון ברקע.
// קריאות ל-API (Google Books, Open Library, Wikidata, השרת המשפחתי) לא נשמרות במטמון.
const CACHE = 'books-app-v11';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/frank-ruhl-libre-hebrew-400-normal.woff2', './fonts/assistant-hebrew-400-normal.woff2', './fonts/assistant-hebrew-600-normal.woff2'];
const STATIC_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin || STATIC_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    }));
  }
});
