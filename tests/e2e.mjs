// בדיקות קצה-לקצה: האפליקציה הבנויה (index.html) בדפדפן אמיתי, עם רשת מדומה
// (Google Books, השרת המשפחתי: סנכרון ו-Claude). הרצה: npm run build && npm test
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const nm = root + 'tests/node_modules/';
const ASSETS = {
  'react.production.min.js': readFileSync(nm + 'react/umd/react.production.min.js'),
  'react-dom.production.min.js': readFileSync(nm + 'react-dom/umd/react-dom.production.min.js'),
  'lucide.min.js': readFileSync(nm + 'lucide/dist/umd/lucide.min.js')
};
const SDK = (await build({ entryPoints: [nm + '@anthropic-ai/sdk/index.mjs'], bundle: true, format: 'esm', platform: 'browser', write: false })).outputFiles[0].text;
const APP = 'file://' + root + 'index.html';
const WORKER = 'https://books.yuvsaadon.workers.dev';
const D = 'תקציר רשמי ארוך מספיק כדי לעבור את בדיקת האורך של המערכת, עם עוד כמה מילים.';
const LONGEN = 'Toru Watanabe looks back on his days as a college student in Tokyo, when he fell in love with two very different women. '.repeat(3);
const vol = (id, title, authors, isbn, extra = {}) => ({ id, volumeInfo: { title, authors, language: 'iw', pageCount: 250, publishedDate: '1999', description: D, industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }], ...extra } });
const BOOKS = [
  vol('m1', 'מיכאל שלי', ['עמוס עוז'], '9789650000011'), vol('y1', 'יש ואין', ['ארנסט המינגוויי'], '9789650000028'),
  vol('k1', 'קפקא על החוף', ['הרוקי מורקמי'], '9789650000035'), vol('s1', 'סיפור פשוט', ['עגנון'], '9789650000042'),
  vol('he1', 'יער נורווגי', ['הרוקי מורקמי'], '9789650712345', { description: 'טורו ואטאנבה נזכר בימי הסטודנט שלו בטוקיו.' }),
  vol('en1', 'Norwegian Wood', ['Haruki Murakami'], '9780375704024', { language: 'en', description: LONGEN + '...' })
];
let store = { rev: 0, data: null };
const aiCalls = [], aiScript = [], errors = [];
let viaProxy = 0, direct = 0;

function sse(blocks, stop) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20000, output_tokens: 0, server_tool_use: { web_search_requests: 3 } } } });
  blocks.forEach((b, i) => {
    if (b.type === 'tool_use' || b.type === 'server_tool_use') {
      out += ev('content_block_start', { index: i, content_block: { ...b, input: {} } });
      out += ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else if (b.type === 'thinking') {
      out += ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      out += ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
      out += ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig' } });
    } else out += ev('content_block_start', { index: i, content_block: b });
    out += ev('content_block_stop', { index: i });
  });
  return out + ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3000 } }) + ev('message_stop', {});
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function phone(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  await page.route('**/*', async route => {
    const req = route.request(); const url = req.url();
    if (url.startsWith('file:')) return route.continue();
    const asset = Object.keys(ASSETS).find(k => url.endsWith(k));
    if (asset) return route.fulfill({ body: ASSETS[asset], contentType: 'application/javascript', headers: cors });
    if (url.includes('@anthropic-ai/sdk')) return route.fulfill({ body: SDK, contentType: 'application/javascript', headers: cors });
    const u = new URL(url);
    if (u.origin === WORKER) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (u.pathname === '/ping') return route.fulfill({ headers: cors, json: { ok: true, ai: true, sync: true, gbooks: true } });
      if (u.pathname === '/sync' && req.method() === 'GET') return route.fulfill({ headers: cors, json: store });
      if (u.pathname === '/sync' && req.method() === 'PUT') {
        const body = JSON.parse(req.postData());
        if (body.baseRev !== store.rev) return route.fulfill({ status: 409, headers: cors, json: store });
        store = { rev: store.rev + 1, data: body.data };
        return route.fulfill({ headers: cors, json: { rev: store.rev } });
      }
      if (u.pathname.startsWith('/v1/messages')) {
        aiCalls.push(JSON.parse(req.postData()));
        const step = aiScript.shift();
        assert.ok(step, 'unexpected AI call');
        if (step.error) return route.fulfill({ status: step.error, headers: cors, json: { type: 'error', error: { type: 'invalid_request_error', message: 'tools.0.web_search_20260209: something_very_long_without_spaces_'.repeat(4) } } });
        return route.fulfill({ headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(step.blocks, step.stop) });
      }
      if (u.pathname === '/page') {
        const title = u.searchParams.get('title');
        return route.fulfill({ headers: cors, json: { ok: title === 'העיר וחומתה החמקמקה', url: u.searchParams.get('url'), site: 'e-vrit.co.il', title, image: '', description: 'העיר, שספק נוצרה בדמיונם של השניים, היא מקום קודר ולירי.' } });
      }
      if (u.pathname.startsWith('/gbooks')) { viaProxy++; return googleMock(route, new URL(u.searchParams.get('u') || 'https://x/')); }
    }
    if (u.host === 'www.googleapis.com') { direct++; return googleMock(route, u); }
    if (u.host.includes('wikidata')) return route.fulfill({ json: { search: [] }, headers: cors });
    if (u.host === 'openlibrary.org') return route.fulfill({ json: { docs: [] }, headers: cors });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(APP);
  return page;
}
function googleMock(route, u) {
  const m = u.pathname.match(/volumes\/(\w+)$/);
  if (m) {
    const b = BOOKS.find(x => x.id === m[1]);
    return route.fulfill({ headers: cors, json: { ...b, volumeInfo: { ...b.volumeInfo, description: b.id === 'en1' ? LONGEN + 'FULL-TEXT-ENDING.' : b.volumeInfo.description } } });
  }
  const q = (u.searchParams.get('q') || '').replace(/inauthor:\S+/g, '');
  const isbn = q.match(/isbn:(\d+)/);
  const items = isbn ? BOOKS.filter(b => b.volumeInfo.industryIdentifiers[0].identifier === isbn[1]) : BOOKS.filter(b => q.includes(b.volumeInfo.title) || b.volumeInfo.title.includes(q.trim()));
  return route.fulfill({ headers: cors, json: { items: items.length ? items : (isbn ? [] : [vol('junk', 'עשרה סיפורים', undefined, '9650000000')]) } });
}
const step = async (name, fn) => { process.stdout.write(`• ${name} … `); await fn(); console.log('ok'); };
const texts = (loc) => loc.allTextContents();

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const A = await phone(browser, 'A'), B = await phone(browser, 'B');
  const addBook = async (p, q, stars = 5) => {
    await p.click('nav >> text=הוספת ספר'); await p.click('button[role=tab]:has-text("ספר אחד")');
    await p.fill('#book-q', q); await p.click('form button[type=submit]');
    await p.locator('main ul > li').first().locator('button:has-text("זה הספר שלי")').click();
    await p.click(`[aria-label="${stars} כוכבים"]`); await p.fill('#book-note', 'אהבתי את הכתיבה'); await p.click('button:has-text("שמירה לספרייה")');
    await p.waitForSelector('h1:has-text("הספרים שלי")');
  };
  const syncBoth = async () => { for (const p of [A, B, A]) { await p.click('nav >> text=הגדרות'); await p.click('text=סנכרון עכשיו'); await p.waitForTimeout(700); } };

  await step('two phones create users and books, auto-connected, no setup', async () => {
    await A.fill('#new-profile', 'יובל'); await A.click('button:has-text("כניסה")'); await addBook(A, 'מיכאל שלי');
    await B.fill('#new-profile', 'יעל'); await B.click('button:has-text("כניסה")'); await addBook(B, 'קפקא על החוף');
    await syncBoth();
    await A.click('text=החלפת משתמש'); assert.equal((await A.locator('main li').count()), 2);
    await B.click('text=החלפת משתמש'); assert.equal((await B.locator('main li').count()), 2);
  });
  await step('a deletion on one phone reaches the other', async () => {
    await B.click('main li:has-text("יובל")');
    await B.click('main ul li button >> nth=0'); await B.waitForTimeout(400);
    const del = B.locator('[role=dialog] button:has-text("מחיקה")'); await del.scrollIntoViewIfNeeded(); await del.click();
    await B.locator('[role=dialog] button:has-text("לחצו שוב למחיקה")').click();
    await A.click('main li:has-text("יובל")'); await syncBoth(); await B.click('nav >> text=ספרים שלי'); await A.click('nav >> text=ספרים שלי');
    await A.waitForSelector('text=הספרייה שלך מחכה לספר הראשון');
  });
  await step('Hebrew edition first; full synopsis on expand; translation kept', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.fill('#book-q', 'Norwegian Wood'); await A.click('form button[type=submit]');
    const card = A.locator('main ul > li').first();
    await card.locator('text=לתקציר המלא').click(); await A.waitForTimeout(300);
    assert.ok((await card.locator('p[dir=auto]').textContent()).includes('FULL-TEXT-ENDING'));
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't1', name: 'submit_translation', input: { hebrew: 'טורו נזכר בימיו בטוקיו.' } }], stop: 'tool_use' });
    await card.locator('text=תרגום לעברית').click(); await A.waitForSelector('text=הצגת המקור');
    await card.locator('button:has-text("זה הספר שלי")').click(); await A.click('[aria-label="4 כוכבים"]'); await A.click('button:has-text("שמירה לספרייה")');
    await A.click('main ul li button >> nth=0');
    assert.equal(await A.locator('[role=dialog] p[dir=auto]').textContent(), 'טורו נזכר בימיו בטוקיו.');
    await A.keyboard.press('Escape');
    await A.click('nav >> text=הוספת ספר'); await A.fill('#book-q', 'יער נורווגי'); await A.click('form button[type=submit]'); await A.waitForTimeout(400);
    assert.equal(await A.locator('main ul > li > div .font-display.text-\\[18px\\]').first().textContent(), 'יער נורווגי');
  });
  await step('smart identification (Claude) is verified against the catalogue', async () => {
    aiScript.push({ blocks: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'יש ואין' } }, { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'tool_use', id: 't2', name: 'submit_matches', input: { candidates: [{ title: 'יש ואין', author: 'ארנסט המינגוויי', original_title: 'To Have and Have Not', isbn: '9789650000028' }] } }], stop: 'tool_use' });
    await A.fill('#book-q', 'משהו לא ברור'); await A.click('form button[type=submit]');
    await A.click('button:has-text("זיהוי חכם עם AI")'); await A.waitForSelector('text=זוהה בעזרת Claude');
    assert.equal(await A.locator('main ul > li > div .font-display.text-\\[18px\\]').first().textContent(), 'יש ואין');
    const call = aiCalls.at(-1);
    assert.equal(call.model, 'claude-sonnet-4-6');
    assert.deepEqual(call.tools.map(t => t.name), ['web_search', 'web_fetch', 'submit_matches']);
  });
  await step('new Hebrew book found only on an Israeli store page is verified via that page', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't5', name: 'submit_matches', input: { candidates: [
      { title: 'העיר וחומתה החמקמקה', author: 'הרוקי מורקמי', original_title: '', isbn: '', page_url: 'https://www.e-vrit.co.il/Product/1/x' },
      { title: 'ספר מזויף', author: 'אף אחד', original_title: '', isbn: '', page_url: 'https://www.e-vrit.co.il/Product/2/y' }] } }], stop: 'tool_use' });
    await A.click('nav >> text=הוספת ספר'); await A.click('button[role=tab]:has-text("ספר אחד")');
    await A.fill('#book-q', 'העיר וחומתה'); await A.click('form button[type=submit]');
    await A.waitForSelector('text=לא נמצא ספר שתואם לחיפוש');
    await A.click('button:has-text("זיהוי חכם עם AI")'); await A.waitForSelector('main ul > li:has-text("העיר וחומתה החמקמקה")');
    assert.deepEqual(await texts(A.locator('main ul > li > div .font-display.text-\\[18px\\]')), ['העיר וחומתה החמקמקה']);
    assert.ok((await A.locator('main ul > li').first().textContent()).includes('מאומת · עברית'));
  });
  await step('free text → queue; to-do and done lists', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't3', name: 'submit_books', input: { books: [{ title: 'סיפור פשוט', author: 'עגנון', note: 'אהב מאוד' }, { title: 'קפקא על החוף', author: 'הרוקי מורקמי', note: '' }] } }], stop: 'tool_use' });
    await A.click('button[role=tab]:has-text("טקסט חופשי")'); await A.fill('#free-text', 'קראתי סיפור פשוט של עגנון וקפקא על החוף');
    await A.click('button:has-text("זיהוי הספרים")'); await A.click('button:has-text("המשך: בחירה ודירוג")');
    await A.click('button:has-text("זה הספר שלי")'); assert.equal(await A.inputValue('#book-note'), 'אהב מאוד');
    await A.click('[aria-label="5 כוכבים"]'); await A.click('button:has-text("שמירה לספרייה")'); await A.waitForTimeout(400);
    await A.click('button:has-text("דילוג")'); await A.waitForTimeout(300);
    await A.click('button:has-text("טופלו (")');
    assert.equal(await A.locator('ul[aria-label="ספרים שטופלו"] li').count(), 2);
  });
  await step('smart recommendation: fabricated book rejected, pause_turn resumed, chat kept', async () => {
    const fmt = { print: 'yes', ebook: 'yes', audiobook: 'unknown', notes: 'e-vrit' };
    aiScript.push({ blocks: [{ type: 'thinking', thinking: 'הקורא אוהב ספרות ישראלית' }, { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: { url: 'https://www.haaretz.co.il/x' } }, { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_tool_error', error_code: 'unavailable' } }], stop: 'pause_turn' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't4', name: 'submit_recommendations', input: { interpretation: 'הבנתי.', recommendations: [
      { title_he: 'יש ואין', title_original: 'To Have and Have Not', author: 'ארנסט המינגוויי', isbn: '9789650000028', why: 'בדומה ל"מיכאל שלי".', synopsis_he: '', genres: ['ספרות'], formats: fmt, sources: [{ title: 'הארץ', url: 'https://www.haaretz.co.il/x' }] },
      { title_he: 'ספר מומצא', title_original: 'Invented', author: 'אף אחד', isbn: '', why: 'x', synopsis_he: 'x', genres: [], formats: fmt, sources: [] }] } }], stop: 'tool_use' });
    await A.click('nav >> text=גלה ספר חדש'); await A.fill('#ai-request', 'משהו קלאסי'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=ההמלצות שלך', { timeout: 20000 });
    assert.deepEqual(await texts(A.locator('section li .font-display.text-\\[18px\\]')), ['יש ואין']);
    assert.deepEqual(aiCalls.at(-1).messages.map(m => m.role), ['user', 'assistant']);
    await A.click('nav >> text=ספרים שלי'); await A.click('nav >> text=גלה ספר חדש');
    assert.deepEqual(await texts(A.locator('section li .font-display.text-\\[18px\\]')), ['יש ואין']);
  });
  await step('service error is shown briefly and stays on screen', async () => {
    aiScript.push({ error: 400 });
    await A.click('button:has-text("שאלון חדש")'); await A.fill('#ai-request', 'בדיקה'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=השירות החזיר שגיאה (400)');
    const [sw, w] = await A.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= w, `error overflow ${sw} > ${w}`);
  });
  await step('no horizontal overflow on a 360px phone', async () => {
    for (const tab of ['ספרים שלי', 'הוספת ספר', 'גלה ספר חדש', 'הגדרות']) {
      await A.click(`nav >> text=${tab}`);
      const [sw, w] = await A.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(sw <= w, `${tab}: ${sw} > ${w}`);
    }
  });
  await step('Google Books goes through the family server (shared key + cache)', async () => {
    assert.ok(viaProxy > 0, 'no proxied Google requests');
    assert.equal(direct, 0, `${direct} direct Google requests`);
  });
  await step('first entry: pick known books → verified ones added, the rest queued', async () => {
    const C = await phone(browser, 'C');
    await C.fill('#new-profile', 'דנה'); await C.click('button:has-text("כניסה")');
    await C.waitForSelector('text=אילו ספרים כבר קראת?');
    // סוויפ ימינה = קראתי, ואז דירוג; "לא קראתי"; וחזרה אחורה
    const card = C.locator('[role=group][aria-label*=","]').last();
    const first = (await card.getAttribute('aria-label')).split(',')[0];
    const box = await card.boundingBox();
    await C.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await C.mouse.down();
    await C.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
    await C.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 4 }); await C.mouse.up();
    await C.waitForSelector(`text=איך היה`);
    await C.locator(`[aria-label="דירוג ${first}"] button:has-text("פחות")`).click();
    const second = (await C.locator('[role=group][aria-label*=","]').last().getAttribute('aria-label')).split(',')[0];
    assert.notEqual(second, first);
    await C.click('button:has-text("לא קראתי")');
    await C.click('[aria-label="חזרה לספר הקודם"]');
    assert.equal((await C.locator('[role=group][aria-label*=","]').last().getAttribute('aria-label')).split(',')[0], second);
    await C.waitForSelector('button:has-text("הוספת 1 ספרים")');
    const rate = async (title, label) => { await C.fill('#starter-q', title); await C.locator(`li:has-text("${title}")`).first().locator(`button:has-text("${label}")`).click(); };
    await rate('מיכאל שלי', 'אהבתי'); await rate('יער נורווגי', 'בסדר'); await rate('חסמבה', 'אהבתי');
    await C.fill('#starter-q', '');
    await C.click('button:has-text("הוספת 4 ספרים")');
    await C.waitForSelector('text=הספרייה מוכנה', { timeout: 20000 });
    assert.ok((await C.locator('main p.tabular').textContent()).includes('נוספו 2'));
    await C.click('button:has-text("לספרייה שלי")');
    assert.deepEqual((await texts(C.locator('main ul li .font-display.text-\\[17px\\]'))).sort(), ['יער נורווגי', 'מיכאל שלי']);
    await C.click('nav >> text=הוספת ספר'); await C.click('button[role=tab]:has-text("רשימה")');
    await C.waitForSelector('text=ספר 1 מתוך 2');
    await C.waitForSelector(`text=${first}`);
    await C.click('button:has-text("דילוג")');
    await C.waitForSelector('text=חסמבה');
  });
  assert.deepEqual(errors, [], 'page errors');
  console.log('\nכל הבדיקות עברו');
} finally {
  await browser.close();
}
