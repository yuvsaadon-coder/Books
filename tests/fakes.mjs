// כלים לבדיקות: Durable Object בזיכרון, ו-KV "עקבי בסופו של דבר" כמו האמיתי
import { Store } from '../worker/worker.js';
// אחסון של Durable Object: get/put/delete של מפתח אחד או רבים, עם העתקה (כמו האמיתי)
export function memStorage() {
  const m = new Map();
  const clone = (v) => v === undefined ? undefined : structuredClone(v);
  return {
    m,
    async get(k) { if (Array.isArray(k)) { const r = new Map(); k.forEach(x => { if (m.has(x)) r.set(x, clone(m.get(x))); }); return r; } return clone(m.get(k)); },
    async put(k, v) { if (typeof k === 'object') Object.entries(k).forEach(([a, b]) => m.set(a, clone(b))); else m.set(k, clone(v)); },
    async delete(k) { [].concat(k).forEach(x => m.delete(x)); }
  };
}
// STORE לבדיקות: מופע אחד של Store עם אחסון בזיכרון. env מועבר אחר כך (כי הוא מכיל את STORE עצמו)
export function storeNamespace() {
  const storage = memStorage();
  let inst = null, env = null;
  return {
    storage, bind(e) { env = e; return this; },
    idFromName: () => 'main',
    get: () => ({ fetch: async (url, init) => { inst = inst || new Store({ storage }, env); return inst.fetch(new Request(url, init)); } })
  };
}
/* KV כמו של Cloudflare: קריאה נשמרת במטמון (גם "לא קיים") ומוחזרת עד ttl אחרי הקריאה הראשונה, גם אם בינתיים נכתב ערך חדש.
   כך באגים של "קראתי, שיניתי וכתבתי" או "כתבתי ומיד קראתי" נתפסים בבדיקות, כמו שקרו אצל המשתמשים */
export function staleKV(map = new Map(), ttl = 60000) {
  const cache = new Map();
  return {
    map, cache,
    async get(k, t) {
      let c = cache.get(k);
      if (!c || Date.now() - c.at > ttl) { c = { at: Date.now(), v: map.has(k) ? map.get(k) : null }; cache.set(k, c); }
      return c.v == null ? null : (t === 'json' ? JSON.parse(c.v) : c.v);
    },
    async put(k, v) { map.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
    async delete(k) { map.delete(k); }
  };
}
