// שרת משפחתי למנהל הקריאה (Cloudflare Worker)
// 1. /sync         סנכרון הספרייה בין מכשירים (KV)
// 2. /v1/messages  גישה ל-Claude עם חיפוש ברשת שמוגבל לאתרים אמינים. המפתח נשמר כאן ולא בדפדפן.
//
// הגדרות נדרשות ב-Cloudflare (ראו README.md בתיקייה הזו):
//   Secret   ANTHROPIC_API_KEY  מפתח ה-API של Anthropic
//   Secret   FAMILY_CODE        קוד הספרייה המשפחתית (כל מי שמזין אותו מקבל גישה)
//   KV       LIBRARY            מאגר KV לשמירת הספרייה

const ALLOWED_ORIGINS = ['https://yuvsaadon-coder.github.io'];
const ALLOWED_MODELS = ['claude-opus-5', 'claude-sonnet-5'];
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
  'abayit-books.com', '9livespress.com',
  // ביקורת וספרות
  'haaretz.co.il', 'ynet.co.il', 'wikipedia.org', 'goodreads.com', 'theguardian.com', 'nytimes.com', 'newyorker.com',
  'kirkusreviews.com', 'publishersweekly.com', 'lrb.co.uk', 'nybooks.com', 'bookbrowse.com',
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

function sanitizeTools(tools) {
  const out = [];
  for (const t of Array.isArray(tools) ? tools : []) {
    if (t && t.name === 'web_search' && /^web_search_/.test(t.type || '')) {
      out.push({ type: t.type, name: 'web_search', allowed_domains: TRUSTED_DOMAINS, max_uses: 12,
        user_location: { type: 'approximate', country: 'IL', timezone: 'Asia/Jerusalem' } });
    } else if (t && t.name === 'web_fetch' && /^web_fetch_/.test(t.type || '')) {
      out.push({ type: t.type, name: 'web_fetch', allowed_domains: TRUSTED_DOMAINS, max_uses: 15, max_content_tokens: 20000 });
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
  body.tools = sanitizeTools(body.tools);
  if (!body.tools.length) delete body.tools;
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
  const upstream = await fetch('https://api.anthropic.com' + url.pathname + url.search, { method: 'POST', headers, body: JSON.stringify(body) });
  return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' } });
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
  async fetch(req, env) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let code = '';
    try { code = decodeURIComponent(req.headers.get('x-family-code') || ''); } catch (e) { code = ''; }
    if (!env.FAMILY_CODE || code !== env.FAMILY_CODE.trim()) return json({ type: 'error', error: { type: 'bad_family_code', message: 'wrong family code' } }, 401, cors);
    const path = new URL(req.url).pathname;
    try {
      if (path === '/ping') return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, sync: !!env.LIBRARY }, 200, cors);
      if (path === '/sync') return await handleSync(req, env, cors);
      if (path.startsWith('/v1/messages') && req.method === 'POST') return await handleAI(req, env, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      return json({ type: 'error', error: { type: 'worker_error', message: String(e && e.message || e) } }, 500, cors);
    }
  }
};
