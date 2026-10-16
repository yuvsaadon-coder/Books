// בדיקות יחידה לשרת: הכלים שנשלחים ל-Anthropic
import assert from 'node:assert/strict';
{
  const { ratingFromHtml, endpointKey } = await import('../worker/worker.js');
  const gr = '<script type="application/ld+json">{"@type":"Book","name":"x","aggregateRating":{"@type":"AggregateRating","ratingValue":"3.84","ratingCount":12045,"bestRating":5}}</script>';
  assert.deepEqual(ratingFromHtml(gr), { value: 3.84, count: 12045, best: 5 });
  assert.equal(ratingFromHtml('<p>no rating</p>'), null);
  assert.equal((await endpointKey('https://fcm.googleapis.com/fcm/send/abc')).length, 32);
  console.log('worker reviews rating + notice key: ok');
}
{
  // ביקורות: רק קישורים שהופיעו בתוצאות החיפוש נשמרים; קישור מומצא נזרק
  const { findReviews } = await import('../worker/worker.js');
  const orig = globalThis.fetch; let body = null;
  globalThis.fetch = async (u, o) => { body = JSON.parse(o.body); return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://www.goodreads.com/book/show/1', title: 'x' }, { url: 'https://www.haaretz.co.il/literature/2', title: 'y' }] },
    { type: 'tool_use', name: 'submit_reviews', input: { reviews: [
      { url: 'https://www.haaretz.co.il/literature/2', summary_he: 'המבקר משבח את הכתיבה.' }, { url: 'https://www.haaretz.co.il/invented', summary_he: 'מומצא' }],
      rating: 4.1, rating_count: 900, rating_url: 'https://www.goodreads.com/book/show/1' } }] }), { status: 200 }); };
  const env = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async () => null } };
  const out = await findReviews(env, { title: 'יש ואין', author: 'המינגוויי', original: 'To Have and Have Not' });
  globalThis.fetch = orig;
  assert.deepEqual(out.reviews.map(r => r.url), ['https://www.haaretz.co.il/literature/2']);
  assert.equal(out.rating.value, 4.1); assert.equal(out.rating.site, 'goodreads.com');
  assert.ok(body.tools.some(t => t.name === 'submit_reviews') && body.messages[0].content.includes('To Have and Have Not'));
  console.log('worker reviews search: ok');
}
import { sanitizeTools } from '../worker/worker.js';
const tools = sanitizeTools([
  { type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' },
  { name: 'submit_x', input_schema: { type: 'object' } }, { type: 'code_execution_20260521', name: 'code_execution' }
]);
assert.deepEqual(tools.map(t => t.name), ['web_search', 'web_fetch', 'submit_x'], 'only web tools + app tools pass');
const ws = tools[0];
assert.ok(Array.isArray(ws.allowed_domains) && ws.allowed_domains.includes('e-vrit.co.il'));
assert.equal(ws.user_location, undefined, 'user_location must not be sent (IL is rejected by the API)');
assert.ok(tools[1].allowed_domains.length > 0);
// האפליקציה יכולה לצמצם את האתרים ואת מספר החיפושים, אבל לא להרחיב
const narrow = sanitizeTools([{ type: 'web_search_20260209', name: 'web_search', allowed_domains: ['e-vrit.co.il', 'evil.example'], max_uses: 99 }])[0];
assert.deepEqual(narrow.allowed_domains, ['e-vrit.co.il']);
assert.equal(narrow.max_uses, 5);
assert.equal(sanitizeTools([{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }])[0].max_uses, 2);
assert.ok(sanitizeTools([{ type: 'web_search_20260209', name: 'web_search', allowed_domains: ['evil.example'] }])[0].allowed_domains.length > 5, 'unknown-only list falls back to the full trusted list');
import { parseNli, nliPerson } from '../worker/worker.js';
assert.equal(nliPerson('אספדל, תומס, 1961- מחבר'), 'תומס אספדל');
assert.equal(nliPerson('Espedal, Tomas, 1961- author'), 'Tomas Espedal');
const DC = 'http://purl.org/dc/elements/1.1/';
const parsed = parseNli([{ [DC + 'recordid']: [{ '@value': '990012345670205171' }], [DC + 'title']: [{ '@value': 'נגד הטבע / תומס אספדל ; מנורווגית: דנה כספי' }],
  [DC + 'creator']: [{ '@value': 'אספדל, תומס, 1961- מחבר' }], [DC + 'date']: [{ '@value': '2023' }], [DC + 'identifier']: [{ '@value': '978-965-7759-12-3' }] }]);
assert.equal(parsed[0].title, 'נגד הטבע'); assert.deepEqual(parsed[0].authors, ['תומס אספדל']); assert.equal(parsed[0].year, '2023');
assert.deepEqual(parsed[0].isbns, ['9789657759123']); assert.ok(parsed[0].link.includes('990012345670205171'));
assert.deepEqual(parseNli({ total_results: 0 }), []);
import { storeLinksFromHtml, cleanStoreTitle, titleHas } from '../worker/worker.js';
assert.equal(cleanStoreTitle('נגד הטבע - תומס אספדל | עברית'), 'נגד הטבע');
assert.ok(titleHas('ספר: נגד הטבע / תומס אספדל', 'נגד הטבע')); assert.ok(!titleHas('הטבע של הדברים', 'נגד הטבע'));
const links = storeLinksFromHtml('<a href="/cart">עגלה</a><a href="/catalogsearch/result?q=x">נגד הטבע</a><a href="/nged-hateva-123"><span>נגד הטבע</span></a><a href="https://evil.example/x">נגד הטבע</a><a href="/other">ספר אחר</a>',
  'https://www.steimatzky.co.il/catalogsearch/result/?q=x', 'נגד הטבע');
assert.deepEqual(links, [{ url: 'https://www.steimatzky.co.il/nged-hateva-123', title: 'נגד הטבע', site: 'steimatzky.co.il' }]);
console.log('worker: ok');
import { blockedDomainsFrom } from '../worker/worker.js';
assert.deepEqual(blockedDomainsFrom(`{"type":"error","error":{"type":"invalid_request_error","message":"The following domains are not accessible to our user agent: ['newyorker.com', 'nytimes.com', 'theguardian.com']. Read more: https://support"}}`), ['newyorker.com', 'nytimes.com', 'theguardian.com']);
assert.deepEqual(blockedDomainsFrom('{"error":{"message":"other"}}'), []);
assert.ok(!sanitizeTools([{ type: 'web_search_20260209', name: 'web_search' }], ['goodreads.com'])[0].allowed_domains.includes('goodreads.com'));
console.log('worker blocked-domain retry: ok');
// סבב מלא: Anthropic דוחה פעם אחת בגלל אתר חסום → השרת מסיר אותו, זוכר, ומצליח בניסיון השני
import worker from '../worker/worker.js';
// בקשות לשרת נשלחות בשם משתמש מחובר (מפתח כניסה בדיקה)
const TEST_TOKEN = 'a'.repeat(64);
const authed = (req, env, ctx) => {
  const h = new Headers(req.headers); h.set('Authorization', 'Bearer ' + TEST_TOKEN);
  const get0 = env.LIBRARY.get;
  const lib = { ...env.LIBRARY, get: async (k, t) => k === 'sess:' + TEST_TOKEN ? (t === 'json' ? { pid: 'tester', exp: Date.now() + 1e9 } : JSON.stringify({ pid: 'tester' })) : get0(k, t) };
  return worker.fetch(new Request(req, { headers: h }), { ...env, LIBRARY: lib }, ctx);
};
const kv = new Map();
const env = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); } } };
const sent = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); sent.push(body);
  if (sent.length === 1) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: "The following domains are not accessible to our user agent: ['goodreads.com']." } }), { status: 400 });
  return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
};
const res = await authed(new Request('https://w/v1/messages', { method: 'POST', headers: { origin: 'https://yuvsaadon-coder.github.io' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages: [] }) }), env, { waitUntil() {} });
assert.equal(res.status, 200);
assert.equal(sent.length, 2);
assert.ok(sent[0].tools[0].allowed_domains.includes('goodreads.com') && !sent[1].tools[0].allowed_domains.includes('goodreads.com'));
assert.deepEqual(JSON.parse(kv.get('blocked-domains')), ['goodreads.com']);
console.log('worker retry round-trip: ok');
import { checkPage } from '../worker/worker.js';
const page = `<html><head><title>העיר וחומתה החמקמקה - הרוקי מורקמי | עברית</title>
<meta property="og:title" content="העיר וחומתה החמקמקה"><meta property="og:image" content="https://www.e-vrit.co.il/img/1.jpg">
<meta name="description" content="העיר, שספק נוצרה בדמיונם של השניים, היא מקום קודר ולירי"></head><body><h1>הָעִיר וְחוֹמָתָהּ הַחֲמַקְמַקָּה</h1><a>הרוקי מורקמי</a></body></html>`;
const ok = checkPage(page, 'העיר וחומתה החמקמקה', 'הרוקי מורקמי');
assert.ok(ok.ok); assert.equal(ok.image, 'https://www.e-vrit.co.il/img/1.jpg'); assert.ok(ok.description.startsWith('העיר'));
assert.equal(checkPage(page, 'ספר אחר לגמרי', 'הרוקי מורקמי').ok, false);
assert.equal(checkPage(page, 'העיר וחומתה החמקמקה', 'עמוס עוז').ok, false);
console.log('worker page verification: ok');
// סבב מלא של /stores: דפי החיפוש של החנויות לא נגישים → חיפוש אחד מוגבל לחנויות דרך Haiku → רק תוצאות מהחנויות ששמן תואם
{
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url) ? new Response(store.get(r.url)) : undefined, put: async (r, res) => { store.set(r.url, await res.text()); } } };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      assert.equal(body.tools[0].max_uses, 1); assert.ok(['e-vrit.co.il', 'steimatzky.co.il', 'booknet.co.il', 'am-oved.co.il', '9livespress.com'].every(d => body.tools[0].allowed_domains.includes(d)));
      return new Response(JSON.stringify({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://www.e-vrit.co.il/Product/1/נגד_הטבע', title: 'נגד הטבע - תומס אספדל | עברית' },
        { type: 'web_search_result', url: 'https://www.e-vrit.co.il/Product/2/x', title: 'ספר אחר לגמרי' }] }, { type: 'text', text: 'done' }] }), { status: 200 });
    }
    return new Response('blocked', { status: 403 });
  };
  const envS = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async () => null, put: async () => {} } };
  const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
  const res = await authed(new Request('https://w/stores?title=' + encodeURIComponent('נגד הטבע') + '&author=' + encodeURIComponent('תומס אספדל'), { headers: { Origin: 'https://yuvsaadon-coder.github.io' } }), envS, ctx);
  const j = await res.json();
  assert.equal(j.via, 'search');
  assert.deepEqual(j.items.map(x => [x.title, x.site]), [['נגד הטבע', 'e-vrit.co.il']]);
  await Promise.all(waits);
  const n = calls.length;
  const again = await (await authed(new Request('https://w/stores?title=' + encodeURIComponent('נגד הטבע') + '&author=' + encodeURIComponent('תומס אספדל')), envS, ctx)).json();
  assert.equal(again.items.length, 1); assert.equal(calls.length, n, 'second call served from cache');
  console.log('worker store search: ok');
}
// עבודת רקע: pause_turn ממשיך, סבב בלי הגשה מקבל תזכורת, והתוצאה היא הקלט של כלי ההגשה
{
  const { runJob } = await import('../worker/worker.js');
  const replies = [
    { stop_reason: 'pause_turn', content: [{ type: 'thinking', thinking: 'x' }], usage: { input_tokens: 10, output_tokens: 5 } },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }], usage: { input_tokens: 10, output_tokens: 5 } },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_recommendations', input: { recommendations: [1] } }], usage: { input_tokens: 10, output_tokens: 5 } }
  ];
  const sentBodies = [];
  globalThis.fetch = async (url, init) => { sentBodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(replies.shift()), { status: 200 }); };
  const envJ = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async () => null, put: async () => {} } };
  const out = await runJob({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'submit_recommendations', input_schema: { type: 'object' } }], submit: 'submit_recommendations' }, envJ);
  assert.deepEqual(out.input, { recommendations: [1] }); assert.equal(out.usage.length, 3);
  assert.deepEqual(sentBodies[1].messages.map(m => m.role), ['user', 'assistant'], 'pause_turn continues without a nudge');
  assert.deepEqual(sentBodies[2].messages.map(m => m.role), ['user', 'assistant', 'assistant', 'user'], 'no submission → nudge');
  assert.ok(!('submit' in sentBodies[0]), 'internal field is not sent to Anthropic');
  console.log('worker background job: ok');
}
// זמינות + תקציר: מאגרים → סטימצקי לפי ISBN (דף שמכיל את ה-ISBN) → תקציר עברי מהחנות כי במאגר יש רק אנגלית → מטמון 4 ימים
{
  const { bookInfo, pageHasIsbn } = await import('../worker/worker.js');
  assert.ok(pageHasIsbn('<span>ISBN: 978-965-00-0002-8</span>', '9789650000028'));
  assert.ok(!pageHasIsbn('<span>ISBN: 978-965-00-0003-5</span>', '9789650000028'));
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url) ? new Response(store.get(r.url)) : undefined, put: async (r, res) => { store.set(r.url, await res.text()); } } };
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    if (url.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify({ items: [{ volumeInfo: { title: 'יש ואין', authors: ['ארנסט המינגוויי'], description: 'Harry Morgan runs contraband.', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789650000028' }] }, saleInfo: { isEbook: false } }] }));
    if (url.startsWith('https://openlibrary.org/')) return new Response(JSON.stringify({ docs: [] }));
    if (url.startsWith('https://www.steimatzky.co.il/catalogsearch')) return new Response('<a href="/yesh-veein-123">יש ואין</a><a href="/cart">עגלה</a>');
    if (url === 'https://www.steimatzky.co.il/yesh-veein-123') return new Response('<html><head><meta property="og:title" content="יש ואין"><meta property="og:description" content="הארי מורגן, דייג מקי ווסט, נאלץ להבריח סחורות כדי לפרנס את משפחתו בשנות השפל הגדול, ונקלע לעולם מסוכן."></head><body>יש ואין ארנסט המינגוויי ISBN 978-965-00-0002-8</body></html>');
    return new Response('blocked', { status: 403 });
  };
  const kv = new Map();
  const envB = { LIBRARY: { get: async (k, t) => kv.has(k) ? JSON.parse(kv.get(k)) : null, put: async (k, v, o) => { kv.set(k, v); assert.equal(o.expirationTtl, 14 * 86400); } } };
  const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
  const info = await bookInfo(envB, ctx, { isbn: '', title: 'יש ואין', author: 'ארנסט המינגוויי' });
  assert.equal(info.isbn, '9789650000028'); assert.ok(info.found);
  assert.deepEqual(info.urls, [{ site: 'steimatzky.co.il', url: 'https://www.steimatzky.co.il/yesh-veein-123', kinds: ['print'] }]);
  assert.ok(info.available.print && !info.available.ebook);
  assert.ok(info.synopsis.startsWith('הארי מורגן') && info.synopsisSource === 'steimatzky.co.il', 'Hebrew synopsis from the store because the catalogue has only English');
  assert.ok(!calls.some(u => u.includes('api.anthropic.com')), 'no paid search when the store page is found directly');
  // המטמון: הבקשה השנייה לא יוצאת לרשת
  const res1 = await (await authed(new Request('https://w/bookinfo?title=' + encodeURIComponent('יש ואין') + '&author=' + encodeURIComponent('ארנסט המינגוויי')), envB, ctx)).json();
  await Promise.all(waits);
  const n = calls.length;
  const res2 = await (await authed(new Request('https://w/bookinfo?title=' + encodeURIComponent('יש ואין') + '&author=' + encodeURIComponent('ארנסט המינגוויי')), envB, ctx)).json();
  assert.equal(calls.length, n); assert.ok(res2.cached); assert.equal(res2.isbn, res1.isbn);
  console.log('worker book info: ok');
}
// תקציר וקישורים גם כשהספר נמצא במאגרים אבל החיפוש לפי ISBN לא החזיר דף: חיפוש לפי שם בחנויות, ותקציר מלא מ-JSON-LD
{
  const { bookInfo, quoteInPage, claudeBookPage } = await import('../worker/worker.js');
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url) ? new Response(store.get(r.url)) : undefined, put: async (r, res) => { store.set(r.url, await res.text()); } } };
  const blurb = 'בעיר קטנה על שפת הים חיה משפחה אחת שכל חבריה שומרים סוד. כשהבת הצעירה חוזרת הביתה אחרי עשרים שנה, הסוד מתחיל להיסדק, ואיתו כל מה שחשבו שהם יודעים זה על זה.';
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify({ items: [{ volumeInfo: { title: 'הבית על החוף', authors: ['Anna Author'], description: '', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789650000555' }] }, saleInfo: {} }] }));
    if (url.startsWith('https://openlibrary.org/')) return new Response(JSON.stringify({ docs: [] }));
    if (url.startsWith('https://www.booknet.co.il/') && url.includes('?q=' + encodeURIComponent('הבית על החוף'))) return new Response('<a href="/product/habait-al-hahof">הבית על החוף</a>');
    if (url === 'https://www.booknet.co.il/product/habait-al-hahof') return new Response(`<html><head><meta property="og:description" content="רומן משפחתי"><script type="application/ld+json">{"@type":"Product","name":"הבית על החוף","description":"${blurb}"}</script></head><body>הבית על החוף</body></html>`);
    return new Response('blocked', { status: 403 });
  };
  const env = { LIBRARY: { get: async () => null, put: async () => {} } };
  const info = await bookInfo(env, { waitUntil() {} }, { isbn: '', title: 'הבית על החוף', author: 'Anna Author' });
  assert.ok(info.found);
  assert.deepEqual(info.urls.map(u => u.url), ['https://www.booknet.co.il/product/habait-al-hahof'], 'store link although the catalogue already found the book');
  assert.equal(info.synopsis, blurb, 'full blurb from JSON-LD, not the short og:description');

  // כשהחנויות חוסמות את השרת: Claude מחפש וקורא את הדף; קישור מומצא ותקציר שלא מופיע בדף נזרקים
  assert.ok(quoteInPage(blurb, 'כותרת ' + blurb + ' עוד טקסט')); assert.ok(!quoteInPage('משפט שלא קיים בדף בכלל אבל ארוך מספיק כדי להיבדק כראוי כאן ועכשיו', blurb));
  const mk = (synopsis, pages) => ({ stop_reason: 'tool_use', content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף', title: 'הבית על החוף - אנה | עברית' }] },
    { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף', content: { type: 'document', title: 'הבית על החוף', source: { type: 'text', data: 'הבית על החוף\nתקציר: ' + blurb + '\nמחיר 49' } } } },
    { type: 'tool_use', name: 'submit_book_page', input: { pages, synopsis_he: synopsis, synopsis_url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף' } }] });
  let reply, body;
  globalThis.fetch = async (url, init) => { if (String(url).includes('api.anthropic.com')) { body = JSON.parse(init.body); return new Response(JSON.stringify(reply)); } return new Response('blocked', { status: 403 }); };
  const envC = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async () => null, put: async () => {} } };
  reply = mk(blurb, [{ url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף' }, { url: 'https://www.e-vrit.co.il/Product/999/invented' }]);
  const d = await claudeBookPage(envC, { title: 'הבית על החוף', author: 'אנה', isbn: '' });
  assert.deepEqual(d.pages.map(p => p.url), ['https://www.e-vrit.co.il/Product/123/הבית_על_החוף'], 'invented URL dropped');
  assert.equal(d.synopsis, blurb); assert.equal(d.synopsisSite, 'e-vrit.co.il');
  assert.ok(body.tools.some(t => t.type === 'web_fetch_20250910' && t.allowed_domains.includes('e-vrit.co.il')) && body.model === 'claude-haiku-4-5-20251001');
  reply = mk('תקציר שהמודל כתב בעצמו ולא מופיע בדף שנקרא, ולכן אסור להציג אותו למשתמש בשום מצב', [{ url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף' }]);
  assert.equal((await claudeBookPage(envC, { title: 'הבית על החוף', author: '', isbn: '' })).synopsis, '', 'text not in the fetched page is rejected');
  // בתוך bookInfo: כשהכול חסום, השלב הזה מביא תקציר וקישור
  reply = mk(blurb, [{ url: 'https://www.e-vrit.co.il/Product/123/הבית_על_החוף' }]);
  const info2 = await bookInfo(envC, { waitUntil() {} }, { isbn: '', title: 'הבית על החוף', author: 'אנה' });
  assert.equal(info2.synopsis, blurb); assert.equal(info2.urls[0].site, 'e-vrit.co.il'); assert.ok(info2.found && info2.available.ebook);
  console.log('worker book details (store search, JSON-LD, verified Claude fallback): ok');
}
// ההצעות הדו-שבועיות: משתמש קיים מקבל מיד, משתמש חדש יום אחרי, רק ספרים שאומתו ולא הוצעו/נקראו, והתראה נשלחת
{
  const { runDigests, vapidAuth } = await import('../worker/worker.js');
  const kv = new Map();
  const envD = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); } } };
  const now = Date.now();
  kv.set('state', JSON.stringify({ rev: 3, data: { profiles: [{ id: 'old', name: 'יובל', createdAt: now - 99 * 86400000 }], deleted: {}, dbs: {
    old: { books: [{ title: 'מיכאל שלי', authors: ['עמוס עוז'], rating: 5, status: 'read' }], history: [{ recs: [{ title: 'סומכי' }] }], rejections: [], settings: { address: 'm' } } } } }));
  kv.set('push:old', JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }]));
  const sent = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      if (!(body.tools || []).some(t => t.name === 'submit_digest')) return new Response(JSON.stringify({ content: [] }));   // חיפוש בחנויות: אין תוצאות
      sent.push(body);
      assert.ok(body.messages[0].content.includes('סומכי'), 'earlier suggestions are excluded');
      assert.ok(body.system.includes('masculine'));
      const books = [{ title_he: 'סיפור פשוט', title_original: '', author: 'עגנון', isbn: '', why: 'כי כן.' }, { title_he: 'ספר מומצא לגמרי', title_original: '', author: 'אף אחד', isbn: '', why: 'x' }, { title_he: 'מיכאל שלי', title_original: '', author: 'עמוס עוז', isbn: '', why: 'כבר קרא' }];
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_digest', input: { intro: 'הנה כמה רעיונות.', books } }] }));
    }
    if (url.startsWith('https://www.googleapis.com/')) {
      const q = new URL(url).searchParams.get('q');
      return new Response(JSON.stringify({ items: q.includes('סיפור פשוט') ? [{ volumeInfo: { title: 'סיפור פשוט', authors: ['ש"י עגנון'], industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789650000042' }] } }] : [] }));
    }
    if (url.startsWith('https://openlibrary.org/')) return new Response(JSON.stringify({ docs: [] }));
    if (url.startsWith('https://fcm.googleapis.com/')) { sent.push({ push: init.headers }); return new Response('', { status: 201 }); }
    return new Response('blocked', { status: 403 });
  };
  const ctx = { waitUntil: () => {} };
  // משתמש חדש שנוסף אחרי שהתכונה עלתה: לא עכשיו
  const r1 = await runDigests(envD, ctx, now);
  assert.equal(r1.ran, 1);
  const d = JSON.parse(kv.get('digest:old'));
  assert.deepEqual(d[0].books.map(b => b.title), ['סיפור פשוט'], 'only verified, new books');
  assert.equal(d[0].intro, 'הנה כמה רעיונות.');
  const push = sent.find(x => x.push);
  assert.ok(push && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{80,}$/.test(push.push.Authorization), 'VAPID push sent');
  const meta = JSON.parse(kv.get('digest-meta:old'));
  assert.ok(meta.next > now + 13 * 86400000, 'next in two weeks');
  // משתמש חדש: יום אחרי שנוצר
  const st = JSON.parse(kv.get('state')); st.data.profiles.push({ id: 'new', name: 'דנה', createdAt: now + 1000 }); st.data.dbs.new = { books: [{ title: 'x', rating: 4, status: 'read' }] };
  kv.set('state', JSON.stringify(st));
  const r2 = await runDigests(envD, ctx, now + 2000);
  assert.equal(r2.ran, 0);
  assert.ok(JSON.parse(kv.get('digest-meta:new')).next >= now + 1000 + 86400000 - 5);
  console.log('worker biweekly digest: ok');
}
// ---------- אבטחה: כניסה, מה כל משתמש רואה, ומה מותר לו לכתוב ----------
{
  const kv = new Map();
  const LIB = {
    get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null,
    put: async (k, v) => { kv.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    delete: async (k) => { kv.delete(k); }
  };
  // מפתח RSA לבדיקה במקום המפתחות של Google
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const env = { LIBRARY: LIB, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', __googleKeys: [{ ...pub, kid: 'k1' }], ADMIN_EMAIL_SHA256: await (await import('../worker/worker.js')).sha256hex('admin@example.com') };
  const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
  const gToken = async (claims, aud = env.GOOGLE_CLIENT_ID) => {
    const head = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = b64u({ iss: 'https://accounts.google.com', aud, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims });
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head + '.' + body));
    return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
  };
  const call = async (path, { method = 'GET', body, token } = {}) => {
    const r = await worker.fetch(new Request('https://w' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  // מצב התחלתי: A (סיסמה ישנה בפרופיל), B חבר של A (מסתיר ספר אחד ואת ההערות), C לא חבר
  const { sha256hex } = await import('../worker/worker.js');
  const legacy = await sha256hex('vrt|s1|1234');
  const book = (id, title, extra = {}) => ({ id, key: 'k' + id, title, authors: ['x'], status: 'read', rating: 5, note: 'הערה פרטית', tags: [], ...extra });
  kv.set('state', JSON.stringify({ rev: 1, data: {
    profiles: [{ id: 'A', name: 'אבי', color: 0, passHash: legacy, passSalt: 's1', updatedAt: 1 }, { id: 'B', name: 'בת', color: 1, updatedAt: 1 }, { id: 'C', name: 'כרמל', color: 2, updatedAt: 1 }],
    deleted: {},
    dbs: {
      A: { books: [book('a1', 'ספר של A')], settings: {}, litProfile: { text: 'פרופיל' } },
      B: { books: [book('b1', 'גלוי'), book('b2', 'מוסתר', { private: true }), book('b3', 'אהוב')], settings: { share: { notes: false } }, litProfile: { text: 'סוד של B' }, feedback: [{ text: 'סוד' }] },
      C: { books: [book('c1', 'אהוב', { rating: 5 }), book('c2', 'בינוני', { rating: 3 })], settings: {}, history: [{ id: 'h' }] }
    },
    social: { items: [
      { id: 'f1', type: 'friend', from: 'A', to: 'B', status: 'accepted', at: 1, editedAt: 2 },
      { id: 'f2', type: 'friend', from: 'B', to: 'C', status: 'accepted', at: 1, editedAt: 2 },
      { id: 'r1', type: 'rec', from: 'C', to: 'B', status: 'new', at: 1 }
    ] }
  } }));
  // 1. בלי כניסה: הכול חסום, חוץ מ-/ping. מסך הכניסה לא מקבל את רשימת המשתמשים, רק את אלה שהמכשיר מכיר (בלי גיבובים)
  for (const p of ['/sync', '/bookinfo?title=x', '/digest', '/gbooks?u=x']) assert.equal((await call(p)).status, 401, p);
  assert.equal((await call('/v1/messages', { method: 'POST', body: {} })).status, 401);
  assert.equal((await call('/ping')).status, 200);
  assert.deepEqual((await call('/auth/profiles')).json.profiles, []);
  const list = (await call('/auth/profiles?ids=A,B,zz')).json;
  assert.deepEqual(list.profiles.map(p => p.id), ['A', 'B']);
  assert.ok(!JSON.stringify(list).includes(legacy) && list.profiles[0].hasPass && !list.profiles[1].hasPass);
  // 2. סיסמה: שגויה נדחית; נכונה (הישנה) נותנת כניסה ומשודרגת ל-PBKDF2, והגיבוב הישן לא נשלח לאף אחד
  assert.equal((await call('/auth/password', { method: 'POST', body: { pid: 'A', password: 'nope' } })).status, 401);
  const a = (await call('/auth/password', { method: 'POST', body: { pid: 'A', password: '1234' } })).json;
  assert.ok(/^[0-9a-f]{64}$/.test(a.token) && a.pid === 'A');
  assert.equal(JSON.parse(kv.get('acct:A')).pass.alg, 'pbkdf2');
  // כניסה לפי שם; שם שלא קיים נראה כמו סיסמה שגויה; משתמש בלי סיסמה לא נתפס (רק המנהל קובע לו)
  assert.ok((await call('/auth/password', { method: 'POST', body: { name: ' אבי ', password: '1234' } })).json.token);
  assert.equal((await call('/auth/password', { method: 'POST', body: { name: 'אין כזה', password: '1234' } })).json.error, 'wrong');
  assert.equal((await call('/auth/password', { method: 'POST', body: { pid: 'C', password: 'grab' } })).status, 403);
  assert.ok(!kv.has('acct:C'));
  // 3. מה A רואה: הכול שלו; מ-B (חבר) רק ספרים משותפים, בלי המוסתר ובלי הערות, בלי פרופיל/משוב; מ-C (לא חבר) רק האהוב, בלי הערה
  const v = (await call('/sync', { token: a.token })).json;
  assert.ok(!JSON.stringify(v).includes(legacy) && !JSON.stringify(v).includes('passSalt'));
  assert.equal(v.data.dbs.A.litProfile.text, 'פרופיל');
  assert.deepEqual(v.data.dbs.B.books.map(b => b.title), ['גלוי', 'אהוב']);
  assert.equal(v.data.dbs.B.books[0].note, '');
  assert.ok(!JSON.stringify(v.data.dbs.B).includes('סוד'));
  // C (לא חבר): הספרייה שלו לא נשלחת בכלל. "אהובים בקהילה" מגיע כסיכום אנונימי (שניים לפחות אהבו), בלי מזהים והערות
  assert.equal(v.data.dbs.C, undefined);
  assert.deepEqual(v.data.community.map(x => [x.book.title, x.ratings]), [['אהוב', [5, 5]]]);
  assert.ok(!/הערה פרטית|"c1"|"b3"/.test(JSON.stringify(v.data.community)));
  assert.deepEqual(v.data.social.items.map(x => x.id), ['f1']);   // רשומות של אחרים לא נשלחות
  // 4. כתיבה: A יכול לשנות רק את שלו. ניסיון לשנות את הספרייה של B, את השם של C, או לזייף רשומה בשם B – נזרק
  const forged = JSON.parse(JSON.stringify(v.data));
  forged.dbs.A.books.push(book('a2', 'חדש של A'));
  forged.dbs.B = { books: [], settings: {} };
  forged.profiles = forged.profiles.map(p => p.id === 'C' ? { ...p, name: 'נפרץ', updatedAt: 99 } : p.id === 'A' ? { ...p, name: 'אבי כהן', updatedAt: 5 } : p);
  forged.social.items.push({ id: 'x1', type: 'friend', from: 'B', to: 'C', status: 'declined', at: 9, editedAt: 9 });
  forged.social.items.push({ id: 'f2', type: 'friend', from: 'B', to: 'C', status: 'declined', at: 1, editedAt: 9 });
  assert.equal((await call('/sync', { method: 'PUT', token: a.token, body: { baseRev: v.rev, data: forged } })).status, 200);
  const st = JSON.parse(kv.get('state')).data;
  assert.deepEqual(st.dbs.A.books.map(b => b.title), ['ספר של A', 'חדש של A']);
  assert.equal(st.dbs.B.books.length, 3);
  assert.deepEqual(st.profiles.map(p => p.name), ['אבי כהן', 'בת', 'כרמל']);
  assert.ok(!st.social.items.some(x => x.id === 'x1'));
  assert.equal(st.social.items.find(x => x.id === 'f2').status, 'accepted');
  assert.equal((await call('/sync', { method: 'PUT', token: a.token, body: { baseRev: 0, data: forged } })).status, 409);
  // 5. Google: חשבון חדש מקושר ל-B (ל-B אין עדיין סיסמה); אחר כך נכנס ישר. aud אחר נדחה
  const gB = await gToken({ sub: 'g-b', email: 'bat@example.com', name: 'Bat' });
  const l = (await call('/auth/google', { method: 'POST', body: { credential: gB } })).json;
  assert.ok(l.link && l.email === 'bat@example.com');
  // ל-B אין סיסמה: אי אפשר לחבר אליו חשבון Google (אחרת כל אחד יכול היה לתפוס אותו)
  assert.equal((await call('/auth/link', { method: 'POST', body: { link: l.link, pid: 'B' } })).json.error, 'no_password');
  assert.equal((await call('/auth/google', { method: 'POST', body: { credential: await gToken({ sub: 'g-b' }, 'other-client') } })).status, 401);
  // קישור Google ל-A דורש את הסיסמה של A
  const l2 = (await call('/auth/google', { method: 'POST', body: { credential: await gToken({ sub: 'g-x', email: 'x@example.com' }) } })).json;
  assert.equal((await call('/auth/link', { method: 'POST', body: { link: l2.link, pid: 'A', password: 'bad' } })).status, 401);
  // 6. מנהל: רק חשבון ה-Google של המנהל; מאפס סיסמה למשתמש
  assert.equal((await call('/auth/admin', { method: 'POST', token: a.token, body: { action: 'list' } })).status, 403);
  const adm = (await call('/auth/google', { method: 'POST', body: { credential: await gToken({ sub: 'g-admin', email: 'admin@example.com' }) } })).json;
  const ad = (await call('/auth/link', { method: 'POST', body: { link: adm.link, pid: 'A', password: '1234' } })).json;
  assert.equal(ad.admin, true);
  assert.equal((await call('/auth/admin', { method: 'POST', token: ad.token, body: { action: 'list' } })).json.profiles.length, 3);
  assert.equal((await call('/auth/admin', { method: 'POST', token: ad.token, body: { action: 'reset', pid: 'C', password: 'new-pass' } })).status, 200);
  const cTok = (await call('/auth/password', { method: 'POST', body: { pid: 'C', password: 'new-pass' } })).json.token;
  assert.ok(cTok);
  // אחרי שהמנהל קבע ל-B סיסמה: Google מתחבר אליו עם הסיסמה, ונכנס ישר בפעם הבאה. האיפוס לא נוגע בכניסות של אחרים
  assert.equal((await call('/auth/admin', { method: 'POST', token: ad.token, body: { action: 'reset', pid: 'B', password: 'bpass' } })).status, 200);
  assert.equal((await call('/auth/link', { method: 'POST', body: { link: l.link, pid: 'B', password: 'bpass' } })).json.pid, 'B');
  assert.equal((await call('/auth/google', { method: 'POST', body: { credential: gB } })).json.pid, 'B');
  assert.equal((await call('/sync', { token: cTok })).status, 200);
  // קישור מההגדרות לחשבון Google שכבר שייך למשתמש אחר: נדחה, ולא נותן כניסה אליו
  assert.equal((await call('/auth/google', { method: 'POST', token: cTok, body: { credential: gB } })).status, 409);
  assert.equal((await call('/auth/me', { token: cTok })).json.google, '');
  // 7. הגבלת ניסיונות, ויציאה מבטלת את מפתח הכניסה
  for (let i = 0; i < 8; i++) await call('/auth/password', { method: 'POST', body: { pid: 'C', password: 'x' + i } });
  assert.equal((await call('/auth/password', { method: 'POST', body: { pid: 'C', password: 'new-pass' } })).status, 429);
  await call('/auth/logout', { method: 'POST', token: a.token });
  assert.equal((await call('/sync', { token: a.token })).status, 401);
  // מחיקה עצמית: הספרייה ופרטי הכניסה נמחקים
  const before = (await call('/sync', { token: cTok })).json;
  assert.equal((await call('/sync', { method: 'PUT', token: cTok, body: { baseRev: before.rev, data: { deleted: { C: Date.now() } } } })).status, 200);
  assert.equal((await call('/sync', { token: cTok })).status, 401);
  const stC = JSON.parse(kv.get('state')).data;
  assert.ok(stC.deleted.C && !stC.dbs.C && !kv.has('acct:C') && !stC.profiles.some(p => p.name === 'כרמל'));
  // הרשמה דורשת הסכמה לתנאים, וההסכמה נשמרת עם הגרסה
  assert.equal((await call('/auth/register', { method: 'POST', body: { name: 'דן', password: '1234' } })).json.error, 'consent');
  const dn = (await call('/auth/register', { method: 'POST', body: { name: 'דן', password: '1234', consent: '1' } })).json;
  assert.equal(dn.consent, '1');
  assert.equal(JSON.parse(kv.get('acct:' + dn.pid)).consent.v, '1');
  console.log('worker auth and per-user data: ok');
}
