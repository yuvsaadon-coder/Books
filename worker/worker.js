// שרת משפחתי למנהל הקריאה (Cloudflare Worker)
// 1. /sync         סנכרון הספרייה בין מכשירים (KV)
// 2. /v1/messages  גישה ל-Claude עם חיפוש ברשת שמוגבל לאתרים אמינים. המפתח נשמר כאן ולא בדפדפן.
//
// הגדרות נדרשות ב-Cloudflare (ראו README.md בתיקייה הזו):
//   Secret   ANTHROPIC_API_KEY  מפתח ה-API של Anthropic
//   Secret   GOOGLE_BOOKS_KEY   (רשות) מפתח Google Books לחיפוש מלא בעברית
//   KV       LIBRARY            מאגר KV לשמירת הספרייה

const ALLOWED_ORIGINS = ['https://yuvsaadon-coder.github.io'];
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-5'];
const ALLOWED_BETAS = ['server-side-fallback-2026-07-01'];
const MAX_TOKENS = 32000;
const DAILY_AI_LIMIT = 150;          // מספר קריאות ל-Claude ביום לכל הספרייה
const MAX_SYNC_BYTES = 5 * 1024 * 1024;

// האתרים היחידים שהמודל רשאי לחפש ולקרוא בהם
const TRUSTED_DOMAINS = [
  // חנויות ומאגרים ישראליים
  'e-vrit.co.il', 'steimatzky.co.il', 'booknet.co.il', 'simania.co.il', 'mendele.co.il', 'indiebook.co.il', 'nli.org.il',
  // הוצאות לאור
  'am-oved.co.il', 'kibutz-poalim.co.il', 'ybook.co.il', 'kinbooks.co.il', 'keter-books.co.il', 'modan.co.il',
  'abayit-books.com', '9livespress.com', 'pardes.co.il', 'resling.co.il',
  // ביקורת וספרות
  // (newyorker.com, nytimes.com, theguardian.com נחסמים ע"י Anthropic ולכן לא ברשימה)
  'haaretz.co.il', 'ynet.co.il', 'wikipedia.org', 'goodreads.com', 'kirkusreviews.com', 'publishersweekly.com', 'lrb.co.uk', 'nybooks.com', 'bookbrowse.com',
  // זמינות דיגיטלית וקולית, קטלוגים
  'storytel.com', 'audible.com', 'books.google.com', 'openlibrary.org', 'worldcat.org'
];

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || '*',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });

export function sanitizeTools(tools, blocked = []) {
  const base = TRUSTED_DOMAINS.filter(d => !blocked.includes(d));
  // האפליקציה יכולה לצמצם (לא להרחיב) את רשימת האתרים ואת מספר השימושים
  const narrow = (t) => {
    const want = Array.isArray(t.allowed_domains) ? base.filter(d => t.allowed_domains.includes(d)) : [];
    return want.length ? want : base;
  };
  const uses = (t, max) => Math.max(1, Math.min(max, Number(t.max_uses) || max));
  const out = [];
  for (const t of Array.isArray(tools) ? tools : []) {
    if (t && t.name === 'web_search' && /^web_search_/.test(t.type || '')) {
      // בלי user_location: חיפוש הרשת של Anthropic לא תומך בקוד מדינה IL (מחזיר 400)
      out.push({ type: t.type, name: 'web_search', allowed_domains: narrow(t), max_uses: uses(t, 5) });
    } else if (t && t.name === 'web_fetch' && /^web_fetch_/.test(t.type || '')) {
      out.push({ type: t.type, name: 'web_fetch', allowed_domains: narrow(t), max_uses: uses(t, 4), max_content_tokens: 6000 });
    } else if (t && !t.type && t.name && t.input_schema) {
      out.push(t);   // כלים של האפליקציה עצמה (למשל החזרת תוצאה במבנה קבוע)
    }
  }
  return out;
}

async function handleAI(req, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return json({ type: 'error', error: { type: 'not_configured', message: 'ANTHROPIC_API_KEY is not set' } }, 503, cors);
  const day = new Date().toISOString().slice(0, 10);
  const counterKey = 'ai-count:' + day;
  const used = parseInt((await env.LIBRARY.get(counterKey)) || '0', 10);
  if (used >= DAILY_AI_LIMIT) return json({ type: 'error', error: { type: 'daily_limit', message: 'Daily AI limit reached' } }, 429, cors);
  await env.LIBRARY.put(counterKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });

  let body;
  try { body = await req.json(); } catch (e) { return json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } }, 400, cors); }
  if (!ALLOWED_MODELS.includes(body.model)) body.model = ALLOWED_MODELS[0];
  body.max_tokens = Math.min(Number(body.max_tokens) || 16000, MAX_TOKENS);
  const requestedTools = body.tools;
  let blocked = (await env.LIBRARY.get('blocked-domains', 'json')) || [];
  delete body.mcp_servers; delete body.container;

  const betas = (req.headers.get('anthropic-beta') || '').split(',').map(s => s.trim()).filter(b => ALLOWED_BETAS.includes(b));
  if (body.fallbacks && !betas.includes('server-side-fallback-2026-07-01')) delete body.fallbacks;
  const headers = {
    'content-type': 'application/json',
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01'
  };
  if (betas.length) headers['anthropic-beta'] = betas.join(',');

  const url = new URL(req.url);
  // אתר שהסורק של Anthropic לא יכול לגשת אליו גורם ל-400; מסירים אותו, זוכרים, ומנסים שוב
  for (let attempt = 0; attempt < 3; attempt++) {
    body.tools = sanitizeTools(requestedTools, blocked);
    if (!body.tools.length) delete body.tools;
    const upstream = await fetch('https://api.anthropic.com' + url.pathname + url.search, { method: 'POST', headers, body: JSON.stringify(body) });
    if (upstream.status === 400) {
      const text = await upstream.text();
      const newlyBlocked = blockedDomainsFrom(text).filter(d => !blocked.includes(d));
      if (newlyBlocked.length && attempt < 2) {
        blocked = [...blocked, ...newlyBlocked];
        await env.LIBRARY.put('blocked-domains', JSON.stringify(blocked));
        continue;
      }
      return new Response(text, { status: 400, headers: { ...cors, 'content-type': 'application/json' } });
    }
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' } });
  }
}

// "The following domains are not accessible to our user agent: ['a.com', 'b.com']"
export function blockedDomainsFrom(text) {
  const m = /not accessible[^\[]*\[([^\]]*)\]/i.exec(text || '');
  if (!m) return [];
  return [...m[1].matchAll(/['"]([a-z0-9.-]+\.[a-z]{2,})['"]/gi)].map(x => x[1].toLowerCase());
}

// Google Books דרך השרת: מוסיף את המפתח (שמור בשרת) ושומר תוצאות במטמון ל-12 שעות,
// כדי שכל הטלפונים יקבלו תוצאות מלאות בלי מפתח משלהם ובלי לבזבז מכסה
const GOOGLE_REFERER = 'https://yuvsaadon-coder.github.io/';
async function handleGoogleBooks(req, env, cors, ctx) {
  const target = new URL(req.url).searchParams.get('u') || '';
  let u;
  try { u = new URL(target); } catch (e) { return json({ error: 'bad_url' }, 400, cors); }
  if (u.origin !== 'https://www.googleapis.com' || !u.pathname.startsWith('/books/v1/volumes')) return json({ error: 'not_allowed' }, 400, cors);
  u.searchParams.delete('key');
  const cacheKey = new Request('https://gbooks-cache/' + encodeURIComponent(u.toString()));
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { status: 200, headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'hit' } });
  if (env.GOOGLE_BOOKS_KEY) u.searchParams.set('key', env.GOOGLE_BOOKS_KEY);
  const up = await fetch(u.toString(), { headers: { Referer: GOOGLE_REFERER } });
  const body = await up.text();
  if (up.ok) ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=43200' } })));
  return new Response(body, { status: up.status, headers: { ...cors, 'content-type': 'application/json' } });
}

// אימות ספר מדף באתר אמין (חנות/הוצאה): השרת נכנס לדף, בודק שהשם (והמחבר) מופיעים בו,
// ומחזיר כותרת, כריכה ותקציר מתגי ה-og של הדף. משמש לספרים עבריים שאינם במאגרים הפתוחים.
const heNorm = (t) => (t || '').toLowerCase().replace(/[\u0591-\u05C7]/g, '').replace(/&[#a-z0-9]+;/gi, ' ')
  .replace(/[״׳"'`’‘]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function decodeEntities(t) {
  return (t || '').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function metaOf(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
    const tag = re.exec(html);
    if (tag) { const c = /content=["']([^"']*)["']/i.exec(tag[0]); if (c && c[1].trim()) return decodeEntities(c[1].trim()); }
  }
  return '';
}
export function checkPage(html, expectTitle, expectAuthor) {
  const text = heNorm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
  const words = heNorm(expectTitle).split(' ').filter(w => w.length > 1);
  const titleOk = words.length > 0 && words.every(w => text.includes(w));
  const surname = heNorm(expectAuthor).split(' ').filter(Boolean).pop();
  const authorOk = !surname || text.includes(surname);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    ok: titleOk && authorOk, titleOk, authorOk,
    title: metaOf(html, ['og:title', 'twitter:title']) || decodeEntities((titleTag && titleTag[1] || '').trim()),
    image: metaOf(html, ['og:image', 'twitter:image']),
    description: metaOf(html, ['og:description', 'description', 'twitter:description'])
  };
}
async function handlePage(req, cors, ctx) {
  const q = new URL(req.url).searchParams;
  let u;
  try { u = new URL(q.get('url') || ''); } catch (e) { return json({ ok: false, error: 'bad_url' }, 400, cors); }
  const host = u.hostname.replace(/^www\./, '');
  if (u.protocol !== 'https:' || !TRUSTED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return json({ ok: false, error: 'not_trusted' }, 400, cors);
  const cacheKey = new Request('https://page-cache/' + encodeURIComponent(u.toString()));
  let html = null;
  const hit = await caches.default.match(cacheKey);
  if (hit) html = await hit.text();
  else {
    const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BooksFamilyApp/1.0)', 'Accept-Language': 'he,en;q=0.8' }, redirect: 'follow' });
    if (!r.ok) return json({ ok: false, error: 'http_' + r.status }, 200, cors);
    html = (await r.text()).slice(0, 2000000);
    ctx.waitUntil(caches.default.put(cacheKey, new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=86400' } })));
  }
  const res = checkPage(html, q.get('title') || '', q.get('author') || '');
  return json({ ...res, url: u.toString(), site: host }, 200, cors);
}

async function handleSync(req, env, cors) {
  if (req.method === 'GET') {
    const cur = await env.LIBRARY.get('state', 'json');
    return json(cur || { rev: 0, data: null }, 200, cors);
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_SYNC_BYTES) return json({ error: 'too_large' }, 413, cors);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
    const cur = (await env.LIBRARY.get('state', 'json')) || { rev: 0, data: null };
    if (cur.rev !== body.baseRev) return json(cur, 409, cors);   // מישהו אחר עדכן בינתיים: הלקוח ימזג וינסה שוב
    const next = { rev: cur.rev + 1, at: Date.now(), data: body.data };
    await env.LIBRARY.put('state', JSON.stringify(next));
    // גיבוי יומי אוטומטי, נשמר 30 יום
    await env.LIBRARY.put('backup:' + new Date().toISOString().slice(0, 10), JSON.stringify(next), { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ rev: next.rev }, 200, cors);
  }
  return json({ error: 'method' }, 405, cors);
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // אין קוד גישה: השרת פתוח לאפליקציה. ההוצאה מוגבלת ע"י DAILY_AI_LIMIT ותקרת ההוצאה בחשבון Anthropic.
    const path = new URL(req.url).pathname;
    try {
      if (path === '/ping') return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, sync: !!env.LIBRARY, gbooks: !!env.GOOGLE_BOOKS_KEY }, 200, cors);
      if (path === '/gbooks' && req.method === 'GET') return await handleGoogleBooks(req, env, cors, ctx);
      if (path === '/page' && req.method === 'GET') return await handlePage(req, cors, ctx);
      if (path === '/sync') return await handleSync(req, env, cors);
      if (path.startsWith('/v1/messages') && req.method === 'POST') return await handleAI(req, env, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      return json({ type: 'error', error: { type: 'worker_error', message: String(e && e.message || e) } }, 500, cors);
    }
  }
};
