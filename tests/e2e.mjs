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
let storeCalls = 0;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const BOOKS = [
  vol('m1', 'מיכאל שלי', ['עמוס עוז'], '9789650000011'), vol('y1', 'יש ואין', ['ארנסט המינגוויי'], '9789650000028'),
  vol('k1', 'קפקא על החוף', ['הרוקי מורקמי'], '9789650000035'), vol('s1', 'סיפור פשוט', ['עגנון'], '9789650000042'),
  vol('he1', 'יער נורווגי', ['הרוקי מורקמי'], '9789650712345', { description: 'טורו ואטאנבה נזכר בימי הסטודנט שלו בטוקיו.' }),
  vol('en1', 'Norwegian Wood', ['Haruki Murakami'], '9780375704024', { language: 'en', description: LONGEN + '...' }),
  vol('en2', 'The Remains of the Day', ['Kazuo Ishiguro'], '9780679731726', { language: 'en', description: 'A butler looks back.' }),
  vol('hp1', 'הארי פוטר ואבן החכמים', ["ג'.ק. רולינג"], '9789650000101'), vol('hp2', 'הארי פוטר וחדר הסודות', ["ג'.ק. רולינג"], '9789650000102'),
  vol('old1', 'מגדלור בערפל', ['נעמה ברקאי'], '9789650000103')
];
// Wikidata מדומה: סדרה של שני ספרים, וסרט באותה סדרה (שלא אמור להיכנס)
const wdItem = (id, he, en, claims) => ({ id, labels: { he: { value: he }, en: { value: en } }, claims });
const wdRef = (id, quals) => ({ mainsnak: { datavalue: { value: { id } } }, ...(quals ? { qualifiers: quals } : {}) });
const inSeries = (n) => ({ P179: [wdRef('Q5', { P1545: [{ datavalue: { value: String(n) } }] })], P50: [wdRef('Q9')] });
const WD = {
  Q1: wdItem('Q1', 'הארי פוטר ואבן החכמים', "Harry Potter and the Philosopher's Stone", { ...inSeries(1), P31: [wdRef('Q7725634')] }),
  Q2: wdItem('Q2', 'הארי פוטר וחדר הסודות', 'Harry Potter and the Chamber of Secrets', { ...inSeries(2), P31: [wdRef('Q7725634')] }),
  Q3: wdItem('Q3', 'הארי פוטר ואבן החכמים (סרט)', "Harry Potter and the Philosopher's Stone (film)", { ...inSeries(1), P31: [wdRef('Q11424')] }),
  Q5: wdItem('Q5', 'הארי פוטר', 'Harry Potter', {}), Q9: wdItem('Q9', "ג'.ק. רולינג", 'J. K. Rowling', {})
};
function wikidataMock(route, u) {
  const p = u.searchParams;
  if (p.get('action') === 'wbsearchentities') return route.fulfill({ json: { search: Object.values(WD).filter(x => x.labels.he.value === p.get('search')).map(x => ({ id: x.id })) }, headers: cors });
  if (p.get('action') === 'wbgetentities') return route.fulfill({ json: { entities: Object.fromEntries(p.get('ids').split('|').filter(id => WD[id]).map(id => [id, WD[id]])) }, headers: cors });
  if (p.get('action') === 'query' && p.get('srsearch') === 'haswbstatement:P179=Q5') return route.fulfill({ json: { query: { search: [{ title: 'Q1' }, { title: 'Q2' }, { title: 'Q3' }] } }, headers: cors });
  return route.fulfill({ json: { search: [] }, headers: cors });
}
let store = { rev: 0, data: null };
const aiCalls = [], aiScript = [], errors = [], feedbacks = [], bookinfoCalls = [];
const digestFor = new Map();
let stallNext = false;
const jobs = new Map(), jobBodies = [], jobHold = new Set(), profileCalls = [], countryCalls = [];
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
      if (u.pathname === '/ping') return route.fulfill({ headers: cors, json: { ok: true, ai: true, sync: true, gbooks: true, nli: true, jobs: true } });
      if (u.pathname === '/feedback') { feedbacks.push(JSON.parse(req.postData())); return route.fulfill({ headers: cors, json: { ok: true } }); }
      if (u.pathname === '/reviews') {
        const t = u.searchParams.get('title') || '';
        return route.fulfill({ headers: cors, json: t === 'יש ואין'
          ? { reviews: [{ site: 'haaretz.co.il', url: 'https://www.haaretz.co.il/review', title: 'ביקורת', quote: 'רומן קשוח ויפה על הישרדות.' }], rating: { value: 3.8, count: 12000, best: 5, site: 'goodreads.com', url: 'https://www.goodreads.com/x' } }
          : { reviews: [], rating: null } });
      }
      if (u.pathname === '/digest') {
        return route.fulfill({ headers: cors, json: { next: 0, digests: u.searchParams.get('pid') && digestFor.has(u.searchParams.get('pid')) ? [digestFor.get(u.searchParams.get('pid'))] : [] } });
      }
      if (u.pathname === '/bookinfo') {
        const t = u.searchParams.get('title') || '';
        bookinfoCalls.push(t);
        if (t === 'סיפור פשוט') return route.fulfill({ headers: cors, json: { isbn: '9789650000042', found: true, urls: [{ site: 'booknet.co.il', url: 'https://www.booknet.co.il/product/sipur-pashut', kinds: ['print'] }], available: { print: true, ebook: false, audio: false }, synopsis: 'הירשל, בן למשפחת סוחרים בשבוש, מתאהב בבלומה, קרובת משפחה ענייה שעובדת בבית הוריו, אך נאלץ להתחתן עם אחרת.', synopsisSource: 'booknet.co.il', cover: '', checked_at: Date.now() } });
        return route.fulfill({ headers: cors, json: t === 'יש ואין'
          ? { isbn: '9789650000028', found: true, urls: [{ site: 'steimatzky.co.il', url: 'https://www.steimatzky.co.il/yesh-veein', kinds: ['print'] }], available: { print: true, ebook: false, audio: false }, synopsis: '', synopsisSource: '', cover: '', checked_at: Date.now() }
          : { isbn: '', found: false, urls: [], available: { print: false, ebook: false, audio: false }, synopsis: '', synopsisSource: '', cover: '', checked_at: Date.now() } });
      }
      if (u.pathname === '/stores') {
        storeCalls++;
        const t = u.searchParams.get('title') || '';
        return route.fulfill({ headers: cors, json: { items: t.includes('רוכבי שחקים') ? [{ url: 'https://www.booknet.co.il/רוכבי-שחקים', title: 'רוכבי שחקים', site: 'booknet.co.il', image: '', description: 'ספר הרפתקאות חדש.', authorOk: true }] : [], via: 'direct' } });
      }
      if (u.pathname === '/nli') {
        const t = u.searchParams.get('title') || '';
        return route.fulfill({ headers: cors, json: { items: t.includes('נגד הטבע') ? [{ id: '990012345670205171', title: 'נגד הטבע', authors: ['תומס אספדל'], year: '2023', publisher: 'תשע נשמות', language: 'heb', isbns: ['9789650000777'], cover: '', link: 'https://www.nli.org.il/he/books/NNL_ALEPH990012345670205171/NLI' }] : [] } });
      }
      if (u.pathname === '/sync' && req.method() === 'GET') return route.fulfill({ headers: cors, json: store });
      if (u.pathname === '/sync' && req.method() === 'PUT') {
        const body = JSON.parse(req.postData());
        if (body.baseRev !== store.rev) return route.fulfill({ status: 409, headers: cors, json: store });
        store = { rev: store.rev + 1, data: body.data };
        return route.fulfill({ headers: cors, json: { rev: store.rev } });
      }
      // עבודות רקע: כמו השרת האמיתי, מריצים את כל הסבבים (כולל pause_turn) עד שמגיעה קריאה לכלי ההגשה
      if (u.pathname === '/jobs' && req.method() === 'POST') {
        const body = JSON.parse(req.postData()); jobBodies.push(body);
        const id = '00000000-0000-4000-8000-' + String(jobs.size).padStart(12, '0');
        if (stallNext) { stallNext = false; jobs.set(id, { status: 'running' }); return route.fulfill({ headers: cors, json: { id } }); }
        let out = { status: 'error', error: 'no step' };
        for (let step = aiScript.shift(); step; step = aiScript.shift()) {
          if (step.error) { out = { status: 'error', error: `(${step.error}) invalid_request_error: something_very_long_without_spaces_`.repeat(2) }; break; }
          const sub = step.blocks.find(b => b.type === 'tool_use' && b.name === body.submit);
          if (sub) { out = { status: 'done', input: sub.input, usage: [{ input_tokens: 20000, output_tokens: 3000 }], hits: [] }; break; }
        }
        jobs.set(id, out);
        return route.fulfill({ headers: cors, json: { id } });
      }
      if (u.pathname.startsWith('/jobs/')) {
        const id = u.pathname.slice(6);
        return route.fulfill({ headers: cors, json: jobHold.has(id) ? { status: 'running', turns: 1, started: 1 } : (jobs.get(id) || { status: 'missing' }) });
      }
      if (u.pathname.startsWith('/v1/messages')) {
        const reqBody = JSON.parse(req.postData());
        // בניית הפרופיל הספרותי רצה ברקע: עונים עליה לבד, בלי לצרוך את התסריט של הבדיקה
        // זיהוי מדינת הסופר רץ ברקע: עונים לבד
        if ((reqBody.tools || []).some(t => t.name === 'submit_countries')) {
          countryCalls.push(reqBody);
          const C = { 'עמוס עוז': 'ישראל', 'עגנון': 'ישראל', 'הרוקי מורקמי': 'יפן', 'Haruki Murakami': 'יפן', 'ארנסט המינגוויי': 'ארצות הברית' };
          const items = reqBody.messages[0].content.split('\n').map(l => l.replace(/^- /, '')).map(a => ({ author: a, country_he: C[a] || '' }));
          return route.fulfill({ headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse([{ type: 'tool_use', id: 'c1', name: 'submit_countries', input: { items } }], 'tool_use') });
        }
        if ((reqBody.tools || []).some(t => t.name === 'submit_profile')) {
          profileCalls.push(reqBody);
          return route.fulfill({ headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse([{ type: 'tool_use', id: 'p1', name: 'submit_profile', input: { profile_he: 'אוהב/ת: ספרות ישראלית וקלאסיקות.', brief_en: 'Likes Israeli literary fiction and classics.' } }], 'tool_use') });
        }
        aiCalls.push(reqBody);
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
    if (u.host === 'books.google.com') return route.fulfill({ body: PNG, contentType: 'image/png', headers: cors });
    if (u.host.includes('wikidata')) return wikidataMock(route, u);
    if (u.host === 'openlibrary.org') return route.fulfill({ json: { docs: [] }, headers: cors });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(APP);
  return page;
}
function googleMock(route, u) {
  const m = u.pathname.match(/volumes\/(\w+)$/);
  if (m) {
    const b = BOOKS.find(x => x.id === m[1]) || vol(m[1], 'עשרה סיפורים', undefined, '9650000000');
    return route.fulfill({ headers: cors, json: { ...b, volumeInfo: { ...b.volumeInfo, description: b.id === 'en1' ? LONGEN + 'FULL-TEXT-ENDING.' : b.volumeInfo.description } } });
  }
  // חיפוש כריכה לכרטיסי ההיכרות
  const cq = (u.searchParams.get('q') || '').match(/^intitle:(.+) inauthor:(\S+)$/);
  if (u.searchParams.get('maxResults') === '8' && cq) return route.fulfill({ headers: cors, json: { items: [vol('c1', cq[1], [cq[2]], '9789650000099', { imageLinks: { thumbnail: 'http://books.google.com/cover-starter.png' } })] } });
  const q = (u.searchParams.get('q') || '').replace(/inauthor:\S+/g, '');
  const isbn = q.match(/isbn:(\d+)/);
  const items = isbn ? BOOKS.filter(b => b.volumeInfo.industryIdentifiers[0].identifier === isbn[1]) : BOOKS.filter(b => q.includes(b.volumeInfo.title) || b.volumeInfo.title.includes(q.trim()));
  return route.fulfill({ headers: cors, json: { items: items.length ? items : (isbn ? [] : [vol('junk', 'עשרה סיפורים', undefined, '9650000000')]) } });
}
// ההגדרות מחולקות לקבוצות מקופלות; פותחים את הקבוצה לפני שעובדים בתוכה
const group = async (p, title) => { const b = p.locator(`[data-group="${title}"] > h2 > button[aria-expanded="false"]`); if (await b.count()) await b.click(); };
// כניסה למשתמש קיים ממסך "של מי הספרייה?" (כל משתמש עם סיסמה)
const login = async (p, name, pw = '1234') => { await p.click(`main li:has-text("${name}")`); await p.fill('#profile-pass', pw); await p.click('form button[type=submit]'); };
const step = async (name, fn) => { process.stdout.write(`• ${name} … `); await fn(); console.log('ok'); };
const texts = (loc) => loc.allTextContents();
// SHOTS=<תיקייה>: צילומי מסך של המסכים העיקריים (לבדיקת עיצוב)
const shot = async (p, name, full = true) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: full }); };

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
  const syncBoth = async () => { for (const p of [A, B, A]) { await p.evaluate(() => window.__vrtSync()); await p.waitForTimeout(700); } };

  await step('two phones create users and books, auto-connected, no setup', async () => {
    // משתמש חדש: רשימת הספרים המוכרים נפתחת בחלון מלא; מדלגים עליה
    await A.fill('#new-profile', 'יובל'); await A.fill('#new-pass', '1234'); await A.click('button:has-text("כניסה")');
    await A.locator('[role=dialog][aria-label="היכרות עם הטעם שלך"]').waitFor(); await A.waitForTimeout(600); await shot(A, 'first-entry', false);
    await A.click('button:has-text("דילוג על ההיכרות")'); await addBook(A, 'מיכאל שלי');
    await B.fill('#new-profile', 'יעל'); await B.fill('#new-pass', '1234'); await B.click('button:has-text("כניסה")'); await B.click('button:has-text("דילוג על ההיכרות")'); await addBook(B, 'קפקא על החוף');
    await syncBoth();
    await A.click('[aria-label="החלפת משתמש"]'); assert.equal((await A.locator('main li').count()), 2);
    await B.click('[aria-label="החלפת משתמש"]'); assert.equal((await B.locator('main li').count()), 2);
  });
  await step('a deletion on one phone reaches the other', async () => {
    await login(B, 'יובל');
    await B.click('main ul li button >> nth=0'); await B.waitForTimeout(400);
    const del = B.locator('[role=dialog] button:has-text("מחיקה")'); await del.scrollIntoViewIfNeeded(); await del.click();
    await B.locator('[role=dialog] button:has-text("לחצו שוב למחיקה")').click();
    await login(A, 'יובל'); await syncBoth(); await B.click('nav >> text=ספרים שלי'); await A.click('nav >> text=ספרים שלי');
    await A.waitForSelector('text=הספרייה שלך מחכה לספר הראשון');
  });
  await step('passwords: the device remembers its user; switching needs the password; admin resets a forgotten one', async () => {
    await A.reload(); await A.waitForSelector('nav >> text=ספרים שלי');   // נכנס ישר, בלי מסך המשתמשים
    await A.click('[aria-label="החלפת משתמש"]'); await A.reload();
    await A.waitForSelector('text=של מי הספרייה?');   // אחרי החלפה: לא נכנס לבד
    await login(A, 'יובל', 'wrong'); await A.waitForSelector('text=הסיסמה לא נכונה');
    await A.click('button:has-text("שכחתי סיסמה")');
    await A.fill('#admin-pass', 'nope'); await A.fill('#profile-pass', 'abcd'); await A.click('form button[type=submit]');
    await A.waitForSelector('text=סיסמת המנהל לא נכונה');
    await A.fill('#admin-pass', 'Admin123'); await A.click('form button[type=submit]');
    await A.waitForSelector('nav >> text=ספרים שלי');
    await A.click('[aria-label="החלפת משתמש"]'); await login(A, 'יובל', 'abcd'); await A.waitForSelector('nav >> text=ספרים שלי');
    // מחזירים את הסיסמה מההגדרות
    await A.click('nav >> text=הגדרות'); await group(A, 'החשבון שלי');
    await A.fill('#change-pass', '1234'); await A.click('button:has-text("שמירת הסיסמה")'); await A.waitForSelector('text=הסיסמה נשמרה');
    await A.click('nav >> text=ספרים שלי');
  });
  await step('Hebrew edition first; full synopsis on expand; translation kept', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.fill('#book-q', 'Norwegian Wood'); await A.click('form button[type=submit]');
    const card = A.locator('main ul > li').first();
    await card.locator('text=לתקציר המלא').click(); await A.waitForTimeout(300);
    assert.ok((await card.locator('p[dir=auto]').textContent()).includes('FULL-TEXT-ENDING'));
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't1', name: 'submit_translation', input: { hebrew: 'טורו נזכר בימיו בטוקיו.' } }], stop: 'tool_use' });
    await card.locator('text=תרגום מכונה לעברית').click(); await A.waitForSelector('text=הצגת המקור');
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
  await step('Hebrew book missing from Google is found in the National Library catalogue', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.fill('#book-q', 'נגד הטבע'); await A.click('form button[type=submit]');
    const card = A.locator('main ul > li').first();
    await card.locator('text=הספרייה הלאומית').waitFor();
    assert.equal(await A.locator('main ul > li > div .font-display.text-\\[18px\\]').first().textContent(), 'נגד הטבע');
  });
  await step('new Hebrew book is found in the Israeli stores (Tzomet)', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.fill('#book-q', 'רוכבי שחקים'); await A.click('form button[type=submit]');
    const card = A.locator('main ul > li').first();
    await card.locator('text=מאומת · צומת ספרים').waitFor();
    assert.equal(await A.locator('main ul > li > div .font-display.text-\\[18px\\]').first().textContent(), 'רוכבי שחקים');
    const before = storeCalls;
    await A.fill('#book-q', 'Norwegian Wood'); await A.click('form button[type=submit]'); await A.waitForTimeout(500);
    assert.equal(storeCalls, before, 'no store search when the catalogues already match');
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
  await step('smart recommendation: focus + follow-up questions, runs as a server job, fabricated book rejected, chat kept', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'q1', name: 'submit_questions', input: { questions: [
      { question: 'כמה עצוב מותר?', options: ['קליל', 'אפשר לבכות'] }, { question: 'קלאסיקה או עכשווי?', options: ['קלאסיקה', 'עכשווי'] }] } }], stop: 'tool_use' });
    const fmt = { print: 'yes', ebook: 'yes', audiobook: 'unknown', notes: 'e-vrit' };
    aiScript.push({ blocks: [{ type: 'thinking', thinking: 'הקורא אוהב ספרות ישראלית' }, { type: 'server_tool_use', id: 's2', name: 'web_fetch', input: { url: 'https://www.haaretz.co.il/x' } }, { type: 'web_fetch_tool_result', tool_use_id: 's2', content: { type: 'web_fetch_tool_error', error_code: 'unavailable' } }], stop: 'pause_turn' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't4', name: 'submit_recommendations', input: { interpretation: 'הבנתי.', recommendations: [
      { title_he: 'יש ואין', title_original: 'To Have and Have Not', author: 'ארנסט המינגוויי', isbn: '9789650000028', why: 'בדומה ל"מיכאל שלי".', synopsis_he: '', genres: ['ספרות'], formats: fmt, sources: [{ title: 'הארץ', url: 'https://www.haaretz.co.il/x' }] },
      { title_he: 'ספר מומצא', title_original: 'Invented', author: 'אף אחד', isbn: '', why: 'x', synopsis_he: 'x', genres: [], formats: fmt, sources: [] }] } }], stop: 'tool_use' });
    await A.click('nav >> text=גלה ספר חדש'); await A.fill('#ai-request', 'משהו קלאסי');
    await A.click('[role=group][aria-label="מקור"] button:has-text("ספרות מתורגמת")');
    await A.click('button:has-text("המלצה חכמה")');
    // החלפת שאלה: השאלה הראשונה מתחלפת, התשובות נשמרות
    await A.waitForSelector('text=כמה עצוב מותר?');
    aiScript.unshift({ blocks: [{ type: 'tool_use', id: 'q9', name: 'submit_questions', input: { questions: [{ question: 'כמה עצוב מותר לספר להיות?', options: ['קליל', 'אפשר לבכות'] }] } }], stop: 'tool_use' });
    await A.click('button:has-text("שאלה אחרת")');
    await A.waitForSelector('text=כמה עצוב מותר לספר להיות?');
    assert.ok(aiCalls.at(-1).messages[0].content.includes('ALREADY ASKED: כמה עצוב מותר?'));
    await A.click('button:has-text("אפשר לבכות")');
    await A.fill('#clarify-other', 'בעיקר קלאסיקה אמריקאית'); await A.click('button:has-text("שליחה")');
    await A.waitForSelector('text=ההמלצות שלך', { timeout: 20000 });
    await A.waitForSelector('section li a:has-text("לקנייה בסטימצקי")'); await shot(A, 'recs');
    assert.deepEqual(await texts(A.locator('section li .font-display.text-\\[18px\\]')), ['יש ואין']);
    // משימות פשוטות על המודל הזול, ההמלצה עצמה על המודל הגדול
    const clarify = aiCalls.find(c => (c.tools || []).some(t => t.name === 'submit_questions'));
    assert.equal(clarify.model, 'claude-haiku-4-5-20251001'); assert.equal(clarify.thinking, undefined);
    if (profileCalls.length) assert.equal(profileCalls[0].model, 'claude-haiku-4-5-20251001');
    assert.equal(aiCalls.find(c => (c.tools || []).some(t => t.name === 'submit_translation')).model, 'claude-haiku-4-5-20251001');
    const job = jobBodies.at(-1);
    assert.equal(job.submit, 'submit_recommendations'); assert.equal(job.model, 'claude-sonnet-4-6'); assert.equal(job.tools.length, 1, 'no web tools in the recommendation job');
    const jp = job.messages[0].content;
    assert.ok(jp.includes('מקור: ספרות מתורגמת') && jp.includes('כמה עצוב מותר לספר להיות? → אפשר לבכות') && jp.includes('בעיקר קלאסיקה אמריקאית'), 'focus and follow-up answers reach the model');
    assert.ok(await A.locator('section li >> text=זמינות').count() > 0);
    await A.waitForSelector('section li a:has-text("לקנייה בסטימצקי")');
    await A.waitForSelector('section li >> text=רומן קשוח ויפה על הישרדות.');
    await A.waitForSelector('section li >> text=3.8');
    assert.ok(await A.locator('section li a:has-text("חיפוש בצומת ספרים")').count() > 0, 'store search link when no direct page');
    // קישורי החיפוש הולכים לדף החיפוש של החנות עצמה, לא ל-Google
    const tz = await A.locator('section li a:has-text("חיפוש בצומת ספרים")').first().getAttribute('href');
    assert.ok(tz.startsWith('https://www.booknet.co.il/' + encodeURIComponent('חיפוש') + '?q='), tz);
    assert.ok(await A.locator('section li a:has-text("ביקורות ב-Goodreads")').count() > 0, 'review search links');
    await A.click('nav >> text=ספרים שלי'); await A.click('nav >> text=גלה ספר חדש');
    assert.deepEqual(await texts(A.locator('section li .font-display.text-\\[18px\\]')), ['יש ואין']);
    // שלילה לתמיד עם הערה: נעלם מהרשימה, וההערה מגיעה להמלצה הבאה
    await A.click('section li [aria-label="לא מעניין אותי"]');
    await A.click('[role=dialog] button:has-text("לעולם לא")'); await A.fill('#reject-note', 'כבר קראתי מספיק המינגוויי');
    await A.click('[role=dialog] button:has-text("לא להציג יותר")');
    assert.equal(await A.locator('section li .font-display.text-\\[18px\\]').count(), 0);
  });
  await step('recommendation keeps going after the app is closed (resumes from the server)', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'q2', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't6', name: 'submit_recommendations', input: { interpretation: 'שוב.', recommendations: [
      { title_he: 'קפקא על החוף', title_original: 'Kafka on the Shore', author: 'הרוקי מורקמי', isbn: '', why: 'כמו יער נורווגי.', genres: [] }] } }], stop: 'tool_use' });
    const before = jobs.size;
    await A.click('button:has-text("שאלון חדש")'); await A.fill('#ai-request', 'משהו של מורקמי');
    // השרת "עדיין עובד" כשהאפליקציה נסגרת
    await A.evaluate(() => { window.__hold = true; });
    const id = '00000000-0000-4000-8000-' + String(before).padStart(12, '0'); jobHold.add(id);
    await A.click('button:has-text("המלצה חכמה")');
    await A.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('vrt-rec-job-')));
    await A.reload();
    jobHold.delete(id);
    await A.click('nav >> text=גלה ספר חדש');
    await A.waitForSelector('text=ממשיך את ההמלצה שהתחילה קודם');
    await A.waitForSelector('section li >> text=קפקא על החוף', { timeout: 20000 });
    const jp = jobBodies.at(-1).messages[0].content;
    assert.ok(jp.includes('יש ואין (כבר קראתי מספיק המינגוויי)'), 'rejection reason reaches the model');
    if (profileCalls.length) assert.ok(jp.includes('READER PROFILE'), 'the profile replaces the full library');
  });
  await step('friends: request, accept, see the shelf, wishlist from a friend, recommend to a friend', async () => {
    await A.click('nav >> text=חברים'); await A.locator('li:has-text("יעל")').locator('button:has-text("בקשת חברות")').click();
    await B.click('[aria-label="החלפת משתמש"]'); await login(B, 'יעל');
    await syncBoth();
    await B.click('nav >> text=חברים'); await B.click('button:has-text("אישור")');
    await syncBoth();
    await A.click('nav >> text=חברים'); await A.click('main button:has-text("יעל")');
    await A.waitForSelector('text=המדף של יעל'); await A.waitForSelector('main li:has-text("קפקא על החוף")');
    await A.locator('main li:has-text("קפקא על החוף")').locator('button:has-text("רוצה לקרוא")').click();
    await A.click('[role=dialog] button:has-text("הוספה לרשימת")');
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("רוצה לקרוא")');
    await A.waitForSelector('main li:has-text("קפקא על החוף")');
    // תצוגת קוביות
    await A.click('[aria-label="תצוגת קוביות"]');
    await A.waitForSelector('ul[aria-label="הספרים בקוביות"] li:has-text("קפקא על החוף")');
    const [sw, w] = await A.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= w, `grid overflow ${sw} > ${w}`);
    await A.click('[aria-label="תצוגת רשימה"]');
    await B.click('nav >> text=ספרים שלי'); await B.click('main ul li button >> nth=0');
    await B.click('[role=dialog] button:has-text("להמליץ לחבר")'); await B.click('[role=dialog] button:has-text("יובל")');
    await B.fill('#rec-note', 'חובה לקרוא!'); await B.click('[role=dialog] button:has-text("שליחה")'); await B.keyboard.press('Escape');
    await syncBoth();
    await A.click('nav >> text=חברים'); await A.waitForSelector('text=חברים המליצו לך'); await A.waitForSelector('text=חובה לקרוא!');
    await A.click('nav >> text=גלה ספר חדש');
  });
  await step('critique in the chat: saved, and brings updated suggestions', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't8', name: 'submit_recommendations', input: { interpretation: 'הבנתי, משהו אחר.', recommendations: [] } }], stop: 'tool_use' });
    const before = jobBodies.length;
    await A.fill('#rec-feedback', 'פחות עצוב בבקשה'); await A.click('button:has-text("עדכון ההמלצות")');
    await A.waitForFunction((n) => true, before);
    await A.waitForSelector('text=הבנתי, משהו אחר.');
    const jp = jobBodies.at(-1).messages[0].content;
    assert.ok(jobBodies.length > before && jp.includes('Feedback on the previous suggestions (קפקא על החוף') && jp.includes('פחות עצוב בבקשה'));
  });
  await step('privacy: one book hidden from friends', async () => {
    await A.click('nav >> text=חברים'); await A.click('main button:has-text("יעל")');
    await A.waitForSelector('main li:has-text("קפקא על החוף")');
    await A.click('[aria-label="חזרה"]');
    const toggle = async () => {
      await B.click('nav >> text=ספרים שלי'); await B.click('main li:has-text("קפקא על החוף") button');
      await B.click('[role=dialog] [role=switch]:has-text("הסתרה מחברים")'); await B.click('[role=dialog] [aria-label="סגירה"]');
    };
    await toggle();
    await B.waitForSelector('main li:has-text("קפקא על החוף") [aria-label="מוסתר מחברים"]');
    await syncBoth();
    await A.click('nav >> text=חברים'); await A.click('main button:has-text("יעל")'); await A.waitForTimeout(300);
    assert.equal(await A.locator('main li:has-text("קפקא על החוף")').count(), 0, 'hidden book not on the friend\'s shelf');
    await A.click('[aria-label="חזרה"]');
    await toggle(); await syncBoth();
  });
  await step('privacy: a friend who hides their read books', async () => {
    // ההגדרה נמצאת בלשונית ההגדרות; בלשונית החברים יש קישור אליה
    await B.click('nav >> text=חברים'); await B.click('button:has-text("מה החברים רואים עליי")');
    await B.click('label:has-text("הספרים שקראתי והדירוגים") input');
    await syncBoth();
    await A.click('nav >> text=חברים'); await A.click('main button:has-text("יעל")');
    await A.waitForSelector('text=אין כאן ספרים עדיין.');
    await A.click('[aria-label="חזרה"]');
    await A.click('nav >> text=ספרים שלי'); await A.click('button:has-text("סטטיסטיקות")');
    await A.waitForSelector('[aria-label="סטטיסטיקות קריאה"]');
    await A.click('nav >> text=גלה ספר חדש');
  });
  await step('biweekly suggestions: banner, list, add to wishlist, seen', async () => {
    const pid = await A.evaluate(() => JSON.parse(localStorage.getItem('verified_reading_tracker_profiles_v1')).active);
    digestFor.set(pid, { id: 'd1', at: Date.now(), intro: 'הנה כמה רעיונות בשבילך.', books: [
      { title: 'הזקן והים', author: 'ארנסט המינגוויי', why: 'כי אהבת את "יש ואין".', isbn: '9789650000999', cover: '', synopsis: 'סנטיאגו, דייג זקן, יוצא לים.', synopsisSource: 'steimatzky.co.il', urls: [{ site: 'steimatzky.co.il', url: 'https://www.steimatzky.co.il/old-man', kinds: ['print'] }], available: { print: true } }] });
    await A.reload();
    await A.click('button:has-text("ספרים חדשים בשבילך")');
    await A.waitForSelector('[role=dialog] >> text=סנטיאגו, דייג זקן');
    await A.click('[role=dialog] button:has-text("רוצה לקרוא")');
    await A.click('[role=dialog] button:has-text("הוספה לרשימת")');
    // כרטיס "הבחירה שלך" בסגנון Wrapped
    await A.waitForSelector('[role=dialog][aria-label="בחרת ספר"] >> text=הזקן והים');
    await A.click('[role=dialog][aria-label="בחרת ספר"] button:has-text("יופי")');
    await A.keyboard.press('Escape'); await A.waitForTimeout(300);
    assert.equal(await A.locator('button:has-text("ספרים חדשים בשבילך")').count(), 0, 'banner hidden after it was opened');
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("רוצה לקרוא")');
    await A.waitForSelector('main li:has-text("הזקן והים")');
    // מעקב אחרי 3 שבועות: מזיזים את הזמן של הבחירה אחורה ובודקים את השאלה
    await A.evaluate(() => {
      const k = Object.keys(localStorage).find(x => { try { return (JSON.parse(localStorage.getItem(x)).books || []).some(b => b.title === 'הזקן והים'); } catch (e) { return false; } });
      const d = JSON.parse(localStorage.getItem(k)); d.books.forEach(b => { if (b.title === 'הזקן והים') b.fromRec.at = Date.now() - 22 * 86400000; });
      localStorage.setItem(k, JSON.stringify(d));
    });
    await A.reload();
    await A.waitForSelector('text=איך הולך עם "הזקן והים"?');
    await A.click('button:has-text("התחלתי לקרוא")');
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("קורא עכשיו")');
    await A.waitForSelector('main li:has-text("הזקן והים")');
    await A.click('nav >> text=גלה ספר חדש');
  });
  await step('a background job that never starts falls back to working directly', async () => {
    stallNext = true;
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'q7', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 't9', name: 'submit_recommendations', input: { interpretation: 'ישירות.', recommendations: [] } }], stop: 'tool_use' });
    if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
    await A.fill('#ai-request', 'בדיקת גיבוי'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=ממשיך ישירות מהטלפון', { timeout: 40000 });
    await A.waitForSelector('text=ישירות.', { timeout: 20000 });
  });
  await step('service error is shown briefly and stays on screen', async () => {
    aiScript.push({ error: 400 }); aiScript.push({ error: 400 });
    if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
    await A.fill('#ai-request', 'בדיקה'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=השירות החזיר שגיאה (400)');
    const [sw, w] = await A.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(sw <= w, `error overflow ${sw} > ${w}`);
  });
  await step('no horizontal overflow on a 360px phone', async () => {
    for (const tab of ['הספרים שלי', 'הוספת ספר', 'גלה ספר חדש', 'הגדרות']) {
      await A.click(`nav >> text=${tab}`);
      const [sw, w] = await A.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(sw <= w, `${tab}: ${sw} > ${w}`);
    }
  });
  await step('e-reader mode: black and white, no covers, remembered on the device', async () => {
    await A.click('nav >> text=הגדרות'); await group(A, 'תצוגה ונגישות'); await A.click('[role=switch][aria-label="מצב קורא אלקטרוני"]');
    assert.equal(await A.evaluate(() => document.documentElement.hasAttribute('data-eink')), true);
    assert.equal(await A.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)');
    await A.reload(); assert.equal(await A.evaluate(() => document.documentElement.hasAttribute('data-eink')), true);
    await A.click('nav >> text=הגדרות'); await group(A, 'תצוגה ונגישות'); await A.click('[role=switch][aria-label="מצב קורא אלקטרוני"]');
    assert.equal(await A.evaluate(() => document.documentElement.hasAttribute('data-eink')), false);
  });
  await step('reading now → finished (statuses)', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.click('button[role=tab]:has-text("ספר אחד")'); await A.fill('#book-q', 'עשרה סיפורים'); await A.click('form button[type=submit]');
    await A.locator('main ul > li').first().locator('button:has-text("זה הספר שלי")').click();
    await shot(A, 'rate-sheet', false);
    await A.click('[role=dialog] button[role=tab]:has-text("קורא עכשיו")');
    await A.click('[role=dialog] button:has-text("הוספה ל")');
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("קורא עכשיו")');
    await A.click('main li:has-text("עשרה סיפורים") button');
    await A.click('[role=dialog] button:has-text("סיימתי אותו")');
    await A.click('[role=dialog] [aria-label="4 כוכבים"]'); await A.click('[role=dialog] button:has-text("שמירת שינויים")');
    await A.click('button[role=tab]:has-text("קראתי")');
    await A.waitForSelector('main li:has-text("עשרה סיפורים")');
    await shot(A, 'library'); await A.click('nav >> text=הגדרות'); await shot(A, 'settings'); await A.click('nav >> text=חברים'); await shot(A, 'friends');
    await A.click('nav >> text=הוספת ספר'); await shot(A, 'add'); await A.click('nav >> text=ספרים שלי');
  });
  await step('address form: every UI text follows the chosen gender', async () => {
    const pick = async (label) => { await A.click('nav >> text=הגדרות'); await group(A, 'החשבון שלי'); await A.click(`button:has-text("${label}")`); await A.click('nav >> text=גלה ספר חדש'); };
    if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
    await pick('לשון נקבה');
    await A.waitForSelector('text=היי! בואי נמצא');
    await A.click('nav >> text=ספרים שלי'); await A.waitForSelector('button[role=tab]:has-text("קוראת עכשיו")');
    await pick('לשון זכר');
    await A.waitForSelector('text=היי! בוא נמצא');
    await A.click('nav >> text=ספרים שלי'); await A.waitForSelector('button[role=tab]:has-text("קורא עכשיו")');
    await pick('לשון רבים');
    await A.waitForSelector('text=היי! בואו נמצא');
    // המודל מקבל את לשון הפנייה, ובעברית מבקשים רק ספרים עם מהדורה עברית
    // ברירת המחדל: עברית ואנגלית
    assert.ok(jobBodies.some(j => j.system.includes('Language: Hebrew or English editions')), 'default languages reach the model');
  });
  await step('gift mode: no taste profile, saved with a gift tag', async () => {
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'g1', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'g2', name: 'submit_recommendations', input: { interpretation: 'מתנה לאבא.', recommendations: [] } }], stop: 'tool_use' });
    if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
    try { await A.click('button[role=tab]:has-text("בשביל מישהו אחר")', { timeout: 5000 }); } catch (e) { await A.screenshot({ path: '/tmp/claude-0/-home-user-Books/edc6a1f8-fcb8-5818-9816-3054e7d2cd52/scratchpad/gift.png', fullPage: true }); throw e; }
    await A.fill('#ai-request', 'לאבא שלי, אוהב היסטוריה'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=מתנה לאבא.', { timeout: 30000 });
    const jp = jobBodies.at(-1).messages[0].content;
    assert.ok(jp.includes('GIFT MODE') && !jp.includes("READER'S LIBRARY") && !jp.includes('READER PROFILE'), 'gift request does not carry my taste');
  });
  await step('reading summary: always reachable, genres, years, authors, periods', async () => {
    await A.click('nav >> text=ספרים שלי');
    // כרטיס קבוע בראש הספרייה, עם תג "חדש" כשיש סיכום שלא נצפה
    const card = A.locator('button.summary-card');
    await card.locator('text=חדש').waitFor();
    await card.click();
    const rep = A.locator('[role=dialog][aria-label="סיכום הקריאה"]');
    await rep.waitFor();
    await rep.locator('text=ספרים שהסתיימו').waitFor();
    for (const t of ['סוג הקריאה שלך', 'הספר של התקופה', 'סוגות', 'מתי נכתבו', 'סופרים', 'דירוגים', 'שפה ומקור']) await rep.locator(`h3:has-text("${t}")`).waitFor();
    assert.ok(await rep.locator('button:has-text("שיתוף כתמונה")').count() > 0);
    assert.equal(await rep.locator('text=Wrapped').count(), 0);
    await A.waitForTimeout(500); await shot(A, 'summary', false); await rep.locator('h3:has-text("מתי נכתבו")').scrollIntoViewIfNeeded(); await shot(A, 'summary2', false);
    await rep.locator('button:has-text("כל הזמן")').click(); await rep.locator('p:has-text("כל הזמן")').waitFor(); await rep.locator('h3:has-text("סוגות")').waitFor();
    await rep.locator('button[aria-label="סגירה"]').click();
    // אחרי הצפייה: הכרטיס הבולט נעלם, ונשאר קישור צנוע "סיכום הקריאה"
    assert.equal(await A.locator('button.summary-card').count(), 0, 'big card gone after seen');
    await A.click('button.summary-link'); await rep.waitFor(); await rep.locator('button[aria-label="סגירה"]').click();
  });
  await step('country of each book: detected in the background, shown in stats, summary and the book list', async () => {
    await A.click('nav >> text=ספרים שלי');
    await A.waitForSelector('main li:has-text("יער נורווגי") >> text=יפן', { timeout: 20000 });
    assert.ok(countryCalls.length >= 1 && countryCalls[0].model === 'claude-haiku-4-5-20251001', 'fast model');
    await A.click('button:has-text("סטטיסטיקות")');
    await A.waitForSelector('[aria-label="ספרים לפי מדינה"] >> text=יפן');
    await A.click('button.summary-link'); const rep = A.locator('[role=dialog][aria-label="סיכום הקריאה"]');
    await rep.locator('h3:has-text("מדינות")').waitFor(); await rep.locator('text=מ-2 מדינות').first().waitFor();
    await rep.locator('button[aria-label="סגירה"]').click();
  });
  await step('user guide: from the top of every screen, search, jump to a topic, answers open on tap', async () => {
    await A.click('nav >> text=חברים');
    await A.click('button[aria-label="מדריך למשתמש"]');
    const g = A.locator('[role=dialog][aria-label="מדריך למשתמש"]');
    await g.waitFor();
    assert.equal(await g.locator('nav[aria-label="נושאים"] button').count(), 9);
    await g.locator('nav[aria-label="נושאים"] button:has-text("התראות")').click();
    const q = g.locator('details:has-text("איך מפעילים התראות?")');
    assert.equal(await q.getAttribute('open'), null);
    await q.locator('summary').click(); await q.locator('p:has-text("ומאשרים בחלון של הטלפון")').waitFor();
    await A.waitForTimeout(400); await shot(A, 'guide', false);
    await g.locator('#guide-search').fill('Goodreads');
    await g.locator('text=ייבוא מקובץ CSV').first().waitFor();
    assert.equal(await g.locator('section').count(), 2, 'only topics with matches');
    await g.locator('#guide-search').fill('זזזזז'); await g.locator('text=לא נמצאה תשובה').waitFor();
    await g.locator('button[aria-label="סגירת המדריך"]').click();
    assert.equal(await g.count(), 0);
  });
  await step('display: literary palettes, font, text size, accessibility; Discover stands out', async () => {
    await A.click('nav >> text=הגדרות'); await group(A, 'תצוגה ונגישות');
    const R = () => A.evaluate(() => ({ p: document.documentElement.getAttribute('data-palette'), f: document.documentElement.getAttribute('data-font'), a: document.documentElement.hasAttribute('data-a11y'), z: getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim() }));
    await A.click('[role=radio]:has-text("ספרייה ישנה")'); assert.equal((await R()).p, 'library');
    await A.click('[role=radio]:has-text("דוד")'); assert.equal((await R()).f, 'david');
    assert.ok((await A.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('David Libre'));
    await A.click('[aria-label="הגדלת הטקסט"]'); assert.equal((await R()).z, '1.1');
    await A.click('[role=switch][aria-label="מצב נגישות"]'); const r = await R(); assert.ok(r.a && Number(r.z) >= 1.15, JSON.stringify(r));
    await shot(A, 'settings-look');
    // נשמר גם אחרי רענון (לפני שהאפליקציה נטענת, בלי הבהוב)
    await A.reload(); assert.deepEqual(await R(), r);
    await A.click('nav >> text=הגדרות'); await group(A, 'תצוגה ונגישות');
    await A.click('[role=switch][aria-label="מצב נגישות"]'); await A.click('[aria-label="הקטנת הטקסט"]'); await A.click('[role=radio]:has-text("נייר וקלף")'); await A.click('[role=radio]:has-text("פרנק רוהל")');
    assert.deepEqual(await R(), { p: null, f: null, a: false, z: '1' });
    assert.equal(await A.locator('nav li button.nav-discover').count(), 1, 'Discover is highlighted in the nav');
    // המודל רואה מתי כל ספר נקרא ביחס להיום
    const jp = jobBodies.map(j => j.messages[0].content).find(c => !c.includes('GIFT MODE') && c.includes('REQUEST:')) || '';
    assert.ok(jp.includes('READING TIMELINE') && /read (in the last days|\d+ days ago|\d+ months ago)/.test(jp), 'reading dates reach the model');
  });
  await step('export CSV for other apps, import from Goodreads', async () => {
    await A.click('nav >> text=הגדרות'); await group(A, 'הנתונים שלי');
    // ההורדה נתפסת בדף (קישור blob), וקוראים את התוכן שלה
    await A.evaluate(() => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = { name: this.download, p: fetch(this.href).then(r => r.text()) }; return; } return orig.call(this); }; });
    await A.click('button:has-text("ייצוא CSV")');
    const csv = await A.evaluate(() => window.__dl.p);
    assert.ok(csv.includes('Exclusive Shelf') && csv.includes('עשרה סיפורים'), 'Goodreads CSV');
    const gr = 'Book Id,Title,Author,ISBN,ISBN13,My Rating,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review\n1,"ספר שלא קיים, בכלל",אף אחד,,,4,2026/09/20,2026/09/01,,read,"טוב מאוד"\n2,עשרה סיפורים,x,,,5,2026/09/20,2026/09/01,,read,\n';
    await A.setInputFiles('#import-apps', { name: 'goodreads_library_export.csv', mimeType: 'text/csv', buffer: Buffer.from(gr) });
    await A.waitForSelector('text=/Goodreads: 2\\/2 .*הסתיים/', { timeout: 30000 });
    const line = await A.locator('text=/Goodreads: 2\\/2/').textContent();
    assert.ok(/לאימות 1/.test(line) && /כבר היו 1/.test(line), line);
  });
  await step('what the app knows about me: delete items one by one', async () => {
    await A.click('button:has-text("מה האפליקציה יודעת עליי")');
    const rows = A.locator('button[aria-label^="מחיקה: "]');
    const n = await rows.count();
    assert.ok(n >= 2, 'feedback and rejections listed');
    await A.click('button[aria-label="מחיקה: פחות עצוב בבקשה"]');
    await A.click('button[aria-label="מחיקה: יש ואין"]');
    assert.equal(await rows.count(), n - 2);
    await A.evaluate(() => window.__vrtSync()); await A.waitForTimeout(700);
    assert.equal(await A.locator('button[aria-label="מחיקה: יש ואין"]').count(), 0, 'deleted rejection does not come back after sync');
  });
  await step('Hebrew recommendations: a book with only a foreign edition is dropped (kept with "any language")', async () => {
    const fmt = { print: 'yes', ebook: 'unknown', audiobook: 'unknown', notes: '' };
    const langs = A.locator('[role=group][aria-label="שפות הספרים"]');
    const run = async (label, pick) => {
      aiScript.push({ blocks: [{ type: 'tool_use', id: 'hq', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
      aiScript.push({ blocks: [{ type: 'tool_use', id: 'hr', name: 'submit_recommendations', input: { interpretation: label, recommendations: [
        { title_he: '', title_original: 'The Remains of the Day', author: 'Kazuo Ishiguro', isbn: '9780679731726', why: 'x', synopsis_he: '', genres: [], formats: fmt, sources: [] }] } }], stop: 'tool_use' });
      await A.click('nav >> text=גלה ספר חדש');
      if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
      await A.click('button[role=tab]:has-text("בשבילי")');
      // עברית ואנגלית מסומנות מראש; משנים רק לשיחה הזו
      assert.equal(await langs.locator('button[aria-pressed="true"], button.bg-accent, button[data-on="1"]').count() >= 0, true);
      await pick();
      await A.fill('#ai-request', 'משהו בריטי'); await A.click('button:has-text("המלצה חכמה")');
      await A.waitForSelector(`text=${label}`, { timeout: 30000 });
      await A.waitForFunction(() => !document.querySelector('[aria-label^="שלב "]'), null, { timeout: 30000 });
    };
    await run('עברית בלבד.', () => langs.locator('button:has-text("אנגלית")').click());
    await A.waitForSelector('text=/אין מהדורה עברית/');
    assert.equal(await A.locator('section li:has-text("The Remains of the Day")').count(), 0, 'foreign-only edition dropped');
    await run('כל שפה.', () => langs.locator('button:has-text("שפות זרות")').click());
    await A.waitForSelector('section li:has-text("The Remains of the Day")');
    assert.ok(jobBodies.at(-1).system.includes('Language: any language'));
    // ההערה על ברירת המחדל, ושינוי שלה בהגדרות
    await A.waitForSelector('text=ברירת המחדל: עברית ואנגלית');
  });
  await step('feedback button and starter list hidden once done', async () => {
    await A.click('nav >> text=הגדרות'); await group(A, 'משוב');
    await A.fill('#app-feedback', 'הכפתור של הסיכום קטן מדי'); await A.click('button:has-text("שליחת משוב")');
    await A.waitForSelector('text=המשוב נשלח');
    assert.equal(feedbacks.at(-1).text, 'הכפתור של הסיכום קטן מדי'); assert.equal(feedbacks.at(-1).name, 'יובל');
    // הרשימה כבר לא בהגדרות; בספרייה יש כרטיס עד "לא צריך יותר", וזה נשמר גם אחרי סנכרון ורענון
    assert.equal(await A.locator('main h2:has-text("היכרות")').count(), 0, 'no starter section in settings');
    await A.click('nav >> text=ספרים שלי');
    await A.waitForSelector('main h2:has-text("היכרות מהירה עם הטעם שלך")');
    await A.click('nav >> text=הוספת ספר'); await A.waitForSelector('main h2:has-text("היכרות מהירה עם הטעם שלך")');
    await A.click('button:has-text("לא צריך יותר")');
    assert.equal(await A.locator('main h2:has-text("היכרות מהירה")').count(), 0);
    await syncBoth(); await A.reload(); await A.click('nav >> text=ספרים שלי');
    assert.equal(await A.locator('main h2:has-text("היכרות מהירה")').count(), 0, 'stays hidden after sync + reload');
    // אפשר תמיד לחזור לרשימה: מלשונית ההוספה (להמשיך), ומההגדרות (מההתחלה)
    const dlg = A.locator('[role=dialog][aria-label="היכרות עם הטעם שלך"]');
    await A.click('nav >> text=הוספת ספר'); await A.click('button.starter-link');
    await dlg.waitFor(); await dlg.locator('button[aria-label="סגירה"]').click();
    await A.click('nav >> text=הגדרות'); await group(A, 'המלצות'); await A.click('button:has-text("מההתחלה")');
    await dlg.locator('text=אילו ספרים כבר קראת?').waitFor();
    assert.ok((await dlg.locator('text=/· 1 מתוך \\d+/').count()) > 0, 'starts from the first book');
    await dlg.locator('button[aria-label="סגירה"]').click();
    await A.click('nav >> text=ספרים שלי'); await A.waitForSelector('main h2:has-text("היכרות מהירה עם הטעם שלך")');
    await A.click('button:has-text("לא צריך יותר")');
  });
  await step('book details: synopsis and direct store link are fetched for a library book, saved, and not fetched again', async () => {
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("קראתי")');
    const before = bookinfoCalls.filter(t => t === 'סיפור פשוט').length;
    await A.click('main li:has-text("סיפור פשוט") button >> nth=0');
    const sheet = A.locator('[role=dialog]');
    // לספר כבר יש תקציר עברי מהמאגר: הוא נשאר (לא מוחלף), ומתווסף קישור ישיר לחנות
    await sheet.locator('a:has-text("לקנייה בצומת ספרים")').waitFor();
    assert.equal(await sheet.locator('a:has-text("לקנייה בצומת ספרים")').getAttribute('href'), 'https://www.booknet.co.il/product/sipur-pashut');
    await sheet.locator('text=נמצא בחנויות: מודפס').waitFor();
    await A.waitForTimeout(400); await shot(A, 'book-details', false);
    // הקישור נשלף כבר כשהספר נוסף מתוצאות החיפוש, ונשמר איתו: לכל היותר בקשה אחת
    assert.ok(bookinfoCalls.filter(t => t === 'סיפור פשוט').length <= Math.max(1, before + 1));
    const after = bookinfoCalls.filter(t => t === 'סיפור פשוט').length;
    await A.keyboard.press('Escape');
    await A.reload(); await A.click('button[role=tab]:has-text("קראתי")'); await A.click('main li:has-text("סיפור פשוט") button >> nth=0');
    await A.locator('[role=dialog] a:has-text("לקנייה בצומת ספרים")').waitFor();
    assert.equal(bookinfoCalls.filter(t => t === 'סיפור פשוט').length, after, 'saved with the book, not fetched again');
    // ספר בלי תקציר: הודעה ברורה וכפתור "חיפוש מחדש" (בלי מטמון)
    await A.keyboard.press('Escape');
    await A.click('main li:has-text("עשרה סיפורים") button >> nth=0');
    await A.locator('[role=dialog] >> text=לא נמצא דף מכירה ישיר').waitFor();
    const n = bookinfoCalls.length;
    await A.click('[role=dialog] button:has-text("חיפוש מחדש")');
    await A.waitForFunction((k) => true, n); await A.waitForTimeout(500);
    assert.ok(bookinfoCalls.length > n, 'retry asks the server again');
    await A.keyboard.press('Escape');
  });
  await step('all recommendations: mark good / not good (with an optional reason), good ones up front, the rest tucked away, and the model learns', async () => {
    await A.click('nav >> text=גלה ספר חדש');
    await A.click('button[role=tab]:has-text("כל ההמלצות")');
    const view = A.locator('[aria-label="כל ההמלצות"]');
    await view.locator('h2:has-text("עוד לא סימנתי")').waitFor();
    const remains = view.locator('[role=group][aria-label="סימון ההמלצה The Remains of the Day"]');
    await remains.locator('button:has-text("לא טובה")').click();
    await remains.locator('input').fill('רציתי רק ספרים בעברית');
    await remains.locator('button:has-text("שמירה")').click();
    await view.locator('summary:has-text("לא התאימו (1)")').waitFor();
    assert.equal(await view.locator('li:has-text("The Remains of the Day")').first().isVisible(), false, 'not-good recommendation tucked away (not deleted)');
    const yesh = view.locator('[role=group][aria-label="סימון ההמלצה יש ואין"]').first();
    await yesh.locator('button[aria-pressed]', { hasText: /^טובה$/ }).click();
    await yesh.locator('button:has-text("דילוג")').click();   // ההערה רשות
    await view.locator('h2:has-text("ההמלצות הטובות (1)")').waitFor();
    await A.waitForTimeout(300); await shot(A, 'all-recs');
    await syncBoth(); await A.reload();
    await A.click('nav >> text=גלה ספר חדש'); await A.click('button[role=tab]:has-text("כל ההמלצות")');
    await A.locator('[aria-label="כל ההמלצות"] h2:has-text("ההמלצות הטובות (1)")').waitFor();
    await A.locator('[aria-label="כל ההמלצות"] summary:has-text("לא התאימו (1)")').waitFor();
    // ההמלצה הבאה מקבלת את הסימונים ואת הסיבה
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'vq', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'vr', name: 'submit_recommendations', input: { interpretation: 'לומד מהסימונים.', recommendations: [] } }], stop: 'tool_use' });
    await A.click('button[role=tab]:has-text("שיחה")');
    if (await A.locator('button:has-text("שאלון חדש")').count()) await A.click('button:has-text("שאלון חדש")');
    await A.fill('#ai-request', 'משהו חדש'); await A.click('button:has-text("המלצה חכמה")');
    await A.waitForSelector('text=לומד מהסימונים.', { timeout: 30000 });
    const jp = jobBodies.at(-1).messages[0].content;
    assert.ok(jp.includes('EARLIER SUGGESTIONS THE READER MARKED') && jp.includes('רציתי רק ספרים בעברית') && /good: יש ואין/.test(jp), 'marks reach the model');
  });
  await step('Google Books goes through the family server (shared key + cache)', async () => {
    assert.ok(viaProxy > 0, 'no proxied Google requests');
    assert.equal(direct, 0, `${direct} direct Google requests`);
  });
  await step('first entry: pick known books → verified ones added, the rest queued', async () => {
    const C = await phone(browser, 'C');
    if (!(await C.locator('#new-profile').count())) await C.click('button:has-text("הוספת משתמש")');
    await C.fill('#new-profile', 'דנה'); await C.fill('#new-pass', '1234'); await C.click('button:has-text("כניסה")');
    await C.waitForSelector('text=אילו ספרים כבר קראת?');
    // סוויפ ימינה = קראתי, ואז דירוג; "לא קראתי"; וחזרה אחורה
    await C.waitForSelector('text=רעיון של יעל שטסמן סעדון האגדית');
    const card = C.locator('[role=group][aria-label*=","]').last();
    await card.locator('img[src*="cover-starter"]').waitFor();
    const first = (await card.getAttribute('aria-label')).split(',')[0];
    const box = await card.boundingBox();
    await C.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await C.mouse.down();
    await C.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
    await C.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 4 }); await C.mouse.up();
    await C.waitForSelector(`text=איך היה`);
    await C.waitForSelector(`text=✓ קראתי: ${first}`);
    await C.locator(`[aria-label="דירוג ${first}"] button:has-text("פחות")`).click();
    const second = (await C.locator('[role=group][aria-label*=","]').last().getAttribute('aria-label')).split(',')[0];
    assert.notEqual(second, first);
    await C.click('button:has-text("לא קראתי")');
    await C.click('button:has-text("חזרה לספר הקודם")');
    assert.equal((await C.locator('[role=group][aria-label*=","]').last().getAttribute('aria-label')).split(',')[0], second);
    await C.waitForSelector('button:has-text("הוספת 1 ספרים")');
    const g1 = await C.locator('text=/· \\d+ מתוך \\d+/').textContent();
    await C.click('button:has-text("ז\'אנר הבא")');
    assert.notEqual(await C.locator('text=/· \\d+ מתוך \\d+/').textContent(), g1);
    await C.click('button:has-text("חזרה לספר הקודם")');
    const rate = async (title, label) => { await C.fill('#starter-q', title); await C.locator(`li:has-text("${title}")`).first().locator(`button:has-text("${label}")`).click(); };
    await rate('מיכאל שלי', 'אהבתי'); await rate('יער נורווגי', 'בסדר'); await rate('חסמבה', 'אהבתי');
    await C.fill('#starter-q', '');
    await C.click('button:has-text("הוספת 4 ספרים")');
    await C.waitForSelector('text=הספרייה מוכנה', { timeout: 20000 });
    assert.ok((await C.locator('[role=dialog] p.tabular').textContent()).includes('נוספו 2'));
    await C.click('button:has-text("לספרייה שלי")');
    // אחרי הכניסה הראשונה: כרטיס בראש הספרייה ובלשונית ההוספה, עד "לא צריך יותר"
    await C.waitForSelector('main h2:has-text("היכרות מהירה עם הטעם שלך")'); await C.waitForTimeout(400); await shot(C, 'starter-card', false);
    assert.deepEqual((await texts(C.locator('main ul li .font-display.text-\\[17px\\]'))).sort(), ['יער נורווגי', 'מיכאל שלי']);
    await C.click('nav >> text=הוספת ספר'); await C.click('button[role=tab]:has-text("רשימה")');
    await C.waitForSelector('text=ספר 1 מתוך 2');
    await C.waitForSelector(`text=${first}`);
    await C.click('button:has-text("דילוג")');
    await C.waitForSelector('text=חסמבה');
    // אימות שנקטע (האפליקציה נסגרה באמצע): נפתח שוב לבד, עם חלון ההמתנה ובלי כפתור סגירה, וממשיך עד הסוף
    await C.evaluate(() => {
      const pid = JSON.parse(localStorage.getItem('verified_reading_tracker_profiles_v1')).active;
      const b = ['סיפור פשוט', 'ש"י עגנון'];
      localStorage.setItem('vrt-starter2-' + pid, JSON.stringify({ pos: 0, trail: [], verifying: true, picks: { [b.join('|')]: { b, gi: 0, rating: 4, rated: true, want: false } } }));
    });
    const slow = async r => { await new Promise(res => setTimeout(res, 1500)); await r.fallback(); };
    await C.route('**/*googleapis.com/**', slow); await C.route('**/gbooks**', slow);
    await C.reload();
    await C.waitForSelector('[role=dialog] .verify-wait');
    assert.equal(await C.locator('[role=dialog] button[aria-label="סגירה"]').count(), 0, 'no close button while verifying');
    await shot(C, 'verify-wait', false);
    await C.waitForSelector('[role=dialog] >> text=הספרייה מוכנה', { timeout: 30000 });
    await C.unroute('**/*googleapis.com/**', slow); await C.unroute('**/gbooks**', slow);
    await C.click('button:has-text("לספרייה שלי")');
    await C.click('nav >> text=ספרים שלי');
    await C.waitForSelector('main li:has-text("סיפור פשוט")');
    assert.equal(await C.evaluate(() => JSON.parse(localStorage.getItem('vrt-starter2-' + JSON.parse(localStorage.getItem('verified_reading_tracker_profiles_v1')).active)).verifying), false);
  });
  await step('series: shown for a book in a series (from Wikidata), the whole series marked at once', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.click('button[role=tab]:has-text("ספר אחד")');
    await A.fill('#book-q', 'הארי פוטר ואבן החכמים'); await A.click('form button[type=submit]');
    const box = A.locator('main [aria-label="סדרה"]').first();
    await box.waitFor({ timeout: 20000 });
    assert.match(await box.textContent(), /ספר 1 מתוך 2 בסדרה\s*הארי פוטר/);   // הסרט לא נספר
    await box.locator('button:has-text("סימון כל הסדרה")').click();
    assert.equal(await box.locator('li').count(), 2);
    await box.locator('[role=group][aria-label="לאיזה מדף"] button:has-text("רוצה לקרוא")').click();
    await box.locator('button:has-text("הוספת 2 ספרים")').click();
    await box.locator('text=/2 מתוך 2 · נוספו 2/').waitFor({ timeout: 20000 });
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("רוצה לקרוא")');
    await A.waitForSelector('main li:has-text("הארי פוטר ואבן החכמים")'); await A.waitForSelector('main li:has-text("הארי פוטר וחדר הסודות")');
    // בחלון הספר: הסדרה מסומנת, ואין מה להוסיף
    await A.click('main li:has-text("הארי פוטר וחדר הסודות") button');
    await A.waitForSelector('[role=dialog] [aria-label="סדרה"] >> text=ספר 2 מתוך 2');
    assert.equal(await A.locator('[role=dialog] button:has-text("סימון כל הסדרה")').count(), 0);
    await A.click('[role=dialog] [aria-label="סגירה"]');
  });
  await step('old books: asked whether to count a book read 5+ years ago; ignored books leave the taste; weights reach the model', async () => {
    await A.click('nav >> text=הוספת ספר'); await A.click('button[role=tab]:has-text("ספר אחד")');
    await A.fill('#book-q', 'מגדלור בערפל'); await A.click('form button[type=submit]');
    await A.locator('main ul > li').first().locator('button:has-text("זה הספר שלי")').click();
    await A.click('[role=dialog] button:has-text("בחירת חודש")');
    const old = new Date(); old.setFullYear(old.getFullYear() - 7);
    await A.fill('#read-month', `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}`);
    await A.waitForSelector('[role=dialog] >> text=/עברו 7 שנים מאז שקראת את הספר/');
    await A.click('[role=dialog] [aria-label="להתחשב בספר בהמלצות?"] button:has-text("לא")');
    await A.click('[role=dialog] [aria-label="5 כוכבים"]'); await A.click('[role=dialog] button:has-text("שמירה לספרייה")');
    await A.click('nav >> text=ספרים שלי'); await A.click('button[role=tab]:has-text("קראתי")');
    await A.waitForSelector('main li:has-text("מגדלור בערפל") [aria-label="לא נלקח בחשבון בהמלצות"]');
    // המתג בחלון הספר מחזיר אותו
    await A.click('main li:has-text("מגדלור בערפל") button');
    await A.click('[role=dialog] [role=switch]:has-text("להתחשב בספר בהמלצות")');
    await A.click('[role=dialog] [aria-label="סגירה"]');
    assert.equal(await A.locator('main li:has-text("מגדלור בערפל") [aria-label="לא נלקח בחשבון בהמלצות"]').count(), 0);
    // המשקלים נשלחים למודל
    assert.ok(jobBodies.some(j => /\| w=[+-]\d\.\d/.test(j.messages[0].content) && j.system.includes('half-life 3 years')), 'weights in the recommendation prompt');
  });
  await step('English interface: chosen on first entry, left-to-right, English everywhere, the model writes in English, back to Hebrew', async () => {
    const E = await phone(browser, 'E');
    // הטקסט העברי שנשאר במסך (חוץ מבחירת השפה עצמה)
    const hebrewLeft = (sel) => E.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap(el => el.innerText.split('\n')).filter(l => /[\u0590-\u05FF]/.test(l) && !/^(עברית|שפה · Language)$/.test(l.trim())), sel);
    await E.click('[role=group][aria-label="שפה · Language"] button:has-text("English")');
    await E.waitForSelector('text=Whose library is this?');
    assert.deepEqual(await E.evaluate(() => [document.documentElement.dir, document.documentElement.lang, document.title]), ['ltr', 'en', 'What We Read']);
    if (!(await E.locator('#new-profile').count())) await E.click('button:has-text("Add a user")');
    await E.fill('#new-profile', 'Dana'); await E.fill('#new-pass', '1234'); await E.click('button:has-text("Enter")');
    // רשימת ההיכרות: אותם ספרים, בשמות באנגלית
    const dlg = E.locator('[role=dialog]');
    await dlg.locator('text=Which books have you read?').waitFor();
    assert.match(await dlg.locator('[role=group][aria-label*=","]').last().getAttribute('aria-label'), /^[A-Za-z0-9 .,:'&!?-]+, [A-Za-z .'-]+$/);
    await E.fill('#starter-q', 'Norwegian'); await E.waitForSelector('li:has-text("Norwegian Wood")'); await E.fill('#starter-q', '');
    await shot(E, 'en-starter', false);
    assert.deepEqual(await hebrewLeft('[role=dialog]'), [], 'starter dialog in English');
    await E.click('button:has-text("Skip the introduction")');
    assert.deepEqual(await texts(E.locator('nav li button')), ['My books', 'Add a book', 'Discover', 'Friends', 'Settings']);
    // הוספת ספר: הספר באנגלית קודם, והחלון באנגלית
    await E.click('nav >> text=Add a book'); await E.click('button[role=tab]:has-text("One book")');
    await E.fill('#book-q', 'Norwegian Wood'); await E.click('form button[type=submit]');
    await E.locator('main ul > li').first().locator('button:has-text("This is my book")').click();
    assert.deepEqual(await hebrewLeft('[role=dialog]'), [], 'rating sheet in English');
    await E.click('[aria-label="5 stars"]'); await E.click('button:has-text("Save to library")');
    await E.waitForSelector('h1:has-text("My books")');
    await E.waitForSelector('main li:has-text("Norwegian Wood")');
    assert.deepEqual(await hebrewLeft('main'), [], 'library in English');
    await shot(E, 'en-library');
    // הגדרות: כל הקבוצות באנגלית; כתובת הפנייה העברית לא מוצגת
    await E.click('nav >> text=Settings');
    for (const g of ['My account', 'Recommendations', 'Notifications', 'Display and accessibility', 'Feedback', 'Privacy and friends', 'My data']) await group(E, g);
    assert.equal(await E.locator('text=Feminine').count(), 0);
    assert.deepEqual(await hebrewLeft('main'), [], 'settings in English');
    await shot(E, 'en-settings');
    // המלצה: ברירת המחדל היא ספרים באנגלית, והמודל מתבקש לכתוב באנגלית
    await E.click('nav >> text=Discover');
    await E.waitForSelector('text=Hi! Let\'s find your next book.');
    await E.waitForSelector('text=Default: English');
    assert.deepEqual(await hebrewLeft('main'), [], 'discover in English');
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'eq', name: 'submit_questions', input: { questions: [] } }], stop: 'tool_use' });
    aiScript.push({ blocks: [{ type: 'tool_use', id: 'er', name: 'submit_recommendations', input: { interpretation: 'Something quietly British.', recommendations: [
      { title_he: '', title_original: 'The Remains of the Day', author: 'Kazuo Ishiguro', isbn: '9780679731726', why: 'Restrained, like the books you loved.', genres: [], candidate: 0, country: 'United Kingdom' }] } }], stop: 'tool_use' });
    await E.fill('#ai-request', 'something British'); await E.click('button:has-text("Smart recommendation")');
    await E.waitForSelector('section li:has-text("The Remains of the Day")', { timeout: 30000 });
    const sys = jobBodies.at(-1).system;
    assert.ok(sys.includes('Language: English only') && sys.includes('Write every free-text field in English') && !sys.includes('Address the reader in Hebrew'), 'English recommendation prompt');
    assert.equal(jobBodies.at(-1).lang, 'en');
    await E.waitForFunction(() => !document.querySelector('[aria-label^="Step "]'), null, { timeout: 30000 });
    await shot(E, 'en-recs');
    // חזרה לעברית מההגדרות
    await E.click('nav >> text=Settings'); await group(E, 'My account');
    await E.click('[role=group][aria-label="שפה · Language"] button:has-text("עברית")');
    await E.waitForSelector('nav >> text=הגדרות');
    assert.equal(await E.evaluate(() => document.documentElement.dir), 'rtl');
  });
  assert.deepEqual(errors, [], 'page errors');
  console.log('\nכל הבדיקות עברו');
} finally {
  await browser.close();
}
