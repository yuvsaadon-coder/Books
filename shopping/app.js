// קניות בבית: מה חסר, רשימה משותפת, והשוואת מחירים בשופרסל, רמי לוי, קרפור וחצי חינם (משלוחים לירושלים)
import { CATS, PRODUCTS, EMOJI_HINTS } from './products.js';

const SERVER = 'https://books.yuvsaadon.workers.dev';
const KEY = 'shop-state-v1';
const PRICE_KEY = 'shop-prices-v1';
const PRICE_TTL = 12 * 3600 * 1000;
const CHAINS = [
  { id: 'shufersal', name: 'שופרסל', color: '#d8232a', url: 'https://www.shufersal.co.il/online/he/search?text=' },
  { id: 'rami', name: 'רמי לוי', color: '#0a58a8', url: 'https://www.rami-levy.co.il/he/online/search?q=' },
  { id: 'carrefour', name: 'קרפור', color: '#1d4f9c', url: 'https://www.carrefour.co.il/search?q=' },
  { id: 'hazi', name: 'חצי חינם', color: '#e07b00', url: 'https://shop.hazi-hinam.co.il/search?q=' }
];
const DEFAULT_FEE = 30;   // דמי משלוח משוערים; אפשר לשנות בהגדרות

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const money = (n) => '₪' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
const catOf = (id) => CATS.find(c => c.id === id) || CATS[3];
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* מלא או חסום */ } }
};
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('') + now().toString(36).slice(-4);

// ---------- מצב ----------
let S = store.get(KEY) || {};
S.items = S.items || {};
S.prefs = S.prefs || {};
S.fees = S.fees || {};
for (const p of PRODUCTS) if (!S.items[p.id]) S.items[p.id] = { ...p, need: false, qty: 1, got: false, at: 0 };
const urlCode = new URLSearchParams(location.search).get('h');
if (urlCode && /^[a-z0-9]{8,32}$/.test(urlCode)) { S.h = urlCode; history.replaceState(null, '', location.pathname); }
if (!S.h) S.h = newCode();
let view = S.view || 'home', filter = '', catFilter = '', editing = null, prices = store.get(PRICE_KEY) || {}, comparing = null, syncState = 'idle';

const live = () => Object.values(S.items).filter(i => !i.deleted);
const needed = () => live().filter(i => i.need);
function save(sync = true) { store.set(KEY, S); if (sync) scheduleSync(); }
function touch(id, patch) { S.items[id] = { ...S.items[id], ...patch, at: now() }; save(); render(); }

// ---------- סנכרון (השרת ממזג לפי at לכל מוצר) ----------
let syncTimer = null, syncing = false, dirty = false;
function merge(remote) {
  for (const [id, it] of Object.entries(remote.items || {})) if (it && (!S.items[id] || (it.at || 0) > (S.items[id].at || 0))) S.items[id] = it;
  for (const [k, v] of Object.entries(remote.prefs || {})) if (!S.prefs[k] || (v.at || 0) > (S.prefs[k].at || 0)) S.prefs[k] = v;
}
function scheduleSync() { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); }
async function sync() {
  if (syncing) { scheduleSync(); return; }
  syncing = true; syncState = 'busy'; paintSync();
  let send = false;
  try {
    const url = SERVER + '/shop/list?h=' + S.h;
    send = dirty;
    dirty = false;
    const items = Object.fromEntries(Object.entries(S.items).filter(([, i]) => i.at));
    const r = send ? await fetch(url, { method: 'PUT', body: JSON.stringify({ items, prefs: S.prefs }) }) : await fetch(url);
    if (!r.ok) throw new Error(r.status);
    merge(await r.json());
    store.set(KEY, S); syncState = 'ok'; render();
  } catch (e) { syncState = 'off'; if (send) dirty = true; }
  syncing = false; paintSync();
}
function paintSync() { const d = $('#sync'); if (d) { d.dataset.s = syncState; d.title = { busy: 'מסנכרן…', ok: 'מסונכרן', off: 'אין חיבור לשרת – נשמר בטלפון', idle: '' }[syncState]; } }

// ---------- תצוגה ----------
function tileArt(i, big = false) {
  const c = catOf(i.cat);
  if (i.img) return `<span class="art img${big ? ' big' : ''}" style="--c:${c.color}"><img src="${esc(i.img)}" alt="" loading="lazy" onerror="this.parentNode.classList.remove('img');this.remove()"><b>${i.emoji || c.icon}</b></span>`;
  return `<span class="art${big ? ' big' : ''}" style="--c:${c.color}"><b>${i.emoji || c.icon}</b></span>`;
}
function render() {
  document.body.dataset.view = view;
  const n = needed().length;
  $('#count').textContent = n ? String(n) : '';
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-current', b.dataset.v === view ? 'page' : 'false');
  const main = $('main');
  main.innerHTML = view === 'home' ? homeView() : view === 'list' ? listView() : view === 'compare' ? compareView() : settingsView();
  if (view === 'home') { const s = $('#q'); if (s && document.activeElement !== s && filter) { s.focus(); s.setSelectionRange(filter.length, filter.length); } }
  paintSync();
}

function homeView() {
  const f = filter.trim();
  const items = live().filter(i => (!catFilter || i.cat === catFilter) && (!f || i.name.includes(f)));
  const groups = CATS.map(c => ({ c, list: items.filter(i => i.cat === c.id).sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'he')) })).filter(g => g.list.length);
  const chips = `<div class="chips" role="tablist">${[{ id: '', name: 'הכול', icon: '🛒' }, ...CATS].map(c => `<button class="chip" data-cat="${c.id}" aria-pressed="${catFilter === c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>`;
  const add = f && !live().some(i => i.name === f) ? `<button class="tile add" data-add="${esc(f)}">${tileArt({ emoji: '➕', cat: 'home' })}<span class="nm">הוספת "${esc(f)}"</span></button>` : '';
  return `<section class="hero"><h1>מה חסר בבית?</h1><p>${needed().length ? `${needed().length} מוצרים ברשימה` : 'לוחצים על מה שנגמר, וזה עובר לרשימה'}</p></section>
    <div class="search"><input id="q" type="search" placeholder="חיפוש או הוספת מוצר…" value="${esc(filter)}" aria-label="חיפוש מוצר"></div>
    ${chips}
    ${groups.map(g => `<h2 class="cat" style="--c:${g.c.color}">${g.c.icon} ${esc(g.c.name)}</h2><div class="grid">${g.list.map(i => `
      <button class="tile${i.need ? ' on' : ''}" data-toggle="${i.id}" aria-pressed="${!!i.need}">
        ${tileArt(i)}<span class="nm">${esc(i.name)}</span>${i.need ? `<span class="badge">${i.qty > 1 ? '×' + i.qty : '✓'}</span>` : ''}
      </button>`).join('')}</div>`).join('')}
    <div class="grid">${add || `<button class="tile add" data-add="">${tileArt({ emoji: '➕', cat: 'home' })}<span class="nm">מוצר חדש</span></button>`}</div>`;
}

function listView() {
  const list = needed();
  if (!list.length) return `<section class="hero"><h1>הרשימה ריקה</h1><p>בוחרים מוצרים במסך "מה חסר"</p></section><button class="btn primary wide" data-go="home">למסך מה חסר</button>`;
  const got = list.filter(i => i.got).length;
  const groups = CATS.map(c => ({ c, list: list.filter(i => i.cat === c.id) })).filter(g => g.list.length);
  return `<section class="hero"><h1>רשימת קניות</h1><p>${list.length} מוצרים${got ? ` · ${got} כבר בסל` : ''}</p></section>
    <div class="row-btns"><button class="btn" data-share>שליחה בווטסאפ</button><button class="btn" data-go="compare">איפה הכי זול?</button></div>
    ${groups.map(g => `<h2 class="cat" style="--c:${g.c.color}">${g.c.icon} ${esc(g.c.name)}</h2><ul class="list">${g.list.map(i => `
      <li class="${i.got ? 'got' : ''}">
        <label class="check"><input type="checkbox" data-got="${i.id}" ${i.got ? 'checked' : ''}><span>${tileArt(i)}<span class="nm">${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span></span></label>
        <span class="qty"><button data-qty="${i.id}" data-d="-1" aria-label="פחות">−</button><b>${i.qty || 1}</b><button data-qty="${i.id}" data-d="1" aria-label="יותר">+</button></span>
        <button class="icon" data-edit="${i.id}" aria-label="עריכה">✎</button>
      </li>`).join('')}</ul>`).join('')}
    ${got ? `<button class="btn primary wide" data-done>סיימתי – להוריד ${got} מוצרים שנקנו</button>` : ''}
    <button class="btn ghost wide" data-clear>ניקוי כל הרשימה</button>`;
}

// ---------- השוואת מחירים ----------
const words = (s) => String(s).replace(/[^֐-׿a-zA-Z0-9% ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
// בחירת המוצר בכל רשת: מה שנבחר ידנית, אחרת התוצאה שמכילה הכי הרבה ממילות החיפוש (בסדר של החנות)
export function pickProduct(item, chain, results, prefs = {}) {
  if (!results || !results.length) return null;
  const pref = prefs[item.id + '|' + chain];
  if (pref) { const hit = results.find(r => r.name === pref.name); if (hit) return hit; }
  const ws = words(item.name + ' ' + (item.q || ''));
  let best = null, bestScore = 0;
  for (const r of results) {
    const score = ws.filter(w => r.name.includes(w)).length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}
export function basket(items, prices, prefs = {}, fees = {}) {
  const rows = items.map(i => {
    const p = prices[i.id];
    const cells = {};
    for (const c of CHAINS) { const pick = p ? pickProduct(i, c.id, p.chains && p.chains[c.id], prefs) : null; cells[c.id] = pick ? { ...pick, total: pick.price * (i.qty || 1) } : null; }
    const vals = Object.values(cells).filter(Boolean).map(x => x.total);
    return { item: i, cells, min: vals.length ? Math.min(...vals) : 0 };
  });
  // "סל משותף": רק מוצרים שנמצאו בכל הרשתות שענו – כך ההשוואה הוגנת
  const answered = CHAINS.filter(c => rows.some(r => r.cells[c.id]));
  const common = rows.filter(r => answered.every(c => r.cells[c.id]));
  const totals = CHAINS.map(c => {
    const found = rows.filter(r => r.cells[c.id]);
    const fee = Number.isFinite(fees[c.id]) ? fees[c.id] : DEFAULT_FEE;
    return { chain: c, found: found.length, sum: found.reduce((s, r) => s + r.cells[c.id].total, 0), common: common.reduce((s, r) => s + r.cells[c.id].total, 0), fee };
  }).filter(t => t.found);
  const maxFound = Math.max(0, ...totals.map(t => t.found));
  // ההמלצה: הזולה ביותר בסל המשותף + משלוח, מבין הרשתות שמצאו כמעט הכול
  const ranked = [...totals].sort((a, b) => (a.common + a.fee) - (b.common + b.fee));
  const best = ranked.find(t => t.found >= maxFound - 1) || ranked[0] || null;
  return { rows, totals: ranked, best, commonCount: common.length };
}

async function fetchPrices(item, fresh = false) {
  const cached = prices[item.id];
  if (!fresh && cached && cached.q === (item.q || item.name) && now() - cached.at < PRICE_TTL) return cached;
  const r = await fetch(SERVER + '/shop/prices?q=' + encodeURIComponent(item.q || item.name) + (fresh ? '&fresh=1' : ''));
  if (!r.ok) throw new Error(r.status);
  const d = await r.json();
  prices[item.id] = { q: item.q || item.name, at: now(), chains: d.chains || {} };
  // תמונה אמיתית מהחנות, אם עוד אין למוצר
  if (!S.items[item.id].img) {
    const img = CHAINS.map(c => pickProduct(item, c.id, d.chains && d.chains[c.id])).find(x => x && x.image);
    if (img) S.items[item.id] = { ...S.items[item.id], img: img.image, at: now() };
  }
  return prices[item.id];
}
async function runCompare(list, fresh = false) {
  comparing = { done: 0, total: list.length, failed: 0 };
  render();
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const it = list[i++];
      try { await fetchPrices(it, fresh); } catch (e) { comparing.failed++; }
      comparing.done++;
      const bar = $('#progress'); if (bar) { bar.value = comparing.done; $('#progress-t').textContent = `${comparing.done}/${comparing.total}`; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  store.set(PRICE_KEY, prices);
  const failed = comparing.failed;
  comparing = null;
  save();
  render();
  if (failed === list.length) toast('אין חיבור לשרת המחירים. אפשר לחפש בכל רשת דרך הקישורים');
}

function compareView() {
  const list = needed();
  if (!list.length) return `<section class="hero"><h1>איפה הכי משתלם?</h1><p>קודם בוחרים מה חסר, ואז משווים מחירים בשופרסל, רמי לוי, קרפור וחצי חינם</p></section><button class="btn primary wide" data-go="home">למסך מה חסר</button>`;
  if (comparing) return `<section class="hero"><h1>בודק מחירים…</h1><p>שופרסל · רמי לוי · קרפור · חצי חינם</p></section>
    <div class="progress"><progress id="progress" max="${comparing.total}" value="${comparing.done}"></progress><span id="progress-t">${comparing.done}/${comparing.total}</span></div>`;
  const have = list.filter(i => prices[i.id]);
  const head = `<section class="hero"><h1>איפה הכי משתלם?</h1><p>${list.length} מוצרים · משלוח לירושלים</p></section>`;
  if (!have.length) return head + `<button class="btn primary wide" data-compare>השוואת מחירים</button>${linksTable(list)}`;
  const b = basket(list, prices, S.prefs, S.fees);
  const missing = list.length - have.length;
  const cards = b.totals.map(t => `
    <div class="chain${b.best && t.chain.id === b.best.chain.id ? ' best' : ''}" style="--c:${t.chain.color}">
      <div class="chain-h"><b>${t.chain.name}</b>${b.best && t.chain.id === b.best.chain.id ? '<span class="tag">הכי משתלם</span>' : ''}</div>
      <div class="sum">${money(t.common + t.fee)}</div>
      <div class="sub">סל משותף (${b.commonCount} מוצרים) ${money(t.common)} + משלוח ${money(t.fee)}</div>
      <div class="sub">נמצאו ${t.found} מתוך ${list.length} · כל מה שנמצא: ${money(t.sum)}</div>
    </div>`).join('');
  const save1 = b.totals.length > 1 ? (b.totals[b.totals.length - 1].common + b.totals[b.totals.length - 1].fee) - (b.best.common + b.best.fee) : 0;
  const rec = b.best ? `<div class="rec">🏆 כדאי להזמין ב<b>${b.best.chain.name}</b>${save1 > 1 ? ` – חיסכון של כ-${money(save1)} לעומת היקרה ביותר` : ''}.
     ${b.best.found < list.length ? `<br><small>${list.length - b.best.found === 1 ? 'מוצר אחד לא נמצא' : (list.length - b.best.found) + ' מוצרים לא נמצאו'} שם – מסומנים בטבלה</small>` : ''}</div>` : '';
  const table = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>מוצר</th>${CHAINS.map(c => `<th style="--c:${c.color}">${c.name}</th>`).join('')}</tr></thead><tbody>
    ${b.rows.map(r => `<tr><th>${tileArt(r.item)}<span>${esc(r.item.name)}${r.item.qty > 1 ? ` ×${r.item.qty}` : ''}</span></th>${CHAINS.map(c => {
      const x = r.cells[c.id], res = prices[r.item.id] && prices[r.item.id].chains && prices[r.item.id].chains[c.id] || [];
      if (!x) return `<td class="none"><a href="${c.url + encodeURIComponent(r.item.q || r.item.name)}" target="_blank" rel="noopener">${prices[r.item.id] ? 'לא נמצא' : '—'} ↗</a></td>`;
      return `<td class="${x.total === r.min ? 'min' : ''}"><div class="price">${money(x.total)}</div>
        ${res.length > 1 ? `<select data-pref="${r.item.id}|${c.id}" aria-label="מוצר אחר ב${c.name}">${res.map(o => `<option${o.name === x.name ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>` : `<div class="pn">${esc(x.name)}</div>`}
        <a class="pn" href="${esc(x.url || c.url + encodeURIComponent(r.item.q || r.item.name))}" target="_blank" rel="noopener">לאתר ↗</a></td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
  return head + rec + `<div class="chains">${cards}</div>` +
    (missing ? `<p class="note">${missing} מוצרים עוד לא נבדקו</p>` : '') +
    `<div class="row-btns"><button class="btn primary" data-compare>${missing ? 'בדיקת כל הרשימה' : 'רענון מחירים'}</button></div>` + table +
    `<p class="note">המחירים מאתרי הרשתות; מבצעים במועדון ודמי משלוח מדויקים מופיעים רק בקופה. דמי המשלוח המשוערים נקבעים בהגדרות.</p>`;
}
function linksTable(list) {
  return `<h2 class="cat">חיפוש ידני בכל רשת</h2><ul class="list links">${list.map(i => `<li>${tileArt(i)}<span class="nm">${esc(i.name)}</span><span class="lk">${CHAINS.map(c => `<a style="--c:${c.color}" href="${c.url + encodeURIComponent(i.q || i.name)}" target="_blank" rel="noopener">${c.name}</a>`).join('')}</span></li>`).join('')}</ul>`;
}

// ---------- הגדרות ----------
function settingsView() {
  const link = location.origin + location.pathname + '?h=' + S.h;
  const removed = Object.values(S.items).filter(i => i.deleted);
  return `<section class="hero"><h1>הגדרות</h1><p>רשימה אחת לכל הבית</p></section>
    <div class="card"><h3>שיתוף הרשימה</h3>
      <p>מי שפותח את הקישור הזה רואה ומעדכן את אותה רשימה.</p>
      <div class="code">${esc(link)}</div>
      <div class="row-btns"><button class="btn primary" data-sharelink>שליחת הקישור בווטסאפ</button><button class="btn" data-copy>העתקה</button></div>
      <label class="field">הצטרפות לבית קיים (קוד)<span class="row"><input id="join" placeholder="קוד הבית" autocomplete="off"><button class="btn" data-join>הצטרפות</button></span></label>
    </div>
    <div class="card"><h3>דמי משלוח משוערים</h3>
      ${CHAINS.map(c => `<label class="field inline">${c.name}<span class="row">₪<input type="number" min="0" step="0.1" inputmode="decimal" data-fee="${c.id}" value="${Number.isFinite(S.fees[c.id]) ? S.fees[c.id] : DEFAULT_FEE}"></span></label>`).join('')}
    </div>
    <div class="card"><h3>תמונות</h3><p>תמונות המוצרים נלקחות מאתרי הרשתות בזמן השוואת המחירים.</p>
      <div class="row-btns"><button class="btn" data-loadimgs>טעינת תמונות לכל המוצרים</button><button class="btn ghost" data-noimgs>חזרה לאיורים</button></div></div>
    <div class="card"><h3>מוצרים</h3><ul class="list compact">${live().sort((a, b) => a.name.localeCompare(b.name, 'he')).map(i => `<li>${tileArt(i)}<span class="nm">${esc(i.name)}</span><button class="icon" data-edit="${i.id}" aria-label="עריכה">✎</button></li>`).join('')}</ul>
      <button class="btn wide" data-add="">מוצר חדש</button>
      ${removed.length ? `<details><summary>מוצרים שנמחקו (${removed.length})</summary><ul class="list compact">${removed.map(i => `<li>${tileArt(i)}<span class="nm">${esc(i.name)}</span><button class="btn" data-restore="${i.id}">החזרה</button></li>`).join('')}</ul></details>` : ''}
    </div>
    <p class="note">הרשימה ההתחלתית: ${PRODUCTS.length} מוצרים שהופיעו לפחות 3 פעמים בקבוצה "קניות מקסימות".</p>`;
}

// ---------- עריכה / הוספה ----------
function guessEmoji(name) { const h = EMOJI_HINTS.find(([re]) => re.test(name)); return h ? h[1] : ''; }
function openEditor(id, name = '') {
  editing = id;
  const it = id === 'new' ? { id: 'new', name, cat: 'pantry', emoji: guessEmoji(name), q: '', note: '' } : S.items[id];
  const dlg = $('#editor');
  dlg.innerHTML = `<form method="dialog" class="sheet">
    <h3>${id === 'new' ? 'מוצר חדש' : 'עריכת מוצר'}</h3>
    <label class="field">שם<input name="name" required value="${esc(it.name)}" autocomplete="off"></label>
    <label class="field">קטגוריה<select name="cat">${CATS.map(c => `<option value="${c.id}"${c.id === it.cat ? ' selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field">סמל (אימוג'י)<input name="emoji" value="${esc(it.emoji || '')}" maxlength="4" placeholder="${catOf(it.cat).icon}"></label>
    <label class="field">מה לחפש באתרי הרשתות<input name="q" value="${esc(it.q || '')}" placeholder="${esc(it.name || 'למשל: חלב 3% 1 ליטר')}"></label>
    <label class="field">הערה<input name="note" value="${esc(it.note || '')}" placeholder="למשל: בלי גלעין, 1 ק״ג"></label>
    <div class="row-btns"><button class="btn primary" value="save">שמירה</button><button class="btn" value="cancel" formnovalidate>ביטול</button>${id !== 'new' ? '<button class="btn danger" value="delete" formnovalidate>מחיקה</button>' : ''}</div>
  </form>`;
  const form = $('form', dlg);
  form.name.addEventListener('input', () => { if (!form.emoji.value) form.emoji.placeholder = guessEmoji(form.name.value) || catOf(form.cat.value).icon; });
  dlg.onclose = () => {
    const v = dlg.returnValue; editing = null;
    if (v === 'delete') { touch(id, { deleted: true, need: false }); toast('נמחק. אפשר להחזיר מההגדרות'); return; }
    if (v !== 'save') return;
    const name = form.name.value.trim(); if (!name) return;
    const data = { name, cat: form.cat.value, emoji: form.emoji.value.trim() || guessEmoji(name), q: form.q.value.trim(), note: form.note.value.trim() };
    if (id === 'new') {
      const nid = 'u' + now().toString(36) + Math.random().toString(36).slice(2, 5);
      S.items[nid] = { id: nid, ...data, count: 0, need: true, qty: 1, got: false, at: now() };
      filter = ''; save(); render(); toast(`"${name}" נוסף לרשימה`);
    } else touch(id, data);
  };
  if (!dlg.open) dlg.showModal();
  form.name.focus();
}

let toastTimer;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200); }

function shareText() {
  const groups = CATS.map(c => ({ c, list: needed().filter(i => i.cat === c.id) })).filter(g => g.list.length);
  return 'רשימת קניות 🛒\n' + groups.map(g => `\n${g.c.icon} ${g.c.name}\n` + g.list.map(i => `• ${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}${i.note ? ' (' + i.note + ')' : ''}`).join('\n')).join('\n');
}
async function share(text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

// ---------- אירועים ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-go]');
  if (!t) return;
  const d = t.dataset;
  if (d.v) { view = d.v; S.view = view; save(false); render(); scrollTo(0, 0); }
  else if (d.go) { view = d.go; S.view = view; save(false); render(); scrollTo(0, 0); }
  else if (d.toggle) { const i = S.items[d.toggle]; touch(d.toggle, { need: !i.need, got: false, qty: i.need ? 1 : (i.qty || 1) }); if (navigator.vibrate) navigator.vibrate(10); }
  else if (d.cat !== undefined && t.classList.contains('chip')) { catFilter = d.cat; render(); }
  else if (d.add !== undefined) openEditor('new', d.add);
  else if (d.edit) openEditor(d.edit);
  else if (d.qty) { const i = S.items[d.qty]; touch(d.qty, { qty: Math.max(1, Math.min(99, (i.qty || 1) + Number(d.d))) }); }
  else if ('done' in d) { for (const i of needed().filter(i => i.got)) S.items[i.id] = { ...i, need: false, got: false, qty: 1, at: now() }; save(); render(); toast('יופי! הרשימה עודכנה'); }
  else if ('clear' in d) { if (confirm('לנקות את כל הרשימה?')) { for (const i of needed()) S.items[i.id] = { ...i, need: false, got: false, qty: 1, at: now() }; save(); render(); } }
  else if ('share' in d) share(shareText());
  else if ('compare' in d) runCompare(needed(), needed().every(i => prices[i.id]));   // הכול כבר נבדק = רענון
  else if ('sharelink' in d) share('הרשימה המשותפת שלנו לקניות 🛒\n' + location.origin + location.pathname + '?h=' + S.h);
  else if ('copy' in d) { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname + '?h=' + S.h).then(() => toast('הקישור הועתק')); }
  else if ('join' in d) { const v = $('#join').value.trim().toLowerCase().replace(/.*[?&]h=/, ''); if (/^[a-z0-9]{8,32}$/.test(v)) { S.h = v; save(false); sync(); toast('מחובר לרשימה המשותפת'); render(); } else toast('הקוד לא תקין'); }
  else if (d.restore) { touch(d.restore, { deleted: false }); }
  else if ('loadimgs' in d) { runCompare(live().filter(i => !i.img)).then(() => toast('התמונות עודכנו')); }
  else if ('noimgs' in d) { for (const i of live()) if (i.img) S.items[i.id] = { ...i, img: '', at: now() }; save(); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { filter = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#q'); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.got) touch(t.dataset.got, { got: t.checked });
  else if (t.dataset.pref) { S.prefs[t.dataset.pref] = { name: t.value, at: now() }; save(); render(); }
  else if (t.dataset.fee) { const n = Number(t.value); S.fees[t.dataset.fee] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_FEE; save(false); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'q' && filter.trim()) {
    const f = filter.trim(), hit = live().find(i => i.name === f);
    if (hit) { touch(hit.id, { need: true }); filter = ''; render(); toast(`"${f}" ברשימה`); } else openEditor('new', f);
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden && !syncing) sync(); }, 30000);

render();
sync();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
