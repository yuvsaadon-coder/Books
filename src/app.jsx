import { STARTER } from './starter-books.js';
const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ============================================================
   קבועים
   ============================================================ */
const DEFAULT_LOCALE = 'he-IL';
const API_PRIMARY = 'https://www.googleapis.com/books/v1/volumes';
const OL_BASE = 'https://openlibrary.org';
const APP_VERSION = '21';   // מוצג בהגדרות, כדי לוודא שהטלפון טען את הגרסה העדכנית
const STORAGE_KEY = 'verified_reading_tracker_db_v1';
const PROFILES_KEY = 'verified_reading_tracker_profiles_v1';
// לכל משתמש מפתחות אחסון משלו. המשתמש הראשון ('default') יורש את הנתונים שהיו לפני שנוספו משתמשים.
const dbKeyFor = (pid) => pid === 'default' ? STORAGE_KEY : STORAGE_KEY + '__' + pid;
const queueKeyFor = (pid) => pid === 'default' ? 'verified_reading_tracker_queue_v1' : 'verified_reading_tracker_queue_v1__' + pid;
const ACTIVE = { id: 'default', dbKey: STORAGE_KEY, queueKey: queueKeyFor('default') };
const IDB_NAME = 'verified_reading_tracker';
const IDB_STORE = 'kv';
const SCHEMA_VERSION = 1;

const DEFAULT_TAGS = ['מתח', 'קצב איטי', 'קצב מהיר', 'ספרות מופת', 'מד"ב', 'פנטזיה', 'היסטורי', 'רומנטיקה', 'הומור', 'עיון', 'ביוגרפיה', 'מרגש', 'מעורר מחשבה', 'בלש'];

// מיפוי תגיות בעברית לנושאים (subjects) באנגלית לשאילתות API
const TAG_SUBJECTS = {
  'מתח': 'thriller', 'מותחן': 'thriller', 'קצב מהיר': 'thriller', 'מד"ב': 'science fiction', 'מדע בדיוני': 'science fiction',
  'פנטזיה': 'fantasy', 'היסטורי': 'historical fiction', 'רומנטיקה': 'romance', 'הומור': 'humor',
  'ביוגרפיה': 'biography', 'עיון': 'nonfiction', 'בלש': 'mystery', 'אימה': 'horror', 'ספרות מופת': 'classics',
  'קלאסיקה': 'classics', 'פסיכולוגיה': 'psychology', 'מדע': 'science', 'היסטוריה': 'history', 'נוער': 'young adult',
  'מרגש': 'family', 'מעורר מחשבה': 'philosophy', 'דיסטופיה': 'dystopia', 'פילוסופיה': 'philosophy'
};

const MOODS = {
  thrill: { label: 'מותח וסוחף', en: 'thriller', he: 'מותחן', kw: ['thriller', 'suspense', 'mystery', 'crime', 'detective', 'מתח', 'מותחן', 'בלש', 'פשע'] },
  light: { label: 'קליל ומצחיק', en: 'humor', he: 'הומור', kw: ['humor', 'humorous', 'comedy', 'comic', 'funny', 'satire', 'הומור', 'מצחיק', 'סאטירה'] },
  deep: { label: 'מעמיק ומעורר מחשבה', en: 'literary fiction', he: 'ספרות יפה', kw: ['literary', 'philosoph', 'psycholog', 'existential', 'ספרות', 'פילוסופ', 'הגות'] },
  emotional: { label: 'מרגש ונוגע ללב', en: 'family', he: 'רומן משפחתי', kw: ['family', 'friendship', 'love', 'coming of age', 'grief', 'משפחה', 'חברות', 'אהבה', 'התבגרות'] },
  imaginative: { label: 'עולמות דמיוניים', en: 'fantasy', he: 'פנטזיה', kw: ['fantasy', 'science fiction', 'magic', 'dystop', 'פנטזיה', 'מדע בדיוני', 'קסם'] },
  surprise: { label: 'תפתיעו אותי', en: '', he: '', kw: [] }
};
const PACING = {
  fast: { label: 'מהיר, קשה להניח מהיד', kw: ['thriller', 'action', 'adventure', 'suspense', 'page-turner', 'fast-paced', 'מתח', 'הרפתק', 'מותחן'] },
  medium: { label: 'מאוזן', kw: [] },
  slow: { label: 'איטי ומתבשל', kw: ['literary', 'saga', 'contemplative', 'classic', 'ספרות', 'סאגה', 'קלאסי'] },
  any: { label: 'לא משנה לי', kw: [] }
};
const AVOID = {
  violence: { label: 'אלימות קשה ואימה', kw: ['horror', 'gore', 'serial killer', 'violent', 'אימה', 'רוצח סדרתי'] },
  romance: { label: 'רומנטיקה', kw: ['romance', 'romantic', 'רומנטי', 'רומנטיקה'] },
  speculative: { label: 'מד"ב ופנטזיה', kw: ['fantasy', 'science fiction', 'sci-fi', 'dystop', 'פנטזיה', 'מדע בדיוני'] },
  war: { label: 'מלחמה ושואה', kw: ['world war', 'wwii', 'military', 'holocaust', 'מלחמה', 'שואה'] },
  tragedy: { label: 'טרגדיה ועצב כבד', kw: ['tragedy', 'tragic', 'grief', 'bereavement', 'טרגדיה', 'אבל', 'שכול'] }
};
const LENGTHS = {
  short: { label: 'קצר (עד 250 עמ\')', range: [1, 250] },
  medium: { label: 'בינוני (250–450 עמ\')', range: [250, 450] },
  long: { label: 'ארוך (450+ עמ\')', range: [450, 100000] },
  any: { label: 'לא משנה לי', range: null }
};
const JUNK_TITLE = /(summary of|study guide|sparknotes|cliffsnotes|cliff'?s notes|workbook|analysis of|quicklet|book review|סיכום הספר|מדריך למורה)/i;

const CONFIG = { apiKey: '' };

/* ============================================================
   עזרי טקסט
   ============================================================ */
const hasHebrew = (s) => /[֐-׿]/.test(s || '');
const norm = (s) => (s || '').toString().toLowerCase()
  .replace(/[֑-ׇ]/g, '')
  .replace(/[“”"'`׳״´’‘]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ').trim();
const normTitle = (t) => norm((t || '').split(/[:：]/)[0]);
const dedupeKey = (b) => normTitle(b.title) + '|' + norm((b.authors || [])[0] || '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtDate = (ts) => { try { return new Date(ts).toLocaleDateString(DEFAULT_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
const fmtDateTime = (ts) => { try { return new Date(ts).toLocaleString(DEFAULT_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const langLabel = (l) => ({ iw: 'עברית', he: 'עברית', heb: 'עברית', en: 'אנגלית', eng: 'אנגלית' }[l] || (l ? l.toUpperCase() : ''));

function cleanText(html) {
  if (!html) return '';
  let t = html;
  try {
    const doc = new DOMParser().parseFromString('<div>' + html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n') + '</div>', 'text/html');
    t = doc.body.textContent || '';
  } catch (e) { t = html.replace(/<[^>]+>/g, ' '); }
  t = t.split(/\n-{4,}|\n\*{4,}/)[0];                  // Open Library: הערות מקור
  t = t.replace(/\[([^\]]+)\]\[\d+\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/\(\[source\]\)|\(\[?Source\]?[^)]*\)/gi, '');
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function splitCats(cats) {
  const out = [];
  (cats || []).forEach(c => String(c).split('/').forEach(p => {
    const s = p.trim();
    if (s && !/^general$/i.test(s) && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }));
  return out;
}
function extractISBN(s) {
  const compact = (s || '').replace(/[\s-]/g, '');
  const m13 = compact.match(/97[89]\d{10}/);
  if (m13) return m13[0];
  const m10 = compact.match(/(?:^|[^\d])(\d{9}[\dXx])(?:[^\d]|$)/);
  if (m10) return m10[1].toUpperCase();
  return null;
}
const isPureISBN = (s) => /^(97[89])?\d{9}[\dXx]$/.test((s || '').replace(/[\s-]/g, ''));
function tryURL(s) {
  const t = (s || '').trim();
  if (!/^https?:\/\//i.test(t) && !/^(www\.|books\.google|openlibrary\.org)/i.test(t)) return null;
  try { return new URL(/^https?:/i.test(t) ? t : 'https://' + t); } catch (e) { return null; }
}

/* ============================================================
   שכבת רשת: Google Books + Open Library
   ============================================================ */
const httpCache = new Map();
const googleState = { blockedUntil: 0, lastError: '' };
const googleAvailable = () => Date.now() > googleState.blockedUntil;

async function fetchJSON(url, timeout = 12000) {
  if (httpCache.has(url)) return httpCache.get(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    const data = await res.json();
    httpCache.set(url, data);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('timeout'); t.status = 0; throw t; }
    throw e;
  } finally { clearTimeout(timer); }
}

function googleUrl(path, params) {
  const u = new URL(API_PRIMARY + (path || ''));
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v); });
  u.searchParams.set('country', 'IL');   // בלי זה Google מחזיר 403 כשאינו מזהה את מיקום המשתמש (VPN וכד')
  if (CONFIG.apiKey) u.searchParams.set('key', CONFIG.apiKey);
  return u.toString();
}
async function googleFetch(url) {
  // אם בשרת המשפחתי מוגדר מפתח Google Books, עוברים דרכו (מפתח משותף + מטמון); מפתח אישי במכשיר גובר
  const c = loadCloud();
  if (c && SYNC.gbooks !== false && !CONFIG.apiKey) {   // גם לפני שה-ping חזר: השרת עונה גם בלי מפתח
    try { return await fetchJSON(c.url + '/gbooks?u=' + encodeURIComponent(url)); }
    catch (e) { if (e.status === 400) throw e; /* נופלים לחיפוש ישיר */ }
  }
  try { return await fetchJSON(url); }
  catch (e) {
    if (e.status === 429 || e.status === 403) {
      googleState.blockedUntil = Date.now() + 10 * 60 * 1000;
      googleState.lastError = e.status === 429 ? 'חרגנו ממכסת השאילתות היומית של Google Books' : 'Google Books דחה את הבקשה';
    } else if (!e.status) {
      googleState.lastError = 'אין חיבור ל-Google Books';
    }
    throw e;
  }
}
function normGoogle(item) {
  const v = item.volumeInfo || {};
  const img = v.imageLinks || {};
  let cover = img.thumbnail || img.smallThumbnail || '';
  cover = cover.replace(/^http:/, 'https:').replace('&edge=curl', '');
  return {
    key: 'gb:' + item.id, source: 'google', sourceId: item.id,
    title: v.title || '', subtitle: v.subtitle || '', authors: v.authors || [],
    year: (v.publishedDate || '').slice(0, 4), description: cleanText(v.description || ''),
    categories: splitCats(v.categories), cover, pageCount: v.pageCount || 0, language: v.language || '',
    isbns: (v.industryIdentifiers || []).filter(x => /ISBN/.test(x.type)).map(x => x.identifier),
    link: v.canonicalVolumeLink || v.infoLink || ('https://books.google.com/books?id=' + item.id),
    avgRating: v.averageRating || 0, ratingsCount: v.ratingsCount || 0, publisher: v.publisher || '',
    ebook: !!(item.saleInfo && item.saleInfo.isEbook),
    ebookLink: (item.saleInfo && item.saleInfo.buyLink) || (item.accessInfo && item.accessInfo.webReaderLink) || ''
  };
}
async function googleSearch(q, { lang, max = 12 } = {}) {
  const data = await googleFetch(googleUrl('', { q, langRestrict: lang, maxResults: max, printType: 'books', orderBy: 'relevance' }));
  return (data.items || []).map(normGoogle).filter(b => b.title);
}
async function googleById(id) {
  const data = await googleFetch(googleUrl('/' + encodeURIComponent(id), {}));
  return data && data.id ? normGoogle(data) : null;
}

function normOL(doc) {
  return {
    key: 'ol:' + doc.key, source: 'openlibrary', sourceId: doc.key,
    title: doc.title || '', subtitle: doc.subtitle || '', authors: doc.author_name || [],
    year: doc.first_publish_year ? String(doc.first_publish_year) : '', description: '',
    categories: (doc.subject || []).slice(0, 8), cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
    pageCount: doc.number_of_pages_median || 0, language: (doc.language || [])[0] || '',
    isbns: (doc.isbn || []).slice(0, 8), link: OL_BASE + doc.key,
    avgRating: doc.ratings_average ? Math.round(doc.ratings_average * 10) / 10 : 0, ratingsCount: doc.ratings_count || 0, publisher: '',
    olEbook: doc.ebook_access === 'borrowable' || doc.ebook_access === 'public'
  };
}
const OL_FIELDS = 'key,title,subtitle,author_name,first_publish_year,cover_i,isbn,subject,number_of_pages_median,language,ratings_average,ratings_count,ebook_access';
async function olSearch({ q, title, author, subject, lang, limit = 12 }) {
  const u = new URL(OL_BASE + '/search.json');
  let query = q || '';
  if (lang === 'he') query = (query + ' language:heb').trim();
  if (lang === 'en') query = (query + ' language:eng').trim();
  if (query) u.searchParams.set('q', query);
  if (title) u.searchParams.set('title', title);
  if (author) u.searchParams.set('author', author);
  if (subject) u.searchParams.set('subject', subject);
  u.searchParams.set('fields', OL_FIELDS);
  u.searchParams.set('limit', limit);
  const data = await fetchJSON(u.toString());
  return (data.docs || []).map(normOL).filter(b => b.title);
}
async function olWork(workKey) {
  const data = await fetchJSON(OL_BASE + workKey + '.json');
  const d = data.description;
  return {
    title: data.title || '',
    description: cleanText(typeof d === 'string' ? d : (d && d.value) || ''),
    cover: data.covers && data.covers[0] > 0 ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-M.jpg` : ''
  };
}
async function olEnrich(list, n = 6) {
  await Promise.all(list.slice(0, n).map(async (b) => {
    try { const w = await olWork(b.sourceId); b.description = w.description; if (!b.cover) b.cover = w.cover; } catch (e) { /* ללא תקציר */ }
  }));
  return list;
}
async function olByEditionKey(editionKey) {
  const ed = await fetchJSON(OL_BASE + editionKey + '.json');
  const workKey = ed.works && ed.works[0] && ed.works[0].key;
  if (!workKey) return null;
  return olByWorkKey(workKey, ed);
}
async function olByWorkKey(workKey, edition) {
  const res = await olSearch({ q: 'key:' + workKey, limit: 1 });
  let b = res[0];
  if (!b) {
    const w = await fetchJSON(OL_BASE + workKey + '.json');
    b = normOL({ key: workKey, title: w.title, subject: w.subjects });
  }
  await olEnrich([b], 1);
  if (edition) {
    if (!b.pageCount && edition.number_of_pages) b.pageCount = edition.number_of_pages;
    const isb = [].concat(edition.isbn_13 || [], edition.isbn_10 || []);
    b.isbns = Array.from(new Set(isb.concat(b.isbns)));
  }
  return b;
}
async function olByISBN(isbn) {
  return olByEditionKey('/isbn/' + isbn);
}

function mergeUnique(a, b) {
  const seen = new Set(a.map(x => x.key));
  const seenD = new Set(a.map(dedupeKey));
  const out = a.slice();
  b.forEach(x => { if (!seen.has(x.key) && !seenD.has(dedupeKey(x))) { out.push(x); seen.add(x.key); seenD.add(dedupeKey(x)); } });
  return out;
}
function mergeByKey(a, b) {
  const seen = new Set(a.map(x => x.key));
  return a.concat(b.filter(x => !seen.has(x.key) && seen.add(x.key)));
}
// קיבוץ מהדורות/הדפסות של אותה יצירה לכרטיס אחד. מקבצים לפי שם בלבד, כי Google רושם
// אותה מהדורה עברית עם איותים שונים של המחבר (עברית, אנגלית, יפנית) או בלי מחבר בכלל
function groupEditions(list) {
  const groups = [];
  const byKey = new Map();
  list.forEach(c => {
    const k = normTitle(c.title) || dedupeKey(c);
    const g = byKey.get(k);
    if (g) g.editions.push(c);
    else { const ng = { key: k, main: c, editions: [c] }; byKey.set(k, ng); groups.push(ng); }
  });
  groups.forEach(g => {
    // הרשומה הראשית: זו עם הכי הרבה מידע (תקציר, כריכה)
    const info = (c) => (isHebrewEdition(c) ? 3 : 0) + (hasHebrew(c.description) ? 1.5 : 0) + (c.description ? 2 : 0) + (c.cover ? 1 : 0) + (c.pageCount ? 0.5 : 0) + (c.authors.length ? 1 : 0) + (c.authors.some(hasHebrew) ? 0.5 : 0);
    g.main = g.editions.slice().sort((a, b) => info(b) - info(a))[0];
  });
  return groups.slice(0, 10);
}
function withWorkInfo(ed, main) {
  return {
    ...ed,
    description: ed.description || main.description, descSource: ed.description ? ed.descSource : main.descSource,
    categories: ed.categories && ed.categories.length ? ed.categories : main.categories,
    authors: ed.authors && ed.authors.length ? ed.authors : main.authors,
    cover: ed.cover || main.cover
  };
}
async function olEditions(workKey, work) {
  const data = await fetchJSON(OL_BASE + workKey + '/editions.json?limit=40');
  return (data.entries || []).map(e => {
    const lang = (((e.languages || [])[0] || {}).key || '').split('/').pop();
    const yr = (e.publish_date || '').match(/\d{4}/);
    return {
      ...work, key: 'ol:' + workKey, editionKey: e.key, sourceId: workKey,
      title: e.title || work.title, subtitle: e.subtitle || '',
      publisher: (e.publishers || []).join(', '), year: yr ? yr[0] : '',
      pageCount: e.number_of_pages || 0,
      cover: e.covers && e.covers[0] > 0 ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-M.jpg` : '',
      isbns: [].concat(e.isbn_13 || [], e.isbn_10 || []), language: lang || '',
      link: OL_BASE + e.key, verifiedVia: 'Open Library'
    };
  }).sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.year || '').localeCompare(a.year || ''));
}

/* ---------- התאמה גמישה ----------
   משווים "שלד" של מילים: בלי ניקוד, אותיות סופיות מנורמלות, בלי ו/י באמצע מילה (כתיב מלא/חסר),
   בלי אותיות כפולות. מילים נחשבות תואמות גם בהתחלה משותפת או בהבדל של אות-שתיים. */
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const STOPWORDS = new Set(['של', 'את', 'על', 'the', 'a', 'an', 'of', 'and', 'by', 'מאת']);
function skel(str) {
  return norm(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ךםןףץ]/g, c => FINALS[c])
    .split(' ').filter(Boolean)
    .map(w => (hasHebrew(w) && w.length > 2 ? w[0] + w.slice(1).replace(/[וי]/g, '') : w).replace(/(.)\1+/g, '$1'))
    .filter(w => w && !STOPWORDS.has(w));
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function tokMatch(a, b) {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  // תחיליות עבריות: ה/ו/ב/ל/מ/ש/כ לפני מילה
  if (hasHebrew(a) && a.length > 3 && 'הובלמשכ'.includes(a[0]) && a.slice(1) === b) return 0.9;
  if (hasHebrew(b) && b.length > 3 && 'הובלמשכ'.includes(b[0]) && b.slice(1) === a) return 0.9;
  const L = Math.max(a.length, b.length);
  if (L >= 4 && lev(a, b) <= (L >= 7 ? 2 : 1)) return 0.75;
  return 0;
}
function coverage(src, dst) {
  if (!src.length) return 0;
  return src.reduce((acc, t) => acc + Math.max(0, ...dst.map(d => tokMatch(t, d))), 0) / src.length;
}
// ציון 0–1: כמה משם הספר מופיע בחיפוש, וכמה מהחיפוש מוסבר ע"י שם הספר + המחבר
function matchScore(c, query) {
  const q = skel(query);
  if (!q.length) return 0;
  const title = skel(c.title);
  const full = title.concat(skel(c.subtitle || ''), skel((c.authors || []).join(' ')));
  return 0.55 * coverage(title, q) + 0.45 * coverage(q, full);
}
// וריאציות חיפוש: פיצול שם+מחבר שנכתבו יחד, שם משפחה בלבד, וכתיב עברי חלופי
function queryVariants(text, author) {
  const out = [];
  const add = (q, label) => { q = q.replace(/\s+/g, ' ').trim(); if (q && q !== text && !out.some(o => o.q === q)) out.push({ q, label }); };
  const clean = text.replace(/["'׳״`]/g, '').replace(/[-–—,]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  const withAuthor = (t) => author ? `${t} inauthor:${author.split(/\s+/).pop()}` : t;
  if (author) {
    add(`${clean} inauthor:${author.split(/\s+/).pop()}`, `מחבר לפי שם משפחה: ${author.split(/\s+/).pop()}`);
    add(clean, 'בלי שם המחבר');
  } else if (words.length >= 2) {
    for (const k of [1, 2]) {
      if (words.length - k < 1) continue;
      const tEnd = words.slice(0, -k).join(' '), aEnd = words.slice(-k).join(' ');
      const tStart = words.slice(k).join(' '), aStart = words.slice(0, k).join(' ');
      add(`${tEnd} inauthor:${aEnd}`, `"${tEnd}" מאת ${aEnd}`);
      add(`${tStart} inauthor:${aStart}`, `"${tStart}" מאת ${aStart}`);
    }
  }
  if (hasHebrew(clean)) {
    const swaps = [
      [/וו/g, 'ו'], [/(?<=[\u05D0-\u05EA])ו(?=[\u05D0-\u05EA])/g, 'וו'], [/יי/g, 'י'],
      [/(?<=[\u05D0-\u05EA])וו(?=[\u05D0-\u05EA])/g, 'ב'], [/(?<=[\u05D0-\u05EA])ב(?=[\u05D0-\u05EA])/g, 'וו'],
      [/(?<=[\u05D0-\u05EA])י(?=[\u05D0-\u05EA]{2})/g, '']
    ];
    swaps.forEach(([re, rep]) => { const v = clean.replace(re, rep); if (v !== clean) add(withAuthor(v), `כתיב: ${v}`); });
  }
  if (clean !== text) add(withAuthor(clean), 'בלי סימני פיסוק');
  return out.slice(0, 8);
}

const isHebrewEdition = (b) => ['iw', 'he', 'heb'].includes(b.language) || hasHebrew(b.title);
function rankByTitle(list, text) {
  const score = (b) => {
    b.match = matchScore(b, text);
    // עדיפות לעברית: מהדורה עברית עולה מעל מהדורה לועזית עם התאמה דומה
    return b.match * 10 + (isHebrewEdition(b) ? 2 : 0) + (b.cover ? 0.3 : 0) + (b.description ? 0.3 : 0) + (b.authors.length ? 0.2 : 0);
  };
  return list.map((b, i) => ({ b, i, s: score(b) })).sort((x, y) => y.s - x.s || x.i - y.i).map(x => x.b);
}

/* ---------- גשר עברית: Wikidata + ויקיפדיה ----------
   Open Library כמעט לא מכיל שמות בעברית. Wikidata ממפה שם עברי לשם המקור ולמחבר,
   ומשם מאתרים את הרשומה ב-Open Library. אם אין שם רשומה, מציגים את רשומת Wikidata עצמה עם התקציר מוויקיפדיה. */
const WD_API = 'https://www.wikidata.org/w/api.php';
async function wdApi(params) {
  const u = new URL(WD_API);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  return fetchJSON(u.toString());
}
const wdClaims = (ent, p) => (((ent && ent.claims) || {})[p] || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean);
const wdLabel = (ent, l) => (ent && ent.labels && ent.labels[l] && ent.labels[l].value) || '';
async function wikiSummary(lang, title) {
  const d = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  return { text: d.type === 'disambiguation' ? '' : (d.extract || ''), thumb: (d.thumbnail && d.thumbnail.source) || '', url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || '' };
}
async function wikidataBooks(text, author) {
  const s = await wdApi({ action: 'wbsearchentities', search: text, language: hasHebrew(text) ? 'he' : 'en', uselang: 'he', type: 'item', limit: 12 });
  const ids = (s.search || []).map(x => x.id);
  if (!ids.length) return [];
  const e = await wdApi({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims|sitelinks', languages: 'he|en' });
  const ents = ids.map(id => (e.entities || {})[id]).filter(x => x && wdClaims(x, 'P50').length);   // רק יצירות עם מחבר
  if (!ents.length) return [];
  const authorIds = Array.from(new Set(ents.flatMap(x => wdClaims(x, 'P50').map(v => v.id)))).slice(0, 50);
  const a = await wdApi({ action: 'wbgetentities', ids: authorIds.join('|'), props: 'labels', languages: 'he|en' });
  const na = norm(author || '');
  return ents.map(x => {
    const aIds = wdClaims(x, 'P50').map(v => v.id);
    const pub = wdClaims(x, 'P577')[0];
    return {
      qid: x.id, heTitle: wdLabel(x, 'he'), enTitle: wdLabel(x, 'en'),
      heAuthors: aIds.map(id => wdLabel((a.entities || {})[id], 'he')).filter(Boolean),
      enAuthors: aIds.map(id => wdLabel((a.entities || {})[id], 'en')).filter(Boolean),
      year: pub && pub.time ? pub.time.slice(1, 5) : '',
      olId: wdClaims(x, 'P648').find(v => /^OL\d+W$/.test(v)) || '',
      isbns: [].concat(wdClaims(x, 'P212'), wdClaims(x, 'P957')).map(v => String(v).replace(/-/g, '')),
      hewiki: (x.sitelinks && x.sitelinks.hewiki && x.sitelinks.hewiki.title) || '',
      enwiki: (x.sitelinks && x.sitelinks.enwiki && x.sitelinks.enwiki.title) || ''
    };
  }).filter(w => !na || w.heAuthors.concat(w.enAuthors).some(n => {
    const nn = norm(n);
    return nn.includes(na) || na.includes(nn.split(' ').pop());
  }));
}
async function bridgeFromWikidata(text, author) {
  const works = (await wikidataBooks(text, author)).slice(0, 4);
  const out = [];
  for (const w of works) {
    let b = null;
    try {
      if (w.olId) b = await olByWorkKey('/works/' + w.olId);
      else if (w.enTitle && w.enAuthors[0]) {
        const r = await olSearch({ title: w.enTitle, author: w.enAuthors[0], limit: 3 });
        b = r.find(x => normTitle(x.title) === normTitle(w.enTitle)) || null;
        if (b) await olEnrich([b], 1);
      }
    } catch (e) { b = null; }
    let wiki = null;
    const needWiki = !b || !b.description || !b.cover;
    if (needWiki && (w.hewiki || w.enwiki)) {
      try { wiki = await wikiSummary(w.hewiki ? 'he' : 'en', w.hewiki || w.enwiki); } catch (e) { wiki = null; }
    }
    if (b) {
      if (w.heTitle && w.heTitle !== b.title) { b.subtitle = b.title; b.title = w.heTitle; }
      if (w.heAuthors.length && hasHebrew(text)) b.authors = w.heAuthors;
      if (!b.description && wiki && wiki.text) { b.description = wiki.text; b.descSource = 'ויקיפדיה'; }
      if (!b.cover && wiki && wiki.thumb) b.cover = wiki.thumb;
      b.isbns = Array.from(new Set((b.isbns || []).concat(w.isbns)));
      b.verifiedVia = 'Open Library + Wikidata';
      out.push(b);
    } else {
      const title = w.heTitle || w.enTitle;
      if (!title) continue;
      out.push({
        key: 'wd:' + w.qid, source: 'wikidata', sourceId: w.qid, title,
        subtitle: w.heTitle && w.enTitle && w.heTitle !== w.enTitle ? w.enTitle : '',
        authors: w.heAuthors.length ? w.heAuthors : w.enAuthors, year: w.year,
        description: (wiki && wiki.text) || '', descSource: wiki && wiki.text ? 'ויקיפדיה' : '',
        categories: [], cover: (wiki && wiki.thumb) || '', pageCount: 0, language: w.heTitle ? 'he' : '',
        isbns: w.isbns, link: (wiki && wiki.url) || ('https://www.wikidata.org/wiki/' + w.qid),
        avgRating: 0, ratingsCount: 0, publisher: '', verifiedVia: 'Wikidata'
      });
    }
  }
  return out;
}

// הספרייה הלאומית (דרך השרת): הקטלוג של כל מה שיוצא לאור בישראל, כולל ספרים חדשים והוצאות קטנות שאינם ב-Google
async function nliSearch(params) {
  const c = loadCloud();
  if (!c || SYNC.nli === false) return [];
  const d = await fetchJSON(c.url + '/nli?' + new URLSearchParams(params));
  return (d.items || []).map(x => ({
    key: 'nli:' + (x.id || x.title), source: 'nli', sourceId: x.id, title: x.title, subtitle: '', authors: x.authors || [], year: x.year || '',
    description: '', categories: [], cover: x.cover || '', pageCount: 0, language: x.language === 'heb' || hasHebrew(x.title) ? 'he' : x.language,
    isbns: x.isbns || [], link: x.link || '', avgRating: 0, ratingsCount: 0, publisher: x.publisher || '', verifiedVia: 'הספרייה הלאומית'
  }));
}

// חנויות והוצאות (דרך השרת): עברית, סטימצקי, צומת ספרים והוצאות הספרים. דף ספר אמיתי שם = הספר קיים
const STORE_NAMES = { 'e-vrit.co.il': 'עברית', 'steimatzky.co.il': 'סטימצקי', 'booknet.co.il': 'צומת ספרים', 'kinbooks.co.il': 'כנרת זמורה', 'ybook.co.il': 'ידיעות ספרים',
  'am-oved.co.il': 'עם עובד', 'kibutz-poalim.co.il': 'הקיבוץ המאוחד', 'keter-books.co.il': 'כתר', 'modan.co.il': 'מודן', 'simania.co.il': 'סימניה',
  '9livespress.com': 'תשע נשמות', 'abayit-books.com': 'הוצאת הבית', 'pardes.co.il': 'פרדס', 'resling.co.il': 'רסלינג' };
async function storeSearch(title, author) {
  const c = loadCloud();
  if (!c || !title) return [];
  const d = await fetchJSON(c.url + '/stores?' + new URLSearchParams({ title, author: author || '' }), 25000);
  return (d.items || []).map(x => ({
    key: 'store:' + x.url, source: 'web', sourceId: x.url, title: x.title || title, subtitle: '',
    authors: author && x.authorOk !== false ? [author] : [], year: '', description: x.description || '', descSource: x.description ? (STORE_NAMES[x.site] || x.site) : '',
    categories: [], cover: x.image || '', pageCount: 0, language: 'he', isbns: [], link: x.url, avgRating: 0, ratingsCount: 0, publisher: '',
    verifiedVia: x.site
  }));
}

// חיפוש ספר מטקסט חופשי / ISBN / קישור — מחזיר רק רשומות שחזרו מ-API בפועל
async function searchBooks(input, author) {
  const text = (input || '').trim();
  const notes = [];
  const sources = new Set();
  const url = tryURL(text);
  if (url) return resolveLink(url);
  if (isPureISBN(text)) return lookupISBN(extractISBN(text));

  const full = author ? `${text} ${author}` : text;
  const best = (list) => list.reduce((m, c) => Math.max(m, matchScore(c, full)), 0);
  const tried = [];
  let results = [];
  // בעברית: הספרייה הלאומית במקביל ל-Google (שם נמצאים גם ספרים שאין בשום מאגר בינלאומי)
  const nliP = hasHebrew(text) || hasHebrew(author) ? nliSearch({ title: text, author: author || '' })
    .then(list => (list.length || !author) ? list : nliSearch({ title: text })).catch(() => []) : Promise.resolve([]);
  if (googleAvailable()) {
    try {
      // Google מחיל inauthor רק על המילה הראשונה, לכן מסננים לפי שם המשפחה
      const q = author ? `${text} inauthor:${author.trim().split(/\s+/).pop()}` : text;
      const heb = hasHebrew(text) || hasHebrew(author);
      if (heb) results = await googleSearch(q, { lang: 'iw', max: 30 });
      if (results.length < 8) results = mergeByKey(results, await googleSearch(q, { max: 30 }));
      // לא נמצאה התאמה טובה? מנסים וריאציות: פיצול שם/מחבר, שם משפחה, כתיב חלופי
      if (best(results) < 0.8) {
        const vars = queryVariants(text, author);
        const got = await Promise.all(vars.map(v => googleSearch(v.q, { lang: heb ? 'iw' : undefined, max: 20 }).catch(() => [])));
        got.forEach((list, i) => {
          if (list.length && best(list) > best(results) - 0.05) tried.push(vars[i].label);
          results = mergeByKey(results, list);
        });
      }
      if (results.length) sources.add('Google Books');
    } catch (e) { notes.push((googleState.lastError || 'Google Books לא זמין') + ' — עוברים ל-Open Library.'); }
  } else {
    notes.push((googleState.lastError || 'Google Books לא זמין כרגע') + ' — משתמשים ב-Open Library.');
  }
  const nli = await nliP;
  if (nli.length) { results = mergeByKey(results, nli); sources.add('הספרייה הלאומית'); }
  // ספר עברי שלא נמצא טוב במאגרים: מחפשים בחנויות (שם נמצאים גם ספרים חדשים ומהוצאות קטנות)
  if ((hasHebrew(text) || hasHebrew(author)) && best(results) < 0.75) {
    try {
      const st = await storeSearch(text, author || '');
      if (st.length) { results = mergeByKey(results, st); uniq(st.map(x => STORE_NAMES[x.verifiedVia] || x.verifiedVia)).forEach(n => sources.add(n)); }
    } catch (e) { notes.push('החיפוש בחנויות לא הגיב.'); }
  }
  if (results.length < 3 || best(results) < 0.6) {
    try {
      const ol = await olSearch({ q: full, limit: 10 });
      if (!ol.length && author) ol.push(...await olSearch({ q: text, limit: 10 }));
      await olEnrich(ol, 6);
      const before = results.length;
      results = mergeByKey(results, ol);
      if (results.length > before) sources.add('Open Library');
    } catch (e) { notes.push('Open Library לא הגיב.'); }
  }
  if (best(results) < 0.6 || (hasHebrew(text) && !sources.has('Google Books'))) {
    // Wikidata מחפש לפי תחילת השם, לכן מנסים גם בלי המילים האחרונות (שאולי הן שם המחבר)
    const words = text.split(/\s+/).filter(Boolean);
    const titles = [text, words.slice(0, -1).join(' '), words.slice(0, -2).join(' ')].filter((t, i, arr) => t && arr.indexOf(t) === i);
    try {
      for (const t of titles) {
        const wd = await bridgeFromWikidata(t, author || (t !== text ? text.slice(t.length).trim() : ''));
        if (wd.length) {
          const before = results.length;
          results = mergeByKey(wd, results);
          if (results.length > before) sources.add('Wikidata');
          if (t !== text) tried.push(`"${t}" מאת ${text.slice(t.length).trim()} (Wikidata)`);
          break;
        }
      }
    } catch (e) { notes.push('Wikidata לא הגיב.'); }
  }
  let ranked = rankByTitle(results, full);
  if (ranked.length && ranked[0].match >= 0.6) ranked = ranked.filter(c => c.match >= 0.25);
  return { candidates: ranked.slice(0, 40), notes, sources: Array.from(sources), tried };
}
async function lookupISBN(isbn) {
  const notes = [];
  if (googleAvailable()) {
    try {
      const r = await googleSearch('isbn:' + isbn, { max: 10 });
      if (r.length) return { candidates: r, notes, sources: ['Google Books'] };
    } catch (e) { notes.push((googleState.lastError || 'Google Books לא זמין') + ' — עוברים ל-Open Library.'); }
  }
  try {
    const b = await olByISBN(isbn);
    if (b) return { candidates: [b], notes, sources: ['Open Library'] };
  } catch (e) { /* לא נמצא */ }
  try {
    const n = await nliSearch({ isbn });
    if (n.length) return { candidates: n.slice(0, 5), notes, sources: ['הספרייה הלאומית'] };
  } catch (e) { /* לא נמצא */ }
  notes.push(`לא נמצא ספר עם ISBN ${isbn} באף מקור. בדקו את המספר או חפשו לפי שם.`);
  return { candidates: [], notes, sources: [] };
}
async function resolveLink(url) {
  const host = url.hostname.replace(/^www\./, '');
  const notes = [];
  try {
    if (/(^|\.)google\.[a-z.]+$/.test(host) || host.startsWith('books.google')) {
      let id = url.searchParams.get('id');
      const m = url.pathname.match(/\/books\/edition\/[^/]*\/([A-Za-z0-9_-]{8,})/);
      if (!id && m) id = m[1];
      if (id) {
        const b = await googleById(id);
        if (b) return { candidates: [b], notes, sources: ['Google Books'] };
      }
    }
    if (host.endsWith('openlibrary.org')) {
      const w = url.pathname.match(/\/works\/(OL\d+W)/);
      const e = url.pathname.match(/\/books\/(OL\d+M)/);
      const b = w ? await olByWorkKey('/works/' + w[1]) : e ? await olByEditionKey('/books/' + e[1]) : null;
      if (b) return { candidates: [b], notes, sources: ['Open Library'] };
    }
  } catch (err) {
    notes.push('לא הצלחנו לאמת את הקישור מול המקור (' + (err.status ? 'שגיאה ' + err.status : 'בעיית רשת') + ').');
  }
  const isbn = extractISBN(decodeURIComponent(url.pathname + url.search));
  if (isbn) {
    const r = await lookupISBN(isbn);
    r.notes = notes.concat(['זוהה ISBN ' + isbn + ' מתוך הקישור.'], r.notes);
    return r;
  }
  notes.push('לא הצלחנו לחלץ מזהה ספר מהקישור. נתמכים: Google Books, Open Library, או כל קישור שמכיל ISBN (למשל חנויות ספרים). אפשר גם לחפש לפי שם.');
  return { candidates: [], notes, sources: [] };
}

/* ---------- שמות בעברית: אם יש מהדורה עברית מציגים את שמה, ושם המקור עובר לשורת המשנה ---------- */
function withHebrewTitle(c, he) {
  if (!c || !he || !hasHebrew(he) || hasHebrew(c.title)) return c;
  return { ...c, title: he.trim(), subtitle: c.title };
}
const STARTER_BY_ORIGINAL = (() => {
  const m = new Map();
  STARTER.forEach(g => g.books.forEach(([he, author, original]) => { if (original) m.set(normTitle(original), [he, author]); }));
  return m;
})();
const lastName = (s) => skel(norm(s || '').split(' ').pop());
function knownHebrewTitle(b) {
  const hit = STARTER_BY_ORIGINAL.get(normTitle(b.title));
  if (!hit) return '';
  const a = (b.authors || [])[0];
  // שם המחבר חייב להתאים, בעברית או בלועזית (בדיקה רכה: שם משפחה, או ספר בלי מחבר)
  if (a && hasHebrew(a) && lastName(a) !== lastName(hit[1])) return '';
  return hit[0];
}
// מחפש ב-Wikidata את השם העברי של יצירה (רק כשהמחבר תואם), לספרים שנשמרו בשם לועזי
async function lookupHebrewTitle(b) {
  if (hasHebrew(b.title)) return '';
  const known = knownHebrewTitle(b);
  if (known) return known;
  const author = (b.authors || [])[0] || '';
  if (!author) return '';
  const base = b.title.split(/[:(]/)[0].trim();
  const works = await wikidataBooks(base, author);
  const nt = normTitle(base);
  const w = works.find(x => x.heTitle && hasHebrew(x.heTitle) && normTitle(x.enTitle) === nt);
  return w ? w.heTitle : '';
}

/* ============================================================
   שכבת אחסון: localStorage + IndexedDB
   ============================================================ */
const emptyDB = () => ({ version: SCHEMA_VERSION, books: [], tagLibrary: DEFAULT_TAGS.slice(), dismissed: [], settings: { theme: 'system', apiKey: '', recLang: 'auto' }, history: [], tombstones: { books: {}, history: {} }, updatedAt: 0, lastBackupAt: 0 });

function sanitizeBook(b) {
  if (!b || typeof b !== 'object' || !b.title || !b.key) return null;
  const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const arr = (x) => (Array.isArray(x) ? x.map(str).filter(Boolean) : []);
  return {
    id: str(b.id) || uid(), key: str(b.key), source: str(b.source), sourceId: str(b.sourceId),
    title: str(b.title), subtitle: str(b.subtitle), authors: arr(b.authors), year: str(b.year),
    description: str(b.description), categories: arr(b.categories), cover: str(b.cover),
    pageCount: Number(b.pageCount) || 0, language: str(b.language), isbns: arr(b.isbns), link: str(b.link),
    publisher: str(b.publisher), status: b.status === 'want' ? 'want' : 'read',
    rating: b.status === 'want' ? Math.min(5, Math.max(0, Number(b.rating) || 0)) : Math.min(5, Math.max(1, Number(b.rating) || 1)), tags: arr(b.tags),
    addedAt: Number(b.addedAt) || Date.now(), verifiedAt: Number(b.verifiedAt) || 0,
    verifiedVia: str(b.verifiedVia), descSource: str(b.descSource),
    ebook: !!b.ebook, ebookLink: str(b.ebookLink), olEbook: !!b.olEbook,
    note: str(b.note).slice(0, 4000), descriptionHe: str(b.descriptionHe), editedAt: Number(b.editedAt) || Number(b.addedAt) || 0,
    genres: arr(b.genres), sources: Array.isArray(b.sources) ? b.sources.filter(x => x && x.url).map(x => ({ title: str(x.title), url: str(x.url) })).slice(0, 8) : [],
    aiFormats: b.aiFormats && typeof b.aiFormats === 'object' ? { print: str(b.aiFormats.print), ebook: str(b.aiFormats.ebook), audiobook: str(b.aiFormats.audiobook), notes: str(b.aiFormats.notes) } : null
  };
}
function sanitizeDB(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.books)) return null;
  const base = emptyDB();
  const books = raw.books.map(sanitizeBook).filter(Boolean);
  return {
    ...base,
    books,
    history: Array.isArray(raw.history) ? raw.history.filter(h => h && h.id && Array.isArray(h.recs)).slice(0, 40) : [],
    tagLibrary: Array.isArray(raw.tagLibrary) ? Array.from(new Set(raw.tagLibrary.filter(t => typeof t === 'string' && t.trim()))) : base.tagLibrary,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter(x => typeof x === 'string') : [],
    settings: { ...base.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
    tombstones: {
      books: raw.tombstones && raw.tombstones.books && typeof raw.tombstones.books === 'object' ? raw.tombstones.books : {},
      history: raw.tombstones && raw.tombstones.history && typeof raw.tombstones.history === 'object' ? raw.tombstones.history : {}
    },
    // ספרים ששללתי מההמלצות: לחודש או לתמיד, עם הערה שמדייקת את הפרופיל
    rejections: Array.isArray(raw.rejections) ? raw.rejections.filter(x => x && x.id && x.title).slice(0, 500) : [],
    // הפרופיל הספרותי: סיכום הטעם שנבנה מהספרים, ומתעדכן רק עם מה שהשתנה
    litProfile: raw.litProfile && typeof raw.litProfile === 'object' && raw.litProfile.text ? raw.litProfile : null,
    profileNote: typeof raw.profileNote === 'string' ? raw.profileNote.slice(0, 1500) : '',
    profileNoteAt: Number(raw.profileNoteAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastBackupAt: Number(raw.lastBackupAt) || 0
  };
}
function loadLocal() {
  try { const s = localStorage.getItem(ACTIVE.dbKey); return s ? sanitizeDB(JSON.parse(s)) : null; } catch (e) { return null; }
}
function saveLocal(db) {
  try { localStorage.setItem(ACTIVE.dbKey, JSON.stringify(db)); return true; } catch (e) { return false; }
}
function idbOpen() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function idbGet() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(ACTIVE.dbKey);
    r.onsuccess = () => resolve(r.result ? sanitizeDB(r.result) : null);
    r.onerror = () => reject(r.error);
  });
}
async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
async function idbSet(value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, ACTIVE.dbKey);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function usePersistentDB() {
  const initial = useMemo(() => loadLocal(), []);
  const [db, setDb] = useState(() => initial || emptyDB());
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState({ local: null, idb: null, persisted: null, savedAt: 0 });

  useEffect(() => {
    let alive = true;
    idbGet().then(fromIdb => {
      if (!alive) return;
      // IndexedDB הוא עותק גיבוי: משתמשים בו רק אם העותק הראשי חסר (למשל כשהדפדפן ניקה את localStorage)
      if (fromIdb && !initial) setDb(fromIdb);
    }).catch(() => setStatus(s => ({ ...s, idb: false }))).finally(() => alive && setHydrated(true));
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(p => p ? true : navigator.storage.persist()).then(p => alive && setStatus(s => ({ ...s, persisted: !!p }))).catch(() => {});
      }
    } catch (e) { /* לא נתמך */ }
    const onStorage = (e) => {
      if (e.key !== ACTIVE.dbKey || !e.newValue) return;
      try { const d = sanitizeDB(JSON.parse(e.newValue)); if (d) setDb(d); } catch (err) { /* התעלמות */ }
    };
    const onRemote = (e) => { if (e.detail && e.detail.pid === ACTIVE.id) { const d = sanitizeDB(e.detail.db); if (d) setDb(d); } };
    window.addEventListener('storage', onStorage);
    window.addEventListener('vrt-remote-db', onRemote);
    return () => { alive = false; window.removeEventListener('storage', onStorage); window.removeEventListener('vrt-remote-db', onRemote); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const okLocal = saveLocal(db);
    scheduleSync();
    idbSet(db).then(() => setStatus(s => ({ ...s, local: okLocal, idb: true, savedAt: Date.now() })))
      .catch(() => setStatus(s => ({ ...s, local: okLocal, idb: false, savedAt: Date.now() })));
  }, [db, hydrated]);

  const update = useCallback((fn) => setDb(d => ({ ...fn(d), updatedAt: Date.now() })), []);
  return { db, update, replace: (next) => setDb({ ...next, updatedAt: Date.now() }), status, hydrated };
}

function findInLibrary(c, books) {
  const dk = dedupeKey(c);
  const nt = normTitle(c.title);
  const isb = new Set(c.isbns || []);
  return books.find(b => b.key === c.key || dedupeKey(b) === dk || (b.isbns || []).some(x => isb.has(x)) ||
    (normTitle(b.title) === nt && nt.length > 3 && norm((b.authors || [])[0]).split(' ').pop() === norm((c.authors || [])[0]).split(' ').pop()));
}

/* ============================================================
   ספרייה משפחתית: סנכרון בין מכשירים דרך השרת המשפחתי (Cloudflare)
   ============================================================ */
// כתובת השרת (Cloudflare Worker). האפליקציה מתחברת אליו לבד; אין קוד גישה.
const CLOUD_URL = 'https://books.yuvsaadon.workers.dev';
const cloudBase = (url) => url.trim().replace(/\/+$/, '');
function loadCloud() {
  let url = CLOUD_URL;
  try { url = localStorage.getItem('vrt_server_url') || url; } catch (e) { /* */ }
  return url ? { url: cloudBase(url), ai: true } : null;
}
// ה-AI זמין רק אם השרת מדווח שמוגדר בו מפתח (ping.ai)
const aiAvailable = () => !!loadCloud() && SYNC.ai !== false;
// איתור השרת: כתובת ה-Worker ב-Cloudflare היא books.<שם-החשבון>.workers.dev. האפליקציה מנסה את האפשרויות וזוכרת את זו שעונה.
const CLOUD_CANDIDATES = ['https://books.yuvsaadon.workers.dev', 'https://books.yuvsaadon-coder.workers.dev', 'https://books.yuvsaadon1.workers.dev', 'https://books.yuval-saadon.workers.dev', 'https://books.yuvalsaadon.workers.dev'];
async function discoverCloud() {
  if (loadCloud()) {
    try { const r = await fetch(loadCloud().url + '/ping'); const j = await r.json(); setSyncStatus({ ai: !!j.ai, gbooks: !!j.gbooks, nli: !!j.nli, jobs: !!j.jobs }); } catch (e) { /* */ }
    return true;
  }
  for (const u of CLOUD_CANDIDATES) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(u + '/ping', { signal: ctrl.signal }); clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (j && j.ok) { localStorage.setItem('vrt_server_url', u); setSyncStatus({ ai: !!j.ai, gbooks: !!j.gbooks, nli: !!j.nli, jobs: !!j.jobs }); return true; } }
    } catch (e) { /* ננסה את הבאה */ }
  }
  setSyncStatus({ status: 'error', error: 'השרת לא נמצא. שלחו ל-Claude Code את כתובת ה-Worker מ-Cloudflare.' });
  return false;
}
async function cloudFetch(path, opts = {}) {
  const c = loadCloud();
  if (!c) throw new Error('no_cloud');
  return fetch(c.url + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
}
const uniq = (arr) => Array.from(new Set(arr));
function mergeByIdNewest(a, b, ts) {
  const m = new Map();
  [...(a || []), ...(b || [])].forEach(x => { if (!x || !x.id) return; const cur = m.get(x.id); if (!cur || ts(x) > ts(cur)) m.set(x.id, x); });
  return [...m.values()];
}
function mergeTomb(a, b) {
  const o = { ...(a || {}) };
  Object.entries(b || {}).forEach(([k, v]) => { if (!o[k] || v > o[k]) o[k] = v; });
  return o;
}
// מיזוג ספרייה: איחוד ספרים לפי מזהה (הגרסה שנערכה אחרונה גוברת), מחיקות נשמרות כ"מצבות"
/* ---------- חברים: בקשות חברות והמלצות בין משתמשים, משותפים לכל המשתמשים בשרת ---------- */
const SOCIAL_KEY = 'vrt-social';
function loadSocial() { try { const s = JSON.parse(localStorage.getItem(SOCIAL_KEY) || 'null'); return s && Array.isArray(s.items) ? s : { items: [] }; } catch (e) { return { items: [] }; } }
function socialChange(fn) {
  const cur = loadSocial();
  const next = { items: fn(cur.items) };
  try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(next)); } catch (e) { /* */ }
  window.dispatchEvent(new Event('vrt-social-changed'));
  scheduleSync(600);
}
function useSocial() {
  const [s, setS] = useState(loadSocial);
  useEffect(() => { const f = () => setS(loadSocial()); window.addEventListener('vrt-social-changed', f); return () => window.removeEventListener('vrt-social-changed', f); }, []);
  return s;
}
function loadDBOf(pid) { try { const raw = localStorage.getItem(dbKeyFor(pid)); return raw ? sanitizeDB(JSON.parse(raw)) : null; } catch (e) { return null; } }
function friendsOf(items, me) {
  const out = new Map();
  items.filter(x => x.type === 'friend').sort((a, b) => (a.editedAt || a.at) - (b.editedAt || b.at)).forEach(x => {
    const other = x.from === me ? x.to : x.to === me ? x.from : null;
    if (!other) return;
    out.set(other, x);
  });
  return out;   // מזהה משתמש → הרשומה האחרונה ביניהם
}
function mergeDB(a, b) {
  if (!a) return b; if (!b) return a;
  const prune = (t) => { const cut = Date.now() - 180 * 86400000; const o = {}; Object.entries(t).forEach(([k, v]) => { if (v > cut) o[k] = v; }); return o; };
  const tomb = { books: prune(mergeTomb(a.tombstones.books, b.tombstones.books)), history: prune(mergeTomb(a.tombstones.history, b.tombstones.history)) };
  const bt = (x) => x.editedAt || x.addedAt || 0;
  const books = mergeByIdNewest(a.books, b.books, bt).filter(x => !(tomb.books[x.id] >= bt(x))).sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
  const history = mergeByIdNewest(a.history, b.history, h => h.at || 0).filter(h => !tomb.history[h.id]).sort((x, y) => y.at - x.at).slice(0, 40);
  const newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
  return {
    ...newer, books, history, tombstones: tomb,
    tagLibrary: uniq([...(a.tagLibrary || []), ...(b.tagLibrary || [])]),
    dismissed: uniq([...(a.dismissed || []), ...(b.dismissed || [])]),
    rejections: mergeByIdNewest(a.rejections, b.rejections, x => x.editedAt || x.at || 0).sort((x, y) => (y.at || 0) - (x.at || 0)),
    litProfile: ((a.litProfile && a.litProfile.at) || 0) >= ((b.litProfile && b.litProfile.at) || 0) ? a.litProfile || null : b.litProfile || null,
    lastBackupAt: Math.max(a.lastBackupAt || 0, b.lastBackupAt || 0),
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0)
  };
}
function collectLocal() {
  const p = loadProfiles();
  const dbs = {};
  p.profiles.forEach(pr => {
    try { const raw = localStorage.getItem(dbKeyFor(pr.id)); const d = raw ? sanitizeDB(JSON.parse(raw)) : null; if (d) dbs[pr.id] = d; } catch (e) { /* */ }
  });
  return { profiles: p.profiles, deleted: p.deleted || {}, dbs, social: loadSocial() };
}
function mergeState(l, r) {
  if (!r || !Array.isArray(r.profiles)) return l;
  const deleted = mergeTomb(l.deleted, r.deleted);
  const profiles = mergeByIdNewest(l.profiles, r.profiles, p => p.updatedAt || p.createdAt || 0)
    .filter(p => !deleted[p.id]).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  const dbs = {};
  profiles.forEach(p => {
    const m = mergeDB(l.dbs[p.id] || null, r.dbs && r.dbs[p.id] ? sanitizeDB(r.dbs[p.id]) : null);
    if (m) dbs[p.id] = m;
  });
  const cut = Date.now() - 365 * 86400000;
  const social = { items: mergeByIdNewest((l.social || {}).items, (r.social || {}).items, x => x.editedAt || x.at || 0)
    .filter(x => (x.editedAt || x.at || 0) > cut && !deleted[x.from] && !deleted[x.to]).sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 2000) };
  return { profiles, deleted, dbs, social };
}
function applyLocal(state) {
  if (state.social) {
    const cur = JSON.stringify(loadSocial()), next = JSON.stringify(state.social);
    if (cur !== next) { try { localStorage.setItem(SOCIAL_KEY, next); } catch (e) { /* */ } window.dispatchEvent(new Event('vrt-social-changed')); }
  }
  const cur = loadProfiles();
  const active = state.profiles.some(p => p.id === cur.active) ? cur.active : null;
  saveProfiles({ profiles: state.profiles, deleted: state.deleted, active });
  Object.keys(state.deleted || {}).forEach(pid => { try { localStorage.removeItem(dbKeyFor(pid)); } catch (e) { /* */ } });
  Object.entries(state.dbs).forEach(([pid, d]) => {
    const key = dbKeyFor(pid);
    const str = JSON.stringify(d);
    try { if (localStorage.getItem(key) !== str) { localStorage.setItem(key, str); window.dispatchEvent(new CustomEvent('vrt-remote-db', { detail: { pid, db: d } })); } } catch (e) { /* */ }
  });
  window.dispatchEvent(new Event('vrt-profiles-changed'));
}
const SYNC = { running: false, again: false, status: 'off', lastAt: 0, error: '', ai: null, gbooks: null, nli: null, jobs: null };
function setSyncStatus(patch) { Object.assign(SYNC, patch); window.dispatchEvent(new Event('vrt-sync-status')); }
async function syncNow() {
  if (!loadCloud()) { setSyncStatus({ status: 'off' }); return; }
  if (SYNC.running) { SYNC.again = true; return; }
  SYNC.running = true;
  setSyncStatus({ status: 'syncing' });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await cloudFetch('/sync');
      if (!r.ok) throw new Error('http_' + r.status);
      const remote = await r.json();
      const merged = mergeState(collectLocal(), remote.data);
      applyLocal(merged);
      if (remote.data && JSON.stringify(remote.data) === JSON.stringify(merged)) break;
      const put = await cloudFetch('/sync', { method: 'PUT', body: JSON.stringify({ baseRev: remote.rev, data: merged }) });
      if (put.status === 409) continue;
      if (!put.ok) throw new Error('http_' + put.status);
      break;
    }
    setSyncStatus({ status: 'ok', lastAt: Date.now(), error: '' });
  } catch (e) {
    setSyncStatus({ status: 'error', error: 'אין חיבור לשרת. הנתונים שמורים בטלפון ויסתנכרנו כשיחזור החיבור.' });
  } finally {
    SYNC.running = false;
    if (SYNC.again) { SYNC.again = false; setTimeout(syncNow, 400); }
  }
}
let syncTimer = null;
function scheduleSync(ms = 2500) { if (!loadCloud()) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); }
// חיבור ראשון של מכשיר: אם גם במכשיר וגם בשרת יש משתמש 'default' שונה, מעבירים את המקומי למזהה חדש כדי שלא יתמזגו
const JOINED_KEY = 'verified_reading_tracker_joined_v1';
async function ensureJoined() {
  if (!loadCloud()) return;
  try { if (localStorage.getItem(JOINED_KEY)) return; } catch (e) { return; }
  const r = await cloudFetch('/sync');
  if (!r.ok) return;
  const remote = await r.json();
  const rp = remote.data && remote.data.profiles || [];
  const lp = loadProfiles();
  const ld = lp.profiles.find(p => p.id === 'default');
  const rd = rp.find(p => p.id === 'default');
  if (ld && rd && ld.createdAt !== rd.createdAt) {
    const nid = uid();
    try {
      const raw = localStorage.getItem(dbKeyFor('default'));
      if (raw) localStorage.setItem(dbKeyFor(nid), raw);
      localStorage.removeItem(dbKeyFor('default'));
      idbDelete(dbKeyFor('default')).catch(() => {});
      const q = localStorage.getItem(queueKeyFor('default'));
      if (q) { localStorage.setItem(queueKeyFor(nid), q); localStorage.removeItem(queueKeyFor('default')); }
    } catch (e) { /* */ }
    saveProfiles({ ...lp, profiles: lp.profiles.map(p => p.id === 'default' ? { ...p, id: nid, updatedAt: Date.now() } : p), active: lp.active === 'default' ? nid : lp.active });
    window.dispatchEvent(new Event('vrt-profiles-changed'));
  }
  try { localStorage.setItem(JOINED_KEY, '1'); } catch (e) { /* */ }
}
function useSyncStatus() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(x => x + 1);
    window.addEventListener('vrt-sync-status', f);
    return () => window.removeEventListener('vrt-sync-status', f);
  }, []);
  return { ...SYNC, cloud: loadCloud() };
}

/* ============================================================
   Claude דרך השרת המשפחתי: הבנת טקסט חופשי, זיהוי ספרים והמלצות מבוססות מקורות
   המודל מחפש וקורא רק באתרים שברשימה המאושרת בשרת. כל ספר שהוא מציע נבדק מחדש
   מול Google Books / Open Library לפני שהוא מוצג, ומה שלא אומת נפסל.
   ============================================================ */
const AI_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
// מחירי מחירון: Sonnet 4.6 ‏$3 / $15 למיליון טוקנים, חיפוש ברשת ‏$10 לאלף חיפושים
const PRICE = { in: 3 / 1e6, out: 15 / 1e6, cacheRead: 0.3 / 1e6, search: 10 / 1000 };
let sdkPromise = null;
async function aiClient() {
  const c = loadCloud();
  if (!c || !c.ai) throw new Error('ai_unavailable');
  if (!sdkPromise) sdkPromise = import(ANTHROPIC_SDK_URL);
  const mod = await sdkPromise;
  const Anthropic = mod.default || mod.Anthropic;
  return {
    Anthropic,
    client: new Anthropic({
      apiKey: 'held-by-family-server', baseURL: cloudBase(c.url), dangerouslyAllowBrowser: true,
      maxRetries: 1, timeout: 6 * 60 * 1000
    })
  };
}
const WEB_TOOLS = [{ type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' }];
function describeBlock(b) {
  if (b.type === 'server_tool_use' && b.name === 'web_search') return 'מחפש: ' + ((b.input && b.input.query) || '');
  if (b.type === 'server_tool_use' && b.name === 'web_fetch') {
    try { return 'קורא: ' + new URL(b.input.url).hostname.replace(/^www\./, ''); } catch (e) { return 'קורא מקור'; }
  }
  if (b.type === 'thinking' && b.thinking) return 'חושב: ' + b.thinking.replace(/\s+/g, ' ').slice(0, 160) + (b.thinking.length > 160 ? '…' : '');
  return '';
}
// אחרי מעבר למודל גיבוי באמצע תשובה, בלוקים פנימיים שלפני נקודת המעבר לא נשלחים חזרה
function echoable(content) {
  const idx = content.map(b => b.type).lastIndexOf('fallback');
  if (idx < 0) return content;
  return content.filter((b, i) => i > idx || !['thinking', 'redacted_thinking', 'tool_use', 'fallback'].includes(b.type));
}
function costOf(usage) {
  if (!usage) return 0;
  const st = usage.server_tool_use || {};
  return (usage.input_tokens || 0) * PRICE.in + (usage.cache_creation_input_tokens || 0) * PRICE.in * 1.25 +
    (usage.cache_read_input_tokens || 0) * PRICE.cacheRead + (usage.output_tokens || 0) * PRICE.out +
    (st.web_search_requests || 0) * PRICE.search;
}
// הרצה עם כלי "הגשה" במבנה קבוע: המודל מסיים בקריאה לכלי, ואנחנו קוראים את הקלט שלו
// web: false | true | { sites, searches, fetches } — תקציב חיפושים כולל לכל הריצה (לא לכל פנייה)
async function aiRun({ system, prompt, submitTool, web = true, effort = 'high', onProgress }) {
  const { client, Anthropic } = await aiClient();
  const cfg = web === true ? { searches: 6, fetches: 4 } : web || null;
  let searchesLeft = cfg ? cfg.searches : 0, fetchesLeft = cfg ? cfg.fetches || 0 : 0;
  const toolsNow = () => [
    ...(cfg ? [{ ...WEB_TOOLS[0], max_uses: Math.max(1, searchesLeft), ...(cfg.sites ? { allowed_domains: cfg.sites } : {}) }] : []),
    ...(cfg && cfg.fetches ? [{ ...WEB_TOOLS[1], max_uses: Math.max(1, fetchesLeft), ...(cfg.sites ? { allowed_domains: cfg.sites } : {}) }] : []),
    { ...submitTool, strict: true }
  ];
  let messages = [{ role: 'user', content: prompt }];
  let cost = 0;
  const hits = [];   // תוצאות חיפוש אמיתיות מהמנוע (כתובת + כותרת), לא טקסט שהמודל כתב
  for (let turn = 0; turn < 4; turn++) {
    let msg;
    for (let attempt = 0; ; attempt++) try {
      const stream = client.messages.stream({
        model: AI_MODEL, max_tokens: 32000,
        thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort },
        system, tools: toolsNow(), messages
      });
      if (onProgress) stream.on('contentBlock', (b) => { const d = describeBlock(b); if (d) onProgress(d); });
      msg = await stream.finalMessage();
      break;
    } catch (e) {
      if (attempt === 0 && e instanceof Anthropic.APIConnectionError) { onProgress && onProgress('החיבור נפל, מנסה שוב…'); continue; }
      if (e instanceof Anthropic.AuthenticationError) throw new Error('השרת לא הצליח להתחבר ל-Claude. בדקו את ANTHROPIC_API_KEY ב-Cloudflare.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('הגעתם למגבלת השימוש היומית ב-AI, או שהשירות עמוס. נסו שוב מאוחר יותר.');
      if (e instanceof Anthropic.APIError) {
        const detail = (e.error && e.error.error && e.error.error.message) || e.message || '';
        throw new Error('השירות החזיר שגיאה (' + (e.status || '') + '). ' + detail.slice(0, 140));
      }
      throw new Error('אין חיבור לשרת המשפחתי. בדקו אינטרנט ונסו שוב.');
    }
    cost += costOf(msg.usage);
    msg.content.forEach(b => {
      if (b.type === 'server_tool_use' && b.name === 'web_search') searchesLeft--;
      if (b.type === 'server_tool_use' && b.name === 'web_fetch') fetchesLeft--;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(x => x && x.url && hits.push({ url: x.url, title: x.title || '' }));
    });
    if (msg.stop_reason === 'refusal') throw new Error('המודל סירב לבקשה הזו. נסו לנסח אחרת.');
    const sub = msg.content.find(b => b.type === 'tool_use' && b.name === submitTool.name);
    if (sub) return { input: sub.input, cost, hits };
    if (msg.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה באמצע. נסו בקשה ממוקדת יותר.');
    messages = [...messages, { role: 'assistant', content: echoable(msg.content) }];
    if (msg.stop_reason !== 'pause_turn') messages.push({ role: 'user', content: `Now call ${submitTool.name} with your final answer.` });
  }
  throw new Error('המודל לא סיים לעבוד. נסו שוב.');
}
const HEBREW_OUT = 'Write every free-text field in Hebrew (except original-language titles and author names in their original form).';

// 1. פסקה חופשית ← רשימת ספרים
async function aiExtractBooks(paragraph) {
  const { input, cost } = await aiRun({
    web: false, effort: 'medium',
    system: 'You extract the books a reader mentions in free text (Hebrew or English). Fix obvious misspellings and use the official published title (the Hebrew edition title if the text is in Hebrew and a Hebrew edition exists). Include the author when stated or when you are confident. Do not invent books that are not mentioned. ' + HEBREW_OUT,
    prompt: paragraph,
    submitTool: {
      name: 'submit_books', description: 'Return the books mentioned in the text.',
      input_schema: { type: 'object', additionalProperties: false, required: ['books'], properties: {
        books: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'author', 'note'], properties: {
          title: { type: 'string' }, author: { type: 'string', description: 'empty string if unknown' },
          note: { type: 'string', description: 'what the reader said about it, in Hebrew; empty if nothing' } } } } } }
    }
  });
  return { books: (input.books || []).filter(b => b.title), cost };
}

// 2. זיהוי חכם של ספר שהחיפוש הרגיל לא מצא
async function aiResolveBook(text, author, onProgress) {
  const { input, cost, hits } = await aiRun({
    effort: 'medium', web: { sites: BOOK_SITES, searches: 4, fetches: 2 }, onProgress,
    system: 'A reader typed a book name that a catalogue search could not match: it may be misspelled, abbreviated, a Hebrew translation title, or mixed with the author name. Identify the most likely real books. Use web search on the allowed sites to confirm the exact published titles (Hebrew edition title when relevant), author and ISBN. New Hebrew books often exist only on Israeli store and publisher sites (e-vrit, Steimatzky, Tzomet/booknet, the publisher): search there and return the book page URL in page_url. Only return books you confirmed exist. ' + HEBREW_OUT,
    prompt: `Typed: "${text}"${author ? `\nAuthor typed: "${author}"` : ''}`,
    submitTool: {
      name: 'submit_matches', description: 'Return the confirmed candidate books, best first.',
      input_schema: { type: 'object', additionalProperties: false, required: ['candidates'], properties: {
        candidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'author', 'original_title', 'isbn', 'page_url'], properties: {
          title: { type: 'string', description: 'title as published in the edition the reader most likely means' },
          author: { type: 'string' }, original_title: { type: 'string', description: 'empty if same' },
          isbn: { type: 'string', description: 'ISBN-13 or ISBN-10 if found, else empty' },
          page_url: { type: 'string', description: 'URL of the book page on a store or publisher site you read (e-vrit, Steimatzky, Tzomet/booknet, the publisher). Empty if none.' } } } } } }
    }
  });
  const found = [];
  for (const c of (input.candidates || []).slice(0, 4)) {
    const v = await verifyAiBook({ title_he: c.title, title_original: c.original_title, author: c.author, isbn: c.isbn, page_url: c.page_url }, true, hits);
    v.forEach(x => { if (!found.some(f => f.key === x.key)) found.push(x); });
  }
  return {
    candidates: found, sources: ['Claude + ' + uniq(found.map(f => f.source === 'google' ? 'Google Books' : f.source === 'openlibrary' ? 'Open Library' : f.source === 'web' || f.source === 'nli' ? f.verifiedVia : 'Wikidata')).join(' + ')],
    notes: found.length ? [] : ['גם הזיהוי החכם לא מצא ספר שאפשר לאמת במאגרים.'],
    tried: (input.candidates || []).map(c => `${c.title}${c.author ? ' מאת ' + c.author : ''}`), cost
  };
}

// בדיקה מול המאגרים: מחזיר רשומות אמיתיות שתואמות את השם/המחבר או את ה-ISBN
// אתרי חנויות והוצאות בישראל: דף ספר שם הוא הוכחה שהספר קיים
const BOOK_SITES = ['e-vrit.co.il', 'steimatzky.co.il', 'booknet.co.il', 'simania.co.il', 'mendele.co.il', 'indiebook.co.il', 'nli.org.il',
  'am-oved.co.il', 'kibutz-poalim.co.il', 'ybook.co.il', 'kinbooks.co.il', 'keter-books.co.il', 'modan.co.il', 'abayit-books.com', '9livespress.com', 'pardes.co.il', 'resling.co.il'];
const siteOf = (url) => { try { const h = new URL(url).hostname.replace(/^www\./, ''); return BOOK_SITES.find(d => h === d || h.endsWith('.' + d)) || ''; } catch (e) { return ''; } };
// כותרת תוצאת החיפוש מכילה את שם הספר כמילים שלמות
function hitMatches(hit, title) {
  const ht = ' ' + skel(hit.title).join(' ') + ' ', t = skel(title).join(' ');
  return t.length >= 2 && ht.includes(' ' + t + ' ');
}
async function verifyAiBook(r, many, hits) {
  const clean = (x) => (x || '').replace(/[^\dXx]/g, '');
  const isbn = clean(r.isbn);
  const titles = [r.title_he, r.title_original].filter(Boolean);
  const ok = (c) => (isbn && (c.isbns || []).some(x => clean(x) === isbn)) || titles.some(t => matchScore(c, `${t} ${r.author || ''}`) >= 0.6);
  const out = [];
  const tries = [];
  // קודם השם העברי: אם יש מהדורה עברית אמיתית, היא תימצא ותוצג. שם עברי שהמודל תרגם בעצמו לא יימצא, ואז מוצגת המהדורה המקורית
  if (r.title_he) tries.push(() => searchBooks(r.title_he, r.author || ''));
  if (isbn.length === 10 || isbn.length === 13) tries.push(() => lookupISBN(isbn));
  if (r.title_original && r.title_original !== r.title_he) tries.push(() => searchBooks(r.title_original, r.author || ''));
  for (const t of tries) {
    const res = await t().catch(() => null);
    if (!res) continue;
    for (const c of res.candidates.slice(0, 10)) if (ok(c) && !out.some(o => o.key === c.key)) out.push(c);
    if (out.length && !many) break;
  }
  // לא במאגרים? מחפשים את המהדורה העברית בחנויות
  if (!out.length && r.title_he && hasHebrew(r.title_he)) {
    const st = await storeSearch(r.title_he, r.author || '').catch(() => []);
    if (st.length) out.push(...st.slice(0, many ? 3 : 1).map(x => ({ ...x, subtitle: r.title_original && r.title_original !== r.title_he ? r.title_original : '', description: x.description || r.synopsis_he || '', categories: r.genres || [] })));
  }
  // לא במאגרים (נפוץ בספרים עבריים חדשים)? מאמתים מול דף הספר באתר אמין: השרת נכנס לדף ובודק שהשם והמחבר מופיעים בו
  if (!out.length && r.page_url && loadCloud()) {
    const w = await verifyPage(r.page_url, r.title_he || r.title_original, r.author).catch(() => null);
    if (w && w.ok) {
      out.push({
        key: 'web:' + w.url, source: 'web', sourceId: w.url, title: r.title_he || r.title_original, subtitle: r.title_he && r.title_original && r.title_original !== r.title_he ? r.title_original : '',
        authors: r.author ? [r.author] : [], year: '', description: w.description || r.synopsis_he || '', descSource: w.description ? w.site : '',
        categories: r.genres || [], cover: w.image || '', pageCount: 0, language: hasHebrew(r.title_he || '') ? 'he' : '',
        isbns: isbn ? [isbn] : [], link: w.url, avgRating: 0, ratingsCount: 0, publisher: '', verifiedVia: w.site
      });
    }
  }
  // אם אי אפשר להיכנס לדף (אתרים שחוסמים שרתים), מספיקה תוצאת חיפוש אמיתית של דף הספר באתר חנות/הוצאה
  if (!out.length && hits && hits.length) {
    const t = r.title_he || r.title_original;
    const hit = hits.find(h => siteOf(h.url) && [r.title_he, r.title_original].filter(Boolean).some(x => hitMatches(h, x)));
    if (hit) {
      const w = loadCloud() ? await verifyPage(hit.url, t, r.author).catch(() => null) : null;
      const ok = w && w.ok;
      out.push({
        key: 'web:' + hit.url, source: 'web', sourceId: hit.url, title: t, subtitle: r.title_he && r.title_original && r.title_original !== r.title_he ? r.title_original : '',
        authors: r.author ? [r.author] : [], year: '', description: (ok && w.description) || r.synopsis_he || '', descSource: ok && w.description ? w.site : '',
        categories: r.genres || [], cover: (ok && w.image) || '', pageCount: 0, language: hasHebrew(t) ? 'he' : '',
        isbns: isbn ? [isbn] : [], link: hit.url, avgRating: 0, ratingsCount: 0, publisher: '', verifiedVia: siteOf(hit.url)
      });
    }
  }
  return out;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
// אימות מהיר להמלצה: חיפוש ממוקד במקביל ב-Google Books ובספרייה הלאומית (מהדורה עברית קודם),
// ורק אם שם עברי לא נמצא באף מאגר, בחנויות ובהוצאות
async function verifyRec(r) {
  const clean = (x) => (x || '').replace(/[^\dXx]/g, '');
  const isbn = clean(r.isbn);
  const author = r.author || '';
  const surname = author.trim().split(/\s+/).pop() || '';
  const he = r.title_he && hasHebrew(r.title_he) ? r.title_he.trim() : '';
  const orig = r.title_original && r.title_original !== he ? r.title_original.trim() : '';
  const match = (list, t) => (list || []).find(c => (isbn && (c.isbns || []).some(x => clean(x) === isbn)) || (t && matchScore(c, `${t} ${author}`) >= 0.6));
  const g = (t, lang) => googleAvailable() ? googleSearch(surname ? `${t} inauthor:${surname}` : t, { lang, max: 10 }).catch(() => []) : Promise.resolve([]);
  const [gHe, nHe, gOrig, byIsbn] = await Promise.all([
    he ? g(he, 'iw') : [], he ? nliSearch({ title: he, author: hasHebrew(author) ? author : '' }).catch(() => []) : [],
    orig ? g(orig) : [], isbn.length === 10 || isbn.length === 13 ? lookupISBN(isbn).then(x => x.candidates).catch(() => []) : []
  ]);
  const hit = match(gHe, he) || match(nHe, he) || match(byIsbn, he || orig) || match(gOrig, orig);
  if (hit) return hit;
  if (!orig && !he) return null;
  if (orig) {
    const ol = await olSearch({ q: `${orig} ${author}`, limit: 5 }).catch(() => []);
    const o = match(ol, orig);
    if (o) return o;
  }
  if (he) {
    const st = await storeSearch(he, author).catch(() => []);
    if (st.length) return { ...st[0], subtitle: orig || '', description: st[0].description || r.synopsis_he || '', categories: r.genres || [] };
  }
  return null;
}
async function verifyPage(url, title, author) {
  const c = loadCloud();
  const r = await fetch(c.url + '/page?' + new URLSearchParams({ url, title: title || '', author: author || '' }));
  if (!r.ok) return null;
  return r.json();
}

// 3. השלמת תקציר, ז'אנרים וזמינות מהמקורות
const FORMAT_SCHEMA = { type: 'object', additionalProperties: false, required: ['print', 'ebook', 'audiobook', 'notes'], properties: {
  print: { type: 'string', enum: ['yes', 'no', 'unknown'] }, ebook: { type: 'string', enum: ['yes', 'no', 'unknown'] },
  audiobook: { type: 'string', enum: ['yes', 'no', 'unknown'] }, notes: { type: 'string', description: 'where, in Hebrew (e.g. e-vrit, Storytel)' } } };
const SOURCES_SCHEMA = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } };
async function aiBookDetails(book, onProgress) {
  const { input, cost } = await aiRun({
    effort: 'medium', onProgress,
    system: 'Find the publisher\'s or a store\'s official synopsis for the given book, its genres, and whether it is available in Israel/Hebrew (or its original language) as print, ebook and audiobook. Read the allowed sites; prefer the publisher page, e-vrit, Steimatzky, Tzomet Sfarim, Storytel. Report only what the pages say; use "unknown" when not stated. ' + HEBREW_OUT,
    prompt: `Book: "${book.title}"${book.subtitle ? ` (${book.subtitle})` : ''} by ${(book.authors || []).join(', ') || 'unknown'}${book.year ? `, ${book.year}` : ''}${book.publisher ? `, publisher ${book.publisher}` : ''}${(book.isbns || [])[0] ? `, ISBN ${book.isbns[0]}` : ''}.`,
    submitTool: {
      name: 'submit_details', description: 'Return what the sources say about this book.',
      input_schema: { type: 'object', additionalProperties: false, required: ['synopsis_he', 'genres', 'formats', 'sources'], properties: {
        synopsis_he: { type: 'string', description: 'the official synopsis, translated to Hebrew if needed; empty if not found' },
        genres: { type: 'array', items: { type: 'string' } }, formats: FORMAT_SCHEMA, sources: SOURCES_SCHEMA } }
    }
  });
  return { ...input, cost };
}

// תרגום תקציר לעברית (בלי חיפוש ברשת, זול)
async function aiTranslate(text) {
  const { input, cost } = await aiRun({
    web: false, effort: 'low',
    system: 'Translate the book synopsis into natural, literary Hebrew. Keep names of people and places in their common Hebrew spelling. Do not add or remove content.',
    prompt: text,
    submitTool: { name: 'submit_translation', description: 'Return the Hebrew translation.',
      input_schema: { type: 'object', additionalProperties: false, required: ['hebrew'], properties: { hebrew: { type: 'string' } } } }
  });
  return { text: input.hebrew || '', cost };
}

// 4. המלצות: המודל קורא את הספרייה, מחפש ביקורות וניתוחים באתרים המאושרים, וחושב
function libraryForPrompt(books, n = 80) {
  const list = books.filter(b => b.status !== 'want').sort((a, b) => b.rating - a.rating || (b.addedAt || 0) - (a.addedAt || 0)).slice(0, n);
  return list.map(b => `- ${b.title} — ${(b.authors || [])[0] || '?'} | ${b.rating}${b.tags.length ? ' | ' + b.tags.slice(0, 3).join(', ') : ''}${b.note ? ' | ' + b.note.replace(/\s+/g, ' ').slice(0, 160) : ''}`).join('\n');
}
function historyForPrompt(history, books) {
  return (history || []).slice(0, 6).map(h => {
    const req = h.answers && h.answers.request ? `"${h.answers.request}"` : answersSummary(h.answers || {}).join('; ') || '(questionnaire)';
    const recs = (h.recs || []).map(r => `${r.title}${findInLibrary(r, books) ? ' [later added to library]' : ''}`).join('; ');
    return `- ${new Date(h.at).toISOString().slice(0, 10)}: asked ${req} → recommended: ${recs || 'nothing'}`;
  }).join('\n');
}
// ההעדפות מהשאלון המשולב, כטקסט למודל
const FOCUS = {
  mood: { label: 'מצב רוח', multi: true, options: Object.entries(MOODS).filter(([k]) => k !== 'surprise').map(([k, v]) => [k, v.label]) },
  genre: { label: "ז'אנר", multi: true, options: STARTER.map(g => [g.tag, g.genre]) },
  origin: { label: 'מקור', options: [['il', 'ספרות ישראלית'], ['tr', 'ספרות מתורגמת']] },
  fame: { label: 'מוכר או פנינה', options: [['known', 'ספרים מוכרים ואהובים'], ['gems', 'פנינים פחות מוכרות']] },
  pacing: { label: 'קצב', options: Object.entries(PACING).map(([k, v]) => [k, v.label]) },
  length: { label: 'אורך', options: Object.entries(LENGTHS).map(([k, v]) => [k, v.label]) },
  format: { label: 'פורמט', multi: true, options: [['print', 'מודפס'], ['ebook', 'דיגיטלי'], ['audio', 'קולי']] },
  avoid: { label: 'בלי', multi: true, options: Object.entries(AVOID).map(([k, v]) => [k, v.label]) }
};
function focusSummary(focus) {
  return Object.entries(FOCUS).map(([id, f]) => {
    const v = focus && focus[id];
    const keys = Array.isArray(v) ? v : v ? [v] : [];
    const labels = keys.map(k => (f.options.find(o => o[0] === k) || [])[1]).filter(Boolean).filter(l => l !== 'לא משנה' && l !== 'לא משנה לי');
    return labels.length ? `${f.label}: ${labels.join(', ')}` : '';
  }).filter(Boolean);
}

// שאלות המשך קצרות לדיוק הבקשה (2–4), לפני ההמלצה
async function aiClarify({ books, request, focus, profile }) {
  const { input } = await aiRun({
    effort: 'low', web: false,
    system: 'You help a reader find their next book. Before recommending, ask 2 to 4 short follow-up questions that would most change which books you pick, given their library and request. Do not ask what they already answered. Each question gets 2–5 short answer options. ' + HEBREW_OUT,
    prompt: `${profile && profile.text ? `READER PROFILE:\n${profile.brief || profile.text}` : `READER'S LIBRARY (title — author | rating 1-5 | tags | notes):\n${libraryForPrompt(books).split('\n').slice(0, 40).join('\n') || '(empty)'}`}\n\nREQUEST: ${request || '(none)'}\nPREFERENCES: ${focusSummary(focus).join('; ') || '(none)'}`,
    submitTool: {
      name: 'submit_questions', description: 'Return 2 to 4 follow-up questions.',
      input_schema: { type: 'object', additionalProperties: false, required: ['questions'], properties: {
        questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'options'], properties: {
          question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } } } } }
    }
  });
  return (input.questions || []).filter(q => q.question && (q.options || []).length).slice(0, 4).map(q => ({ question: q.question, options: q.options.slice(0, 5) }));
}

const REC_TOOL = {
  name: 'submit_recommendations', description: 'Return the final recommendations.',
  input_schema: { type: 'object', additionalProperties: false, required: ['interpretation', 'recommendations'], properties: {
    interpretation: { type: 'string', description: 'one or two sentences in Hebrew: how you understood the reader and the request' },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title_he', 'title_original', 'author', 'isbn', 'why', 'genres'], properties: {
        title_he: { type: 'string', description: 'exact title of a Hebrew edition you know exists; empty if none. Never translate a title yourself.' },
        title_original: { type: 'string' }, author: { type: 'string' }, isbn: { type: 'string', description: 'only if sure, else empty' },
        why: { type: 'string' }, genres: { type: 'array', items: { type: 'string' } } } } } } }
};
/* ---------- הפרופיל הספרותי: נבנה פעם אחת מכל הספרייה, ואחר כך מתעדכן רק עם מה שהשתנה ----------
   ההמלצה שולחת את הפרופיל המתומצת + רק הספרים שנוספו מאז, במקום את כל הספרייה עם כל ההערות בכל פעם */
const PROFILE_TOOL = {
  name: 'submit_profile', description: 'Return the literary profile.',
  input_schema: { type: 'object', additionalProperties: false, required: ['profile_he', 'brief_en'], properties: {
    profile_he: { type: 'string', description: 'the reader\'s literary profile in Hebrew, 120-220 words, as short labelled lines: אוהב/ת, פחות מתחבר/ת, סופרים, נושאים ורגש, סגנון וקצב, מה לא להציע' },
    brief_en: { type: 'string', description: 'the same profile compressed for another model, in English, at most 120 words, dense and specific' } } }
};
const changedSince = (db, at) => db.books.filter(b => (b.editedAt || b.addedAt || 0) > at);
function profileStale(db) {
  const read = db.books.filter(b => b.status !== 'want');
  if (read.length < 3) return false;
  const p = db.litProfile;
  if (!p) return true;
  return changedSince(db, p.at).length + (db.rejections || []).filter(x => (x.at || 0) > p.at && x.note).length + ((db.profileNoteAt || 0) > p.at ? 3 : 0) >= 3;
}
async function aiBuildProfile(db) {
  const p = db.litProfile;
  const wish = db.books.filter(b => b.status === 'want').slice(0, 40).map(b => b.title).join('; ');
  const rej = (db.rejections || []).filter(x => x.note).slice(0, 30).map(x => `${x.title} (${x.note})`).join('; ');
  const note = db.profileNote ? `\nREADER'S OWN NOTE ABOUT THEIR TASTE: ${db.profileNote}` : '';
  const prompt = p && p.text
    ? `CURRENT PROFILE:\n${p.text}${note}\n\nCHANGES SINCE IT WAS WRITTEN (title — author | rating | tags | notes):\n${libraryForPrompt(changedSince(db, p.at), 60) || '(none)'}${wish ? `\nWISHLIST NOW: ${wish}` : ''}${rej ? `\nREJECTED RECOMMENDATIONS WITH REASONS: ${rej}` : ''}\n\nUpdate the profile: keep what still holds, add what the changes show.`
    : `READER'S LIBRARY (title — author | rating 1-5 | tags | notes):\n${libraryForPrompt(db.books, 200)}${note}${wish ? `\nWISHLIST: ${wish}` : ''}${rej ? `\nREJECTED RECOMMENDATIONS WITH REASONS: ${rej}` : ''}\n\nWrite the profile.`;
  const { input, cost } = await aiRun({
    effort: 'low', web: false, prompt, submitTool: PROFILE_TOOL,
    system: 'You are a literary advisor. Build a concise, specific literary taste profile of this reader from what they read, how they rated it, their notes, their wishlist and the recommendations they rejected (with reasons). Name authors, themes, qualities of writing, emotional register and pace. profile_he is written in Hebrew for the reader; brief_en is in English for another model.'
  });
  return { text: input.profile_he, brief: input.brief_en, at: Date.now(), count: db.books.length, cost };
}

function recRequest({ books, request, focus, qa, lang, exclude, dismissed, history, want, profile, profileNote, rejections = [], friendsLoved = [] }) {
  const langText = { he: 'Hebrew only (books available in a Hebrew edition)', en: 'English only', both: 'Hebrew or English editions', any: 'any language', auto: 'Hebrew or English' }[lang] || 'Hebrew or English';
  const excludeTitles = uniq([...books.map(b => b.title), ...exclude, ...(history || []).flatMap(h => (h.recs || []).map(r => r.title))]).slice(0, 300);
  const prefs = focusSummary(focus);
  const read = books.filter(b => b.status !== 'want'), wish = books.filter(b => b.status === 'want');
  const recent = profile ? libraryForPrompt(read.filter(b => (b.editedAt || b.addedAt || 0) > profile.at), 25) : '';
  const readerBlock = profile && profile.text
    ? `READER PROFILE (built from their whole library):\n${profile.brief || profile.text}${recent ? `\n\nADDED OR CHANGED SINCE THE PROFILE (title — author | rating | tags | notes):\n${recent}` : ''}`
    : `READER'S LIBRARY (title — author | rating 1-5 | tags | notes):\n${libraryForPrompt(read) || '(empty)'}`;
  const wishBlock = wish.length ? `\nWISHLIST (they already plan to read these; do not recommend them, but they show current interests): ${wish.slice(0, 40).map(b => b.title).join('; ')}` : '';
  const rejBlock = rejections.length ? `\nREJECTED RECOMMENDATIONS (do not recommend; learn from the reasons): ${rejections.slice(0, 30).map(x => `${x.title}${x.note ? ` (${x.note})` : ''}`).join('; ')}` : '';
  const friendsBlock = friendsLoved.length ? `\nLOVED BY THEIR FRIENDS (optional signal, not a must): ${friendsLoved.join('; ')}` : '';
  return {
    system: [
      'You are a literary advisor with deep knowledge of world and Israeli literature. Recommend books this specific reader will love.',
      'Think about the reader: what their highly rated books and notes have in common (themes, voice, structure, emotional register, pace, setting), and what they rated low. Follow their stated preferences and answers closely.',
      'Choose from your own knowledge of the books, their critical reception and literary analyses. Prefer well-regarded books over merely popular ones when the reader\'s taste is literary, unless they asked for well-known books. Decide quickly.',
      'You have no web access. Every book you name is checked afterwards against the National Library of Israel catalogue, Google Books, Open Library and the Israeli stores and publishers; books that are not found are dropped, so name only real, published books.',
      'title_he must be the exact title of a Hebrew edition you know exists (otherwise empty; never translate a title yourself). Give the ISBN only if you are sure. Never recommend a book the reader already has.',
      '`why` must connect the book to specific books and notes from the reader\'s library, to their answers, and to how critics describe it, in 2–4 sentences.',
      `Language: ${langText}. ` + HEBREW_OUT
    ].join('\n'),
    prompt: `${readerBlock}${profileNote ? `\nREADER'S NOTE ABOUT THEIR TASTE: ${profileNote}` : ''}${wishBlock}${rejBlock}${friendsBlock}\n\nALREADY READ, OWNED OR SEEN (do not recommend): ${[...excludeTitles, ...dismissed.filter(x => !x.includes(':') && !x.includes('|'))].slice(0, 450).join('; ') || 'none'}${history && history.length ? `\n\nEARLIER RECOMMENDATION CONVERSATIONS (learn from them; do not repeat these books):\n${historyForPrompt(history.slice(0, profile ? 3 : 6), books)}` : ''}\n\nREQUEST: ${request || '(no specific request — recommend what fits this reader best)'}${prefs.length ? `\nPREFERENCES: ${prefs.join('; ')}` : ''}${qa && qa.length ? `\nFOLLOW-UP ANSWERS:\n${qa.map(x => `- ${x.q} → ${x.a}`).join('\n')}` : ''}\n\nRecommend ${want + 3} books.`
  };
}

/* עבודת רקע בשרת: ההמלצה ממשיכה גם כשהמסך כבוי או כשעוברים אפליקציה */
const jobsAvailable = () => !!loadCloud() && SYNC.jobs === true;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function startJob({ system, prompt, submitTool, effort }) {
  const c = loadCloud();
  const r = await fetch(c.url + '/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    model: AI_MODEL, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort }, system,
    tools: [{ ...submitTool, strict: true }], messages: [{ role: 'user', content: prompt }], submit: submitTool.name
  }) });
  if (r.status === 429) throw new Error('הגעתם למגבלת השימוש היומית ב-AI. נסו שוב מחר.');
  if (!r.ok) throw new Error('השרת לא הצליח להתחיל את ההמלצה (' + r.status + ').');
  return (await r.json()).id;
}
async function pollJob(id, onProgress) {
  const c = loadCloud();
  const started = Date.now();
  let said = 0;
  for (;;) {
    await sleep(2500);
    let s = null;
    try { s = await (await fetch(c.url + '/jobs/' + id, { cache: 'no-store' })).json(); } catch (e) { continue; }   // רשת נפלה לרגע: ממשיכים לחכות
    if (s.status === 'done') return { input: s.input, cost: (s.usage || []).reduce((a, u) => a + costOf(u), 0), hits: s.hits || [] };
    if (s.status === 'error') throw new Error(/daily|429/.test(s.error) ? 'הגעתם למגבלת השימוש היומית ב-AI.' : 'השירות החזיר שגיאה ' + String(s.error || '').slice(0, 140));
    if (s.status === 'missing') throw new Error('ההמלצה כבר לא שמורה בשרת. נסו שוב.');
    const sec = Math.round((Date.now() - started) / 1000);
    if (onProgress && sec - said >= 30) { said = sec; onProgress(`Claude עדיין חושב (${sec} שניות). אפשר לצאת מהאפליקציה, ההמלצה תחכה כאן.`); }
    if (Date.now() - started > 20 * 60000) throw new Error('ההמלצה לקחה יותר מדי זמן. נסו שוב.');
  }
}
const PENDING_KEY = () => 'vrt-rec-job-' + ACTIVE.id;
const loadPending = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY()) || 'null'); } catch (e) { return null; } };
const savePending = (p) => { try { p ? localStorage.setItem(PENDING_KEY(), JSON.stringify(p)) : localStorage.removeItem(PENDING_KEY()); } catch (e) { /* */ } };

// שלב 1: המודל מציע (בשרת אם אפשר). שלב 2: כל הצעה נבדקת במאגרים ובחנויות, ומקבלת זמינות, קישור ותקציר מהמקור
async function aiRecommend(opts) {
  const { books, onProgress } = opts;
  const { system, prompt } = recRequest(opts);
  onProgress && onProgress(`שולח ל-Claude את הספרייה שלך (${books.length} ספרים), הבקשה והתשובות. זה לוקח בדרך כלל דקה או שתיים.`);
  let res;
  if (jobsAvailable()) {
    const id = await startJob({ system, prompt, submitTool: REC_TOOL, effort: 'medium' });
    savePending({ id, at: Date.now(), ctx: opts.ctx || null });
    res = await pollJob(id, onProgress);
  } else {
    res = await aiRun({ effort: 'medium', web: false, onProgress, system, prompt, submitTool: REC_TOOL });
  }
  savePending(null);
  return finishRecs({ ...opts, ...res });
}
async function resumeRecommend(pending, opts) {
  const res = await pollJob(pending.id, opts.onProgress);
  savePending(null);
  return finishRecs({ ...opts, ...res });
}
async function finishRecs({ input, cost, books, exclude, want = 5, onProgress }) {
  onProgress && onProgress(`Claude הציע ${input.recommendations.length} ספרים. בודק כל אחד מול הספרייה הלאומית, Google Books והחנויות…`);
  // כל ההצעות נבדקות במקביל, כל אחת עם תקרת זמן, כדי שספר אחד איטי לא יתקע את כולן
  const checked = await Promise.all(input.recommendations.map(r => withTimeout(verifyRec(r), 30000).catch(() => null)));
  const recs = [];
  let rejected = 0;
  input.recommendations.forEach((r, i) => {
    const c = checked[i];
    if (recs.length >= want) return;
    if (!c || findInLibrary(c, books) || exclude.includes(c.key) || recs.some(x => x.key === c.key)) { rejected++; return; }
    recs.push({ ...c, reasons: [r.why], genres: r.genres, verifiedAt: Date.now(), verifiedVia: c.verifiedVia || (c.source === 'google' ? 'Google Books' : 'Open Library') });
  });
  onProgress && onProgress(`אומתו ${recs.length} ספרים${rejected ? `; ${rejected} נפסלו (לא נמצאו במאגרים, או כבר אצלך)` : ''}. בודק זמינות בחנויות…`);
  const rich = await Promise.all(recs.map(r => withTimeout(enrichRec(r), 30000).catch(() => r)));
  onProgress && onProgress(`מוכן. עלות משוערת: $${cost.toFixed(2)}`);
  return { recs: rich, interpretation: input.interpretation, cost };
}
// זמינות (מודפס/דיגיטלי/קולי) וקישורים מהחנויות, ותקציר בשפת הספר מהמקור (לא תרגום)
function kindsOf(site, text) {
  const t = text || '';
  if (site === 'e-vrit.co.il') return /קולי|אודיו|audio|האזנה/i.test(t) ? ['audio'] : ['ebook'];
  if (site === 'steimatzky.co.il') return /דיגיטלי|e-?book/i.test(t) ? ['ebook'] : /קולי|אודיו/.test(t) ? ['audio'] : ['print'];
  return ['print'];
}
// זמינות + קישורים + תקציר מהשרת (מאגרים → סטימצקי/צומת לפי ISBN → חנויות לפי שם), נשמר בשרת ל-4 ימים
async function fetchBookInfo(book) {
  const c = loadCloud();
  if (!c) return null;
  const isbns = (book.isbns || []).map(x => String(x).replace(/[^\dXx]/g, ''));
  const isbn = isbns.find(x => /^(978)?965/.test(x)) || isbns[0] || '';
  return fetchJSON(c.url + '/bookinfo?' + new URLSearchParams({ isbn, title: book.title || '', author: (book.authors || [])[0] || '' }), 40000);
}
async function enrichRec(rec) {
  const info = await fetchBookInfo(rec).catch(() => null);
  const offers = [];
  if (rec.ebook) offers.push({ site: 'Google Play', url: rec.ebookLink || rec.link, kinds: ['ebook'] });
  if (rec.source === 'web' && rec.link) offers.push({ site: rec.verifiedVia, url: rec.link, kinds: kindsOf(rec.verifiedVia, `${rec.title} ${rec.description}`) });
  let out = { ...rec };
  if (info) {
    (info.urls || []).forEach(u => { if (!offers.some(o => o.url === u.url)) offers.push(u); });
    // תקציר: מה שכבר יש מהמאגרים קודם; תקציר עברי מהשרת רק אם חסר תקציר עברי
    if (info.synopsis && hasHebrew(info.synopsis) && !hasHebrew(out.description || '')) out = { ...out, description: info.synopsis, descSource: STORE_NAMES[info.synopsisSource] || info.synopsisSource, descriptionHe: '' };
    else if (info.synopsis && !out.description) out = { ...out, description: info.synopsis, descSource: info.synopsisSource };
    if (!out.cover && info.cover) out.cover = info.cover;
    if (info.isbn && !(out.isbns || []).length) out.isbns = [info.isbn];
  }
  return { ...out, offers, availability: info ? info.available : null };
}

/* ============================================================
   מנוע ההמלצות הדטרמיניסטי
   ============================================================ */
function buildProfile(allBooks) {
  const books = allBooks.filter(b => b.status !== 'want');
  const authors = new Map(), cats = new Map(), tags = new Map();
  const negAuthors = new Set();
  const add = (map, name, w, book) => {
    if (!name) return;
    const k = name.trim();
    const cur = map.get(k) || { name: k, w: 0, books: [] };
    cur.w += w; cur.books.push(book); map.set(k, cur);
  };
  books.forEach(b => {
    const w = b.rating >= 5 ? 2 : b.rating >= 4 ? 1 : b.rating <= 2 ? -1 : 0;
    if (w > 0) {
      (b.authors || []).slice(0, 2).forEach(a => add(authors, a, w, b));
      (b.categories || []).slice(0, 5).filter(c => !/^(fiction|ספרות|nonfiction)$/i.test(c)).forEach(c => add(cats, c, w, b));
    }
    if (b.rating <= 2) (b.authors || []).forEach(a => negAuthors.add(norm(a)));
    (b.tags || []).forEach(t => add(tags, t, w, b));
  });
  const top = (m) => Array.from(m.values()).filter(x => x.w > 0).sort((a, b) => b.w - a.w || b.books.length - a.books.length);
  const favorites = books.filter(b => b.rating >= 4).sort((a, b) => b.rating - a.rating);
  const heCount = books.filter(b => ['iw', 'he', 'heb'].includes(b.language) || hasHebrew(b.title)).length;
  return { topAuthors: top(authors), topCats: top(cats), topTags: top(tags), negAuthors, favorites, heShare: books.length ? heCount / books.length : 0.5 };
}

function buildPlans(prof, answers, lang) {
  const plans = [];
  const seen = new Set();
  const push = (p) => { const k = p.kind + ':' + (p.g || '') + ':' + JSON.stringify(p.ol); if (!seen.has(k)) { seen.add(k); plans.push(p); } };
  prof.topAuthors.slice(0, 3).forEach(a => push({ kind: 'author', sig: a, g: `inauthor:"${a.name}"`, ol: { author: a.name } }));
  prof.topCats.slice(0, 2).forEach(c => push({ kind: 'category', sig: c, g: `subject:"${c.name}"`, ol: { subject: c.name.toLowerCase() } }));
  prof.topTags.slice(0, 3).forEach(t => {
    const subj = TAG_SUBJECTS[t.name];
    if (subj) push({ kind: 'tag', sig: t, g: `subject:"${subj}"`, ol: { subject: subj } });
  });
  const mood = MOODS[answers.mood];
  if (mood && mood.en) {
    push({ kind: 'mood', sig: mood, g: `subject:"${mood.en}"`, ol: { subject: mood.en } });
    if ((lang === 'he' || lang === 'both') && mood.he) push({ kind: 'mood', sig: mood, g: mood.he, ol: { q: mood.he } });
  }
  if (answers.pacing === 'fast' && !(mood && mood.en === 'thriller')) push({ kind: 'pacing', sig: PACING.fast, g: 'subject:"adventure"', ol: { subject: 'adventure' } });
  if (plans.length < 3) {
    push({ kind: 'general', sig: null, g: lang === 'he' ? 'רומן' : 'subject:"fiction"', ol: lang === 'he' ? { q: 'רומן' } : { subject: 'fiction' } });
    if (lang !== 'he') push({ kind: 'general', sig: null, g: 'subject:"literary fiction"', ol: { subject: 'literary fiction' } });
  }
  return plans.slice(0, 9);
}

async function runPlan(plan, lang) {
  if (lang === 'both') {
    // עברית ואנגלית: שתי שאילתות, אחת לכל שפה
    const [a, b] = await Promise.all([runPlan(plan, 'he'), runPlan(plan, 'en')]);
    return { list: mergeByKey(a.list, b.list), source: a.source || b.source };
  }
  const glang = lang === 'he' ? 'iw' : lang === 'en' ? 'en' : undefined;
  if (googleAvailable()) {
    try {
      const r = await googleSearch(plan.g, { lang: glang, max: 20 });
      return { list: r, source: 'Google Books' };
    } catch (e) { /* ממשיכים ל-Open Library */ }
  }
  try {
    const r = await olSearch({ ...plan.ol, lang, limit: 20 });
    return { list: r, source: 'Open Library' };
  } catch (e) { return { list: [], source: null }; }
}

const textOf = (c) => ((c.categories || []).join(' ') + ' ' + c.title + ' ' + (c.subtitle || '') + ' ' + (c.description || '')).toLowerCase();
const matchesAny = (text, kws) => (kws || []).some(k => text.includes(k.toLowerCase()));
const langOk = (c, lang) => {
  if (!c.language || lang === 'any') return true;
  if (lang === 'he') return ['iw', 'he', 'heb'].includes(c.language);
  if (lang === 'en') return ['en', 'eng'].includes(c.language);
  if (lang === 'both') return ['iw', 'he', 'heb', 'en', 'eng'].includes(c.language);
  return true;
};
const REC_LANGS = [['he', 'עברית'], ['both', 'עברית ואנגלית'], ['en', 'אנגלית'], ['any', 'כל שפה'], ['auto', 'אוטומטי']];
const recLangLabel = (k) => (REC_LANGS.find(x => x[0] === k) || ['', k])[1];
function passesAvoid(c, answers) {
  const t = textOf(c);
  return !(answers.avoid || []).some(k => AVOID[k] && matchesAny(t, AVOID[k].kw));
}
function lengthFit(c, answers) {
  const L = LENGTHS[answers.length];
  if (!L || !L.range || !c.pageCount) return null;
  return c.pageCount >= L.range[0] && c.pageCount <= L.range[1];
}

function scoreCandidate(c, prof, answers) {
  let s = 0;
  const t = textOf(c);
  c.hits.forEach(h => {
    if (h.kind === 'author') s += 4 * h.sig.w;
    else if (h.kind === 'category') s += 2 * h.sig.w;
    else if (h.kind === 'tag') s += 1.5 * h.sig.w;
    else if (h.kind === 'mood') s += 2;
    else if (h.kind === 'pacing') s += 1;
    else s += 0.3;
  });
  const catSet = new Set((c.categories || []).map(x => x.toLowerCase()));
  prof.topCats.slice(0, 6).forEach(pc => { if (catSet.has(pc.name.toLowerCase())) s += 1; });
  const mood = MOODS[answers.mood];
  if (mood && matchesAny(t, mood.kw)) s += 1;
  const pace = PACING[answers.pacing];
  if (pace && matchesAny(t, pace.kw)) s += 1;
  if (lengthFit(c, answers) === true) s += 1;
  if (c.cover) s += 0.5;
  if (c.description) s += 0.5;
  if (isHebrewEdition(c)) s += 1.5;
  if (c.avgRating >= 4) s += 0.5;
  if (c.ratingsCount) s += Math.min(1, Math.log10(c.ratingsCount + 1) / 3);
  return s;
}

// אימות חוזר בזמן אמת: שליפה מחדש של הרשומה לפי מזהה המקור
async function verifyCandidate(c) {
  try {
    if (c.source === 'google') {
      let fresh = null;
      try { fresh = googleAvailable() ? await googleById(c.sourceId) : null; } catch (e) { if (e.status === 404) return null; fresh = null; }
      if (fresh) {
        if (normTitle(fresh.title) !== normTitle(c.title) && !normTitle(fresh.title).includes(normTitle(c.title))) return null;
        const merged = { ...c, ...fresh, description: fresh.description || c.description, categories: fresh.categories.length ? fresh.categories : c.categories, cover: fresh.cover || c.cover };
        return merged.description.length >= 40 && merged.authors.length ? { ...merged, verifiedAt: Date.now(), verifiedVia: 'Google Books' } : null;
      }
      // Google חסום זמנית: הרשומה הגיעה מקריאת API חיה בחיפוש, ומאמתים אותה מול Open Library לפי ISBN
      const isbn = (c.isbns || [])[0];
      if (isbn) {
        const ol = await olByISBN(isbn).catch(() => null);
        if (ol && ol.authors.length) {
          const desc = c.description || ol.description;
          return desc.length >= 40 ? { ...c, description: desc, verifiedAt: Date.now(), verifiedVia: 'Open Library (ISBN)' } : null;
        }
      }
      return null;
    }
    const w = await olWork(c.sourceId);
    if (!w.title || (normTitle(w.title) !== normTitle(c.title) && !normTitle(w.title).includes(normTitle(c.title)))) return null;
    if (!w.description || w.description.length < 40) return null;
    return { ...c, description: w.description, cover: c.cover || w.cover, verifiedAt: Date.now(), verifiedVia: 'Open Library' };
  } catch (e) { return null; }
}

function explain(c, prof, answers) {
  const out = [];
  const q = (t) => `"${t}"`;
  const authorHit = c.hits.find(h => h.kind === 'author');
  if (authorHit) {
    const fav = authorHit.sig.books.slice().sort((a, b) => b.rating - a.rating)[0];
    out.push(`מאת ${authorHit.sig.name}, שאת ספרו/ה ${q(fav.title)} דירגת ${fav.rating}★`);
  }
  const catHit = c.hits.find(h => h.kind === 'category');
  if (catHit) {
    const titles = Array.from(new Set(catHit.sig.books.map(b => b.title))).slice(0, 2);
    out.push(`באותה קטגוריה (${catHit.sig.name}) כמו ${titles.map(q).join(' ו-')} שאהבת`);
  }
  const tagHit = c.hits.find(h => h.kind === 'tag');
  if (tagHit) {
    const b = tagHit.sig.books.slice().sort((x, y) => y.rating - x.rating)[0];
    out.push(`תואם לתגית "${tagHit.sig.name}" שסימנת על ${q(b.title)} (${b.rating}★)`);
  }
  const mood = MOODS[answers.mood];
  const t = textOf(c);
  if (mood && mood.en && (c.hits.some(h => h.kind === 'mood') || matchesAny(t, mood.kw))) out.push(`עונה לבקשה שלך: ${mood.label}`);
  const pace = PACING[answers.pacing];
  if (pace && pace.kw.length && matchesAny(t, pace.kw)) out.push(`סימנים לקצב ${pace.label.split(',')[0]} בתיאור ובקטגוריות`);
  if (lengthFit(c, answers) === true) out.push(`${c.pageCount} עמודים — ${LENGTHS[answers.length].label.split(' (')[0]}, כפי שביקשת`);
  if ((answers.avoid || []).length) out.push(`סונן: אין אזכור ל${answers.avoid.map(k => AVOID[k].label).join(', ')}`);
  if (c.avgRating >= 3.5 && c.ratingsCount >= 3) out.push(`דירוג קוראים ${c.avgRating} מתוך 5 (${c.ratingsCount.toLocaleString(DEFAULT_LOCALE)} דירוגים)`);
  if (!out.length) out.push('נמצא בחיפוש לפי תשובות השאלון ועבר את כל מסנני האימות');
  return out;
}

async function recommend({ books, answers, lang, exclude, dismissed, want = 5, onProgress }) {
  const prof = buildProfile(books);
  const plans = buildPlans(prof, answers, lang);
  onProgress(`בונה פרופיל טעם: ${prof.favorites.length} ספרים שדירגת 4★ ומעלה, ${prof.topTags.length} תגיות פעילות.`);
  onProgress(`שולח ${plans.length} שאילתות חיפוש למאגרי הספרים…`);
  const pool = new Map();
  const usedSources = new Set();
  for (let i = 0; i < plans.length; i += 3) {
    const batch = plans.slice(i, i + 3);
    const results = await Promise.all(batch.map(p => runPlan(p, lang)));
    results.forEach((r, j) => {
      if (r.source) usedSources.add(r.source);
      r.list.forEach(c => {
        const k = dedupeKey(c);
        const cur = pool.get(k);
        if (cur) { if (!cur.hits.includes(batch[j])) cur.hits.push(batch[j]); if (!cur.description && c.description) cur.description = c.description; }
        else pool.set(k, { ...c, hits: [batch[j]] });
      });
    });
  }
  const all = Array.from(pool.values());
  onProgress(`התקבלו ${all.length} ספרים אמיתיים מ-${Array.from(usedSources).join(' + ') || 'המקורות'}. מסנן…`);
  const dismissedSet = new Set(dismissed);
  const filtered = all.filter(c =>
    c.title && c.authors.length &&
    !JUNK_TITLE.test(c.title + ' ' + (c.subtitle || '')) &&
    !findInLibrary(c, books) && !exclude.has(c.key) && !exclude.has(dedupeKey(c)) &&
    !dismissedSet.has(c.key) && !dismissedSet.has(dedupeKey(c)) &&
    !c.authors.some(a => prof.negAuthors.has(norm(a))) &&
    langOk(c, lang) && passesAvoid(c, answers) && lengthFit(c, answers) !== false
  );
  filtered.forEach(c => { c.score = scoreCandidate(c, prof, answers); });
  filtered.sort((a, b) => b.score - a.score);
  onProgress(`${filtered.length} מועמדים עברו סינון (ספרים שכבר קראת, נושאים להימנע, אורך ושפה). מאמת את המובילים מול ה-API…`);
  const accepted = [];
  const perAuthor = new Map();
  let rejected = 0;
  for (const c of filtered) {
    if (accepted.length >= want) break;
    if (accepted.length + rejected >= want * 4) break;
    const a = norm(c.authors[0]);
    if ((perAuthor.get(a) || 0) >= 2) continue;
    const v = await verifyCandidate(c);
    if (v && passesAvoid(v, answers)) {
      v.reasons = explain(v, prof, answers);
      accepted.push(v);
      perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    } else rejected++;
  }
  onProgress(`אומתו ${accepted.length} ספרים${rejected ? `; ${rejected} נדחו (לא אומתו מחדש או ללא תקציר רשמי)` : ''}.`);
  return { recs: accepted, profile: prof, poolSize: all.length };
}

/* ============================================================
   רכיבי ממשק בסיסיים
   ============================================================ */
const toCamel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function Icon({ name, size = 20, className = '', strokeWidth = 2 }) {
  const lib = window.lucide && window.lucide.icons;
  const node = lib && lib[name];
  if (!node) return <span aria-hidden="true" className={'inline-block ' + className} style={{ width: size, height: size }} />;
  const children = node[0] === 'svg' ? node[2] : node;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {(children || []).map(([tag, attrs], i) => {
        const p = { key: i };
        Object.entries(attrs || {}).forEach(([k, v]) => { if (k !== 'key') p[toCamel(k)] = v; });
        return React.createElement(tag, p);
      })}
    </svg>
  );
}

function Stars({ value, onChange, size = 22, label }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5 text-brass" aria-label={`${value} מתוך 5 כוכבים`}>
        {[1, 2, 3, 4, 5].map(n => <span key={n} style={{ opacity: n <= value ? 1 : 0.25 }}><Icon name="Star" size={size} className={n <= value ? 'fill-current' : ''} /></span>)}
      </span>
    );
  }
  return (
    <div role="radiogroup" aria-label={label || 'דירוג'} className="flex items-center gap-1" dir="rtl" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} כוכבים`}
          onClick={() => onChange(n)} onMouseEnter={() => setHover(n)}
          className="w-12 h-12 grid place-items-center rounded-xl text-brass active:scale-90 transition-transform">
          <span style={{ opacity: n <= shown ? 1 : 0.3 }}><Icon name="Star" size={size} className={n <= shown ? 'fill-current' : ''} /></span>
        </button>
      ))}
    </div>
  );
}

function Cover({ book, className = 'w-16 h-24' }) {
  const [err, setErr] = useState(false);
  if (!book.cover || err) {
    return (
      <div className={className + ' shrink-0 rounded-md bg-accentSoft text-accent grid place-items-center font-display font-medium text-xl border border-line'} aria-hidden="true">
        {(book.title || '?').trim().charAt(0)}
      </div>
    );
  }
  return <img src={book.cover} alt={`כריכת ${book.title}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setErr(true)}
    className={className + ' shrink-0 rounded-md object-cover bg-surface2 border border-line shadow-sm'} />;
}

function SourceBadge({ book }) {
  const SITE_NAMES = STORE_NAMES;
  const src = SITE_NAMES[book.verifiedVia] || book.verifiedVia || (book.source === 'google' ? 'Google Books' : book.source === 'openlibrary' ? 'Open Library' : book.source === 'wikidata' ? 'Wikidata' : 'מקור');
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full bg-accentSoft text-accent">
      <Icon name="ShieldCheck" size={13} /> מאומת · {src}
    </span>
  );
}

function Chip({ active, onClick, children, className = '' }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active}
      className={`min-h-[40px] px-3.5 rounded-full border text-[15px] font-medium transition-colors inline-flex items-center gap-1 ${active ? 'bg-accentSoft text-accent border-accent' : 'bg-surface text-ink border-line hover:border-accent'} ${className}`}>
      {children}
    </button>
  );
}

function Btn({ variant = 'primary', className = '', children, ...rest }) {
  const styles = {
    primary: 'btn-primary text-accentInk border-transparent',
    ghost: 'bg-transparent text-ink border-line',
    soft: 'bg-accentSoft text-accent border-transparent',
    danger: 'bg-transparent text-danger border-danger'
  }[variant];
  return (
    <button type="button" {...rest}
      className={`min-h-[48px] px-4 rounded-xl border font-semibold text-[16px] inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}>
      {children}
    </button>
  );
}

function Spinner({ size = 18 }) { return <span className="spin inline-flex"><Icon name="LoaderCircle" size={size} /></span>; }

function Notice({ tone = 'info', children }) {
  const map = { info: 'text-muted border-line', warn: 'text-warn border-warn', error: 'text-danger border-danger', ok: 'text-ok border-ok' };
  const icon = { info: 'Info', warn: 'TriangleAlert', error: 'CircleAlert', ok: 'CircleCheck' }[tone];
  return (
    <div className={`flex gap-2 items-start text-[14px] border rounded-xl px-3 py-2 bg-surface ${map[tone]}`}>
      <span className="mt-0.5"><Icon name={icon} size={16} /></span><div className="flex-1">{children}</div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}>
      <div className="fade-in pointer-events-auto bg-ink text-bg px-4 py-3 rounded-xl shadow-md text-[15px] font-semibold max-w-md" role="status">{toast}</div>
    </div>
  );
}

function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  // בפורטל ל-body: כך הגיליון תמיד מעל סרגל הניווט, גם כשהלשונית שמתחתיו באנימציה
  return ReactDOM.createPortal((
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="sheet-in relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-surface rounded-t-3xl sm:rounded-2xl border border-line shadow-md">
        <div className="sticky top-0 bg-surface flex items-center justify-between px-4 pt-3 pb-2 border-b border-line z-10">
          <h2 className="font-display font-medium text-[20px]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="w-11 h-11 grid place-items-center rounded-full hover:bg-surface2"><Icon name="X" size={22} /></button>
        </div>
        <div className="px-4 pt-3 safe-bottom pb-5">{children}</div>
      </div>
    </div>
  ), document.body);
}

/* ============================================================
   גיליון דירוג ותיוג
   ============================================================ */
function RateSheet({ book, existing, tagLibrary, onSave, onClose, initialStatus }) {
  const [status, setStatus] = useState(initialStatus || (existing ? existing.status || 'read' : 'read'));
  const [rating, setRating] = useState(existing ? existing.rating : (book.presetRating || 0));
  const [tags, setTags] = useState(existing ? existing.tags : []);
  const [note, setNote] = useState(existing ? existing.note || '' : (book.note || ''));
  const [draft, setDraft] = useState('');
  const suggested = useMemo(() => {
    const fromCats = [];
    (book.categories || []).forEach(c => {
      const lc = c.toLowerCase();
      Object.entries(TAG_SUBJECTS).forEach(([he, en]) => { if (lc.includes(en) && !fromCats.includes(he)) fromCats.push(he); });
    });
    return Array.from(new Set([...fromCats, ...tagLibrary]));
  }, [book, tagLibrary]);
  const toggle = (t) => setTags(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);
  const addDraft = () => {
    const t = draft.trim().replace(/\s+/g, ' ').slice(0, 30);
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setDraft('');
  };
  const ratingText = ['', 'לא אהבתי', 'פחות התחברתי', 'סביר', 'אהבתי', 'אהבתי מאוד'][rating];
  return (
    <Sheet open={!!book} onClose={onClose} title={existing ? 'עריכת דירוג ותגיות' : 'דירוג ותיוג'}>
      <div className="flex gap-3 items-start mb-4">
        <Cover book={book} className="w-14 h-20" />
        <div className="min-w-0">
          <div className="font-display font-medium text-[18px] leading-tight">{book.title}</div>
          <div className="text-muted text-[14px]">{(book.authors || []).join(', ')}{book.year ? ` · ${book.year}` : ''}</div>
          <div className="mt-1"><SourceBadge book={book} /></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface2 mb-4" role="tablist" aria-label="סטטוס">
        {[['read', 'קראתי', 'BookCheck'], ['want', 'רוצה לקרוא', 'Bookmark']].map(([k, l, ic]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => setStatus(k)}
            className={`min-h-[44px] rounded-xl font-semibold text-[15px] inline-flex items-center justify-center gap-1.5 ${status === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}><Icon name={ic} size={17} />{l}</button>
        ))}
      </div>
      {status === 'read' && (
        <fieldset className="mb-4">
          <legend className="text-[13px] font-semibold tracking-wide text-muted mb-1">דירוג (חובה)</legend>
          <div className="flex items-center gap-3 flex-wrap">
            <Stars value={rating} onChange={setRating} size={28} label="דירוג הספר" />
            <span className="text-[15px] font-semibold text-muted min-h-[1.5em]">{ratingText}</span>
          </div>
        </fieldset>
      )}
      <fieldset className="mb-4">
        <legend className="text-[13px] font-semibold tracking-wide text-muted mb-2">תגיות</legend>
        <div className="flex flex-wrap gap-2 mb-3">
          {suggested.map(t => <Chip key={t} active={tags.includes(t)} onClick={() => toggle(t)}>{t}</Chip>)}
          {tags.filter(t => !suggested.includes(t)).map(t => <Chip key={t} active onClick={() => toggle(t)}>{t}</Chip>)}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addDraft(); }}>
          <label htmlFor="new-tag" className="sr-only">תגית חדשה</label>
          <input id="new-tag" value={draft} onChange={e => setDraft(e.target.value)} placeholder="תגית משלך, למשל: סוף מפתיע"
            className="flex-1 min-w-0 min-h-[48px] px-3 rounded-xl border border-line bg-bg text-[16px]" />
          <Btn variant="soft" type="submit" disabled={!draft.trim()}><Icon name="Plus" size={18} />הוספה</Btn>
        </form>
      </fieldset>
      <div className="mb-4">
        <label htmlFor="book-note" className="block text-[13px] font-semibold tracking-wide text-muted mb-1.5">{status === 'want' ? 'למה בא לך לקרוא אותו? (רשות)' : 'מה חשבת על הספר? (רשות)'}</label>
        <textarea id="book-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={4000}
          placeholder="מה אהבת, מה פחות, למי היית ממליץ… ההמלצות החכמות משתמשות בזה."
          className="w-full rounded-xl border border-line bg-bg p-2.5 text-[16px] leading-relaxed" />
      </div>
      <Btn className="w-full" disabled={status === 'read' && !rating} onClick={() => onSave({ status, rating: status === 'want' ? 0 : rating, tags, note: note.trim() })}>
        <Icon name="Check" size={20} />{existing ? 'שמירת שינויים' : status === 'want' ? 'הוספה לרשימת "רוצה לקרוא"' : 'שמירה לספרייה'}
      </Btn>
      {status === 'read' && !rating && <p className="text-center text-muted text-[13px] mt-2">בחרו דירוג כדי לשמור</p>}
    </Sheet>
  );
}

/* ============================================================
   לשונית: הספרים שלי
   ============================================================ */
/* ---------- היכרות ראשונה: סימון ספרים מוכרים ---------- */
const STARTER_RATINGS = [[5, 'אהבתי'], [3, 'בסדר'], [2, 'פחות']];
const STARTER_KEY = (b) => b[0] + '|' + b[1];
// חפיסה אחת לפי ז'אנרים; "ז'אנר הבא" קופץ לתחילת הז'אנר הבא
const STARTER_DECK = STARTER.flatMap((g, gi) => g.books.map(b => [b, gi]));
const GENRE_START = STARTER.map((_, gi) => STARTER_DECK.findIndex(x => x[1] === gi));

/* ---------- כריכות לכרטיסי ההיכרות: חיפוש קל ב-Google ואז Open Library, נשמר במטמון מקומי ---------- */
const COVER_CACHE_KEY = 'vrt-starter-covers';
let coverCache = null;
const coverPending = {};
function coverCacheGet() {
  if (!coverCache) { try { coverCache = JSON.parse(localStorage.getItem(COVER_CACHE_KEY) || '{}') || {}; } catch (e) { coverCache = {}; } }
  return coverCache;
}
function starterCover(b) {
  const k = STARTER_KEY(b);
  const cache = coverCacheGet();
  const hit = cache[k];
  // כריכה שנמצאה נשמרת לתמיד; "אין כריכה" נבדק שוב אחרי שבוע
  if (typeof hit === 'string' && hit) return Promise.resolve(hit);
  if (hit && typeof hit === 'object' && Date.now() - hit.miss < 7 * 864e5) return Promise.resolve('');
  if (coverPending[k]) return coverPending[k];
  const [title, author, original] = b;
  const surname = (author || '').split(' ').pop();
  coverPending[k] = (async () => {
    let url = '', failed = false;
    const google = async (q, want) => {
      if (url) return;
      try {
        const data = await googleFetch(googleUrl('', { q, maxResults: 8, printType: 'books' }));
        const c = (data.items || []).map(normGoogle).find(x => x.cover && want.some(w => matchScore(x, w) >= 0.5));
        if (c) url = c.cover;
      } catch (e) { failed = true; }
    };
    const ol = async (t) => {
      if (url || !t) return;
      try {
        const d = await fetchJSON(OL_BASE + '/search.json?' + new URLSearchParams({ title: t, author: surname, limit: '5', fields: 'cover_i' }));
        const doc = (d.docs || []).find(x => x.cover_i);
        if (doc) url = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
      } catch (e) { failed = true; }
    };
    // ויקיפדיה (דרך Wikidata, עם בדיקת מחבר): כמעט לכל ספר מוכר יש שם תמונת כריכה
    const wiki = async (t) => {
      if (url || !t) return;
      try {
        const w = (await wikidataBooks(t, author))[0];
        if (!w) return;
        for (const [lang, page] of [['he', w.hewiki], ['en', w.enwiki]]) {
          if (url || !page) continue;
          const sm = await wikiSummary(lang, page).catch(() => null);
          if (sm && sm.thumb) url = sm.thumb;
        }
      } catch (e) { failed = true; }
    };
    await google(`intitle:${title} inauthor:${surname}`, [`${title} ${author}`]);
    await wiki(title);
    if (original) await wiki(original);
    await google(`${title} ${author}`, [`${title} ${author}`]);
    if (original) await google(`intitle:${original} inauthor:${surname}`, [original, `${original} ${author}`]);
    await ol(original || title);
    if (original) await ol(title);
    if (url || !failed) {
      cache[k] = url || { miss: Date.now() };
      try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* */ }
    }
    delete coverPending[k];
    return url;
  })();
  return coverPending[k];
}
function useStarterCover(b) {
  const cached = (x) => { const v = x && coverCacheGet()[STARTER_KEY(x)]; return typeof v === 'string' ? v : ''; };
  const [url, setUrl] = useState(() => cached(b));
  const [done, setDone] = useState(() => !!cached(b));
  useEffect(() => {
    if (!b) return undefined;
    let alive = true;
    setUrl(cached(b)); setDone(!!cached(b));
    starterCover(b).then(u => { if (alive) { setUrl(u || ''); setDone(true); } });
    return () => { alive = false; };
  }, [b && STARTER_KEY(b)]);
  return [url, done];
}
function StarterCover({ b, className }) {
  const [url, done] = useStarterCover(b);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  if (url && !bad) return <img src={url} alt="" className={`object-contain ${className}`} onError={() => setBad(true)} referrerPolicy="no-referrer" draggable="false" />;
  return (
    <div className={`bg-accentSoft text-accent grid place-items-center text-center p-3 ${className}`} aria-hidden="true">
      {done ? <span className="font-display font-medium text-[18px] leading-snug">{b[0]}</span> : <Spinner />}
    </div>
  );
}

/* ---------- היכרות ראשונה: סוויפ ימינה "קראתי", שמאלה "לא קראתי", ואז דירוג אם רוצים ---------- */
function loadStarterState() {
  try { const s = JSON.parse(localStorage.getItem('vrt-starter2-' + ACTIVE.id) || 'null'); if (s && typeof s.pos === 'number' && s.picks) return s; } catch (e) { /* */ }
  return { pos: 0, picks: {}, trail: [] };
}
function SwipeCard({ b, gi, onSwipe, top }) {
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(0);
  const drag = useRef(null);
  useEffect(() => { setDx(0); setGone(0); }, [b]);
  const down = (e) => { if (!top) return; drag.current = { x: e.clientX, id: e.pointerId, t: Date.now() }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* */ } };
  const move = (e) => { if (drag.current && drag.current.id === e.pointerId) { drag.current.dx = e.clientX - drag.current.x; setDx(drag.current.dx); } };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const moved = d.dx || 0, fast = Math.abs(moved) > 35 && Math.abs(moved) / Math.max(1, Date.now() - d.t) > 0.45;
    if (Math.abs(moved) > 70 || fast) { setGone(moved > 0 ? 1 : -1); setTimeout(() => onSwipe(moved > 0), 160); } else setDx(0);
  };
  const x = gone ? gone * 480 : dx;
  const hint = x > 30 ? 'read' : x < -30 ? 'unread' : '';
  return (
    <div role={top ? 'group' : undefined} aria-label={top ? `${b[0]}, ${b[1]}` : undefined} aria-hidden={top ? undefined : 'true'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      className={`absolute inset-0 bg-surface border border-line rounded-2xl shadow-md overflow-hidden select-none flex flex-col ${top ? 'cursor-grab' : 'scale-[.96] translate-y-2 opacity-70'}`}
      style={top ? { transform: `translateX(${x}px) rotate(${x / 22}deg)`, transition: drag.current ? 'none' : 'transform .18s ease-out', touchAction: 'pan-y' } : undefined}>
      <div className="relative flex-1 min-h-0 bg-surface2 flex justify-center">
        <StarterCover b={b} className="h-full w-full max-w-[240px]" />
        {hint && (
          <span className={`absolute top-4 ${hint === 'read' ? 'right-4 border-ok text-ok' : 'left-4 border-danger text-danger'} border-2 rounded-lg px-3 py-1 font-bold text-[18px] bg-surface`}
            style={{ opacity: Math.min(1, Math.abs(x) / 90) }}>{hint === 'read' ? 'קראתי' : 'לא קראתי'}</span>
        )}
      </div>
      <div className="px-4 py-3 text-center">
        <div className="font-display font-medium text-[21px] leading-snug">{b[0]}</div>
        <div className="text-muted text-[14px]">{b[1]}{b[2] && b[2] !== b[0] ? <> · <bdi>{b[2]}</bdi></> : null}</div>
        <div className="text-[12.5px] text-accent mt-0.5">{STARTER[gi].genre}</div>
      </div>
    </div>
  );
}
function Starter({ db, update, onClose, goQueue, onBegin }) {
  const [state, setState] = useState(loadStarterState);
  const { pos, picks, trail } = state;
  const [q, setQ] = useState('');
  const [rateKey, setRateKey] = useState('');
  const [last, setLast] = useState(null);   // מה סומן בסוויפ האחרון, כדי שיהיה ברור שזה נקלט
  const [phase, setPhase] = useState('pick');
  const [prog, setProg] = useState({ done: 0, total: 0, added: 0, queued: 0 });
  const save = (patch) => setState(s => {
    const n = { ...s, ...patch };
    try { localStorage.setItem('vrt-starter2-' + ACTIVE.id, JSON.stringify(n)); } catch (e) { /* */ }
    return n;
  });
  // ספרים שכבר בספרייה לא מוצגים שוב
  // ספר שכבר בספרייה (בשם העברי או בשם המקור, גם בכתיב אחר) לא מוצג בחפיסה ולא ניתן לסימון
  const owned = useMemo(() => {
    const k = (t) => skel(normTitle(t)).join(' ');
    const set = new Set();
    db.books.forEach(x => { [x.title, x.subtitle].forEach(t => { const v = t && k(t); if (v) set.add(v); }); });
    return (b) => [b[0], b[2]].some(t => t && set.has(k(t)));
  }, [db.books]);
  const visible = ([b]) => !owned(b);
  let idx = pos;
  while (idx < STARTER_DECK.length && !visible(STARTER_DECK[idx])) idx++;
  let idx2 = idx + 1;
  while (idx2 < STARTER_DECK.length && !visible(STARTER_DECK[idx2])) idx2++;
  const cur = STARTER_DECK[idx], next = STARTER_DECK[idx2];
  useEffect(() => { [idx2, idx2 + 1, idx2 + 2].forEach(i => STARTER_DECK[i] && starterCover(STARTER_DECK[i][0])); }, [idx2]);
  const count = Object.values(picks).filter(p => !owned(p.b)).length;
  const wantCount = Object.values(picks).filter(p => p.want && !owned(p.b)).length;
  const nq = norm(q);
  const found = nq ? STARTER_DECK.filter(([b]) => norm(b.join(' ')).includes(nq)) : [];

  // true = קראתי, false = לא קראתי, 'want' = רוצה לקרוא
  const swipe = (read) => {
    if (!cur) return;
    const [b, gi] = cur, k = STARTER_KEY(b);
    const n = { ...picks };
    if (read === 'want') n[k] = { rating: 0, gi, b, want: true };
    else if (read) n[k] = { rating: 4, gi, b, rated: false }; else delete n[k];
    const no = (state.no || []).filter(x => x !== k).concat(read ? [] : [k]);
    save({ pos: idx + 1, picks: n, no, trail: [...trail, idx].slice(-50) });
    setRateKey(read === true ? k : '');
    setLast({ title: b[0], read });
  };
  const undo = () => {
    if (!trail.length) return;
    const back = trail[trail.length - 1];
    const bk = STARTER_KEY(STARTER_DECK[back][0]);
    const n = { ...picks }; delete n[bk];
    save({ pos: back, picks: n, no: (state.no || []).filter(x => x !== bk), trail: trail.slice(0, -1) });
    setRateKey(''); setLast(null);
  };
  const rate = (k, r) => { if (picks[k]) save({ picks: { ...picks, [k]: { ...picks[k], rating: r, rated: true } } }); setRateKey(''); };
  const togglePick = (b, gi, r) => {
    const k = STARTER_KEY(b), n = { ...picks };
    if (n[k] && n[k].rating === r) delete n[k]; else n[k] = { rating: r, gi, b, rated: true };
    save({ picks: n });
  };
  const nextGenre = () => { if (cur) { save({ pos: cur[1] + 1 < STARTER.length ? GENRE_START[cur[1] + 1] : STARTER_DECK.length, trail: [...trail, idx].slice(-50) }); setRateKey(''); } };
  const inGenre = cur ? [idx - GENRE_START[cur[1]] + 1, STARTER[cur[1]].books.length] : [0, 0];
  useEffect(() => {
    if (phase !== 'pick' || nq) return undefined;
    const onKey = (e) => { if (e.target.closest && e.target.closest('input,textarea')) return; if (e.key === 'ArrowRight') swipe(true); else if (e.key === 'ArrowLeft') swipe(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // כל ספר שסומן נבדק מול המאגרים; מה שאומת נכנס לספרייה (בשם העברי), והשאר עובר לרשימת ההמתנה לאימות ידני
  const finish = async () => {
    const entries = Object.values(picks).filter(p => !owned(p.b));
    onBegin && onBegin();   // משאיר את המסך פתוח גם אחרי שהספרייה כבר לא ריקה
    setPhase('working');
    setProg({ done: 0, total: entries.length, added: 0, queued: 0 });
    const added = [], queued = [];
    const one = async ({ b, gi, rating, want }) => {
      const [title, author, original] = b;
      let best = null;
      for (const [t, a] of [[title, author], original ? [original, ''] : null].filter(Boolean)) {
        const res = await searchBooks(t, a).catch(() => null);
        const c = res && res.candidates[0];
        if (c && (c.match >= 0.6 || matchScore(c, `${title} ${author}`) >= 0.6 || (original && matchScore(c, original) >= 0.6))) { best = c; break; }
      }
      if (best) {
        best = withHebrewTitle(best, title);
        if (!best.cover) best.cover = coverCacheGet()[STARTER_KEY(b)] || '';
      }
      if (best && !findInLibrary(best, db.books) && !findInLibrary(best, added)) {
        const now = Date.now();
        added.push(sanitizeBook({ ...best, id: uid(), status: want ? 'want' : 'read', rating: want ? 0 : rating, tags: [STARTER[gi].tag], addedAt: now, editedAt: now, verifiedAt: now }));
      } else if (!best) queued.push({ id: uid(), raw: title, title, author: author || '', rating: want ? 0 : rating, want: !!want, note: '', status: 'pending', savedTitle: '' });
      setProg(p => ({ ...p, done: p.done + 1, added: added.length, queued: queued.length }));
    };
    for (let i = 0; i < entries.length; i += 3) await Promise.all(entries.slice(i, i + 3).map(one));
    update(d => ({ ...d, books: [...added, ...d.books], tagLibrary: uniq([...d.tagLibrary, ...added.flatMap(x => x.tags)]), settings: { ...d.settings, onboarded: true } }));
    if (queued.length) {
      const cur0 = loadQueue();
      saveQueue(cur0 ? { ...cur0, items: [...cur0.items, ...queued] } : { items: queued, current: queued[0].id, createdAt: Date.now() });
    }
    save({ picks: {} });
    setPhase('done');
  };
  const skip = () => { update(d => ({ ...d, settings: { ...d.settings, onboarded: true } })); onClose(); };

  if (phase !== 'pick') {
    return (
      <div className="fade-in pt-6 grid gap-4">
        <h1 className="font-display font-medium text-[26px] leading-snug">{phase === 'working' ? 'מאמת את הספרים שסימנת' : 'הספרייה מוכנה'}</h1>
        <div className="h-2 rounded-full bg-surface2 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-accent transition-all" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} />
        </div>
        <p className="text-muted tabular">{prog.done} מתוך {prog.total} · נוספו {prog.added}{prog.queued ? ` · ${prog.queued} ממתינים לאימות ידני` : ''}</p>
        {phase === 'done' && (
          <div className="grid gap-2">
            <p className="font-reading">כל ספר נבדק מול Google Books ומאגרים נוספים לפני שנכנס לספרייה.{prog.queued ? ' ספרים שלא אומתו אוטומטית מחכים ברשימה בלשונית "הוספת ספר", שם אפשר לבחור מהדורה או להפעיל זיהוי חכם.' : ''}</p>
            <Btn onClick={onClose}><Icon name="Library" size={18} />לספרייה שלי</Btn>
            {prog.queued > 0 && <Btn variant="ghost" onClick={goQueue}>לספרים שממתינים ({prog.queued})</Btn>}
          </div>
        )}
      </div>
    );
  }
  const rated = rateKey && picks[rateKey];
  return (
    <div className="fade-in pb-6">
      <header className="pt-4 pb-2">
        <h1 className="font-display font-medium text-[26px] leading-snug">אילו ספרים כבר קראת?</h1>
        <p className="text-muted text-[15px]">ימינה: קראתי. שמאלה: לא קראתי. הדירוג אחרי "קראתי" לא חובה.</p>
        <button type="button" onClick={skip} className="text-[13px] text-muted underline underline-offset-2 min-h-[32px]">{count ? 'אמשיך אחר כך' : 'דילוג על ההיכרות'}</button>
      </header>
      <div className="relative mb-3">
        <span className="absolute top-1/2 -translate-y-1/2 right-3 text-muted"><Icon name="Search" size={18} /></span>
        <label htmlFor="starter-q" className="sr-only">חיפוש ברשימה</label>
        <input id="starter-q" value={q} onChange={e => setQ(e.target.value)} placeholder="מחפשים ספר מסוים? שם או סופר"
          className="w-full min-h-[46px] pr-10 pl-3 rounded-xl border border-line bg-surface text-[16px]" />
      </div>
      {nq ? (
        <ul className="grid gap-1.5">
          {!found.length && <li className="text-muted text-center py-6">אין ברשימה ספר כזה. אפשר להוסיף אותו בלשונית "הוספת ספר".</li>}
          {found.map(([b, gi]) => {
            const pick = picks[STARTER_KEY(b)];
            const have = owned(b);
            return (
              <li key={STARTER_KEY(b)} className={`bg-surface border rounded-xl px-3 py-2.5 flex items-center gap-2 ${pick ? 'border-accent' : 'border-line'} ${have ? 'opacity-60' : ''}`}>
                <StarterCover b={b} className="w-10 h-14 rounded shrink-0 text-[0px]" />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-medium text-[17px] leading-snug">{b[0]}</div>
                  <div className="text-muted text-[13px] truncate">{b[1]} · {STARTER[gi].genre}</div>
                </div>
                {have ? <span className="shrink-0 text-[13px] text-muted">כבר בספרייה</span> : <div className="flex gap-1 shrink-0" role="group" aria-label={`דירוג ${b[0]}`}>
                  {STARTER_RATINGS.map(([r, l]) => (
                    <button key={r} type="button" aria-pressed={!!(pick && pick.rating === r)} onClick={() => togglePick(b, gi, r)}
                      className={`min-h-[36px] px-2.5 rounded-lg border text-[13px] ${pick && pick.rating === r ? 'bg-accentSoft text-accent border-accent font-semibold' : 'border-line text-muted'}`}>{l}</button>
                  ))}
                </div>}
              </li>
            );
          })}
        </ul>
      ) : cur ? (
        <div className="grid gap-3">
          <div className="relative mx-auto w-full max-w-[340px] h-[min(40vh,340px)]">
            {next && <SwipeCard key={'n' + idx2} b={next[0]} gi={next[1]} top={false} onSwipe={() => {}} />}
            <SwipeCard key={'c' + idx} b={cur[0]} gi={cur[1]} top onSwipe={swipe} />
          </div>
          <div className="flex justify-center gap-3">
            <button type="button" onClick={() => swipe(true)} className="min-h-[52px] px-5 whitespace-nowrap rounded-full border-2 border-ok text-ok font-semibold bg-surface flex items-center gap-1.5">
              <Icon name="Check" size={20} />קראתי
            </button>
            <button type="button" onClick={() => swipe('want')} aria-label="רוצה לקרוא" className="min-h-[52px] w-[52px] rounded-full border-2 border-brass text-brass bg-surface grid place-items-center">
              <Icon name="Bookmark" size={20} />
            </button>
            <button type="button" onClick={() => swipe(false)} className="min-h-[52px] px-5 whitespace-nowrap rounded-full border-2 border-line text-muted font-semibold bg-surface flex items-center gap-1.5">
              <Icon name="X" size={20} />לא קראתי
            </button>
          </div>
          <div className="flex justify-center items-center gap-3 -mt-1">
            <button type="button" onClick={undo} disabled={!trail.length} className="text-[13px] text-muted inline-flex items-center gap-1 min-h-[36px] disabled:opacity-40"><Icon name="Undo2" size={15} />חזרה לספר הקודם</button>
            <span className="text-[12px] text-muted">הסימנייה = רוצה לקרוא</span>
          </div>
          {last && (
            <div className={`fade-in text-center text-[14px] rounded-lg py-1.5 ${last.read ? 'bg-accentSoft text-accent font-semibold' : 'bg-surface2 text-muted'}`} role="status">
              {last.read === 'want' ? `🔖 רוצה לקרוא: ${last.title}` : last.read ? `✓ קראתי: ${last.title}` : `לא קראתי: ${last.title}`}
            </div>
          )}
          {rated ? (
            <div className="fade-in bg-surface border border-line rounded-xl p-2.5 grid gap-2" role="group" aria-label={`דירוג ${rated.b[0]}`}>
              <div className="text-[14px] text-center">איך היה <span className="font-semibold">{rated.b[0]}</span>? <span className="text-muted">(לא חובה)</span></div>
              <div className="flex gap-1.5 justify-center">
                {STARTER_RATINGS.map(([r, l]) => (
                  <button key={r} type="button" onClick={() => rate(rateKey, r)}
                    className={`min-h-[40px] px-3.5 rounded-lg border text-[14px] ${rated.rated && rated.rating === r ? 'bg-accentSoft text-accent border-accent font-semibold' : 'border-line'}`}>{l}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center text-[13px] text-muted px-1">
              <span className="tabular">{STARTER[cur[1]].genre} · {inGenre[0]} מתוך {inGenre[1]}</span>
              <span className="tabular">קראתי {count - wantCount} · רוצה {wantCount} · לא {(state.no || []).length}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-muted py-10">עברתם על כל הרשימה. {count ? 'אפשר להוסיף את מה שסימנתם.' : ''}</p>
      )}
      <p className="text-center text-[12.5px] text-muted mt-5 px-2 font-reading">הסווייפ לבחירת הספרים בכניסה הראשונה מתוך רשימה הוא רעיון של יעל שטסמן סעדון האגדית</p>
      <div className="mt-3">
        <div className="flex gap-2">
          <Btn className="flex-1" disabled={!count} onClick={finish}><Icon name="Check" size={18} />{count ? `הוספת ${count} ספרים` : 'עוד לא סומנו ספרים'}</Btn>
          {cur && !nq ? <Btn variant="ghost" onClick={nextGenre}>ז'אנר הבא<Icon name="ChevronLeft" size={18} /></Btn> : <Btn variant="ghost" onClick={skip}>{count ? 'אחר כך' : 'יציאה'}</Btn>}
        </div>
      </div>
    </div>
  );
}

function AiDetailsButton({ book, onUpdate }) {
  const [st, setSt] = useState({ busy: false, msg: '', err: '' });
  if (!aiAvailable()) return null;
  const run = async () => {
    setSt({ busy: true, msg: 'מחפש במקורות…', err: '' });
    try {
      const r = await aiBookDetails(book, (m) => setSt(x => ({ ...x, msg: m })));
      const patch = { aiFormats: r.formats, genres: r.genres, sources: r.sources };
      if (!book.description && r.synopsis_he) { patch.description = r.synopsis_he; patch.descSource = 'מקורות ברשת'; }
      onUpdate(patch);
      setSt({ busy: false, msg: `עודכן. עלות משוערת: $${r.cost.toFixed(2)}`, err: '' });
    } catch (e) { setSt({ busy: false, msg: '', err: e.message }); }
  };
  return (
    <div className="grid gap-1.5 mb-3">
      <Btn variant="soft" disabled={st.busy} onClick={run}>{st.busy ? <Spinner /> : <Icon name="Sparkles" size={18} />}השלמת תקציר וזמינות מהמקורות (AI)</Btn>
      {st.msg && <p className="text-[13px] text-muted">{st.msg}</p>}
      {st.err && <Notice tone="error">{st.err}</Notice>}
    </div>
  );
}

function LibraryTab({ db, onEdit, onDelete, onUpdateBook, goAdd, notify }) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('recent');
  const [open, setOpen] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [shelf, setShelf] = useState(() => { try { return sessionStorage.getItem('vrt_shelf') || 'read'; } catch (e) { return 'read'; } });
  // תצוגה: רשימה או קוביות (נשמר במכשיר)
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('vrt_layout') || 'list'; } catch (e) { return 'list'; } });
  useEffect(() => { try { localStorage.setItem('vrt_layout', layout); } catch (e) { /* */ } }, [layout]);
  useEffect(() => { try { sessionStorage.setItem('vrt_shelf', shelf); } catch (e) { /* */ } }, [shelf]);
  const readBooks = db.books.filter(b => b.status !== 'want'), wantBooks = db.books.filter(b => b.status === 'want');
  const books = shelf === 'want' ? wantBooks : readBooks;
  const allTags = useMemo(() => {
    const m = new Map();
    books.forEach(b => b.tags.forEach(t => m.set(t, (m.get(t) || 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [books]);
  const list = useMemo(() => {
    const nq = norm(q);
    let l = books.filter(b => (!tag || b.tags.includes(tag)) && (!nq || norm(b.title + ' ' + b.authors.join(' ') + ' ' + b.tags.join(' ')).includes(nq)));
    const s = { recent: (a, b) => b.addedAt - a.addedAt, rating: (a, b) => b.rating - a.rating || b.addedAt - a.addedAt, title: (a, b) => a.title.localeCompare(b.title, 'he') }[sort];
    return l.slice().sort(s);
  }, [books, q, tag, sort]);
  const avg = readBooks.length ? (readBooks.reduce((s, b) => s + b.rating, 0) / readBooks.length).toFixed(1) : '–';
  const loved = readBooks.filter(b => b.rating >= 4).length;
  const current = open ? db.books.find(b => b.id === open) : null;

  if (!db.books.length) {
    return (
      <div className="fade-in pt-6">
        <h1 className="font-display font-medium text-[26px] leading-snug mb-2">הספרייה שלך מחכה לספר הראשון</h1>
        <p className="text-muted text-[16px] mb-5 max-w-prose">כל ספר נכנס לכאן רק אחרי שאומת מול Google Books או Open Library: כריכה, מחבר ותקציר אמיתיים. אחרי כמה ספרים מדורגים, מנוע ההמלצות יתחיל לעבוד בשבילך.</p>
        <ol className="grid gap-3 mb-6 text-[15px]">
          {['מקלידים שם ספר בעברית או באנגלית, ISBN או קישור', 'בוחרים את הספר הנכון ולוחצים "זה הספר שלי"', 'מדרגים 1–5 כוכבים ומוסיפים תגיות', 'בלשונית "גלה ספר חדש" עונים על 4 שאלות ומקבלים המלצות מאומתות'].map((t, i) => (
            <li key={i} className="flex gap-3 items-start bg-surface border border-line rounded-xl p-3">
              <span className="tabular w-7 h-7 shrink-0 rounded-full bg-accentSoft text-accent grid place-items-center font-semibold text-[14px]">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
        <Btn className="w-full" onClick={goAdd}><Icon name="BookPlus" size={20} />הוספת הספר הראשון</Btn>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <header className="pt-4 pb-3">
        <h1 className="font-display font-medium text-[26px] leading-snug">הספרים שלי</h1>
        <p className="text-muted text-[15px] tabular">{readBooks.length} ספרים · ממוצע {avg}★ · {loved} אהובים (4★+)</p>
      </header>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface2 mb-3" role="tablist" aria-label="מדף">
        {[['read', `קראתי (${readBooks.length})`, 'BookCheck'], ['want', `רוצה לקרוא (${wantBooks.length})`, 'Bookmark']].map(([k, l, ic]) => (
          <button key={k} type="button" role="tab" aria-selected={shelf === k} onClick={() => { setShelf(k); setTag(''); }}
            className={`min-h-[44px] rounded-xl font-semibold text-[15px] inline-flex items-center justify-center gap-1.5 ${shelf === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}><Icon name={ic} size={17} />{l}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute top-1/2 -translate-y-1/2 right-3 text-muted"><Icon name="Search" size={18} /></span>
          <label htmlFor="lib-search" className="sr-only">חיפוש בספרייה</label>
          <input id="lib-search" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, מחבר או תגית"
            className="w-full min-h-[48px] pr-10 pl-3 rounded-xl border border-line bg-surface text-[16px]" />
        </div>
        <div className="flex rounded-xl border border-line bg-surface overflow-hidden shrink-0" role="group" aria-label="תצוגה">
          {[['list', 'List', 'תצוגת רשימה'], ['grid', 'LayoutGrid', 'תצוגת קוביות']].map(([k, ic, l]) => (
            <button key={k} type="button" aria-label={l} aria-pressed={layout === k} onClick={() => setLayout(k)}
              className={`w-11 min-h-[48px] grid place-items-center ${layout === k ? 'bg-accentSoft text-accent' : 'text-muted'}`}><Icon name={ic} size={19} /></button>
          ))}
        </div>
        <label htmlFor="lib-sort" className="sr-only">מיון</label>
        <select id="lib-sort" value={sort} onChange={e => setSort(e.target.value)} className="min-h-[48px] px-2 rounded-xl border border-line bg-surface text-[15px]">
          <option value="recent">חדשים</option>
          <option value="rating">דירוג</option>
          <option value="title">א–ת</option>
        </select>
      </div>
      {allTags.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-4 px-4" role="group" aria-label="סינון לפי תגית">
          <Chip active={!tag} onClick={() => setTag('')} className="shrink-0">הכל</Chip>
          {allTags.map(([t, n]) => <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? '' : t)} className="shrink-0">{t} <span className="tabular opacity-70">{n}</span></Chip>)}
        </div>
      )}
      {layout === 'grid' ? (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4" aria-label="הספרים בקוביות">
          {list.map(b => (
            <li key={b.id}>
              <button type="button" onClick={() => { setOpen(b.id); setConfirmDel(false); }} className="w-full text-right grid gap-1.5 active:scale-[.98] transition-transform">
                <span className="relative block">
                  <Cover book={b} className="w-full aspect-[2/3] h-auto rounded-lg" />
                  {b.status === 'want'
                    ? <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full glass grid place-items-center text-brass"><Icon name="Bookmark" size={14} /></span>
                    : <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-full glass text-[11px] font-bold tabular inline-flex items-center gap-0.5"><Icon name="Star" size={11} className="text-brass" />{b.rating}</span>}
                </span>
                <span className="font-display font-medium text-[14px] leading-snug clamp-2">{b.title}</span>
                <span className="text-muted text-[12px] truncate -mt-1">{(b.authors || [])[0] || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
      <ul className="grid gap-2.5">
        {list.map(b => (
          <li key={b.id}>
            <button type="button" onClick={() => { setOpen(b.id); setConfirmDel(false); }}
              className="w-full text-right flex gap-3 p-3 bg-surface border border-line rounded-xl active:bg-surface2 transition-colors">
              <Cover book={b} className="w-14 h-20" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-medium text-[17px] leading-snug clamp-2">{b.title}</div>
                <div className="text-muted text-[14px] truncate">{[b.authors.join(', '), b.publisher, b.year].filter(Boolean).join(' · ')}</div>
                {b.status === 'want' ? <div className="mt-1 text-[13px] text-accent font-semibold inline-flex items-center gap-1"><Icon name="Bookmark" size={13} />רוצה לקרוא</div> : <div className="mt-1"><Stars value={b.rating} size={15} /></div>}
                {b.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{b.tags.slice(0, 4).map(t => <span key={t} className="text-[12px] px-2 py-0.5 rounded-full bg-surface2 text-muted font-semibold">{t}</span>)}{b.tags.length > 4 && <span className="text-[12px] text-muted">+{b.tags.length - 4}</span>}</div>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      )}
      {!list.length && <p className="text-center text-muted py-8">{shelf === 'want' && !wantBooks.length ? 'עוד אין ספרים ברשימה. אפשר להוסיף מהחיפוש, מההמלצות או מהסוויפ.' : 'אין ספרים שתואמים לחיפוש.'}</p>}

      {current && (
        <Sheet open onClose={() => setOpen(null)} title="פרטי הספר">
          <div className="flex gap-3 items-start mb-3">
            <Cover book={current} className="w-24 h-36" />
            <div className="min-w-0 flex-1">
              <div className="font-display font-medium text-[20px] leading-tight">{current.title}</div>
              {current.subtitle && <div className="text-[14px] text-muted">{current.subtitle}</div>}
              <div className="text-[15px] mt-1">{current.authors.join(', ')}</div>
              <div className="text-muted text-[13px] tabular mt-0.5">{metaLine(current)}</div>
              <div className="mt-2">{current.status === 'want' ? <span className="text-accent font-semibold inline-flex items-center gap-1"><Icon name="Bookmark" size={15} />ברשימת "רוצה לקרוא"</span> : <Stars value={current.rating} size={18} />}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3"><SourceBadge book={current} />{current.tags.map(t => <span key={t} className="text-[13px] px-2 py-0.5 rounded-full bg-surface2 font-semibold">{t}</span>)}</div>
          <Synopsis key={current.id} book={current} className="mb-3" fetchSource onChange={(patch) => onUpdateBook(current.id, patch)} />
          {current.note && (
            <div className="mb-3 rounded-xl bg-surface2 p-2.5">
              <div className="text-[12px] font-semibold text-muted mb-0.5">מה חשבת</div>
              <p className="font-reading whitespace-pre-line">{current.note}</p>
            </div>
          )}
          {current.genres && current.genres.length > 0 && <div className="flex flex-wrap gap-1 mb-3">{current.genres.map(g => <span key={g} className="text-[12px] px-2 py-0.5 rounded-full border border-line">{g}</span>)}</div>}
          <AiDetailsButton book={current} onUpdate={(patch) => onUpdateBook(current.id, patch)} />
          <p className="text-muted text-[13px] mb-3">נוסף ב-{fmtDate(current.addedAt)}{current.isbns[0] ? ` · ISBN ${current.isbns[0]}` : ''}</p>
          <div className="mb-3"><FormatInfo book={current} /></div>
          <RecommendToFriend book={current} notify={notify} />
          {current.link && <a href={current.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent font-semibold mb-4 min-h-[44px]"><Icon name="ExternalLink" size={16} />לרשומה במקור</a>}
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="soft" onClick={() => { onEdit(current); setOpen(null); }}><Icon name={current.status === 'want' ? 'BookCheck' : 'Pencil'} size={18} />{current.status === 'want' ? 'קראתי אותו' : 'עריכה'}</Btn>
            {!confirmDel
              ? <Btn variant="danger" onClick={() => setConfirmDel(true)}><Icon name="Trash2" size={18} />מחיקה</Btn>
              : <Btn variant="danger" className="!bg-danger !text-accentInk" onClick={() => { onDelete(current.id); setOpen(null); }}>לחצו שוב למחיקה</Btn>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/* ============================================================
   לשונית: הוספת ספר
   ============================================================ */
function metaLine(c) {
  return [c.publisher, c.year, c.pageCount ? c.pageCount + ' עמ\'' : '', langLabel(c.language)].filter(Boolean).join(' · ');
}

function EditionRow({ ed, main, onPick, disabled }) {
  return (
    <li className="flex gap-2.5 items-center py-2 border-b border-line last:border-0">
      <Cover book={ed} className="w-10 h-14" />
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        {normTitle(ed.title) !== normTitle(main.title) && <div className="font-semibold text-[14px] truncate">{ed.title}</div>}
        {ed.authors.length > 0 && ed.authors.join(',') !== main.authors.join(',') && <div className="text-muted truncate">{ed.authors.join(', ')}</div>}
        <div className="tabular">{metaLine(ed) || 'פרטי הדפסה לא צוינו'}</div>
        {ed.isbns && ed.isbns[0] && <div className="text-muted tabular" dir="ltr" style={{ textAlign: 'right' }}>ISBN {ed.isbns[0]}</div>}
      </div>
      <button type="button" disabled={disabled} onClick={() => onPick(withWorkInfo(ed, main))}
        className="shrink-0 min-h-[44px] px-3 rounded-xl border border-accent text-accent font-semibold text-[14px] disabled:opacity-40">בחירה</button>
    </li>
  );
}

// תקציר: מקופל ל-4 שורות עם הרחבה תמיד כשיש עוד טקסט; שליפת הטקסט המלא מ-Google; תרגום לעברית
async function fetchFullDescription(book) {
  if (book.source !== 'google' || !book.sourceId || !googleAvailable()) return '';
  try { const full = await googleById(book.sourceId); return full && full.description && full.description.length > (book.description || '').length ? full.description : ''; }
  catch (e) { return ''; }
}
function Synopsis({ book, onChange, className = '', fetchSource = false }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [full, setFull] = useState('');
  const [he, setHe] = useState(book.descriptionHe || '');
  const [showOrig, setShowOrig] = useState(false);
  const [tr, setTr] = useState({ busy: false, err: '' });
  const ref = useRef(null);
  const orig = full || book.description || '';
  const text = he && !showOrig ? he : orig;
  // ספר עם שם עברי ותקציר בשפה אחרת (או בלי תקציר): מנסים להביא את התקציר העברי מדף הספר בחנות/בהוצאה, לפני תרגום
  const [srcBusy, setSrcBusy] = useState(false);
  useEffect(() => {
    if (!fetchSource || !hasHebrew(book.title) || hasHebrew(book.description || '') || !loadCloud()) return;
    const k = 'vrt-src-tried:' + book.key;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) { /* */ }
    let alive = true;
    setSrcBusy(true);
    fetchBookInfo(book).then(info => {
      if (alive && info && info.synopsis && hasHebrew(info.synopsis) && onChange) onChange({ description: info.synopsis, descSource: STORE_NAMES[info.synopsisSource] || info.synopsisSource, descriptionHe: '' });
    }).catch(() => {}).finally(() => alive && setSrcBusy(false));
    return () => { alive = false; };
  }, [book.key]);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflow(el.scrollHeight > el.clientHeight + 2);
  }, [text, expanded]);
  if (!orig && !he) return <p className={`text-muted text-[14px] ${className}`}>{srcBusy ? 'מחפש תקציר בחנויות…' : 'למקור אין תקציר רשמי לספר הזה.'}</p>;
  const looksCut = /(\.\.\.|…)\s*$/.test(orig);
  const expand = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!full) {
      const f = await fetchFullDescription(book);
      if (f) { setFull(f); onChange && onChange({ description: f }); }
    }
  };
  const translate = async () => {
    setTr({ busy: true, err: '' });
    try {
      const r = await aiTranslate(orig);
      setHe(r.text); setShowOrig(false); setTr({ busy: false, err: '' });
      onChange && onChange({ descriptionHe: r.text });
    } catch (e) { setTr({ busy: false, err: e.message }); }
  };
  return (
    <div className={className}>
      {book.descSource && !he && <div className="text-[12px] font-semibold text-muted mb-0.5">תקציר מ{book.descSource}</div>}
      {he && !showOrig && <div className="text-[12px] font-semibold text-muted mb-0.5">תקציר בעברית</div>}
      <p ref={ref} dir="auto" className={`font-reading whitespace-pre-line ${expanded ? '' : 'clamp-4'}`}>{text}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-0">
        {(overflow || expanded || looksCut || book.source === 'google') && (
          <button type="button" className="text-accent font-semibold text-[14px] min-h-[40px]" onClick={expand}>{expanded ? 'פחות' : 'לתקציר המלא'}</button>
        )}
        {!hasHebrew(orig) && !he && aiAvailable() && (
          <button type="button" className="text-accent font-semibold text-[14px] min-h-[40px] inline-flex items-center gap-1" disabled={tr.busy} onClick={translate}>
            {tr.busy ? <Spinner size={14} /> : <Icon name="Languages" size={15} />}תרגום לעברית
          </button>
        )}
        {he && <button type="button" className="text-muted font-semibold text-[14px] min-h-[40px]" onClick={() => setShowOrig(!showOrig)}>{showOrig ? 'הצגת העברית' : 'הצגת המקור'}</button>}
      </div>
      {tr.err && <p className="text-[13px] text-danger">{tr.err}</p>}
    </div>
  );
}

function CandidateGroup({ group, inLib, onPick }) {
  const c = group.main;
  const [extra, setExtra] = useState({});
  const [picking, setPicking] = useState(false);
  const [showEd, setShowEd] = useState(false);
  const [olEd, setOlEd] = useState({ loading: false, list: null, error: '' });
  const googleEds = group.editions.filter(e => e !== c);
  const canLoadOL = c.source === 'openlibrary' && c.sourceId && c.sourceId.startsWith('/works/');
  const editions = googleEds.concat(olEd.list || []);

  const toggleEditions = async () => {
    const next = !showEd;
    setShowEd(next);
    if (next && canLoadOL && !olEd.list && !olEd.loading) {
      setOlEd({ loading: true, list: null, error: '' });
      try { setOlEd({ loading: false, list: await olEditions(c.sourceId, c), error: '' }); }
      catch (e) { setOlEd({ loading: false, list: [], error: 'טעינת המהדורות נכשלה. נסו שוב.' }); }
    }
  };

  return (
    <li className="fade-in bg-surface border border-line rounded-xl p-3">
      <div className="flex gap-3">
        <Cover book={c} className="w-20 h-28" />
        <div className="min-w-0 flex-1">
          <div className="font-display font-medium text-[18px] leading-snug">{c.title}</div>
          {c.subtitle && <div className="text-muted text-[13px] clamp-2">{c.subtitle}</div>}
          <div className="text-[15px] mt-0.5">{c.authors.length ? c.authors.join(', ') : <span className="text-warn">מחבר לא צוין במקור</span>}</div>
          <div className="text-muted text-[13px] tabular">{metaLine(c)}</div>
          {c.isbns && c.isbns[0] && <div className="text-muted text-[12px] tabular">ISBN <span dir="ltr">{c.isbns[0]}</span></div>}
          <div className="mt-1.5"><SourceBadge book={c} /></div>
        </div>
      </div>
      <Synopsis book={c} className="mt-2.5" onChange={(patch) => setExtra(x => ({ ...x, ...patch }))} />
      <div className="flex gap-2 mt-2 items-center">
        {inLib
          ? <div className="flex-1 min-h-[48px] rounded-xl bg-surface2 text-muted font-semibold grid place-items-center text-[15px]">כבר בספרייה ({inLib.rating}★)</div>
          : <Btn className="flex-1" disabled={picking} onClick={async () => {
              // שומרים את התקציר המלא: אם עוד לא נשלף, שולפים לפני השמירה
              setPicking(true);
              const more = extra.description ? {} : { description: (await fetchFullDescription(c)) || c.description };
              setPicking(false);
              onPick({ ...c, ...more, ...extra });
            }}>{picking ? <Spinner /> : <Icon name="Check" size={20} />}זה הספר שלי</Btn>}
        {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" aria-label="פתיחת הרשומה במקור" className="min-h-[48px] w-12 grid place-items-center rounded-xl border border-line text-muted"><Icon name="ExternalLink" size={18} /></a>}
      </div>
      {(googleEds.length > 0 || canLoadOL) && (
        <div className="mt-2 border-t border-line pt-1">
          <button type="button" onClick={toggleEditions} aria-expanded={showEd}
            className="w-full min-h-[44px] flex items-center justify-between text-accent font-semibold text-[15px]">
            <span>{googleEds.length ? `מהדורות והדפסות נוספות (${googleEds.length})` : 'מהדורות והדפסות אחרות'}</span>
            <span style={{ transform: showEd ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><Icon name="ChevronDown" size={20} /></span>
          </button>
          {showEd && (
            <div className="fade-in">
              <p className="text-[13px] text-muted mb-1">בחרו את ההוצאה שקראתם: כריכה, הוצאה, שנה ומספר עמודים.</p>
              {olEd.loading && <div className="text-muted text-[14px] py-2 inline-flex items-center gap-2"><Spinner size={16} />טוען מהדורות מ-Open Library…</div>}
              {olEd.error && <Notice tone="error">{olEd.error}</Notice>}
              {!olEd.loading && !editions.length && <p className="text-muted text-[14px] py-2">לא נמצאו מהדורות נוספות במקור.</p>}
              <ul>{editions.map((ed, i) => <EditionRow key={(ed.editionKey || ed.key) + i} ed={ed} main={c} onPick={onPick} disabled={!!inLib} />)}</ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// זיהוי חכם: כשהחיפוש הרגיל לא מוצא, Claude מזהה את הספר (עם חיפוש באתרים המאושרים) והתוצאה נבדקת שוב מול המאגרים
function useSmartSearch(onResult) {
  const [st, setSt] = useState({ busy: false, msg: '', err: '' });
  const run = async (text, author) => {
    setSt({ busy: true, msg: 'Claude מנסה לזהות את הספר…', err: '' });
    try {
      const res = await aiResolveBook(text, author, (m) => setSt(x => ({ ...x, msg: m })));
      onResult(res);
      setSt({ busy: false, msg: `עלות משוערת: $${res.cost.toFixed(2)}`, err: '' });
    } catch (e) { setSt({ busy: false, msg: '', err: e.message }); }
  };
  return [st, run];
}
function SmartBox({ st, onRun, prominent }) {
  if (!aiAvailable()) return null;
  return (
    <div className={`grid gap-1.5 ${prominent ? 'bg-surface border border-accent rounded-xl p-3' : ''}`}>
      {prominent && <p className="text-[14px]">החיפוש הרגיל לא מצא התאמה טובה. Claude יכול לזהות את הספר גם משם חלקי, איות אחר או שם בתרגום, ולאמת אותו מול המאגרים.</p>}
      <Btn variant={prominent ? 'primary' : 'ghost'} disabled={st.busy} onClick={onRun}>{st.busy ? <Spinner /> : <Icon name="Sparkles" size={18} />}{prominent ? 'זיהוי חכם עם AI' : 'לא הספר הנכון? זיהוי חכם עם AI'}</Btn>
      {st.msg && <p className="text-[13px] text-muted">{st.msg}</p>}
      {st.err && <Notice tone="error">{st.err}</Notice>}
    </div>
  );
}

function SearchResults({ res, db, onPick, goSettings, smart, onSmart }) {
  const groups = useMemo(() => groupEditions(res.candidates), [res]);
  const edCount = res.candidates.length;
  const top = groups[0] && groups[0].main.match;
  const weak = groups.length > 0 && top !== undefined && top < 0.35 && !res.fromAi;
  const partial = groups.length > 0 && top !== undefined && top >= 0.35 && top < 0.5 && !res.fromAi;
  const list = (
    <ul className="grid gap-3">
      {groups.map(g => <CandidateGroup key={g.key + g.main.key} group={g} inLib={findInLibrary(g.main, db.books)} onPick={onPick} />)}
    </ul>
  );
  return (
    <div className="grid gap-3">
      {res.notes.map((n, i) => <Notice key={i} tone="warn">{n}</Notice>)}
      {!googleAvailable() && !db.settings.apiKey && (
        <Notice tone="info">
          Google Books חוסם חיפושים בלי מפתח (המכסה המשותפת לכל המשתמשים נגמרת כל יום). מפתח אישי הוא בחינם ומחזיר את הכיסוי המלא לספרים בעברית.
          <button type="button" onClick={goSettings} className="block mt-1 text-accent font-semibold min-h-[40px]">להוספת מפתח חינמי ←</button>
        </Notice>
      )}
      {res.fromAi && <Notice tone="ok">זוהה בעזרת Claude ואומת מול המאגרים{res.tried && res.tried.length ? `: ${res.tried.slice(0, 3).join(' · ')}` : ''}.</Notice>}
      {!res.fromAi && res.tried && res.tried.length > 0 && groups.length > 0 && !weak && (
        <p className="text-[13px] text-muted">חיפשנו גם בדרכים נוספות: {res.tried.slice(0, 3).join(' · ')}</p>
      )}
      {(groups.length === 0 || weak) && (
        <Notice tone="error">לא נמצא ספר שתואם לחיפוש. נסו את השם המלא או איות אחר, את השם בשפת המקור, או ISBN מהכריכה האחורית.</Notice>
      )}
      {(groups.length === 0 || weak || partial) && onSmart && <SmartBox st={smart} onRun={onSmart} prominent />}
      {partial && <Notice tone="warn">לא נמצאה התאמה מלאה. בדקו שהספר נכון, או דייקו את השם והמחבר.</Notice>}
      {weak ? (
        <details className="bg-surface border border-line rounded-xl p-3">
          <summary className="font-semibold text-[14px] text-muted cursor-pointer min-h-[32px]">תוצאות רחוקות ({groups.length})</summary>
          <div className="mt-2">{list}</div>
        </details>
      ) : groups.length > 0 && (
        <>
          <p className="text-[14px] text-muted">{groups.length} ספרים{edCount > groups.length ? ` (${edCount} מהדורות)` : ''} מ-{res.sources.join(' + ')}. בחרו את הספר, או פתחו את רשימת המהדורות כדי לבחור את ההדפסה המדויקת:</p>
          {list}
          {!partial && onSmart && <SmartBox st={smart} onRun={onSmart} />}
        </>
      )}
    </div>
  );
}

function SingleSearch({ db, onPick, goSettings }) {
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [showAuthor, setShowAuthor] = useState(false);
  const [state, setState] = useState({ loading: false, res: null, error: '' });
  const reqId = useRef(0);
  const mode = tryURL(text) ? 'link' : isPureISBN(text) ? 'isbn' : 'text';
  const [smart, runSmart] = useSmartSearch((res) => setState({ loading: false, res: { ...res, fromAi: true }, error: '' }));

  const run = async (e) => {
    e && e.preventDefault();
    if (!text.trim()) return;
    const id = ++reqId.current;
    setState({ loading: true, res: null, error: '' });
    try {
      const res = await searchBooks(text, mode === 'text' ? author.trim() : '');
      if (id === reqId.current) setState({ loading: false, res, error: '' });
    } catch (err) {
      if (id === reqId.current) setState({ loading: false, res: null, error: 'החיפוש נכשל. בדקו חיבור לאינטרנט ונסו שוב.' });
    }
  };

  return (
    <>
      <form onSubmit={run} className="grid gap-2 mb-4">
        <label htmlFor="book-q" className="sr-only">שם הספר, ISBN או קישור</label>
        <div className="relative">
          <span className="absolute top-1/2 -translate-y-1/2 right-3 text-muted"><Icon name={mode === 'link' ? 'Link' : mode === 'isbn' ? 'ScanBarcode' : 'Search'} size={20} /></span>
          <input id="book-q" value={text} onChange={e => setText(e.target.value)} autoComplete="off" enterKeyHint="search"
            placeholder="למשל: סיפור על אהבה וחושך / Project Hail Mary"
            className="w-full min-h-[54px] pr-11 pl-3 rounded-xl border border-line bg-surface text-[17px]" />
        </div>
        {mode !== 'text' && <p className="text-[13px] text-accent font-semibold">{mode === 'link' ? 'זוהה קישור: נאמת אותו ישירות מול המקור' : 'זוהה ISBN: נחפש מהדורה מדויקת'}</p>}
        {mode === 'text' && (showAuthor
          ? <><label htmlFor="book-author" className="sr-only">שם המחבר</label>
              <input id="book-author" value={author} onChange={e => setAuthor(e.target.value)} placeholder="שם המחבר (לדיוק החיפוש)"
                className="w-full min-h-[48px] px-3 rounded-xl border border-line bg-surface text-[16px]" /></>
          : <button type="button" className="text-accent font-semibold text-[14px] text-right min-h-[36px]" onClick={() => setShowAuthor(true)}>+ צמצום לפי מחבר</button>)}
        <Btn type="submit" disabled={!text.trim() || state.loading}>{state.loading ? <><Spinner />מחפש ומאמת…</> : <><Icon name="Search" size={20} />חיפוש</>}</Btn>
      </form>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      {state.res && <SearchResults res={state.res} db={db} onPick={(b) => onPick(b)} goSettings={goSettings} smart={smart} onSmart={() => runSmart(text, mode === 'text' ? author.trim() : '')} />}
    </>
  );
}

/* ---------- הוספת רשימה ברצף ---------- */
function parseBookList(text) {
  let lines = (text || '').split(/\r?\n/);
  if (lines.filter(l => l.trim()).length === 1 && /[,;،]/.test(lines[0])) lines = lines[0].split(/[,;،]/);
  return lines
    .map(l => l.replace(/^\s*(?:\d{1,3}\s*[.)\-:]|[-*•·▪►✓✔])\s*/, '').trim())
    .filter(l => l.length > 1)
    .slice(0, 60)
    .map(l => {
      if (tryURL(l) || isPureISBN(l)) return { raw: l, title: l, author: '' };
      const parts = l.split(/\s+[-–—]\s+|\s+\/\s+|\s+מאת\s+|\s+by\s+/i);
      return { raw: l, title: parts[0].trim(), author: (parts[1] || '').trim() };
    });
}
function loadQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(ACTIVE.queueKey) || 'null');
    if (!q || !Array.isArray(q.items)) return null;
    // תוצאות החיפוש לא נשמרות; פריטים שלא טופלו מחפשים מחדש (מהיר, יש מטמון)
    q.items = q.items.map(it => ({ ...it, status: isDone(it.status) ? it.status : 'pending' }));
    return q;
  } catch (e) { return null; }
}
function saveQueue(q) {
  try { if (q) localStorage.setItem(ACTIVE.queueKey, JSON.stringify(q)); else localStorage.removeItem(ACTIVE.queueKey); } catch (e) { /* */ }
}
const Q_STATUS = {
  pending: { label: 'ממתין', cls: 'bg-surface2 text-muted' },
  searching: { label: 'מחפש', cls: 'bg-surface2 text-muted' },
  ready: { label: 'לבחירה', cls: 'bg-accentSoft text-accent' },
  notfound: { label: 'לא נמצא', cls: 'bg-surface2 text-warn' },
  error: { label: 'שגיאה', cls: 'bg-surface2 text-danger' },
  saved: { label: 'נוסף', cls: 'bg-accentSoft text-ok' },
  exists: { label: 'כבר קיים', cls: 'bg-surface2 text-ok' },
  skipped: { label: 'דולג', cls: 'bg-surface2 text-muted' }
};
const isDone = (st) => st === 'saved' || st === 'skipped' || st === 'exists';

function BulkImport({ db, onPick, goSettings }) {
  const [queue, setQueue] = useState(() => loadQueue());
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState({});
  const [form, setForm] = useState({ id: null, title: '', author: '' });   // חיפוש מדויק לספר הנוכחי
  const [listOpen, setListOpen] = useState(false);   // false | 'todo' | 'done'
  const [listDraft, setListDraft] = useState(null);   // טקסט בעריכת הרשימה כולה
  const busy = useRef(false);
  const topRef = useRef(null);
  const smartTarget = useRef(null);
  const [smart, runSmart] = useSmartSearch((res) => {
    const id = smartTarget.current;
    setResults(r => ({ ...r, [id]: { ...res, fromAi: true } }));
    setItem(id, { status: res.candidates.length ? 'ready' : 'notfound' });
  });
  const parsed = useMemo(() => parseBookList(draft), [draft]);
  // זיהוי חכם לכל הספרים שלא נמצאו, אחד אחרי השני
  const [bulkSmart, setBulkSmart] = useState({ busy: false, done: 0, total: 0, cost: 0, err: '' });
  const smartAllNotFound = async (auto) => {
    const targets = (queue ? queue.items : []).filter(it => (it.status === 'notfound' || it.status === 'error') && !(auto && it.aiTried));
    if (!targets.length) return;
    targets.forEach(it => setItem(it.id, { aiTried: true }));
    setBulkSmart({ busy: true, done: 0, total: targets.length, cost: 0, err: '' });
    let cost = 0;
    for (let i = 0; i < targets.length; i++) {
      const it = targets[i];
      try {
        const res = await aiResolveBook(it.title, it.author || '');
        cost += res.cost || 0;
        setResults(r => ({ ...r, [it.id]: { ...res, fromAi: true } }));
        setItem(it.id, { status: res.candidates.length ? 'ready' : 'notfound' });
      } catch (e) { setBulkSmart(b => ({ ...b, err: e.message })); break; }
      setBulkSmart(b => ({ ...b, done: i + 1, cost }));
    }
    setBulkSmart(b => ({ ...b, busy: false, cost }));
  };

  useEffect(() => { saveQueue(queue); }, [queue]);
  const currentId = queue ? queue.current : null;
  useEffect(() => {
    const c = queue && queue.items.find(it => it.id === currentId);
    setForm(c ? { id: c.id, title: c.title, author: c.author || '' } : { id: null, title: '', author: '' });
  }, [currentId]);

  const setItem = (id, patch) => setQueue(q => q && ({ ...q, items: q.items.map(it => it.id === id ? { ...it, ...patch } : it) }));
  // ספר שכבר נמצא בספרייה יוצא לבד מרשימת הטיפול
  const dbRef = useRef(db); dbRef.current = db;
  const inLibrary = (it, res) => {
    const top = res && res.candidates && res.candidates[0];
    const byRes = top && (top.match || 0) >= 0.6 && findInLibrary(top, dbRef.current.books);
    if (byRes) return byRes;
    const text = skel(`${it.title} ${it.author || ''}`).join(' ');
    return dbRef.current.books.find(b => {
      const t = skel(normTitle(b.title)).join(' ');
      if (t.length < 3 || !(text === t || text.startsWith(t + ' '))) return false;
      const rest = text.slice(t.length).trim();
      return !rest || (b.authors || []).some(a => skel(a).some(w => w.length > 1 && rest.includes(w)));
    });
  };
  useEffect(() => {
    if (!queue) return;
    const hit = queue.items.map(it => [it, !isDone(it.status) && it.status !== 'searching' && inLibrary(it, results[it.id])]).filter(x => x[1]);
    if (!hit.length) return;
    setQueue(q => {
      if (!q) return q;
      const ids = new Map(hit.map(([it, b]) => [it.id, b.title]));
      const items = q.items.map(it => ids.has(it.id) && !isDone(it.status) ? { ...it, status: 'exists', savedTitle: ids.get(it.id) } : it);
      const cur = items.find(it => it.id === q.current);
      const nx = cur && isDone(cur.status) ? items.find(it => !isDone(it.status)) : cur;
      return { ...q, items, current: nx ? nx.id : null };
    });
  }, [queue, results, db.books]);
  // בסוף החיפוש הרגיל: ספרים שלא נמצאו עוברים לבד לזיהוי החכם (פעם אחת לכל ספר)
  useEffect(() => {
    if (!queue || bulkSmart.busy || !aiAvailable()) return;
    if (queue.items.some(it => it.status === 'pending' || it.status === 'searching')) return;
    if (queue.items.some(it => (it.status === 'notfound' || it.status === 'error') && !it.aiTried)) smartAllNotFound(true);
  }, [queue, bulkSmart.busy]);

  // חיפוש ברקע, פריט אחד בכל פעם; הפריט הנוכחי קודם
  useEffect(() => {
    if (!queue || busy.current) return;
    const cur = queue.items.find(it => it.id === queue.current);
    const next = (cur && cur.status === 'pending') ? cur : queue.items.find(it => it.status === 'pending');
    if (!next) return;
    busy.current = true;
    setItem(next.id, { status: 'searching' });
    searchBooks(next.title, next.author)
      .then(res => {
        setResults(r => ({ ...r, [next.id]: res }));
        setItem(next.id, { status: res.candidates.length ? 'ready' : 'notfound' });
      })
      .catch(() => setItem(next.id, { status: 'error' }))
      .finally(() => { busy.current = false; setQueue(q => q && { ...q }); });
  }, [queue]);

  const start = () => {
    if (!parsed.length) return;
    const items = parsed.map(p => ({ id: uid(), ...p, status: 'pending', savedTitle: '' }));
    setResults({});
    setQueue({ items, current: items[0].id, createdAt: Date.now() });
    setDraft('');
  };
  const goNext = (fromId) => {
    setQueue(q => {
      if (!q) return q;
      const idx = q.items.findIndex(it => it.id === fromId);
      const order = q.items.slice(idx + 1).concat(q.items.slice(0, idx + 1));
      const nx = order.find(it => !isDone(it.status) && it.id !== fromId);
      return { ...q, current: nx ? nx.id : null };
    });
    setTimeout(() => topRef.current && topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const research = (id, title, author) => {
    if (!title.trim()) return;
    setResults(r => { const n = { ...r }; delete n[id]; return n; });
    setItem(id, { title: title.trim(), author: author.trim(), status: 'pending', savedTitle: '' });
  };
  const lineOf = (it) => it.author ? `${it.title} - ${it.author}` : it.title;
  const saveList = () => {
    const lines = parseBookList(listDraft);
    setQueue(q => {
      const handled = q.items.filter(it => isDone(it.status));
      const pool = q.items.filter(it => !isDone(it.status));
      const todo = lines.map(p => {
        const i = pool.findIndex(it => norm(it.title) === norm(p.title) && norm(it.author) === norm(p.author));
        if (i >= 0) return pool.splice(i, 1)[0];
        return { id: uid(), ...p, status: 'pending', savedTitle: '' };
      });
      const items = [...handled, ...todo];
      if (!items.length) return null;
      const cur = items.find(it => it.id === q.current) || items.find(it => !isDone(it.status));
      return { ...q, items, current: cur ? cur.id : null };
    });
    setListDraft(null);
  };

  if (!queue) {
    return (
      <div className="grid gap-2">
        <label htmlFor="bulk-list" className="text-[15px]">הדביקו או הקלידו רשימה, <b>ספר בכל שורה</b>. אפשר להוסיף מחבר אחרי מקף, ואפשר גם ISBN או קישור.</label>
        <textarea id="bulk-list" value={draft} onChange={e => setDraft(e.target.value)} rows={8}
          placeholder={'יער נורווגי - מורקמי\nסיפור על אהבה וחושך\nProject Hail Mary - Andy Weir\n9789650731234'}
          className="w-full rounded-xl border border-line bg-surface p-3 text-[16px] leading-relaxed" />
        {parsed.length > 0 && (
          <div className="text-[14px] text-muted">
            זוהו <b className="tabular text-ink">{parsed.length}</b> ספרים{parsed.some(p => p.author) ? `, ${parsed.filter(p => p.author).length} עם מחבר` : ''}.
            {parsed.length >= 60 && ' (מקסימום 60 בכל רשימה)'}
          </div>
        )}
        <Btn disabled={!parsed.length} onClick={start}><Icon name="ListChecks" size={20} />התחלה: {parsed.length || ''} ספרים לבחירה</Btn>
        <p className="text-[13px] text-muted">כל ספר נבדק מול המאגרים. אחר כך עוברים ספר-ספר, בוחרים את ההדפסה הנכונה ומדרגים. ההתקדמות נשמרת גם אם סוגרים את הדף.</p>
      </div>
    );
  }

  const items = queue.items;
  const doneCount = items.filter(it => isDone(it.status)).length;
  const savedCount = items.filter(it => it.status === 'saved').length;
  const cur = items.find(it => it.id === queue.current);
  const curIdx = cur ? items.indexOf(cur) : -1;
  const res = cur && results[cur.id];

  return (
    <div className="grid gap-3" ref={topRef}>
      <div className="bg-surface border border-line rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="font-semibold text-[16px] tabular">{doneCount} מתוך {items.length} טופלו · {savedCount} נוספו</div>
          <button type="button" className="text-muted text-[14px] font-semibold min-h-[40px] px-2" onClick={() => { setQueue(null); setResults({}); }}>סגירת הרשימה</button>
        </div>
        <div className="h-2 rounded-full bg-surface2 overflow-hidden mb-2" aria-hidden="true">
          <div className="h-full bg-accent transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[['todo', `לטיפול (${items.length - doneCount})`], ['done', `טופלו (${doneCount})`]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setListOpen(listOpen === k ? false : k)} aria-expanded={listOpen === k}
              className={`min-h-[44px] rounded-xl border font-semibold text-[14px] ${listOpen === k ? 'border-accent bg-accentSoft text-accent' : 'border-line'}`}>{l}</button>
          ))}
          <button type="button" onClick={() => { setListDraft(items.filter(it => !isDone(it.status)).map(lineOf).join('\n')); setListOpen(false); }}
            className="min-h-[44px] rounded-xl border border-line font-semibold text-[14px] inline-flex items-center justify-center gap-1"><Icon name="Pencil" size={15} />עריכה</button>
        </div>
        {aiAvailable() && (bulkSmart.busy || items.some(it => it.status === 'notfound' || it.status === 'error')) && (
          <div className="mt-2 grid gap-1">
            <Btn variant="soft" disabled={bulkSmart.busy} onClick={() => smartAllNotFound(false)}>
              {bulkSmart.busy ? <><Spinner />מזהה {bulkSmart.done + 1} מתוך {bulkSmart.total}…</> : <><Icon name="Sparkles" size={18} />זיהוי חכם לכל מה שלא נמצא ({items.filter(it => it.status === 'notfound' || it.status === 'error').length})</>}
            </Btn>
            {!bulkSmart.busy && bulkSmart.total > 0 && <p className="text-[13px] text-muted">זוהו {bulkSmart.done} ספרים · עלות משוערת ${bulkSmart.cost.toFixed(2)}</p>}
            {bulkSmart.err && <p className="text-[13px] text-danger">{bulkSmart.err}</p>}
          </div>
        )}
        {listOpen && (() => {
          const shownItems = items.filter(it => listOpen === 'done' ? isDone(it.status) : !isDone(it.status));
          return (
            <ul className="mt-2 grid gap-1 fade-in" aria-label={listOpen === 'done' ? 'ספרים שטופלו' : 'ספרים לטיפול'}>
              {!shownItems.length && <li className="text-[14px] text-muted py-2 text-center">{listOpen === 'done' ? 'עוד לא טופלו ספרים.' : 'אין ספרים שממתינים לטיפול.'}</li>}
              {shownItems.map(it => (
                <li key={it.id} className="flex items-center gap-1.5">
                  <button type="button" onClick={() => { setQueue(q => ({ ...q, current: it.id })); setListOpen(false); }}
                    className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-right border ${it.id === queue.current ? 'border-accent bg-accentSoft' : 'border-transparent'}`}>
                    <span className="flex-1 min-w-0 text-[14px] font-semibold truncate">{it.savedTitle || it.title}{it.author ? <span className="text-muted font-normal"> · {it.author}</span> : null}</span>
                    <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${Q_STATUS[it.status].cls}`}>{Q_STATUS[it.status].label}</span>
                  </button>
                  {listOpen === 'done' && it.status !== 'saved' && (
                    <button type="button" onClick={() => { setItem(it.id, { status: 'pending', savedTitle: '' }); setQueue(q => ({ ...q, current: it.id })); setListOpen(false); }}
                      className="shrink-0 min-h-[40px] px-2 rounded-lg text-accent font-semibold text-[13px]">חזרה לטיפול</button>
                  )}
                </li>
              ))}
            </ul>
          );
        })()}
      </div>

      {listDraft !== null && (
        <div className="fade-in bg-surface border border-accent rounded-xl p-3 grid gap-2">
          <label htmlFor="bulk-list-edit" className="font-semibold text-[15px]">עריכת הרשימה</label>
          <p className="text-[13px] text-muted">הספרים שממתינים לטיפול, ספר בכל שורה. אפשר לתקן שם, להוסיף מחבר אחרי מקף, להוסיף ספרים או למחוק שורות. ספרים שכבר טופלו לא מושפעים.</p>
          <textarea id="bulk-list-edit" value={listDraft} onChange={e => setListDraft(e.target.value)} rows={Math.min(12, Math.max(4, items.length + 1))}
            className="w-full rounded-xl border border-line bg-bg p-2.5 text-[16px] leading-relaxed" />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={saveList}><Icon name="Check" size={18} />שמירה וחיפוש</Btn>
            <Btn variant="ghost" onClick={() => setListDraft(null)}>ביטול</Btn>
          </div>
        </div>
      )}

      {!cur && (
        <div className="bg-surface border border-line rounded-xl p-4 text-center grid gap-3">
          <div className="font-display font-medium text-[22px]">הרשימה הושלמה</div>
          <p className="text-muted tabular">{savedCount} ספרים נוספו לספרייה · {items.filter(i => i.status === 'exists').length} כבר היו בה · {items.filter(i => i.status === 'skipped').length} דולגו</p>
          <Btn onClick={() => { setQueue(null); setResults({}); }}>רשימה חדשה</Btn>
        </div>
      )}

      {cur && (
        <section className="grid gap-3" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-muted tabular">ספר {curIdx + 1} מתוך {items.length}</div>
              <h2 className="font-display font-medium text-[22px] leading-tight">{cur.title}</h2>
              {cur.author && <div className="text-muted text-[15px]">{cur.author}</div>}
            </div>
            <span className={`shrink-0 text-[12px] font-semibold px-2 py-1 rounded-full ${Q_STATUS[cur.status].cls}`}>{Q_STATUS[cur.status].label}</span>
          </div>

          {cur.status === 'saved' && <Notice tone="ok">נוסף לספרייה: {cur.savedTitle}</Notice>}

          <form className="grid gap-2 bg-surface border border-line rounded-xl p-3" onSubmit={(e) => { e.preventDefault(); research(cur.id, form.title, form.author); }}>
            <div className="text-[13px] font-semibold text-muted">דיוק החיפוש</div>
            <label htmlFor="bulk-edit-title" className="sr-only">שם הספר</label>
            <input id="bulk-edit-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="שם הספר, ISBN או קישור"
              className="w-full min-h-[48px] px-3 rounded-xl border border-line bg-bg text-[16px]" />
            <label htmlFor="bulk-edit-author" className="sr-only">מחבר</label>
            <input id="bulk-edit-author" value={form.author} onChange={e => setForm({ ...form, author: e.target.value })} placeholder="מחבר (רשות, משפר את הדיוק)"
              className="w-full min-h-[48px] px-3 rounded-xl border border-line bg-bg text-[16px]" />
            <div className="grid grid-cols-2 gap-2">
              <Btn type="submit" variant="soft" className="whitespace-nowrap !px-2" disabled={!form.title.trim() || cur.status === 'searching'}><Icon name="RefreshCw" size={18} />חיפוש מחדש</Btn>
              <Btn variant="ghost" onClick={() => { if (!isDone(cur.status)) setItem(cur.id, { status: 'skipped' }); goNext(cur.id); }}>
                {isDone(cur.status) ? 'לספר הבא' : 'דילוג'}<Icon name="ChevronLeft" size={18} />
              </Btn>
            </div>
          </form>

          {(cur.status === 'pending' || cur.status === 'searching') && (
            <div className="bg-surface border border-line rounded-xl p-4 text-muted inline-flex items-center gap-2"><Spinner />מחפש ומאמת מול המאגרים…</div>
          )}
          {cur.status === 'error' && <Notice tone="error">החיפוש נכשל (בעיית רשת). לחצו "חיפוש מחדש".</Notice>}
          {res && !isDone(cur.status) && (() => {
            const top = res.candidates[0];
            const already = top && findInLibrary(top, db.books);
            return (
              <>
                {already && (
                  <Notice tone="ok">
                    נראה שהספר "{already.title}" כבר בספרייה ({already.rating}★).
                    <button type="button" className="block mt-1 text-accent font-semibold min-h-[40px]" onClick={() => { setItem(cur.id, { status: 'exists', savedTitle: already.title }); goNext(cur.id); }}>סימון כקיים והמשך ←</button>
                  </Notice>
                )}
                <SearchResults res={res} db={db} goSettings={goSettings} smart={smart}
                  onSmart={() => { smartTarget.current = cur.id; runSmart(cur.title, cur.author || ''); }}
                  onPick={(b) => onPick({ ...b, ...(cur.note ? { note: cur.note } : {}), ...(cur.rating ? { presetRating: cur.rating } : {}) }, { status: cur.want ? 'want' : undefined, onSaved: (saved) => { setItem(cur.id, { status: 'saved', savedTitle: saved.title }); goNext(cur.id); } })} />
              </>
            );
          })()}
        </section>
      )}
    </div>
  );
}

function FreeTextIntake({ goBulk, goSettings }) {
  const [text, setText] = useState('');
  const [st, setSt] = useState({ busy: false, err: '', cost: 0 });
  const [found, setFound] = useState(null);   // [{title, author, note}]
  if (!aiAvailable()) {
    return (
      <Notice tone="info">
        זיהוי ספרים מתוך טקסט חופשי עובד דרך Claude, והוא עוד לא זמין באפליקציה.
      </Notice>
    );
  }
  const run = async () => {
    setSt({ busy: true, err: '', cost: 0 });
    try { const r = await aiExtractBooks(text); setFound(r.books); setSt({ busy: false, err: '', cost: r.cost }); }
    catch (e) { setSt({ busy: false, err: e.message, cost: 0 }); }
  };
  const start = () => {
    const cur = loadQueue();
    const items = found.map(b => ({ id: uid(), raw: b.title, title: b.title, author: b.author || '', note: b.note || '', status: 'pending', savedTitle: '' }));
    const q = cur ? { ...cur, items: [...cur.items, ...items] } : { items, current: items[0].id, createdAt: Date.now() };
    if (!q.current) q.current = items[0].id;
    saveQueue(q);
    goBulk();
  };
  return (
    <div className="grid gap-2">
      <label htmlFor="free-text" className="text-[15px]">כתבו בחופשיות על ספרים שקראתם: שמות, סופרים, מה אהבתם. Claude יזהה את הספרים, ואחר כך תבחרו ותדרגו כל אחד.</label>
      <textarea id="free-text" value={text} onChange={e => setText(e.target.value)} rows={7}
        placeholder={'למשל: השנה קראתי את החדש של אשכול נבו, ממש אהבתי. גם משהו של פרנזן על משפחה, ואת זה של מורקמי עם הבאר, שקצת שעמם אותי.'}
        className="w-full rounded-xl border border-line bg-surface p-3 text-[16px] leading-relaxed" />
      <Btn disabled={!text.trim() || st.busy} onClick={run}>{st.busy ? <><Spinner />מזהה ספרים…</> : <><Icon name="Sparkles" size={20} />זיהוי הספרים</>}</Btn>
      {st.err && <Notice tone="error">{st.err}</Notice>}
      {found && (
        <div className="fade-in bg-surface border border-line rounded-xl p-3 grid gap-2">
          <div className="font-semibold text-[15px]">זוהו {found.length} ספרים{st.cost ? <span className="text-muted font-normal text-[13px]"> · עלות משוערת ${st.cost.toFixed(2)}</span> : null}</div>
          {found.length === 0 && <p className="text-muted text-[14px]">לא זוהו ספרים בטקסט. נסו לכתוב שמות של ספרים או סופרים.</p>}
          <ul className="grid gap-1.5">
            {found.map((b, i) => (
              <li key={i} className="flex items-start gap-2 border-b border-line last:border-0 pb-1.5">
                <div className="flex-1 min-w-0 grid gap-1">
                  <label htmlFor={`ft-t-${i}`} className="sr-only">שם הספר</label>
                  <input id={`ft-t-${i}`} value={b.title} onChange={e => setFound(f => f.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                    className="w-full min-h-[40px] px-2 rounded-lg border border-line bg-bg text-[15px] font-semibold" />
                  <label htmlFor={`ft-a-${i}`} className="sr-only">מחבר</label>
                  <input id={`ft-a-${i}`} value={b.author} placeholder="מחבר" onChange={e => setFound(f => f.map((x, j) => j === i ? { ...x, author: e.target.value } : x))}
                    className="w-full min-h-[40px] px-2 rounded-lg border border-line bg-bg text-[14px]" />
                  {b.note && <p className="text-[13px] text-muted">{b.note}</p>}
                </div>
                <button type="button" aria-label="הסרה" onClick={() => setFound(f => f.filter((_, j) => j !== i))} className="w-10 h-10 grid place-items-center rounded-lg text-muted"><Icon name="X" size={18} /></button>
              </li>
            ))}
          </ul>
          {found.length > 0 && <Btn onClick={start}><Icon name="ListChecks" size={20} />המשך: בחירה ודירוג של {found.length} ספרים</Btn>}
        </div>
      )}
    </div>
  );
}

function AddTab({ db, onPick, goSettings }) {
  const [mode, setMode] = useState(() => { try { return sessionStorage.getItem('vrt_add_mode') || (loadQueue() ? 'bulk' : 'single'); } catch (e) { return 'single'; } });
  useEffect(() => { try { sessionStorage.setItem('vrt_add_mode', mode); } catch (e) { /* */ } }, [mode]);
  return (
    <div className="fade-in">
      <header className="pt-4 pb-3">
        <h1 className="font-display font-medium text-[26px] leading-snug">הוספת ספר</h1>
        <p className="text-muted text-[15px]">שם ספר בעברית או באנגלית, ISBN או קישור. רק תוצאות שחזרו מהמאגרים יוצגו.</p>
      </header>
      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-surface2 mb-4" role="tablist" aria-label="אופן ההוספה">
        {[['single', 'ספר אחד', 'Search'], ['bulk', 'רשימה', 'ListChecks'], ['text', 'טקסט חופשי', 'PenLine']].map(([k, l, ic]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
            className={`min-h-[44px] rounded-xl font-semibold text-[15px] inline-flex items-center justify-center gap-1.5 transition-colors ${mode === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>
            <Icon name={ic} size={17} />{l}
          </button>
        ))}
      </div>
      {mode === 'single' && <SingleSearch db={db} onPick={onPick} goSettings={goSettings} />}
      {mode === 'bulk' && <BulkImport db={db} onPick={onPick} goSettings={goSettings} />}
      {mode === 'text' && <FreeTextIntake goBulk={() => setMode('bulk')} goSettings={goSettings} />}
    </div>
  );
}

/* ============================================================
   לשונית: גלה ספר חדש (ראיון + מנוע)
   ============================================================ */
const QUESTIONS = [
  { id: 'mood', text: 'איזה מצב רוח מתאים לך עכשיו?', options: Object.entries(MOODS).map(([k, v]) => ({ k, label: v.label })) },
  { id: 'pacing', text: 'איזה קצב קריאה בא לך?', options: Object.entries(PACING).map(([k, v]) => ({ k, label: v.label })) },
  { id: 'avoid', text: 'יש נושאים שעדיף להימנע מהם? (אפשר לבחור כמה)', multi: true, options: Object.entries(AVOID).map(([k, v]) => ({ k, label: v.label })) },
  { id: 'length', text: 'ומה לגבי האורך?', options: Object.entries(LENGTHS).map(([k, v]) => ({ k, label: v.label })) }
];

function Bubble({ from, children }) {
  const bot = from === 'bot';
  return (
    <div className={`fade-in flex ${bot ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] min-w-0 break-words [overflow-wrap:anywhere] px-3.5 py-2.5 font-reading ${bot ? 'bg-surface border border-line rounded-xl rounded-tr-sm' : 'bg-accentSoft text-ink rounded-xl rounded-tl-sm'}`}>{children}</div>
    </div>
  );
}

/* זמינות בפורמטים: מציגים כעובדה רק מה שה-API אישר; לחנויות הישראליות יש קישורי חיפוש (לא טענה) */
const STORES = [
  { name: 'e-vrit', site: 'e-vrit.co.il', kind: 'דיגיטלי וקולי' },
  { name: 'Storytel', site: 'storytel.com', kind: 'קולי' },
  { name: 'עברית', site: 'ivrit.co.il', kind: 'דיגיטלי' },
  { name: 'סטימצקי', site: 'steimatzky.co.il', kind: 'מודפס ודיגיטלי' },
  { name: 'צומת ספרים', site: 'booknet.co.il', kind: 'מודפס' },
  { name: 'Audible', site: 'audible.com', kind: 'קולי, אנגלית' }
];
function FormatInfo({ book }) {
  const q = `"${book.title}" ${(book.authors || [])[0] || ''}`.trim();
  const facts = [];
  if (book.ebook) facts.push({ text: 'ספר דיגיטלי זמין ב-Google Play Books', link: book.ebookLink });
  if (book.olEbook) facts.push({ text: 'עותק דיגיטלי להשאלה ב-Open Library', link: book.link });
  if (book.pageCount && book.isbns && book.isbns.length) facts.push({ text: `מהדורה מודפסת רשומה (ISBN ${book.isbns[0]}, ${book.pageCount} עמ')` });
  const af = book.aiFormats;
  const yn = { yes: 'יש', no: 'אין', unknown: 'לא ידוע' };
  return (
    <div className="mt-2.5 border border-line rounded-xl p-2.5 grid gap-1.5">
      <div className="text-[13px] font-semibold text-muted flex items-center gap-1"><Icon name="BookCopy" size={14} />זמינות: מודפס, דיגיטלי, קולי</div>
      {facts.length
        ? <ul className="grid gap-0.5 text-[14px]">{facts.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5"><span className="text-ok mt-0.5"><Icon name="CircleCheck" size={15} /></span>
              {f.link ? <a href={f.link} target="_blank" rel="noopener noreferrer" className="underline">{f.text}</a> : <span>{f.text}</span>}</li>))}</ul>
        : <p className="text-[13px] text-muted">המאגרים לא מציינים פורמטים לספר הזה.</p>}
      {af && (
        <div className="text-[13px] border-t border-line pt-1.5">
          <div className="font-semibold text-muted mb-0.5">לפי המקורות שנקראו:</div>
          <div className="flex flex-wrap gap-1.5">
            {[['print', 'מודפס'], ['ebook', 'דיגיטלי'], ['audiobook', 'קולי']].map(([k, l]) => (
              <span key={k} className={`px-2 py-0.5 rounded-full font-semibold ${af[k] === 'yes' ? 'bg-accentSoft text-ok' : 'bg-surface2 text-muted'}`}>{l}: {yn[af[k]] || 'לא ידוע'}</span>
            ))}
          </div>
          {af.notes && <div className="text-muted mt-1">{af.notes}</div>}
        </div>
      )}
      {book.sources && book.sources.length > 0 && (
        <div className="text-[13px] border-t border-line pt-1.5">
          <div className="font-semibold text-muted mb-0.5">מקורות:</div>
          <ul className="grid gap-0.5">{book.sources.slice(0, 6).map((src, i) => (
            <li key={i} className="truncate"><a href={src.url} target="_blank" rel="noopener noreferrer" className="underline">{src.title || src.url}</a></li>))}</ul>
        </div>
      )}
      <details>
      <summary className="text-[13px] font-semibold text-accent cursor-pointer min-h-[32px] flex items-center">בדיקה בחנויות: e-vrit, Storytel, סטימצקי ועוד</summary>
      <div className="text-[12px] text-muted mb-1">כל קישור פותח חיפוש באתר עצמו. זו בדיקה ידנית, לא אימות.</div>
      <div className="flex flex-wrap gap-1.5">
        {STORES.map(st => (
          <a key={st.site} href={`https://www.google.com/search?q=${encodeURIComponent(`site:${st.site} ${q}`)}`} target="_blank" rel="noopener noreferrer"
            className="min-h-[36px] px-2.5 rounded-full border border-line text-[13px] font-semibold inline-flex items-center gap-1">
            {st.name}<span className="text-muted font-normal">· {st.kind}</span>
          </a>
        ))}
      </div>
      </details>
    </div>
  );
}

// הפרופיל הספרותי: מוצג למשתמש, מתעדכן לבד ברקע כשנוספו כמה ספרים או שלילות עם הערה, ואפשר להוסיף הערה משלך
const PROFILE_BUSY = {};
function LitProfileCard({ db, update }) {
  const p = db.litProfile;
  const [busy, setBusy] = useState(!!PROFILE_BUSY[ACTIVE.id]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(db.profileNote || '');
  const build = async () => {
    if (PROFILE_BUSY[ACTIVE.id]) return;
    PROFILE_BUSY[ACTIVE.id] = true; setBusy(true); setErr('');
    try { const np = await aiBuildProfile(db); update(d => ({ ...d, litProfile: np })); }
    catch (e) { setErr(e.message); }
    PROFILE_BUSY[ACTIVE.id] = false; setBusy(false);
  };
  useEffect(() => { if (aiAvailable() && profileStale(db)) build(); }, []);
  if (!aiAvailable()) return null;
  const read = db.books.filter(b => b.status !== 'want').length;
  return (
    <section className="bg-surface border border-line rounded-2xl p-3.5 mb-4 grid gap-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-medium text-[18px] flex items-center gap-1.5"><Icon name="Feather" size={18} />הפרופיל הספרותי שלי</h2>
        {busy ? <span className="text-[13px] text-muted inline-flex items-center gap-1"><Spinner size={14} />מתעדכן…</span>
          : p && <button type="button" className="text-[13px] text-accent font-semibold min-h-[36px]" onClick={build}>עדכון</button>}
      </div>
      {p ? (
        <>
          <p className={`font-reading text-[15.5px] whitespace-pre-line ${open ? '' : 'clamp-4'}`}>{p.text}</p>
          <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
            <button type="button" className="text-accent font-semibold min-h-[36px]" onClick={() => setOpen(!open)}>{open ? 'פחות' : 'לפרופיל המלא'}</button>
            <span>עודכן {fmtDate(p.at)}{changedSince(db, p.at).length ? ` · ${changedSince(db, p.at).length} שינויים מאז` : ''}</span>
          </div>
        </>
      ) : <p className="text-[14px] text-muted">{read < 3 ? 'אחרי 3 ספרים מדורגים ייבנה כאן פרופיל של הטעם שלך. ההמלצות משתמשות בו כדי לעבוד מהר יותר.' : busy ? 'בונה את הפרופיל מהספרים שקראת…' : 'עוד אין פרופיל.'}</p>}
      {!p && !busy && read >= 3 && <Btn variant="soft" onClick={build}><Icon name="Feather" size={18} />בניית הפרופיל</Btn>}
      {err && <p className="text-[13px] text-danger">{err}</p>}
      {editNote ? (
        <div className="grid gap-2">
          <label htmlFor="profile-note" className="text-[13px] font-semibold text-muted">משהו שחשוב לדעת על הטעם שלך?</label>
          <textarea id="profile-note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={1500} placeholder="למשל: אוהב סופים פתוחים, לא מתחבר לספרי מתח, מחפש עכשיו ספרים קצרים"
            className="w-full rounded-xl border border-line bg-bg p-2.5 text-[16px]" />
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => { update(d => ({ ...d, profileNote: note.trim(), profileNoteAt: Date.now() })); setEditNote(false); }}>שמירה</Btn>
            <Btn variant="ghost" onClick={() => { setNote(db.profileNote || ''); setEditNote(false); }}>ביטול</Btn>
          </div>
        </div>
      ) : (
        <button type="button" className="text-[13px] text-accent font-semibold min-h-[36px] justify-self-start inline-flex items-center gap-1" onClick={() => setEditNote(true)}>
          <Icon name="PenLine" size={14} />{db.profileNote ? 'עריכת ההערה שלי לפרופיל' : 'להוסיף הערה משלי לפרופיל'}
        </button>
      )}
      {db.profileNote && !editNote && <p className="text-[13px] text-muted">ההערה שלך: {db.profileNote}</p>}
    </section>
  );
}

function FocusGroup({ id, focus, onToggle }) {
  const f = FOCUS[id], cur = focus[id];
  const on = (k) => f.multi ? (cur || []).includes(k) : cur === k;
  return (
    <div role="group" aria-label={f.label}>
      <div className="text-[13px] text-muted mb-1">{f.label}{f.multi ? ' (אפשר כמה)' : ''}</div>
      <div className="flex flex-wrap gap-1.5">{f.options.map(([k, l]) => <Chip key={k} active={on(k)} onClick={() => onToggle(id, k)}>{l}</Chip>)}</div>
    </div>
  );
}
// זמינות מהחנויות: מה נמצא בפועל (מודפס/דיגיטלי/קולי) + קישור לדף הספר
function RecAvailability({ r }) {
  const offers = r.offers || [];
  const KIND = { print: 'מודפס', ebook: 'דיגיטלי', audio: 'קולי' };
  const has = (k) => offers.some(o => (o.kinds || []).includes(k)) || !!(r.availability && r.availability[k === 'audio' ? 'audio' : k]);
  const site = (s) => STORE_NAMES[s] || s;
  return (
    <div className="mt-2.5 border border-line rounded-xl p-2.5 grid gap-1.5">
      <div className="text-[13px] font-semibold text-muted flex items-center gap-1"><Icon name="BookCopy" size={14} />זמינות</div>
      <div className="flex flex-wrap gap-1.5 text-[13px]">
        {Object.entries(KIND).map(([k, l]) => (
          <span key={k} className={`px-2 py-0.5 rounded-full font-semibold ${has(k) ? 'bg-accentSoft text-ok' : 'bg-surface2 text-muted'}`}>{l}: {has(k) ? 'נמצא' : 'לא נמצא'}</span>
        ))}
      </div>
      {offers.length > 0
        ? <ul className="grid gap-0.5 text-[14px]">{offers.slice(0, 5).map(o => (
            <li key={o.url} className="truncate"><a href={o.url} target="_blank" rel="noopener noreferrer" className="underline">לדף הספר ב{site(o.site)}</a>
              <span className="text-muted"> · {(o.kinds || []).map(k => KIND[k]).join(', ')}</span></li>))}</ul>
        : <p className="text-[13px] text-muted">לא נמצא דף מכירה בחנויות. "לא נמצא" לא אומר שאין.</p>}
    </div>
  );
}

/* ---------- שלילת המלצה: לחודש או לתמיד, עם הערה שמדייקת את הפרופיל ---------- */
const activeRejections = (db) => (db.rejections || []).filter(x => !x.until || x.until > Date.now());
const rejectedKeys = (db) => activeRejections(db).flatMap(x => [x.key, x.dkey, x.title]).filter(Boolean);
function rejectBook(update, b, { forever, note }) {
  const now = Date.now();
  const entry = { id: uid(), key: b.key, dkey: dedupeKey(b), title: b.title, author: (b.authors || [])[0] || '', until: forever ? 0 : now + 30 * 86400000, note: (note || '').trim().slice(0, 500), at: now, editedAt: now };
  update(d => ({ ...d, rejections: [entry, ...(d.rejections || [])].slice(0, 500), dismissed: forever ? Array.from(new Set([...d.dismissed, b.key, dedupeKey(b)])) : d.dismissed }));
}
function RejectSheet({ book, onDone, onClose }) {
  const [forever, setForever] = useState(false);
  const [note, setNote] = useState('');
  return (
    <Sheet open onClose={onClose} title="לא מתאים לי">
      <div className="font-display font-medium text-[18px] mb-3">{book.title}</div>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface2 mb-3" role="radiogroup" aria-label="לכמה זמן">
        {[[false, 'לא בחודש הקרוב'], [true, 'לעולם לא']].map(([v, l]) => (
          <button key={l} type="button" role="radio" aria-checked={forever === v} onClick={() => setForever(v)}
            className={`min-h-[44px] rounded-xl font-semibold text-[15px] ${forever === v ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      <label htmlFor="reject-note" className="block text-[13px] font-semibold text-muted mb-1.5">למה? (רשות, עוזר לדייק את הפרופיל הספרותי)</label>
      <textarea id="reject-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
        placeholder="למשל: כבר קראתי משהו דומה; כבד מדי בשבילי עכשיו; לא אוהב את הסופר"
        className="w-full rounded-xl border border-line bg-bg p-2.5 text-[16px] leading-relaxed mb-3" />
      <Btn className="w-full" onClick={() => onDone({ forever, note })}><Icon name="ThumbsDown" size={18} />{forever ? 'לא להציג יותר' : 'להסתיר לחודש'}</Btn>
    </Sheet>
  );
}

function RecCard({ r, onRead, onWant, onDismiss, inLib }) {
  const [extra, setExtra] = useState({});
  return (
    <li className="fade-in bg-surface border border-line rounded-xl p-3">
      <div className="flex gap-3">
        <Cover book={r} className="w-20 h-28" />
        <div className="min-w-0 flex-1">
          <div className="font-display font-medium text-[18px] leading-snug">{r.title}</div>
          <div className="text-[15px]">{r.authors.join(', ')}</div>
          <div className="text-muted text-[13px] tabular">{[r.year, r.pageCount ? r.pageCount + ' עמ\'' : '', langLabel(r.language)].filter(Boolean).join(' · ')}</div>
          <div className="mt-1.5 flex flex-wrap gap-1 items-center"><SourceBadge book={r} /><span className="text-[12px] text-muted">{fmtDateTime(r.verifiedAt)}</span></div>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-accentSoft border border-line p-2.5">
        <div className="text-[13px] font-semibold text-accent mb-1 flex items-center gap-1"><Icon name="Sparkles" size={14} />למה זה מתאים לך</div>
        <ul className="text-[14px] grid gap-0.5 list-disc pr-5">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
      <Synopsis book={r} className="mt-2.5" onChange={(patch) => setExtra(x => ({ ...x, ...patch }))} />
      {r.offers ? <RecAvailability r={r} /> : <FormatInfo book={r} />}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 mt-2">
        {inLib
          ? <div className="min-h-[48px] rounded-xl bg-surface2 text-ok font-semibold grid place-items-center text-[14px]">{inLib.status === 'want' ? 'ברשימת "רוצה לקרוא"' : `בספרייה (${inLib.rating}★)`}</div>
          : <div className="grid grid-cols-2 gap-2">
              <Btn variant="soft" onClick={() => onWant({ ...r, ...extra })}><Icon name="Bookmark" size={18} />רוצה לקרוא</Btn>
              <Btn variant="ghost" onClick={() => onRead({ ...r, ...extra })}><Icon name="BookCheck" size={18} />קראתי</Btn>
            </div>}
        <button type="button" onClick={() => onDismiss(r)} aria-label="לא מעניין אותי" className="min-h-[48px] w-12 grid place-items-center rounded-xl border border-line text-muted"><Icon name="ThumbsDown" size={18} /></button>
        <a href={(r.offers && r.offers[0] && r.offers[0].url) || r.link} target="_blank" rel="noopener noreferrer" aria-label="לדף הספר" className="min-h-[48px] w-12 grid place-items-center rounded-xl border border-line text-muted"><Icon name="ExternalLink" size={18} /></a>
      </div>
    </li>
  );
}

const answersSummary = (a) => [
  a.request ? `"${a.request.length > 80 ? a.request.slice(0, 80) + '…' : a.request}"` : '', a.mode === 'ai' ? 'המלצה חכמה' : '',
  MOODS[a.mood] && MOODS[a.mood].label, PACING[a.pacing] && a.pacing !== 'any' && 'קצב ' + PACING[a.pacing].label.split(',')[0],
  LENGTHS[a.length] && a.length !== 'any' && LENGTHS[a.length].label.split(' (')[0],
  (a.avoid || []).length ? 'בלי ' + a.avoid.map(k => AVOID[k] && AVOID[k].label).filter(Boolean).join(', ') : ''
].filter(Boolean);

function HistoryView({ db, update, onPick, notify, openId, setOpenId }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const hist = db.history || [];
  const open = openId && hist.find(h => h.id === openId);
  if (open) {
    return (
      <div className="fade-in grid gap-3">
        <button type="button" onClick={() => setOpenId(null)} className="justify-self-start min-h-[40px] text-accent font-semibold inline-flex items-center gap-1"><Icon name="ChevronRight" size={18} />לכל ההיסטוריה</button>
        <div className="bg-surface border border-line rounded-xl p-3">
          <div className="font-semibold text-[16px]">{fmtDateTime(open.at)}</div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {answersSummary(open.answers).map((t, i) => <span key={i} className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-surface2">{t}</span>)}
            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-surface2">שפה: {recLangLabel(open.lang)}</span>
          </div>
        </div>
        <details className="bg-surface border border-line rounded-xl p-3">
          <summary className="font-semibold text-[15px] cursor-pointer min-h-[32px]">השיחה המלאה ({open.log.length} הודעות)</summary>
          <div className="grid gap-2 mt-2">
            {open.log.map((m, i) => <Bubble key={i} from={m.from}>{m.progress ? <span className="text-muted text-[14px]">{m.text}</span> : m.text}</Bubble>)}
          </div>
        </details>
        <h2 className="font-display font-medium text-[20px]">{open.recs.length} המלצות</h2>
        <ul className="grid gap-3">
          {open.recs.map(r => (
            <RecCard key={r.key} r={r} inLib={findInLibrary(r, db.books)} onRead={(b) => onPick(b)} onWant={(b) => onPick(b, { status: 'want' })}
              onDismiss={(b) => setRejecting(b)} />
          ))}
        </ul>
        {rejecting && <RejectSheet book={rejecting} onClose={() => setRejecting(null)} onDone={(o) => { rejectBook(update, rejecting, o); notify(o.forever ? 'לא נמליץ עליו שוב.' : 'הוסתר לחודש הקרוב.'); setRejecting(null); }} />}
        <Btn variant="danger" onClick={() => { update(d => ({ ...d, history: d.history.filter(h => h.id !== open.id), tombstones: { ...d.tombstones, history: { ...d.tombstones.history, [open.id]: Date.now() } } })); setOpenId(null); notify('השיחה נמחקה'); }}>
          <Icon name="Trash2" size={18} />מחיקת השיחה מההיסטוריה
        </Btn>
      </div>
    );
  }
  if (!hist.length) return <p className="text-muted text-center py-8">עוד אין היסטוריה. כל שיחת המלצות נשמרת כאן אוטומטית.</p>;
  return (
    <div className="fade-in grid gap-2">
      <ul className="grid gap-2">
        {hist.map(h => {
          const added = h.recs.filter(r => findInLibrary(r, db.books)).length;
          return (
            <li key={h.id}>
              <button type="button" onClick={() => setOpenId(h.id)} className="w-full text-right bg-surface border border-line rounded-xl p-3 active:bg-surface2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[15px] tabular">{fmtDateTime(h.at)}</span>
                  <span className="text-[13px] text-muted tabular">{h.recs.length} המלצות{added ? ` · ${added} בספרייה` : ''}</span>
                </div>
                <div className="text-[13px] text-muted mt-0.5 truncate">{answersSummary(h.answers).join(' · ')}</div>
                {h.recs.length > 0 && <div className="text-[14px] mt-1 clamp-2">{h.recs.slice(0, 4).map(r => r.title).join(' · ')}</div>}
              </button>
            </li>
          );
        })}
      </ul>
      <Btn variant="ghost" onClick={() => { if (!confirmClear) { setConfirmClear(true); return; } update(d => { const t = { ...d.tombstones.history }; d.history.forEach(h => { t[h.id] = Date.now(); }); return { ...d, history: [], tombstones: { ...d.tombstones, history: t } }; }); setConfirmClear(false); notify('ההיסטוריה נוקתה'); }}>
        {confirmClear ? 'לחצו שוב לניקוי כל ההיסטוריה' : 'ניקוי ההיסטוריה'}
      </Btn>
    </div>
  );
}

// מצב שיחת ההמלצות לכל משתמש, מחוץ לעץ הרכיבים: שורד יציאה מהלשונית, והמלצה שרצה ממשיכה לעדכן אותו
const REC_STORES = {};
function getRecStore(pid, db) {
  if (!REC_STORES[pid]) {
    const resume = null;   // כל כניסה מתחילה שיחה חדשה; שיחות קודמות נמצאות בהיסטוריה
    REC_STORES[pid] = {
      step: resume ? QUESTIONS.length : 0, answers: resume ? resume.answers || {} : { avoid: [] },
      log: resume ? resume.log || [] : [], running: false, recs: resume ? resume.recs || [] : [],
      shown: new Set(resume ? (resume.recs || []).flatMap(r => [r.key, r.title]) : []),
      session: resume ? { id: resume.id, at: resume.at } : { id: null, at: 0 }, listeners: new Set(),
      focus: {}, questions: [], qa: [], resuming: false
    };
  }
  return REC_STORES[pid];
}
function recSet(st, patch) { Object.assign(st, patch); st.listeners.forEach(f => f()); }
function useRecStore(pid, db) {
  const st = getRecStore(pid, db);
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); st.listeners.add(f); return () => { st.listeners.delete(f); }; }, [st]);
  return st;
}

function DiscoverTab({ db, update, onPick, notify }) {
  // מצב השיחה נשמר מחוץ ללשונית (לכל משתמש): יציאה מהלשונית לא מאפסת את השיחה, והמלצה שרצה ממשיכה ברקע
  const st = useRecStore(ACTIVE.id, db);
  const { step, answers, log, running, recs, shown } = st;
  const [multi, setMulti] = useState([]);
  const [view, setView] = useState('chat');   // 'chat' | 'history' | מזהה שיחה
  const [aiText, setAiText] = useState('');
  const [rejecting, setRejecting] = useState(null);
  const hasAi = aiAvailable();
  const endRef = useRef(null);
  const prof = useMemo(() => buildProfile(db.books), [db.books]);
  const autoLang = 'he';   // עדיפות לעברית; אפשר לבחור ידנית עברית ואנגלית / כל שפה
  const lang = db.settings.recLang === 'auto' ? autoLang : db.settings.recLang;

  useEffect(() => { if (log.length || recs.length) endRef.current && endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [log.length, step, recs.length]);

  const pushLog = (...entries) => recSet(st, { log: [...st.log, ...entries] });
  const reset = () => { recSet(st, { step: 0, answers: { avoid: [] }, log: [], recs: [], session: { id: null, at: 0 }, shown: new Set(), focus: {}, questions: [], qa: [] }); setMulti([]); setAiText(''); setOther(''); };
  const slim = (r) => ({
    key: r.key, source: r.source, sourceId: r.sourceId, title: r.title, subtitle: r.subtitle || '', authors: r.authors, year: r.year,
    description: (r.description || '').slice(0, 1200), categories: (r.categories || []).slice(0, 6), cover: r.cover, pageCount: r.pageCount,
    language: r.language, isbns: (r.isbns || []).slice(0, 3), link: r.link, publisher: r.publisher || '', reasons: r.reasons || [],
    verifiedAt: r.verifiedAt, verifiedVia: r.verifiedVia || '', ebook: !!r.ebook, ebookLink: r.ebookLink || '', olEbook: !!r.olEbook,
    sources: r.sources || [], aiFormats: r.aiFormats || null, genres: r.genres || [], descSource: r.descSource || '', descriptionHe: (r.descriptionHe || '').slice(0, 1500),
    offers: (r.offers || []).slice(0, 8), availability: r.availability || null
  });
  const saveSession = (ans, usedLang, allRecs) => {
    if (!st.session.id) st.session = { id: uid(), at: Date.now() };
    const entry = { id: st.session.id, at: st.session.at, answers: ans, lang: usedLang, log: st.log.slice(-60), recs: allRecs.map(slim) };
    update(d => ({ ...d, history: [entry, ...(d.history || []).filter(h => h.id !== entry.id)].slice(0, 40) }));
  };
  const answer = (q, value, label) => {
    const next = { ...answers, [q.id]: value };
    pushLog({ from: 'bot', text: q.text }, { from: 'me', text: label });
    setMulti([]);
    const ns = step + 1;
    recSet(st, { answers: next, step: ns });
    if (ns >= QUESTIONS.length) go(next, new Set(shown));
  };
  const go = async (ans, exclude) => {
    recSet(st, { running: true });
    const progress = (t) => pushLog({ from: 'bot', text: t, progress: true });
    try {
      if (!db.books.length) progress('הספרייה ריקה, אז ההמלצות יתבססו רק על התשובות שלך. דירוג ספרים שקראת ישפר מאוד את הדיוק.');
      const { recs: r } = await recommend({ books: db.books, answers: ans, lang, exclude, dismissed: [...db.dismissed, ...rejectedKeys(db)], want: 5, onProgress: progress });
      if (!r.length) progress('לא נמצאו ספרים שעברו את כל שלבי האימות. נסו לשנות תשובה (למשל אורך או שפה), או להוסיף עוד ספרים מדורגים.');
      const all = [...st.recs, ...r];
      const sh = new Set(st.shown); r.forEach(x => { sh.add(x.key); sh.add(dedupeKey(x)); });
      recSet(st, { recs: all, shown: sh });
      saveSession(ans, lang, all);
    } catch (e) {
      progress('אירעה שגיאת רשת בזמן החיפוש. בדקו חיבור לאינטרנט ונסו שוב.');
    }
    recSet(st, { running: false });
  };
  // המלצה חכמה: בקשה חופשית + מיקוד מהשאלון → 2–4 שאלות המשך של Claude → המלצה (בשרת, ממשיכה גם כשהמסך כבוי)
  const [other, setOther] = useState('');
  const progress = (t) => pushLog({ from: 'bot', text: t, progress: true });
  const toggleFocus = (id, k) => {
    const f = FOCUS[id], cur = st.focus[id];
    const next = f.multi ? ((cur || []).includes(k) ? cur.filter(x => x !== k) : [...(cur || []), k]) : (cur === k ? undefined : k);
    recSet(st, { focus: { ...st.focus, [id]: next } });
  };
  const excludeNow = () => [...st.recs.map(x => x.title), ...[...st.shown].filter(k => !k.includes(':') && !k.includes('|')), ...activeRejections(db).map(x => x.title)];
  const applyRecs = (ans, r, interpretation) => {
    if (interpretation) pushLog({ from: 'bot', text: interpretation });
    if (!r.length) progress('לא נשארו המלצות שעברו את האימות. נסו לנסח את הבקשה אחרת.');
    const all = [...st.recs, ...r];
    const sh = new Set(st.shown); r.forEach(x => { sh.add(x.key); sh.add(x.title); });
    recSet(st, { recs: all, shown: sh });
    saveSession(ans, lang, all);
  };
  const runAi = async (ans, qa) => {
    recSet(st, { running: true, questions: [], qa });
    try {
      const { recs: r, interpretation } = await aiRecommend({
        books: db.books, request: ans.request, focus: ans.focus, qa, lang, exclude: excludeNow(),
        dismissed: db.dismissed, history: db.history, want: 5, onProgress: progress, ctx: { ans, qa },
        profile: db.litProfile, profileNote: db.profileNote, rejections: activeRejections(db).concat((db.rejections || []).filter(x => x.note && x.until && x.until <= Date.now())), friendsLoved: friendsLovedTitles(db.books)
      });
      applyRecs(ans, r, interpretation);
    } catch (e) { progress(e.message); }
    recSet(st, { running: false });
  };
  const goAi = async () => {
    const request = aiText.trim();
    const ans = { mode: 'ai', request, focus: st.focus };
    const sum = focusSummary(st.focus);
    recSet(st, { answers: ans, step: QUESTIONS.length, running: true, qa: [] });
    pushLog({ from: 'me', text: [request || 'תמליץ לי על הספר הבא', ...sum].join(' · ') });
    let qs = [];
    try { qs = await aiClarify({ books: db.books, request, focus: st.focus, profile: db.litProfile }); } catch (e) { qs = []; }
    if (qs.length) {
      pushLog({ from: 'bot', text: `כדי לדייק, ${qs.length} שאלות קצרות (אפשר לדלג):` });
      recSet(st, { questions: qs, qa: [], running: false });
    } else runAi(ans, []);
  };
  const answerQ = (text) => {
    const qobj = st.questions[st.qa.length];
    if (!qobj || !text.trim()) return;
    const qa = [...st.qa, { q: qobj.question, a: text.trim() }];
    pushLog({ from: 'bot', text: qobj.question }, { from: 'me', text: text.trim() });
    setOther('');
    if (qa.length >= st.questions.length) runAi(st.answers, qa); else recSet(st, { qa });
  };
  // המלצה שהתחילה לפני שהאפליקציה נסגרה/רועננה: ממשיכים לחכות לה בשרת
  useEffect(() => {
    const p = loadPending();
    if (!p || st.running || st.resuming || Date.now() - p.at > 30 * 60000) return;
    const ans = (p.ctx && p.ctx.ans) || { mode: 'ai', request: '' };
    recSet(st, { running: true, resuming: true, answers: ans, step: QUESTIONS.length });
    progress('ממשיך את ההמלצה שהתחילה קודם…');
    resumeRecommend(p, { books: db.books, exclude: excludeNow(), want: 5, onProgress: progress })
      .then(({ recs: r, interpretation }) => applyRecs(ans, r, interpretation))
      .catch(e => { savePending(null); progress(e.message); })
      .finally(() => recSet(st, { running: false, resuming: false }));
  }, []);
  const q = QUESTIONS[step];
  const done = step >= QUESTIONS.length;

  return (
    <div className="fade-in">
      <header className="pt-4 pb-3">
        <h1 className="font-display font-medium text-[26px] leading-snug">גלה ספר חדש</h1>
        <p className="text-muted text-[15px]">{hasAi ? 'ספרו מה בא לכם, בחרו מיקוד, ו-Claude ישאל 2–4 שאלות לדיוק. כל המלצה נבדקת מול המאגרים והחנויות.' : '4 שאלות קצרות. כל המלצה נבדקת מחדש מול המאגר לפני שהיא מוצגת.'}</p>
      </header>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface2 mb-4" role="tablist" aria-label="תצוגה">
        {[['chat', 'שיחה', 'MessageCircle'], ['history', `היסטוריה (${(db.history || []).length})`, 'History']].map(([k, l, ic]) => {
          const on = k === 'chat' ? view === 'chat' : view !== 'chat';
          return (
            <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setView(k)}
              className={`min-h-[44px] rounded-xl font-semibold text-[15px] inline-flex items-center justify-center gap-1.5 ${on ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>
              <Icon name={ic} size={17} />{l}
            </button>
          );
        })}
      </div>
      {view !== 'chat' && <HistoryView db={db} update={update} onPick={onPick} notify={notify} openId={view === 'history' ? null : view} setOpenId={(id) => setView(id || 'history')} />}
      {view === 'chat' && <>
      {!db.settings.apiKey && !hasAi && (
        <div className="mb-3"><Notice tone="info">בלי מפתח Google Books ההמלצות מגיעות בעיקר מ-Open Library, ויש שם מעט ספרים בעברית. אפשר להוסיף מפתח חינמי בלשונית "הגדרות".</Notice></div>
      )}

      <LitProfileCard db={db} update={update} />
      <div className="bg-surface border border-line rounded-xl p-3 mb-4 grid gap-2">
        {!hasAi && <div className="text-[13px] font-semibold tracking-wide text-muted">הפרופיל שלך</div>}
        {hasAi ? null : db.books.length
          ? <div className="text-[14px] leading-relaxed">
              {prof.topAuthors.length > 0 && <div><span className="text-muted">מחברים אהובים: </span>{prof.topAuthors.slice(0, 3).map(a => a.name).join(', ')}</div>}
              {prof.topTags.length > 0 && <div><span className="text-muted">תגיות מובילות: </span>{prof.topTags.slice(0, 4).map(a => a.name).join(', ')}</div>}
              {prof.topCats.length > 0 && <div><span className="text-muted">קטגוריות: </span>{prof.topCats.slice(0, 3).map(a => a.name).join(', ')}</div>}
              {!prof.favorites.length && <div className="text-warn">עוד אין ספרים עם 4★ ומעלה. ההמלצות יתבססו בעיקר על השאלון.</div>}
            </div>
          : <div className="text-[14px] text-muted">עדיין אין ספרים בספרייה. ההמלצות יתבססו על השאלון בלבד.</div>}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[14px] text-muted">שפת ההמלצות (נשמרת כברירת מחדל שלך):</span>
          {REC_LANGS.map(([k, l]) => (
            <Chip key={k} active={db.settings.recLang === k} onClick={() => update(d => ({ ...d, settings: { ...d.settings, recLang: k } }))}>{k === 'auto' ? `${l} (${recLangLabel(autoLang)})` : l}</Chip>
          ))}
        </div>
      </div>

      {hasAi && step === 0 && !log.length && (
        <div className="bg-surface border border-accent rounded-xl p-3 mb-4 grid gap-2">
          <label htmlFor="ai-request" className="font-semibold text-[16px] flex items-center gap-1.5"><Icon name="Sparkles" size={18} />מה בא לך לקרוא?</label>
          <textarea id="ai-request" value={aiText} onChange={e => setAiText(e.target.value)} rows={3}
            placeholder="למשל: משהו כמו 'יער נורווגי' אבל פחות עצוב; רומן שמתרחש בארץ; ספר שאפשר גם לשמוע"
            className="w-full rounded-xl border border-line bg-bg p-2.5 text-[16px] leading-relaxed" />
          <div className="grid gap-2.5 border-t border-line pt-2">
            <div className="text-[14px] font-semibold text-muted">מיקוד (לא חובה)</div>
            {['mood', 'origin', 'fame', 'format'].map(id => <FocusGroup key={id} id={id} focus={st.focus} onToggle={toggleFocus} />)}
            <details>
              <summary className="text-[14px] font-semibold text-accent cursor-pointer min-h-[36px] flex items-center">עוד: ז'אנר, קצב, אורך, נושאים להימנע מהם</summary>
              <div className="grid gap-2.5 pt-1">{['genre', 'pacing', 'length', 'avoid'].map(id => <FocusGroup key={id} id={id} focus={st.focus} onToggle={toggleFocus} />)}</div>
            </details>
          </div>
          <Btn onClick={goAi} disabled={running}><Icon name="Sparkles" size={20} />המלצה חכמה</Btn>
          <p className="text-[12px] text-muted">Claude קורא את הספרייה, ההערות והדירוגים שלך, שואל 2–4 שאלות לדיוק וממליץ. ההמלצה רצה בשרת, כך שאפשר לכבות את המסך או לעבור אפליקציה. כל ספר נבדק מול הספרייה הלאומית, Google Books והחנויות, עם זמינות וקישור.</p>
        </div>
      )}
      {!hasAi && step === 0 && !log.length && (
        <div className="mb-3"><Notice tone="info">המלצות חכמות עם Claude עוד לא זמינות באפליקציה. בינתיים: השאלון המהיר.</Notice></div>
      )}

      <div className="grid gap-2.5 mb-3" aria-live="polite">
        <Bubble from="bot">היי! בואו נמצא את הספר הבא שלך. אני משתמש רק בספרים שקיימים באמת ב-Google Books או ב-Open Library.</Bubble>
        {log.map((m, i) => <Bubble key={i} from={m.from}>{m.progress ? <span className="text-muted text-[14px]">{m.text}</span> : m.text}</Bubble>)}
        {!done && q && (
          <>
            <Bubble from="bot">{q.text}</Bubble>
            <div className="flex flex-wrap gap-2 justify-end fade-in">
              {q.multi ? (
                <>
                  {q.options.map(o => <Chip key={o.k} active={multi.includes(o.k)} onClick={() => setMulti(m => m.includes(o.k) ? m.filter(x => x !== o.k) : [...m, o.k])}>{o.label}</Chip>)}
                  <Btn className="w-full mt-1" onClick={() => answer(q, multi, multi.length ? multi.map(k => AVOID[k].label).join(', ') : 'אין מגבלות')}>
                    {multi.length ? `להימנע מ-${multi.length} נושאים, המשך` : 'אין מגבלות, המשך'}
                  </Btn>
                </>
              ) : q.options.map(o => <Chip key={o.k} onClick={() => answer(q, o.k, o.label)}>{o.label}</Chip>)}
            </div>
          </>
        )}
        {!running && st.questions.length > 0 && st.qa.length < st.questions.length && (() => {
          const cq = st.questions[st.qa.length];
          return (
            <>
              <Bubble from="bot">{cq.question} <span className="text-muted text-[13px] tabular">({st.qa.length + 1}/{st.questions.length})</span></Bubble>
              <div className="flex flex-wrap gap-2 justify-end fade-in">
                {cq.options.map(o => <Chip key={o} onClick={() => answerQ(o)}>{o}</Chip>)}
              </div>
              <form className="flex gap-2 fade-in" onSubmit={(e) => { e.preventDefault(); answerQ(other); }}>
                <label htmlFor="clarify-other" className="sr-only">תשובה אחרת</label>
                <input id="clarify-other" value={other} onChange={e => setOther(e.target.value)} placeholder="או תשובה משלך"
                  className="flex-1 min-w-0 min-h-[44px] px-3 rounded-xl border border-line bg-surface text-[16px]" />
                <Btn type="submit" variant="soft" disabled={!other.trim()}>שליחה</Btn>
              </form>
              <button type="button" className="text-accent font-semibold text-[14px] min-h-[40px] justify-self-start" onClick={() => runAi(st.answers, st.qa)}>דילוג, תמליץ כבר ←</button>
            </>
          );
        })()}
        {running && <Bubble from="bot"><span className="inline-flex items-center gap-2 text-muted"><Spinner size={16} />עובד על זה…</span></Bubble>}
      </div>

      {recs.length > 0 && (
        <section className="mt-5">
          <h2 className="font-display font-medium text-[22px] mb-2">ההמלצות שלך</h2>
          <ul className="grid gap-3">
            {recs.map(r => (
              <RecCard key={r.key} r={r} inLib={findInLibrary(r, db.books)}
                onRead={(b) => onPick(b)} onWant={(b) => onPick(b, { status: 'want' })}
                onDismiss={(b) => setRejecting(b)} />
            ))}
          </ul>
        </section>
      )}

      {rejecting && <RejectSheet book={rejecting} onClose={() => setRejecting(null)} onDone={(o) => {
        rejectBook(update, rejecting, o);
        recSet(st, { recs: st.recs.filter(x => x.key !== rejecting.key) });
        notify(o.forever ? 'הוסר. לא נמליץ עליו שוב.' : 'הוסתר לחודש הקרוב.'); setRejecting(null);
      }} />}
      {done && !running && !(st.questions.length > 0 && st.qa.length < st.questions.length) && (
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Btn variant="soft" onClick={() => answers.mode === 'ai' ? runAi(answers, st.qa) : go(answers, new Set(shown))}><Icon name="RefreshCw" size={18} />עוד המלצות</Btn>
          <Btn variant="ghost" onClick={reset}><Icon name="MessageCircle" size={18} />שאלון חדש</Btn>
        </div>
      )}
      </>}
      <div ref={endRef} />
    </div>
  );
}

/* ============================================================
   לשונית: גיבוי נתונים
   ============================================================ */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function toText(db) {
  const lines = [`מה שנקרא · הספרים של ${ACTIVE.name || 'הספרייה'} · ${db.books.length} ספרים · יוצא ב-${fmtDate(Date.now())}`, ''];
  db.books.slice().sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title, 'he')).forEach((b, i) => {
    lines.push(`${i + 1}. ${b.title}${b.authors.length ? ' — ' + b.authors.join(', ') : ''}${b.year ? ` (${b.year})` : ''}`);
    lines.push(`   ${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}${b.tags.length ? '  |  ' + b.tags.join(', ') : ''}`);
    if (b.link) lines.push(`   ${b.link}`);
  });
  return lines.join('\n');
}
async function copyText(text, fallbackEl) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    if (fallbackEl) { fallbackEl.value = text; fallbackEl.select(); try { return document.execCommand('copy'); } catch (err) { return false; } }
    return false;
  }
}

function SyncPanel() {
  const sync = useSyncStatus();
  if (!sync.cloud) return <p className="text-[14px] text-danger">{sync.error || 'מחפש את השרת…'}</p>;
  const label = { syncing: 'מסנכרן…', ok: 'מסונכרן', error: 'לא מחובר', off: '' }[sync.status] || '';
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-muted">כל המשתמשים והספרים מסתנכרנים אוטומטית בין הטלפונים.{sync.lastAt ? ` עדכון אחרון: ${fmtDateTime(sync.lastAt)}.` : ''}</span>
        {label && <span className={`shrink-0 text-[13px] font-semibold px-2 py-0.5 rounded-full ${sync.status === 'error' ? 'bg-surface2 text-danger' : 'bg-accentSoft text-ok'}`}>{label}</span>}
      </div>
      {sync.error && <p className="text-[13px] text-danger">{sync.error}</p>}
      <p className="text-[13px] text-muted">המלצות חכמות ותרגום (Claude): {sync.ai === false ? <span className="text-danger font-semibold">לא פעילים, חסר מפתח ANTHROPIC_API_KEY בשרת</span> : sync.ai ? <span className="text-ok font-semibold">פעילים</span> : 'בודק…'}</p>
      <Btn variant="ghost" onClick={() => syncNow()} disabled={sync.status === 'syncing'}><Icon name="RefreshCw" size={18} />סנכרון עכשיו</Btn>
    </div>
  );
}

function BackupTab({ db, update, replace, status, notify, profile, onRenameProfile, onDeleteProfile, onOpenStarter }) {
  const [nameDraft, setNameDraft] = useState(profile.name);
  const [confirmProfileDel, setConfirmProfileDel] = useState(false);
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [keyDraft, setKeyDraft] = useState(db.settings.apiKey || '');
  const [keyTest, setKeyTest] = useState(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const saveKey = async (e) => {
    e.preventDefault();
    const k = keyDraft.trim();
    update(d => ({ ...d, settings: { ...d.settings, apiKey: k } }));
    CONFIG.apiKey = k;
    googleState.blockedUntil = 0; googleState.lastError = '';
    if (!k) { setKeyTest(null); notify('המפתח הוסר'); return; }
    setKeyTest('testing');
    try {
      const r = await fetch(googleUrl('', { q: 'isbn:9780099448822', maxResults: 1 }));
      if (r.ok) setKeyTest({ ok: true, msg: 'המפתח עובד. החיפוש ב-Google Books פעיל.' });
      else {
        const body = await r.json().catch(() => ({}));
        const m = (body.error && body.error.message) || ('שגיאה ' + r.status);
        setKeyTest({ ok: false, msg: /not been used|disabled/i.test(m) ? 'המפתח תקין, אבל Books API לא הופעל בפרויקט. חזרו לשלב 2 ולחצו Enable.' : /API key not valid/i.test(m) ? 'המפתח לא תקין. בדקו שהעתקתם אותו במלואו.' : /referer|referrer/i.test(m) ? 'המפתח מוגבל לאתר אחר. בדקו את Website restrictions.' : 'Google החזיר שגיאה: ' + m });
      }
    } catch (err) { setKeyTest({ ok: false, msg: 'אין חיבור לרשת. נסו שוב.' }); }
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const json = () => JSON.stringify({ ...db, exportedAt: Date.now(), app: 'verified-reading-tracker' }, null, 2);
  const markBackup = () => update(d => ({ ...d, lastBackupAt: Date.now() }));

  const parse = (text) => {
    setErr(''); setPreview(null); setConfirmReplace(false);
    try {
      const d = sanitizeDB(JSON.parse(text));
      if (!d) throw new Error('bad');
      const fresh = d.books.filter(b => !findInLibrary(b, db.books));
      setPreview({ data: d, fresh: fresh.length });
    } catch (e) { setErr('הקובץ אינו גיבוי תקין של האפליקציה. ודאו שזה קובץ JSON שיוצא מכאן.'); }
  };
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => parse(String(r.result || ''));
    r.onerror = () => setErr('קריאת הקובץ נכשלה.');
    r.readAsText(f);
    e.target.value = '';
  };
  const merge = () => {
    const d = preview.data;
    update(cur => {
      const books = cur.books.slice();
      d.books.forEach(b => { if (!findInLibrary(b, books)) books.push(b); });
      return { ...cur, books, tagLibrary: Array.from(new Set([...cur.tagLibrary, ...d.tagLibrary])), dismissed: Array.from(new Set([...cur.dismissed, ...d.dismissed])) };
    });
    notify(`נוספו ${preview.fresh} ספרים מהגיבוי`); setPreview(null); setPaste('');
  };
  const doReplace = () => {
    if (!confirmReplace) { setConfirmReplace(true); return; }
    const now = Date.now(); const tb = { ...db.tombstones.books };
    db.books.forEach(b => { if (!preview.data.books.some(x => x.id === b.id)) tb[b.id] = now; });
    replace({ ...preview.data, books: preview.data.books.map(b => ({ ...b, editedAt: now })), settings: { ...preview.data.settings, apiKey: db.settings.apiKey }, tombstones: { ...preview.data.tombstones, books: tb } });
    notify('הספרייה שוחזרה מהגיבוי'); setPreview(null); setPaste(''); setConfirmReplace(false);
  };
  const daysSince = db.lastBackupAt ? Math.floor((Date.now() - db.lastBackupAt) / 86400000) : null;
  const StatusRow = ({ ok, label, detail }) => (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-line last:border-0">
      <span className="text-[15px]">{label}</span>
      <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${ok === true ? 'bg-accentSoft text-ok' : ok === false ? 'bg-surface2 text-danger' : 'bg-surface2 text-muted'}`}>{detail || (ok === true ? 'פעיל' : ok === false ? 'לא זמין' : 'בודק…')}</span>
    </div>
  );

  return (
    <div className="fade-in grid gap-4">
      <header className="pt-4">
        <h1 className="font-display font-medium text-[26px] leading-snug">הגדרות</h1>
      </header>

      <section className="bg-surface border border-line rounded-xl p-3">
        <h2 className="font-semibold text-[17px] mb-2">סנכרון</h2>
        <SyncPanel />
      </section>

      <section className="bg-surface border border-line rounded-xl p-3 grid gap-2">
        <h2 className="font-semibold text-[17px]">היכרות עם הטעם שלך</h2>
        <p className="text-[14px] text-muted">סימון מהיר של ספרים מוכרים מתוך 250 ספרים לפי ז'אנרים. ספרים שכבר בספרייה לא יתווספו שוב.</p>
        <Btn variant="soft" onClick={onOpenStarter}><Icon name="ListChecks" size={18} />בחירה מרשימת ספרים מוכרים</Btn>
      </section>

      <section className="bg-surface border border-line rounded-xl p-3 grid gap-2">
        <h2 className="font-semibold text-[17px]">המשתמש שלך</h2>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nameDraft.trim()) { onRenameProfile(nameDraft.trim()); notify('השם עודכן'); } }}>
          <label htmlFor="profile-name" className="sr-only">שם המשתמש</label>
          <input id="profile-name" value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={24}
            className="flex-1 min-w-0 min-h-[48px] px-3 rounded-xl border border-line bg-bg text-[16px]" />
          <Btn variant="soft" type="submit" disabled={!nameDraft.trim() || nameDraft.trim() === profile.name}>שינוי שם</Btn>
        </form>
        <Btn variant="danger" onClick={() => { if (!confirmProfileDel) { setConfirmProfileDel(true); return; } onDeleteProfile(); }}>
          {confirmProfileDel ? `לחצו שוב: מחיקת "${profile.name}" וכל הספרים שלו` : 'מחיקת המשתמש מהמכשיר'}
        </Btn>
      </section>

      <section className="bg-surface border border-line rounded-xl p-3 grid gap-3">
        <h2 className="font-semibold text-[17px]">הגדרות</h2>
        <div>
          <div className="text-[14px] text-muted mb-1.5">שפת ברירת מחדל להמלצות ({profile.name})</div>
          <div className="flex gap-2 flex-wrap">
            {REC_LANGS.map(([k, l]) => (
              <Chip key={k} active={db.settings.recLang === k} onClick={() => update(d => ({ ...d, settings: { ...d.settings, recLang: k } }))}>{l}</Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[14px] text-muted mb-1.5">ערכת צבעים</div>
          <div className="flex gap-2 flex-wrap">
            {[['system', 'לפי המכשיר', 'Monitor'], ['light', 'בהירה', 'Sun'], ['dark', 'כהה', 'Moon']].map(([k, l, ic]) => (
              <Chip key={k} active={db.settings.theme === k} onClick={() => update(d => ({ ...d, settings: { ...d.settings, theme: k } }))}><span className="inline-flex items-center gap-1.5"><Icon name={ic} size={16} />{l}</span></Chip>
            ))}
          </div>
        </div>
        {SYNC.gbooks
          ? <p className="text-[14px] text-muted">חיפוש ב-Google Books: <span className="text-ok font-semibold">פעיל דרך השרת המשפחתי</span> (מפתח משותף, אין צורך במפתח אישי).</p>
          : <>
        <form id="api-key-section" onSubmit={saveKey} className="grid gap-1.5">
          <label htmlFor="api-key" className="text-[15px] font-semibold">מפתח Google Books API</label>
          <p className="text-[14px] text-muted">בלי מפתח, Google חוסם בדרך כלל את החיפוש בגלל מכסה משותפת לכל העולם, והאפליקציה עוברת ל-Open Library ו-Wikidata (כיסוי חלקי בעברית). מפתח אישי הוא בחינם ומאפשר 1,000 חיפושים ביום.</p>
          <details className="text-[14px] bg-bg border border-line rounded-xl p-2.5">
            <summary className="font-semibold text-accent cursor-pointer min-h-[32px]">איך משיגים מפתח (3 דקות, בחינם)</summary>
            <ol className="list-decimal pr-5 mt-2 grid gap-1.5">
              <li>נכנסים עם חשבון Google ל-<a className="text-accent font-semibold underline" href="https://console.cloud.google.com/apis/library/books.googleapis.com" target="_blank" rel="noopener noreferrer">דף Books API ב-Google Cloud</a>. אם מתבקשים, יוצרים פרויקט חדש (כל שם).</li>
              <li>לוחצים <b dir="ltr">Enable</b>.</li>
              <li>עוברים ל-<a className="text-accent font-semibold underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Credentials</a>, לוחצים <b dir="ltr">Create credentials ← API key</b> ומעתיקים את המפתח (מתחיל ב-<span dir="ltr">AIza</span>).</li>
              <li>מדביקים כאן ולוחצים "שמירה ובדיקה". לא נדרש כרטיס אשראי.</li>
              <li>רשות: ב-Credentials אפשר להגביל את המפתח ל-<span dir="ltr">yuvsaadon-coder.github.io/*</span> תחת <span dir="ltr">Website restrictions</span>.</li>
            </ol>
          </details>
          <div className="flex gap-2">
            <input id="api-key" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} dir="ltr" autoComplete="off" placeholder="AIza…"
              className="flex-1 min-w-0 min-h-[48px] px-3 rounded-xl border border-line bg-bg text-[15px]" />
            <Btn variant="soft" type="submit" disabled={keyTest === 'testing'}>{keyTest === 'testing' ? <Spinner /> : 'שמירה ובדיקה'}</Btn>
          </div>
          {keyTest && keyTest !== 'testing' && <Notice tone={keyTest.ok ? 'ok' : 'error'}>{keyTest.msg}</Notice>}
        </form>
          </>}
        {db.dismissed.length > 0 && (
          <Btn variant="ghost" onClick={() => { update(d => ({ ...d, dismissed: [] })); notify('רשימת הספרים שסומנו "לא מעניין" אופסה'); }}>
            איפוס {Math.ceil(db.dismissed.length / 2)} ספרים שסומנו "לא מעניין"
          </Btn>
        )}
      </section>

      <details className="bg-surface border border-line rounded-xl p-3">
        <summary className="font-semibold text-[17px] cursor-pointer min-h-[36px] flex items-center">גיבוי ידני לקובץ (לא חובה)</summary>
        <p className="text-[14px] text-muted mt-1 mb-3">הכול מסתנכרן ונשמר אוטומטית. כאן אפשר בנוסף לשמור עותק לקובץ או לייבא ממנו.</p>
        <div className="grid gap-4">
      <section className="bg-surface border border-line rounded-xl p-3">
        <h2 className="font-semibold text-[17px] mb-1">מצב אחסון</h2>
        <StatusRow ok={status.local} label="localStorage" />
        <StatusRow ok={status.idb} label="IndexedDB (עותק שני)" />
        <StatusRow ok={status.persisted} label="אחסון קבוע (מוגן מניקוי)" detail={status.persisted === true ? 'אושר' : status.persisted === false ? 'לא אושר' : 'לא ידוע'} />
        <p className="text-[13px] text-muted mt-2 tabular">{db.books.length} ספרים · נשמר לאחרונה {status.savedAt ? fmtDateTime(status.savedAt) : '—'} · משתמש: {profile.name}</p>
      </section>
      <section className="bg-surface border border-line rounded-xl p-3 grid gap-2">
        <h2 className="font-semibold text-[17px]">ייצוא</h2>
        <Btn onClick={() => { downloadFile(`reading-backup-${profile.name}-${stamp}.json`, json(), 'application/json'); markBackup(); notify('קובץ הגיבוי נוצר'); }} disabled={!db.books.length}>
          <Icon name="Download" size={20} />הורדת גיבוי מלא (JSON)
        </Btn>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="soft" disabled={!db.books.length} onClick={async () => { const ok = await copyText(json(), taRef.current); if (ok) { markBackup(); notify('הגיבוי הועתק. אפשר להדביק בהערות או במייל.'); } else notify('ההעתקה נחסמה. הטקסט מסומן בתיבה למטה, העתיקו ידנית.'); }}>
            <Icon name="Copy" size={18} />העתקת JSON
          </Btn>
          <Btn variant="soft" disabled={!db.books.length} onClick={() => { downloadFile(`my-books-${profile.name}-${stamp}.txt`, toText(db), 'text/plain;charset=utf-8'); notify('רשימת הטקסט נוצרה'); }}>
            <Icon name="FileText" size={18} />רשימה כטקסט
          </Btn>
        </div>
      </section>
      <section className="bg-surface border border-line rounded-xl p-3 grid gap-2">
        <h2 className="font-semibold text-[17px]">ייבוא ושחזור</h2>
        <input ref={fileRef} id="import-file" type="file" accept="application/json,.json,text/plain" className="hidden" onChange={onFile} />
        <Btn variant="ghost" onClick={() => fileRef.current && fileRef.current.click()}><Icon name="Upload" size={20} />בחירת קובץ גיבוי</Btn>
        <label htmlFor="import-paste" className="text-[14px] text-muted">או הדביקו כאן את תוכן הגיבוי:</label>
        <textarea id="import-paste" ref={taRef} value={paste} onChange={e => setPaste(e.target.value)} rows={3} dir="ltr"
          className="w-full rounded-xl border border-line bg-bg p-2 text-[13px] font-mono" placeholder='{"version":1,"books":[...]}' />
        <Btn variant="soft" disabled={!paste.trim()} onClick={() => parse(paste)}>בדיקת הטקסט</Btn>
        {err && <Notice tone="error">{err}</Notice>}
        {preview && (
          <div className="fade-in grid gap-2 border border-accent rounded-xl p-3">
            <p className="text-[15px]">בגיבוי יש <b className="tabular">{preview.data.books.length}</b> ספרים, מתוכם <b className="tabular">{preview.fresh}</b> שלא קיימים כאן.</p>
            <Btn onClick={merge} disabled={!preview.fresh}>מיזוג: הוספת {preview.fresh} ספרים חדשים</Btn>
            <Btn variant="danger" onClick={doReplace}>{confirmReplace ? `לחצו שוב: להחליף את כל ${db.books.length} הספרים הנוכחיים` : 'החלפה מלאה של הספרייה'}</Btn>
          </div>
        )}
      </section>
      <section className="border border-danger rounded-xl p-3 grid gap-2">
        <h2 className="font-semibold text-[17px] text-danger">מחיקת כל הנתונים</h2>
        <p className="text-[14px] text-muted">מוחק את כל הספרים, הדירוגים והתגיות מהמכשיר. אי אפשר לבטל, אלא אם שמרת גיבוי.</p>
        <Btn variant="danger" disabled={!db.books.length} onClick={() => {
          if (!confirmWipe) { setConfirmWipe(true); return; }
          const now = Date.now(); const tb = { ...db.tombstones.books }; const th = { ...db.tombstones.history };
          db.books.forEach(b => { tb[b.id] = now; }); db.history.forEach(h => { th[h.id] = now; });
          replace({ ...emptyDB(), settings: db.settings, tombstones: { books: tb, history: th } }); setConfirmWipe(false); notify('כל הספרים נמחקו');
        }}>{confirmWipe ? 'לחצו שוב למחיקה סופית' : 'מחיקת הכל'}</Btn>
      </section>
        </div>
      </details>
      <p className="text-center text-[12px] text-muted pb-2">נתוני ספרים: Google Books · Open Library · Wikidata. · גרסה {APP_VERSION}</p>
    </div>
  );
}

/* ============================================================
   אפליקציה
   ============================================================ */
/* ---------- התקנה על מסך הבית ---------- */
const INSTALL_DISMISS_KEY = 'vrt_install_dismissed_at';
const isStandalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; } };
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function InstallPrompt() {
  const [ready, setReady] = useState(!!window.__installPrompt);
  const [hidden, setHidden] = useState(() => {
    try { const t = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0); return Date.now() - t < 14 * 86400000; } catch (e) { return false; }
  });
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const f = () => setReady(!!window.__installPrompt);
    window.addEventListener('vrt-install-ready', f);
    return () => window.removeEventListener('vrt-install-ready', f);
  }, []);
  if (hidden || isStandalone() || !/^https?:$/.test(location.protocol)) return null;
  const ios = isIOS();
  if (!ready && !ios) return null;
  const dismiss = () => { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (e) { /* */ } setHidden(true); };
  const install = async () => {
    if (ios) { setIosHelp(true); return; }
    const ev = window.__installPrompt;
    if (!ev) return;
    ev.prompt();
    try { const r = await ev.userChoice; if (r && r.outcome === 'accepted') setHidden(true); } catch (e) { /* */ }
    window.__installPrompt = null; setReady(false);
  };
  return (
    <div className="fade-in mt-3 bg-surface border border-line rounded-xl p-3 flex gap-3 items-start">
      <img src="icons/icon-192.png" alt="" width="48" height="48" className="w-12 h-12 rounded-xl shrink-0" />
      <div className="flex-1 min-w-0 grid gap-2">
        <div>
          <div className="font-semibold text-[16px]">להתקין על מסך הבית?</div>
          <div className="text-[14px] text-muted">נפתח כמו אפליקציה, במסך מלא, וגם בלי אינטרנט.</div>
        </div>
        {iosHelp ? (
          <ol className="text-[14px] list-decimal pr-5 grid gap-1">
            <li>לוחצים על כפתור השיתוף <Icon name="Share" size={15} className="inline align-text-bottom" /> בתחתית Safari.</li>
            <li>בוחרים <b>"הוספה למסך הבית"</b>.</li>
            <li>לוחצים <b>"הוסף"</b>.</li>
          </ol>
        ) : (
          <div className="flex gap-2">
            <Btn className="!min-h-[44px]" onClick={install}><Icon name="Download" size={18} />התקנה</Btn>
            <Btn variant="ghost" className="!min-h-[44px]" onClick={dismiss}>לא עכשיו</Btn>
          </div>
        )}
        {iosHelp && <button type="button" className="text-muted text-[13px] font-semibold justify-self-start min-h-[36px]" onClick={dismiss}>סגירה</button>}
      </div>
    </div>
  );
}

/* ============================================================
   לשונית: חברים — בקשות חברות, המדפים של החברים, המלצות ביניהם, ומה אהוב אצל חברים ובקהילה
   ============================================================ */
const slimBook = (b) => ({
  key: b.key, source: b.source, sourceId: b.sourceId, title: b.title, subtitle: b.subtitle || '', authors: b.authors || [], year: b.year || '',
  description: (b.description || '').slice(0, 800), descSource: b.descSource || '', categories: (b.categories || []).slice(0, 4), cover: b.cover || '',
  pageCount: b.pageCount || 0, language: b.language || '', isbns: (b.isbns || []).slice(0, 3), link: b.link || '', publisher: b.publisher || '',
  verifiedVia: b.verifiedVia || '', verifiedAt: b.verifiedAt || 0
});
function useProfilesList() {
  const [p, setP] = useState(() => loadProfiles().profiles);
  useEffect(() => { const f = () => setP(loadProfiles().profiles); window.addEventListener('vrt-profiles-changed', f); return () => window.removeEventListener('vrt-profiles-changed', f); }, []);
  return p;
}
function useFriends() {
  const social = useSocial();
  const me = ACTIVE.id;
  const rel = friendsOf(social.items, me);
  const accepted = [...rel.entries()].filter(([, x]) => x.status === 'accepted').map(([pid]) => pid);
  const incoming = [...rel.values()].filter(x => x.status === 'pending' && x.to === me);
  const outgoing = [...rel.values()].filter(x => x.status === 'pending' && x.from === me);
  const inbox = social.items.filter(x => x.type === 'rec' && x.to === me && x.status !== 'dismissed');
  return { social, me, rel, accepted, incoming, outgoing, inbox, badge: incoming.length + inbox.filter(x => x.status === 'new').length };
}
// ספרים שחברים (או כל המשתמשים) אהבו ועוד לא אצלי
function lovedBy(pids, myBooks, { minFans = 1 } = {}) {
  const m = new Map();
  pids.forEach(pid => {
    const d = loadDBOf(pid);
    if (!d) return;
    d.books.forEach(b => {
      const loved = b.status !== 'want' && b.rating >= 4, wanted = b.status === 'want';
      if (!loved && !wanted) return;
      if (findInLibrary(b, myBooks)) return;
      const k = dedupeKey(b);
      const cur = m.get(k) || { book: b, fans: [], wants: [], score: 0 };
      if (loved) { cur.fans.push({ pid, rating: b.rating, note: b.note }); cur.score += b.rating - 2; } else { cur.wants.push(pid); cur.score += 0.5; }
      m.set(k, cur);
    });
  });
  return [...m.values()].filter(x => x.fans.length >= minFans || (minFans <= 1 && x.wants.length)).sort((a, b) => b.score - a.score);
}
function friendsLovedTitles(myBooks) {
  const { accepted } = (() => { const s = loadSocial(); const rel = friendsOf(s.items, ACTIVE.id); return { accepted: [...rel.entries()].filter(([, x]) => x.status === 'accepted').map(([p]) => p) }; })();
  return lovedBy(accepted, myBooks).filter(x => x.fans.length).slice(0, 20).map(x => `${x.book.title} — ${(x.book.authors || [])[0] || ''}`);
}

function FriendsTab({ db, onPick, notify }) {
  const profiles = useProfilesList();
  const { me, rel, accepted, incoming, outgoing, inbox } = useFriends();
  const [view, setView] = useState(null);   // מזהה חבר שהמדף שלו פתוח
  const nameOf = (pid) => (profiles.find(p => p.id === pid) || {}).name || 'משתמש';
  const profOf = (pid) => profiles.find(p => p.id === pid) || { id: pid, name: 'משתמש', color: 0 };
  const now = () => Date.now();
  const request = (pid) => { socialChange(items => [...items, { id: uid(), type: 'friend', from: me, to: pid, status: 'pending', at: now(), editedAt: now() }]); notify(`נשלחה בקשת חברות ל${nameOf(pid)}`); };
  const setRel = (item, status) => socialChange(items => items.map(x => x.id === item.id ? { ...x, status, editedAt: now() } : x));
  const setRec = (item, status) => socialChange(items => items.map(x => x.id === item.id ? { ...x, status, editedAt: now() } : x));
  useEffect(() => { if (inbox.some(x => x.status === 'new')) socialChange(items => items.map(x => x.type === 'rec' && x.to === me && x.status === 'new' ? { ...x, status: 'seen', editedAt: now() } : x)); }, [inbox.length]);
  const others = profiles.filter(p => p.id !== me && !(rel.get(p.id) && ['accepted', 'pending'].includes(rel.get(p.id).status)));
  const fromFriends = useMemo(() => lovedBy(accepted, db.books).slice(0, 15), [accepted.join(), db.books]);
  const community = useMemo(() => lovedBy(profiles.map(p => p.id).filter(p => p !== me), db.books, { minFans: 2 }).slice(0, 10), [profiles.length, db.books]);

  if (view) return <FriendShelf pid={view} profile={profOf(view)} myBooks={db.books} onBack={() => setView(null)} onPick={onPick} />;
  const BookRow = ({ book, children }) => (
    <li className="bg-surface border border-line rounded-2xl p-3 flex gap-3">
      <Cover book={book} className="w-14 h-20" />
      <div className="min-w-0 flex-1">
        <div className="font-display font-medium text-[17px] leading-snug clamp-2">{book.title}</div>
        <div className="text-muted text-[14px] truncate">{(book.authors || []).join(', ')}</div>
        {children}
      </div>
    </li>
  );
  const AddButtons = ({ book }) => {
    const inLib = findInLibrary(book, db.books);
    if (inLib) return <div className="text-[13px] text-muted mt-1.5">{inLib.status === 'want' ? 'כבר ברשימת "רוצה לקרוא"' : `כבר בספרייה (${inLib.rating}★)`}</div>;
    return (
      <div className="flex gap-1.5 mt-2 flex-wrap">
        <Chip onClick={() => onPick(book, { status: 'want' })}><Icon name="Bookmark" size={14} />רוצה לקרוא</Chip>
        <Chip onClick={() => onPick(book)}><Icon name="BookCheck" size={14} />קראתי</Chip>
      </div>
    );
  };
  return (
    <div className="fade-in">
      <header className="pt-4 pb-3">
        <h1 className="font-display font-medium text-[26px] leading-snug">חברים</h1>
        <p className="text-muted text-[15px]">רואים מה החברים קוראים ואוהבים, ממליצים אחד לשני, ומגלים ספרים דרכם.</p>
      </header>

      {incoming.length > 0 && (
        <section className="mb-5">
          <h2 className="font-semibold text-[15px] mb-2">בקשות חברות</h2>
          <ul className="grid gap-2">{incoming.map(x => (
            <li key={x.id} className="bg-surface border border-accent rounded-2xl p-3 flex items-center gap-2">
              <Avatar profile={profOf(x.from)} size={36} />
              <span className="flex-1 font-semibold">{nameOf(x.from)}</span>
              <Btn variant="soft" onClick={() => setRel(x, 'accepted')}>אישור</Btn>
              <Btn variant="ghost" onClick={() => setRel(x, 'declined')}>לא עכשיו</Btn>
            </li>))}</ul>
        </section>
      )}

      {inbox.length > 0 && (
        <section className="mb-5">
          <h2 className="font-semibold text-[15px] mb-2">חברים המליצו לך</h2>
          <ul className="grid gap-2">{inbox.map(x => (
            <BookRow key={x.id} book={x.book}>
              <div className="text-[13px] mt-1"><span className="font-semibold">{nameOf(x.from)}</span>{x.note ? `: "${x.note}"` : ' המליץ/ה'}</div>
              <div className="flex items-center gap-1.5"><AddButtons book={x.book} />
                <button type="button" className="text-[13px] text-muted underline mt-2 min-h-[32px]" onClick={() => setRec(x, 'dismissed')}>הסתרה</button></div>
            </BookRow>))}</ul>
        </section>
      )}

      <section className="mb-5">
        <h2 className="font-semibold text-[15px] mb-2">החברים שלי</h2>
        {accepted.length
          ? <ul className="grid grid-cols-2 gap-2">{accepted.map(pid => {
              const d = loadDBOf(pid);
              const read = d ? d.books.filter(b => b.status !== 'want').length : 0, want = d ? d.books.filter(b => b.status === 'want').length : 0;
              return (
                <li key={pid}>
                  <button type="button" onClick={() => setView(pid)} className="w-full text-right bg-surface border border-line rounded-2xl p-3 grid gap-1">
                    <span className="flex items-center gap-2"><Avatar profile={profOf(pid)} size={32} /><span className="font-semibold truncate">{nameOf(pid)}</span></span>
                    <span className="text-[13px] text-muted tabular">{read} קראו · {want} רוצים לקרוא</span>
                  </button>
                </li>
              );
            })}</ul>
          : <p className="text-[14px] text-muted">עוד אין חברים. אפשר לשלוח בקשה למשתמשים אחרים כאן למטה.</p>}
        {outgoing.length > 0 && <p className="text-[13px] text-muted mt-2">ממתינות לאישור: {outgoing.map(x => nameOf(x.to)).join(', ')}</p>}
      </section>

      {fromFriends.length > 0 && (
        <section className="mb-5">
          <h2 className="font-semibold text-[15px] mb-2">מה החברים אוהבים ועוד לא קראת</h2>
          <ul className="grid gap-2">{fromFriends.map(x => (
            <BookRow key={dedupeKey(x.book)} book={x.book}>
              <div className="text-[13px] text-muted mt-1">
                {x.fans.map(f => `${nameOf(f.pid)} (${f.rating}★)`).join(' · ')}{x.wants.length ? `${x.fans.length ? ' · ' : ''}רוצים לקרוא: ${x.wants.map(nameOf).join(', ')}` : ''}
              </div>
              {x.fans.find(f => f.note) && <div className="text-[13px] font-reading mt-0.5 clamp-2">"{x.fans.find(f => f.note).note}"</div>}
              <AddButtons book={x.book} />
            </BookRow>))}</ul>
        </section>
      )}

      {community.length > 0 && (
        <section className="mb-5">
          <h2 className="font-semibold text-[15px] mb-2">אהובים בקהילה</h2>
          <p className="text-[13px] text-muted mb-2">ספרים שכמה משתמשים דירגו 4★ ומעלה.</p>
          <ul className="grid gap-2">{community.map(x => (
            <BookRow key={dedupeKey(x.book)} book={x.book}>
              <div className="text-[13px] text-muted mt-1 tabular">{x.fans.length} משתמשים אהבו · ממוצע {(x.fans.reduce((s, f) => s + f.rating, 0) / x.fans.length).toFixed(1)}★</div>
              <AddButtons book={x.book} />
            </BookRow>))}</ul>
        </section>
      )}

      <section className="mb-5">
        <h2 className="font-semibold text-[15px] mb-2">להוסיף חברים</h2>
        {others.length
          ? <ul className="grid gap-2">{others.map(p => (
              <li key={p.id} className="bg-surface border border-line rounded-2xl p-3 flex items-center gap-2">
                <Avatar profile={p} size={32} /><span className="flex-1 font-semibold truncate">{p.name}</span>
                <Btn variant="soft" onClick={() => request(p.id)}><Icon name="UserPlus" size={16} />בקשת חברות</Btn>
              </li>))}</ul>
          : <p className="text-[14px] text-muted">כל המשתמשים כבר ברשימה. משתמשים חדשים שיצטרפו יופיעו כאן.</p>}
      </section>
    </div>
  );
}
function FriendShelf({ pid, profile, myBooks, onBack, onPick }) {
  const d = loadDBOf(pid);
  const [shelf, setShelf] = useState('read');
  const books = d ? d.books.filter(b => shelf === 'want' ? b.status === 'want' : b.status !== 'want').sort((a, b) => (b.rating - a.rating) || (b.addedAt - a.addedAt)) : [];
  return (
    <div className="fade-in">
      <header className="pt-4 pb-3 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="חזרה" className="w-10 h-10 grid place-items-center rounded-full border border-line"><Icon name="ChevronRight" size={20} /></button>
        <Avatar profile={profile} size={36} />
        <h1 className="font-display font-medium text-[24px] leading-snug truncate">המדף של {profile.name}</h1>
      </header>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-surface2 mb-3" role="tablist" aria-label="מדף">
        {[['read', 'קראו'], ['want', 'רוצים לקרוא']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={shelf === k} onClick={() => setShelf(k)}
            className={`min-h-[44px] rounded-xl font-semibold text-[15px] ${shelf === k ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      <ul className="grid gap-2">
        {!books.length && <li className="text-center text-muted py-6">אין כאן ספרים עדיין.</li>}
        {books.map(b => {
          const inLib = findInLibrary(b, myBooks);
          return (
            <li key={b.id} className="bg-surface border border-line rounded-2xl p-3 flex gap-3">
              <Cover book={b} className="w-12 h-[4.5rem]" />
              <div className="min-w-0 flex-1">
                <div className="font-display font-medium text-[16px] leading-snug clamp-2">{b.title}</div>
                <div className="text-muted text-[13px] truncate">{b.authors.join(', ')}</div>
                {b.status !== 'want' && <Stars value={b.rating} size={13} />}
                {b.note && <div className="text-[13px] font-reading clamp-2 mt-0.5">"{b.note}"</div>}
                {inLib ? <div className="text-[12px] text-muted mt-1">{inLib.status === 'want' ? 'ברשימה שלך' : `קראת (${inLib.rating}★)`}</div>
                  : <div className="flex gap-1.5 mt-1.5"><Chip onClick={() => onPick(b, { status: 'want' })}><Icon name="Bookmark" size={14} />רוצה לקרוא</Chip><Chip onClick={() => onPick(b)}>קראתי</Chip></div>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
// המלצה לחבר מתוך דף הספר
function RecommendToFriend({ book, notify }) {
  const profiles = useProfilesList();
  const { accepted, me } = useFriends();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState([]);
  const [note, setNote] = useState('');
  if (!accepted.length) return null;
  const send = () => {
    const now = Date.now();
    socialChange(items => [...items, ...to.map(pid => ({ id: uid(), type: 'rec', from: me, to: pid, book: slimBook(book), note: note.trim().slice(0, 300), status: 'new', at: now, editedAt: now }))]);
    notify(`ההמלצה נשלחה ל-${to.length} חברים`); setOpen(false); setTo([]); setNote('');
  };
  if (!open) return <Btn variant="ghost" className="w-full mb-3" onClick={() => setOpen(true)}><Icon name="Send" size={18} />להמליץ לחבר</Btn>;
  return (
    <div className="mb-3 border border-line rounded-2xl p-3 grid gap-2">
      <div className="text-[14px] font-semibold">למי להמליץ?</div>
      <div className="flex flex-wrap gap-1.5">{accepted.map(pid => <Chip key={pid} active={to.includes(pid)} onClick={() => setTo(t => t.includes(pid) ? t.filter(x => x !== pid) : [...t, pid])}>{(profiles.find(p => p.id === pid) || {}).name || 'חבר'}</Chip>)}</div>
      <label htmlFor="rec-note" className="sr-only">מה לכתוב</label>
      <input id="rec-note" value={note} onChange={e => setNote(e.target.value)} placeholder="כמה מילים: למה זה בשבילו/ה (רשות)" className="min-h-[44px] px-3 rounded-xl border border-line bg-bg text-[16px]" />
      <div className="grid grid-cols-2 gap-2"><Btn disabled={!to.length} onClick={send}>שליחה</Btn><Btn variant="ghost" onClick={() => setOpen(false)}>ביטול</Btn></div>
    </div>
  );
}

const TABS = [
  { id: 'library', label: 'הספרים שלי', icon: 'Library' },
  { id: 'add', label: 'הוספת ספר', icon: 'BookPlus' },
  { id: 'discover', label: 'גלה ספר חדש', icon: 'Sparkles' },
  { id: 'friends', label: 'חברים', icon: 'Users' },
  { id: 'backup', label: 'הגדרות', icon: 'Settings' }
];

function App({ profile, onSwitch, onRenameProfile, onDeleteProfile }) {
  const { db, update, replace, status } = usePersistentDB();
  const friendsBadge = useFriends().badge;
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('vrt_tab') || 'library'; } catch (e) { return 'library'; } });
  const [starterOpen, setStarterOpen] = useState(false);
  const showStarter = tab === 'library' && (starterOpen || (!db.books.length && !db.settings.onboarded));
  const [pending, setPending] = useState(null);   // { book, existing }
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  CONFIG.apiKey = db.settings.apiKey || '';

  useEffect(() => { try { sessionStorage.setItem('vrt_tab', tab); } catch (e) { /* */ } window.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => {
    const root = document.documentElement;
    if (db.settings.theme === 'light' || db.settings.theme === 'dark') root.setAttribute('data-theme', db.settings.theme);
    else root.removeAttribute('data-theme');
  }, [db.settings.theme]);
  // ספרים שנשמרו בשם לועזי: מחפשים ברקע את שם המהדורה העברית (פעם אחת לכל ספר)
  const heBusy = useRef(false);
  useEffect(() => {
    if (heBusy.current) return;
    let checked = {};
    try { checked = JSON.parse(localStorage.getItem('vrt-he-checked') || '{}') || {}; } catch (e) { /* */ }
    const todo = db.books.filter(b => !hasHebrew(b.title) && !checked[b.id]).slice(0, 20);
    if (!todo.length) return;
    heBusy.current = true;
    (async () => {
      const found = {};
      for (const b of todo) {
        const he = await lookupHebrewTitle(b).catch(() => null);
        if (he === null) continue;   // תקלת רשת: ננסה בפעם הבאה
        checked[b.id] = 1;
        if (he) found[b.id] = he;
      }
      try { localStorage.setItem('vrt-he-checked', JSON.stringify(checked)); } catch (e) { /* */ }
      if (Object.keys(found).length) {
        const now = Date.now();
        update(d => ({ ...d, books: d.books.map(b => found[b.id] && !hasHebrew(b.title) ? { ...withHebrewTitle(b, found[b.id]), editedAt: now } : b) }));
      }
      heBusy.current = false;
    })();
  }, [db.books]);

  const notify = (t) => {
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  };

  const pick = (book, opts) => {
    const existing = findInLibrary(book, db.books);
    setPending({ book: existing || book, existing: existing || null, onSaved: opts && opts.onSaved, status: opts && opts.status });
  };
  const save = ({ status = 'read', rating, tags, note }) => {
    const { book, existing } = pending;
    update(d => {
      const tagLibrary = Array.from(new Set([...d.tagLibrary, ...tags]));
      if (existing) return { ...d, tagLibrary, books: d.books.map(b => b.id === existing.id ? sanitizeBook({ ...b, status, rating, tags, note, editedAt: Date.now() }) : b) };
      const now = Date.now();
      const rec = sanitizeBook({ ...book, id: uid(), status, rating, tags, note, addedAt: now, editedAt: now, verifiedAt: book.verifiedAt || now });
      return { ...d, tagLibrary, books: [rec, ...d.books], settings: { ...d.settings, onboarded: true } };
    });
    notify(existing ? 'השינויים נשמרו' : status === 'want' ? `"${book.title}" נוסף לרשימת "רוצה לקרוא"` : `"${book.title}" נשמר בספרייה`);
    const onSaved = pending.onSaved;
    setPending(null);
    if (onSaved) onSaved(existing || book);
    else if (!existing && tab === 'add') setTab('library');
  };

  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      <main className="mx-auto max-w-xl px-4 pb-28 safe-top">
        <div className="flex items-center justify-between gap-2 pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <Logo size={32} />
            <span className="wordmark text-[23px] leading-none">מה שנקרא</span>
          </div>
          <button type="button" onClick={onSwitch} aria-label="החלפת משתמש" title="החלפת משתמש"
            className="shrink-0 min-h-[40px] ps-1 pe-2.5 rounded-full border border-line bg-surface inline-flex items-center gap-1.5 text-[14px] font-semibold">
            <Avatar profile={profile} size={30} /><span className="truncate max-w-[110px]">{profile.name}</span><Icon name="ChevronsUpDown" size={15} className="text-muted" />
          </button>
        </div>
        <InstallPrompt />
        {showStarter && <Starter db={db} update={update} onBegin={() => setStarterOpen(true)} onClose={() => setStarterOpen(false)}
          goQueue={() => { setStarterOpen(false); try { sessionStorage.setItem('vrt_add_mode', 'bulk'); } catch (e) { /* */ } setTab('add'); }} />}
        {tab === 'library' && !showStarter && <LibraryTab db={db} onEdit={(b) => setPending({ book: b, existing: b, status: b.status === 'want' ? 'read' : undefined })} onDelete={(id) => { update(d => ({ ...d, books: d.books.filter(b => b.id !== id), tombstones: { ...d.tombstones, books: { ...d.tombstones.books, [id]: Date.now() } } })); notify('הספר נמחק'); }}
          onUpdateBook={(id, patch) => update(d => ({ ...d, books: d.books.map(b => b.id === id ? sanitizeBook({ ...b, ...patch, editedAt: Date.now() }) : b) }))} goAdd={() => setTab('add')} notify={notify} />}
        {tab === 'add' && <AddTab db={db} onPick={pick} goSettings={() => setTab('backup')} />}
        {tab === 'discover' && <DiscoverTab db={db} update={update} onPick={pick} notify={notify} />}
        {tab === 'friends' && <FriendsTab db={db} onPick={pick} notify={notify} />}
        {tab === 'backup' && <BackupTab onOpenStarter={() => { setStarterOpen(true); setTab('library'); }} db={db} update={update} replace={replace} status={status} notify={notify} profile={profile} onRenameProfile={onRenameProfile} onDeleteProfile={onDeleteProfile} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 glass border-t border-line safe-bottom" aria-label="ניווט ראשי">
        <ul className="mx-auto max-w-xl grid grid-cols-5">
          {TABS.map(t => (
            <li key={t.id}>
              <button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
                className={`w-full min-h-[62px] flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold transition-colors ${tab === t.id ? 'text-accent' : 'text-muted'}`}>
                <span className={`relative px-4 py-1 rounded-full transition-colors ${tab === t.id ? 'bg-accentSoft' : ''}`}><Icon name={t.icon} size={22} />
                  {t.id === 'friends' && friendsBadge > 0 && <span className="absolute -top-0.5 left-2 min-w-[18px] h-[18px] px-1 rounded-full bg-brass text-accentInk text-[11px] font-bold grid place-items-center tabular" aria-label={`${friendsBadge} חדשים`}>{friendsBadge}</span>}</span>
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {pending && <RateSheet book={pending.book} existing={pending.existing} initialStatus={pending.status} tagLibrary={db.tagLibrary} onSave={save} onClose={() => setPending(null)} />}
      <Toast toast={toast} />
    </div>
  );
}

/* ============================================================
   משתמשים: הזדהות בלי סיסמה. כל משתמש מקבל ספרייה נפרדת במכשיר.
   ============================================================ */
const AVATAR_COLORS = ['#56694F', '#8C6F4A', '#5C6B84', '#86596A', '#6E7A4E', '#6D5D86', '#8E5D48', '#4F7478'];
// סמליל "מה שנקרא": ספר פתוח בלילה, עם כוכב קטן של "מה עוד נקרא" (תואם לאייקון במסך הבית)
function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <defs><linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#46518F" /><stop offset="1" stopColor="#1E2550" /></linearGradient></defs>
      <rect width="512" height="512" rx="128" fill="url(#lg-bg)" />
      <path d="M256 196 C 214 170, 160 164, 112 172 L 112 370 C 160 362, 214 368, 256 394 Z" fill="#FFF8EC" />
      <path d="M256 196 C 298 170, 352 164, 400 172 L 400 370 C 352 362, 298 368, 256 394 Z" fill="#E9DFCB" />
      <path d="M256 196 L 256 394" stroke="#1E2550" strokeOpacity=".25" strokeWidth="6" />
      <path d="M256 70 L 270 112 L 312 126 L 270 140 L 256 182 L 242 140 L 200 126 L 242 112 Z" fill="#E4AA5C" />
    </svg>
  );
}
function Avatar({ profile, size = 40 }) {
  return (
    <span aria-hidden="true" className="shrink-0 rounded-full grid place-items-center font-semibold text-white"
      style={{ width: size, height: size, background: AVATAR_COLORS[profile.color % AVATAR_COLORS.length], fontSize: size * 0.45 }}>
      {(profile.name || '?').trim().charAt(0)}
    </span>
  );
}
function loadProfiles() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null');
    if (p && Array.isArray(p.profiles)) return { deleted: {}, ...p };
  } catch (e) { /* */ }
  return { profiles: [], active: null, deleted: {} };
}
function saveProfiles(p) { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(p)); } catch (e) { /* */ } }
function countBooks(pid) {
  try { const d = JSON.parse(localStorage.getItem(dbKeyFor(pid)) || 'null'); return d && Array.isArray(d.books) ? d.books.length : 0; } catch (e) { return 0; }
}

function WhoAreYou({ profiles, onPick, onCreate }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(profiles.length === 0);
  const legacyCount = profiles.length === 0 ? countBooks('default') : 0;
  const taken = profiles.some(p => norm(p.name) === norm(name));
  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      <main className="mx-auto max-w-md px-4 pt-10 pb-10 safe-top fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={56} />
          <div>
            <div className="wordmark text-[34px] leading-none">מה שנקרא</div>
            <div className="text-muted text-[14px] mt-1">מה קראת, מה תקרא, ומה החברים אוהבים</div>
          </div>
        </div>
        <h1 className="font-display font-medium text-[26px] leading-snug mb-1">של מי הספרייה?</h1>
        <p className="text-muted text-[15px] mb-6">כל משתמש מקבל ספרייה, דירוגים והמלצות משלו. אין סיסמה, רק בוחרים שם.</p>
        {profiles.length > 0 && (
          <ul className="grid gap-2 mb-4">
            {profiles.map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p.id)}
                  className="w-full min-h-[64px] flex items-center gap-3 px-3 rounded-xl bg-surface border border-line text-right active:bg-surface2">
                  <Avatar profile={p} size={44} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-[17px] truncate">{p.name}</span>
                    <span className="block text-muted text-[13px] tabular">{countBooks(p.id)} ספרים</span>
                  </span>
                  <Icon name="ChevronLeft" size={20} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {adding ? (
          <form className="grid gap-2 bg-surface border border-line rounded-xl p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !taken) onCreate(name.trim()); }}>
            {legacyCount > 0 && <Notice tone="info">במכשיר כבר יש ספרייה עם {legacyCount} ספרים. היא תשויך למשתמש הראשון שתיצרו.</Notice>}
            <label htmlFor="new-profile" className="font-semibold text-[15px]">{profiles.length ? 'משתמש חדש' : 'איך לקרוא לך?'}</label>
            <input id="new-profile" value={name} onChange={e => setName(e.target.value)} maxLength={24} autoFocus placeholder="שם או כינוי"
              className="w-full min-h-[52px] px-3 rounded-xl border border-line bg-bg text-[17px]" />
            {taken && <p className="text-[13px] text-danger">כבר יש משתמש בשם הזה.</p>}
            <div className={profiles.length ? 'grid grid-cols-2 gap-2' : 'grid'}>
              <Btn type="submit" disabled={!name.trim() || taken}><Icon name="Check" size={20} />כניסה</Btn>
              {profiles.length > 0 && <Btn variant="ghost" onClick={() => { setAdding(false); setName(''); }}>ביטול</Btn>}
            </div>
          </form>
        ) : (
          <Btn variant="ghost" className="w-full" onClick={() => setAdding(true)}><Icon name="UserPlus" size={20} />הוספת משתמש</Btn>
        )}
        <p className="text-[13px] text-muted mt-6">{loadCloud() ? 'המשתמשים והספרים מסתנכרנים בין כל הטלפונים.' : 'הנתונים נשמרים במכשיר הזה.'}</p>
      </main>
    </div>
  );
}

function Root() {
  const [state, setState] = useState(loadProfiles);
  useSyncStatus();   // רינדור מחדש כשהשרת נמצא או כשמצב הסנכרון משתנה
  const change = (fn) => setState(prev => { const next = fn(prev); saveProfiles(next); scheduleSync(800); return next; });
  const active = state.profiles.find(p => p.id === state.active);
  useEffect(() => {
    const onStorage = (e) => { if (e.key === PROFILES_KEY) setState(loadProfiles()); };
    const onProfiles = () => setState(loadProfiles());
    const onVisible = () => { if (document.visibilityState === 'visible') syncNow(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('vrt-profiles-changed', onProfiles);
    document.addEventListener('visibilitychange', onVisible);
    discoverCloud().then(ok => ok && ensureJoined()).catch(() => {}).finally(() => syncNow());
    const iv = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 45000);
    return () => {
      window.removeEventListener('storage', onStorage); window.removeEventListener('vrt-profiles-changed', onProfiles);
      document.removeEventListener('visibilitychange', onVisible); clearInterval(iv);
    };
  }, []);

  if (!active) {
    return <WhoAreYou profiles={state.profiles}
      onPick={(id) => change(s => ({ ...s, active: id }))}
      onCreate={(name) => change(s => {
        const id = s.profiles.some(p => p.id === 'default') || loadCloud() ? uid() : 'default';
        const used = new Set(s.profiles.map(p => p.color));
        const color = [...AVATAR_COLORS.keys()].find(i => !used.has(i)) ?? s.profiles.length;
        return { ...s, profiles: [...s.profiles, { id, name, color, createdAt: Date.now(), updatedAt: Date.now() }], active: id };
      })} />;
  }

  ACTIVE.id = active.id;
  ACTIVE.name = active.name;
  ACTIVE.dbKey = dbKeyFor(active.id);
  ACTIVE.queueKey = queueKeyFor(active.id);
  return <App key={active.id} profile={active}
    onSwitch={() => { try { sessionStorage.removeItem('vrt_tab'); } catch (e) { /* */ } change(s => ({ ...s, active: null })); }}
    onRenameProfile={(name) => change(s => ({ ...s, profiles: s.profiles.map(p => p.id === active.id ? { ...p, name, updatedAt: Date.now() } : p) }))}
    onDeleteProfile={() => {
      try { localStorage.removeItem(dbKeyFor(active.id)); localStorage.removeItem(queueKeyFor(active.id)); } catch (e) { /* */ }
      idbDelete(dbKeyFor(active.id)).catch(() => {});
      change(s => ({ ...s, profiles: s.profiles.filter(p => p.id !== active.id), deleted: { ...(s.deleted || {}), [active.id]: Date.now() }, active: null }));
    }} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
