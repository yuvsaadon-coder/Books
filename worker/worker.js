// שרת משפחתי למנהל הקריאה (Cloudflare Worker)
// 1. /sync         סנכרון הספרייה בין מכשירים (KV)
// 2. /v1/messages  גישה ל-Claude עם חיפוש ברשת שמוגבל לאתרים אמינים. המפתח נשמר כאן ולא בדפדפן.
// 3. /stores       חיפוש ספר בעברית, סטימצקי וצומת ספרים (דף ספר אמיתי = אימות)
// 4. /gbooks /nli /page  Google Books, הספרייה הלאומית, ובדיקת דף ספר
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

// הספרייה הלאומית: כמעט כל ספר שיוצא לאור בישראל נרשם בה (חוק הספרים), כולל ספרים חדשים והוצאות קטנות.
// המפתח שמור בשרת (NLI_API_KEY). התשובה מנורמלת כאן, כדי שהאפליקציה תקבל מבנה פשוט.
const nliVals = (v) => v == null ? [] : Array.isArray(v) ? v.flatMap(nliVals)
  : typeof v === 'object' ? nliVals(v['@value'] ?? v.value ?? v['@id'] ?? null) : [String(v).trim()].filter(Boolean);
const nliField = (item, name) => Object.keys(item).filter(k => k === name || k.endsWith('/' + name) || k.endsWith('#' + name)).flatMap(k => nliVals(item[k]));
// "אספדל, תומס, 1961- מחבר" → "תומס אספדל"
export function nliPerson(s) {
  const parts = String(s).split(',').map(x => x.trim()).filter(x => x && !/\d/.test(x) && !/^(author|translator|editor|מחבר|מתרגם|עורך)/i.test(x));
  const name = parts.length >= 2 ? `${parts[1]} ${parts[0]}` : (parts[0] || '');
  return name.replace(/\s*(author|translator|editor|מחבר|מחברת|מתרגם|מתרגמת|עורך|עורכת)\.?$/i, '').replace(/[.,\s]+$/, '').trim();
}
export function parseNli(data) {
  const arr = Array.isArray(data) ? data : ((data && (data.items || data.results || data.docs || Object.values(data).find(Array.isArray))) || []);
  return arr.filter(x => x && typeof x === 'object').map(item => {
    const rawTitle = nliField(item, 'title')[0] || '';
    const title = rawTitle.split(' / ')[0].replace(/\s*[:;]\s*$/, '').trim();
    const id = (nliField(item, 'recordid')[0] || nliField(item, 'identifier').find(x => /^\d{9,}$/.test(x)) || '').replace(/\D/g, '');
    const all = [...nliField(item, 'identifier'), ...nliField(item, 'isbn')].join(' ');
    const isbns = [...new Set((all.match(/97[89][\d-]{10,14}|\b\d{9}[\dXx]\b/g) || []).map(x => x.replace(/-/g, '')).filter(x => x.length === 10 || x.length === 13))];
    const date = nliField(item, 'date')[0] || nliField(item, 'start_date')[0] || '';
    return {
      id, title, subtitle: '',
      authors: [...new Set(nliField(item, 'creator').map(nliPerson).filter(Boolean))].slice(0, 3),
      year: (date.match(/\d{4}/) || [''])[0], publisher: (nliField(item, 'publisher')[0] || '').replace(/^[^:]*:\s*/, '').replace(/[,\s]+\d{4}.*$/, '').trim(),
      language: (nliField(item, 'language')[0] || '').slice(0, 3).toLowerCase(), isbns,
      cover: nliField(item, 'thumbnail')[0] || '',
      link: id ? `https://www.nli.org.il/he/books/NNL_ALEPH${id}/NLI` : ''
    };
  }).filter(b => b.title);
}
async function handleNli(req, env, cors, ctx) {
  if (!env.NLI_API_KEY) return json({ error: 'not_configured' }, 503, cors);
  const p = new URL(req.url).searchParams;
  const title = (p.get('title') || '').slice(0, 200), author = (p.get('author') || '').slice(0, 100), isbn = (p.get('isbn') || '').replace(/[^\dXx]/g, '');
  if (!title && !isbn) return json({ error: 'missing' }, 400, cors);
  const clean = (s) => s.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const query = isbn ? `any,contains,${isbn}` : `title,contains,${clean(title)}` + (author ? `,AND;creator,contains,${clean(author)}` : '');
  const u = new URL('https://api.nli.org.il/openlibrary/search');
  u.searchParams.set('query', query); u.searchParams.set('output_format', 'json');
  u.searchParams.set('material_type', 'books'); u.searchParams.set('rows', '15');
  const cacheKey = new Request('https://nli-cache/' + encodeURIComponent(u.toString()));
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { status: 200, headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'hit' } });
  u.searchParams.set('api_key', env.NLI_API_KEY);
  const up = await fetch(u.toString(), { headers: { accept: 'application/json' } });
  if (!up.ok) return json({ error: 'upstream', status: up.status }, 502, cors);
  const text = await up.text();
  let items = [];
  try { items = parseNli(JSON.parse(text)); } catch (e) { items = []; }
  const body = JSON.stringify({ items });
  ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' } })));
  return new Response(body, { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
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

// ---------- חיפוש בחנויות ובהוצאות: עברית, סטימצקי, צומת ספרים, והוצאות הספרים ----------
// 1. ניסיון חינמי: דף תוצאות החיפוש של החנות עצמה, ומתוכו קישורים לדפי ספרים ששמם תואם.
// 2. אם זה לא הצליח (דף שנבנה ב-JavaScript או חסום): חיפוש אחד, מוגבל לשלושת האתרים, דרך Claude Haiku
//    ובאתרי ההוצאות (בלי "חשיבה"; לוקחים רק את תוצאות מנוע החיפוש: כתובת + כותרת). עולה כסנט, כמה שניות.
// רשתות הספרים + ההוצאות (גדולות וקטנות מובילות): דף ספר באחד מהם = הספר קיים בעברית
export const STORE_SITES = ['e-vrit.co.il', 'steimatzky.co.il', 'booknet.co.il',
  'am-oved.co.il', 'kibutz-poalim.co.il', 'ybook.co.il', 'kinbooks.co.il', 'keter-books.co.il', 'modan.co.il',
  '9livespress.com', 'abayit-books.com', 'pardes.co.il', 'resling.co.il'];
const STORE_SEARCH_URLS = [
  (q) => 'https://www.steimatzky.co.il/catalogsearch/result/?q=' + encodeURIComponent(q),
  (q) => 'https://www.booknet.co.il/search?q=' + encodeURIComponent(q),
  (q) => 'https://www.e-vrit.co.il/Search/' + encodeURIComponent(q)
];
const STORE_DAILY_LIMIT = 400;
const storeOf = (url) => { try { const h = new URL(url).hostname.replace(/^www\./, ''); return STORE_SITES.find(d => h === d || h.endsWith('.' + d)) || ''; } catch (e) { return ''; } };
// הכותרת מכילה את כל המילים של שם הספר
export function titleHas(text, title) {
  const t = ' ' + heNorm(text) + ' ';
  const words = heNorm(title).split(' ').filter(w => w.length > 1);
  return words.length > 0 && words.every(w => t.includes(' ' + w + ' ') || t.includes(' ' + w) );
}
// "נגד הטבע - תומס אספדל | עברית" → "נגד הטבע"
export function cleanStoreTitle(t) {
  return decodeEntities(String(t || '')).split(/\s[|–—]\s|\s-\s/)[0].replace(/^(ספר|ספר דיגיטלי|ספר קולי)\s*[:|-]\s*/, '').trim();
}
// קישורים לדפי מוצר מתוך דף תוצאות: <a href=...>שם</a> באותו אתר, ששמם מכיל את שם הספר
export function storeLinksFromHtml(html, base, title) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    let url;
    try { url = new URL(decodeEntities(m[1]), base).toString(); } catch (e) { continue; }
    if (!storeOf(url) || /search|catalogsearch|login|cart|account/i.test(url)) continue;
    const titleAttr = (/title=["']([^"']+)["']/i.exec(m[0]) || [])[1] || '';
    const text = decodeEntities((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || titleAttr;
    if (text.length < 2 || text.length > 200 || !titleHas(text, title)) continue;
    if (!out.some(o => o.url === url)) out.push({ url, title: cleanStoreTitle(text), site: storeOf(url) });
  }
  return out;
}
async function fetchHtml(url, ctx, ttl = 86400) {
  const cacheKey = new Request('https://page-cache/' + encodeURIComponent(url));
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.text();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BooksFamilyApp/1.0)', 'Accept-Language': 'he,en;q=0.8' }, redirect: 'follow', signal: ctrl.signal });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 2000000);
    ctx.waitUntil(caches.default.put(cacheKey, new Response(html, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=' + ttl } })));
    return html;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
async function storeSearchViaClaude(env, q) {
  if (!env.ANTHROPIC_API_KEY) return [];
  const day = new Date().toISOString().slice(0, 10);
  const counterKey = 'store-count:' + day;
  const used = parseInt((await env.LIBRARY.get(counterKey)) || '0', 10);
  if (used >= STORE_DAILY_LIMIT) return [];
  await env.LIBRARY.put(counterKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  let blocked = (await env.LIBRARY.get('blocked-domains', 'json')) || [];
  let msg = null;
  for (let attempt = 0; attempt < 2 && !msg; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 200,
        tools: [{ type: 'web_search_20250305', name: 'web_search', allowed_domains: STORE_SITES.filter(d => !blocked.includes(d)), max_uses: 1 }],
        messages: [{ role: 'user', content: `Run exactly one web search for the book page of: ${q}. Do not search again. Then reply only: done` }]
      })
    });
    if (r.ok) { msg = await r.json(); break; }
    // אתר שמנוע החיפוש לא יכול לגשת אליו: מסירים, זוכרים, ומנסים שוב
    const more = r.status === 400 ? blockedDomainsFrom(await r.text()).filter(d => !blocked.includes(d)) : [];
    if (!more.length) return [];
    blocked = [...blocked, ...more];
    await env.LIBRARY.put('blocked-domains', JSON.stringify(blocked));
  }
  if (!msg) return [];
  const out = [];
  for (const b of msg.content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => x && x.url && storeOf(x.url) && out.push({ url: x.url, title: x.title || '', site: storeOf(x.url) }));
  }
  return out;
}
async function handleStores(req, env, cors, ctx) {
  const p = new URL(req.url).searchParams;
  const title = (p.get('title') || '').slice(0, 150).trim(), author = (p.get('author') || '').slice(0, 80).trim();
  if (!title) return json({ error: 'missing' }, 400, cors);
  const cacheKey = new Request('https://stores-cache/' + encodeURIComponent(title + '|' + author));
  const cached = await caches.default.match(cacheKey);
  if (cached) return new Response(cached.body, { status: 200, headers: { ...cors, 'content-type': 'application/json', 'x-cache': 'hit' } });
  const q = author ? `${title} ${author}` : title;
  let found = [], via = 'direct';
  const pages = await Promise.all(STORE_SEARCH_URLS.map(f => f(title)).map(u => fetchHtml(u, ctx, 3600).then(h => h ? storeLinksFromHtml(h, u, title) : [])));
  pages.forEach(list => list.forEach(x => { if (!found.some(f => f.url === x.url)) found.push(x); }));
  if (!found.length) {
    via = 'search';
    found = (await storeSearchViaClaude(env, q)).filter(x => titleHas(x.title, title)).map(x => ({ ...x, title: cleanStoreTitle(x.title) }));
  }
  found = found.slice(0, 5);
  // פרטים מדף הספר עצמו (כריכה, תקציר, מחבר), אם אפשר להיכנס אליו
  await Promise.all(found.slice(0, 3).map(async (x) => {
    const html = await fetchHtml(x.url, ctx);
    if (!html) return;
    const c = checkPage(html, title, author);
    x.image = c.image || ''; x.description = c.description || ''; x.authorOk = c.authorOk;
  }));
  if (author) found = found.filter(x => x.authorOk !== false || !x.description);
  const body = JSON.stringify({ items: found, via });
  ctx.waitUntil(caches.default.put(cacheKey, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + (found.length ? 604800 : 43200) } })));
  return new Response(body, { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
}

// ---------- עבודות רקע (Durable Object): המלצה ממשיכה לרוץ בשרת גם כשהטלפון כבוי או עבר אפליקציה ----------
// האפליקציה שולחת את הבקשה, מקבלת מזהה, ובודקת מדי כמה שניות אם התשובה מוכנה. אחרי יום העבודה נמחקת.
const JOB_TURNS = 4;
async function anthropicOnce(body, env) {
  let blocked = (await env.LIBRARY.get('blocked-domains', 'json')) || [];
  const requested = body.tools;
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = { ...body, tools: sanitizeTools(requested, blocked) };
    if (!b.tools.length) delete b.tools;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(b)
    });
    const text = await r.text();
    if (r.ok) return JSON.parse(text);
    const more = r.status === 400 ? blockedDomainsFrom(text).filter(d => !blocked.includes(d)) : [];
    if (more.length && attempt < 2) { blocked = [...blocked, ...more]; await env.LIBRARY.put('blocked-domains', JSON.stringify(blocked)); continue; }
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).error.message || msg; } catch (e) { /* */ }
    const err = new Error(`(${r.status}) ${msg}`); err.status = r.status; throw err;
  }
  throw new Error('blocked domains');
}
export async function runJob(job, env, onTurn) {
  const { submit, ...body } = job;
  let messages = body.messages;
  const usage = [], hits = [];
  for (let turn = 0; turn < JOB_TURNS; turn++) {
    const msg = await anthropicOnce({ ...body, messages }, env);
    usage.push(msg.usage || {});
    (msg.content || []).forEach(b => {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => x && x.url && hits.push({ url: x.url, title: x.title || '' }));
    });
    if (msg.stop_reason === 'refusal') throw new Error('refusal');
    const sub = (msg.content || []).find(b => b.type === 'tool_use' && b.name === submit);
    if (sub) return { input: sub.input, usage, hits };
    if (msg.stop_reason === 'max_tokens') throw new Error('max_tokens');
    messages = [...messages, { role: 'assistant', content: msg.content }];
    if (msg.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: `Now call ${submit} with your final answer.` });
    if (onTurn) await onTurn(turn + 1);
  }
  throw new Error('did_not_finish');
}
export class AiJob {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/start') {
      await this.state.storage.put('job', await req.json());
      await this.state.storage.put('status', { status: 'running', at: Date.now(), turns: 0 });
      await this.state.storage.setAlarm(Date.now() + 10);
      return new Response('{"ok":true}');
    }
    const s = await this.state.storage.get('status');
    return new Response(JSON.stringify(s || { status: 'missing' }), { headers: { 'content-type': 'application/json' } });
  }
  async alarm() {
    const s = await this.state.storage.get('status');
    if (!s || s.status !== 'running') { await this.state.storage.deleteAll(); return; }   // ניקוי אחרי יום
    const job = await this.state.storage.get('job');
    try {
      const out = await runJob(job, this.env, (turns) => this.state.storage.put('status', { ...s, turns }));
      await this.state.storage.put('status', { status: 'done', at: Date.now(), ...out });
    } catch (e) {
      await this.state.storage.put('status', { status: 'error', at: Date.now(), error: String((e && e.message) || e), code: (e && e.status) || 0 });
    }
    await this.state.storage.delete('job');
    await this.state.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
  }
}
async function handleJobs(req, env, cors, path) {
  if (!env.JOBS) return json({ error: 'not_configured' }, 503, cors);
  if (req.method === 'POST' && path === '/jobs') {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 503, cors);
    const day = new Date().toISOString().slice(0, 10);
    const counterKey = 'ai-count:' + day;
    const used = parseInt((await env.LIBRARY.get(counterKey)) || '0', 10);
    if (used >= DAILY_AI_LIMIT) return json({ error: 'daily_limit' }, 429, cors);
    await env.LIBRARY.put(counterKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
    const job = {
      model: ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0],
      max_tokens: Math.min(Number(body.max_tokens) || 16000, 16000),
      system: body.system, messages: Array.isArray(body.messages) ? body.messages.slice(0, 4) : [], tools: body.tools,
      submit: String(body.submit || '').slice(0, 64)
    };
    if (body.thinking) job.thinking = { type: 'adaptive' };
    if (body.output_config && ['low', 'medium', 'high'].includes(body.output_config.effort)) job.output_config = { effort: body.output_config.effort };
    if (!job.submit || !job.messages.length) return json({ error: 'bad_request' }, 400, cors);
    const id = crypto.randomUUID();
    await env.JOBS.get(env.JOBS.idFromName(id)).fetch('https://job/start', { method: 'POST', body: JSON.stringify(job) });
    return json({ id }, 200, cors);
  }
  const m = /^\/jobs\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && m) {
    const r = await env.JOBS.get(env.JOBS.idFromName(m[1])).fetch('https://job/status');
    return new Response(r.body, { status: 200, headers: { ...cors, 'content-type': 'application/json' } });
  }
  return json({ error: 'not_found' }, 404, cors);
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
      if (path === '/ping') return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, sync: !!env.LIBRARY, gbooks: !!env.GOOGLE_BOOKS_KEY, nli: !!env.NLI_API_KEY, jobs: !!env.JOBS }, 200, cors);
      if (path === '/gbooks' && req.method === 'GET') return await handleGoogleBooks(req, env, cors, ctx);
      if (path === '/jobs' || path.startsWith('/jobs/')) return await handleJobs(req, env, cors, path);
      if (path === '/stores' && req.method === 'GET') return await handleStores(req, env, cors, ctx);
      if (path === '/nli' && req.method === 'GET') return await handleNli(req, env, cors, ctx);
      if (path === '/page' && req.method === 'GET') return await handlePage(req, cors, ctx);
      if (path === '/sync') return await handleSync(req, env, cors);
      if (path.startsWith('/v1/messages') && req.method === 'POST') return await handleAI(req, env, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      return json({ type: 'error', error: { type: 'worker_error', message: String(e && e.message || e) } }, 500, cors);
    }
  }
};
