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
