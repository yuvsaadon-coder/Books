// Service worker: מאפשר התקנה על מסך הבית ופתיחה גם בלי אינטרנט.
// דף האפליקציה: קודם מהרשת (כדי לקבל עדכונים), ואם אין רשת – מהמטמון.
// ספריות מ-CDN, אייקונים ו-manifest: מהמטמון, עם רענון ברקע.
// קריאות ל-API (Google Books, Open Library, Wikidata, השרת המשפחתי) לא נשמרות במטמון.
const CACHE = 'books-app-v29';
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
    // בלי מטמון הדפדפן: אחרת GitHub Pages מגיש גרסה ישנה עד 10 דקות אחרי עדכון
    e.respondWith(fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(res => {
      // תשובה שעברה הפניה (למשל /Books → /Books/) אסור להחזיר לניווט כמו שהיא: הדף נתקע. מחזירים הפניה רגילה
      if (res.redirected) return Response.redirect(res.url, 302);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
      return res;
    }).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
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

// התראות מהשרת (הצעות דו-שבועיות, "ההמלצה מוכנה"): נשלחות בלי תוכן, וכאן שואלים את השרת מה לכתוב.
// אם האפליקציה פתוחה ומוצגת עכשיו, לא מקפיצים התראה (המשתמש כבר רואה את התוצאה)
const API = 'https://books.yuvsaadon.workers.dev';
async function endpointKey(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let n = { title: 'מה שנקרא', body: 'יש לך עדכון חדש', url: './' };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) n = await (await fetch(API + '/push/notice?e=' + await endpointKey(sub.endpoint), { cache: 'no-store' })).json();
    } catch (err) { /* הודעה כללית */ }
    if (wins.some(w => w.visibilityState === 'visible') && /view=recs/.test(n.url || '')) return;
    await self.registration.showNotification(n.title || 'מה שנקרא', {
      body: n.body || '', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png',
      tag: /recs/.test(n.url || '') ? 'recs' : 'digest', lang: 'he', dir: 'rtl', data: { url: n.url || './' }
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
