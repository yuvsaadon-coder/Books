// אפליקציית הקניות (shopping/): השוואת מחירים ברשתות שעושות משלוחים לירושלים, וסנכרון הרשימה בין הטלפונים
//   GET  /shop/prices?q=טופו        מחירים מכל רשת (מטמון KV ליומיים, "לא נמצא" לשש שעות)
//   GET  /shop/list?h=<קוד בית>      הרשימה המשותפת
//   PUT  /shop/list?h=<קוד בית>      מיזוג: לכל מוצר נשמרת הגרסה עם at המאוחר יותר
//
// כתובות ה-API של הרשתות לא נבדקו מול האתרים האמיתיים (סביבת הענן חוסמת אותם).
// שופרסל ורמי לוי: נקודות ה-JSON שהאתרים עצמם משתמשים בהן. קרפור וחצי חינם: דף החיפוש + JSON-LD / JSON מוטמע.

export const CHAINS = {
  shufersal: { name: 'שופרסל', search: (q) => 'https://www.shufersal.co.il/online/he/search?text=' + encodeURIComponent(q) },
  rami: { name: 'רמי לוי', search: (q) => 'https://www.rami-levy.co.il/he/online/search?q=' + encodeURIComponent(q) },
  carrefour: { name: 'קרפור', search: (q) => 'https://www.carrefour.co.il/search?q=' + encodeURIComponent(q) },
  hazi: { name: 'חצי חינם', search: (q) => 'https://shop.hazi-hinam.co.il/search?q=' + encodeURIComponent(q) }
};
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36', 'accept-language': 'he-IL,he;q=0.9' };
const MAX_RESULTS = 6;
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const abs = (u, base) => { try { return u ? new URL(u, base).href : ''; } catch (e) { return ''; } };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

// ---------- מפענחים לכל רשת (מיוצאים לבדיקות) ----------
export function parseShufersal(data) {
  const list = Array.isArray(data && data.results) ? data.results : [];
  return list.map(x => {
    const img = (Array.isArray(x.images) ? (x.images.find(i => i.format === 'medium') || x.images[0]) : null) || {};
    return { name: clean(x.name), price: num(x.price && (x.price.value ?? x.price.formattedValue)), unit: clean(x.unitDescription || x.size || ''),
      image: abs(img.url, 'https://www.shufersal.co.il'), url: abs(x.url, 'https://www.shufersal.co.il/online/he/') };
  }).filter(x => x.name && x.price).slice(0, MAX_RESULTS);
}
export function parseRami(data, q) {
  const list = Array.isArray(data && data.data) ? data.data : [];
  return list.map(x => {
    const p = x.price && typeof x.price === 'object' ? x.price.price : x.price;
    const im = x.images && (x.images.small || x.images.original);
    return { name: clean(x.name), price: num(p), unit: clean(x.gs && x.gs.Net_Content && x.gs.Net_Content.text || ''),
      image: im ? abs(im, 'https://img.rami-levy.co.il') : '', url: CHAINS.rami.search(q) };
  }).filter(x => x.name && x.price).slice(0, MAX_RESULTS);
}
// דף חיפוש כללי: מוצרים מ-JSON-LD, ואם אין – זוגות name/price מתוך JSON שמוטמע בדף (Next.js וכדומה)
export function parseHtmlProducts(html, base) {
  const out = [];
  const add = (o) => {
    const offer = Array.isArray(o.offers) ? o.offers[0] : o.offers;
    const price = num(offer && (offer.price ?? offer.lowPrice));
    const image = Array.isArray(o.image) ? o.image[0] : (o.image && o.image.url) || o.image;
    if (o.name && price) out.push({ name: clean(o.name), price, unit: '', image: abs(typeof image === 'string' ? image : '', base), url: abs(o.url, base) || base });
  };
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const t = o['@type'];
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) add(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  for (const m of String(html || '').matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch (e) { /* JSON לא תקין */ }
  }
  if (!out.length) {
    const re = /"name"\s*:\s*"([^"]{2,100})"[^{}]{0,400}?"price"\s*:\s*"?(\d+(?:\.\d+)?)/g;
    for (const m of String(html || '').matchAll(re)) {
      let name; try { name = JSON.parse('"' + m[1] + '"'); } catch (e) { name = m[1]; }
      if (/[֐-׿]/.test(name)) out.push({ name: clean(name), price: num(m[2]), unit: '', image: '', url: base });
    }
  }
  const seen = new Set();
  return out.filter(x => x.price && !seen.has(x.name) && seen.add(x.name)).slice(0, MAX_RESULTS);
}

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { ...UA, accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
async function getHtml(url) {
  const r = await fetch(url, { headers: { ...UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.text();
}
export const FETCHERS = {
  shufersal: async (q) => parseShufersal(await getJson('https://www.shufersal.co.il/online/he/search/results?q=' + encodeURIComponent(q) + '&limit=10',
    { headers: { 'x-requested-with': 'XMLHttpRequest' } })),
  // 331: הסניף המקוון (המחירים באתר זהים לכל הארץ)
  rami: async (q) => parseRami(await getJson('https://www.rami-levy.co.il/api/catalog', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q, aggs: 1, store: '331' }) }), q),
  carrefour: async (q) => parseHtmlProducts(await getHtml(CHAINS.carrefour.search(q)), CHAINS.carrefour.search(q)),
  hazi: async (q) => parseHtmlProducts(await getHtml(CHAINS.hazi.search(q)), CHAINS.hazi.search(q))
};

export async function shopPrices(env, q, { fresh = false } = {}) {
  const key = 'shopq:' + q;
  if (!fresh && env.LIBRARY) { const hit = await env.LIBRARY.get(key, 'json'); if (hit) return { ...hit, cached: true }; }
  const chains = {}, errors = {};
  await Promise.all(Object.keys(CHAINS).map(async (c) => {
    try { chains[c] = await FETCHERS[c](q); } catch (e) { chains[c] = []; errors[c] = String(e && e.message || e).slice(0, 80); }
  }));
  const out = { q, at: Date.now(), chains, errors };
  const found = Object.values(chains).some(l => l.length);
  if (env.LIBRARY) await env.LIBRARY.put(key, JSON.stringify(out), { expirationTtl: found ? 172800 : 21600 });
  return out;
}

// ---------- הרשימה המשותפת ----------
const MAX_LIST_BYTES = 300 * 1024;
// מיזוג לפי מוצר: הגרסה עם at המאוחר יותר מנצחת (גם מחיקה, deleted: true)
export function mergeShop(a, b) {
  const items = { ...((a && a.items) || {}) };
  for (const [id, it] of Object.entries((b && b.items) || {})) {
    if (!it || typeof it !== 'object') continue;
    if (!items[id] || (Number(it.at) || 0) > (Number(items[id].at) || 0)) items[id] = it;
  }
  const prefs = { ...((a && a.prefs) || {}) };
  for (const [k, v] of Object.entries((b && b.prefs) || {})) if (!prefs[k] || (Number(v.at) || 0) > (Number(prefs[k].at) || 0)) prefs[k] = v;
  return { items, prefs };
}

export async function handleShop(req, env, cors, path) {
  const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
  const p = new URL(req.url).searchParams;
  if (path === '/shop/prices' && req.method === 'GET') {
    const q = clean(p.get('q')).slice(0, 60);
    if (!q) return json({ error: 'missing' }, 400);
    return json(await shopPrices(env, q, { fresh: p.get('fresh') === '1' }));
  }
  if (path === '/shop/list') {
    const h = p.get('h') || '';
    if (!/^[a-z0-9]{8,32}$/.test(h)) return json({ error: 'bad_household' }, 400);
    if (!env.LIBRARY) return json({ error: 'no_kv' }, 503);
    const key = 'shoplist:' + h;
    const cur = (await env.LIBRARY.get(key, 'json')) || { items: {}, prefs: {} };
    if (req.method === 'GET') return json(cur);
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX_LIST_BYTES) return json({ error: 'too_large' }, 413);
      let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const next = mergeShop(cur, body);
      if (JSON.stringify(next).length > MAX_LIST_BYTES) return json({ error: 'too_large' }, 413);
      await env.LIBRARY.put(key, JSON.stringify(next));
      return json(next);
    }
    return json({ error: 'method' }, 405);
  }
  return json({ error: 'not_found' }, 404);
}
