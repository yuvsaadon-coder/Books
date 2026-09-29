// בדיקות יחידה לשרת: הכלים שנשלחים ל-Anthropic
import assert from 'node:assert/strict';
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
const kv = new Map();
const env = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async (k, t) => kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null, put: async (k, v) => { kv.set(k, v); } } };
const sent = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body); sent.push(body);
  if (sent.length === 1) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: "The following domains are not accessible to our user agent: ['goodreads.com']." } }), { status: 400 });
  return new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
};
const res = await worker.fetch(new Request('https://w/v1/messages', { method: 'POST', headers: { origin: 'https://yuvsaadon-coder.github.io' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, tools: [{ type: 'web_search_20260209', name: 'web_search' }], messages: [] }) }), env, { waitUntil() {} });
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
      assert.equal(body.tools[0].max_uses, 1); assert.deepEqual(body.tools[0].allowed_domains, ['e-vrit.co.il', 'steimatzky.co.il', 'booknet.co.il']);
      return new Response(JSON.stringify({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://www.e-vrit.co.il/Product/1/נגד_הטבע', title: 'נגד הטבע - תומס אספדל | עברית' },
        { type: 'web_search_result', url: 'https://www.e-vrit.co.il/Product/2/x', title: 'ספר אחר לגמרי' }] }, { type: 'text', text: 'done' }] }), { status: 200 });
    }
    return new Response('blocked', { status: 403 });
  };
  const envS = { ANTHROPIC_API_KEY: 'k', LIBRARY: { get: async () => null, put: async () => {} } };
  const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
  const res = await worker.fetch(new Request('https://w/stores?title=' + encodeURIComponent('נגד הטבע') + '&author=' + encodeURIComponent('תומס אספדל'), { headers: { Origin: 'https://yuvsaadon-coder.github.io' } }), envS, ctx);
  const j = await res.json();
  assert.equal(j.via, 'search');
  assert.deepEqual(j.items.map(x => [x.title, x.site]), [['נגד הטבע', 'e-vrit.co.il']]);
  await Promise.all(waits);
  const n = calls.length;
  const again = await (await worker.fetch(new Request('https://w/stores?title=' + encodeURIComponent('נגד הטבע') + '&author=' + encodeURIComponent('תומס אספדל')), envS, ctx)).json();
  assert.equal(again.items.length, 1); assert.equal(calls.length, n, 'second call served from cache');
  console.log('worker store search: ok');
}
