// אפליקציית הקניות: בדיקות לשרת (מפענחים, מיזוג, נקודות קצה) ובדיקה בדפדפן עם שרת מדומה
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { parseShufersal, parseRami, parseHtmlProducts, mergeShop, handleShop } from '../worker/shop.js';
import { PRODUCTS } from '../shopping/products.js';

// ---------- רשימת הפתיחה ----------
assert.ok(PRODUCTS.length >= 40, 'products from the chat');
assert.equal(new Set(PRODUCTS.map(p => p.id)).size, PRODUCTS.length, 'unique ids');
assert.equal(new Set(PRODUCTS.map(p => p.name)).size, PRODUCTS.length, 'unique names');
assert.ok(PRODUCTS.every(p => p.count >= 3 && p.emoji && p.q), 'each appeared 3+ times and has an icon and a search term');

// ---------- מפענחים ----------
const sh = parseShufersal({ results: [
  { name: 'טופו טבעי 300 גרם', price: { value: 11.9 }, unitDescription: '300 גרם', url: '/online/he/p/P_1', images: [{ format: 'small', url: 'https://res.cloudinary.com/s.jpg' }, { format: 'medium', url: 'https://res.cloudinary.com/m.jpg' }] },
  { name: 'בלי מחיר', price: {} }] });
assert.deepEqual(sh, [{ name: 'טופו טבעי 300 גרם', price: 11.9, unit: '300 גרם', image: 'https://res.cloudinary.com/m.jpg', url: 'https://www.shufersal.co.il/online/he/p/P_1' }]);
const ra = parseRami({ data: [{ name: 'טופו', price: { price: '9.90' }, images: { small: '/product/1/small.jpg' } }] }, 'טופו');
assert.equal(ra[0].price, 9.9); assert.equal(ra[0].image, 'https://img.rami-levy.co.il/product/1/small.jpg');
const ld = parseHtmlProducts('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"טופו קרפור","image":["/i.jpg"],"url":"/p/2","offers":{"price":"10.50"}}]}</script>', 'https://www.carrefour.co.il/search?q=x');
assert.deepEqual(ld, [{ name: 'טופו קרפור', price: 10.5, unit: '', image: 'https://www.carrefour.co.il/i.jpg', url: 'https://www.carrefour.co.il/p/2' }]);
const emb = parseHtmlProducts('<script>window.__D={"items":[{"id":1,"name":"טופו חצי חינם","brand":"x","price":8.9},{"name":"English only","price":3}]}</script>', 'https://shop.hazi-hinam.co.il/search?q=x');
assert.deepEqual(emb.map(x => [x.name, x.price]), [['טופו חצי חינם', 8.9]]);
assert.deepEqual(parseShufersal(null), []); assert.deepEqual(parseHtmlProducts('', 'https://x.co.il'), []);

// ---------- מיזוג ----------
const m = mergeShop({ items: { a: { name: 'א', need: true, at: 5 }, b: { name: 'ב', at: 9 } }, prefs: {} },
  { items: { a: { name: 'א', need: false, at: 7 }, b: { name: 'ב', need: true, at: 3 }, c: { name: 'ג', deleted: true, at: 1 } }, prefs: { 'a|rami': { name: 'x', at: 1 } } });
assert.equal(m.items.a.need, false); assert.equal(m.items.b.need, undefined); assert.ok(m.items.c.deleted); assert.equal(m.prefs['a|rami'].name, 'x');

// ---------- נקודות קצה ----------
const kv = new Map();
const env = { LIBRARY: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); } } };
const cors = { 'Access-Control-Allow-Origin': 'https://yuvsaadon-coder.github.io' };
const call = (path, init) => handleShop(new Request('https://w.dev' + path, init), env, cors, new URL('https://w.dev' + path).pathname);
assert.equal((await call('/shop/list?h=BAD')).status, 400);
let r = await call('/shop/list?h=abcd1234', { method: 'PUT', body: JSON.stringify({ items: { tofu: { name: 'טופו', need: true, at: 10 } } }) });
assert.equal(r.status, 200);
r = await call('/shop/list?h=abcd1234', { method: 'PUT', body: JSON.stringify({ items: { tofu: { name: 'טופו', need: false, at: 4 }, eggs: { name: 'ביצים', need: true, at: 11 } } }) });
const merged = await r.json();
assert.equal(merged.items.tofu.need, true, 'older change does not win'); assert.equal(merged.items.eggs.need, true);
assert.equal((await call('/shop/list?h=abcd1234', { method: 'PUT', body: 'x'.repeat(400 * 1024) })).status, 413);

const orig = globalThis.fetch; const hosts = [];
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(u); hosts.push(url.hostname);
  if (url.hostname === 'www.shufersal.co.il') return Response.json({ results: [{ name: 'טופו', price: { value: 12 }, images: [] }] });
  if (url.hostname === 'www.rami-levy.co.il') { assert.equal(JSON.parse(o.body).q, 'טופו'); return Response.json({ data: [{ name: 'טופו', price: { price: 10 } }] }); }
  if (url.hostname === 'www.carrefour.co.il') return new Response('blocked', { status: 403 });
  return new Response('<html></html>');
};
r = await (await call('/shop/prices?q=' + encodeURIComponent('טופו'))).json();
assert.equal(r.chains.shufersal[0].price, 12); assert.equal(r.chains.rami[0].price, 10);
assert.deepEqual(r.chains.carrefour, []); assert.ok(r.errors.carrefour);
assert.equal(hosts.length, 4);
r = await (await call('/shop/prices?q=' + encodeURIComponent('טופו'))).json();
assert.ok(r.cached, 'second call comes from KV'); assert.equal(hosts.length, 4);
globalThis.fetch = orig;
console.log('shop worker: ok');

// ---------- בדפדפן ----------
const root = new URL('..', import.meta.url).pathname;
const TYPES = { html: 'text/html', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json', woff2: 'font/woff2' };
const http = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/Books\//, '/').replace(/\/$/, '/index.html');
  try { const body = await readFile(root + path.slice(1)); res.writeHead(200, { 'content-type': TYPES[path.split('.').pop()] || 'application/octet-stream' }); res.end(body); }
  catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(ok => http.listen(0, ok));
const BASE = `http://localhost:${http.address().port}/Books/shopping/`;

const server = { lists: {}, priceCalls: [] };
const PRICES = {   // מחיר לכל מוצר בכל רשת; קרפור לא מוצאת ביצים
  'ביצים L': { shufersal: 30, rami: 26, hazi: 25 }, 'טופו': { shufersal: 12, rami: 10, carrefour: 11, hazi: 13 }, 'עגבניות שרי': { shufersal: 9, rami: 8, carrefour: 10, hazi: 9 }
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function mock(ctx) {
  await ctx.route('https://books.yuvsaadon.workers.dev/**', async (route) => {
    const u = new URL(route.request().url());
    const h = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/shop/list') {
      const code = u.searchParams.get('h');
      if (route.request().method() === 'PUT') server.lists[code] = mergeShop(server.lists[code], JSON.parse(route.request().postData()));
      return route.fulfill({ json: server.lists[code] || { items: {}, prefs: {} }, headers: h });
    }
    if (u.pathname === '/shop/prices') {
      const q = u.searchParams.get('q'); server.priceCalls.push(q);
      const p = PRICES[q] || {};
      const chains = Object.fromEntries(['shufersal', 'rami', 'carrefour', 'hazi'].map(c => [c, p[c] ? [{ name: q + ' ' + c, price: p[c], image: c === 'rami' ? 'https://img.example/' + encodeURIComponent(q) + '.png' : '', url: '' }, { name: 'משהו אחר', price: 1 }] : []]));
      return route.fulfill({ json: { q, chains }, headers: h });
    }
    return route.fulfill({ status: 404, json: {}, headers: h });
  });
  await ctx.route('https://img.example/**', r => r.fulfill({ body: PNG, contentType: 'image/png' }));
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const phone = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
  await mock(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  return p;
};
const a = await phone();
await a.goto(BASE);
await a.getByRole('heading', { name: 'מה חסר בבית?' }).waitFor();
assert.equal(await a.locator('[data-toggle]').count(), PRODUCTS.length, 'all products as tiles');
for (const id of ['eggs', 'tofu', 'cherry']) await a.click(`[data-toggle="${id}"]`);
assert.equal(await a.locator('#count').textContent(), '3');
// מוצר חדש מהחיפוש
await a.fill('#q', 'במבה');
await a.getByRole('button', { name: 'הוספת "במבה"' }).click();
assert.equal(await a.locator('#editor input[name=emoji]').inputValue(), '🍿', 'emoji guessed from the name');
await a.locator('#editor').getByRole('button', { name: 'שמירה' }).click();
await a.waitForFunction(() => document.querySelector('#count').textContent === '4');

// הרשימה
await a.getByRole('button', { name: /הרשימה/ }).click();
await a.getByRole('heading', { name: 'רשימת קניות' }).waitFor();
assert.equal(await a.locator('.list li').count(), 4);
await a.locator('li', { hasText: 'ביצים' }).getByRole('button', { name: 'יותר' }).click();
assert.equal(await a.locator('li', { hasText: 'ביצים' }).locator('.qty b').textContent(), '2');

// טלפון שני עם קישור השיתוף רואה את אותה רשימה
await a.waitForTimeout(1600);
const code = await a.evaluate(() => JSON.parse(localStorage.getItem('shop-state-v1')).h);
assert.ok(server.lists[code] && server.lists[code].items.tofu.need, 'list reached the server');
const b = await phone();
await b.goto(BASE + '?h=' + code);
await b.waitForFunction(() => document.querySelector('#count').textContent === '4');
assert.ok(!(await b.evaluate(() => location.search)), 'code removed from the address bar');
await b.locator('.tile', { hasText: 'במבה' }).waitFor();

// השוואת מחירים (בלי במבה – אין לה מחיר)
await a.getByRole('button', { name: /איפה זול/ }).click();
await a.getByRole('button', { name: 'השוואת מחירים' }).click();
await a.locator('.rec').waitFor();
// סל משותף (טופו + שרי, כי קרפור בלי ביצים): רמי 10+8 = 18; ההמלצה רמי לוי (מצאה הכול חוץ מבמבה)
assert.match(await a.locator('.rec').textContent(), /רמי לוי/);
const best = await a.locator('.chain.best').textContent();
assert.match(best, /₪48/, 'common basket 18 + delivery 30'); assert.match(best, /נמצאו 3 מתוך 4/);
// ביצים ×2 ברמי לוי = 52, והזול בשורה מסומן
assert.match(await a.locator('tr', { hasText: 'ביצים' }).locator('td.min').textContent(), /₪50/, 'hazi 25×2 is the cheapest row');
assert.match(await a.locator('tr', { hasText: 'במבה' }).textContent(), /לא נמצא/);
if (process.env.SHOTS) await a.screenshot({ path: `${process.env.SHOTS}/shop-prices.png`, fullPage: true });
// תמונה אמיתית מהחנות נשמרה למוצר
assert.ok(await a.locator('tr', { hasText: 'טופו' }).locator('.art.img img').count(), 'store image used');
// בחירת מוצר אחר ברשת
await a.locator('select[data-pref="tofu|shufersal"]').selectOption('משהו אחר');
assert.match(await a.locator('tr', { hasText: 'טופו' }).locator('td').first().textContent(), /₪1/);
// דמי משלוח מההגדרות משנים את הסכום
await a.getByRole('button', { name: /הגדרות/ }).click();
await a.locator('input[data-fee="rami"]').fill('0');
await a.locator('input[data-fee="rami"]').dispatchEvent('change');
await a.getByRole('button', { name: /איפה זול/ }).click();
assert.match(await a.locator('.chain.best').textContent(), /רמי לוי[\s\S]*₪18/);

// סיום קניות: מסמנים מה נקנה ומורידים
await a.getByRole('button', { name: /הרשימה/ }).click();
await a.locator('li', { hasText: 'טופו' }).locator('input[type=checkbox]').check();
await a.getByRole('button', { name: /סיימתי/ }).click();
assert.equal(await a.locator('#count').textContent(), '3');
// עריכה ומחיקה של מוצר, והחזרה מההגדרות
await a.locator('li', { hasText: 'במבה' }).getByRole('button', { name: 'עריכה' }).click();
await a.locator('#editor').getByRole('button', { name: 'מחיקה' }).click();
await a.waitForFunction(() => document.querySelector('#count').textContent === '2');   // close של dialog מגיע באיחור
await a.getByRole('button', { name: /הגדרות/ }).click();
await a.locator('details summary').click();
await a.getByRole('button', { name: 'החזרה' }).click();
assert.ok(await a.locator('.compact li', { hasText: 'במבה' }).count());
// שרת לא זמין: האפליקציה ממשיכה לעבוד מהטלפון
await a.context().unroute('https://books.yuvsaadon.workers.dev/**');
await a.context().route('https://books.yuvsaadon.workers.dev/**', r => r.abort());
await a.getByRole('button', { name: /מה חסר/ }).click();
await a.click('[data-toggle="mushrooms"]');
await a.waitForFunction(() => document.querySelector('#sync').dataset.s === 'off');
assert.equal(await a.locator('#count').textContent(), '3');
if (process.env.SHOTS) for (const [v, n] of [['home', 'home'], ['list', 'list'], ['compare', 'compare']]) { await b.evaluate((v) => document.querySelector(`nav [data-v="${v}"]`).click(), v); await b.waitForTimeout(300); await b.screenshot({ path: `${process.env.SHOTS}/shop-${n}.png`, fullPage: true }); }
assert.deepEqual(errors, []);
await browser.close();
http.close();
console.log('shop app: ok');
